package repo

import (
	"errors"
	"strings"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
)

func (r *Repository) GetNodeDNSFailover(nodeID int64) (*model.NodeDNSFailover, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil, errors.New("node id is required")
	}
	var cfg model.NodeDNSFailover
	err := r.db.Where("node_id = ?", nodeID).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *Repository) UpsertNodeDNSFailover(cfg *model.NodeDNSFailover) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if cfg == nil || cfg.NodeID <= 0 {
		return errors.New("node id is required")
	}
	now := unixMilliNow()
	var existing model.NodeDNSFailover
	err := r.db.Where("node_id = ?", cfg.NodeID).First(&existing).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		cfg.CreatedTime = now
		cfg.UpdatedTime = now
		return r.db.Create(cfg).Error
	}
	return r.db.Model(&model.NodeDNSFailover{}).
		Where("id = ?", existing.ID).
		Updates(map[string]interface{}{
			"enabled":               cfg.Enabled,
			"provider":              strings.TrimSpace(cfg.Provider),
			"domain":                strings.TrimSpace(cfg.Domain),
			"ttl":                   cfg.TTL,
			"manage_a":              cfg.ManageA,
			"manage_aaaa":           cfg.ManageAAAA,
			"min_records":           cfg.MinRecords,
			"remove_fail_count":     cfg.RemoveFailCount,
			"restore_success_count": cfg.RestoreSuccessCount,
			"sync_interval_seconds": cfg.SyncIntervalSeconds,
			"provider_config":       cfg.ProviderConfig,
			"updated_time":          now,
		}).Error
}

func (r *Repository) ListEnabledNodeDNSFailovers() ([]model.NodeDNSFailover, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var configs []model.NodeDNSFailover
	err := r.db.Where("enabled = ?", 1).Order("id ASC").Find(&configs).Error
	return configs, err
}

func (r *Repository) UpdateNodeDNSFailoverState(nodeID int64, currentA, currentAAAA, expectedA, expectedAAAA, lastError string, syncedAt int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return errors.New("node id is required")
	}
	if syncedAt <= 0 {
		syncedAt = unixMilliNow()
	}
	return r.db.Model(&model.NodeDNSFailover{}).
		Where("node_id = ?", nodeID).
		Updates(map[string]interface{}{
			"current_a":     currentA,
			"current_aaaa":  currentAAAA,
			"expected_a":    expectedA,
			"expected_aaaa": expectedAAAA,
			"last_error":    lastError,
			"last_sync_at":  syncedAt,
			"updated_time":  syncedAt,
		}).Error
}
