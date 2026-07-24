package repo

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrInvalidNodeInstanceOrder = errors.New("invalid node instance order")

type NodeInstanceUpsert struct {
	NodeID      int64
	InstanceID  string
	Hostname    string
	PublicIPV4  string
	PublicIPV6  string
	Version     string
	NetInSpeed  int64
	NetOutSpeed int64
	NetInBytes  int64
	NetOutBytes int64
	TCPConns    int64
	UDPConns    int64
	Uptime      int64
	PeriodRx    int64
	PeriodTx    int64
	CPUUsage    float64
	MemUsage    float64
	DiskUsage   float64
	Now         int64
}

type RemoteNodeInstanceSync struct {
	InstanceID    string
	DisplayName   string
	DisplayIndex  int
	Hostname      string
	PublicIPV4    string
	PublicIPV6    string
	Version       string
	Status        int
	Weight        int
	TrafficRatio  float64
	ExpiryTime    int64
	RenewalCycle  string
	FlowResetTime int
	TrafficLimit  int64
	TotalInFlow   int64
	TotalOutFlow  int64
	PeriodRx      int64
	PeriodTx      int64
	NetInSpeed    int64
	NetOutSpeed   int64
	NetInBytes    int64
	NetOutBytes   int64
	TCPConns      int64
	UDPConns      int64
	Uptime        int64
	CPUUsage      float64
	MemUsage      float64
	DiskUsage     float64
}

type NodeInstanceCount struct {
	Total  int64
	Online int64
}

type NodeInstanceExpiryReminder struct {
	NodeID       int64
	NodeName     string
	InstanceID   string
	DisplayIndex int
	DisplayName  string
	ExpiryTime   int64
}

type NodeInstanceTrafficLimitItem struct {
	NodeID       int64
	InstanceID   string
	Name         string
	LimitGB      int64
	Used         int64
	Mask         int
	TotalInFlow  int64
	TotalOutFlow int64
	NetInBytes   int64
	NetOutBytes  int64
}

func normalizeNodeInstanceID(instanceID string) string {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" || strings.EqualFold(instanceID, "default") {
		return ""
	}
	if len(instanceID) > 100 {
		return instanceID[:100]
	}
	return instanceID
}

func validNodeInstanceWhere() (string, []interface{}) {
	return "TRIM(instance_id) <> '' AND LOWER(TRIM(instance_id)) <> ?", []interface{}{"default"}
}

func (r *Repository) UpsertNodeInstance(in NodeInstanceUpsert) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if in.NodeID <= 0 {
		return errors.New("node id is required")
	}
	instanceID := normalizeNodeInstanceID(in.InstanceID)
	if instanceID == "" {
		return nil
	}
	deleted, err := r.IsNodeInstanceDeleted(in.NodeID, instanceID)
	if err != nil {
		return err
	}
	if deleted {
		return nil
	}
	now := in.Now
	if now <= 0 {
		now = unixMilliNow()
	}

	var existing model.NodeInstance
	err = r.db.Where("node_id = ? AND instance_id = ?", in.NodeID, instanceID).First(&existing).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		displayIndex, err := r.nextNodeInstanceDisplayIndex(in.NodeID)
		if err != nil {
			return err
		}
		inst := model.NodeInstance{
			NodeID:       in.NodeID,
			InstanceID:   instanceID,
			Hostname:     strings.TrimSpace(in.Hostname),
			PublicIPV4:   strings.TrimSpace(in.PublicIPV4),
			PublicIPV6:   strings.TrimSpace(in.PublicIPV6),
			Version:      strings.TrimSpace(in.Version),
			Status:       1,
			Weight:       1,
			DisplayIndex: displayIndex,
			NetInSpeed:   in.NetInSpeed,
			NetOutSpeed:  in.NetOutSpeed,
			NetInBytes:   in.NetInBytes,
			NetOutBytes:  in.NetOutBytes,
			TCPConns:     in.TCPConns,
			UDPConns:     in.UDPConns,
			Uptime:       in.Uptime,
			PeriodRx:     in.PeriodRx,
			PeriodTx:     in.PeriodTx,
			CPUUsage:     in.CPUUsage,
			MemUsage:     in.MemUsage,
			DiskUsage:    in.DiskUsage,
			LastSeenAt:   now,
			CreatedTime:  now,
			UpdatedTime:  now,
		}
		return r.db.Create(&inst).Error
	}

	resetTrafficStats := nodeInstanceServerChanged(existing, in)
	updates := map[string]interface{}{
		"status":        1,
		"last_seen_at":  now,
		"updated_time":  now,
		"net_in_speed":  in.NetInSpeed,
		"net_out_speed": in.NetOutSpeed,
		"net_in_bytes":  in.NetInBytes,
		"net_out_bytes": in.NetOutBytes,
		"tcp_conns":     in.TCPConns,
		"udp_conns":     in.UDPConns,
		"uptime":        in.Uptime,
		"period_rx":     in.PeriodRx,
		"period_tx":     in.PeriodTx,
		"cpu_usage":     in.CPUUsage,
		"mem_usage":     in.MemUsage,
		"disk_usage":    in.DiskUsage,
	}
	if resetTrafficStats {
		updates["net_in_bytes"] = int64(0)
		updates["net_out_bytes"] = int64(0)
		updates["period_rx"] = int64(0)
		updates["period_tx"] = int64(0)
	}
	if v := strings.TrimSpace(in.Hostname); v != "" {
		updates["hostname"] = v
	}
	if v := strings.TrimSpace(in.PublicIPV4); v != "" {
		updates["public_ip_v4"] = v
	}
	if v := strings.TrimSpace(in.PublicIPV6); v != "" {
		updates["public_ip_v6"] = v
	}
	if v := strings.TrimSpace(in.Version); v != "" {
		updates["version"] = v
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("id = ?", existing.ID).
		Updates(updates).Error
}

func nodeInstanceServerChanged(existing model.NodeInstance, in NodeInstanceUpsert) bool {
	if existing.Status == 1 {
		return false
	}
	if changedNonEmptyString(existing.PublicIPV4, in.PublicIPV4) || changedNonEmptyString(existing.PublicIPV6, in.PublicIPV6) {
		return true
	}
	return changedNonEmptyString(existing.Hostname, in.Hostname)
}

func changedNonEmptyString(oldValue, newValue string) bool {
	oldValue = strings.TrimSpace(oldValue)
	newValue = strings.TrimSpace(newValue)
	return oldValue != "" && newValue != "" && oldValue != newValue
}

func (r *Repository) MarkNodeInstanceOffline(nodeID int64, instanceID string, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(map[string]interface{}{"status": 0, "updated_time": now}).Error
}

func (r *Repository) CountOnlineNodeInstances(nodeID int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	var count int64
	where, args := validNodeInstanceWhere()
	err := r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND status = ?", nodeID, 1).
		Where(where, args...).
		Count(&count).Error
	return count, err
}

func (r *Repository) UpdateNodeInstanceWeight(nodeID int64, instanceID string, weight int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(map[string]interface{}{"weight": weight, "updated_time": now}).Error
}

func (r *Repository) UpdateNodeInstanceProfile(nodeID int64, instanceID string, displayName string, remark string, weight int, portRange string, expiryTime interface{}, renewalCycle interface{}, flowResetTime int, trafficLimit int64, trafficLimitMode int, trafficRatio *float64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	updates := map[string]interface{}{
		"display_name":                    strings.TrimSpace(displayName),
		"remark":                          strings.TrimSpace(remark),
		"weight":                          weight,
		"port_range":                      strings.TrimSpace(portRange),
		"expiry_time":                     nullInt64FromInterface(expiryTime),
		"renewal_cycle":                   nullStringFromInterface(renewalCycle),
		"flow_reset_time":                 flowResetTime,
		"traffic_limit":                   trafficLimit,
		"expiry_reminder_dismissed":       0,
		"expiry_reminder_dismissed_until": sql.NullInt64{},
		"traffic_notified_mask":           0,
		"updated_time":                    now,
	}
	if trafficLimit > 0 {
		var existing model.NodeInstance
		if err := r.db.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).First(&existing).Error; err == nil {
			if existing.TrafficLimit <= 0 {
				updates["traffic_limit_mode"] = trafficLimitMode
			}
		}
	}
	if trafficRatio != nil {
		updates["traffic_ratio"] = *trafficRatio
	}
	result := r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("node instance not found")
	}
	return nil
}

func (r *Repository) SyncRemoteNodeInstances(nodeID int64, items []RemoteNodeInstanceSync, now int64) ([]model.NodeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil, errors.New("node id is required")
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	instanceIDs := make([]string, 0, len(items))
	instances := make([]model.NodeInstance, 0)
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var node model.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "remote_instances_updated_time").Where("id = ? AND is_remote = 1", nodeID).First(&node).Error; err != nil {
			return err
		}
		if node.RemoteInstancesUpdatedTime > now {
			return tx.Where("node_id = ?", nodeID).Order("display_index ASC, id ASC").Find(&instances).Error
		}
		result := tx.Model(&model.Node{}).
			Where("id = ? AND remote_instances_updated_time <= ?", nodeID, now).
			Update("remote_instances_updated_time", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return tx.Where("node_id = ?", nodeID).Order("display_index ASC, id ASC").Find(&instances).Error
		}

		seen := make(map[string]struct{}, len(items))
		for _, item := range items {
			instanceID := normalizeNodeInstanceID(item.InstanceID)
			if instanceID == "" {
				continue
			}
			if _, ok := seen[instanceID]; ok {
				continue
			}
			seen[instanceID] = struct{}{}
			instanceIDs = append(instanceIDs, instanceID)
			values := map[string]interface{}{
				"node_id": nodeID, "instance_id": instanceID, "display_name": strings.TrimSpace(item.DisplayName),
				"display_index": item.DisplayIndex, "hostname": strings.TrimSpace(item.Hostname),
				"public_ip_v4": strings.TrimSpace(item.PublicIPV4), "public_ip_v6": strings.TrimSpace(item.PublicIPV6),
				"version": item.Version,
				"status":  item.Status, "weight": item.Weight, "traffic_ratio": item.TrafficRatio,
				"flow_reset_time": item.FlowResetTime, "traffic_limit": item.TrafficLimit,
				"total_in_flow": int64(0), "total_out_flow": int64(0), "period_rx": item.PeriodRx, "period_tx": item.PeriodTx,
				"net_in_speed": item.NetInSpeed, "net_out_speed": item.NetOutSpeed, "net_in_bytes": item.NetInBytes, "net_out_bytes": item.NetOutBytes,
				"tcp_conns": item.TCPConns, "udp_conns": item.UDPConns, "uptime": item.Uptime, "cpu_usage": item.CPUUsage,
				"mem_usage": item.MemUsage, "disk_usage": item.DiskUsage, "last_seen_at": now, "created_time": now, "updated_time": now,
			}
			if item.ExpiryTime > 0 {
				values["expiry_time"] = item.ExpiryTime
			} else {
				values["expiry_time"] = nil
			}
			if item.RenewalCycle != "" {
				values["renewal_cycle"] = item.RenewalCycle
			} else {
				values["renewal_cycle"] = nil
			}
			if err := tx.Model(&model.NodeInstance{}).Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "node_id"}, {Name: "instance_id"}},
				DoUpdates: clause.AssignmentColumns([]string{"display_name", "display_index", "hostname", "public_ip_v4", "public_ip_v6", "version", "status", "weight", "traffic_ratio", "expiry_time", "renewal_cycle", "flow_reset_time", "traffic_limit", "period_rx", "period_tx", "net_in_speed", "net_out_speed", "net_in_bytes", "net_out_bytes", "tcp_conns", "udp_conns", "uptime", "cpu_usage", "mem_usage", "disk_usage", "last_seen_at", "updated_time"}),
			}).Create(values).Error; err != nil {
				return err
			}
		}
		staleQuery := tx.Where("node_id = ? AND updated_time <= ?", nodeID, now)
		if len(instanceIDs) > 0 {
			staleQuery = staleQuery.Where("instance_id NOT IN ?", instanceIDs)
		}
		if err := staleQuery.Delete(&model.NodeInstance{}).Error; err != nil {
			return err
		}
		return tx.Where("node_id = ?", nodeID).Order("display_index ASC, id ASC").Find(&instances).Error
	})
	if instances == nil {
		instances = make([]model.NodeInstance, 0)
	}
	return instances, err
}

func (r *Repository) RefreshNodeInstanceExpiryReminder(nodeID int64, instanceID string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	var inst model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).First(&inst).Error; err != nil {
		return err
	}
	if !inst.RenewalCycle.Valid || strings.TrimSpace(inst.RenewalCycle.String) == "" {
		return errors.New("renewal_cycle not set")
	}
	if !inst.ExpiryTime.Valid || inst.ExpiryTime.Int64 <= 0 {
		return errors.New("expiry_time not set")
	}
	months := renewalCycleMonths(inst.RenewalCycle.String)
	now := time.Now()
	nextExpiry := time.UnixMilli(inst.ExpiryTime.Int64)
	for nextExpiry.Before(now) || nextExpiry.Equal(now) {
		nextExpiry = nextExpiry.AddDate(0, months, 0)
	}
	nextExpiry = nextExpiry.AddDate(0, months, 0)
	return r.db.Model(&model.NodeInstance{}).
		Where("id = ?", inst.ID).
		Updates(map[string]interface{}{
			"expiry_time":                     nextExpiry.UnixMilli(),
			"expiry_reminder_dismissed":       0,
			"expiry_reminder_dismissed_until": sql.NullInt64{},
			"updated_time":                    unixMilliNow(),
		}).Error
}

func (r *Repository) UpdateNodeInstanceExpiryReminderDismissed(nodeID int64, instanceID string, dismissed int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Update("expiry_reminder_dismissed", dismissed).Error
}

func (r *Repository) UpdateNodeInstanceExpiryReminderDismissedUntil(nodeID int64, instanceID string, untilMs int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Update("expiry_reminder_dismissed_until", untilMs).Error
}

func (r *Repository) ListNodeInstancesExpiringWithin(nowMs int64, days int) ([]NodeInstanceExpiryReminder, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	deadline := nowMs + int64(days)*86400000
	twentyFourHoursMs := int64(86400000)
	var rows []NodeInstanceExpiryReminder
	where, args := validNodeInstanceWhere()
	query := r.db.Table("node_instance AS nsi").
		Select(`nsi.node_id, n.name AS node_name, nsi.instance_id, nsi.display_index, COALESCE(nsi.display_name, '') AS display_name, nsi.expiry_time`).
		Joins("JOIN node AS n ON n.id = nsi.node_id").
		Where(where, args...).
		Where("nsi.expiry_time IS NOT NULL AND nsi.expiry_time > ? AND nsi.expiry_time <= ?", 0, deadline).
		Where("nsi.expiry_reminder_dismissed_until IS NULL OR nsi.expiry_reminder_dismissed_until <= ? OR nsi.expiry_reminder_dismissed_until = 0", nowMs-twentyFourHoursMs).
		Order("n.inx ASC, n.id ASC, nsi.display_index ASC, nsi.id ASC")
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *Repository) GetNodeInstanceTrafficLimitInfo(nodeID int64, instanceID string) (*NodeInstanceTrafficLimitItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if nodeID <= 0 || instanceID == "" {
		return nil, nil
	}
	var item NodeInstanceTrafficLimitItem
	err := r.db.Raw(`
		SELECT nsi.node_id, nsi.instance_id,
		       CASE WHEN COALESCE(nsi.display_name, '') <> '' THEN n.name || ' / ' || nsi.display_name ELSE n.name || ' / 实例 ' || nsi.display_index END AS name,
		       nsi.traffic_limit,
		       nsi.total_in_flow + nsi.total_out_flow AS used,
		       nsi.traffic_notified_mask,
		       nsi.total_in_flow,
		       nsi.total_out_flow,
		       nsi.net_in_bytes,
		       nsi.net_out_bytes
		FROM node_instance nsi
		JOIN node n ON n.id = nsi.node_id
		WHERE nsi.node_id = ? AND nsi.instance_id = ?
	`, nodeID, instanceID).Scan(&item).Error
	if err != nil {
		return nil, err
	}
	if item.NodeID == 0 {
		return nil, nil
	}
	return &item, nil
}

func (r *Repository) SetNodeInstanceTotalFlow(nodeID int64, instanceID string, rx, tx int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(map[string]interface{}{
			"total_in_flow":  rx,
			"total_out_flow": tx,
		}).Error
}

func (r *Repository) AdjustNodeInstanceTraffic(nodeID int64, instanceID string, inAdjust, outAdjust int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return nil
	}
	updates := map[string]interface{}{}
	if inAdjust != 0 {
		updates["total_in_flow"] = gorm.Expr("total_in_flow + ?", inAdjust)
	}
	if outAdjust != 0 {
		updates["total_out_flow"] = gorm.Expr("total_out_flow + ?", outAdjust)
	}
	if len(updates) == 0 {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(updates).Error
}

func (r *Repository) ResetNodeInstanceTotalFlow(nodeID int64, instanceID string) error {
	return r.SetNodeInstanceTotalFlow(nodeID, instanceID, 0, 0)
}

func (r *Repository) ResetNodeInstancesTotalFlowByNode(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ?", nodeID).
		Updates(map[string]interface{}{
			"total_in_flow":  0,
			"total_out_flow": 0,
		}).Error
}

func (r *Repository) ResetNodeInstanceRuntimeTrafficByNode(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.NodeInstance{}).
			Where("node_id = ?", nodeID).
			Updates(map[string]interface{}{
				"net_in_bytes": 0, "net_out_bytes": 0,
				"period_rx": 0, "period_tx": 0,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&model.NodeMetric{}).
			Where("node_id = ? AND timestamp = (SELECT MAX(nm.timestamp) FROM node_metric nm WHERE nm.node_id = node_metric.node_id AND nm.instance_id = node_metric.instance_id)", nodeID).
			Updates(map[string]interface{}{
				"net_in_bytes": 0, "net_out_bytes": 0,
				"period_rx": 0, "period_tx": 0,
			}).Error
	})
}

func (r *Repository) UpdateNodeInstanceTrafficNotifiedMask(nodeID int64, instanceID string, mask int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Update("traffic_notified_mask", mask).Error
}

func (r *Repository) ResetNodeInstanceTrafficNotifiedMasksByNode(nodeID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ?", nodeID).
		Update("traffic_notified_mask", 0).Error
}

type NodeInstanceTrafficResetDue struct {
	NodeID       int64
	NodeName     string
	InstanceID   string
	DisplayIndex int
	DisplayName  string
	PeriodRx     int64
	PeriodTx     int64
}

func (r *Repository) ListNodeInstanceMonthlyFlowResetDue(currentDay int, lastDay int) ([]NodeInstanceTrafficResetDue, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	items := make([]NodeInstanceTrafficResetDue, 0)
	where, args := validNodeInstanceWhere()
	query := `
		SELECT nsi.node_id, n.name AS node_name, nsi.instance_id, nsi.display_index, COALESCE(nsi.display_name, '') AS display_name,
		       COALESCE(latest.period_rx, 0) AS period_rx,
		       COALESCE(latest.period_tx, 0) AS period_tx
		FROM node_instance nsi
		JOIN node n ON n.id = nsi.node_id
		LEFT JOIN (
		    SELECT nm1.node_id, nm1.instance_id, nm1.period_rx, nm1.period_tx
		    FROM node_metric nm1
		    INNER JOIN (
		        SELECT node_id, instance_id, MAX(timestamp) AS max_ts
		        FROM node_metric
		        GROUP BY node_id, instance_id
		    ) nm2 ON nm1.node_id = nm2.node_id AND nm1.instance_id = nm2.instance_id AND nm1.timestamp = nm2.max_ts
		) latest ON latest.node_id = nsi.node_id AND latest.instance_id = nsi.instance_id
		WHERE n.status = 1
		  AND nsi.flow_reset_time != 0
		  AND nsi.traffic_limit_mode = 1
		  AND ` + where
	args = append([]interface{}{}, args...)
	if currentDay == lastDay {
		query += ` AND (nsi.flow_reset_time = ? OR nsi.flow_reset_time > ?)`
		args = append(args, currentDay, lastDay)
	} else {
		query += ` AND nsi.flow_reset_time = ?`
		args = append(args, currentDay)
	}
	err := r.db.Raw(query, args...).Scan(&items).Error
	return items, err
}

func renewalCycleMonths(cycle string) int {
	switch strings.TrimSpace(cycle) {
	case "quarter":
		return 3
	case "halfYear":
		return 6
	case "year":
		return 12
	default:
		return 1
	}
}

func (r *Repository) UpdateNodeInstancePortRange(nodeID int64, instanceID string, portRange string, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Updates(map[string]interface{}{"port_range": strings.TrimSpace(portRange), "updated_time": now}).Error
}

func (r *Repository) ListNodeInstances(nodeID int64) ([]model.NodeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil, errors.New("node id is required")
	}
	if err := r.EnsureNodeInstanceDisplayIndexes([]int64{nodeID}); err != nil {
		return nil, err
	}
	var instances []model.NodeInstance
	where, args := validNodeInstanceWhere()
	err := r.db.Where("node_id = ?", nodeID).
		Where(where, args...).
		Order("display_index ASC, id ASC").
		Find(&instances).Error
	return instances, err
}

func (r *Repository) NodeInstanceExists(nodeID int64, instanceID string) (bool, error) {
	if r == nil || r.db == nil || nodeID <= 0 || strings.TrimSpace(instanceID) == "" {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, strings.TrimSpace(instanceID)).
		Count(&count).Error
	return count > 0, err
}

func (r *Repository) AddNodeInstanceTotalFlow(nodeID int64, instanceID string, inFlow, outFlow int64) error {
	if r == nil || r.db == nil || nodeID <= 0 || strings.TrimSpace(instanceID) == "" {
		return nil
	}
	return r.db.Model(&model.NodeInstance{}).
		Where("node_id = ? AND instance_id = ?", nodeID, strings.TrimSpace(instanceID)).
		Updates(map[string]interface{}{
			"total_in_flow":  gorm.Expr("total_in_flow + ?", inFlow),
			"total_out_flow": gorm.Expr("total_out_flow + ?", outFlow),
		}).Error
}

// AddSoleEnabledNodeInstanceTotalFlow attributes raw traffic only when the
// selected node has one unambiguous enabled instance.
func (r *Repository) AddSoleEnabledNodeInstanceTotalFlow(nodeID int64, inFlow, outFlow int64) error {
	if r == nil || r.db == nil || nodeID <= 0 {
		return nil
	}
	var instances []model.NodeInstance
	where, args := validNodeInstanceWhere()
	if err := r.db.Where("node_id = ? AND status = 1 AND weight > 0", nodeID).
		Where(where, args...).
		Limit(2).
		Find(&instances).Error; err != nil {
		return err
	}
	if len(instances) != 1 {
		return nil
	}
	return r.AddNodeInstanceTotalFlow(nodeID, instances[0].InstanceID, inFlow, outFlow)
}

func (r *Repository) UpdateNodeInstanceOrder(nodeID int64, instanceIDs []string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if nodeID <= 0 {
			return fmt.Errorf("%w: node id is required", ErrInvalidNodeInstanceOrder)
		}
		if len(instanceIDs) == 0 {
			return fmt.Errorf("%w: instance ids are required", ErrInvalidNodeInstanceOrder)
		}

		var node model.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", nodeID).First(&node).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("%w: node does not exist", ErrInvalidNodeInstanceOrder)
			}
			return err
		}

		orderedIDs := make([]string, len(instanceIDs))
		requested := make(map[string]struct{}, len(instanceIDs))
		for i, instanceID := range instanceIDs {
			instanceID = strings.TrimSpace(instanceID)
			if instanceID == "" {
				return fmt.Errorf("%w: instance id is required", ErrInvalidNodeInstanceOrder)
			}
			if _, exists := requested[instanceID]; exists {
				return fmt.Errorf("%w: duplicate instance id", ErrInvalidNodeInstanceOrder)
			}
			requested[instanceID] = struct{}{}
			orderedIDs[i] = instanceID
		}

		var instances []model.NodeInstance
		where, args := validNodeInstanceWhere()
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "instance_id").
			Where("node_id = ?", nodeID).
			Where(where, args...).
			Find(&instances).Error; err != nil {
			return err
		}
		if len(instances) != len(orderedIDs) {
			return fmt.Errorf("%w: instance set does not match node", ErrInvalidNodeInstanceOrder)
		}
		instanceRowIDs := make(map[string]int64, len(instances))
		for _, instance := range instances {
			instanceRowIDs[instance.InstanceID] = instance.ID
		}
		for _, instanceID := range orderedIDs {
			if _, exists := instanceRowIDs[instanceID]; !exists {
				return fmt.Errorf("%w: instance set does not match node", ErrInvalidNodeInstanceOrder)
			}
		}

		// Move every row out of the positive range before assigning the final order.
		for i, instanceID := range orderedIDs {
			result := tx.Model(&model.NodeInstance{}).
				Where("id = ? AND node_id = ?", instanceRowIDs[instanceID], nodeID).
				Update("display_index", -(i + 1))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("node instance changed while updating order")
			}
		}
		for i, instanceID := range orderedIDs {
			result := tx.Model(&model.NodeInstance{}).
				Where("id = ? AND node_id = ?", instanceRowIDs[instanceID], nodeID).
				Update("display_index", i+1)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("node instance changed while updating order")
			}
		}
		return nil
	})
}

func (r *Repository) ListOnlineNodeInstancesByNodeIDs(nodeIDs []int64) (map[int64][]model.NodeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	return r.ListOnlineNodeInstancesByNodeIDsTx(r.db, nodeIDs)
}

func (r *Repository) ListOnlineNodeInstancesByNodeIDsTx(tx *gorm.DB, nodeIDs []int64) (map[int64][]model.NodeInstance, error) {
	if tx == nil {
		return nil, errors.New("database unavailable")
	}
	if len(nodeIDs) == 0 {
		return map[int64][]model.NodeInstance{}, nil
	}
	var instances []model.NodeInstance
	where, args := validNodeInstanceWhere()
	if err := r.ensureNodeInstanceDisplayIndexesTx(tx, nodeIDs); err != nil {
		return nil, err
	}
	err := tx.Where("node_id IN ? AND status = ?", nodeIDs, 1).
		Where(where, args...).
		Order("node_id ASC, display_index ASC, id ASC").
		Find(&instances).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int64][]model.NodeInstance)
	for _, inst := range instances {
		result[inst.NodeID] = append(result[inst.NodeID], inst)
	}
	return result, nil
}

func (r *Repository) CountNodeInstancesByNodeIDs(nodeIDs []int64) (map[int64]NodeInstanceCount, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	result := make(map[int64]NodeInstanceCount)
	if len(nodeIDs) == 0 {
		return result, nil
	}
	type row struct {
		NodeID int64 `gorm:"column:node_id"`
		Total  int64 `gorm:"column:total"`
		Online int64 `gorm:"column:online"`
	}
	var rows []row
	where, args := validNodeInstanceWhere()
	err := r.db.Model(&model.NodeInstance{}).
		Select("node_id, COUNT(*) AS total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS online").
		Where("node_id IN ?", nodeIDs).
		Where(where, args...).
		Group("node_id").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		result[item.NodeID] = NodeInstanceCount{Total: item.Total, Online: item.Online}
	}
	return result, nil
}

func (r *Repository) PruneStaleNodeInstances(cutoffMs int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("status = ? AND last_seen_at < ?", 0, cutoffMs).
		Delete(&model.NodeInstance{}).Error
}

func (r *Repository) DeleteNodeInstance(nodeID int64, instanceID string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return errors.New("node id is required")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if instanceID == "" {
		return errors.New("node instance id is required")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.markNodeInstanceDeletedTx(tx, nodeID, instanceID, unixMilliNow()); err != nil {
			return err
		}
		if err := tx.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
			Delete(&model.PeerShareInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.PeerShareRuntimeInstance{}).
			Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
			Updates(map[string]interface{}{"status": 0, "applied": 0, "healthy": 0, "updated_time": unixMilliNow()}).Error; err != nil {
			return err
		}
		return tx.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).Delete(&model.NodeInstance{}).Error
	})
}

func (r *Repository) IsNodeInstanceDeleted(nodeID int64, instanceID string) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if nodeID <= 0 || instanceID == "" {
		return false, nil
	}
	var count int64
	err := r.db.Model(&model.NodeInstanceDeleted{}).
		Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Count(&count).Error
	return count > 0, err
}

func (r *Repository) markNodeInstanceDeletedTx(tx *gorm.DB, nodeID int64, instanceID string, now int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	instanceID = normalizeNodeInstanceID(instanceID)
	if nodeID <= 0 || instanceID == "" {
		return nil
	}
	if now <= 0 {
		now = unixMilliNow()
	}
	row := model.NodeInstanceDeleted{NodeID: nodeID, InstanceID: instanceID, DeletedTime: now}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

func (r *Repository) EnsureNodeInstanceDisplayIndexes(nodeIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.ensureNodeInstanceDisplayIndexesTx(r.db, nodeIDs)
}

func (r *Repository) ensureNodeInstanceDisplayIndexesTx(tx *gorm.DB, nodeIDs []int64) error {
	if tx == nil {
		return errors.New("database unavailable")
	}
	nodeSet := make(map[int64]struct{})
	for _, id := range nodeIDs {
		if id > 0 {
			nodeSet[id] = struct{}{}
		}
	}
	var ids []int64
	if len(nodeSet) > 0 {
		ids = make([]int64, 0, len(nodeSet))
		for id := range nodeSet {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	}
	var instances []model.NodeInstance
	where, args := validNodeInstanceWhere()
	query := tx.Where(where, args...)
	if len(ids) > 0 {
		query = query.Where("node_id IN ?", ids)
	}
	if err := query.Order("node_id ASC, display_index ASC, id ASC").Find(&instances).Error; err != nil {
		return err
	}
	usedByNode := make(map[int64]map[int]struct{})
	missingByNode := make(map[int64][]model.NodeInstance)
	for _, inst := range instances {
		if usedByNode[inst.NodeID] == nil {
			usedByNode[inst.NodeID] = make(map[int]struct{})
		}
		if inst.DisplayIndex > 0 {
			usedByNode[inst.NodeID][inst.DisplayIndex] = struct{}{}
			continue
		}
		missingByNode[inst.NodeID] = append(missingByNode[inst.NodeID], inst)
	}
	for nodeID, missing := range missingByNode {
		for _, inst := range missing {
			next := firstFreeDisplayIndex(usedByNode[nodeID])
			usedByNode[nodeID][next] = struct{}{}
			if err := tx.Model(&model.NodeInstance{}).
				Where("id = ?", inst.ID).
				Update("display_index", next).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Repository) nextNodeInstanceDisplayIndex(nodeID int64) (int, error) {
	var indexes []int
	where, args := validNodeInstanceWhere()
	err := r.db.Model(&model.NodeInstance{}).
		Where("node_id = ?", nodeID).
		Where(where, args...).
		Where("display_index > 0").
		Pluck("display_index", &indexes).Error
	if err != nil {
		return 0, err
	}
	used := make(map[int]struct{}, len(indexes))
	for _, index := range indexes {
		if index > 0 {
			used[index] = struct{}{}
		}
	}
	return firstFreeDisplayIndex(used), nil
}

func firstFreeDisplayIndex(used map[int]struct{}) int {
	for i := 1; ; i++ {
		if _, ok := used[i]; !ok {
			return i
		}
	}
}
