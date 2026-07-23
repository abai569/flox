package repo

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"go-backend/internal/store/model"
)

type ForwardTrafficNode struct {
	NodeID          int64
	TrafficRatio    float64
	IsRemote        bool
	AuthoritySource bool
	Layer           string
}

type ForwardTrafficTopology struct {
	TunnelID   int64
	TotalRatio float64
	Nodes      []ForwardTrafficNode
}

type ForwardTrafficNodeDelta struct {
	NodeID   int64
	InFlow   int64
	OutFlow  int64
	IsRemote bool
}

type AuthoritativeNodeFlowSnapshot struct {
	NodeID       int64
	RemoteURL    string
	RemoteToken  string
	TotalInFlow  int64
	TotalOutFlow int64
	Epoch        int64
}

func (r *Repository) ClaimFlowReportItem(scope, sourceID, reportID string, itemIndex int) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	item := model.FlowReportItem{
		Scope:       strings.TrimSpace(scope),
		SourceID:    strings.TrimSpace(sourceID),
		ReportID:    strings.TrimSpace(reportID),
		ItemIndex:   itemIndex,
		CreatedTime: time.Now().UnixMilli(),
	}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&item)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) GetAuthoritativeNodeFlowSnapshot(nodeID int64) (*AuthoritativeNodeFlowSnapshot, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var node struct {
		ID                     int64
		IsRemote               int
		RemoteURL              string
		RemoteToken            string
		TotalInFlow            int64
		TotalOutFlow           int64
		AuthoritativeFlowEpoch int64
	}
	if err := r.db.Model(&model.Node{}).
		Select("id, is_remote, COALESCE(remote_url, '') AS remote_url, COALESCE(remote_token, '') AS remote_token, total_in_flow, total_out_flow, authoritative_flow_epoch").
		Where("id = ?", nodeID).Scan(&node).Error; err != nil {
		return nil, err
	}
	if node.ID == 0 {
		return nil, nil
	}
	epoch := node.AuthoritativeFlowEpoch
	if epoch <= 0 {
		epoch = 1
	}
	return &AuthoritativeNodeFlowSnapshot{
		NodeID:       node.ID,
		RemoteURL:    strings.TrimSpace(node.RemoteURL),
		RemoteToken:  strings.TrimSpace(node.RemoteToken),
		TotalInFlow:  node.TotalInFlow,
		TotalOutFlow: node.TotalOutFlow,
		Epoch:        epoch,
	}, nil
}

func (r *Repository) ListRemoteAuthoritativeNodeFlowSnapshots() ([]AuthoritativeNodeFlowSnapshot, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	if err := r.db.Model(&model.Node{}).Where("is_remote = 1").Order("id ASC").Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	items := make([]AuthoritativeNodeFlowSnapshot, 0, len(ids))
	for _, id := range ids {
		snapshot, err := r.GetAuthoritativeNodeFlowSnapshot(id)
		if err != nil {
			return nil, err
		}
		if snapshot != nil {
			items = append(items, *snapshot)
		}
	}
	return items, nil
}

func (r *Repository) GetForwardTrafficOwnership(forwardID int64) (int64, int64, error) {
	if r == nil || r.db == nil {
		return 0, 0, errors.New("repository not initialized")
	}
	var forward struct {
		ID       int64
		UserID   int64
		TunnelID int64
	}
	if err := r.db.Model(&model.Forward{}).Select("id, user_id, tunnel_id").Where("id = ?", forwardID).Scan(&forward).Error; err != nil {
		return 0, 0, err
	}
	if forward.ID == 0 || forward.UserID <= 0 {
		return 0, 0, errors.New("forward not found")
	}
	var userTunnel struct {
		ID int64
	}
	if err := r.db.Model(&model.UserTunnel{}).
		Where("user_id = ? AND tunnel_id = ?", forward.UserID, forward.TunnelID).
		Select("id").Order("id ASC").Limit(1).Scan(&userTunnel).Error; err != nil {
		return 0, 0, err
	}
	return forward.UserID, userTunnel.ID, nil
}

func (r *Repository) GetTunnelLocalTrafficAuthorityLayer(tunnelID int64) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}
	if tunnelID <= 0 {
		return "", errors.New("invalid tunnel id")
	}
	type row struct {
		ChainType string
		Inx       int
		IsRemote  int
	}
	var rows []row
	if err := r.db.Table("chain_tunnel").
		Select("chain_tunnel.chain_type, COALESCE(chain_tunnel.inx, 0) AS inx, COALESCE(node.is_remote, 0) AS is_remote").
		Joins("JOIN node ON node.id = chain_tunnel.node_id").
		Where("chain_tunnel.tunnel_id = ?", tunnelID).
		Order("chain_tunnel.chain_type ASC, chain_tunnel.inx ASC, chain_tunnel.id ASC").
		Find(&rows).Error; err != nil {
		return "", err
	}
	type layerState struct {
		name     string
		hasNode  bool
		hasLocal bool
	}
	layers := make([]layerState, 0)
	layerIndex := make(map[string]int)
	for _, item := range rows {
		layer := "entry"
		if item.ChainType == "2" {
			layer = fmt.Sprintf("middle:%d", item.Inx)
		} else if item.ChainType == "3" {
			layer = "exit"
		}
		idx, ok := layerIndex[layer]
		if !ok {
			idx = len(layers)
			layerIndex[layer] = idx
			layers = append(layers, layerState{name: layer})
		}
		layers[idx].hasNode = true
		layers[idx].hasLocal = layers[idx].hasLocal || item.IsRemote != 1
	}
	for _, layer := range layers {
		if layer.hasNode && layer.hasLocal {
			return layer.name, nil
		}
	}
	return "", errors.New("隧道没有可用于权威流量统计的本地节点层")
}

func (r *Repository) AddAuthoritativeForwardTraffic(forwardID, userID, userTunnelID int64, inFlow, outFlow, rawIn, rawOut, sourceNodeID int64, sourceInstanceID string, nodes []ForwardTrafficNodeDelta) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	sourceInstanceID = strings.TrimSpace(sourceInstanceID)
	if sourceNodeID <= 0 {
		return errors.New("authoritative source node is required")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.Forward{}).Where("id = ?", forwardID).
			UpdateColumns(map[string]interface{}{
				"in_flow":  gorm.Expr("in_flow + ?", inFlow),
				"out_flow": gorm.Expr("out_flow + ?", outFlow),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("forward not found")
		}
		if err := tx.Model(&model.User{}).Where("id = ?", userID).
			UpdateColumns(map[string]interface{}{
				"in_flow":  gorm.Expr("in_flow + ?", inFlow),
				"out_flow": gorm.Expr("out_flow + ?", outFlow),
			}).Error; err != nil {
			return err
		}
		if userTunnelID > 0 {
			if err := tx.Model(&model.UserTunnel{}).Where("id = ?", userTunnelID).
				UpdateColumns(map[string]interface{}{
					"in_flow":  gorm.Expr("in_flow + ?", inFlow),
					"out_flow": gorm.Expr("out_flow + ?", outFlow),
				}).Error; err != nil {
				return err
			}
		}
		for _, node := range nodes {
			if err := tx.Model(&model.Node{}).Where("id = ?", node.NodeID).
				Updates(map[string]interface{}{
					"total_in_flow":  gorm.Expr("total_in_flow + ?", node.InFlow),
					"total_out_flow": gorm.Expr("total_out_flow + ?", node.OutFlow),
				}).Error; err != nil {
				return err
			}
			var instances []model.NodeInstance
			where, args := validNodeInstanceWhere()
			if err := tx.Where("node_id = ? AND status = 1 AND weight > 0", node.NodeID).
				Where("(expiry_time IS NULL OR expiry_time <= 0 OR expiry_time > ?)", time.Now().UnixMilli()).
				Where(where, args...).Order("display_index ASC, instance_id ASC").Find(&instances).Error; err != nil {
				return err
			}
			for index, instance := range instances {
				instanceIn := rawIn / int64(len(instances))
				instanceOut := rawOut / int64(len(instances))
				if int64(index) < rawIn%int64(len(instances)) {
					instanceIn++
				}
				if int64(index) < rawOut%int64(len(instances)) {
					instanceOut++
				}
				if err := tx.Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Updates(map[string]interface{}{
					"total_in_flow":  gorm.Expr("total_in_flow + ?", instanceIn),
					"total_out_flow": gorm.Expr("total_out_flow + ?", instanceOut),
				}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (r *Repository) AddNonAuthoritativeLocalForwardInstanceTraffic(forwardID, nodeID int64, instanceID string, inFlow, outFlow int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = strings.TrimSpace(instanceID)
	if forwardID <= 0 || nodeID <= 0 || instanceID == "" {
		return errors.New("forward, node, and instance are required")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Table("forward_port").Where("forward_id = ? AND node_id = ?", forwardID, nodeID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			var tunnelID int64
			if err := tx.Model(&model.Forward{}).Where("id = ?", forwardID).Pluck("tunnel_id", &tunnelID).Error; err != nil {
				return err
			}
			if tunnelID <= 0 {
				return errors.New("forward not found")
			}
			if err := tx.Table("chain_tunnel").Where("tunnel_id = ? AND node_id = ?", tunnelID, nodeID).Count(&count).Error; err != nil {
				return err
			}
		}
		if count == 0 {
			return errors.New("node is not in forward topology")
		}
		var isRemote int
		if err := tx.Model(&model.Node{}).Where("id = ?", nodeID).Pluck("is_remote", &isRemote).Error; err != nil {
			return err
		}
		if isRemote == 1 {
			return errors.New("node is not local")
		}
		result := tx.Model(&model.NodeInstance{}).Where("node_id = ? AND instance_id = ?", nodeID, instanceID).
			Updates(map[string]interface{}{
				"total_in_flow":  gorm.Expr("total_in_flow + ?", inFlow),
				"total_out_flow": gorm.Expr("total_out_flow + ?", outFlow),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("node instance not found")
		}
		return nil
	})
}

func (r *Repository) AddLocalTunnelInstanceTraffic(tunnelID, nodeID int64, instanceID string, rawIn, rawOut int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	instanceID = strings.TrimSpace(instanceID)
	if tunnelID <= 0 || nodeID <= 0 || instanceID == "" {
		return errors.New("tunnel, node, and instance are required")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var node struct {
			ID           int64
			IsRemote     int
			TrafficRatio float64
		}
		if err := tx.Model(&model.Node{}).Select("id, is_remote, traffic_ratio").Where("id = ?", nodeID).Scan(&node).Error; err != nil {
			return err
		}
		if node.ID == 0 {
			return errors.New("node not found")
		}
		if node.IsRemote == 1 {
			return errors.New("node is not local")
		}
		var count int64
		if err := tx.Model(&model.ChainTunnel{}).
			Where("tunnel_id = ? AND node_id = ? AND chain_type IN ?", tunnelID, nodeID, []string{"2", "3"}).
			Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errors.New("node is not a local tunnel relay")
		}
		var instances []model.NodeInstance
		where, args := validNodeInstanceWhere()
		if err := tx.Where("node_id = ? AND status = 1 AND weight > 0", nodeID).
			Where("(expiry_time IS NULL OR expiry_time <= 0 OR expiry_time > ?)", time.Now().UnixMilli()).
			Where(where, args...).Order("display_index ASC, instance_id ASC").Find(&instances).Error; err != nil {
			return err
		}
		if len(instances) == 0 {
			return errors.New("node instance not found")
		}
		for index, instance := range instances {
			instanceIn := rawIn / int64(len(instances))
			instanceOut := rawOut / int64(len(instances))
			if int64(index) < rawIn%int64(len(instances)) {
				instanceIn++
			}
			if int64(index) < rawOut%int64(len(instances)) {
				instanceOut++
			}
			if err := tx.Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Updates(map[string]interface{}{
				"total_in_flow":  gorm.Expr("total_in_flow + ?", instanceIn),
				"total_out_flow": gorm.Expr("total_out_flow + ?", instanceOut),
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) UpdateForwardStatus(forwardID int64, status int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Forward{}).Where("id = ?", forwardID).Updates(map[string]interface{}{
		"status": status, "updated_time": now,
	}).Error
}

func (r *Repository) GetForwardFlow(forwardID int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	var forward model.Forward
	err := r.db.Select("in_flow, out_flow").Where("id = ?", forwardID).First(&forward).Error
	if err != nil {
		return 0, err
	}
	return forward.InFlow + forward.OutFlow, nil
}

// ✅ 新增：查询已过期的活跃 Forward 规则
func (r *Repository) ListExpiredActiveForwards(nowMs int64) ([]model.Forward, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("status = 1 AND expiry_time IS NOT NULL AND expiry_time > 0 AND expiry_time <= ?", nowMs).
		Find(&forwards).Error
	return forwards, err
}

func (r *Repository) ListActiveForwardsByUser(userID int64) ([]model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("user_id = ? AND status = 1", userID).Order("id ASC").Find(&forwards).Error
	if err != nil {
		return nil, err
	}
	rows := make([]model.ForwardRecord, 0, len(forwards))
	for _, f := range forwards {
		rows = append(rows, model.ForwardRecord{
			ID:                f.ID,
			UserID:            f.UserID,
			UserName:          f.UserName,
			Name:              f.Name,
			TunnelID:          f.TunnelID,
			RemoteAddr:        f.RemoteAddr,
			Strategy:          f.Strategy,
			Status:            f.Status,
			SpeedID:           f.SpeedID,
			SpeedLimitEnabled: f.SpeedLimitEnabled,
			SpeedLimit:        f.SpeedLimit,
			MaxConnections:    f.MaxConnections,
			Mode:              f.Mode,
		})
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].Strategy) == "" {
			rows[i].Strategy = "fifo"
		}
	}
	return rows, nil
}

func (r *Repository) CountActiveForwardsByUser(userID int64) (int64, error) {
	var count int64
	err := r.db.Model(&model.Forward{}).Where("user_id = ? AND status = 1", userID).Count(&count).Error
	return count, err
}

func (r *Repository) CountActiveForwardsByUserTunnel(userID, tunnelID int64) (int64, error) {
	var count int64
	err := r.db.Model(&model.Forward{}).Where("user_id = ? AND tunnel_id = ? AND status = 1", userID, tunnelID).Count(&count).Error
	return count, err
}

func (r *Repository) ListPausedForwardsByUser(userID int64) ([]model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("user_id = ? AND status = 0", userID).Order("id ASC").Find(&forwards).Error
	if err != nil {
		return nil, err
	}
	rows := make([]model.ForwardRecord, 0, len(forwards))
	for _, f := range forwards {
		rows = append(rows, model.ForwardRecord{
			ID:                f.ID,
			UserID:            f.UserID,
			UserName:          f.UserName,
			Name:              f.Name,
			TunnelID:          f.TunnelID,
			RemoteAddr:        f.RemoteAddr,
			Strategy:          f.Strategy,
			Status:            f.Status,
			SpeedID:           f.SpeedID,
			SpeedLimitEnabled: f.SpeedLimitEnabled,
			SpeedLimit:        f.SpeedLimit,
			MaxConnections:    f.MaxConnections,
			Mode:              f.Mode,
		})
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].Strategy) == "" {
			rows[i].Strategy = "fifo"
		}
	}
	return rows, nil
}

func (r *Repository) ListActiveForwardsByUserTunnel(userID, tunnelID int64) ([]model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("user_id = ? AND tunnel_id = ? AND status = 1", userID, tunnelID).Order("id ASC").Find(&forwards).Error
	if err != nil {
		return nil, err
	}
	rows := make([]model.ForwardRecord, 0, len(forwards))
	for _, f := range forwards {
		rows = append(rows, model.ForwardRecord{
			ID:                f.ID,
			UserID:            f.UserID,
			UserName:          f.UserName,
			Name:              f.Name,
			TunnelID:          f.TunnelID,
			RemoteAddr:        f.RemoteAddr,
			Strategy:          f.Strategy,
			Status:            f.Status,
			SpeedID:           f.SpeedID,
			SpeedLimitEnabled: f.SpeedLimitEnabled,
			SpeedLimit:        f.SpeedLimit,
			MaxConnections:    f.MaxConnections,
			Mode:              f.Mode,
		})
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].Strategy) == "" {
			rows[i].Strategy = "fifo"
		}
	}
	return rows, nil
}

func (r *Repository) ListActiveForwardsByTunnel(tunnelID int64) ([]model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("tunnel_id = ? AND status = 1", tunnelID).Order("id ASC").Find(&forwards).Error
	if err != nil {
		return nil, err
	}
	rows := make([]model.ForwardRecord, 0, len(forwards))
	for _, f := range forwards {
		rows = append(rows, model.ForwardRecord{
			ID:                f.ID,
			UserID:            f.UserID,
			UserName:          f.UserName,
			Name:              f.Name,
			TunnelID:          f.TunnelID,
			RemoteAddr:        f.RemoteAddr,
			Strategy:          f.Strategy,
			Status:            f.Status,
			SpeedID:           f.SpeedID,
			SpeedLimitEnabled: f.SpeedLimitEnabled,
			SpeedLimit:        f.SpeedLimit,
			MaxConnections:    f.MaxConnections,
			Mode:              f.Mode,
		})
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].Strategy) == "" {
			rows[i].Strategy = "fifo"
		}
	}
	return rows, nil
}

func (r *Repository) ListForwardsByUserAndTunnel(userID, tunnelID int64) ([]model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forwards []model.Forward
	err := r.db.Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).Order("id ASC").Find(&forwards).Error
	if err != nil {
		return nil, err
	}
	rows := make([]model.ForwardRecord, 0, len(forwards))
	for _, f := range forwards {
		rows = append(rows, model.ForwardRecord{
			ID:                f.ID,
			UserID:            f.UserID,
			UserName:          f.UserName,
			Name:              f.Name,
			TunnelID:          f.TunnelID,
			RemoteAddr:        f.RemoteAddr,
			Strategy:          f.Strategy,
			Status:            f.Status,
			SpeedID:           f.SpeedID,
			SpeedLimitEnabled: f.SpeedLimitEnabled,
			SpeedLimit:        f.SpeedLimit,
			MaxConnections:    f.MaxConnections,
			Mode:              f.Mode,
		})
	}
	for i := range rows {
		if strings.TrimSpace(rows[i].Strategy) == "" {
			rows[i].Strategy = "fifo"
		}
	}
	return rows, nil
}

func (r *Repository) GetForwardRecord(forwardID int64) (*model.ForwardRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var f model.Forward
	err := r.db.Where("id = ?", forwardID).First(&f).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	fr := model.ForwardRecord{
		ID:                f.ID,
		UserID:            f.UserID,
		UserName:          f.UserName,
		Name:              f.Name,
		TunnelID:          f.TunnelID,
		RemoteAddr:        f.RemoteAddr,
		Strategy:          f.Strategy,
		Status:            f.Status,
		SpeedID:           f.SpeedID,
		MaxConnections:    f.MaxConnections,
		TrafficLimit:      f.TrafficLimit,
		ExpiryTime:        f.ExpiryTime,
		SpeedLimitEnabled: f.SpeedLimitEnabled,
		SpeedLimit:        f.SpeedLimit,
		Mode:              f.Mode,
		InFlow:            f.InFlow,
		OutFlow:           f.OutFlow,
	}
	if strings.TrimSpace(fr.Strategy) == "" {
		fr.Strategy = "fifo"
	}
	return &fr, nil
}

func (r *Repository) GetTunnelRecord(tunnelID int64) (*model.TunnelRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var t model.Tunnel
	err := r.db.Where("id = ?", tunnelID).First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	tr := model.TunnelRecord{
		ID:           t.ID,
		Type:         t.Type,
		Status:       t.Status,
		Flow:         t.Flow,
		TrafficRatio: t.TrafficRatio,
	}
	if tr.Flow <= 0 {
		tr.Flow = 1
	}
	if tr.TrafficRatio <= 0 {
		tr.TrafficRatio = 1
	}
	return &tr, nil
}

func (r *Repository) TunnelExists(tunnelID int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var count int64
	err := r.db.Model(&model.Tunnel{}).Where("id = ?", tunnelID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *Repository) ForwardExists(forwardID int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var count int64
	err := r.db.Model(&model.Forward{}).Where("id = ?", forwardID).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// MapForwardIDsToTunnelIDs returns a mapping from forward.id to forward.tunnel_id.
// Missing forward IDs are omitted from the returned map.
func (r *Repository) MapForwardIDsToTunnelIDs(forwardIDs []int64) (map[int64]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(forwardIDs) == 0 {
		return map[int64]int64{}, nil
	}

	// Deduplicate and filter invalid IDs.
	ids := make([]int64, 0, len(forwardIDs))
	seen := make(map[int64]struct{}, len(forwardIDs))
	for _, id := range forwardIDs {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return map[int64]int64{}, nil
	}

	type row struct {
		ID       int64 `gorm:"column:id"`
		TunnelID int64 `gorm:"column:tunnel_id"`
	}

	out := make(map[int64]int64, len(ids))
	const chunkSize = 500
	for start := 0; start < len(ids); start += chunkSize {
		end := start + chunkSize
		if end > len(ids) {
			end = len(ids)
		}

		var rows []row
		if err := r.db.Model(&model.Forward{}).
			Select("id", "tunnel_id").
			Where("id IN ?", ids[start:end]).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, r := range rows {
			if r.ID <= 0 || r.TunnelID <= 0 {
				continue
			}
			out[r.ID] = r.TunnelID
		}
	}

	return out, nil
}

func (r *Repository) SpeedLimitExists(id int64) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var count int64
	err := r.db.Model(&model.SpeedLimit{}).Where("id = ?", id).Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *Repository) GetSpeedLimitSpeed(id int64) (int, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	var sl model.SpeedLimit
	err := r.db.Select("speed").Where("id = ? AND status = 1", id).First(&sl).Error
	if err != nil {
		return 0, err
	}
	return sl.Speed, nil
}

func (r *Repository) ListForwardIDsBySpeedLimit(id int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.Forward{}).
		Joins("LEFT JOIN user_tunnel ON user_tunnel.user_id = forward.user_id AND user_tunnel.tunnel_id = forward.tunnel_id").
		Where("forward.speed_id = ? OR user_tunnel.speed_id = ?", id, id).
		Distinct("forward.id").
		Order("forward.id ASC").
		Pluck("forward.id", &ids).Error
	return ids, err
}

type ForwardTrafficResetLogItem struct {
	ID            int64  `json:"id"`
	ForwardID     int64  `json:"forwardId"`
	ForwardName   string `json:"forwardName"`
	UserID        int64  `json:"userId"`
	UserName      string `json:"userName"`
	ResetTime     int64  `json:"resetTime"`
	InFlowBefore  int64  `json:"inFlowBefore"`
	OutFlowBefore int64  `json:"outFlowBefore"`
	OperatorID    int64  `json:"operatorId"`
	OperatorName  string `json:"operatorName"`
	Reason        string `json:"reason"`
	CreatedTime   int64  `json:"createdTime"`
}

func (r *Repository) GetForwardTrafficResetLogs(forwardID int64, limit int) ([]ForwardTrafficResetLogItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if forwardID <= 0 {
		return nil, errors.New("forward id is required")
	}
	if limit <= 0 {
		limit = 30
	}

	var logs []model.ForwardTrafficResetLog
	err := r.db.Where("forward_id = ?", forwardID).
		Order("created_time DESC").
		Limit(limit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}

	items := make([]ForwardTrafficResetLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, ForwardTrafficResetLogItem{
			ID:            log.ID,
			ForwardID:     log.ForwardID,
			ForwardName:   log.ForwardName,
			UserID:        log.UserID,
			UserName:      log.UserName,
			ResetTime:     log.ResetTime,
			InFlowBefore:  log.InFlowBefore,
			OutFlowBefore: log.OutFlowBefore,
			OperatorID:    log.OperatorID,
			OperatorName:  log.OperatorName,
			Reason:        log.Reason,
			CreatedTime:   log.CreatedTime,
		})
	}

	return items, nil
}

func (r *Repository) DeleteForwardTrafficResetLog(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if id <= 0 {
		return errors.New("invalid log id")
	}
	return r.db.Delete(&model.ForwardTrafficResetLog{}, id).Error
}

type NodeTrafficResetLogItem struct {
	ID            int64  `json:"id"`
	NodeID        int64  `json:"nodeId"`
	NodeName      string `json:"nodeName"`
	InstanceID    string `json:"instanceId"`
	InstanceName  string `json:"instanceName"`
	ResetTime     int64  `json:"resetTime"`
	OperatorID    int64  `json:"operatorId"`
	OperatorName  string `json:"operatorName"`
	Reason        string `json:"reason"`
	InFlowBefore  int64  `json:"inFlowBefore"`
	OutFlowBefore int64  `json:"outFlowBefore"`
	CreatedTime   int64  `json:"createdTime"`
}

func (r *Repository) GetNodeTrafficResetLogs(nodeID int64, limit int) ([]NodeTrafficResetLogItem, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if nodeID <= 0 {
		return nil, errors.New("node id is required")
	}
	if limit <= 0 {
		limit = 30
	}

	var logs []model.NodeTrafficResetLog
	err := r.db.Where("node_id = ?", nodeID).
		Order("created_time DESC").
		Limit(limit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}

	items := make([]NodeTrafficResetLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, NodeTrafficResetLogItem{
			ID:            log.ID,
			NodeID:        log.NodeID,
			NodeName:      log.NodeName,
			InstanceID:    log.InstanceID,
			InstanceName:  log.InstanceName,
			ResetTime:     log.ResetTime,
			OperatorID:    log.OperatorID,
			OperatorName:  log.OperatorName,
			Reason:        log.Reason,
			InFlowBefore:  log.InFlowBefore,
			OutFlowBefore: log.OutFlowBefore,
			CreatedTime:   log.CreatedTime,
		})
	}

	return items, nil
}

func (r *Repository) DeleteNodeTrafficResetLog(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if id <= 0 {
		return errors.New("invalid log id")
	}
	return r.db.Delete(&model.NodeTrafficResetLog{}, id).Error
}

func (r *Repository) ListNodeIDsByTunnelIDs(tunnelIDs []int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(tunnelIDs) == 0 {
		return nil, nil
	}

	// Entry nodes (via forward_port → forward)
	var entryIDs []int64
	if err := r.db.Model(&model.ForwardPort{}).
		Select("DISTINCT forward_port.node_id").
		Joins("JOIN forward ON forward.id = forward_port.forward_id").
		Where("forward.tunnel_id IN ?", tunnelIDs).
		Pluck("forward_port.node_id", &entryIDs).Error; err != nil {
		return nil, err
	}

	// Middle and exit nodes (via chain_tunnel)
	var chainIDs []int64
	if err := r.db.Model(&model.ChainTunnel{}).
		Where("tunnel_id IN ? AND chain_type IN ?", tunnelIDs, []string{"2", "3"}).
		Pluck("node_id", &chainIDs).Error; err != nil {
		return nil, err
	}

	// Merge and deduplicate
	seen := make(map[int64]struct{}, len(entryIDs)+len(chainIDs))
	result := make([]int64, 0, len(entryIDs)+len(chainIDs))
	for _, id := range entryIDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	for _, id := range chainIDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	return result, nil
}

// GetForwardTrafficTopology resolves all tunnel members and identifies whether the
// reporting node belongs to the local layer that owns user traffic accounting.
func (r *Repository) GetForwardTrafficTopology(forwardID, entryNodeID int64) (*ForwardTrafficTopology, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var forward struct {
		TunnelID int64
	}
	if err := r.db.Table("forward").
		Select("tunnel_id").
		Where("forward.id = ?", forwardID).
		First(&forward).Error; err != nil {
		return nil, err
	}
	type trafficNodeRow struct {
		NodeID       int64
		TrafficRatio float64
		IsRemote     int
		ChainType    string
		Inx          int
		ID           int64
	}
	var entries []trafficNodeRow
	if err := r.db.Table("forward_port").
		Select("forward_port.id, forward_port.node_id, COALESCE(node.traffic_ratio, 1.0) AS traffic_ratio, COALESCE(node.is_remote, 0) AS is_remote").
		Joins("JOIN node ON node.id = forward_port.node_id").
		Where("forward_port.forward_id = ? AND forward_port.chain_type IN ?", forwardID, []int{0, 1}).
		Order("forward_port.id ASC").
		Find(&entries).Error; err != nil {
		return nil, err
	}
	var chainNodes []trafficNodeRow
	if err := r.db.Table("chain_tunnel").
		Select("chain_tunnel.id, chain_tunnel.node_id, chain_tunnel.chain_type, COALESCE(chain_tunnel.inx, 0) AS inx, COALESCE(node.traffic_ratio, 1.0) AS traffic_ratio, COALESCE(node.is_remote, 0) AS is_remote").
		Joins("JOIN node ON node.id = chain_tunnel.node_id").
		Where("chain_tunnel.tunnel_id = ? AND chain_tunnel.chain_type IN ?", forward.TunnelID, []string{"2", "3"}).
		Order("chain_tunnel.chain_type ASC, chain_tunnel.inx ASC, chain_tunnel.id ASC").
		Find(&chainNodes).Error; err != nil {
		return nil, err
	}
	normalizeRatio := func(ratio float64) float64 {
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio <= 0 {
			return 1
		}
		return ratio
	}
	result := &ForwardTrafficTopology{TunnelID: forward.TunnelID}
	type trafficLayer struct {
		name  string
		nodes []trafficNodeRow
	}
	layers := make([]trafficLayer, 0, len(chainNodes)+1)
	if len(entries) > 0 {
		layers = append(layers, trafficLayer{name: "entry", nodes: entries})
	}
	layerIndexes := make(map[string]int)
	for _, node := range chainNodes {
		layer := node.ChainType
		if node.ChainType == "2" {
			layer = fmt.Sprintf("middle:%d", node.Inx)
		}
		idx, exists := layerIndexes[layer]
		if !exists {
			idx = len(layers)
			layerIndexes[layer] = idx
			layers = append(layers, trafficLayer{name: layer})
		}
		layers[idx].nodes = append(layers[idx].nodes, node)
	}
	for _, layer := range layers {
		uniqueNodes := make([]trafficNodeRow, 0, len(layer.nodes))
		seenNodeIDs := make(map[int64]struct{}, len(layer.nodes))
		maxRatio := 0.0
		for _, node := range layer.nodes {
			if node.NodeID <= 0 {
				continue
			}
			ratio := normalizeRatio(node.TrafficRatio)
			if ratio > maxRatio {
				maxRatio = ratio
			}
			if _, seen := seenNodeIDs[node.NodeID]; seen {
				continue
			}
			seenNodeIDs[node.NodeID] = struct{}{}
			uniqueNodes = append(uniqueNodes, node)
		}
		result.TotalRatio += maxRatio
		for _, node := range uniqueNodes {
			result.Nodes = append(result.Nodes, ForwardTrafficNode{
				NodeID:       node.NodeID,
				TrafficRatio: normalizeRatio(node.TrafficRatio),
				IsRemote:     node.IsRemote == 1,
				Layer:        layer.name,
			})
		}
	}
	authorityLayer := ""
	for _, layer := range layers {
		for _, node := range layer.nodes {
			if node.IsRemote != 1 {
				authorityLayer = layer.name
				break
			}
		}
		if authorityLayer != "" {
			break
		}
	}
	foundMember := false
	for i := range result.Nodes {
		if result.Nodes[i].NodeID != entryNodeID {
			continue
		}
		foundMember = true
		result.Nodes[i].AuthoritySource = result.Nodes[i].Layer == authorityLayer && !result.Nodes[i].IsRemote
	}
	if !foundMember {
		return nil, fmt.Errorf("node %d is not in forward %d topology", entryNodeID, forwardID)
	}
	if result.TotalRatio <= 0 {
		result.TotalRatio = 1
	}
	return result, nil
}
