package payment

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"go-backend/internal/store/model"
)

type YiPayConfig struct {
	GatewayURL string `json:"gateway_url"` // 易支付网关地址
	PID        string `json:"pid"`         // 商户ID
	Key        string `json:"key"`         // 商户密钥
	NotifyURL  string `json:"notify_url"`  // 异步回调地址
	ReturnURL  string `json:"return_url"`  // 同步跳转地址
	SignMode   string `json:"sign_mode"` // 签名模式: epay | mpay
}

type yiPayGateway struct {
	config *YiPayConfig
}

func NewYiPay(cfg *YiPayConfig) PaymentGateway {
	return &yiPayGateway{config: cfg}
}

func (g *yiPayGateway) Name() string { return "YIPAY" }

// yipaySign 生成易支付 MD5 签名
// 支持两种模式：
//   - epay（标准易支付）：末尾 &key=商户密钥
//   - mpay（码支付）：去掉末尾 &，直接拼接密钥
func yipaySign(params map[string]string, key string, signMode string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var buf strings.Builder
	for _, k := range keys {
		if params[k] == "" {
			continue
		}
		buf.WriteString(k)
		buf.WriteString("=")
		buf.WriteString(params[k])
		buf.WriteString("&")
	}

	if signMode == "mpay" {
		signstr := buf.String()
		if len(signstr) > 0 && signstr[len(signstr)-1] == '&' {
			signstr = signstr[:len(signstr)-1]
		}
		signstr += key
		h := md5.Sum([]byte(signstr))
		return hex.EncodeToString(h[:])
	}

	// 标准易支付（默认）
	buf.WriteString("key=")
	buf.WriteString(key)
	h := md5.Sum([]byte(buf.String()))
	return hex.EncodeToString(h[:])
}

func (g *yiPayGateway) CreateInvoice(order *model.Order) (*PaymentResult, error) {
	// 金额转换：分 -> 元
	money := fmt.Sprintf("%.2f", float64(order.Amount)/100.0)

	payType := order.PayType
	if payType == "" {
		payType = "alipay"
	}

	params := map[string]string{
		"pid":          g.config.PID,
		"type":         payType,
		"out_trade_no": order.OrderNo,
		"notify_url":   g.config.NotifyURL,
		"return_url":   g.config.ReturnURL,
		"name":         order.ProductName,
		"money":        money,
	}
	params["sign"] = yipaySign(params, g.config.Key, g.config.SignMode)
	params["sign_type"] = "MD5"

	// Build checkout URL
	values := url.Values{}
	for k, v := range params {
		values.Set(k, v)
	}
	payURL := strings.TrimRight(g.config.GatewayURL, "/") + "/submit.php?" + values.Encode()

	return &PaymentResult{
		PayURL: payURL,
	}, nil
}

type yipayCallback struct {
	PID          string `json:"pid"`
	TradeNo      string `json:"trade_no"`      // 平台交易号
	OutTradeNo   string `json:"out_trade_no"`  // 商户订单号
	Type         string `json:"type"`
	Name         string `json:"name"`
	Money        string `json:"money"`         // 实际支付金额 (元)
	TradeStatus  string `json:"trade_status"`  // TRADE_SUCCESS
	Sign         string `json:"sign"`
	SignType     string `json:"sign_type"`
}

func (g *yiPayGateway) VerifyCallback(r *http.Request) (orderNo string, txHash string, err error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return "", "", fmt.Errorf("read body: %w", err)
	}

	// Parse form-encoded or JSON body
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return "", "", fmt.Errorf("parse form: %w", err)
	}

	cb := yipayCallback{
		PID:         values.Get("pid"),
		TradeNo:     values.Get("trade_no"),
		OutTradeNo:  values.Get("out_trade_no"),
		Type:        values.Get("type"),
		Name:        values.Get("name"),
		Money:       values.Get("money"),
		TradeStatus: values.Get("trade_status"),
		Sign:        values.Get("sign"),
		SignType:    values.Get("sign_type"),
	}

	if cb.TradeStatus != "TRADE_SUCCESS" {
		return "", "", fmt.Errorf("trade not success: %s", cb.TradeStatus)
	}

	// Verify sign
	params := map[string]string{
		"pid":          cb.PID,
		"trade_no":     cb.TradeNo,
		"out_trade_no": cb.OutTradeNo,
		"type":         cb.Type,
		"name":         cb.Name,
		"money":        cb.Money,
		"trade_status": cb.TradeStatus,
	}
	expectedSign := yipaySign(params, g.config.Key, g.config.SignMode)
	if !strings.EqualFold(expectedSign, cb.Sign) {
		return "", "", fmt.Errorf("sign mismatch")
	}

	// Verify pid matches configured
	if cb.PID != g.config.PID {
		return "", "", fmt.Errorf("pid mismatch")
	}

	return cb.OutTradeNo, cb.TradeNo, nil
}

func (g *yiPayGateway) QueryStatus(orderNo string) (bool, string, error) {
	return false, "", nil
}

// Ensure interfaces are satisfied
var _ PaymentGateway = (*nowPaymentsGateway)(nil)
var _ PaymentGateway = (*yiPayGateway)(nil)
