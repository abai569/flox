package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
	"go-backend/internal/telegram"
)

func isUserQuotaExceeded(view *model.UserQuotaView) bool {
	if view == nil {
		return false
	}
	if view.DailyLimitGB > 0 && view.DailyUsedBytes >= view.DailyLimitGB*bytesPerGB {
		return true
	}
	if view.MonthlyLimitGB > 0 && view.MonthlyUsedBytes >= view.MonthlyLimitGB*bytesPerGB {
		return true
	}
	return false
}

func (h *Handler) userQuotaBlockReason(userID int64, now int64) (string, error) {
	if h == nil || h.repo == nil || userID <= 0 {
		return "", nil
	}
	quota, err := h.repo.GetUserQuotaView(userID, time.UnixMilli(now))
	if err != nil || quota == nil {
		return "", err
	}
	if quota.DisabledByQuota == 1 || isUserQuotaExceeded(quota) {
		return "该用户流量配额已超额，禁止开启转发", nil
	}
	return "", nil
}

func (h *Handler) enforceUserQuotaIfNeeded(userID int64, quota *model.UserQuotaView) {
	if h == nil || h.repo == nil || userID <= 0 || quota == nil {
		return
	}
	if quota.DisabledByQuota == 1 || !isUserQuotaExceeded(quota) {
		return
	}

	forwards, err := h.listActiveForwardsByUser(userID)
	if err != nil {
		return
	}
	pausedIDs := make([]int64, 0, len(forwards))
	now := time.Now().UnixMilli()
	for i := range forwards {
		forward := &forwards[i]
		if forward.Status != 1 {
			continue
		}
		if strings.EqualFold(forward.Mode, "nftables") {
			ports, _ := h.listForwardPorts(forward.ID)
			_ = h.deleteNftablesRules(forward, ports)
		} else {
			if err := h.controlForwardServices(forward, "PauseService", false); err != nil {
				continue
			}
		}
		if err := h.repo.UpdateForwardStatus(forward.ID, 0, now); err != nil {
			continue
		}
		pausedIDs = append(pausedIDs, forward.ID)
	}
	_ = h.repo.MarkUserQuotaDisabled(userID, pausedIDs, now)
}

func (h *Handler) applyUserQuotaRelease(release *repo.UserQuotaRelease, now int64) {
	if h == nil || h.repo == nil || release == nil || release.UserID <= 0 || !release.UnblockUser {
		return
	}
	for _, forwardID := range release.ForwardIDs {
		forward, err := h.getForwardRecord(forwardID)
		if err != nil || forward == nil {
			continue
		}
		if err := h.ensureUserTunnelForwardAllowed(forward.UserID, forward.TunnelID, now); err != nil {
			continue
		}
		if strings.EqualFold(forward.Mode, "nftables") {
			_ = h.syncForwardServices(forward, "UpdateService", true)
		} else {
			if err := h.controlForwardServices(forward, "ResumeService", false); err != nil {
				continue
			}
		}
		_ = h.repo.UpdateForwardStatus(forwardID, 1, now)
	}
}

func (h *Handler) resetUserQuotaWindows(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}
	releases, err := h.repo.RollUserQuotaWindows(now, "自动周期归零")
	if err != nil {
		return
	}
	nowMs := now.UnixMilli()
	for i := range releases {
		h.applyUserQuotaRelease(&releases[i], nowMs)
	}
}

func (h *Handler) userQuotaReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	var req struct {
		UserID int64  `json:"userId"`
		Scope  string `json:"scope"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("用户ID不能为空"))
		return
	}
	release, err := h.repo.ResetUserQuotaUsage(req.UserID, req.Scope, time.Now(), "管理员手动归零")
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	nowMs := time.Now().UnixMilli()
	h.applyUserQuotaRelease(release, nowMs)

	user, _ := h.repo.GetUserByID(req.UserID)
	if user != nil {
		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendUserFlowReset(user.User)
		})
	}

	response.WriteJSON(w, response.OKEmpty())
}

// userQuotaHistory 获取用户流量历史记录
func (h *Handler) userQuotaHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求方法错误"))
		return
	}
	
	var req struct {
		UserID int64 `json:"userId"`
		Limit  int   `json:"limit"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("用户 ID 不能为空"))
		return
	}
	if req.Limit <= 0 {
		req.Limit = 50
	}
	if req.Limit > 200 {
		req.Limit = 200
	}
	
	histories, err := h.repo.GetUserQuotaHistory(req.UserID, req.Limit)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	
	response.WriteJSON(w, response.OK(histories))
}

// userQuotaHistoryDelete 删除用户流量历史记录
func (h *Handler) userQuotaHistoryDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求方法错误"))
		return
	}
	
	var req struct {
		ID int64 `json:"id"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("历史记录 ID 不能为空"))
		return
	}
	
	if err := h.repo.DeleteUserQuotaHistory(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	
	response.WriteJSON(w, response.OKEmpty())
}

type userRenewalLogsRequest struct {
	UserID int64 `json:"userId"`
	Limit  int   `json:"limit"`
}

func (h *Handler) userRenewalLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req userRenewalLogsRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.UserID <= 0 {
		response.WriteJSON(w, response.ErrDefault("用户 ID 不能为空"))
		return
	}

	limit := 50
	if req.Limit > 0 {
		limit = req.Limit
	}

	logs, err := h.repo.GetUserRenewalLogs(req.UserID, limit)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(logs))
}

func (h *Handler) deleteUserRenewalLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("日志 ID 不能为空"))
		return
	}
	if err := h.repo.DeleteUserRenewalLog(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) ensureUserForwardAllowedByQuota(userID int64, now int64) error {
	reason, err := h.userQuotaBlockReason(userID, now)
	if err != nil {
		return err
	}
	if reason != "" {
		return errors.New(reason)
	}
	return nil
}
