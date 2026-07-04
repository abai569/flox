package repo

import (
	"errors"

	"go-backend/internal/store/model"
)

type MonitorNodeInstanceGroupRow struct {
	TunnelID     int64   `gorm:"column:tunnel_id"`
	TunnelName   string  `gorm:"column:tunnel_name"`
	TunnelStatus int     `gorm:"column:tunnel_status"`
	Inx          int64   `gorm:"column:inx"`
	NodeID       int64   `gorm:"column:node_id"`
	NodeName     string  `gorm:"column:node_name"`
	InstanceID   string  `gorm:"column:instance_id"`
	Hostname     string  `gorm:"column:hostname"`
	PublicIPV4   string  `gorm:"column:public_ip_v4"`
	PublicIPV6   string  `gorm:"column:public_ip_v6"`
	Status       int     `gorm:"column:status"`
	Weight       int     `gorm:"column:weight"`
	NetInSpeed   int64   `gorm:"column:net_in_speed"`
	NetOutSpeed  int64   `gorm:"column:net_out_speed"`
	NetInBytes   int64   `gorm:"column:net_in_bytes"`
	NetOutBytes  int64   `gorm:"column:net_out_bytes"`
	TCPConns     int64   `gorm:"column:tcp_conns"`
	UDPConns     int64   `gorm:"column:udp_conns"`
	Uptime       int64   `gorm:"column:uptime"`
	PeriodRx     int64   `gorm:"column:period_rx"`
	PeriodTx     int64   `gorm:"column:period_tx"`
	CPUUsage     float64 `gorm:"column:cpu_usage"`
	MemUsage     float64 `gorm:"column:mem_usage"`
	DiskUsage    float64 `gorm:"column:disk_usage"`
}

func (r *Repository) ListMonitorNodes() ([]model.Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var nodes []model.Node
	err := r.db.Select("id", "inx", "name", "status", "version", "updated_time", "weight").
		Where("is_remote = ?", 0).
		Order("inx ASC, id ASC").
		Find(&nodes).Error
	return nodes, err
}

func (r *Repository) ListMonitorNodesByIDs(nodeIDs []int64) ([]model.Node, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(nodeIDs) == 0 {
		return nil, nil
	}
	var nodes []model.Node
	err := r.db.Select("id", "inx", "name", "status", "version", "updated_time", "weight").
		Where("is_remote = ? AND id IN ?", 0, nodeIDs).
		Order("inx ASC, id ASC").
		Find(&nodes).Error
	return nodes, err
}

func (r *Repository) ListMonitorNodeInstanceGroups(nodeIDs []int64, tunnelIDs []int64) ([]MonitorNodeInstanceGroupRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	query := r.db.Table("chain_tunnel AS ct").
		Select(`
			ct.tunnel_id,
			t.name AS tunnel_name,
			t.status AS tunnel_status,
			COALESCE(ct.inx, 0) AS inx,
			n.id AS node_id,
			n.name AS node_name,
			COALESCE(nsi.instance_id, '') AS instance_id,
			COALESCE(nsi.hostname, '') AS hostname,
			COALESCE(nsi.public_ip_v4, '') AS public_ip_v4,
			COALESCE(nsi.public_ip_v6, '') AS public_ip_v6,
			COALESCE(nsi.status, n.status) AS status,
			COALESCE(nsi.weight, n.weight, 1) AS weight,
			COALESCE(nsi.net_in_speed, 0) AS net_in_speed,
			COALESCE(nsi.net_out_speed, 0) AS net_out_speed,
			COALESCE(nsi.net_in_bytes, 0) AS net_in_bytes,
			COALESCE(nsi.net_out_bytes, 0) AS net_out_bytes,
			COALESCE(nsi.tcp_conns, 0) AS tcp_conns,
			COALESCE(nsi.udp_conns, 0) AS udp_conns,
			COALESCE(nsi.uptime, 0) AS uptime,
			COALESCE(nsi.period_rx, 0) AS period_rx,
			COALESCE(nsi.period_tx, 0) AS period_tx,
			COALESCE(nsi.cpu_usage, 0) AS cpu_usage,
			COALESCE(nsi.mem_usage, 0) AS mem_usage,
			COALESCE(nsi.disk_usage, 0) AS disk_usage
		`).
		Joins("JOIN tunnel AS t ON t.id = ct.tunnel_id").
		Joins("JOIN node AS n ON n.id = ct.node_id").
		Joins("JOIN node_instance AS nsi ON nsi.node_id = n.id").
		Where("t.status = ?", 1).
		Where("n.is_remote = ?", 0)

	if len(nodeIDs) > 0 {
		query = query.Where("n.id IN ?", nodeIDs)
	}
	if len(tunnelIDs) > 0 {
		query = query.Where("t.id IN ?", tunnelIDs)
	}

	var rows []MonitorNodeInstanceGroupRow
	err := query.Order("t.inx ASC, t.id ASC, ct.chain_type ASC, ct.inx ASC, ct.id ASC").Scan(&rows).Error
	return rows, err
}
