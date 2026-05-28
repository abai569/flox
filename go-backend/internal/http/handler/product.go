package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
)

func (h *Handler) listPackages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "用户信息错误"))
		return
	}
	// Check store toggle for non-admin users
	if roleID != 0 {
		storeCfg, err := h.repo.GetConfigByName("store_enabled")
		if err == nil && storeCfg != nil && storeCfg.Value == "0" {
			response.WriteJSON(w, response.OK([]*model.SubscriptionPackage{}))
			return
		}
	}
	items, err := h.repo.ListPackages(roleID != 0)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if items == nil {
		items = []*model.SubscriptionPackage{}
	}
	// Attach tunnel group IDs to each package
	type PackageWithGroups struct {
		*model.SubscriptionPackage
		TunnelGroupIds []int64 `json:"tunnelGroupIds"`
	}
	result := make([]PackageWithGroups, len(items))
	for i, pkg := range items {
		tgIDs, _ := h.repo.GetPackageTunnelGroupIDs(pkg.ID)
		result[i] = PackageWithGroups{SubscriptionPackage: pkg, TunnelGroupIds: tgIDs}
	}
	response.WriteJSON(w, response.OK(result))
}

func (h *Handler) createPackage(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		Name           string  `json:"name"`
		Description    string  `json:"description"`
		PriceYuan      float64 `json:"priceYuan"`
		ValidityDays   int     `json:"validityDays"`
		TrafficLimit   int64   `json:"trafficLimit"`
		PortCount      int     `json:"portCount"`
		SpeedLimit     int     `json:"speedLimit"`
		MaxRules       int     `json:"maxRules"`
		MaxConnections int     `json:"maxConnections"`
		MaxIPAccess    int     `json:"maxIPAccess"`
		AutoRenew      int     `json:"autoRenew"`
		SortOrder      int     `json:"sortOrder"`
		Enabled        int     `json:"enabled"`
		ShopVisible    int     `json:"shopVisible"`
		TunnelGroupIDs []int64 `json:"tunnelGroupIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("套餐名称不能为空"))
		return
	}
	pkg := &model.SubscriptionPackage{
		Name:           req.Name,
		Description:    req.Description,
		Price:          int64(req.PriceYuan * 100),
		ValidityDays:   req.ValidityDays,
		TrafficLimit:   req.TrafficLimit,
		PortCount:      req.PortCount,
		SpeedLimit:     req.SpeedLimit,
		MaxRules:       req.MaxRules,
		MaxConnections: req.MaxConnections,
		MaxIPAccess:    req.MaxIPAccess,
		AutoRenew:      req.AutoRenew,
		SortOrder:      req.SortOrder,
		Enabled:        req.Enabled,
		ShopVisible:    req.ShopVisible,
	}
	if err := h.repo.CreatePackage(pkg, req.TunnelGroupIDs); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(pkg))
}

func (h *Handler) updatePackage(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		ID             int64   `json:"id"`
		Name           string  `json:"name"`
		Description    string  `json:"description"`
		PriceYuan      float64 `json:"priceYuan"`
		ValidityDays   int     `json:"validityDays"`
		TrafficLimit   int64   `json:"trafficLimit"`
		PortCount      int     `json:"portCount"`
		SpeedLimit     int     `json:"speedLimit"`
		MaxRules       int     `json:"maxRules"`
		MaxConnections int     `json:"maxConnections"`
		MaxIPAccess    int     `json:"maxIPAccess"`
		AutoRenew      int     `json:"autoRenew"`
		SortOrder      int     `json:"sortOrder"`
		Enabled        int     `json:"enabled"`
		ShopVisible    int     `json:"shopVisible"`
		TunnelGroupIDs []int64 `json:"tunnelGroupIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 || req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("参数错误"))
		return
	}
	pkg := &model.SubscriptionPackage{
		ID:             req.ID,
		Name:           req.Name,
		Description:    req.Description,
		Price:          int64(req.PriceYuan * 100),
		ValidityDays:   req.ValidityDays,
		TrafficLimit:   req.TrafficLimit,
		PortCount:      req.PortCount,
		SpeedLimit:     req.SpeedLimit,
		MaxRules:       req.MaxRules,
		MaxConnections: req.MaxConnections,
		MaxIPAccess:    req.MaxIPAccess,
		AutoRenew:      req.AutoRenew,
		SortOrder:      req.SortOrder,
		Enabled:        req.Enabled,
		ShopVisible:    req.ShopVisible,
	}
	if err := h.repo.UpdatePackage(pkg, req.TunnelGroupIDs); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) deletePackage(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	id := idFromBody(r, w)
	if id <= 0 {
		return
	}
	if err := h.repo.DeletePackage(id); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) getPackageDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	id := idFromBody(r, w)
	if id <= 0 {
		return
	}
	pkg, err := h.repo.GetPackageByID(id)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	tunnelGroupIDs, err := h.repo.GetPackageTunnelGroupIDs(id)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"package":         pkg,
		"tunnelGroupIds": tunnelGroupIDs,
	}))
}

func (h *Handler) createPackageOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	userID, userName := h.userNameFromRequest(r)
	if userID <= 0 {
		response.WriteJSON(w, response.Err(-2, "用户信息错误"))
		return
	}
	packageID := asInt64(req["package_id"], 0)
	if packageID <= 0 {
		response.WriteJSON(w, response.ErrDefault("套餐ID不能为空"))
		return
	}
	currency := strings.ToUpper(asString(req["pay_currency"]))
	if currency == "" {
		currency = "BALANCE"
	}
	if currency != "BALANCE" && currency != "USDT" && currency != "YIPAY" {
		response.WriteJSON(w, response.ErrDefault("不支持的支付方式"))
		return
	}
	pkg, err := h.repo.GetPackageByID(packageID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("套餐不存在"))
		return
	}
	if pkg.Enabled != 1 {
		response.WriteJSON(w, response.ErrDefault("套餐已停用"))
		return
	}
	meta, _ := json.Marshal(pkg)
	tunnelGroupIDs, err := h.repo.GetPackageTunnelGroupIDs(packageID)
	if err != nil {
		tunnelGroupIDs = nil
	}

	order := &model.Order{
		OrderNo:     fmt.Sprintf("PKG%d%d", time.Now().UnixMilli(), time.Now().Nanosecond()%10000),
		UserID:      userID,
		UserName:    userName,
		ProductID:   pkg.ID,
		ProductName: pkg.Name,
		ProductType: "package",
		ProductMeta: string(meta),
		Amount:      pkg.Price,
		PayCurrency: currency,
		Status:      0,
	}

	if currency == "BALANCE" {
		order.Status = 1
		order.PayTime = time.Now().Unix()

		if err := h.repo.CompletePackageOrder(userID, userName, order, pkg, tunnelGroupIDs); err != nil {
			response.WriteJSON(w, response.Err(-2, "套餐交付失败: "+err.Error()))
			return
		}

		response.WriteJSON(w, response.OK(map[string]interface{}{
			"order_id": order.ID,
			"order_no": order.OrderNo,
			"status":   order.Status,
			"amount":   order.Amount,
		}))
		return
	}

	if err := h.repo.CreateOrder(order); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"order_id": order.ID,
		"order_no": order.OrderNo,
		"status":   order.Status,
		"amount":   order.Amount,
	}))
}

func (h *Handler) assignPackageToUser(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		UserID    int64 `json:"userId"`
		PackageID int64 `json:"packageId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.UserID <= 0 || req.PackageID <= 0 {
		response.WriteJSON(w, response.ErrDefault("参数错误"))
		return
	}
	pkg, err := h.repo.GetPackageByID(req.PackageID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "套餐不存在"))
		return
	}
	tunnelGroupIDs, err := h.repo.GetPackageTunnelGroupIDs(req.PackageID)
	if err != nil {
		tunnelGroupIDs = nil
	}
	if err := h.repo.DeliverPackageToUser(req.UserID, pkg, 0, tunnelGroupIDs); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) getStoreStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	enabled := true
	cfg, err := h.repo.GetConfigByName("store_enabled")
	if err == nil && cfg != nil && cfg.Value == "0" {
		enabled = false
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"enabled": enabled,
	}))
}

func (h *Handler) setStoreStatus(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	value := "0"
	if req.Enabled {
		value = "1"
	}
	if err := h.repo.UpsertConfig("store_enabled", value, time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}
