package repo

import (
	"errors"
	"time"

	"go-backend/internal/store/model"
	"gorm.io/gorm"
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

// GetUserTunnelGroupIDs returns a map of userID → tunnelGroupID for users
// who have been directly assigned to a tunnel group (userGroupID=0 in group_permission_grant).
func (r *Repository) GetUserTunnelGroupIDs(userIDs []int64) (map[int64]int64, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("repository not initialized")
	}
	if len(userIDs) == 0 {
		return map[int64]int64{}, nil
	}
	type result struct {
		UserID        int64
		TunnelGroupID int64
	}
	var rows []result
	err := r.db.Table("group_permission_grant").
		Select("user_tunnel.user_id, group_permission_grant.tunnel_group_id").
		Joins("JOIN user_tunnel ON user_tunnel.id = group_permission_grant.user_tunnel_id").
		Where("user_tunnel.user_id IN ? AND group_permission_grant.user_group_id = 0", userIDs).
		Order("group_permission_grant.id DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(rows))
	for _, row := range rows {
		if _, exists := m[row.UserID]; !exists {
			m[row.UserID] = row.TunnelGroupID
		}
	}
	return m, nil
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
		// Delete existing assignments
		if err := tx.Where("tunnel_id = ?", tunnelId).Delete(&model.TunnelGroupTunnelNew{}).Error; err != nil {
			return err
		}

		// Update tunnel.tunnel_group_id (use first group ID or NULL)
		var groupId interface{}
		if len(groupIds) > 0 {
			groupId = groupIds[0]
		} else {
			groupId = nil
		}
		if err := tx.Model(&model.Tunnel{}).Where("id = ?", tunnelId).Update("tunnel_group_id", groupId).Error; err != nil {
			return err
		}

		// Insert new assignments
		if len(groupIds) > 0 {
			now := time.Now().UnixMilli()
			relations := make([]model.TunnelGroupTunnelNew, len(groupIds))
			for i, groupId := range groupIds {
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
		// Filter valid tunnel IDs
		validTunnelIds := make([]int64, 0, len(tunnelIds))
		for _, id := range tunnelIds {
			if id > 0 {
				validTunnelIds = append(validTunnelIds, id)
			}
		}

		if len(validTunnelIds) == 0 {
			return nil
		}

		// Delete existing assignments for these tunnels
		if err := tx.Where("tunnel_id IN ?", validTunnelIds).Delete(&model.TunnelGroupTunnelNew{}).Error; err != nil {
			return err
		}

		// Update tunnel.tunnel_group_id for all tunnels
		if err := tx.Model(&model.Tunnel{}).Where("id IN ?", validTunnelIds).Update("tunnel_group_id", groupId).Error; err != nil {
			return err
		}

		// Insert new assignments
		now := time.Now().UnixMilli()
		relations := make([]model.TunnelGroupTunnelNew, len(validTunnelIds))
		for i, tunnelId := range validTunnelIds {
			relations[i] = model.TunnelGroupTunnelNew{
				TunnelGroupID: groupId,
				TunnelID:      tunnelId,
				CreatedTime:   now,
			}
		}
		return tx.Create(&relations).Error
	})
}
