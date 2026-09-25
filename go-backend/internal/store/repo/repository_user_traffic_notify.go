package repo

import (
	"errors"

	"go-backend/internal/store/model"
)

// userTrafficAlertThresholds 是用户总流量告警阈值（百分比）与去重位。
var userTrafficAlertThresholds = []struct {
	percent int
	bit     int
}{
	{80, 1},
	{90, 2},
	{100, 4},
}

// BumpUserTrafficNotifyThresholds 返回本次新跨过的用户流量告警阈值（80/90/100），
// 并持久化去重掩码；流量回落（如周期归零）后自动清空掩码。
func (r *Repository) BumpUserTrafficNotifyThresholds(userID int64) ([]float64, string, error) {
	if r == nil || r.db == nil {
		return nil, "", errors.New("repository not initialized")
	}
	if userID <= 0 {
		return nil, "", nil
	}
	var user model.User
	if err := r.db.Select("id", "user", "flow", "in_flow", "out_flow", "traffic_notified_mask").
		Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, "", err
	}
	mask := user.TrafficNotifiedMask
	limitBytes := user.Flow * 1024 * 1024 * 1024
	if limitBytes <= 0 {
		if mask != 0 {
			_ = r.db.Model(&model.User{}).Where("id = ?", userID).Update("traffic_notified_mask", 0).Error
		}
		return nil, user.User, nil
	}
	total := user.InFlow + user.OutFlow
	if total < 0 {
		total = 0
	}
	percent := float64(total) / float64(limitBytes) * 100
	if percent < float64(userTrafficAlertThresholds[0].percent) {
		if mask != 0 {
			_ = r.db.Model(&model.User{}).Where("id = ?", userID).Update("traffic_notified_mask", 0).Error
		}
		return nil, user.User, nil
	}
	newBits := 0
	for _, threshold := range userTrafficAlertThresholds {
		if percent >= float64(threshold.percent) {
			newBits |= threshold.bit
		}
	}
	newBits &^= mask
	if newBits == 0 {
		return nil, user.User, nil
	}
	mask |= newBits
	if err := r.db.Model(&model.User{}).Where("id = ?", userID).Update("traffic_notified_mask", mask).Error; err != nil {
		return nil, user.User, err
	}
	crossed := make([]float64, 0, len(userTrafficAlertThresholds))
	for _, threshold := range userTrafficAlertThresholds {
		if newBits&threshold.bit != 0 {
			crossed = append(crossed, float64(threshold.percent))
		}
	}
	return crossed, user.User, nil
}
