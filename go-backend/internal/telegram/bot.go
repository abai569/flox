package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"strings"
	"sync"
	"time"
)

const apiBaseURL = "https://api.telegram.org"

type Bot struct {
	token   string
	chatID  string
	enabled bool

	apiURL string
	client *client

	mu     sync.RWMutex
	cancel context.CancelFunc
	done   chan struct{}
	lastID int64
}

func New(token, chatID string, enabled bool) *Bot {
	return &Bot{
		token:   token,
		chatID:  chatID,
		enabled: enabled,
		apiURL:  apiBaseURL,
		client:  newClient(),
		done:    make(chan struct{}),
		lastID:  0,
	}
}

func (b *Bot) Token() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.token
}

func (b *Bot) ChatID() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.chatID
}

func (b *Bot) Enabled() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.enabled
}

func (b *Bot) UpdateConfig(token, chatID string, enabled bool) {
	b.mu.Lock()
	b.token = token
	b.chatID = chatID
	b.enabled = enabled
	b.mu.Unlock()
}

func (b *Bot) Start(ctx context.Context) {
	b.mu.Lock()
	if b.cancel != nil {
		b.cancel()
	}
	ctx, cancel := context.WithCancel(ctx)
	b.cancel = cancel
	b.done = make(chan struct{})
	b.mu.Unlock()

	go b.run(ctx)
}

func (b *Bot) run(ctx context.Context) {
	defer func() {
		b.mu.Lock()
		b.done = nil
		b.mu.Unlock()
	}()

	var botUsername string
	for i := 0; i < 3; i++ {
		name, err := b.getBotUsername()
		if err == nil && name != "" {
			botUsername = name
			break
		}
		time.Sleep(2 * time.Second)
	}
	if botUsername == "" {
		botUsername = "bot"
	}

	log.Printf("[telegram] bot started (username: @%s)", botUsername)

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	b.lastID = 0

	for {
		select {
		case <-ctx.Done():
			log.Println("[telegram] bot stopped")
			return
		case <-ticker.C:
			b.processUpdates(botUsername)
		}
	}
}

func (b *Bot) getBotUsername() (string, error) {
	b.mu.RLock()
	token := b.token
	b.mu.RUnlock()

	if token == "" {
		return "", fmt.Errorf("token empty")
	}

	apiURL := fmt.Sprintf("%s/bot%s/getMe", apiBaseURL, token)
	resp, err := b.client.http.Get(apiURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var apiResp struct {
		Ok     bool `json:"ok"`
		Result struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return "", fmt.Errorf("decode getMe response: %w", err)
	}
	if !apiResp.Ok || apiResp.Result.Username == "" {
		return "", fmt.Errorf("getMe failed")
	}
	return apiResp.Result.Username, nil
}

func (b *Bot) processUpdates(botUsername string) {
	b.mu.RLock()
	token := b.token
	lastOffset := b.lastID
	b.mu.RUnlock()

	if token == "" {
		return
	}

	tgURL := fmt.Sprintf("%s/bot%s/getUpdates?offset=%d&timeout=1&allowed_updates=[\"message\"]", apiBaseURL, token, lastOffset+1)
	resp, err := b.client.http.Get(tgURL)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	var apiResp struct {
		Ok     bool            `json:"ok"`
		Result []json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil || !apiResp.Ok {
		return
	}

	for _, raw := range apiResp.Result {
		b.handleUpdate(raw, botUsername)
	}
}

type updateWrapper struct {
	UpdateID int64           `json:"update_id"`
	Message  json.RawMessage `json:"message"`
}

type messageData struct {
	Chat struct {
		ChatID   int64  `json:"id"`
		ChatType string `json:"type"`
	} `json:"chat"`
	Text string     `json:"text"`
	From *userData   `json:"from"`
}

type userData struct {
	UserID        int64  `json:"id"`
	UserIsBot     bool   `json:"is_bot"`
	UserFirstName string `json:"first_name"`
	UserUsername  string `json:"username"`
}

func (b *Bot) handleUpdate(raw json.RawMessage, botUsername string) {
	var upd updateWrapper
	if err := json.Unmarshal(raw, &upd); err != nil {
		return
	}

	var msg messageData
	if err := json.Unmarshal(upd.Message, &msg); err != nil {
		return
	}

	b.mu.Lock()
	if upd.UpdateID > b.lastID {
		b.lastID = upd.UpdateID
	}
	b.mu.Unlock()

	if msg.Chat.ChatID == 0 || msg.Chat.ChatType != "private" {
		return
	}

	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return
	}

	command := strings.ToLower(strings.Split(text, " ")[0])
	lowerBot := strings.ToLower(botUsername)

	switch {
	case command == "/start" || command == "/start@"+lowerBot:
		b.handleStart(&msg)
	case command == "/help" || command == "/help@"+lowerBot:
		b.handleHelp(&msg)
	case command == "/id" || command == "/id@"+lowerBot:
		fallthrough
	case text == "id" || text == "chatid" || strings.ToLower(text) == "chat id":
		b.handleID(&msg)
	}
}

func (b *Bot) reply(chatID int64, text string) {
	b.mu.RLock()
	token := b.token
	b.mu.RUnlock()

	if token == "" {
		return
	}

	tgURL := fmt.Sprintf("%s/bot%s/sendMessage", apiBaseURL, token)
	data := url.Values{}
	data.Set("chat_id", fmt.Sprintf("%d", chatID))
	data.Set("text", text)
	data.Set("parse_mode", "HTML")

	resp, err := b.client.http.PostForm(tgURL, data)
	if err != nil {
		log.Printf("[telegram] reply failed: %v", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Ok          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(body, &result)
	if !result.Ok {
		log.Printf("[telegram] send message failed: %s", result.Description)
	}
}

func (b *Bot) handleStart(msg *messageData) {
	if msg.From == nil {
		return
	}

	userName := msg.From.UserFirstName
	if userName == "" {
		userName = msg.From.UserUsername
	}
	if userName == "" {
		userName = "用户"
	}
	userName = escapeHTML(userName)

	myID := msg.From.UserID
	botUsername := b.BotUsername()

	msgText := "👋 你好，" + userName + "！\n\n"
	msgText += "我是 FLVX 面板的告警通知机器人。\n\n"
	msgText += "📋 <b>面板配置信息</b>\n"
	msgText += "━━━━━━━━━━━━━━━\n"
	msgText += fmt.Sprintf("🔑 <b>Bot Token</b>:\n<code>%s</code>\n\n", b.Token())
	msgText += fmt.Sprintf("🆔 <b>你的 Chat ID</b>:\n<code>%d</code>\n\n", myID)
	msgText += fmt.Sprintf("🤖 <b>Bot 用户名</b>:\n@%s\n\n", botUsername)
	msgText += "━━━━━━━━━━━━━━━\n\n"
	msgText += "💡 <b>配置步骤</b>:\n"
	msgText += "1. 将上面的 Bot Token 和 Chat ID 复制到 FLVX 面板\n"
	msgText += "2. 保存配置后点击「测试连接」\n"
	msgText += "3. 收到测试消息即配置成功 ✅\n\n"
	msgText += "发送 /help 查看更多命令"

	b.reply(msg.Chat.ChatID, msgText)
}

func (b *Bot) handleHelp(msg *messageData) {
	msgText := "📖 <b>可用命令</b>\n\n"
	msgText += "/start — 获取配置信息和 Chat ID\n"
	msgText += "/id — 查看你的 Chat ID\n"
	msgText += "/help — 显示此帮助信息\n\n"
	msgText += "💡 配置面板时，Chat ID 填你的个人 ID（不是 Bot 用户名）\n"
	msgText += "    群/频道 ID 格式为 -100xxxxxxxxxx"

	b.reply(msg.Chat.ChatID, msgText)
}

func (b *Bot) handleID(msg *messageData) {
	if msg.From == nil {
		return
	}

	myID := msg.From.UserID
	msgText := fmt.Sprintf(" <b>你的 Chat ID</b>\n<code>%d</code>\n\n", myID)
	msgText += "请将此 ID 填入 FLVX 面板的 Chat ID 输入框。\n\n"
	msgText += "💡 注意：Chat ID 不是 Bot 用户名。发送 /start 查看完整配置指南"

	b.reply(msg.Chat.ChatID, msgText)
}

func (b *Bot) BotUsername() string {
	b.mu.RLock()
	token := b.token
	b.mu.RUnlock()

	if token == "" {
		return ""
	}

	apiURL := fmt.Sprintf("%s/bot%s/getMe", apiBaseURL, token)
	resp, err := b.client.http.Get(apiURL)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var apiResp struct {
		Ok     bool `json:"ok"`
		Result struct {
			Username string `json:"username"`
		} `json:"result"`
	}
	_ = json.Unmarshal(body, &apiResp)
	if apiResp.Ok {
		return apiResp.Result.Username
	}
	return ""
}

func (b *Bot) Stop() {
	b.mu.Lock()
	cancel := b.cancel
	b.cancel = nil
	b.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	b.mu.Lock()
	done := b.done
	b.mu.Unlock()

	if done != nil {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			log.Println("[telegram] bot stop timeout")
		}
	}
}

func (b *Bot) Running() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.cancel != nil
}
