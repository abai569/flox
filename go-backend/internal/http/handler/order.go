package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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

	productID := asInt64(req["product_id"], 0)
	if productID <= 0 {
		response.WriteJSON(w, response.ErrDefault("商品ID不能为空"))
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

	product, err := h.repo.GetProduct(productID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("商品不存在"))
		return
	}
	if product.Status != 1 {
		response.WriteJSON(w, response.ErrDefault("商品已下架"))
		return
	}

	meta, _ := json.Marshal(product)

	order := &model.Order{
		OrderNo:     orderNo(),
		UserID:      userID,
		UserName:    userName,
		ProductID:   product.ID,
		ProductName: product.Name,
		ProductType: product.Type,
		ProductMeta: string(meta),
		Amount:      product.Price,
		PayCurrency: currency,
		Status:      0,
	}

	if currency == "BALANCE" {
		ok, err := h.repo.DeductUserBalance(userID, order.Amount)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
		if !ok {
			response.WriteJSON(w, response.Err(1001, "余额不足"))
			return
		}

		order.Status = 1
		order.PayTime = time.Now().Unix()

		if err := h.repo.CreateOrder(order); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}

		user, _ := h.repo.GetUserByID(userID)
		if user != nil {
			_ = h.repo.CreateBalanceLog(userID, userName, -order.Amount,
				user.Balance+order.Amount, user.Balance,
				time.Now().Unix(), "余额购买")
		}

		h.deliverProduct(userID, order, product)

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
		"pay_url":     result.PayURL,
		"pay_address": result.PayAddress,
		"pay_amount":  result.PayAmount,
		"order_no":    order.OrderNo,
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

func (h *Handler) deliverProduct(userID int64, order *model.Order, product *model.Product) {
	switch order.ProductType {
	case "recharge":
		_ = h.repo.IncreaseUserBalance(userID, product.Value)
	case "traffic":
		_ = h.repo.IncreaseUserFlow(userID, product.Value)
	case "time":
		_ = h.repo.ExtendUserExpiry(userID, product.Value)
	}
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
