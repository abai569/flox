package repo

import (
	"database/sql"
	"testing"
	"time"

	"go-backend/internal/store/model"
)

func TestListForwardsByTunnelPreservesInlineSpeedLimit(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	now := time.Now().UnixMilli()
	forward := model.Forward{
		UserID:            1,
		UserName:          "test",
		Name:              "limited",
		TunnelID:          9,
		RemoteAddr:        "127.0.0.1:80",
		Strategy:          "fifo",
		CreatedTime:       now,
		UpdatedTime:       now,
		Status:            1,
		SpeedLimitEnabled: true,
		SpeedLimit:        10,
		Mode:              "gost",
	}
	if err := r.db.Create(&forward).Error; err != nil {
		t.Fatal(err)
	}

	rows, err := r.ListForwardsByTunnel(9)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || !rows[0].SpeedLimitEnabled || rows[0].SpeedLimit != 10 {
		t.Fatalf("unexpected forward records: %+v", rows)
	}
}

func TestListForwardIDsBySpeedLimitIncludesDirectAndTunnelReferences(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	now := time.Now().UnixMilli()
	forwards := []model.Forward{
		{UserID: 1, UserName: "direct", Name: "direct", TunnelID: 10, RemoteAddr: "127.0.0.1:80", Strategy: "fifo", CreatedTime: now, UpdatedTime: now, Status: 1, SpeedID: sql.NullInt64{Int64: 7, Valid: true}},
		{UserID: 2, UserName: "tunnel", Name: "tunnel", TunnelID: 20, RemoteAddr: "127.0.0.1:80", Strategy: "fifo", CreatedTime: now, UpdatedTime: now, Status: 1},
	}
	if err := r.db.Create(&forwards).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.UserTunnel{UserID: 2, TunnelID: 20, SpeedID: sql.NullInt64{Int64: 7, Valid: true}, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}

	ids, err := r.ListForwardIDsBySpeedLimit(7)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != forwards[0].ID || ids[1] != forwards[1].ID {
		t.Fatalf("unexpected forward IDs: %v", ids)
	}
}

func TestListActiveTunnelIDsByNodeIncludesForwardEntry(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	now := time.Now().UnixMilli()
	node := model.Node{
		Name: "remote-entry", Secret: "secret", ServerIP: "127.0.0.1", Port: "0",
		CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]",
	}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	tunnel := model.Tunnel{Name: "entry-only", TrafficRatio: 1, Type: 1, Protocol: "tls", Flow: 1, CreatedTime: now, UpdatedTime: now, Status: 1}
	if err := r.db.Create(&tunnel).Error; err != nil {
		t.Fatal(err)
	}
	forward := model.Forward{
		UserID: 1, UserName: "test", Name: "entry", TunnelID: tunnel.ID,
		RemoteAddr: "127.0.0.1:80", Strategy: "fifo", CreatedTime: now, UpdatedTime: now, Status: 1,
	}
	if err := r.db.Create(&forward).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.ForwardPort{ForwardID: forward.ID, NodeID: node.ID, Port: 30001}).Error; err != nil {
		t.Fatal(err)
	}

	ids, err := r.ListActiveTunnelIDsByNode(node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != tunnel.ID {
		t.Fatalf("unexpected tunnel IDs: %v", ids)
	}
}
