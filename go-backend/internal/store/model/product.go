package model

// SubscriptionPackage 套餐订阅 — 定义资源配额和关联的隧道分组
type SubscriptionPackage struct {
	ID             int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Type           string `gorm:"column:type;type:varchar(20);default:'subscription'" json:"type"` // subscription / traffic / balance
	Name           string `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Description    string `gorm:"column:description;type:varchar(500);default:''" json:"description"`
	Price          int64  `gorm:"column:price;not null;default:0" json:"price"`             // 分
	ValidityDays   int    `gorm:"column:validity_days;default:0" json:"validityDays"`       // 0=永久
	TrafficLimit   int64  `gorm:"column:traffic_limit;default:0" json:"trafficLimit"`       // GB, 0=不限
	PortCount      int    `gorm:"column:port_count;default:0" json:"portCount"`             // 0=不限
	SpeedLimit     int    `gorm:"column:speed_limit;default:0" json:"speedLimit"`           // MB/s, 0=不限
	MaxRules       int    `gorm:"column:max_rules;default:0" json:"maxRules"`               // 0=不限
	MaxConnections int    `gorm:"column:max_connections;default:0" json:"maxConnections"`   // 0=不限
	MaxIPAccess    int    `gorm:"column:max_ip_access;default:0" json:"maxIPAccess"`        // 0=不限
	AutoRenew      int    `gorm:"column:auto_renew;default:0" json:"autoRenew"`             // 套餐级自动续费开关
	SortOrder      int    `gorm:"column:sort_order;default:0" json:"sortOrder"`
	Enabled        int    `gorm:"column:enabled;default:1" json:"enabled"`                  // 启用
	ShopVisible            int    `gorm:"column:shop_visible;default:1" json:"shopVisible"`                       // 商店可见
	AutoBuyTrafficEnabled  int    `gorm:"column:auto_buy_traffic_enabled;default:0" json:"autoBuyTrafficEnabled"` // 标记为自动购流来源 (0=否，1=是)
	Stock                  int64  `gorm:"column:stock;default:-1" json:"stock"`                                  // -1=不限，0=售罄，>0=剩余库存
	Recommended            int    `gorm:"column:recommended;default:0" json:"recommended"`                        // 0=否，1=推荐
	CreatedAt              int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt      int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (SubscriptionPackage) TableName() string { return "subscription_package" }

// SubscriptionPackageTunnelGroup 套餐关联的隧道分组（多对多）
type SubscriptionPackageTunnelGroup struct {
	PackageID     int64 `gorm:"column:package_id;primaryKey"`
	TunnelGroupID int64 `gorm:"column:tunnel_group_id;primaryKey"`
}

func (SubscriptionPackageTunnelGroup) TableName() string { return "subscription_package_tunnel_group" }

// PackageSubscription 用户订阅记录
type PackageSubscription struct {
	ID        int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID    int64 `gorm:"column:user_id;not null;index" json:"userId"`
	PackageID int64 `gorm:"column:package_id;not null" json:"packageId"`
	StartAt   int64 `gorm:"column:start_at;not null" json:"startAt"`
	ExpireAt  int64 `gorm:"column:expire_at;not null" json:"expireAt"`
	AutoRenew int   `gorm:"column:auto_renew;default:0" json:"autoRenew"`
	Status    int   `gorm:"column:status;default:1" json:"status"`
	OrderID   int64 `gorm:"column:order_id" json:"orderId"`
	CreatedAt int64 `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt int64 `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (PackageSubscription) TableName() string { return "package_subscription" }


