package repo

import (
	"database/sql"
	"testing"
	"time"

	"go-backend/internal/store/model"
)

func newFlowResetTestUser(id, inFlow, outFlow, resetAt, updatedAt int64) model.User {
	return model.User{
		ID: id, User: "flow-reset-user", Pwd: "x", RoleID: 1, ExpTime: 0,
		Flow: 100, InFlow: inFlow, OutFlow: outFlow, FlowResetTime: 15,
		FlowLastResetAt: resetAt, Num: 1, CreatedTime: updatedAt,
		UpdatedTime: sqlNullInt64(updatedAt), Status: 1,
	}
}

func sqlNullInt64(value int64) (result sql.NullInt64) {
	result.Int64 = value
	result.Valid = true
	return result
}

func TestResetUserMonthlyFlowUsesLastResetAndReturnsUserID(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	defer r.Close()

	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)
	dayStart := time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC).UnixMilli()
	user := newFlowResetTestUser(42, 123, 456, dayStart-1, dayStart)
	if err := r.DB().Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	alreadyResetUser := newFlowResetTestUser(43, 789, 111, dayStart, dayStart)
	if err := r.DB().Create(&alreadyResetUser).Error; err != nil {
		t.Fatalf("create already reset user: %v", err)
	}

	snapshots, err := r.ResetUserMonthlyFlow(15, 31, now)
	if err != nil {
		t.Fatalf("reset monthly flow: %v", err)
	}
	if len(snapshots) != 1 || snapshots[0].UserID != 42 || snapshots[0].InFlow != 123 || snapshots[0].OutFlow != 456 {
		t.Fatalf("unexpected snapshot: %+v", snapshots)
	}
	var gotUser model.User
	if err := r.DB().Where("id = ?", 42).First(&gotUser).Error; err != nil {
		t.Fatalf("load reset user: %v", err)
	}
	if gotUser.InFlow != 0 || gotUser.OutFlow != 0 || gotUser.FlowLastResetAt != now.UnixMilli() {
		t.Fatalf("user was not reset: %+v", gotUser)
	}

	snapshots, err = r.ResetUserMonthlyFlow(15, 31, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("repeat monthly flow reset: %v", err)
	}
	if len(snapshots) != 0 {
		t.Fatalf("expected no duplicate snapshot, got %+v", snapshots)
	}
}

func TestMarkExpiredUserAutoRenewFailureSkipsEmptyHistory(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	defer r.Close()

	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC).UnixMilli()
	user := newFlowResetTestUser(7, 0, 0, now-1000, now-1000)
	user.ExpTime = now - 1
	if err := r.DB().Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := r.MarkExpiredUserAutoRenewFailure(user.ID, user.ExpTime, now, "expired"); err != nil {
		t.Fatalf("mark expired user: %v", err)
	}
	var count int64
	if err := r.DB().Model(&model.UserQuotaHistory{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
		t.Fatalf("count history: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no empty history, got %d", count)
	}
}

func TestMarkUserAutoRenewSuccessResetsUserTunnelAndWritesHistory(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repository: %v", err)
	}
	defer r.Close()

	now := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC).UnixMilli()
	newExp := now + int64(24*time.Hour/time.Millisecond)
	user := newFlowResetTestUser(8, 100, 200, now-1000, now-1000)
	user.ExpTime = now - 1
	if err := r.DB().Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := r.DB().Create(&model.UserQuota{UserID: user.ID, MonthKey: 202608, CreatedTime: now, UpdatedTime: now}).Error; err != nil {
		t.Fatalf("create quota: %v", err)
	}
	if err := r.DB().Create(&model.PackageSubscription{UserID: user.ID, PackageID: 1, PendingRenewalResetAt: now - 1, Status: 1, StartAt: now, ExpireAt: newExp, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatalf("create subscription: %v", err)
	}
	if err := r.DB().Create(&model.UserTunnel{UserID: user.ID, TunnelID: 1, Num: 1, Flow: 100, InFlow: 300, OutFlow: 400, FlowResetTime: 15, ExpTime: newExp, Status: 0}).Error; err != nil {
		t.Fatalf("create tunnel: %v", err)
	}

	if err := r.MarkUserAutoRenewSuccess(user.ID, newExp, now); err != nil {
		t.Fatalf("mark auto renew success: %v", err)
	}
	var got model.User
	if err := r.DB().Where("id = ?", user.ID).First(&got).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if got.InFlow != 0 || got.OutFlow != 0 || got.FlowLastResetAt != now {
		t.Fatalf("user flow reset mismatch: %+v", got)
	}
	var tunnel model.UserTunnel
	if err := r.DB().Where("user_id = ?", user.ID).First(&tunnel).Error; err != nil {
		t.Fatalf("load tunnel: %v", err)
	}
	if tunnel.InFlow != 0 || tunnel.OutFlow != 0 || tunnel.Status != 1 {
		t.Fatalf("tunnel flow reset mismatch: %+v", tunnel)
	}
	var history model.UserQuotaHistory
	if err := r.DB().Where("user_id = ?", user.ID).First(&history).Error; err != nil {
		t.Fatalf("load history: %v", err)
	}
	if history.InFlowBefore != 100 || history.OutFlowBefore != 200 || history.UsedBytes != 300 {
		t.Fatalf("history mismatch: %+v", history)
	}
}
