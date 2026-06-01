package repo

import (
	"database/sql"
	"errors"
	"time"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
)

func sqlNullStringPkg(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func (r *Repository) CreatePackageGroup(name, description, color string, inx int) (*model.PackageGroup, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	now := time.Now().Unix()
	group := &model.PackageGroup{
		Name:        name,
		Description: sqlNullStringPkg(description),
		Color:       color,
		Inx:         inx,
		CreatedTime: now,
	}

	if err := r.db.Create(group).Error; err != nil {
		return nil, err
	}

	return group, nil
}

func (r *Repository) UpdatePackageGroup(id int64, name, description, color string, inx int) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	updates := map[string]interface{}{
		"name":  name,
		"color": color,
		"inx":   inx,
	}
	if description != "" {
		updates["description"] = sqlNullStringPkg(description)
	}
	updates["updated_time"] = time.Now().Unix()

	return r.db.Model(&model.PackageGroup{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) DeletePackageGroup(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.SubscriptionPackage{}).Where("group_id = ?", id).Update("group_id", nil).Error; err != nil {
			return err
		}
		return tx.Delete(&model.PackageGroup{}, id).Error
	})
}

func (r *Repository) ListPackageGroups() ([]model.PackageGroup, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var groups []model.PackageGroup
	err := r.db.Order("inx ASC, id ASC").Find(&groups).Error
	return groups, err
}

func (r *Repository) GetPackageGroupByID(id int64) (*model.PackageGroup, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var group model.PackageGroup
	err := r.db.First(&group, id).Error
	if err != nil {
		return nil, err
	}

	return &group, nil
}

func (r *Repository) AssignPackageToGroup(packageID, groupID *int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}

	var groupIDVal interface{} = nil
	if groupID != nil {
		groupIDVal = *groupID
	}

	return r.db.Model(&model.SubscriptionPackage{}).Where("id = ?", packageID).
		Update("group_id", groupIDVal).Error
}

func (r *Repository) GetPackagesByGroupID(groupID int64) ([]model.SubscriptionPackage, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}

	var packages []model.SubscriptionPackage
	err := r.db.Where("group_id = ?", groupID).Order("sort_order ASC, id ASC").Find(&packages).Error
	return packages, err
}

func (r *Repository) GetPackageGroupCount(groupID int64) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("repository not initialized")
	}

	var count int64
	err := r.db.Model(&model.SubscriptionPackage{}).Where("group_id = ?", groupID).Count(&count).Error
	return count, err
}
