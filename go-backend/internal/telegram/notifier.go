package telegram

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

type client struct {
	http   *http.Client
	ticker *time.Ticker
	mu     sync.Mutex
}

func newClient() *client {
	return &client{
		http:   &http.Client{Timeout: 10 * time.Second},
		ticker: time.NewTicker(70 * time.Millisecond),
	}
}

type sendMessageReq struct {
	ChatID    string `json:"chat_id"`
	Text      string `json:"text"`
	ParseMode string `json:"parse_mode,omitempty"`
}

type sendMessageResp struct {
	Ok          bool   `json:"ok"`
	Description string `json:"description,omitempty"`
}

func (b *Bot) sendMessage(text string) error {
	b.mu.RLock()
	token := b.token
	chatID := b.chatID
	enabled := b.enabled
	b.mu.RUnlock()

	if token == "" || chatID == "" || !enabled {
		return nil
	}

	b.client.mu.Lock()
	<-b.client.ticker.C
	b.client.mu.Unlock()

	body, _ := json.Marshal(sendMessageReq{
		ChatID:    chatID,
		Text:      text,
		ParseMode: "HTML",
	})

	url := fmt.Sprintf("%s/bot%s/sendMessage", b.apiURL, token)
	resp, err := b.client.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("telegram send failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var result sendMessageResp
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Errorf("telegram decode response: %w", err)
	}
	if !result.Ok {
		return fmt.Errorf("telegram API error: %s", result.Description)
	}
	return nil
}

func (b *Bot) SendAlert(title, message string) {
	text := fmt.Sprintf("<b>%s</b>\n%s", escapeHTML(title), escapeHTML(message))
	if err := b.sendMessage(text); err != nil {
		log.Printf("[telegram] SendAlert failed: %v", err)
	}
}

func (b *Bot) SendTest() error {
	text := "<b>✅ 测试消息</b>\nTelegram Bot 配置正确，消息推送正常"
	return b.sendMessage(text)
}

func (b *Bot) SendNodeOnline(nodeName string) {
	b.SendAlert("🟢 节点上线", fmt.Sprintf("节点 %s 已连接", nodeName))
}

func (b *Bot) SendNodeOffline(nodeName string) {
	b.SendAlert("🔴 节点离线", fmt.Sprintf("节点 %s 已断开", nodeName))
}

func (b *Bot) SendMonitorAlert(target, errMsg string) {
	b.SendAlert("⚠️ 监控告警", fmt.Sprintf("%s 检测失败: %s", target, errMsg))
}

func (b *Bot) SendMonitorRecovery(target string) {
	b.SendAlert("✅ 监控恢复", fmt.Sprintf("%s 已恢复", target))
}

func (b *Bot) SendUserExpired(userName string) {
	b.SendAlert("⏰ 用户到期", fmt.Sprintf("用户 %s 已过期禁用", userName))
}

func (b *Bot) SendNodeExpired(nodeName string) {
	b.SendAlert("⏰ 节点到期", fmt.Sprintf("节点 %s 已到期", nodeName))
}
func (b *Bot) SendNodeExpirySoon(nodeName string, daysLeft int) {
	b.SendAlert(" 节点即将到期", fmt.Sprintf("节点 %s 将在 %d 天后到期，请及时续费", nodeName, daysLeft))
}


func (b *Bot) SendTrafficAlert(userName string, pct float64) {
	b.SendAlert("📊 流量告警", fmt.Sprintf("用户 %s 流量使用已达 %.0f%%", userName, pct))
}

func (b *Bot) SendSystemStartup(version string) {
	b.SendAlert("🚀 面板启动", fmt.Sprintf("FLVX 面板已启动 (版本 %s)", version))
}

func (b *Bot) SendSystemUpgrade(version string) {
	b.SendAlert("🔄 系统升级", fmt.Sprintf("面板正在升级到版本 %s", version))
}

func (b *Bot) SendNodeTrafficReset(nodeName string, reason string) {
	b.SendAlert("📊 节点流量归零", fmt.Sprintf("节点 %s 流量已归零%s", nodeName, suffixReason(reason)))
}

func (b *Bot) SendForwardTrafficReset(forwardName, userName string) {
	b.SendAlert("📊 转发流量归零", fmt.Sprintf("转发规则 %s（用户 %s）流量已归零", forwardName, userName))
}

func (b *Bot) SendUserFlowReset(userName string) {
	b.SendAlert("📊 用户流量归零", fmt.Sprintf("用户 %s 流量已归零", userName))
}

func suffixReason(reason string) string {
	if reason == "" {
		return ""
	}
	return "（" + reason + "）"
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}
