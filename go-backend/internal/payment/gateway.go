package payment

import (
	"net/http"

	"go-backend/internal/store/model"
)

type PaymentResult struct {
	PayURL     string // 易支付跳转链接
	PayAddress string // USDT 收款地址
	PayAmount  string // USDT 到账金额
}

type PaymentGateway interface {
	Name() string
	CreateInvoice(order *model.Order) (*PaymentResult, error)
	VerifyCallback(r *http.Request) (orderNo string, txHash string, err error)
	QueryStatus(orderNo string) (paid bool, txHash string, err error)
}
