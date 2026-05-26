package repo

import (
	"errors"
	"time"

	"go-backend/internal/store/model"
)

func (r *Repository) GetPaymentConfig(channel string) (*model.PaymentConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var cfg model.PaymentConfig
	if err := r.db.Where("channel = ?", channel).First(&cfg).Error; err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *Repository) ListPaymentConfigs() ([]*model.PaymentConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var list []*model.PaymentConfig
	if err := r.db.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) ListEnabledPaymentConfigs() ([]*model.PaymentConfig, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var list []*model.PaymentConfig
	if err := r.db.Where("enabled = 1").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) SavePaymentConfig(cfg *model.PaymentConfig) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	cfg.UpdatedAt = time.Now().Unix()

	var existing model.PaymentConfig
	if err := r.db.Where("channel = ?", cfg.Channel).First(&existing).Error; err != nil {
		cfg.CreatedAt = cfg.UpdatedAt
		return r.db.Create(cfg).Error
	}

	return r.db.Model(&model.PaymentConfig{}).Where("channel = ?", cfg.Channel).Updates(map[string]interface{}{
		"config":   cfg.Config,
		"enabled":  cfg.Enabled,
		"updated_at": cfg.UpdatedAt,
	}).Error
}

func (r *Repository) DeletePaymentConfig(channel string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("channel = ?", channel).Delete(&model.PaymentConfig{}).Error
}
