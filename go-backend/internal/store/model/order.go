package model

type Order struct {
	ID            int64  `gorm:"primaryKey;autoIncrement"`
	OrderNo       string `gorm:"column:order_no;type:varchar(32);not null;uniqueIndex"`
	UserID        int64  `gorm:"column:user_id;not null;index"`
	UserName      string `gorm:"column:user_name;type:varchar(100);not null"`
	ProductID     int64  `gorm:"column:product_id;not null"`
	ProductName   string `gorm:"column:product_name;type:varchar(100);not null"`
	ProductType   string `gorm:"column:product_type;type:varchar(20);not null"`
	ProductMeta   string `gorm:"column:product_meta;type:text"`                     // 商品快照 JSON
	Amount        int64  `gorm:"column:amount;not null"`                           // 实付金额 (分)
	PayCurrency   string `gorm:"column:pay_currency;type:varchar(10);default:'BALANCE'"` // BALANCE / USDT / YIPAY
	Status        int    `gorm:"column:status;default:0"`                         // 0=待支付 1=已支付 2=已取消 3=已退款
	PayTime       int64  `gorm:"column:pay_time;default:0"`
	PayURL        string `gorm:"column:pay_url;type:varchar(512);default:''"`     // 易支付跳转链接
	PayAddress    string `gorm:"column:pay_address;type:varchar(100);default:''"` // USDT 收款地址
	TxHash        string `gorm:"column:tx_hash;type:varchar(100);default:''"`     // 交易流水号
	CreatedAt     int64  `gorm:"column:created_at;not null"`
	UpdatedAt     int64  `gorm:"column:updated_at;not null"`
}

func (Order) TableName() string { return "order" }
