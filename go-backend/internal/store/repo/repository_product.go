package repo

import (
	"errors"
	"time"

	"go-backend/internal/store/model"
)

func (r *Repository) CreateProduct(name, description, productType string, price, value int64, sortOrder, status int) (*model.Product, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	now := time.Now().Unix()
	p := &model.Product{
		Name:        name,
		Description: description,
		Type:        productType,
		Price:       price,
		Value:       value,
		SortOrder:   sortOrder,
		Status:      status,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := r.db.Create(p).Error; err != nil {
		return nil, err
	}

	return p, nil
}

func (r *Repository) UpdateProduct(id int64, name, description string, price, value int64, sortOrder, status int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	updates := map[string]interface{}{
		"name":       name,
		"price":      price,
		"value":      value,
		"sort_order": sortOrder,
		"status":     status,
		"updated_at": time.Now().Unix(),
	}
	if description != "" {
		updates["description"] = description
	}

	return r.db.Model(&model.Product{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) DeleteProduct(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Delete(&model.Product{}, id).Error
}

func (r *Repository) GetProduct(id int64) (*model.Product, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var p model.Product
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) ListProducts(onlyActive bool) ([]*model.Product, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	query := r.db.Model(&model.Product{}).Order("sort_order ASC, id ASC")
	if onlyActive {
		query = query.Where("status = 1")
	}

	var list []*model.Product
	if err := query.Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func (r *Repository) UpdateProductOrder(ids []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	for i, id := range ids {
		if err := r.db.Model(&model.Product{}).Where("id = ?", id).Update("sort_order", i).Error; err != nil {
			return err
		}
	}
	return nil
}
