package repo

import (
	"errors"
	"math/rand"
	"time"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
)

const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomBillingCode(length int) string {
	b := make([]byte, length)
	for i := range b {
		b[i] = codeChars[rand.Intn(len(codeChars))]
	}
	return string(b)
}

// ─── RedeemCode ──────────────────────────────────────────────────────

func (r *Repository) CreateRedeemCodes(codes []*model.RedeemCode) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().Unix()
	for _, c := range codes {
		c.CreatedAt = now
		c.UpdatedAt = now
		if c.Code == "" {
			c.Code = randomBillingCode(6 + rand.Intn(5))
		}
	}
	return r.db.Create(codes).Error
}

func (r *Repository) GetRedeemCode(code string) (*model.RedeemCode, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var c model.RedeemCode
	if err := r.db.Where("code = ?", code).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) UseRedeemCode(id int64, userID int64, userName string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().Unix()
	return r.db.Model(&model.RedeemCode{}).Where("id = ?", id).Updates(map[string]interface{}{
		"used_by_user_id":  userID,
		"used_by_username": userName,
		"used_at":          now,
		"updated_at":       now,
	}).Error
}

func (r *Repository) ListRedeemCodes() ([]*model.RedeemCode, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var list []*model.RedeemCode
	if err := r.db.Order("id DESC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) DeleteRedeemCode(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.RedeemCode{}, id).Error
}

// ─── DiscountCode ────────────────────────────────────────────────────

func (r *Repository) CreateDiscountCode(c *model.DiscountCode) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	now := time.Now().Unix()
	c.CreatedAt = now
	c.UpdatedAt = now
	if c.Code == "" {
		c.Code = randomBillingCode(6 + rand.Intn(5))
	}
	return r.db.Create(c).Error
}

func (r *Repository) GetDiscountCode(code string) (*model.DiscountCode, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var c model.DiscountCode
	if err := r.db.Where("code = ?", code).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) IncrementDiscountUsedCount(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.DiscountCode{}).Where("id = ?", id).
		UpdateColumn("used_count", gorm.Expr("used_count + 1")).Error
}

func (r *Repository) ListDiscountCodes() ([]*model.DiscountCode, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var list []*model.DiscountCode
	if err := r.db.Order("id DESC").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) DeleteDiscountCode(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.DiscountCode{}, id).Error
}

// ─── BalanceLog (admin list) ─────────────────────────────────────────

func (r *Repository) ListAllBalanceLogs(userID int64, page, size int) ([]*model.BalanceLog, int64, error) {
	if r == nil || r.db == nil {
		return nil, 0, errors.New("repository not initialized")
	}
	query := r.db.Model(&model.BalanceLog{})
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []*model.BalanceLog
	if err := query.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (r *Repository) DeleteBalanceLog(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.BalanceLog{}, id).Error
}

func (r *Repository) CleanupInvalidBalanceLogs() (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}
	result := r.db.Where("signature = ? OR signature = ''", "0").Delete(&model.BalanceLog{})
	return result.RowsAffected, result.Error
}

// ─── System Setting ──────────────────────────────────────────────────

func (r *Repository) GetSystemSetting(key string) (string, error) {
	if r == nil || r.db == nil {
		return "", errors.New("repository not initialized")
	}
	var val string
	err := r.db.Table("system_setting").Where("key = ?", key).Select("value").Scan(&val).Error
	return val, err
}

func (r *Repository) SetSystemSetting(key, value string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Exec(
		"INSERT INTO system_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
		key, value, value,
	).Error
}
