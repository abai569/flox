package model

type Product struct {
	ID          int64  `gorm:"primaryKey;autoIncrement"`
	Name        string `gorm:"column:name;type:varchar(100);not null"`
	Description string `gorm:"column:description;type:varchar(500);default:''"`
	Type        string `gorm:"column:type;type:varchar(20);not null"` // recharge/traffic/time
	Price       int64  `gorm:"column:price;not null;default:0"`       // 价格 (分)
	Value       int64  `gorm:"column:value;not null;default:0"`       // 充值金额/流量GB/天数
	SortOrder   int    `gorm:"column:sort_order;default:0"`
	Status      int    `gorm:"column:status;default:1"` // 0=下架 1=上架
	CreatedAt   int64  `gorm:"column:created_at;not null"`
	UpdatedAt   int64  `gorm:"column:updated_at;not null"`
}

func (Product) TableName() string { return "product" }
