package payment

import (
	"encoding/json"
	"fmt"

	"go-backend/internal/store/repo"
)

func GetGateway(channel string, r *repo.Repository) (PaymentGateway, error) {
	cfg, err := r.GetPaymentConfig(channel)
	if err != nil {
		return nil, fmt.Errorf("payment config for %s: %w", channel, err)
	}
	if cfg.Enabled == 0 {
		return nil, fmt.Errorf("payment channel %s not enabled", channel)
	}

	switch channel {
	case "USDT":
		var gmCfg GMPayConfig
		if err := json.Unmarshal([]byte(cfg.Config), &gmCfg); err != nil {
			return nil, fmt.Errorf("parse USDT config: %w", err)
		}
		return NewGMPay(&gmCfg), nil

	case "YIPAY":
		var ypCfg YiPayConfig
		if err := json.Unmarshal([]byte(cfg.Config), &ypCfg); err != nil {
			return nil, fmt.Errorf("parse YIPAY config: %w", err)
		}
		return NewYiPay(&ypCfg), nil

	default:
		return nil, fmt.Errorf("unknown payment channel: %s", channel)
	}
}
