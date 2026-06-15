package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/payment"
	"go-backend/internal/store/model"
)

func (h *Handler) paymentStats(w http.ResponseWriter, r *http.Request) {
	paidAmount, paidOrders, pendingOrders, err := h.repo.GetPaymentStats()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]int64{
		"paidAmount":    paidAmount,
		"paidOrders":    paidOrders,
		"pendingOrders": pendingOrders,
	}))
}

func (h *Handler) listAllPaymentConfigs(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.ListPaymentConfigs()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.PaymentConfig{}
	}
	response.WriteJSON(w, response.OK(list))
}

func (h *Handler) deletePaymentConfig(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	channel := asString(req["channel"])
	if channel == "" {
		response.WriteJSON(w, response.ErrDefault("支付渠道不能为空"))
		return
	}

	if err := h.repo.DeletePaymentConfig(channel); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) yipayCallback(w http.ResponseWriter, r *http.Request) {
	gateway, err := payment.GetGateway("YIPAY", h.repo)
	if err != nil {
		http.Error(w, "gateway not configured", http.StatusInternalServerError)
		return
	}

	orderNo, txHash, err := gateway.VerifyCallback(r)
	if err != nil {
		http.Error(w, "verify failed", http.StatusForbidden)
		return
	}

	h.completePayment(orderNo, txHash)
	io.WriteString(w, "success")
}

func (h *Handler) usdtCallback(w http.ResponseWriter, r *http.Request) {
	log.Printf("[usdtCallback] request received from %s, method=%s", r.RemoteAddr, r.Method)

	gateway, err := payment.GetGateway("USDT", h.repo)
	if err != nil {
		log.Printf("[usdtCallback] gateway error: %v", err)
		http.Error(w, "gateway not configured", http.StatusInternalServerError)
		return
	}

	orderNo, txHash, err := gateway.VerifyCallback(r)
	if err != nil {
		log.Printf("[usdtCallback] verify failed: %v", err)
		http.Error(w, "verify failed", http.StatusForbidden)
		return
	}

	log.Printf("[usdtCallback] verified: order=%s, txHash=%s", orderNo, txHash)
	h.completePayment(orderNo, txHash)
	io.WriteString(w, "success")
}

func (h *Handler) completePayment(orderNo, txHash string) {
	log.Printf("[completePayment] processing order=%s, txHash=%s", orderNo, txHash)

	order, err := h.repo.GetOrderByNo(orderNo)
	if err != nil {
		log.Printf("[completePayment] order not found: %s, err=%v", orderNo, err)
		return
	}
	if order.Status != 0 {
		log.Printf("[completePayment] order %s already processed, status=%d", orderNo, order.Status)
		return
	}

	if err := h.repo.UpdateOrderStatus(order.ID, 1); err != nil {
		log.Printf("[completePayment] update status failed for order %s: %v", orderNo, err)
		return
	}
	if err := h.repo.UpdateOrderPaymentInfo(order.ID, "", txHash); err != nil {
		log.Printf("[completePayment] update payment info failed for order %s: %v", orderNo, err)
	}

	log.Printf("[completePayment] order %s marked as paid", orderNo)

	userID := order.UserID

	// Deliver product
	switch order.ProductType {
	case "package":
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
			case "balance":
				_ = h.repo.DeliverBalancePackageToUser(userID, order.Amount, pkg.Name, order.ID)
				nowMs := time.Now().UnixMilli()
				_ = h.repo.UpdateUserForwardsStatus(userID, 1, nowMs)
				h.resumePausedForwardsByUser(userID, nowMs)
			case "traffic":
				_ = h.repo.DeliverTrafficPackageToUser(userID, pkg.TrafficLimit, pkg.Price, pkg.TrafficLimit, qty)
			default:
				groupIDs, _ := h.repo.GetPackageTunnelGroupIDs(pkg.ID)
				_ = h.repo.DeliverPackageToUser(userID, &pkg, order.ID, groupIDs)
			}
		}
	default:
		log.Printf("completePayment: unknown product type %q for order %s, skipping delivery", order.ProductType, order.OrderNo)
	}
}

func (h *Handler) getPaymentConfigs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	list, err := h.repo.ListEnabledPaymentConfigs()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if list == nil {
		list = []*model.PaymentConfig{}
	}

	result := make([]map[string]interface{}, 0, len(list))
	for _, cfg := range list {
		result = append(result, map[string]interface{}{
			"channel": cfg.Channel,
			"config":  cfg.Config,
			"enabled": cfg.Enabled,
		})
	}

	response.WriteJSON(w, response.OK(result))
}

func (h *Handler) savePaymentConfig(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	channel := asString(req["channel"])
	if channel == "" {
		response.WriteJSON(w, response.ErrDefault("支付渠道不能为空"))
		return
	}

	cfg := &model.PaymentConfig{
		Channel: channel,
		Config:  asString(req["config"]),
		Enabled: asInt(req["enabled"], 0),
	}

	if err := h.repo.SavePaymentConfig(cfg); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}
