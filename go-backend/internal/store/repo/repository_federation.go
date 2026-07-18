package repo

import (
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"

	"go-backend/internal/store/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RemoteNodeRow holds the columns fetched for a remote node listing.
type RemoteNodeRow struct {
	ID           int64
	Name         string
	RemoteURL    sql.NullString
	RemoteToken  sql.NullString
	RemoteConfig sql.NullString
}

// NodeBasicInfo holds name, server_ip, and status for a node.
type NodeBasicInfo struct {
	Name     string
	ServerIP string
	Status   int
}

// FederationBindingRow holds the columns for an active federation tunnel binding.
type FederationBindingRow struct {
	ID              int64
	TunnelID        int64
	TunnelName      string
	ChainType       int
	HopInx          int
	AllocatedPort   int
	ResourceKey     string
	RemoteBindingID string
	UpdatedTime     int64
}

type ActiveForwardPortRow struct {
	ForwardID   int64
	TunnelID    int64
	TunnelName  string
	Port        int
	UpdatedTime int64
}

func (r *Repository) ReplacePeerShareInstances(shareID, nodeID int64, instanceIDs []string, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if shareID <= 0 || nodeID <= 0 {
		return errors.New("share id and node id are required")
	}
	if now <= 0 {
		now = time.Now().UnixMilli()
	}
	seen := make(map[string]struct{}, len(instanceIDs))
	items := make([]model.PeerShareInstance, 0, len(instanceIDs))
	for _, raw := range instanceIDs {
		instanceID := strings.TrimSpace(raw)
		if instanceID == "" {
			continue
		}
		if _, ok := seen[instanceID]; ok {
			continue
		}
		seen[instanceID] = struct{}{}
		items = append(items, model.PeerShareInstance{ShareID: shareID, NodeID: nodeID, InstanceID: instanceID, CreatedTime: now, UpdatedTime: now})
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("share_id = ?", shareID).Delete(&model.PeerShareInstance{}).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		return tx.Create(&items).Error
	})
}

func (r *Repository) CreatePeerShareInstance(item *model.PeerShareInstance) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if item == nil {
		return errors.New("share instance is nil")
	}
	return r.db.Create(item).Error
}

func (r *Repository) GetPeerShareInstance(shareID int64, instanceID string) (*model.PeerShareInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var item model.PeerShareInstance
	err := r.db.Where("share_id = ? AND instance_id = ?", shareID, strings.TrimSpace(instanceID)).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) UpdatePeerShareInstance(item *model.PeerShareInstance) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if item == nil || item.ID <= 0 {
		return errors.New("share instance is invalid")
	}
	return r.db.Model(&model.PeerShareInstance{}).Where("id = ?", item.ID).Updates(map[string]interface{}{
		"node_id": item.NodeID, "instance_id": strings.TrimSpace(item.InstanceID), "updated_time": item.UpdatedTime,
	}).Error
}

func (r *Repository) DeletePeerShareInstance(shareID int64, instanceID string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("share_id = ? AND instance_id = ?", shareID, strings.TrimSpace(instanceID)).Delete(&model.PeerShareInstance{}).Error
}

func (r *Repository) ListPeerShareInstances(shareID int64) ([]model.PeerShareInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.PeerShareInstance
	err := r.db.Where("share_id = ?", shareID).Order("instance_id ASC").Find(&items).Error
	if items == nil {
		items = make([]model.PeerShareInstance, 0)
	}
	return items, err
}

func (r *Repository) ListPeerSharesByNodeID(nodeID int64) ([]model.PeerShare, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.PeerShare
	err := r.db.Where("node_id = ?", nodeID).Order("id ASC").Find(&items).Error
	return items, err
}

func (r *Repository) UpsertPeerShareRuntimeInstance(item *model.PeerShareRuntimeInstance) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if item == nil || item.RuntimeID <= 0 || strings.TrimSpace(item.InstanceID) == "" {
		return errors.New("runtime instance is invalid")
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "runtime_id"}, {Name: "instance_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"share_id", "node_id", "port", "applied", "healthy", "status", "last_error", "updated_time"}),
	}).Create(item).Error
}

func (r *Repository) CreatePeerShareRuntimeInstance(item *model.PeerShareRuntimeInstance) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if item == nil {
		return errors.New("runtime instance is nil")
	}
	return r.db.Create(item).Error
}

func (r *Repository) GetPeerShareRuntimeInstance(runtimeID int64, instanceID string) (*model.PeerShareRuntimeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var item model.PeerShareRuntimeInstance
	err := r.db.Where("runtime_id = ? AND instance_id = ?", runtimeID, strings.TrimSpace(instanceID)).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) UpdatePeerShareRuntimeInstance(item *model.PeerShareRuntimeInstance) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if item == nil || item.ID <= 0 {
		return errors.New("runtime instance is invalid")
	}
	return r.db.Model(&model.PeerShareRuntimeInstance{}).Where("id = ?", item.ID).Updates(map[string]interface{}{
		"port": item.Port, "applied": item.Applied, "healthy": item.Healthy, "status": item.Status,
		"last_error": item.LastError, "current_flow": item.CurrentFlow, "updated_time": item.UpdatedTime,
	}).Error
}

func (r *Repository) DeletePeerShareRuntimeInstance(runtimeID int64, instanceID string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("runtime_id = ? AND instance_id = ?", runtimeID, strings.TrimSpace(instanceID)).Delete(&model.PeerShareRuntimeInstance{}).Error
}

func (r *Repository) ListPeerShareRuntimeInstances(runtimeID int64) ([]model.PeerShareRuntimeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.PeerShareRuntimeInstance
	err := r.db.Where("runtime_id = ?", runtimeID).Order("instance_id ASC").Find(&items).Error
	if items == nil {
		items = make([]model.PeerShareRuntimeInstance, 0)
	}
	return items, err
}

func (r *Repository) ListActivePeerShareRuntimeInstancesByShareID(shareID int64) ([]model.PeerShareRuntimeInstance, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.PeerShareRuntimeInstance
	err := r.db.Where("share_id = ? AND status = 1", shareID).Order("runtime_id ASC, instance_id ASC").Find(&items).Error
	if items == nil {
		items = make([]model.PeerShareRuntimeInstance, 0)
	}
	return items, err
}

func (r *Repository) ReservePeerShareRuntimePort(share *model.PeerShare, resourceKey, reservationID, protocol string, requestedPort int, now int64) (*model.PeerShareRuntime, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if share == nil || share.ID <= 0 || share.NodeID <= 0 {
		return nil, errors.New("share is invalid")
	}
	resourceKey = strings.TrimSpace(resourceKey)
	if resourceKey == "" {
		return nil, errors.New("resource key is required")
	}
	if now <= 0 {
		now = time.Now().UnixMilli()
	}
	var reserved model.PeerShareRuntime
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// All shares for a node draw from the same port space.
		var node model.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", share.NodeID).First(&node).Error; err != nil {
			return err
		}

		var existing model.PeerShareRuntime
		existingErr := tx.Where("share_id = ? AND resource_key = ?", share.ID, resourceKey).First(&existing).Error
		if existingErr == nil && existing.Status == 1 {
			reserved = existing
			return nil
		}
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}

		used := make(map[int]struct{})
		var chainPorts []int
		if err := tx.Model(&model.ChainTunnel{}).Where("node_id = ? AND port > 0", share.NodeID).Pluck("port", &chainPorts).Error; err != nil {
			return err
		}
		var forwardPorts []int
		if err := tx.Model(&model.ForwardPort{}).Where("node_id = ? AND port > 0", share.NodeID).Pluck("port", &forwardPorts).Error; err != nil {
			return err
		}
		var runtimePorts []int
		runtimeQuery := tx.Model(&model.PeerShareRuntime{}).Where("node_id = ? AND status = 1 AND port > 0", share.NodeID)
		if existing.ID > 0 {
			runtimeQuery = runtimeQuery.Where("id <> ?", existing.ID)
		}
		if err := runtimeQuery.Pluck("port", &runtimePorts).Error; err != nil {
			return err
		}
		for _, ports := range [][]int{chainPorts, forwardPorts, runtimePorts} {
			for _, port := range ports {
				used[port] = struct{}{}
			}
		}

		allocatedPort := requestedPort
		if allocatedPort > 0 {
			if allocatedPort < share.PortRangeStart || allocatedPort > share.PortRangeEnd {
				return errors.New("Port out of range")
			}
			if _, occupied := used[allocatedPort]; occupied {
				return errors.New("No available port")
			}
		} else {
			for port := share.PortRangeStart; port <= share.PortRangeEnd; port++ {
				if _, occupied := used[port]; !occupied {
					allocatedPort = port
					break
				}
			}
			if allocatedPort <= 0 {
				return errors.New("No available port")
			}
		}

		if existing.ID > 0 {
			existing.Protocol = protocol
			existing.Port = allocatedPort
			existing.BindingID = ""
			existing.Role = ""
			existing.ChainName = ""
			existing.ServiceName = ""
			existing.Strategy = "round"
			existing.Target = ""
			existing.Applied = 0
			existing.Status = 1
			existing.UpdatedTime = now
			if err := tx.Save(&existing).Error; err != nil {
				return err
			}
			reserved = existing
			return nil
		}

		reserved = model.PeerShareRuntime{
			ShareID: share.ID, NodeID: share.NodeID, ReservationID: reservationID,
			ResourceKey: resourceKey, Protocol: protocol, Strategy: "round", Port: allocatedPort,
			Status: 1, CreatedTime: now, UpdatedTime: now,
		}
		return tx.Create(&reserved).Error
	})
	if err != nil {
		return nil, err
	}
	return &reserved, nil
}

func (r *Repository) MarkPeerShareRuntimeInstancesReleased(runtimeID int64, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.PeerShareRuntimeInstance{}).Where("runtime_id = ?", runtimeID).Updates(map[string]interface{}{
		"status": 0, "applied": 0, "healthy": 0, "updated_time": now,
	}).Error
}

func (r *Repository) ListPeerShareFlows(shareID int64) ([]model.PeerShareFlow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.PeerShareFlow
	err := r.db.Where("share_id = ?", shareID).Order("period_type ASC, period_key DESC, runtime_id ASC, instance_id ASC").Find(&items).Error
	if items == nil {
		items = make([]model.PeerShareFlow, 0)
	}
	return items, err
}

func (r *Repository) GetPeerShareFlow(shareID, runtimeID int64, instanceID, periodType string, periodKey int64) (*model.PeerShareFlow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var item model.PeerShareFlow
	err := r.db.Where("share_id = ? AND runtime_id = ? AND instance_id = ? AND period_type = ? AND period_key = ?", shareID, runtimeID, strings.TrimSpace(instanceID), strings.TrimSpace(periodType), periodKey).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &item, err
}

func (r *Repository) DeletePeerShareFlows(shareID int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Where("share_id = ?", shareID).Delete(&model.PeerShareFlow{}).Error
}

func (r *Repository) AddPeerShareFlow(shareID, runtimeID int64, instanceID string, inFlow, outFlow int64, now time.Time) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if shareID <= 0 || inFlow+outFlow <= 0 {
		return nil
	}
	if now.IsZero() {
		now = time.Now()
	}
	nowMs := now.UnixMilli()
	dayKey := int64(now.Year()*10000 + int(now.Month())*100 + now.Day())
	instanceID = strings.TrimSpace(instanceID)
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.PeerShare{}).Where("id = ?", shareID).UpdateColumns(map[string]interface{}{
			"current_flow": gorm.Expr("current_flow + ?", inFlow+outFlow), "updated_time": nowMs,
		}).Error; err != nil {
			return err
		}
		rows := []model.PeerShareFlow{
			{ShareID: shareID, RuntimeID: 0, InstanceID: "", PeriodType: "total", PeriodKey: 0, InFlow: inFlow, OutFlow: outFlow, CreatedTime: nowMs, UpdatedTime: nowMs},
			{ShareID: shareID, RuntimeID: 0, InstanceID: "", PeriodType: "daily", PeriodKey: dayKey, InFlow: inFlow, OutFlow: outFlow, CreatedTime: nowMs, UpdatedTime: nowMs},
		}
		if runtimeID > 0 {
			rows = append(rows,
				model.PeerShareFlow{ShareID: shareID, RuntimeID: runtimeID, InstanceID: instanceID, PeriodType: "total", PeriodKey: 0, InFlow: inFlow, OutFlow: outFlow, CreatedTime: nowMs, UpdatedTime: nowMs},
				model.PeerShareFlow{ShareID: shareID, RuntimeID: runtimeID, InstanceID: instanceID, PeriodType: "daily", PeriodKey: dayKey, InFlow: inFlow, OutFlow: outFlow, CreatedTime: nowMs, UpdatedTime: nowMs},
			)
		}
		for i := range rows {
			row := rows[i]
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "share_id"}, {Name: "runtime_id"}, {Name: "instance_id"}, {Name: "period_type"}, {Name: "period_key"}},
				DoUpdates: clause.Assignments(map[string]interface{}{
					"in_flow": gorm.Expr("in_flow + ?", inFlow), "out_flow": gorm.Expr("out_flow + ?", outFlow), "updated_time": nowMs,
				}),
			}).Create(&row).Error; err != nil {
				return err
			}
		}
		if runtimeID > 0 && instanceID != "" {
			if err := tx.Model(&model.PeerShareRuntimeInstance{}).
				Where("runtime_id = ? AND instance_id = ?", runtimeID, instanceID).
				Updates(map[string]interface{}{"current_flow": gorm.Expr("current_flow + ?", inFlow+outFlow), "updated_time": nowMs}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) RemoteNodeExists(remoteURL, token string) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	var count int64
	err := r.db.Model(&model.Node{}).Where("is_remote = 1 AND (remote_token = ? OR (remote_url = ? AND remote_token = ?))", strings.TrimSpace(token), strings.TrimRight(strings.TrimSpace(remoteURL), "/"), strings.TrimSpace(token)).Count(&count).Error
	return count > 0, err
}

// ListRemoteNodes returns all nodes with is_remote=1, ordered by id desc.
func (r *Repository) ListRemoteNodes() ([]RemoteNodeRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var result []RemoteNodeRow
	err := r.db.Model(&model.Node{}).
		Select("id, name, remote_url, remote_token, remote_config").
		Where("is_remote = 1").
		Order("id DESC").
		Find(&result).Error
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = make([]RemoteNodeRow, 0)
	}
	return result, nil
}

// UpdateNodeRemoteConfig sets the remote_config JSON for a given node.
func (r *Repository) UpdateNodeRemoteConfig(nodeID int64, configJSON string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.Node{}).Where("id = ?", nodeID).Update("remote_config", configJSON).Error
}

// ListActiveBindingsForNode returns active federation tunnel bindings for a node.
func (r *Repository) ListActiveBindingsForNode(nodeID int64) ([]FederationBindingRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var result []FederationBindingRow
	err := r.db.Model(&model.FederationTunnelBinding{}).
		Select("federation_tunnel_binding.id, federation_tunnel_binding.tunnel_id, COALESCE(tunnel.name, '') AS tunnel_name, federation_tunnel_binding.chain_type, federation_tunnel_binding.hop_inx, federation_tunnel_binding.allocated_port, federation_tunnel_binding.resource_key, federation_tunnel_binding.remote_binding_id, federation_tunnel_binding.updated_time").
		Joins("LEFT JOIN tunnel ON tunnel.id = federation_tunnel_binding.tunnel_id").
		Where("federation_tunnel_binding.node_id = ? AND federation_tunnel_binding.status = 1", nodeID).
		Order("federation_tunnel_binding.allocated_port ASC, federation_tunnel_binding.id ASC").
		Find(&result).Error
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = make([]FederationBindingRow, 0)
	}
	return result, nil
}

func (r *Repository) ListActiveFederationTunnelBindingsByNode(nodeID int64) ([]model.FederationTunnelBinding, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var items []model.FederationTunnelBinding
	err := r.db.Where("node_id = ? AND status = 1", nodeID).Order("id ASC").Find(&items).Error
	if items == nil {
		items = make([]model.FederationTunnelBinding, 0)
	}
	return items, err
}

func (r *Repository) ListActiveForwardPortsForNode(nodeID int64) ([]ActiveForwardPortRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var result []ActiveForwardPortRow
	err := r.db.Model(&model.ForwardPort{}).
		Select("forward_port.forward_id, forward.tunnel_id, COALESCE(tunnel.name, '') AS tunnel_name, forward_port.port, forward.updated_time").
		Joins("JOIN forward ON forward.id = forward_port.forward_id").
		Joins("LEFT JOIN tunnel ON tunnel.id = forward.tunnel_id").
		Where("forward_port.node_id = ? AND forward_port.port > 0", nodeID).
		Order("forward_port.port ASC, forward_port.id ASC").
		Find(&result).Error
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = make([]ActiveForwardPortRow, 0)
	}
	return result, nil
}

// GetNodeBasicInfo returns the name, server_ip, and status for a given node.
func (r *Repository) GetNodeBasicInfo(nodeID int64) (*NodeBasicInfo, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var n model.Node
	err := r.db.Select("name", "server_ip", "status").Where("id = ?", nodeID).First(&n).Error
	if err != nil {
		return nil, err
	}
	return &NodeBasicInfo{Name: n.Name, ServerIP: n.ServerIP, Status: n.Status}, nil
}

// CreateFederationTunnel creates a tunnel and chain_tunnel entry in a transaction,
// returning the new tunnel ID.
func (r *Repository) CreateFederationTunnel(name string, tunnelType int, protocol string, now int64, nodeID int64, remotePort int) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	tunnel := model.Tunnel{
		Name:        name,
		Type:        tunnelType,
		Protocol:    protocol,
		Flow:        0,
		CreatedTime: now,
		UpdatedTime: now,
		Status:      1,
		InIP:        sql.NullString{String: "", Valid: false},
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var node model.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", nodeID).First(&node).Error; err != nil {
			return err
		}
		var occupied int64
		if err := tx.Model(&model.ChainTunnel{}).Where("node_id = ? AND port = ?", nodeID, remotePort).Count(&occupied).Error; err != nil {
			return err
		}
		if occupied == 0 {
			if err := tx.Model(&model.ForwardPort{}).Where("node_id = ? AND port = ?", nodeID, remotePort).Count(&occupied).Error; err != nil {
				return err
			}
		}
		if occupied == 0 {
			if err := tx.Model(&model.PeerShareRuntime{}).Where("node_id = ? AND port = ? AND status = 1", nodeID, remotePort).Count(&occupied).Error; err != nil {
				return err
			}
		}
		if occupied > 0 {
			return errors.New("Port already in use")
		}
		if err := tx.Create(&tunnel).Error; err != nil {
			return err
		}
		ct := model.ChainTunnel{
			TunnelID:  tunnel.ID,
			ChainType: "1",
			NodeID:    nodeID,
			Port:      sql.NullInt64{Int64: int64(remotePort), Valid: true},
			Strategy:  sql.NullString{String: "fifo", Valid: true},
			Inx:       sql.NullInt64{Int64: 0, Valid: true},
			Protocol:  sql.NullString{String: protocol, Valid: true},
		}
		if err := tx.Create(&ct).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return tunnel.ID, nil
}

// ListUsedPortsOnNode returns all ports in use on a given node from chain_tunnel and forward_port tables.
func (r *Repository) ListUsedPortsOnNode(nodeID int64) ([]int, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	used := make(map[int]struct{})

	var chainPorts []int
	err := r.db.Model(&model.ChainTunnel{}).
		Where("node_id = ? AND port > 0", nodeID).
		Pluck("port", &chainPorts).Error
	if err != nil {
		return nil, err
	}
	for _, p := range chainPorts {
		if p > 0 {
			used[p] = struct{}{}
		}
	}

	var forwardPorts []int
	err = r.db.Model(&model.ForwardPort{}).
		Where("node_id = ? AND port > 0", nodeID).
		Pluck("port", &forwardPorts).Error
	if err != nil {
		return nil, err
	}
	for _, p := range forwardPorts {
		if p > 0 {
			used[p] = struct{}{}
		}
	}

	result := make([]int, 0, len(used))
	for p := range used {
		result = append(result, p)
	}
	return result, nil
}

// ListTunnelIDsByNamePrefix returns all tunnel IDs whose name starts with the given prefix.
func (r *Repository) ListTunnelIDsByNamePrefix(prefix string) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.Tunnel{}).
		Where("name LIKE ?", prefix+"%").
		Order("id ASC").
		Pluck("id", &ids).Error
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = make([]int64, 0)
	}
	return ids, nil
}

// CreateRemoteNode inserts a new remote node.
func (r *Repository) CreateRemoteNode(name, secret, serverIP, portRange string, now int64, status int, inx int, remoteURL, remoteToken, remoteConfigJSON string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	node := model.Node{
		Name:          name,
		Secret:        secret,
		TrafficRatio:  1,
		ServerIP:      serverIP,
		ServerIPV4:    sql.NullString{},
		ServerIPV6:    sql.NullString{},
		Port:          portRange,
		InterfaceName: sql.NullString{},
		Version:       sql.NullString{},
		HTTP:          0,
		TLS:           0,
		Socks:         0,
		CreatedTime:   now,
		UpdatedTime:   sql.NullInt64{Int64: now, Valid: true},
		Status:        status,
		TCPListenAddr: "[::]",
		UDPListenAddr: "[::]",
		Inx:           inx,
		IsRemote:      1,
		RemoteURL:     sql.NullString{String: remoteURL, Valid: remoteURL != ""},
		RemoteToken:   sql.NullString{String: remoteToken, Valid: remoteToken != ""},
		RemoteConfig:  sql.NullString{String: remoteConfigJSON, Valid: remoteConfigJSON != ""},
	}
	return r.db.Create(&node).Error
}

// ReplaceFederationTunnelBindingsIfResourceKeysMatch replaces a deployment's
// bindings only while that deployment still owns the tunnel binding rows.
func (r *Repository) ReplaceFederationTunnelBindingsIfResourceKeysMatch(tunnelID int64, expectedUpdatedTime int64, expectedKeys []string, replacements []FederationTunnelBinding) (bool, error) {
	if r == nil || r.db == nil {
		return false, errors.New("repository not initialized")
	}
	expectedKeys = normalizedFederationResourceKeys(expectedKeys)
	replaced := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var tunnel model.Tunnel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "updated_time").Where("id = ?", tunnelID).First(&tunnel).Error; err != nil {
			return err
		}
		if expectedUpdatedTime > 0 && tunnel.UpdatedTime != expectedUpdatedTime {
			return nil
		}
		var currentKeys []string
		if err := tx.Model(&model.FederationTunnelBinding{}).
			Where("tunnel_id = ?", tunnelID).
			Pluck("resource_key", &currentKeys).Error; err != nil {
			return err
		}
		if !equalFederationResourceKeys(normalizedFederationResourceKeys(currentKeys), expectedKeys) {
			return nil
		}
		if err := r.ReplaceFederationTunnelBindingsTx(tx, tunnelID, replacements); err != nil {
			return err
		}
		replaced = true
		return nil
	})
	return replaced, err
}

// CompleteFederationTunnelDeployment atomically publishes a deployment and
// returns the binding rows it replaced. A stale deployment cannot publish.
func (r *Repository) CompleteFederationTunnelDeployment(tunnelID int64, expectedUpdatedTime int64, replacements []FederationTunnelBinding) ([]model.FederationTunnelBinding, bool, error) {
	if r == nil || r.db == nil {
		return nil, false, errors.New("repository not initialized")
	}
	var previous []model.FederationTunnelBinding
	switched := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var tunnel model.Tunnel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "updated_time").Where("id = ?", tunnelID).First(&tunnel).Error; err != nil {
			return err
		}
		if expectedUpdatedTime > 0 && tunnel.UpdatedTime != expectedUpdatedTime {
			return nil
		}
		if err := tx.Where("tunnel_id = ? AND status = 1", tunnelID).
			Order("chain_type ASC, hop_inx ASC, id ASC").
			Find(&previous).Error; err != nil {
			return err
		}
		if err := r.ReplaceFederationTunnelBindingsTx(tx, tunnelID, replacements); err != nil {
			return err
		}
		switched = true
		return nil
	})
	return previous, switched, err
}

func normalizedFederationResourceKeys(keys []string) []string {
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		if key != "" {
			result = append(result, key)
		}
	}
	sort.Strings(result)
	return result
}

func equalFederationResourceKeys(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
