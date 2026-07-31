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
	NetworkRegion                string  `gorm:"column:network_region"`
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
	TrafficLimitMode             int     `gorm:"column:traffic_limit_mode"`
	TotalInFlow                  int64   `gorm:"column:total_in_flow"`
	TotalOutFlow                 int64   `gorm:"column:total_out_flow"`
	NetInSpeed                   int64   `gorm:"column:net_in_speed"`
	NetOutSpeed                  int64   `gorm:"column:net_out_speed"`
	NetInBytes                   int64   `gorm:"column:net_in_bytes"`
	NetOutBytes                  int64   `gorm:"column:net_out_bytes"`
	PeriodNetInBytes             int64   `gorm:"column:period_net_in_bytes"`
	PeriodNetOutBytes            int64   `gorm:"column:period_net_out_bytes"`
	ManualTrafficInBytes         int64   `gorm:"column:manual_traffic_in_bytes"`
	ManualTrafficOutBytes        int64   `gorm:"column:manual_traffic_out_bytes"`
	TCPConns                     int64   `gorm:"column:tcp_conns"`
	UDPConns                     int64   `gorm:"column:udp_conns"`
	Uptime                       int64   `gorm:"column:uptime"`
	PeriodRx                     int64   `gorm:"column:period_rx"`
	PeriodTx                     int64   `gorm:"column:period_tx"`
	CPUUsage                     float64 `gorm:"column:cpu_usage"`
	MemUsage                     float64 `gorm:"column:mem_usage"`
	DiskUsage                    float64 `gorm:"column:disk_usage"`
	CrossBorderStatus            string  `gorm:"column:cross_border_status"`
	CrossBorderError             string  `gorm:"column:cross_border_error"`
	CrossBorderCheckedAt         int64   `gorm:"column:cross_border_checked_at"`
	CrossBorderObservationUntil  int64   `gorm:"column:cross_border_observation_until"`
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

func (r *Repository) ListMonitorNodeInstanceGroups(nodeIDs []int64, includeRemote bool) ([]MonitorNodeInstanceGroupRow, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if err := r.EnsureNodeInstanceDisplayIndexes(nodeIDs); err != nil {
		return nil, err
	}

	where := "TRIM(nsi.instance_id) <> '' AND LOWER(TRIM(nsi.instance_id)) <> ?"
	args := []interface{}{"default"}
	query := r.db.Table("node AS n").
		Select(`
			COALESCE(n.inx, 0) AS inx,
			n.id AS node_id,
			n.name AS node_name,
			n.status AS node_status,
			COALESCE(n.network_region, '') AS network_region,
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
			COALESCE(nsi.traffic_limit_mode, 1) AS traffic_limit_mode,
			COALESCE(nsi.total_in_flow, 0) AS total_in_flow,
			COALESCE(nsi.total_out_flow, 0) AS total_out_flow,
			nsi.net_in_speed AS net_in_speed,
			nsi.net_out_speed AS net_out_speed,
			nsi.net_in_bytes AS net_in_bytes,
			nsi.net_out_bytes AS net_out_bytes,
			COALESCE(nsi.period_net_in_bytes, 0) AS period_net_in_bytes,
			COALESCE(nsi.period_net_out_bytes, 0) AS period_net_out_bytes,
			COALESCE(nsi.manual_traffic_in_bytes, 0) AS manual_traffic_in_bytes,
			COALESCE(nsi.manual_traffic_out_bytes, 0) AS manual_traffic_out_bytes,
			nsi.tcp_conns AS tcp_conns,
			nsi.udp_conns AS udp_conns,
			nsi.uptime AS uptime,
			nsi.period_rx AS period_rx,
			nsi.period_tx AS period_tx,
			nsi.cpu_usage AS cpu_usage,
			nsi.mem_usage AS mem_usage,
			nsi.disk_usage AS disk_usage,
			CASE
				WHEN cb.quarantined = TRUE AND COALESCE(cb.quarantine_reason, '') <> '' THEN cb.quarantine_reason
				ELSE COALESCE(cb.status, 'unknown')
			END AS cross_border_status,
			COALESCE(cb.last_error, '') AS cross_border_error,
			COALESCE(cb.last_checked_at, 0) AS cross_border_checked_at,
			COALESCE(cb.observation_until, 0) AS cross_border_observation_until
		`).
		Joins("JOIN node_instance AS nsi ON nsi.node_id = n.id").
		Joins("LEFT JOIN cross_border_instance_state AS cb ON cb.node_id = nsi.node_id AND cb.instance_id = nsi.instance_id").
		Where(where, args...)
	if !includeRemote {
		query = query.Where("n.is_remote = ?", 0)
	}

	if len(nodeIDs) > 0 {
		query = query.Where("n.id IN ?", nodeIDs)
	}

	var rows []MonitorNodeInstanceGroupRow
	err := query.Order("n.inx ASC, n.id ASC, nsi.status DESC, nsi.display_index ASC, nsi.id ASC").Scan(&rows).Error
	return rows, err
}
