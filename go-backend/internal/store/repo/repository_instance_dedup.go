package repo

import (
	"errors"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"

	"go-backend/internal/store/model"
)

// AutoMergeDuplicateInstancesConfigKey toggles automatic merging of duplicate
// node instances that are created when an agent is re-paired and reports a new
// instance_id while the old one is still registered.
const AutoMergeDuplicateInstancesConfigKey = "auto_merge_duplicate_instances"

// duplicateMergeOfflineAfter is how long an old instance must have been offline
// before it becomes eligible for automatic merging.
const duplicateMergeOfflineAfter = 10 * time.Minute

// MergeDuplicateNodeInstances merges a stale duplicate instance of the same
// physical node (matching hostname + public IP) into the given instance and
// removes the stale row. It is intended to run once when a new instance first
// appears; it is a no-op when matching is ambiguous or disabled.
func (r *Repository) MergeDuplicateNodeInstances(nodeID int64, instanceID string) ([]string, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if nodeID <= 0 || instanceID == "" {
		return nil, nil
	}
	if !r.autoMergeDuplicateInstancesEnabled() {
		return nil, nil
	}

	var current model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).First(&current).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	hostname := strings.TrimSpace(current.Hostname)
	ipv4 := strings.TrimSpace(current.PublicIPV4)
	ipv6 := strings.TrimSpace(current.PublicIPV6)
	// 缺少 hostname 或公网 IP 时无法安全判定"同一台机器"，直接放弃。
	if hostname == "" || (ipv4 == "" && ipv6 == "") {
		return nil, nil
	}

	cutoff := time.Now().Add(-duplicateMergeOfflineAfter).UnixMilli()
	query := r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id <> ? AND status = 0 AND last_seen_at < ?", nodeID, instanceID, cutoff).
		Where("TRIM(hostname) = ?", hostname)
	if ipv4 != "" {
		query = query.Where("TRIM(public_ip_v4) = ?", ipv4)
	} else {
		query = query.Where("TRIM(public_ip_v6) = ?", ipv6)
	}
	var candidates []model.NodeInstance
	if err := query.Find(&candidates).Error; err != nil {
		return nil, err
	}
	// 只处理唯一匹配；多条同名同 IP 的异常情况跳过并记录，避免误合并。
	if len(candidates) != 1 {
		if len(candidates) > 1 {
			log.Printf("[instance dedup] node=%d instance=%s skipped: %d stale candidates", nodeID, instanceID, len(candidates))
		}
		return nil, nil
	}

	stale := candidates[0]
	if err := r.db.Transaction(func(tx *gorm.DB) error {
		return mergeDuplicateNodeInstanceTx(tx, r, nodeID, current, stale)
	}); err != nil {
		return nil, err
	}
	log.Printf("[instance dedup] node=%d merged stale instance %s into %s", nodeID, stale.InstanceID, instanceID)
	return []string{stale.InstanceID}, nil
}

func mergeDuplicateNodeInstanceTx(tx *gorm.DB, r *Repository, nodeID int64, current, stale model.NodeInstance) error {
	now := unixMilliNow()
	updates := map[string]interface{}{
		"total_in_flow":  gorm.Expr("total_in_flow + ?", stale.TotalInFlow),
		"total_out_flow": gorm.Expr("total_out_flow + ?", stale.TotalOutFlow),
		"updated_time":   now,
	}
	if v := strings.TrimSpace(stale.DisplayName); v != "" {
		updates["display_name"] = v
	}
	if v := strings.TrimSpace(stale.Remark); v != "" {
		updates["remark"] = v
	}
	if stale.Weight > 0 {
		updates["weight"] = stale.Weight
	}
	if stale.TrafficRatio != 0 {
		updates["traffic_ratio"] = stale.TrafficRatio
	}
	if v := strings.TrimSpace(stale.PortRange); v != "" {
		updates["port_range"] = v
	}
	if stale.ExpiryTime.Valid {
		updates["expiry_time"] = stale.ExpiryTime
	}
	if stale.RenewalCycle.Valid && strings.TrimSpace(stale.RenewalCycle.String) != "" {
		updates["renewal_cycle"] = stale.RenewalCycle
	}
	if stale.FlowResetTime > 0 {
		updates["flow_reset_time"] = stale.FlowResetTime
	}
	if stale.TrafficLimit != 0 {
		updates["traffic_limit"] = stale.TrafficLimit
	}
	if stale.TrafficLimitMode != 0 {
		updates["traffic_limit_mode"] = stale.TrafficLimitMode
	}
	if stale.PauseRestoreWeight.Valid {
		updates["pause_restore_weight"] = stale.PauseRestoreWeight
	}
	if stale.ExpiryReminderDismissed != 0 {
		updates["expiry_reminder_dismissed"] = stale.ExpiryReminderDismissed
	}
	if stale.ExpiryReminderDismissedUntil.Valid {
		updates["expiry_reminder_dismissed_until"] = stale.ExpiryReminderDismissedUntil
	}
	if stale.CreatedTime > 0 && (current.CreatedTime == 0 || stale.CreatedTime < current.CreatedTime) {
		updates["created_time"] = stale.CreatedTime
	}
	if err := tx.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, current.InstanceID).
		Updates(updates).Error; err != nil {
		return err
	}

	// 删除旧实例，清理逻辑与 DeleteNodeInstance 保持一致。
	if err := r.markNodeInstanceDeletedTx(tx, nodeID, stale.InstanceID, now); err != nil {
		return err
	}
	if err := tx.Where("node_id = ? AND instance_id = ?", nodeID, stale.InstanceID).Delete(&model.PeerShareInstance{}).Error; err != nil {
		return err
	}
	if err := tx.Model(&model.PeerShareRuntimeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, stale.InstanceID).
		Updates(map[string]interface{}{"status": 0, "applied": 0, "healthy": 0, "updated_time": now}).Error; err != nil {
		return err
	}
	if err := tx.Where("node_id = ? AND instance_id = ?", nodeID, stale.InstanceID).Delete(&model.CrossBorderProbeState{}).Error; err != nil {
		return err
	}
	return tx.Where("node_id = ? AND instance_id = ?", nodeID, stale.InstanceID).Delete(&model.NodeInstance{}).Error
}

func (r *Repository) autoMergeDuplicateInstancesEnabled() bool {
	cfg, err := r.GetConfigByName(AutoMergeDuplicateInstancesConfigKey)
	if err != nil || cfg == nil {
		return true
	}
	return parseConfigBool(strings.TrimSpace(cfg.Value), true)
}
