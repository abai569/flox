package repo

import (
	"errors"
	"sort"
	"strings"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
)

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

type NodeInstanceCount struct {
	Total  int64
	Online int64
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
	now := in.Now
	if now <= 0 {
		now = unixMilliNow()
	}

	var existing model.NodeInstance
	err := r.db.Where("node_id = ? AND instance_id = ?", in.NodeID, instanceID).First(&existing).Error
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
	if err := r.EnsureNodeInstanceDisplayIndexes(nodeIDs); err != nil {
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
	return r.db.Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
		Delete(&model.NodeInstance{}).Error
}

func (r *Repository) EnsureNodeInstanceDisplayIndexes(nodeIDs []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
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
	query := r.db.Where(where, args...)
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
			if err := r.db.Model(&model.NodeInstance{}).
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
