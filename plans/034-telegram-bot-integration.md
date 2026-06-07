# 034 Telegram Bot Integration

## Overview

Add Telegram Bot push notification capability to FLVX panel. The bot connects to Telegram via long-polling (no webhook), sends alert notifications for key system events, and is configurable through a dedicated admin page.

## Free Tier Restriction

On **TierFree**, the Telegram Bot is fully disabled:

- **Frontend**: `/admin/telegram` page — all `Input`/`Switch`/`Button` receive `isDisabled`, top yellow banner shown
  - Sidebar footer text updated to: `免费版：5 节点 / 5 隧道 / 1 用户，禁用商城系统/TG机器人`
  - Config page license status text updated to: `免费版（5 节点 / 5 隧道 / 1 用户，禁用商城系统/TG机器人）`
- **Backend** `/api/v1/telegram/test`: returns `code=403, msg="免费版不支持 Telegram Bot，请配置正式授权"`
- **Backend** Bot loop: goroutine not started when tier is free; if tier transitions to free while running, `Stop()` is called
- **Backend** `notifier.go`: every `Send*` call checks tier, skips silently if free

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ go-backend                                              │
│                                                         │
│  ┌─────────────────┐   ┌──────────────────────────┐    │
│  │   Handler        │   │  Telegram Bot             │    │
│  │   (HTTP API)     │──▶│  (internal/telegram/)     │    │
│  │                  │   │  ┌────────────────────┐   │    │
│  │  /api/v1/        │   │  │ bot.go             │   │    │
│  │  telegram/       │   │  │  - Init / Run      │   │    │
│  │  test            │   │  │  - Long-poll loop   │   │    │
│  └────────┬─────────┘   │  │  - Shutdown         │   │    │
│           │             │  ├────────────────────┤   │    │
│           │             │  │ notifier.go         │   │    │
│           │             │  │  - SendMessage      │   │    │
│           │             │  │  - SendAlert        │   │    │
│           │             │  │  - SendTest         │   │    │
│           │             │  └────────────────────┘   │    │
│           │             └──────────────────────────┘    │
│           │                         ▲                   │
│           │                         │                   │
│  ┌────────▼─────────────────────────┴──────────────┐   │
│  │  Event Hooks                                    │   │
│  │  - NodeOnlineHook (ws/server.go)               │   │
│  │  - Node disconnect (ws/server.go)              │   │
│  │  - ServiceMonitor failure (monitoring.go)      │   │
│  │  - Daily maintenance (jobs.go)                 │   │
│  │  - System event (upgrade/restart)              │   │
│  └────────────────────────────────────────────────┘   │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │  Config (vite_config)                          │    │
│  │  telegram_bot_token  - Bot Token               │    │
│  │  telegram_chat_id    - Target Chat ID          │    │
│  │  telegram_enabled    - On/Off                  │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ vite-frontend                            │
│  /admin/telegram  - Telegram 配置页       │
│  ┌─────────────────────────────────┐     │
│  │ - Bot Token 输入框              │     │
│  │ - Chat ID 输入框                │     │
│  │ - 启用/禁用开关                  │     │
│  │ - 测试连接按钮                   │     │
│  │ - 状态显示（Bot 运行状态）         │     │
│  └─────────────────────────────────┘     │
└─────────────────────────────────────────┘
```

## Tasks

### Plan Document

- [x] Create plan document with free tier restriction

### Backend

- [ ] **1. Add Go dependency**: `github.com/go-telegram-bot-api/telegram-bot-api/v5`

- [ ] **2. Create `internal/telegram/bot.go`**
  - `Bot` struct: `token`, `chatID`, `enabled`, `api`, `cancel`, `done`
  - `New(token string) *Bot`
  - `Start(ctx)` — launches long-poll goroutine, checks tier
  - `Stop()` — cancels context, waits for done
  - Polling: `GetUpdatesChan` with configurable timeout, log unknown messages

- [ ] **3. Create `internal/telegram/notifier.go`**
  - `SendMessage(chatID int64, text string) error`
  - `SendAlert(title, message string)` — formatted alert with emoji prefix
  - `SendTest() error` — sends a test message to configured chat
  - All methods skip if `!enabled` or missing token/chatID or tier is free
  - Rate limiting: `time.NewTicker(50 * time.Millisecond)` (20 msg/s Telegram limit)

- [ ] **4. Wire config into `Handler`**
  - Add `TelegramBot *telegram.Bot` field to `Handler` struct
  - Load config from `vite_config` in `handler.New()`
  - Watch config changes: when `telegram_bot_token`, `telegram_chat_id`, `telegram_enabled` are updated, restart bot if needed

- [ ] **5. Create `internal/http/handler/admin_telegram.go`**
  - `POST /api/v1/telegram/test` — trigger test notification
  - Check tier first, return 403 if free

- [ ] **6. Add background job in `jobs.go`**
  - `runTelegramBotLoop(ctx)` — starts/stops the bot based on config + tier
  - Increment `jobsWG.Add(1)` → `jobsWG.Add(11)` in `StartBackgroundJobs()`

- [ ] **7. Hook into Node online/offline events (`ws/server.go`)**
  - In `onNodeOnline` hook: `SendAlert("🟢 节点上线", "节点 {name} 已连接")`
  - In disconnect handler: `SendAlert("🔴 节点离线", "节点 {name} 已断开")`

- [ ] **8. Hook into Service Monitor failures (`internal/monitoring/checker.go`)**
  - On state transition (success→fail): `SendAlert("⚠️ 监控告警", "{target} 检测失败: {error}")`
  - On recovery (fail→success): `SendAlert("✅ 监控恢复", "{target} 已恢复")`

- [ ] **9. Hook into Daily Maintenance (`jobs.go`)**
  - After disabling expired users: batch `SendAlert("⏰ 用户到期", "用户 {name} 已过期禁用")`
  - When nodes expire: `SendAlert("⏰ 节点到期", "节点 {name} 已到期")`
  - Traffic threshold in `runAutoBuyTrafficLoop`: `SendAlert("📊 流量告警", "用户 {name} 流量使用已达 {pct}%")`

- [ ] **10. System upgrade/restart notification**
  - In `StartBackgroundJobs()` on first run: `SendAlert("🚀 面板启动", "FLVX 面板已启动")`
  - In upgrade handler: `SendAlert("🔄 系统升级", "面板正在升级到版本 {v}")`

### Frontend

- [ ] **11. Update free tier text (3 locations)**
  - `src/layouts/admin.tsx:1115`: append `/TG机器人`
  - `src/layouts/h5.tsx:553`: append `/TG机器人`
  - `src/pages/config.tsx:1404`: append `/TG机器人`

- [ ] **12. Create `/admin/telegram` page (`src/pages/admin-telegram.tsx`)**
  - Form fields for Bot Token, Chat ID
  - Enable/disable switch
  - Test connection button
  - All controls `isDisabled={licenseInfo?.tier === "free"}`
  - Yellow warning banner when free tier
  - Status indicator (disabled / running / error)

- [ ] **13. Add API wrappers (`src/api/index.ts`)**
  - `getTelegramConfig()` → `Network.post("/config/list")` filtered
  - `updateTelegramConfig(token, chatID, enabled)` → `Network.post("/config/update-single", ...)`
  - `testTelegram()` → `Network.post("/telegram/test")`

- [ ] **14. Add sidebar menu (`src/layouts/admin.tsx`)**
  - New entry: `{path:"/admin/telegram", label:"Telegram", adminOnly:true}`

- [ ] **15. Add route (`src/App.tsx`)**
  - Import + Route for `/admin/telegram`

### Verification

- [ ] **16. Verify**: `go build ./...` in go-backend
- [ ] **17. Verify**: `npm run build` in vite-frontend

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Telegram library | `go-telegram-bot-api/v5` | De facto standard, long-polling support, well-maintained |
| Polling vs Webhook | Long-polling | No public HTTPS endpoint needed; works behind NAT |
| Config storage | `vite_config` table | Reuses existing key-value store, no DB migration |
| Bot lifecycle | Background goroutine in jobs | Consistent with existing pattern (`StartBackgroundJobs`) |
| Hook wiring | Direct function calls | Simple, no event bus overhead |
| Rate limiting | 50ms ticker | Telegram limit is ~30msg/s; 20msg/s is safe |
| State tracking | Compare previous result | Only notify on state transition (up→down, down→up) |
| Free tier enforcement | Multi-layer (UI + API + goroutine + notifier) | Defense in depth |

## Anti-Patterns (DO NOT)

- DO NOT store bot token in code or env vars — must be runtime configurable
- DO NOT add webhook server/endpoint — use long-polling only
- DO NOT block the event loop on send — async sends with error logging
- DO NOT expose bot token in frontend responses
- DO NOT add non-Telegram notification channels in this PR
