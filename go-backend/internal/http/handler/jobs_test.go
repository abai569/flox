package handler

import (
	"path/filepath"
	"testing"
	"time"

	"go-backend/internal/store/repo"
)

func TestRunStatisticsFlowJobTracksIncrementAndPrunes(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-stats.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 2, 7, 12, 0, 0, 0, time.UTC)
	nowMs := now.UnixMilli()

	if err := r.DB().Exec(`UPDATE user SET in_flow = 100, out_flow = 200 WHERE id = 1`).Error; err != nil {
		t.Fatalf("seed user flow: %v", err)
	}

	if err := r.DB().Exec(`INSERT INTO statistics_flow(user_id, flow, total_flow, time, created_time) VALUES(1, 250, 250, '11:00', ?)`, now.Add(-time.Hour).UnixMilli()).Error; err != nil {
		t.Fatalf("seed recent statistics row: %v", err)
	}
	if err := r.DB().Exec(`INSERT INTO statistics_flow(user_id, flow, total_flow, time, created_time) VALUES(1, 10, 10, '00:00', ?)`, now.Add(-49*time.Hour).UnixMilli()).Error; err != nil {
		t.Fatalf("seed stale statistics row: %v", err)
	}

	h.runStatisticsFlowJob(now)

	staleCount := mustQueryInt(t, r, `SELECT COUNT(1) FROM statistics_flow WHERE created_time < ?`, nowMs-int64((48*time.Hour)/time.Millisecond))
	if staleCount != 0 {
		t.Fatalf("expected stale statistics rows to be pruned, got %d", staleCount)
	}

	flow, total, hour := mustQueryInt64Int64String(t, r, `SELECT flow, total_flow, time FROM statistics_flow WHERE user_id = 1 ORDER BY id DESC LIMIT 1`)
	if flow != 50 {
		t.Fatalf("expected increment flow 50, got %d", flow)
	}
	if total != 300 {
		t.Fatalf("expected total flow 300, got %d", total)
	}
	if hour != "12:00" {
		t.Fatalf("expected hour mark 12:00, got %s", hour)
	}
}

func TestNodeInstanceCycleResetDueUsesAnchoredMonthEnd(t *testing.T) {
	location := time.UTC
	anchor := time.Date(2026, 1, 31, 12, 0, 0, 0, location)
	if !nodeInstanceCycleResetDue(anchor.UnixMilli(), "month", time.Date(2026, 3, 31, 12, 0, 0, 0, location)) {
		t.Fatal("expected March 31 to be a monthly reset date for a January 31 anchor")
	}
	if nodeInstanceCycleResetDue(anchor.UnixMilli(), "month", time.Date(2026, 3, 30, 12, 0, 0, 0, location)) {
		t.Fatal("did not expect March 30 to be a monthly reset date")
	}

	quarterAnchor := time.Date(2026, 11, 30, 12, 0, 0, 0, location)
	if !nodeInstanceCycleResetDue(quarterAnchor.UnixMilli(), "quarter", time.Date(2027, 2, 28, 12, 0, 0, 0, location)) {
		t.Fatal("expected February 28 to be a quarterly reset date for a November 30 anchor")
	}
}

func TestNodeExpiryReminderDays(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC).UnixMilli()
	tests := []struct {
		name        string
		expiryMs    int64
		wantExpired bool
		wantDays    int
	}{
		{name: "expired", expiryMs: now - 1, wantExpired: true, wantDays: 0},
		{name: "expires now", expiryMs: now, wantExpired: true, wantDays: 0},
		{name: "future under one day", expiryMs: now + int64(time.Hour/time.Millisecond), wantDays: 1},
		{name: "future exact day", expiryMs: now + int64(24*time.Hour/time.Millisecond), wantDays: 1},
		{name: "future over one day", expiryMs: now + int64(24*time.Hour/time.Millisecond) + 1, wantDays: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expired, days := nodeExpiryReminderDays(tt.expiryMs, now)
			if expired != tt.wantExpired || days != tt.wantDays {
				t.Fatalf("nodeExpiryReminderDays() = (%v, %d), want (%v, %d)", expired, days, tt.wantExpired, tt.wantDays)
			}
		})
	}
}

func TestRunResetAndExpiryJobResetsFlowAndDisablesExpiredRecords(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-reset.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 3, 15, 0, 0, 5, 0, time.UTC)
	nowMs := now.UnixMilli()

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status)
		VALUES(2, 'expired_user', 'x', 1, ?, 100, 1000, 2000, 15, 1, ?, ?, 1)
	`, nowMs-1000, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert expired user: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status)
		VALUES(3, 'non_expiring_user', 'x', 1, 0, 100, 1000, 2000, 15, 1, ?, ?, 1)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert non-expiring user: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(1, 't1', 1.0, 1, 'tls', 1, ?, ?, 1, NULL, 0)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(10, 2, 1, NULL, 1, 1, 300, 400, 15, ?, 1)
	`, nowMs-1000).Error; err != nil {
		t.Fatalf("insert expired user_tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(11, 3, 1, NULL, 1, 1, 300, 400, 15, 0, 1)
	`).Error; err != nil {
		t.Fatalf("insert non-expiring user_tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO forward(id, user_id, user_name, name, tunnel_id, remote_addr, strategy, in_flow, out_flow, created_time, updated_time, status, inx)
		VALUES(20, 2, 'expired_user', 'f1', 1, '1.1.1.1:443', 'fifo', 0, 0, ?, ?, 1, 0)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert forward: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO forward(id, user_id, user_name, name, tunnel_id, remote_addr, strategy, in_flow, out_flow, created_time, updated_time, status, inx)
		VALUES(21, 3, 'non_expiring_user', 'f2', 1, '1.1.1.1:443', 'fifo', 0, 0, ?, ?, 1, 1)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert non-expiring forward: %v", err)
	}

	h.runResetAndExpiryJob(now)

	userIn, userOut, userStatus := mustQueryInt64Int64Int(t, r, `SELECT in_flow, out_flow, status FROM user WHERE id = 2`)
	if userIn != 0 || userOut != 0 || userStatus != 0 {
		t.Fatalf("expected user reset+disabled, got in=%d out=%d status=%d", userIn, userOut, userStatus)
	}

	utIn, utOut, utStatus := mustQueryInt64Int64Int(t, r, `SELECT in_flow, out_flow, status FROM user_tunnel WHERE id = 10`)
	if utIn != 0 || utOut != 0 || utStatus != 0 {
		t.Fatalf("expected user_tunnel reset+disabled, got in=%d out=%d status=%d", utIn, utOut, utStatus)
	}

	forwardStatus := mustQueryInt(t, r, `SELECT status FROM forward WHERE id = 20`)
	if forwardStatus != 0 {
		t.Fatalf("expected forward status=0 after expiry handling, got %d", forwardStatus)
	}

	nonExpUserStatus := mustQueryInt(t, r, `SELECT status FROM user WHERE id = 3`)
	if nonExpUserStatus != 1 {
		t.Fatalf("expected non-expiring user to remain enabled, got status=%d", nonExpUserStatus)
	}

	nonExpTunnelStatus := mustQueryInt(t, r, `SELECT status FROM user_tunnel WHERE id = 11`)
	if nonExpTunnelStatus != 1 {
		t.Fatalf("expected non-expiring user_tunnel to remain enabled, got status=%d", nonExpTunnelStatus)
	}

	nonExpForwardStatus := mustQueryInt(t, r, `SELECT status FROM forward WHERE id = 21`)
	if nonExpForwardStatus != 1 {
		t.Fatalf("expected non-expiring forward to remain enabled, got status=%d", nonExpForwardStatus)
	}
}

func TestRunResetAndExpiryJobResetsUserQuotaAndUnblocksUser(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-quota-reset.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 3, 12, 0, 0, 5, 0, time.UTC)
	nowMs := now.UnixMilli()

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status)
		VALUES(2, 'quota-reset-user', 'x', 1, 0, 99999, 0, 0, 1, 99999, ?, ?, 1)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if err := r.DB().Exec(`
		INSERT INTO user_quota(user_id, daily_limit_gb, monthly_limit_gb, daily_used_bytes, monthly_used_bytes, day_key, month_key, disabled_by_quota, disabled_at, paused_forward_ids, created_time, updated_time)
		VALUES(2, 10, 0, ?, ?, 20260311, 202603, 1, ?, '', ?, ?)
	`, 11*int64(1024*1024*1024), 11*int64(1024*1024*1024), nowMs, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user quota: %v", err)
	}

	h.runResetAndExpiryJob(now)

	dailyUsed := mustQueryInt(t, r, `SELECT daily_used_bytes FROM user_quota WHERE user_id = 2`)
	if dailyUsed != 0 {
		t.Fatalf("expected daily quota usage reset, got %d", dailyUsed)
	}
	quotaDisabled := mustQueryInt(t, r, `SELECT disabled_by_quota FROM user_quota WHERE user_id = 2`)
	if quotaDisabled != 0 {
		t.Fatalf("expected quota disabled flag cleared, got %d", quotaDisabled)
	}
}

func TestHandleAutoBuyTrafficPackageDoesNotDeductStockWhenBalanceInsufficient(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-auto-buy-insufficient.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	nowMs := now.UnixMilli()

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status, balance, auto_buy_traffic, auto_buy_traffic_package_id, auto_buy_traffic_threshold)
		VALUES(2, 'auto_buy_user', 'x', 1, 0, 100, ?, 0, 1, 1, ?, ?, 1, 500, 1, 1, 10)
	`, 95*int64(1024*1024*1024), nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO subscription_package(id, type, name, price, traffic_limit, auto_buy_traffic_enabled, enabled, stock, created_at, updated_at)
		VALUES(1, 'traffic', 'traffic-pack', 1000, 20, 1, 1, 5, ?, ?)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert package: %v", err)
	}

	h.handleAutoBuyTraffic(nowMs)

	stock := mustQueryInt(t, r, `SELECT stock FROM subscription_package WHERE id = 1`)
	if stock != 5 {
		t.Fatalf("expected stock unchanged, got %d", stock)
	}
	balance := mustQueryInt(t, r, `SELECT balance FROM user WHERE id = 2`)
	if balance != 500 {
		t.Fatalf("expected balance unchanged, got %d", balance)
	}
	buyCount := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_traffic_buy_log WHERE user_id = 2`)
	if buyCount != 0 {
		t.Fatalf("expected no buy log, got %d", buyCount)
	}
}

func TestHandleAutoBuyTrafficCustomIncreasesUserTunnelFlow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-auto-buy-custom-tunnel-flow.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	nowMs := now.UnixMilli()

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status, balance, auto_buy_traffic, buy_traffic_amount, buy_traffic_price, auto_buy_traffic_threshold)
		VALUES(2, 'auto_buy_custom_user', 'x', 1, 0, 100, ?, 0, 1, 1, ?, ?, 1, 2000, 1, 20, 1000, 10)
	`, 95*int64(1024*1024*1024), nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(1, 't1', 1.0, 1, 'tls', 1, ?, ?, 1, NULL, 0)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(10, 2, 1, NULL, 1, 100, 0, 0, 1, 0, 1)
	`).Error; err != nil {
		t.Fatalf("insert user_tunnel: %v", err)
	}

	h.handleAutoBuyTraffic(nowMs)

	userFlow := mustQueryInt(t, r, `SELECT flow FROM user WHERE id = 2`)
	if userFlow != 120 {
		t.Fatalf("expected user flow increased to 120, got %d", userFlow)
	}
	userTunnelFlow := mustQueryInt(t, r, `SELECT flow FROM user_tunnel WHERE id = 10`)
	if userTunnelFlow != 120 {
		t.Fatalf("expected user_tunnel flow increased to 120, got %d", userTunnelFlow)
	}
	balance := mustQueryInt(t, r, `SELECT balance FROM user WHERE id = 2`)
	if balance != 1000 {
		t.Fatalf("expected balance deducted to 1000, got %d", balance)
	}
}

func TestRunResetAndExpiryJobAutoRenewsExpiredUser(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "jobs-auto-renew-success.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	h := New(r, "secret")
	now := time.Date(2026, 3, 15, 0, 0, 5, 0, time.UTC)
	nowMs := now.UnixMilli()
	oldExp := now.Add(-time.Hour).UnixMilli()

	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status, renewal_amount, balance, auto_renew)
		VALUES(2, 'renew-user', 'x', 1, ?, 100, 1000, 2000, 15, 1, ?, ?, 1, 500, 1000, 1)
	`, oldExp, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user_quota(user_id, daily_limit_gb, monthly_limit_gb, daily_used_bytes, monthly_used_bytes, day_key, month_key, disabled_by_quota, disabled_at, paused_forward_ids, created_time, updated_time)
		VALUES(2, 0, 0, 0, ?, 20260315, 202603, 0, 0, '', ?, ?)
	`, 3*int64(1024*1024*1024), nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert user quota: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(1, 't1', 1.0, 1, 'tls', 1, ?, ?, 1, NULL, 0)
	`, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO user_tunnel(id, user_id, tunnel_id, speed_id, num, flow, in_flow, out_flow, flow_reset_time, exp_time, status)
		VALUES(10, 2, 1, NULL, 1, 1, 300, 400, 15, ?, 1)
	`, oldExp).Error; err != nil {
		t.Fatalf("insert user_tunnel: %v", err)
	}

	if err := r.DB().Exec(`
		INSERT INTO package_subscription(user_id, package_id, start_at, expire_at, auto_renew, status, order_id, renewal_amount, renewal_validity_days, created_at, updated_at)
		VALUES(2, 1, ?, ?, 1, 1, 1, 500, 30, ?, ?)
	`, oldExp, oldExp, nowMs, nowMs).Error; err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	h.runResetAndExpiryJob(now)

	newExp := mustQueryInt64(t, r, `SELECT exp_time FROM user WHERE id = 2`)
	expectedExp := time.UnixMilli(oldExp).AddDate(0, 1, 0).UnixMilli()
	if newExp != expectedExp {
		t.Fatalf("expected exp_time %d, got %d", expectedExp, newExp)
	}
	balance := mustQueryInt(t, r, `SELECT balance FROM user WHERE id = 2`)
	if balance != 500 {
		t.Fatalf("expected balance deducted to 500, got %d", balance)
	}
	userIn, userOut, userStatus := mustQueryInt64Int64Int(t, r, `SELECT in_flow, out_flow, status FROM user WHERE id = 2`)
	if userIn != 0 || userOut != 0 || userStatus != 1 {
		t.Fatalf("expected user reset and enabled, got in=%d out=%d status=%d", userIn, userOut, userStatus)
	}
	utExp := mustQueryInt64(t, r, `SELECT exp_time FROM user_tunnel WHERE id = 10`)
	// 续期只更新有隧道基线快照的隧道；测试未创建快照，因此保持旧值
	if utExp != oldExp && utExp != expectedExp {
		t.Fatalf("unexpected user_tunnel exp_time %d", utExp)
	}
	renewCount := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_renewal_log WHERE user_id = 2`)
	if renewCount != 1 {
		t.Fatalf("expected one renewal log, got %d", renewCount)
	}
}

func TestAutoRenewBeforeExpiryDefersFlowReset(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "jobs-auto-renew-early.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	h := New(r, "secret")
	now := time.Date(2026, 3, 12, 0, 0, 5, 0, time.UTC)
	expires := now.Add(48 * time.Hour).UnixMilli()
	nowMs := now.UnixMilli()
	if err := r.DB().Exec(`INSERT INTO user(id,user,pwd,role_id,exp_time,flow,in_flow,out_flow,flow_reset_time,num,created_time,updated_time,status,renewal_amount,balance,auto_renew) VALUES(2,'early','x',1,?,100,1000,2000,15,1,?,?,1,500,1000,1)`, expires, nowMs, nowMs).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.DB().Exec(`INSERT INTO package_subscription(user_id,package_id,start_at,expire_at,auto_renew,status,order_id,renewal_amount,renewal_validity_days,created_at,updated_at) VALUES(2,1,?,?,1,1,1,500,30,?,?)`, nowMs, expires, nowMs, nowMs).Error; err != nil {
		t.Fatal(err)
	}
	h.disableExpiredUsers(nowMs)
	inFlow, outFlow, status := mustQueryInt64Int64Int(t, r, `SELECT in_flow,out_flow,status FROM user WHERE id=2`)
	if inFlow != 1000 || outFlow != 2000 || status != 1 {
		t.Fatalf("expected flow unchanged before expiry, got in=%d out=%d status=%d", inFlow, outFlow, status)
	}
	pending := mustQueryInt64(t, r, `SELECT pending_renewal_reset_at FROM package_subscription WHERE user_id=2`)
	if pending != expires {
		t.Fatalf("expected pending reset at %d, got %d", expires, pending)
	}
	h.disableExpiredUsers(expires)
	inFlow, outFlow, status = mustQueryInt64Int64Int(t, r, `SELECT in_flow,out_flow,status FROM user WHERE id=2`)
	if inFlow != 0 || outFlow != 0 || status != 1 {
		t.Fatalf("expected one reset at expiry, got in=%d out=%d status=%d", inFlow, outFlow, status)
	}
	h.disableExpiredUsers(expires + 1000)
	if count := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_quota_history WHERE user_id=2`); count != 1 {
		t.Fatalf("expected one reset history, got %d", count)
	}
}

func TestAutoRenewLegacyUserWithoutSubscriptionSnapshotNotifiesInsufficientBalance(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "jobs-auto-renew-legacy.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	h := New(r, "secret")
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	expires := now.Add(48 * time.Hour).UnixMilli()
	nowMs := now.UnixMilli()
	if err := r.DB().Exec(`INSERT INTO user(id,user,pwd,role_id,exp_time,flow,in_flow,out_flow,flow_reset_time,num,created_time,updated_time,status,renewal_amount,balance,auto_renew) VALUES(2,'legacy','x',1,?,4000,0,0,1,37,?,?,1,36000,25500,1)`, expires, nowMs, nowMs).Error; err != nil {
		t.Fatal(err)
	}

	h.disableExpiredUsers(nowMs)

	if got := mustQueryInt64(t, r, `SELECT exp_time FROM user WHERE id=2`); got != expires {
		t.Fatalf("expected expiry unchanged at %d, got %d", expires, got)
	}
	if got := mustQueryInt(t, r, `SELECT balance FROM user WHERE id=2`); got != 25500 {
		t.Fatalf("expected balance unchanged at 25500, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_notification WHERE user_id=2 AND type='balance'`); got != 1 {
		t.Fatalf("expected one balance notification, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM package_subscription WHERE user_id=2 AND status=1`); got != 1 {
		t.Fatalf("expected persistent compatibility snapshot, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_renewal_log WHERE user_id=2`); got != 0 {
		t.Fatalf("expected no renewal with insufficient balance, got %d", got)
	}
	if err := r.DB().Exec(`UPDATE user SET balance=50000 WHERE id=2`).Error; err != nil {
		t.Fatal(err)
	}
	h.disableExpiredUsers(nowMs + int64(time.Minute/time.Millisecond))
	expectedExp := time.UnixMilli(expires).AddDate(0, 1, 0).UnixMilli()
	if got := mustQueryInt64(t, r, `SELECT exp_time FROM user WHERE id=2`); got != expectedExp {
		t.Fatalf("expected retry expiry %d, got %d", expectedExp, got)
	}
	if got := mustQueryInt(t, r, `SELECT balance FROM user WHERE id=2`); got != 14000 {
		t.Fatalf("expected retry balance 14000, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_renewal_log WHERE user_id=2`); got != 1 {
		t.Fatalf("expected one renewal after retry, got %d", got)
	}
}

func TestAutoRenewLegacyUserWithoutSubscriptionSnapshotSucceeds(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "jobs-auto-renew-legacy-success.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	h := New(r, "secret")
	now := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	expires := now.Add(48 * time.Hour).UnixMilli()
	nowMs := now.UnixMilli()
	if err := r.DB().Exec(`INSERT INTO user(id,user,pwd,role_id,exp_time,flow,in_flow,out_flow,flow_reset_time,num,created_time,updated_time,status,renewal_amount,balance,auto_renew) VALUES(2,'legacy','x',1,?,4000,0,0,1,37,?,?,1,36000,50000,1)`, expires, nowMs, nowMs).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.DB().Exec(`INSERT INTO user_tunnel(user_id,tunnel_id,num,flow,in_flow,out_flow,flow_reset_time,exp_time,status) VALUES(2,99,37,4000,1234,5678,1,?,1)`, expires).Error; err != nil {
		t.Fatal(err)
	}

	h.disableExpiredUsers(nowMs)

	expectedExp := time.UnixMilli(expires).AddDate(0, 1, 0).UnixMilli()
	if got := mustQueryInt64(t, r, `SELECT exp_time FROM user WHERE id=2`); got != expectedExp {
		t.Fatalf("expected expiry %d, got %d", expectedExp, got)
	}
	if got := mustQueryInt(t, r, `SELECT balance FROM user WHERE id=2`); got != 14000 {
		t.Fatalf("expected balance 14000, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM package_subscription WHERE user_id=2 AND status=1`); got != 1 {
		t.Fatalf("expected compatibility snapshot, got %d", got)
	}
	if got := mustQueryInt(t, r, `SELECT COUNT(1) FROM user_renewal_log WHERE user_id=2`); got != 1 {
		t.Fatalf("expected one renewal log, got %d", got)
	}
	newTunnelExp := mustQueryInt64(t, r, `SELECT exp_time FROM user_tunnel WHERE user_id=2 AND tunnel_id=99`)
	if newTunnelExp != expectedExp {
		t.Fatalf("expected tunnel expiry %d, got %d", expectedExp, newTunnelExp)
	}
	var tunnelInFlow, tunnelOutFlow int64
	if err := r.DB().Raw(`SELECT in_flow, out_flow FROM user_tunnel WHERE user_id=2 AND tunnel_id=99`).Row().Scan(&tunnelInFlow, &tunnelOutFlow); err != nil {
		t.Fatal(err)
	}
	if tunnelInFlow != 1234 || tunnelOutFlow != 5678 {
		t.Fatalf("expected tunnel flow preserved before original expiry, got %d/%d", tunnelInFlow, tunnelOutFlow)
	}
	h.disableExpiredUsers(expires)
	if err := r.DB().Raw(`SELECT in_flow, out_flow FROM user_tunnel WHERE user_id=2 AND tunnel_id=99`).Row().Scan(&tunnelInFlow, &tunnelOutFlow); err != nil {
		t.Fatal(err)
	}
	if tunnelInFlow != 0 || tunnelOutFlow != 0 {
		t.Fatalf("expected tunnel flow reset at original expiry, got %d/%d", tunnelInFlow, tunnelOutFlow)
	}
}
