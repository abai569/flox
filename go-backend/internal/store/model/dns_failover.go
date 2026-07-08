package model

type NodeDNSFailover struct {
	ID                  int64  `gorm:"primaryKey;autoIncrement"`
	NodeID              int64  `gorm:"column:node_id;not null;uniqueIndex"`
	Enabled             int    `gorm:"column:enabled;not null;default:0"`
	Provider            string `gorm:"column:provider;type:varchar(20);not null;default:''"`
	Domain              string `gorm:"column:domain;type:varchar(255);not null;default:''"`
	TTL                 int    `gorm:"column:ttl;not null;default:1"`
	ManageA             int    `gorm:"column:manage_a;not null;default:1"`
	ManageAAAA          int    `gorm:"column:manage_aaaa;not null;default:1"`
	MinRecords          int    `gorm:"column:min_records;not null;default:1"`
	RemoveFailCount     int    `gorm:"column:remove_fail_count;not null;default:3"`
	RestoreSuccessCount int    `gorm:"column:restore_success_count;not null;default:3"`
	SyncIntervalSeconds int    `gorm:"column:sync_interval_seconds;not null;default:30"`
	ProviderConfig      string `gorm:"column:provider_config;type:text"`
	CurrentA            string `gorm:"column:current_a;type:text"`
	CurrentAAAA         string `gorm:"column:current_aaaa;type:text"`
	ExpectedA           string `gorm:"column:expected_a;type:text"`
	ExpectedAAAA        string `gorm:"column:expected_aaaa;type:text"`
	LastSyncAt          int64  `gorm:"column:last_sync_at;not null;default:0"`
	LastError           string `gorm:"column:last_error;type:text"`
	CreatedTime         int64  `gorm:"column:created_time;not null"`
	UpdatedTime         int64  `gorm:"column:updated_time;not null"`
}

func (NodeDNSFailover) TableName() string { return "node_dns_failover" }
