package handler

import (
	"net/http"

	"go-backend/internal/health"
	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
	"go-backend/internal/telegram"
)

func (h *Handler) telegramTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.Err(405, "method not allowed"))
		return
	}

	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "免费版不支持 Telegram Bot，请配置正式授权"))
		return
	}

	bot := h.TelegramBot()
	if bot == nil {
		response.WriteJSON(w, response.Err(500, "Telegram Bot 未初始化"))
		return
	}

	if err := bot.SendTest(); err != nil {
		response.WriteJSON(w, response.Err(500, "发送测试消息失败: "+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(nil))
}

func (h *Handler) onServiceMonitorResult(m *model.ServiceMonitor, result *model.ServiceMonitorResult) {
	bot := h.TelegramBot()
	if bot == nil || !bot.Enabled() || !bot.Running() {
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierFree {
		return
	}

	monitors, err := h.repo.ListEnabledServiceMonitors()
	if err != nil {
		return
	}

	var matched *model.ServiceMonitor
	for i := range monitors {
		if monitors[i].ID == m.ID {
			matched = &monitors[i]
			break
		}
	}
	if matched == nil {
		return
	}

	target := matched.Target
	if target == "" {
		target = matched.Name
	}

	if result.Success == 0 {
		errMsg := result.ErrorMessage
		if errMsg == "" {
			errMsg = "未知错误"
		}
		bot.SendMonitorAlert(target, errMsg)
	} else {
		bot.SendMonitorRecovery(target)
	}
}

func (h *Handler) sendBotNotification(fn func(bot *telegram.Bot)) {
	if h == nil {
		return
	}
	bot := h.TelegramBot()
	if bot == nil || !bot.Enabled() || !bot.Running() {
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierFree {
		return
	}
	fn(bot)
}

var _ = health.OnResultFunc(nil)
var _ = model.ServiceMonitor{}
