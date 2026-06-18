package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/payment"
	"go-backend/internal/store/model"
)

func orderNo() string {
	ts := time.Now().UnixMilli()
	nonce := time.Now().Nanosecond() % 10000
	return fmt.Sprintf("FLVX%d%04d", ts, nonce)
}

func (h *Handler) createOrder(w http.ResponseWriter, r *http.Request) {
	response.WriteJSON(w, response.ErrDefault("商品系统已升级，请使用套餐系统"))
}

func (h *Handler) payOrder(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	orderID := asInt64(req["order_id"], 0)
	if orderID <= 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}

	order, err := h.repo.GetOrder(orderID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}
	if order.Status != 0 {
		response.WriteJSON(w, response.ErrDefault("订单状态异常"))
		return
	}
	if order.PayCurrency == "BALANCE" {
		response.WriteJSON(w, response.ErrDefault("余额订单无需支付"))
		return
	}

	gateway, err := payment.GetGateway(order.PayCurrency, h.repo)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	result, err := gateway.CreateInvoice(order)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	_ = h.repo.UpdateOrderPaymentInfo(order.ID, result.PayURL, result.PayAddress)

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"payUrl":      result.PayURL,
		"payAddress":  result.PayAddress,
		"payAmount":   result.PayAmount,
		"orderNo":     order.OrderNo,
	}))
}

func (h *Handler) listOrders(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	userID, _ := h.userNameFromRequest(r)
	if userID <= 0 {
		response.WriteJSON(w, response.Err(-2, "用户信息错误"))
		return
	}

	page := asInt(req["page"], 1)
	if page < 1 {
		page = 1
	}
	size := asInt(req["size"], 10)
	if size < 1 || size > 100 {
		size = 10
	}
	status := asInt(req["status"], -1)

	list, total, err := h.repo.ListOrders(userID, status, page, size)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.Order{}
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"list":  list,
		"total": total,
		"page":  page,
		"size":  size,
	}))
}

func (h *Handler) listAllOrders(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	page := asInt(req["page"], 1)
	if page < 1 {
		page = 1
	}
	size := asInt(req["size"], 10)
	if size < 1 || size > 100 {
		size = 10
	}
	status := asInt(req["status"], -1)
	keyword := asString(req["keyword"])

	list, total, err := h.repo.ListAllOrders(status, page, size, keyword)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.Order{}
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"list":  list,
		"total": total,
		"page":  page,
		"size":  size,
	}))
}

func (h *Handler) cancelOrder(w http.ResponseWriter, r *http.Request) {
	id := idFromBody(r, w)
	if id <= 0 {
		return
	}

	userID, _ := h.userNameFromRequest(r)
	if userID <= 0 {
		response.WriteJSON(w, response.Err(-2, "用户信息错误"))
		return
	}

	order, err := h.repo.GetOrder(id)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}
	if order.UserID != userID {
		response.WriteJSON(w, response.ErrDefault("无权操作此订单"))
		return
	}
	if order.Status != 0 {
		response.WriteJSON(w, response.ErrDefault("订单状态异常"))
		return
	}

	if err := h.repo.UpdateOrderStatus(id, 2); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) getOrderStatus(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	orderID := asInt64(req["order_id"], 0)
	if orderID <= 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}

	order, err := h.repo.GetOrder(orderID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"order_no":     order.OrderNo,
		"status":       order.Status,
		"pay_time":     order.PayTime,
		"pay_currency": order.PayCurrency,
		"tx_hash":      order.TxHash,
	}))
}

func (h *Handler) adminDeleteOrder(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		ID    int64 `json:"id"`
		Force bool  `json:"force"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}
	order, err := h.repo.GetOrder(req.ID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}
	if order.Status == 1 && !req.Force {
		response.WriteJSON(w, response.ErrDefault("已完成订单需确认强制删除"))
		return
	}
	if err := h.repo.DeleteOrder(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) adminUpdateOrder(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		ID          int64  `json:"id"`
		Status      *int   `json:"status"`
		Amount      *int64 `json:"amount"`
		PayTime     *int64 `json:"payTime"`
		PayCurrency string `json:"payCurrency"`
		ProductName string `json:"productName"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}
	updates := make(map[string]interface{})
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.Amount != nil {
		updates["amount"] = *req.Amount
	}
	if req.PayTime != nil {
		updates["pay_time"] = *req.PayTime
	}
	if req.PayCurrency != "" {
		updates["pay_currency"] = req.PayCurrency
	}
	if req.ProductName != "" {
		updates["product_name"] = req.ProductName
	}
	if len(updates) == 0 {
		response.WriteJSON(w, response.ErrDefault("无更新字段"))
		return
	}
	if err := h.repo.UpdateOrder(req.ID, updates); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) adminRefundOrder(w http.ResponseWriter, r *http.Request) {
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
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}

	order, err := h.repo.GetOrder(req.ID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}
	if order.Status != 1 {
		response.WriteJSON(w, response.ErrDefault("只有已完成订单才能退款"))
		return
	}

	now := time.Now().Unix()
	user, err := h.repo.GetUserByID(order.UserID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("用户不存在"))
		return
	}

	if err := h.repo.IncreaseUserBalance(order.UserID, order.Amount); err != nil {
		response.WriteJSON(w, response.Err(-2, "退款失败"))
		return
	}

	_ = h.repo.CreateBalanceLog(order.UserID, order.UserName, order.Amount,
		user.Balance, user.Balance+order.Amount,
		now, "订单退款")

	h.repo.TryAutoRenewForUser(order.UserID)
	_ = h.repo.UpdateUserForwardsStatus(order.UserID, 1, now)
	h.resumePausedForwardsByUser(order.UserID, now)

	// Reverse delivery by package type
	if order.ProductType == "package" {
		var metaObj map[string]interface{}
		if err := json.Unmarshal([]byte(order.ProductMeta), &metaObj); err == nil {
			var pkg model.SubscriptionPackage
			pkgData, _ := json.Marshal(metaObj["pkg"])
			_ = json.Unmarshal(pkgData, &pkg)
			qty := int64(1)
			if q, ok := metaObj["quantity"].(float64); ok && q > 0 {
				qty = int64(q)
			}
			switch pkg.Type {
			case "traffic":
				_ = h.repo.RefundTrafficPackage(order.UserID, pkg.TrafficLimit*qty)
			case "balance":
				// already refunded to balance above
			default: // subscription
				sub, err := h.repo.GetPackageSubscriptionByOrderID(order.ID)
				if err == nil && sub.Status == 1 {
					_ = h.repo.ExpirePackageSubscription(sub.ID)
					_ = h.repo.ResetUserPackageQuotas(order.UserID)
				}
			}
			// Restore stock
			_ = h.repo.RestorePackageStock(pkg.ID, qty)
		}
	}

	if err := h.repo.UpdateOrderStatus(req.ID, 3); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) adminCompleteOrder(w http.ResponseWriter, r *http.Request) {
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
		response.WriteJSON(w, response.ErrDefault("订单ID不能为空"))
		return
	}
	order, err := h.repo.GetOrder(req.ID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("订单不存在"))
		return
	}
	if order.Status != 0 {
		response.WriteJSON(w, response.ErrDefault("只有待支付订单才能补单"))
		return
	}
	h.completePayment(order.OrderNo, "")
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) adminBatchCompleteOrders(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if len(req.IDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID列表不能为空"))
		return
	}
	success := 0
	skipped := 0
	for _, id := range req.IDs {
		order, err := h.repo.GetOrder(id)
		if err != nil || order.Status != 0 {
			skipped++
			continue
		}
		h.completePayment(order.OrderNo, "")
		success++
	}
	response.WriteJSON(w, response.OK(map[string]int{
		"success": success,
		"skipped": skipped,
	}))
}

func (h *Handler) adminBatchRefundOrders(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if len(req.IDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID列表不能为空"))
		return
	}
	success := 0
	skipped := 0
	for _, id := range req.IDs {
		order, err := h.repo.GetOrder(id)
		if err != nil || order.Status != 1 {
			skipped++
			continue
		}
		now := time.Now().Unix()
		user, err := h.repo.GetUserByID(order.UserID)
		if err != nil {
			skipped++
			continue
		}
		if err := h.repo.IncreaseUserBalance(order.UserID, order.Amount); err != nil {
			skipped++
			continue
		}
		_ = h.repo.CreateBalanceLog(order.UserID, order.UserName, order.Amount,
			user.Balance, user.Balance+order.Amount, now, "订单退款")
		h.repo.TryAutoRenewForUser(order.UserID)
		if order.ProductType == "package" {
			var metaObj map[string]interface{}
			if err := json.Unmarshal([]byte(order.ProductMeta), &metaObj); err == nil {
				var pkg model.SubscriptionPackage
				pkgData, _ := json.Marshal(metaObj["pkg"])
				_ = json.Unmarshal(pkgData, &pkg)
				qty := int64(1)
				if q, ok := metaObj["quantity"].(float64); ok && q > 0 {
					qty = int64(q)
				}
				switch pkg.Type {
				case "traffic":
					_ = h.repo.RefundTrafficPackage(order.UserID, pkg.TrafficLimit*qty)
				case "balance":
				default:
					sub, err := h.repo.GetPackageSubscriptionByOrderID(order.ID)
					if err == nil && sub.Status == 1 {
						_ = h.repo.ExpirePackageSubscription(sub.ID)
						_ = h.repo.ResetUserPackageQuotas(order.UserID)
					}
				}
				_ = h.repo.RestorePackageStock(pkg.ID, qty)
			}
		}
		_ = h.repo.UpdateOrderStatus(id, 3)
		success++
	}
	response.WriteJSON(w, response.OK(map[string]int{
		"success": success,
		"skipped": skipped,
	}))
}

func (h *Handler) adminBatchDeleteOrders(w http.ResponseWriter, r *http.Request) {
	if !h.ensureAdminAccess(w, r) {
		return
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if len(req.IDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("订单ID列表不能为空"))
		return
	}
	success := 0
	for _, id := range req.IDs {
		if err := h.repo.DeleteOrder(id); err == nil {
			success++
		}
	}
	response.WriteJSON(w, response.OK(map[string]int{
		"success": success,
	}))
}

func (h *Handler) userNameFromRequest(r *http.Request) (int64, string) {
	uid, roleID, err := userRoleFromRequest(r)
	if err != nil {
		return 0, ""
	}
	user, _ := h.repo.GetUserByID(uid)
	if user == nil {
		return uid, ""
	}
	if roleID == 0 {
		return uid, user.Name
	}
	return uid, user.User
}
