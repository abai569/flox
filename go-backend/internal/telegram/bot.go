package telegram

import (
	"context"
	"log"
	"sync"
	"time"
)

type Bot struct {
	token   string
	chatID  string
	enabled bool

	apiURL string
	client *client

	mu     sync.RWMutex
	cancel context.CancelFunc
	done   chan struct{}
}

func New(token, chatID string, enabled bool) *Bot {
	return &Bot{
		token:   token,
		chatID:  chatID,
		enabled: enabled,
		apiURL:  "https://api.telegram.org",
		client:  newClient(),
		done:    make(chan struct{}),
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
		b.mu.Unlock()
		return
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

	log.Println("[telegram] bot started")
	<-ctx.Done()
	log.Println("[telegram] bot stopped")
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
		}
	}
}

func (b *Bot) Running() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.cancel != nil
}
