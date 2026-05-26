package model

type RedeemCode struct {
	ID            int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Code          string `gorm:"column:code;type:varchar(64);not null;uniqueIndex" json:"code"`
	Type          string `gorm:"column:type;type:varchar(20);not null" json:"type"` // plan / balance
	PlanID        *int64 `gorm:"column:plan_id" json:"planId,omitempty"`
	DurationDays  *int   `gorm:"column:duration_days" json:"durationDays,omitempty"`
	AmountCents   *int64 `gorm:"column:amount_cents" json:"amountCents,omitempty"`
	IsActive      int    `gorm:"column:is_active;default:1" json:"isActive"`
	UsedByUserID  *int64 `gorm:"column:used_by_user_id" json:"usedByUserId,omitempty"`
	UsedByUsername string `gorm:"column:used_by_username;type:varchar(100)" json:"usedByUsername,omitempty"`
	UsedAt        *int64 `gorm:"column:used_at" json:"usedAt,omitempty"`
	StartsAt      *int64 `gorm:"column:starts_at" json:"startsAt,omitempty"`
	ExpiresAt     *int64 `gorm:"column:expires_at" json:"expiresAt,omitempty"`
	CreatedAt     int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt     int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (RedeemCode) TableName() string { return "redeem_code" }

type DiscountCode struct {
	ID          int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Code        string `gorm:"column:code;type:varchar(64);not null;uniqueIndex" json:"code"`
	Type        string `gorm:"column:type;type:varchar(20);not null" json:"type"` // percent / amount
	Value       int64  `gorm:"column:value;not null" json:"value"`
	MaxUses     int    `gorm:"column:max_uses;default:0" json:"maxUses"`
	UsedCount   int    `gorm:"column:used_count;default:0" json:"usedCount"`
	PlanIDs     string `gorm:"column:plan_ids;type:text" json:"planIds,omitempty"`
	IsActive    int    `gorm:"column:is_active;default:1" json:"isActive"`
	StartsAt    *int64 `gorm:"column:starts_at" json:"startsAt,omitempty"`
	ExpiresAt   *int64 `gorm:"column:expires_at" json:"expiresAt,omitempty"`
	CreatedAt   int64  `gorm:"column:created_at;not null" json:"createdAt"`
	UpdatedAt   int64  `gorm:"column:updated_at;not null" json:"updatedAt"`
}

func (DiscountCode) TableName() string { return "discount_code" }
