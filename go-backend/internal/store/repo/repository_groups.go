package repo

import (
	"errors"
	"time"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ─── Semantic Group Queries (replacing QueryInt64List/QueryPairs passthrough) ─

// ListUserIDsByUserGroup returns all user IDs belonging to a user group.
func (r *Repository) ListUserIDsByUserGroup(userGroupID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.UserGroupUser{}).
		Where("user_group_id = ?", userGroupID).
		Pluck("user_id", &ids).Error
	return ids, err
}

// ListTunnelIDsByTunnelGroup returns all tunnel IDs belonging to a tunnel group.
func (r *Repository) ListTunnelIDsByTunnelGroup(tunnelGroupID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.TunnelGroupTunnel{}).
		Where("tunnel_group_id = ?", tunnelGroupID).
		Pluck("tunnel_id", &ids).Error
	return ids, err
}

// ListTunnelIDsByTunnelGroupNew returns all tunnel IDs belonging to a tunnel group (new API).
func (r *Repository) ListTunnelIDsByTunnelGroupNew(tunnelGroupID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.TunnelGroupTunnelNew{}).
		Where("tunnel_group_id = ?", tunnelGroupID).
		Pluck("tunnel_id", &ids).Error
	return ids, err
}

// ListTunnelGroupIDsByTunnelIDs returns a map of tunnelID → []tunnelGroupID.
func (r *Repository) ListTunnelGroupIDsByTunnelIDs(tunnelIDs []int64) (map[int64][]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(tunnelIDs) == 0 {
		return map[int64][]int64{}, nil
	}
	var rows []model.TunnelGroupTunnelNew
	err := r.db.Where("tunnel_id IN ?", tunnelIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	m := make(map[int64][]int64, len(tunnelIDs))
	for _, row := range rows {
		m[row.TunnelID] = append(m[row.TunnelID], row.TunnelGroupID)
	}
	return m, nil
}

// GetUserTunnelGroupIDs returns the explicitly assigned tunnel group for each user.
func (r *Repository) GetUserTunnelGroupIDs(userIDs []int64) (map[int64]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(userIDs) == 0 {
		return map[int64]int64{}, nil
	}
	var rows []model.UserTunnelGroupNew
	err := r.db.Where("user_id IN ?", userIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(rows))
	for _, row := range rows {
		m[row.UserID] = row.TunnelGroupID
	}
	// Read legacy direct grants so existing assignments remain visible after
	// introducing the explicit user_tunnel_group_new relation.
	type legacyResult struct {
		UserID        int64
		TunnelGroupID int64
	}
	var legacyRows []legacyResult
	err = r.db.Table("group_permission_grant").
		Select("user_tunnel.user_id, group_permission_grant.tunnel_group_id").
		Joins("JOIN user_tunnel ON user_tunnel.id = group_permission_grant.user_tunnel_id").
		Where("user_tunnel.user_id IN ? AND group_permission_grant.user_group_id = 0", userIDs).
		Order("group_permission_grant.id DESC").
		Scan(&legacyRows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range legacyRows {
		if _, exists := m[row.UserID]; !exists {
			m[row.UserID] = row.TunnelGroupID
		}
	}
	return m, nil
}

func (r *Repository) ListUserIDsByTunnelGroupNew(tunnelGroupID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.UserTunnelGroupNew{}).
		Where("tunnel_group_id = ?", tunnelGroupID).
		Pluck("user_id", &ids).Error
	return ids, err
}

func (r *Repository) SetUserTunnelGroupNew(userID, tunnelGroupID, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	if tunnelGroupID <= 0 {
		return r.db.Where("user_id = ?", userID).Delete(&model.UserTunnelGroupNew{}).Error
	}
	relation := model.UserTunnelGroupNew{
		UserID:        userID,
		TunnelGroupID: tunnelGroupID,
		CreatedTime:   now,
		UpdatedTime:   now,
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"tunnel_group_id", "updated_time"}),
	}).Create(&relation).Error
}

// ListGroupPermissionPairsByUserGroup returns [userGroupID, tunnelGroupID] pairs
// for all group permissions associated with a user group.
func (r *Repository) ListGroupPermissionPairsByUserGroup(userGroupID int64) ([][2]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var perms []model.GroupPermission
	err := r.db.Where("user_group_id = ?", userGroupID).Find(&perms).Error
	if err != nil {
		return nil, err
	}
	result := make([][2]int64, len(perms))
	for i, p := range perms {
		result[i] = [2]int64{p.UserGroupID, p.TunnelGroupID}
	}
	return result, err
}

func (r *Repository) GetUserGroupIDsByUserID(userID int64) ([]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var ids []int64
	err := r.db.Model(&model.UserGroupUser{}).
		Where("user_id = ?", userID).
		Pluck("user_group_id", &ids).Error
	return ids, err
}

func (r *Repository) ListGroupPermissionPairsByTunnelGroup(tunnelGroupID int64) ([][2]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var perms []model.GroupPermission
	err := r.db.Where("tunnel_group_id = ?", tunnelGroupID).Find(&perms).Error
	if err != nil {
		return nil, err
	}
	result := make([][2]int64, len(perms))
	for i, p := range perms {
		result[i] = [2]int64{p.UserGroupID, p.TunnelGroupID}
	}
	return result, err
}

// ─── Tunnel Group Management for Tunnel Page ─────────────────────────────

// ListTunnelGroupsNew returns all tunnel groups with complete information.
func (r *Repository) ListTunnelGroupsNew() ([]model.TunnelGroupNew, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	var groups []model.TunnelGroupNew
	err := r.db.Order("inx ASC, id ASC").Find(&groups).Error
	return groups, err
}

// CreateTunnelGroupNew creates a new tunnel group.
func (r *Repository) CreateTunnelGroupNew(name, color, description string, inx, status int, now int64) (*model.TunnelGroupNew, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	group := &model.TunnelGroupNew{
		Name:        name,
		Color:       color,
		Description: description,
		Inx:         inx,
		Status:      status,
		CreatedTime: now,
		UpdatedTime: now,
	}
	if err := r.db.Create(group).Error; err != nil {
		return nil, err
	}
	return group, nil
}

// UpdateTunnelGroupNew updates an existing tunnel group.
func (r *Repository) UpdateTunnelGroupNew(id int64, name, color, description string, inx, status int, now int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Model(&model.TunnelGroupNew{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":         name,
		"color":        color,
		"description":  description,
		"inx":          inx,
		"status":       status,
		"updated_time": now,
	}).Error
}

// DeleteTunnelGroupNew deletes a tunnel group by ID.
func (r *Repository) DeleteTunnelGroupNew(id int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Delete junction records first
		if err := tx.Where("tunnel_group_id = ?", id).Delete(&model.TunnelGroupTunnelNew{}).Error; err != nil {
			return err
		}
		if err := tx.Where("tunnel_group_id = ?", id).Delete(&model.UserTunnelGroupNew{}).Error; err != nil {
			return err
		}
		// Delete the group
		return tx.Delete(&model.TunnelGroupNew{}, id).Error
	})
}

// AssignTunnelToGroupNew assigns a tunnel to groups (replaces existing assignments).
func (r *Repository) AssignTunnelToGroupNew(tunnelId int64, groupIds []int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("tunnel_id = ?", tunnelId).Delete(&model.TunnelGroupTunnelNew{}).Error; err != nil {
			return err
		}

		validGroupIDs := make([]int64, 0, len(groupIds))
		seen := make(map[int64]struct{}, len(groupIds))
		for _, groupID := range groupIds {
			if groupID <= 0 {
				continue
			}
			if _, exists := seen[groupID]; exists {
				continue
			}
			seen[groupID] = struct{}{}
			validGroupIDs = append(validGroupIDs, groupID)
		}

		if len(validGroupIDs) > 0 {
			now := time.Now().UnixMilli()
			relations := make([]model.TunnelGroupTunnelNew, len(validGroupIDs))
			for i, groupId := range validGroupIDs {
				relations[i] = model.TunnelGroupTunnelNew{
					TunnelGroupID: groupId,
					TunnelID:      tunnelId,
					CreatedTime:   now,
				}
			}
			if err := tx.Create(&relations).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// AssignTunnelsToGroupNew assigns multiple tunnels to a single group (batch operation).
func (r *Repository) AssignTunnelsToGroupNew(tunnelIds []int64, groupId int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		validTunnelIds := make([]int64, 0, len(tunnelIds))
		for _, id := range tunnelIds {
			if id > 0 {
				validTunnelIds = append(validTunnelIds, id)
			}
		}

		query := tx.Where("tunnel_group_id = ?", groupId)
		if len(validTunnelIds) > 0 {
			query = query.Where("tunnel_id NOT IN ?", validTunnelIds)
		}
		if err := query.Delete(&model.TunnelGroupTunnelNew{}).Error; err != nil {
			return err
		}

		if len(validTunnelIds) == 0 {
			return nil
		}

		now := time.Now().UnixMilli()
		relations := make([]model.TunnelGroupTunnelNew, 0, len(validTunnelIds))
		for _, tunnelId := range validTunnelIds {
			relations = append(relations, model.TunnelGroupTunnelNew{
				TunnelGroupID: groupId,
				TunnelID:      tunnelId,
				CreatedTime:   now,
			})
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&relations).Error
	})
}
