package payment

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"go-backend/internal/store/model"
)

type NowPaymentsConfig struct {
	APIKey    string `json:"api_key"`
	IPNSecret string `json:"ipn_secret"`
}

type nowPaymentsGateway struct {
	config *NowPaymentsConfig
}

func NewNowPayments(cfg *NowPaymentsConfig) PaymentGateway {
	return &nowPaymentsGateway{config: cfg}
}

func (g *nowPaymentsGateway) Name() string { return "USDT" }

type npInvoiceRequest struct {
	PriceAmount  string `json:"price_amount"`
	PriceCurrency string `json:"price_currency"`
	PayCurrency  string `json:"pay_currency"`
	OrderID      string `json:"order_id"`
	OrderDescription string `json:"order_description"`
	IPNCallbackURL  string `json:"ipn_callback_url"`
}

type npInvoiceResponse struct {
	InvoiceID     string `json:"invoice_id"`
	InvoiceURL    string `json:"invoice_url"`
	PayAddress    string `json:"pay_address"`
	PayCurrency   string `json:"pay_currency"`
	PriceAmount   string `json:"price_amount"`
	PayAmount     string `json:"pay_amount"`
}

func (g *nowPaymentsGateway) CreateInvoice(order *model.Order) (*PaymentResult, error) {
	// Convert 分 to USDT (1 分 = 0.01 CNY, approximate USDT rate)
	amountCNY := float64(order.Amount) / 100.0
	// Simple rate: 1 USDT ≈ 7.2 CNY (configurable via env or API)
	usdtAmount := fmt.Sprintf("%.2f", amountCNY/7.2)

	reqBody := npInvoiceRequest{
		PriceAmount:      usdtAmount,
		PriceCurrency:    "usd",
		PayCurrency:      "usdttrc20",
		OrderID:          order.OrderNo,
		OrderDescription: order.ProductName,
		IPNCallbackURL:   "", // configured externally
	}

	body, _ := json.Marshal(reqBody)
	req, err := http.NewRequest("POST", "https://api.nowpayments.io/v1/invoice", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create invoice request: %w", err)
	}
	req.Header.Set("x-api-key", g.config.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("create invoice: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("nowpayments error status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var invoice npInvoiceResponse
	if err := json.Unmarshal(respBody, &invoice); err != nil {
		return nil, fmt.Errorf("parse invoice response: %w", err)
	}

	return &PaymentResult{
		PayAddress: invoice.PayAddress,
		PayAmount:  invoice.PayAmount,
	}, nil
}

func (g *nowPaymentsGateway) VerifyCallback(r *http.Request) (orderNo string, txHash string, err error) {
	// Verify HMAC-SHA256 signature from NowPayments IPN
	sig := r.Header.Get("x-nowpayments-sig")
	if sig == "" {
		return "", "", fmt.Errorf("missing x-nowpayments-sig header")
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return "", "", fmt.Errorf("read body: %w", err)
	}

	mac := hmac.New(sha256.New, []byte(g.config.IPNSecret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return "", "", fmt.Errorf("invalid signature")
	}

	var callback struct {
		OrderID          string `json:"order_id"`
		Payments         []struct {
			TxID   string `json:"tx_id"`
			Status string `json:"status"`
		} `json:"payments"`
		PaymentStatus string `json:"payment_status"`
	}

	if err := json.Unmarshal(body, &callback); err != nil {
		return "", "", fmt.Errorf("parse callback: %w", err)
	}

	if callback.PaymentStatus != "finished" {
		return "", "", fmt.Errorf("payment not finished: %s", callback.PaymentStatus)
	}

	if len(callback.Payments) > 0 {
		txHash = callback.Payments[0].TxID
	}

	return callback.OrderID, txHash, nil
}

func (g *nowPaymentsGateway) QueryStatus(orderNo string) (bool, string, error) {
	// Placeholder - uses IPN callback instead of polling
	return false, "", nil
}
