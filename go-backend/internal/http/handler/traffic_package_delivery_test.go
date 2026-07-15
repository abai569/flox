package handler

import (
	"path/filepath"
	"testing"
	"time"

	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func seedTrafficPackageUserTunnel(t *testing.T, r *repo.Repository, nowMs int64) {
	t.Helper()
	if err := r.DB().Exec(`
		INSERT INTO user(id, user, pwd, role_id, exp_time, flow, in_flow, out_flow, flow_reset_time, num, created_time, updated_time, status, balance)
		VALUES(2, 'traffic_package_user', 'x', 1, 0, 100, 0, 0, 1, 1, ?, ?, 1, 5000)
	`, nowMs, nowMs).Error; err != nil {
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
}

func TestDeliverTrafficPackageToUserIncreasesExistingUserTunnelFlow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "traffic-package-deliver-user-tunnel-flow.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	nowMs := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC).UnixMilli()
	seedTrafficPackageUserTunnel(t, r, nowMs)

	if err := r.DeliverTrafficPackageToUser(2, 20, 1000, 20, 1, nil); err != nil {
		t.Fatalf("deliver traffic package: %v", err)
	}

	userFlow := mustQueryInt(t, r, `SELECT flow FROM user WHERE id = 2`)
	if userFlow != 120 {
		t.Fatalf("expected user flow increased to 120, got %d", userFlow)
	}
	userTunnelFlow := mustQueryInt(t, r, `SELECT flow FROM user_tunnel WHERE id = 10`)
	if userTunnelFlow != 120 {
		t.Fatalf("expected user_tunnel flow increased to 120, got %d", userTunnelFlow)
	}
}

func TestCompleteTrafficPackageOrderIncreasesExistingUserTunnelFlow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "traffic-package-order-user-tunnel-flow.db")
	r, err := repo.Open(dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	nowMs := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC).UnixMilli()
	seedTrafficPackageUserTunnel(t, r, nowMs)

	order := &model.Order{
		OrderNo:     "traffic-package-order-1",
		UserID:      2,
		UserName:    "traffic_package_user",
		ProductID:   1,
		ProductName: "traffic-pack",
		ProductType: "traffic",
		Amount:      1000,
		PayCurrency: "BALANCE",
	}
	pkg := &model.SubscriptionPackage{
		ID:           1,
		Type:         "traffic",
		Name:         "traffic-pack",
		Price:        1000,
		TrafficLimit: 20,
	}
	if err := r.CompletePackageOrder(2, "traffic_package_user", order, pkg, nil, 1); err != nil {
		t.Fatalf("complete traffic package order: %v", err)
	}

	userFlow := mustQueryInt(t, r, `SELECT flow FROM user WHERE id = 2`)
	if userFlow != 120 {
		t.Fatalf("expected user flow increased to 120, got %d", userFlow)
	}
	userTunnelFlow := mustQueryInt(t, r, `SELECT flow FROM user_tunnel WHERE id = 10`)
	if userTunnelFlow != 120 {
		t.Fatalf("expected user_tunnel flow increased to 120, got %d", userTunnelFlow)
	}
}
