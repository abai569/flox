package model

type Product struct {
	ID          int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string `gorm:"column:name;type:varchar(100);not null" json:"name"`
	Description string `gorm:"column:description;type:varchar(500);default:''" json:"description"`
	Type        string `gorm:"column:type;type:varchar(20);not null" json:"type"`
	Price       int64  `gorm:"column:price;not null;default:0" json:"price"`
	Value       int64  `gorm:"column:value;not null;default:0" json:"value"`
	SortOrder   int    `gorm:"column:sort_order;default:0" json:"sortOrder"`
	Status      int    `gorm:"column:status;default:1" json:"status"`
	CreatedAt   int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt   int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (Product) TableName() string { return "product" }
