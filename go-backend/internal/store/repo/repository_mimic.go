package repo

import (
	"fmt"
	"strings"

	"go-backend/internal/store/model"
)

func (r *Repository) CreateMimicConfig(cfg *model.MimicConfig) error {
	return r.db.Create(cfg).Error
}

func (r *Repository) GetMimicConfig(forwardID int64) (*model.MimicConfig, error) {
	var cfg model.MimicConfig
	err := r.db.Where("forward_id = ?", forwardID).First(&cfg).Error
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *Repository) UpdateMimicConfig(cfg *model.MimicConfig) error {
	return r.db.Save(cfg).Error
}

func (r *Repository) DeleteMimicConfig(forwardID int64) error {
	return r.db.Where("forward_id = ?", forwardID).Delete(&model.MimicConfig{}).Error
}

func (r *Repository) GetNextMimicPort() (int, error) {
	var cfg model.MimicConfig
	if err := r.db.Order("mimic_port DESC").First(&cfg).Error; err != nil {
		return 44445, nil
	}
	return cfg.MimicPort + 1, nil
}

func (r *Repository) GetNextWgSubnet() (string, error) {
	var cfg model.MimicConfig
	if err := r.db.Order("id DESC").First(&cfg).Error; err != nil {
		return "10.66.0.0/24", nil
	}
	wgAddr := cfg.WgAddress
	var subnetParts []string
	if wgAddr != "" {
		subnetParts = parseWgAddress(wgAddr)
	}
	if len(subnetParts) < 2 {
		return "10.66.0.0/24", nil
	}
	thirdOctet := 0
	if _, err := fmt.Sscanf(subnetParts[1], "%d", &thirdOctet); err != nil {
		return "10.66.0.0/24", nil
	}
	thirdOctet++
	if thirdOctet > 255 {
		return "", fmt.Errorf("wg subnet pool exhausted")
	}
	return fmt.Sprintf("10.66.%d.0/24", thirdOctet), nil
}

func parseWgAddress(addr string) []string {
	parts := strings.Split(addr, ".")
	if len(parts) >= 4 {
		return parts
	}
	return nil
}
