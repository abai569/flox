package repo

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"go-backend/internal/store/model"
)

func TestUpdateNodeInstanceOrderPersistsCompleteOrder(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	node := model.Node{Name: "node-1", Secret: "secret", CreatedTime: 1}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	for i, instanceID := range []string{"instance-a", "instance-b", "instance-c"} {
		instance := model.NodeInstance{NodeID: node.ID, InstanceID: instanceID, DisplayIndex: i + 1, CreatedTime: 1, UpdatedTime: 1}
		if err := r.db.Create(&instance).Error; err != nil {
			t.Fatalf("create node instance %s: %v", instanceID, err)
		}
	}

	if err := r.UpdateNodeInstanceOrder(node.ID, []string{"instance-c", "instance-a", "instance-b"}); err != nil {
		t.Fatalf("update node instance order: %v", err)
	}
	instances, err := r.ListNodeInstances(node.ID)
	if err != nil {
		t.Fatalf("list node instances: %v", err)
	}
	for i, want := range []string{"instance-c", "instance-a", "instance-b"} {
		if instances[i].InstanceID != want || instances[i].DisplayIndex != i+1 {
			t.Fatalf("position %d: expected %s at index %d, got %s at index %d", i, want, i+1, instances[i].InstanceID, instances[i].DisplayIndex)
		}
	}
}

func TestUpdateNodeInstanceOrderRejectsInvalidSetsWithoutChanges(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	for _, node := range []model.Node{
		{ID: 1, Name: "node-1", Secret: "secret-1", CreatedTime: 1},
		{ID: 2, Name: "node-2", Secret: "secret-2", CreatedTime: 1},
	} {
		if err := r.db.Create(&node).Error; err != nil {
			t.Fatalf("create node: %v", err)
		}
	}
	for _, instance := range []model.NodeInstance{
		{NodeID: 1, InstanceID: "instance-a", DisplayIndex: 1, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: 1, InstanceID: "instance-b", DisplayIndex: 2, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: 2, InstanceID: "foreign", DisplayIndex: 1, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: 1, InstanceID: "default", DisplayIndex: 99, CreatedTime: 1, UpdatedTime: 1},
	} {
		if err := r.db.Create(&instance).Error; err != nil {
			t.Fatalf("create node instance: %v", err)
		}
	}

	tests := []struct {
		name        string
		nodeID      int64
		instanceIDs []string
	}{
		{name: "missing node id", nodeID: 0, instanceIDs: []string{"instance-a", "instance-b"}},
		{name: "missing instance ids", nodeID: 1, instanceIDs: nil},
		{name: "empty instance id", nodeID: 1, instanceIDs: []string{"instance-a", " "}},
		{name: "duplicate instance id", nodeID: 1, instanceIDs: []string{"instance-a", "instance-a"}},
		{name: "incomplete set", nodeID: 1, instanceIDs: []string{"instance-a"}},
		{name: "foreign instance", nodeID: 1, instanceIDs: []string{"instance-a", "foreign"}},
		{name: "unknown node", nodeID: 99, instanceIDs: []string{"instance-a"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := r.UpdateNodeInstanceOrder(tt.nodeID, tt.instanceIDs)
			if !errors.Is(err, ErrInvalidNodeInstanceOrder) {
				t.Fatalf("expected invalid order error, got %v", err)
			}
			var indexes []int
			if err := r.db.Model(&model.NodeInstance{}).Where("node_id = ? AND instance_id IN ?", 1, []string{"instance-a", "instance-b"}).Order("instance_id").Pluck("display_index", &indexes).Error; err != nil {
				t.Fatalf("load display indexes: %v", err)
			}
			if len(indexes) != 2 || indexes[0] != 1 || indexes[1] != 2 {
				t.Fatalf("expected original indexes [1 2], got %v", indexes)
			}
		})
	}
}

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

func TestSyncRemoteNodeInstancesReplacesLocalTrafficRatio(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "remote-instance-ratio.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Now().UnixMilli()
	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "127.0.0.1", Port: "0", IsRemote: 1, TrafficRatio: 2.5, CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instance := model.NodeInstance{NodeID: node.ID, InstanceID: "instance-a", TrafficRatio: 3.5, Weight: 1, TotalInFlow: 11, TotalOutFlow: 22, CreatedTime: now, UpdatedTime: now}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatalf("create instance: %v", err)
	}

	instances, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{
		InstanceID: "instance-a", DisplayName: "Source A", PublicIPV4: "203.0.113.30", PublicIPV6: "2001:db8::30", Status: 1, Weight: 4, TrafficRatio: 7.5, TotalInFlow: 100, TotalOutFlow: 200,
	}}, now+1)
	if err != nil {
		t.Fatalf("sync remote instances: %v", err)
	}
	if len(instances) != 1 || instances[0].TrafficRatio != 7.5 {
		t.Fatalf("expected provider ratio 7.5 to replace local ratio, got %+v", instances)
	}
	if instances[0].DisplayName != "Source A" || instances[0].PublicIPV4 != "203.0.113.30" || instances[0].PublicIPV6 != "2001:db8::30" || instances[0].Weight != 4 || instances[0].TotalInFlow != 11 || instances[0].TotalOutFlow != 22 {
		t.Fatalf("expected remote fields to update, got %+v", instances[0])
	}
	storedNode, err := r.GetNodeByID(node.ID)
	if err != nil || storedNode == nil || storedNode.TrafficRatio != 2.5 {
		t.Fatalf("expected local node ratio 2.5 to survive sync, node=%+v err=%v", storedNode, err)
	}
}

func TestSyncRemoteNodeInstancesRemovesInstancesOutsideShareScope(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "remote-instance-scope.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Now().UnixMilli()
	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "127.0.0.1", Port: "0", IsRemote: 1, CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instances := []model.NodeInstance{
		{NodeID: node.ID, InstanceID: "kept", Weight: 1, CreatedTime: now, UpdatedTime: now},
		{NodeID: node.ID, InstanceID: "removed", Weight: 1, CreatedTime: now, UpdatedTime: now},
	}
	if err := r.db.Create(&instances).Error; err != nil {
		t.Fatalf("create instances: %v", err)
	}

	got, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{
		InstanceID: "kept", Status: 1, Weight: 1,
	}}, now+1)
	if err != nil {
		t.Fatalf("sync remote instances: %v", err)
	}
	if len(got) != 1 || got[0].InstanceID != "kept" {
		t.Fatalf("expected only scoped instance to remain, got %+v", got)
	}
}

func TestSyncRemoteNodeInstancesIgnoresOlderSnapshot(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "remote-instance-generation.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Now().UnixMilli()
	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "127.0.0.1", Port: "0", IsRemote: 1, CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	newGeneration := now + 20
	if _, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{InstanceID: "new", DisplayName: "new snapshot", Status: 1}}, newGeneration); err != nil {
		t.Fatalf("sync new snapshot: %v", err)
	}
	got, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{InstanceID: "old", DisplayName: "old snapshot", Status: 1}}, now+10)
	if err != nil {
		t.Fatalf("sync old snapshot: %v", err)
	}
	if len(got) != 1 || got[0].InstanceID != "new" || got[0].UpdatedTime != newGeneration {
		t.Fatalf("expected newer snapshot preserved, got %+v", got)
	}
}

func TestSyncRemoteNodeInstancesAcceptsSameGeneration(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "remote-instance-same-generation.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Now().UnixMilli()
	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "127.0.0.1", Port: "0", IsRemote: 1, CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	generation := now + 1
	if _, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{InstanceID: "first", Status: 1}}, generation); err != nil {
		t.Fatalf("sync first snapshot: %v", err)
	}
	got, err := r.SyncRemoteNodeInstances(node.ID, []RemoteNodeInstanceSync{{InstanceID: "second", Status: 1}}, generation)
	if err != nil {
		t.Fatalf("sync same-generation snapshot: %v", err)
	}
	if len(got) != 1 || got[0].InstanceID != "second" {
		t.Fatalf("expected same generation to remain usable, got %+v", got)
	}
}
