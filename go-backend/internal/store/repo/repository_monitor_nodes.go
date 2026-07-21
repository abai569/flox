package repo

import (
	"errors"

	"go-backend/internal/store/model"
)

type MonitorNodeInstanceGroupRow struct {
	Inx                          int64   `gorm:"column:inx"`
	NodeID                       int64   `gorm:"column:node_id"`
	NodeName                     string  `gorm:"column:node_name"`
	NodeStatus                   int     `gorm:"column:node_status"`
	InstanceID                   string  `gorm:"column:instance_id"`
	DisplayIndex                 int     `gorm:"column:display_index"`
	DisplayName                  string  `gorm:"column:display_name"`
	Remark                       string  `gorm:"column:remark"`
	Hostname                     string  `gorm:"column:hostname"`
	PublicIPV4                   string  `gorm:"column:public_ip_v4"`
	PublicIPV6                   string  `gorm:"column:public_ip_v6"`
	Status                       int     `gorm:"column:status"`
	Weight                       int     `gorm:"column:weight"`
	PortRange                    string  `gorm:"column:port_range"`
	ExpiryTime                   int64   `gorm:"column:expiry_time"`
	RenewalCycle                 string  `gorm:"column:renewal_cycle"`
	ExpiryReminderDismissed      int     `gorm:"column:expiry_reminder_dismissed"`
	ExpiryReminderDismissedUntil int64   `gorm:"column:expiry_reminder_dismissed_until"`
	FlowResetTime                int     `gorm:"column:flow_reset_time"`
	TrafficLimit                 int64   `gorm:"column:traffic_limit"`
	TotalInFlow                  int64   `gorm:"column:total_in_flow"`
	TotalOutFlow                 int64   `gorm:"column:total_out_flow"`
	NetInSpeed                   int64   `gorm:"column:net_in_speed"`
	NetOutSpeed                  int64   `gorm:"column:net_out_speed"`
	NetInBytes                   int64   `gorm:"column:net_in_bytes"`
	NetOutBytes                  int64   `gorm:"column:net_out_bytes"`
	TCPConns                     int64   `gorm:"column:tcp_conns"`
	UDPConns                     int64   `gorm:"column:udp_conns"`
	Uptime                       int64   `gorm:"column:uptime"`
	PeriodRx                     int64   `gorm:"column:period_rx"`
	PeriodTx                     int64   `gorm:"column:period_tx"`
	CPUUsage                     float64 `gorm:"column:cpu_usage"`
	MemUsage                     float64 `gorm:"column:mem_usage"`
	DiskUsage                    float64 `gorm:"column:disk_usage"`
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

func (r *Repository) ListMonitorNodeInstanceGroups(nodeIDs []int64) ([]MonitorNodeInstanceGroupRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if err := r.EnsureNodeInstanceDisplayIndexes(nodeIDs); err != nil {
		return nil, err
	}

	where, args := validNodeInstanceWhere()
	query := r.db.Table("node AS n").
		Select(`
			COALESCE(n.inx, 0) AS inx,
			n.id AS node_id,
			n.name AS node_name,
			n.status AS node_status,
			nsi.instance_id AS instance_id,
			nsi.display_index AS display_index,
			COALESCE(nsi.display_name, '') AS display_name,
			COALESCE(nsi.remark, '') AS remark,
			COALESCE(nsi.hostname, '') AS hostname,
			COALESCE(nsi.public_ip_v4, '') AS public_ip_v4,
			COALESCE(nsi.public_ip_v6, '') AS public_ip_v6,
			nsi.status AS status,
			nsi.weight AS weight,
			COALESCE(nsi.port_range, '') AS port_range,
			COALESCE(nsi.expiry_time, 0) AS expiry_time,
			COALESCE(nsi.renewal_cycle, '') AS renewal_cycle,
			COALESCE(nsi.expiry_reminder_dismissed, 0) AS expiry_reminder_dismissed,
			COALESCE(nsi.expiry_reminder_dismissed_until, 0) AS expiry_reminder_dismissed_until,
			COALESCE(nsi.flow_reset_time, 0) AS flow_reset_time,
			COALESCE(nsi.traffic_limit, 0) AS traffic_limit,
			COALESCE(nsi.total_in_flow, 0) AS total_in_flow,
			COALESCE(nsi.total_out_flow, 0) AS total_out_flow,
			nsi.net_in_speed AS net_in_speed,
			nsi.net_out_speed AS net_out_speed,
			nsi.net_in_bytes AS net_in_bytes,
			nsi.net_out_bytes AS net_out_bytes,
			nsi.tcp_conns AS tcp_conns,
			nsi.udp_conns AS udp_conns,
			nsi.uptime AS uptime,
			nsi.period_rx AS period_rx,
			nsi.period_tx AS period_tx,
			nsi.cpu_usage AS cpu_usage,
			nsi.mem_usage AS mem_usage,
			nsi.disk_usage AS disk_usage
		`).
		Joins("JOIN node_instance AS nsi ON nsi.node_id = n.id").
		Where("n.is_remote = ?", 0).
		Where(where, args...)

	if len(nodeIDs) > 0 {
		query = query.Where("n.id IN ?", nodeIDs)
	}

	var rows []MonitorNodeInstanceGroupRow
	err := query.Order("n.inx ASC, n.id ASC, nsi.status DESC, nsi.display_index ASC, nsi.id ASC").Scan(&rows).Error
	return rows, err
}
