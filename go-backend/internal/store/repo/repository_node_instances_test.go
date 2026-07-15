package repo

import (
	"testing"

	"go-backend/internal/store/model"
)

func TestListOnlineNodeInstancesByNodeIDsTxUsesTransactionConnection(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	instance := model.NodeInstance{
		NodeID:      1,
		InstanceID:  "instance-1",
		Status:      1,
		CreatedTime: 1,
		UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}

	tx := r.BeginTx()
	if tx.Error != nil {
		t.Fatalf("begin transaction: %v", tx.Error)
	}
	defer tx.Rollback()

	instancesByNode, err := r.ListOnlineNodeInstancesByNodeIDsTx(tx, []int64{1})
	if err != nil {
		t.Fatalf("list node instances in transaction: %v", err)
	}
	instances := instancesByNode[1]
	if len(instances) != 1 {
		t.Fatalf("expected 1 node instance, got %d", len(instances))
	}
	if instances[0].DisplayIndex != 1 {
		t.Fatalf("expected display index 1, got %d", instances[0].DisplayIndex)
	}
}

func TestUpsertNodeInstanceClearsRuntimeTrafficWhenOfflineInstanceMovesServer(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	instance := model.NodeInstance{
		NodeID:       1,
		InstanceID:   "instance-1",
		Hostname:     "old-host",
		PublicIPV4:   "192.0.2.1",
		PublicIPV6:   "2001:db8::1",
		Status:       1,
		TrafficLimit: 100,
		TotalInFlow:  111,
		TotalOutFlow: 222,
		NetInBytes:   333,
		NetOutBytes:  444,
		PeriodRx:     555,
		PeriodTx:     666,
		CreatedTime:  1,
		UpdatedTime:  1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}
	if err := r.MarkNodeInstanceOffline(1, "instance-1", 2); err != nil {
		t.Fatalf("mark node instance offline: %v", err)
	}

	if err := r.UpsertNodeInstance(NodeInstanceUpsert{
		NodeID:      1,
		InstanceID:  "instance-1",
		Hostname:    "new-host",
		PublicIPV4:  "198.51.100.2",
		PublicIPV6:  "2001:db8::2",
		NetInBytes:  777,
		NetOutBytes: 888,
		PeriodRx:    999,
		PeriodTx:    1000,
		Now:         3,
	}); err != nil {
		t.Fatalf("upsert node instance: %v", err)
	}

	var got model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", int64(1), "instance-1").First(&got).Error; err != nil {
		t.Fatalf("load node instance: %v", err)
	}
	if got.Status != 1 || got.Hostname != "new-host" || got.PublicIPV4 != "198.51.100.2" || got.PublicIPV6 != "2001:db8::2" {
		t.Fatalf("expected migrated identity to update, got status=%d hostname=%q ipv4=%q ipv6=%q", got.Status, got.Hostname, got.PublicIPV4, got.PublicIPV6)
	}
	if got.NetInBytes != 0 || got.NetOutBytes != 0 || got.PeriodRx != 0 || got.PeriodTx != 0 {
		t.Fatalf("expected runtime traffic reset, got net=(%d,%d) period=(%d,%d)", got.NetInBytes, got.NetOutBytes, got.PeriodRx, got.PeriodTx)
	}
	if got.TrafficLimit != 100 || got.TotalInFlow != 111 || got.TotalOutFlow != 222 {
		t.Fatalf("expected limit usage preserved, got limit=%d total=(%d,%d)", got.TrafficLimit, got.TotalInFlow, got.TotalOutFlow)
	}
}
