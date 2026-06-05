package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

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
	gateway, err := payment.GetGateway("USDT", h.repo)
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

func (h *Handler) completePayment(orderNo, txHash string) {
	order, err := h.repo.GetOrderByNo(orderNo)
	if err != nil {
		return
	}
	if order.Status != 0 {
		return
	}

	if err := h.repo.UpdateOrderStatus(order.ID, 1); err != nil {
		return
	}
	_ = h.repo.UpdateOrderPaymentInfo(order.ID, "", txHash)

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
