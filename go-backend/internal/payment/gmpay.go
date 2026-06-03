package payment

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"net/http"
	"sort"
	"strings"

	"go-backend/internal/store/model"
)

type GMPayConfig struct {
	PID            string `json:"pid"`
	SecretKey      string `json:"secret_key"`
	APIURL         string `json:"api_url"`
	NotifyURL      string `json:"notify_url"`
	ReturnURL      string `json:"return_url"`
	Currency       string `json:"currency"`
	Token          string `json:"token"`
	Network        string `json:"network"`
	EnableTron     bool   `json:"enable_tron"`     // 启用 TRC-20
	EnablePolygon  bool   `json:"enable_polygon"`  // 启用 Polygon
}

type gmpayGateway struct {
	config *GMPayConfig
}

func NewGMPay(cfg *GMPayConfig) PaymentGateway {
	return &gmpayGateway{config: cfg}
}

func (g *gmpayGateway) Name() string { return "USDT" }

func (g *gmpayGateway) sign(params map[string]string, secretKey string) string {
	// 1. filter non-empty, exclude signature
	// 2. sort by ASCII key
	// 3. concat as key=value&...
	// 4. append secret_key
	// 5. MD5 lowercase
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "signature" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var buf strings.Builder
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte('&')
		}
		buf.WriteString(k)
		buf.WriteByte('=')
		buf.WriteString(params[k])
	}
	buf.WriteString(secretKey)

	hash := md5.Sum([]byte(buf.String()))
	return hex.EncodeToString(hash[:])
}

func (g *gmpayGateway) CreateInvoice(order *model.Order) (*PaymentResult, error) {
	if g.config.APIURL == "" {
		return nil, fmt.Errorf("GMPay 服务器地址未配置，请在支付管理页面填写")
	}
	if g.config.PID == "" {
		return nil, fmt.Errorf("GMPay 商户 PID 未配置，请在支付管理页面填写")
	}
	if g.config.SecretKey == "" {
		return nil, fmt.Errorf("GMPay 密钥未配置，请在支付管理页面填写")
	}
	if g.config.NotifyURL == "" {
		return nil, fmt.Errorf("GMPay 异步通知地址未配置，请在支付管理页面填写")
	}

	// Convert 分 to 元
	amountCNY := float64(order.Amount) / 100.0
	amountStr := strconv.FormatFloat(amountCNY, 'g', -1, 64)

	currency := g.config.Currency
	if currency == "" {
		currency = "cny"
	}
	token := g.config.Token
	if token == "" {
		token = "usdt"
	}
	network := order.PayNetwork
	if network == "" {
		network = g.config.Network
	}
	if network == "" {
		network = "tron"
	}

	// Build params for signing (all strings)
	signParams := map[string]string{
		"pid":        g.config.PID,
		"order_id":   order.OrderNo,
		"currency":   currency,
		"token":      token,
		"network":    network,
		"amount":     amountStr,
		"notify_url": g.config.NotifyURL,
	}
	if g.config.ReturnURL != "" {
		signParams["redirect_url"] = g.config.ReturnURL
	}

	signature := g.sign(signParams, g.config.SecretKey)

	bodyParams := map[string]interface{}{
		"pid":        g.config.PID,
		"order_id":   order.OrderNo,
		"currency":   currency,
		"token":      token,
		"network":    network,
		"amount":     amountCNY,
		"notify_url": g.config.NotifyURL,
		"signature":  signature,
	}
	if g.config.ReturnURL != "" {
		bodyParams["redirect_url"] = g.config.ReturnURL
	}

	body, _ := json.Marshal(bodyParams)
	endpoint := strings.TrimRight(g.config.APIURL, "/") + "/payments/gmpay/v1/order/create-transaction"
	req, err := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create gmpay request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gmpay request: %w", err)
	}
	respBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gmpay error status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			PaymentURL string `json:"payment_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse gmpay response: %w, body=%s", err, string(respBody))
	}
	if result.Code != 0 {
		return nil, fmt.Errorf("gmpay returned error: %s", result.Msg)
	}
	if result.Data.PaymentURL == "" {
		return nil, fmt.Errorf("gmpay response missing payment_url: %s", string(respBody))
	}

	return &PaymentResult{
		PayURL: result.Data.PaymentURL,
	}, nil
}

func (g *gmpayGateway) VerifyCallback(r *http.Request) (orderNo string, txHash string, err error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return "", "", fmt.Errorf("read callback body: %w", err)
	}

	var params map[string]interface{}
	if err := json.Unmarshal(body, &params); err != nil {
		return "", "", fmt.Errorf("parse callback json: %w", err)
	}

	// Extract signature and verify
	callbackSig, ok := params["signature"].(string)
	if !ok {
		return "", "", fmt.Errorf("callback missing signature")
	}

	// Build sign map with string values
	signMap := make(map[string]string)
	for k, v := range params {
		if k == "signature" {
			continue
		}
		signMap[k] = fmt.Sprintf("%v", v)
	}
	expectedSig := g.sign(signMap, g.config.SecretKey)
	if callbackSig != expectedSig {
		return "", "", fmt.Errorf("callback signature mismatch: expected=%s got=%s", expectedSig, callbackSig)
	}

	// Extract order info
	on, _ := params["order_id"].(string)
	th, _ := params["tx_hash"].(string)
	if th == "" {
		th, _ = params["txid"].(string)
	}
	if on == "" {
		return "", "", fmt.Errorf("callback missing order_id")
	}

	return on, th, nil
}

func (g *gmpayGateway) QueryStatus(orderNo string) (bool, string, error) {
	return false, "", nil
}
