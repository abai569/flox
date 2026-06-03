package handler

import (
	"database/sql"
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
	// Attach tunnel group IDs and normalize groupId to each package
	type PackageWithGroups struct {
		*model.SubscriptionPackage
		TunnelGroupIds []int64 `json:"tunnelGroupIds"`
		GroupId        *int64  `json:"groupId"`
	}
	result := make([]PackageWithGroups, len(items))
	for i, pkg := range items {
		tgIDs, _ := h.repo.GetPackageTunnelGroupIDs(pkg.ID)
		var gid *int64
		if pkg.GroupID.Valid {
			gid = &pkg.GroupID.Int64
		}
		result[i] = PackageWithGroups{
			SubscriptionPackage: pkg,
			TunnelGroupIds:      tgIDs,
			GroupId:             gid,
		}
	}
	response.WriteJSON(w, response.OK(result))
}

func (h *Handler) createPackage(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		Type                  string  `json:"type"`
		Name                  string  `json:"name"`
		Description           string  `json:"description"`
		PriceYuan             float64 `json:"priceYuan"`
		ValidityDays          int     `json:"validityDays"`
		TrafficLimit          int64   `json:"trafficLimit"`
		PortCount             int     `json:"portCount"`
		SpeedLimit            int     `json:"speedLimit"`
		MaxRules              int     `json:"maxRules"`
		MaxConnections        int     `json:"maxConnections"`
		MaxIPAccess           int     `json:"maxIPAccess"`
		AutoRenew             int     `json:"autoRenew"`
		SortOrder             int     `json:"sortOrder"`
		Enabled               int     `json:"enabled"`
		ShopVisible           int     `json:"shopVisible"`
		AutoBuyTrafficEnabled int     `json:"autoBuyTrafficEnabled"`
		Stock                 int64   `json:"stock"`
		Recommended           int     `json:"recommended"`
		GroupID               *int64  `json:"groupId"`
		TunnelGroupIDs        []int64 `json:"tunnelGroupIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("套餐名称不能为空"))
		return
	}
	if req.Type == "" {
		req.Type = "subscription"
	}
	pkg := &model.SubscriptionPackage{
		Type:                  req.Type,
		Name:                  req.Name,
		Description:           req.Description,
		Price:                 int64(req.PriceYuan * 100),
		ValidityDays:          req.ValidityDays,
		TrafficLimit:          req.TrafficLimit,
		PortCount:             req.PortCount,
		SpeedLimit:            req.SpeedLimit,
		MaxRules:              req.MaxRules,
		MaxConnections:        req.MaxConnections,
		MaxIPAccess:           req.MaxIPAccess,
		AutoRenew:             req.AutoRenew,
		SortOrder:             req.SortOrder,
		Enabled:               req.Enabled,
		ShopVisible:           req.ShopVisible,
		AutoBuyTrafficEnabled: req.AutoBuyTrafficEnabled,
		Stock:                 req.Stock,
		Recommended:           req.Recommended,
	}
	if req.GroupID != nil {
		pkg.GroupID = sql.NullInt64{Int64: *req.GroupID, Valid: true}
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
		ID                    int64   `json:"id"`
		Type                  string  `json:"type"`
		Name                  string  `json:"name"`
		Description           string  `json:"description"`
		PriceYuan             float64 `json:"priceYuan"`
		ValidityDays          int     `json:"validityDays"`
		TrafficLimit          int64   `json:"trafficLimit"`
		PortCount             int     `json:"portCount"`
		SpeedLimit            int     `json:"speedLimit"`
		MaxRules              int     `json:"maxRules"`
		MaxConnections        int     `json:"maxConnections"`
		MaxIPAccess           int     `json:"maxIPAccess"`
		AutoRenew             int     `json:"autoRenew"`
		SortOrder             int     `json:"sortOrder"`
		Enabled               int     `json:"enabled"`
		ShopVisible           int     `json:"shopVisible"`
		AutoBuyTrafficEnabled int     `json:"autoBuyTrafficEnabled"`
		Stock                 int64   `json:"stock"`
		Recommended           int     `json:"recommended"`
		GroupID               *int64  `json:"groupId"`
		TunnelGroupIDs        []int64 `json:"tunnelGroupIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("套餐名称不能为空"))
		return
	}
	if req.Type == "" {
		req.Type = "subscription"
	}
	pkg := &model.SubscriptionPackage{
		ID:                    req.ID,
		Type:                  req.Type,
		Name:                  req.Name,
		Description:           req.Description,
		Price:                 int64(req.PriceYuan * 100),
		ValidityDays:          req.ValidityDays,
		TrafficLimit:          req.TrafficLimit,
		PortCount:             req.PortCount,
		SpeedLimit:            req.SpeedLimit,
		MaxRules:              req.MaxRules,
		MaxConnections:        req.MaxConnections,
		MaxIPAccess:           req.MaxIPAccess,
		AutoRenew:             req.AutoRenew,
		SortOrder:             req.SortOrder,
		Enabled:               req.Enabled,
		ShopVisible:           req.ShopVisible,
		AutoBuyTrafficEnabled: req.AutoBuyTrafficEnabled,
		Stock:                 req.Stock,
		Recommended:           req.Recommended,
	}
	if req.GroupID != nil {
		pkg.GroupID = sql.NullInt64{Int64: *req.GroupID, Valid: true}
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
	_ = h.repo.UpdatePackageAutoBuyTrafficEnabled(id, 0)
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) togglePackageAutoBuyTraffic(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		ID      int64 `json:"id"`
		Enabled int   `json:"enabled"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("套餐ID不能为空"))
		return
	}
	if req.Enabled != 0 && req.Enabled != 1 {
		response.WriteJSON(w, response.ErrDefault("invalid enabled value"))
		return
	}
	if err := h.repo.UpdatePackageAutoBuyTrafficEnabled(req.ID, req.Enabled); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) listAutoBuyTrafficPackages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	pkgs, err := h.repo.ListAutoBuyTrafficPackages()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if pkgs == nil {
		pkgs = []*model.SubscriptionPackage{}
	}
	response.WriteJSON(w, response.OK(pkgs))
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
	var gid *int64
	if pkg.GroupID.Valid {
		gid = &pkg.GroupID.Int64
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"package":        pkg,
		"tunnelGroupIds": tunnelGroupIDs,
		"groupId":        gid,
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
	quantity := asInt64(req["quantity"], 1)
	if quantity < 1 {
		quantity = 1
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
	if pkg.Type == "balance" && currency == "BALANCE" {
		response.WriteJSON(w, response.ErrDefault("余额类型套餐不能使用余额支付"))
		return
	}
	if pkg.Type != "balance" && quantity != 1 {
		response.WriteJSON(w, response.ErrDefault("非余额套餐不支持多份购买"))
		return
	}

	// Check stock: -1=unlimited, 0=sold out, >0=remaining
	if pkg.Stock != -1 {
		if pkg.Stock <= 0 {
			response.WriteJSON(w, response.ErrDefault("该套餐已售罄"))
			return
		}
		if pkg.Stock < quantity {
			response.WriteJSON(w, response.ErrDefault("库存不足"))
			return
		}
	}

	// Decrement stock atomically
	if err := h.repo.CheckAndDecrementStock(packageID, quantity); err != nil {
		response.WriteJSON(w, response.Err(-2, "库存扣减失败: "+err.Error()))
		return
	}

	var totalAmount int64
	if pkg.Type == "balance" {
		totalAmount = pkg.Price * quantity
	} else {
		totalAmount = pkg.Price
	}

	// Store pkg + quantity in ProductMeta
	metaObj := map[string]interface{}{
		"pkg":      pkg,
		"quantity": quantity,
	}
	meta, _ := json.Marshal(metaObj)
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
		Amount:      totalAmount,
		PayCurrency: currency,
		PayType:     asString(req["pay_type"]),
		PayNetwork:  asString(req["pay_network"]),
		Status:      0,
	}

	if currency == "BALANCE" {
		order.Status = 1
		order.PayTime = time.Now().Unix()

		if err := h.repo.CompletePackageOrder(userID, userName, order, pkg, tunnelGroupIDs, quantity); err != nil {
			response.WriteJSON(w, response.Err(-2, "套餐交付失败: "+err.Error()))
			return
		}

		response.WriteJSON(w, response.OK(map[string]interface{}{
			"orderId":  order.ID,
			"orderNo":  order.OrderNo,
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
		"orderId":  order.ID,
		"orderNo":  order.OrderNo,
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
	switch pkg.Type {
	case "balance":
		if err := h.repo.DeliverBalancePackageToUser(req.UserID, pkg.Price, pkg.Name, 0, 1); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	case "traffic":
		if err := h.repo.DeliverTrafficPackageToUser(req.UserID, pkg.TrafficLimit, pkg.Price, pkg.TrafficLimit, 1); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	default:
		if err := h.repo.DeliverPackageToUser(req.UserID, pkg, 0, tunnelGroupIDs); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
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
