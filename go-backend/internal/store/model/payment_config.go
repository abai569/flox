package model

type PaymentConfig struct {
	ID        int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Channel   string `gorm:"column:channel;type:varchar(20);not null;uniqueIndex" json:"channel"` // USDT / YIPAY
	Config    string `gorm:"column:config;type:text;not null" json:"config"`                     // JSON 配置
	Enabled   int    `gorm:"column:enabled;default:0" json:"enabled"`
	CreatedAt int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (PaymentConfig) TableName() string { return "payment_config" }
