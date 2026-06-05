package model

type Order struct {
	ID            int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	OrderNo       string `gorm:"column:order_no;type:varchar(32);not null;uniqueIndex" json:"orderNo"`
	UserID        int64  `gorm:"column:user_id;not null;index" json:"userId"`
	UserName      string `gorm:"column:user_name;type:varchar(100);not null" json:"userName"`
	ProductID     int64  `gorm:"column:product_id;not null" json:"productId"`
	ProductName   string `gorm:"column:product_name;type:varchar(100);not null" json:"productName"`
	ProductType   string `gorm:"column:product_type;type:varchar(20);not null" json:"productType"`
	ProductMeta   string `gorm:"column:product_meta;type:text" json:"productMeta"`
	Amount        int64  `gorm:"column:amount;not null" json:"amount"`
	PayCurrency   string `gorm:"column:pay_currency;type:varchar(10);default:'BALANCE'" json:"payCurrency"`
	Status        int    `gorm:"column:status;default:0" json:"status"`
	PayTime       int64  `gorm:"column:pay_time;default:0" json:"payTime"`
	PayURL        string `gorm:"column:pay_url;type:varchar(512);default:''" json:"payUrl"`
	PayAddress    string `gorm:"column:pay_address;type:varchar(100);default:''" json:"payAddress"`
	TxHash        string `gorm:"column:tx_hash;type:varchar(100);default:''" json:"txHash"`
	PayType       string `gorm:"column:pay_type;type:varchar(20);default:''" json:"payType"`      // alipay | wxpay
	CreatedAt     int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt     int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (Order) TableName() string { return "order" }
