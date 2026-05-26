package model

type PaymentConfig struct {
	ID        int64  `gorm:"primaryKey;autoIncrement"`
	Channel   string `gorm:"column:channel;type:varchar(20);not null;uniqueIndex"` // USDT / YIPAY
	Config    string `gorm:"column:config;type:text;not null"`                     // JSON 配置
	Enabled   int    `gorm:"column:enabled;default:0"`
	CreatedAt int64  `gorm:"column:created_at;not null"`
	UpdatedAt int64  `gorm:"column:updated_at;not null"`
}

func (PaymentConfig) TableName() string { return "payment_config" }
