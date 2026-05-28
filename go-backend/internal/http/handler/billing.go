package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
)

// ─── RedeemCode ──────────────────────────────────────────────────────

func (h *Handler) createRedeemCodes(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type        string `json:"type"`  // plan / balance
		Code        string `json:"code"`
		Count       int    `json:"count"`
		PlanID      *int64 `json:"planId"`
		DurationDays *int   `json:"durationDays"`
		AmountCents *int64 `json:"amountCents"`
		StartsAt    *int64 `json:"startsAt"`
		ExpiresAt   *int64 `json:"expiresAt"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	count := req.Count
	if count < 1 {
		count = 1
	}
	if count > 500 {
		count = 500
	}
	codes := make([]*model.RedeemCode, 0, count)
	firstCode := req.Code
	for i := 0; i < count; i++ {
		code := firstCode
		if i > 0 || code == "" {
			code = ""
		}
		codes = append(codes, &model.RedeemCode{
			Code:         code,
			Type:         req.Type,
			PlanID:       req.PlanID,
			DurationDays: req.DurationDays,
			AmountCents:  req.AmountCents,
			IsActive:     1,
			StartsAt:     req.StartsAt,
			ExpiresAt:    req.ExpiresAt,
		})
	}
	if err := h.repo.CreateRedeemCodes(codes); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"codes": codes,
	}))
}

func (h *Handler) listRedeemCodes(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.ListRedeemCodes()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.RedeemCode{}
	}
	response.WriteJSON(w, response.OK(list))
}

func (h *Handler) deleteRedeemCode(w http.ResponseWriter, r *http.Request) {
	id := idFromBody(r, w)
	if id <= 0 {
		return
	}
	if err := h.repo.DeleteRedeemCode(id); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

// ─── DiscountCode ────────────────────────────────────────────────────

func (h *Handler) createDiscountCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code        string  `json:"code"`
		Type        string  `json:"type"`     // percent / amount
		Value       float64 `json:"value"`    // 百分比数值或金额(元)
		MaxUses     int     `json:"maxUses"`
		PlanIDs     []int64 `json:"planIds"`
		StartsAt    *int64  `json:"startsAt"`
		ExpiresAt   *int64  `json:"expiresAt"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	value := int64(req.Value)
	if req.Type == "amount" {
		value = int64(req.Value * 100) // 元转分
	}

	planIDs := ""
	if len(req.PlanIDs) > 0 {
		b, _ := json.Marshal(req.PlanIDs)
		planIDs = string(b)
	}

	dc := &model.DiscountCode{
		Code:      req.Code,
		Type:      req.Type,
		Value:     value,
		MaxUses:   req.MaxUses,
		PlanIDs:   planIDs,
		IsActive:  1,
		StartsAt:  req.StartsAt,
		ExpiresAt: req.ExpiresAt,
	}
	if err := h.repo.CreateDiscountCode(dc); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(dc))
}

func (h *Handler) listDiscountCodes(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.ListDiscountCodes()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.DiscountCode{}
	}
	response.WriteJSON(w, response.OK(list))
}

func (h *Handler) deleteDiscountCode(w http.ResponseWriter, r *http.Request) {
	id := idFromBody(r, w)
	if id <= 0 {
		return
	}
	if err := h.repo.DeleteDiscountCode(id); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

// ─── BalanceLog ──────────────────────────────────────────────────────

func (h *Handler) listBalanceLogs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID int64 `json:"userId"`
		Page   int   `json:"page"`
		Size   int   `json:"size"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		req.Page = 1
		req.Size = 50
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.Size < 1 || req.Size > 200 {
		req.Size = 50
	}

	list, total, err := h.repo.ListAllBalanceLogs(req.UserID, req.Page, req.Size)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.BalanceLog{}
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"list":  list,
		"total": total,
		"page":  req.Page,
		"size":  req.Size,
	}))
}

func (h *Handler) adminDeleteBalanceLog(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
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
		response.WriteJSON(w, response.ErrDefault("流水ID不能为空"))
		return
	}
	if err := h.repo.DeleteBalanceLog(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) adminCleanupBalanceLogs(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	count, err := h.repo.CleanupInvalidBalanceLogs()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"deleted": count,
	}))
}

// ─── Feature Status ───────────────────────────────────────────────────

func (h *Handler) getBillingFeatureStatus(w http.ResponseWriter, r *http.Request) {
	redemptionEnabled := 1
	discountEnabled := 1

	if v, err := h.repo.GetSystemSetting("billing_redemption_enabled"); err == nil && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			redemptionEnabled = n
		}
	}
	if v, err := h.repo.GetSystemSetting("billing_discount_enabled"); err == nil && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			discountEnabled = n
		}
	}

	response.WriteJSON(w, response.OK(map[string]int{
		"redemptionEnabled": redemptionEnabled,
		"discountEnabled":   discountEnabled,
	}))
}

func (h *Handler) setBillingFeatureStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RedemptionEnabled *int `json:"redemptionEnabled"`
		DiscountEnabled   *int `json:"discountEnabled"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.RedemptionEnabled != nil {
		_ = h.repo.SetSystemSetting("billing_redemption_enabled", strconv.Itoa(*req.RedemptionEnabled))
	}
	if req.DiscountEnabled != nil {
		_ = h.repo.SetSystemSetting("billing_discount_enabled", strconv.Itoa(*req.DiscountEnabled))
	}

	response.WriteJSON(w, response.OKEmpty())
}
