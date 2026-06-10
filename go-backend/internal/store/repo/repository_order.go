package repo

import (
	"errors"
	"time"

	"go-backend/internal/store/model"
)

func (r *Repository) CreateOrder(o *model.Order) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	o.CreatedAt = time.Now().Unix()
	o.UpdatedAt = o.CreatedAt
	return r.db.Create(o).Error
}

func (r *Repository) UpdateOrderStatus(id int64, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now().Unix(),
	}
	if status == 1 {
		updates["pay_time"] = time.Now().Unix()
	}

	return r.db.Model(&model.Order{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) UpdateOrderPaymentInfo(id int64, payURL, payAddress string) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	updates := map[string]interface{}{
		"pay_url":     payURL,
		"pay_address": payAddress,
		"updated_at":  time.Now().Unix(),
	}
	return r.db.Model(&model.Order{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) GetOrder(id int64) (*model.Order, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var o model.Order
	if err := r.db.First(&o, id).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) GetOrderByNo(orderNo string) (*model.Order, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var o model.Order
	if err := r.db.Where("order_no = ?", orderNo).First(&o).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) ListOrders(userID int64, status int, page, size int) ([]*model.Order, int64, error) {
	if r == nil || r.db == nil {
		return nil, 0, errors.New("repository not initialized")
	}

	query := r.db.Model(&model.Order{}).Where("user_id = ?", userID)
	if status >= 0 {
		query = query.Where("status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []*model.Order
	if err := query.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (r *Repository) ListAllOrders(status int, page, size int, keyword string) ([]*model.Order, int64, error) {
	if r == nil || r.db == nil {
		return nil, 0, errors.New("repository not initialized")
	}

	query := r.db.Model(&model.Order{})
	if status >= 0 {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		query = query.Where("order_no LIKE ? OR user_name LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []*model.Order
	if err := query.Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error; err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (r *Repository) ListExpiredPendingOrders(minutes int) ([]*model.Order, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	cutoff := time.Now().Unix() - int64(minutes)*60
	var list []*model.Order
	if err := r.db.Model(&model.Order{}).
		Where("status = 0 AND pay_currency IN ('USDT','YIPAY') AND created_at < ?", cutoff).
		Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) GetPaymentStats() (paidAmount int64, paidOrders int64, pendingOrders int64, err error) {
	if r == nil || r.db == nil {
		return 0, 0, 0, errors.New("repository not initialized")
	}

	r.db.Model(&model.Order{}).Where("status = 1").Select("COALESCE(SUM(amount),0)").Scan(&paidAmount)
	r.db.Model(&model.Order{}).Where("status = 1").Count(&paidOrders)
	r.db.Model(&model.Order{}).Where("status = 0").Count(&pendingOrders)
	return
}

func (r *Repository) BatchCancelOrders(ids []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	now := time.Now().Unix()
	return r.db.Model(&model.Order{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{"status": 2, "updated_at": now}).Error
}

func (r *Repository) DeleteOrder(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.Order{}, id).Error
}

func (r *Repository) UpdateOrder(id int64, updates map[string]interface{}) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	updates["updated_at"] = time.Now().Unix()
	return r.db.Model(&model.Order{}).Where("id = ?", id).Updates(updates).Error
}
