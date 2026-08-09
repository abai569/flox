package repo

import (
	"database/sql"
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

func TestGetNodeInstancePublicIPs(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	instance := model.NodeInstance{
		NodeID:      7,
		InstanceID:  "instance-ip",
		PublicIPV4:  "8.8.8.8",
		PublicIPV6:  "2001:4860:4860::8888",
		Status:      1,
		CreatedTime: 1,
		UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	ipv4, ipv6, exists, err := r.GetNodeInstancePublicIPs(7, "instance-ip")
	if err != nil {
		t.Fatal(err)
	}
	if !exists || ipv4 != "8.8.8.8" || ipv6 != "2001:4860:4860::8888" {
		t.Fatalf("public IPs = %q %q exists=%v", ipv4, ipv6, exists)
	}
	_, _, exists, err = r.GetNodeInstancePublicIPs(7, "missing")
	if err != nil || exists {
		t.Fatalf("missing instance exists=%v err=%v", exists, err)
	}
}

func TestAccumulateNodeInstancePeriodNetTrafficStartsFromFirstSampleTotal(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{NodeID: 21, InstanceID: "traffic-a", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}

	first, err := r.AccumulateNodeInstancePeriodNetTraffic(21, instance.InstanceID, 800_000, 900_000, 10, "eth0", 2)
	if err != nil {
		t.Fatal(err)
	}
	if first.InBytes != 800_000 || first.OutBytes != 900_000 {
		t.Fatalf("first sample period = (%d,%d), want (800000,900000)", first.InBytes, first.OutBytes)
	}
	second, err := r.AccumulateNodeInstancePeriodNetTraffic(21, instance.InstanceID, 800_120, 900_230, 10, "eth0", 3)
	if err != nil {
		t.Fatal(err)
	}
	if second.InBytes != 800_120 || second.OutBytes != 900_230 {
		t.Fatalf("second sample period = (%d,%d), want (800120,900230)", second.InBytes, second.OutBytes)
	}

	var stored model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", 21, instance.InstanceID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.LastSyncNetInBytes != 800_120 || stored.LastSyncNetOutBytes != 900_230 || stored.PeriodNetInitialized != 1 {
		t.Fatalf("stored baseline = in %d out %d initialized %d", stored.LastSyncNetInBytes, stored.LastSyncNetOutBytes, stored.PeriodNetInitialized)
	}
}

func TestAccumulateNodeInstancePeriodNetTrafficRebaselinesChangedInterface(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{NodeID: 22, InstanceID: "traffic-b", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.AccumulateNodeInstancePeriodNetTraffic(22, instance.InstanceID, 1000, 2000, 10, "eth0", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := r.AccumulateNodeInstancePeriodNetTraffic(22, instance.InstanceID, 1100, 2200, 10, "eth0", 3); err != nil {
		t.Fatal(err)
	}
	changed, err := r.AccumulateNodeInstancePeriodNetTraffic(22, instance.InstanceID, 900_000, 800_000, 11, "eth1", 4)
	if err != nil {
		t.Fatal(err)
	}
	if changed.InBytes != 1100 || changed.OutBytes != 2200 {
		t.Fatalf("interface change period = (%d,%d), want preserved (1100,2200)", changed.InBytes, changed.OutBytes)
	}
	next, err := r.AccumulateNodeInstancePeriodNetTraffic(22, instance.InstanceID, 900_050, 800_075, 11, "eth1", 5)
	if err != nil {
		t.Fatal(err)
	}
	if next.InBytes != 1150 || next.OutBytes != 2275 {
		t.Fatalf("post-change period = (%d,%d), want (1150,2275)", next.InBytes, next.OutBytes)
	}
}

func TestAccumulateNodeInstancePeriodNetTrafficContinuesAcrossReboot(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{NodeID: 23, InstanceID: "traffic-c", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.AccumulateNodeInstancePeriodNetTraffic(23, instance.InstanceID, 1000, 2000, 10, "eth0", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := r.AccumulateNodeInstancePeriodNetTraffic(23, instance.InstanceID, 1100, 2200, 10, "eth0", 3); err != nil {
		t.Fatal(err)
	}
	restarted, err := r.AccumulateNodeInstancePeriodNetTraffic(23, instance.InstanceID, 40, 60, 11, "eth0", 4)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.InBytes != 1140 || restarted.OutBytes != 2260 {
		t.Fatalf("restarted period = (%d,%d), want (1140,2260)", restarted.InBytes, restarted.OutBytes)
	}
}

func TestAccumulateNodeInstancePeriodNetTrafficPreservesFirstSampleTotal(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{
		NodeID: 24, InstanceID: "traffic-legacy", Status: 1, Weight: 1,
		PeriodNetInitialized: 1, PeriodNetInBytes: 800_000, PeriodNetOutBytes: 900_000,
		LastSyncNetInBytes: 800_000, LastSyncNetOutBytes: 900_000, LastSyncNetBootID: 10,
		LastSyncNetInterfaceKey: "eth0", CreatedTime: 1, UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}

	updated, err := r.AccumulateNodeInstancePeriodNetTraffic(24, instance.InstanceID, 800_120, 900_230, 10, "eth0", 2)
	if err != nil {
		t.Fatal(err)
	}
	if updated.InBytes != 800_120 || updated.OutBytes != 900_230 {
		t.Fatalf("updated period = (%d,%d), want (800120,900230)", updated.InBytes, updated.OutBytes)
	}
	next, err := r.AccumulateNodeInstancePeriodNetTraffic(24, instance.InstanceID, 800_150, 900_280, 10, "eth0", 3)
	if err != nil {
		t.Fatal(err)
	}
	if next.InBytes != 800_150 || next.OutBytes != 900_280 {
		t.Fatalf("next period = (%d,%d), want (800150,900280)", next.InBytes, next.OutBytes)
	}
}

func TestAdjustNodeInstancePeriodNetTrafficKeepsPeriodCounters(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{
		NodeID: 25, InstanceID: "traffic-adjust", Status: 1, Weight: 1,
		PeriodNetInBytes: 100, PeriodNetOutBytes: 200,
		ManualTrafficInBytes: 10, ManualTrafficOutBytes: 20,
		CreatedTime: 1, UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.AdjustNodeInstancePeriodNetTraffic(25, instance.InstanceID, -50, 30); err != nil {
		t.Fatal(err)
	}
	var stored model.NodeInstance
	if err := r.db.Where("id = ?", instance.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PeriodNetInBytes != 100 || stored.PeriodNetOutBytes != 200 {
		t.Fatalf("period counters = (%d,%d), want (100,200)", stored.PeriodNetInBytes, stored.PeriodNetOutBytes)
	}
	if stored.ManualTrafficInBytes != -40 || stored.ManualTrafficOutBytes != 50 {
		t.Fatalf("manual offsets = (%d,%d), want (-40,50)", stored.ManualTrafficInBytes, stored.ManualTrafficOutBytes)
	}
}

func TestResetNodeInstancePeriodNetTrafficManualAndAutomatic(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	instance := model.NodeInstance{
		NodeID: 26, InstanceID: "traffic-reset", Status: 1, Weight: 1,
		PeriodNetInBytes: 100, PeriodNetOutBytes: 200,
		ManualTrafficInBytes: 10, ManualTrafficOutBytes: 20,
		CreatedTime: 1, UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.ResetNodeInstancePeriodNetTraffic(26, instance.InstanceID, 1000, 2000, 10, "eth0", true); err != nil {
		t.Fatal(err)
	}
	var stored model.NodeInstance
	if err := r.db.Where("id = ?", instance.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PeriodNetInBytes != 0 || stored.PeriodNetOutBytes != 0 {
		t.Fatalf("manual reset period = (%d,%d), want (0,0)", stored.PeriodNetInBytes, stored.PeriodNetOutBytes)
	}
	if stored.ManualTrafficInBytes != 110 || stored.ManualTrafficOutBytes != 220 {
		t.Fatalf("manual reset offsets = (%d,%d), want (110,220)", stored.ManualTrafficInBytes, stored.ManualTrafficOutBytes)
	}
	if err := r.ResetNodeInstancePeriodNetTraffic(26, instance.InstanceID, 1500, 2500, 10, "eth0", false); err != nil {
		t.Fatal(err)
	}
	if err := r.db.Where("id = ?", instance.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ManualTrafficInBytes != 0 || stored.ManualTrafficOutBytes != 0 {
		t.Fatalf("automatic reset offsets = (%d,%d), want (0,0)", stored.ManualTrafficInBytes, stored.ManualTrafficOutBytes)
	}
}

func TestGetNodeInstanceTrafficLimitInfoMapsLimitAndNotificationMask(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	node := model.Node{Name: "limited-node", Secret: "secret", CreatedTime: 1}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instance := model.NodeInstance{
		NodeID:              node.ID,
		InstanceID:          "instance-a",
		DisplayIndex:        1,
		Weight:              2,
		TrafficLimit:        2000,
		TrafficNotifiedMask: 5,
		TotalInFlow:         11,
		TotalOutFlow:        22,
		PeriodNetInBytes:    1600 * 1024 * 1024 * 1024,
		PeriodNetOutBytes:   1620 * 1024 * 1024 * 1024,
		CreatedTime:         1,
		UpdatedTime:         1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}

	info, err := r.GetNodeInstanceTrafficLimitInfo(node.ID, instance.InstanceID)
	if err != nil {
		t.Fatalf("get traffic limit info: %v", err)
	}
	if info == nil {
		t.Fatal("expected traffic limit info")
	}
	if info.LimitGB != 2000 || info.Mask != 5 {
		t.Fatalf("expected limit=2000 and mask=5, got limit=%d mask=%d", info.LimitGB, info.Mask)
	}
	if info.PeriodNetInBytes != instance.PeriodNetInBytes || info.PeriodNetOutBytes != instance.PeriodNetOutBytes {
		t.Fatalf("expected period traffic (%d,%d), got (%d,%d)", instance.PeriodNetInBytes, instance.PeriodNetOutBytes, info.PeriodNetInBytes, info.PeriodNetOutBytes)
	}
}

func TestPauseNodeInstanceRoutingPreservesWeightForResume(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	instance := model.NodeInstance{NodeID: 1, InstanceID: "instance-a", Weight: 3, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}

	changed, err := r.PauseNodeInstanceRouting(1, instance.InstanceID, 2)
	if err != nil {
		t.Fatalf("pause node instance routing: %v", err)
	}
	if !changed {
		t.Fatal("expected routing pause to change the instance")
	}

	var paused model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", 1, instance.InstanceID).First(&paused).Error; err != nil {
		t.Fatalf("load paused instance: %v", err)
	}
	if paused.Weight != 0 || !paused.PauseRestoreWeight.Valid || paused.PauseRestoreWeight.Int64 != 3 {
		t.Fatalf("expected weight=0 with restore weight=3, got weight=%d restore=%+v", paused.Weight, paused.PauseRestoreWeight)
	}

	changed, err = r.ResumeNodeInstanceRouting(1, instance.InstanceID, 3)
	if err != nil {
		t.Fatalf("resume node instance routing: %v", err)
	}
	if !changed {
		t.Fatal("expected routing resume to change the instance")
	}

	var resumed model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", 1, instance.InstanceID).First(&resumed).Error; err != nil {
		t.Fatalf("load resumed instance: %v", err)
	}
	if resumed.Weight != 3 || resumed.PauseRestoreWeight.Valid {
		t.Fatalf("expected restored weight=3 with no pending restore, got weight=%d restore=%+v", resumed.Weight, resumed.PauseRestoreWeight)
	}
}

func TestResumeNodeInstanceRoutingDoesNotBypassCrossBorderQuarantine(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()
	instance := model.NodeInstance{NodeID: 1, InstanceID: "instance-a", Weight: 0, PauseRestoreWeight: sql.NullInt64{Int64: 3, Valid: true}, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Update("weight", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.CrossBorderProbeState{NodeID: 1, InstanceID: instance.InstanceID, Status: CrossBorderBlocked, Quarantined: true}).Error; err != nil {
		t.Fatal(err)
	}
	changed, err := r.ResumeNodeInstanceRouting(1, instance.InstanceID, 2)
	if !errors.Is(err, ErrNodeInstanceHardQuarantined) || changed {
		t.Fatalf("resume quarantined instance: changed=%v err=%v", changed, err)
	}
	var got model.NodeInstance
	if err := r.db.First(&got, instance.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Weight != 0 || !got.PauseRestoreWeight.Valid || got.PauseRestoreWeight.Int64 != 3 {
		t.Fatalf("quarantined instance state changed: %+v", got)
	}
	var state model.CrossBorderProbeState
	if err := r.db.Where("node_id = ? AND instance_id = ?", 1, instance.InstanceID).First(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.RestoreWeight != 0 {
		t.Fatalf("quarantine restore weight = %d, want unchanged 0", state.RestoreWeight)
	}
}

func TestResumeNodeRoutingDoesNotBypassCrossBorderQuarantine(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()
	node := model.Node{Name: "paused", Secret: "secret", CreatedTime: 1, Paused: 1, PauseRestoreWeight: sql.NullInt64{Int64: 1, Valid: true}}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	instances := []model.NodeInstance{
		{NodeID: node.ID, InstanceID: "healthy", Weight: 0, PauseRestoreWeight: sql.NullInt64{Int64: 2, Valid: true}, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: node.ID, InstanceID: "quarantined", Weight: 0, PauseRestoreWeight: sql.NullInt64{Int64: 4, Valid: true}, CreatedTime: 1, UpdatedTime: 1},
	}
	if err := r.db.Create(&instances).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Model(&model.NodeInstance{}).Where("node_id = ?", node.ID).Update("weight", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.CrossBorderProbeState{NodeID: node.ID, InstanceID: "quarantined", Status: CrossBorderBlocked, Quarantined: true}).Error; err != nil {
		t.Fatal(err)
	}
	changed, err := r.ResumeNodeRouting(node.ID, 2)
	if err != nil || !changed {
		t.Fatalf("resume node: changed=%v err=%v", changed, err)
	}
	var got []model.NodeInstance
	if err := r.db.Where("node_id = ?", node.ID).Order("id ASC").Find(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got[0].Weight != 2 || got[1].Weight != 0 || got[0].PauseRestoreWeight.Valid || got[1].PauseRestoreWeight.Valid {
		t.Fatalf("unexpected resumed instances: %+v", got)
	}
}

func TestPruneStaleNodeInstancesRemovesCrossBorderState(t *testing.T) {
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()
	instance := model.NodeInstance{NodeID: 1, InstanceID: "stale", Status: 0, LastSeenAt: 10, CreatedTime: 1, UpdatedTime: 1}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.CrossBorderProbeState{NodeID: 1, InstanceID: instance.InstanceID, Status: CrossBorderBlocked, Quarantined: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.PruneStaleNodeInstances(20); err != nil {
		t.Fatal(err)
	}
	var stateCount int64
	if err := r.db.Model(&model.CrossBorderProbeState{}).Count(&stateCount).Error; err != nil {
		t.Fatal(err)
	}
	if stateCount != 0 {
		t.Fatalf("cross-border states remaining = %d", stateCount)
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
	if err := r.db.Create(&model.CrossBorderProbeState{NodeID: node.ID, InstanceID: "removed", Status: CrossBorderBlocked, Quarantined: true}).Error; err != nil {
		t.Fatalf("create cross-border state: %v", err)
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
	var stateCount int64
	if err := r.db.Model(&model.CrossBorderProbeState{}).Where("node_id = ?", node.ID).Count(&stateCount).Error; err != nil || stateCount != 0 {
		t.Fatalf("expected removed instance state deleted, count=%d err=%v", stateCount, err)
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

func TestListNodeInstancesExpiringWithinFiltersWindowStatusAndDismissal(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "expiry-reminders.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC).UnixMilli()
	nodes := []model.Node{
		{ID: 101, Name: "active", Secret: "active-secret", Status: 1, Paused: 0, CreatedTime: now},
		{ID: 102, Name: "disabled", Secret: "disabled-secret", Status: 0, Paused: 0, CreatedTime: now},
		{ID: 103, Name: "paused", Secret: "paused-secret", Status: 1, Paused: 1, CreatedTime: now},
	}
	if err := r.db.Create(&nodes).Error; err != nil {
		t.Fatalf("create nodes: %v", err)
	}

	instances := []model.NodeInstance{
		{NodeID: 101, InstanceID: "future-zero-weight", Status: 1, Weight: 0, ExpiryTime: sql.NullInt64{Int64: now + int64(12*time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "recently-expired", Status: 1, ExpiryTime: sql.NullInt64{Int64: now - int64(12*time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "expires-now", Status: 1, ExpiryTime: sql.NullInt64{Int64: now, Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "future-80-days", Status: 1, ExpiryTime: sql.NullInt64{Int64: now + int64(80*24*time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "expired-history", Status: 1, ExpiryTime: sql.NullInt64{Int64: now - int64(25*time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "disabled-instance", Status: 0, ExpiryTime: sql.NullInt64{Int64: now + int64(time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 102, InstanceID: "disabled-node", Status: 1, ExpiryTime: sql.NullInt64{Int64: now + int64(time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 103, InstanceID: "paused-node", Status: 1, ExpiryTime: sql.NullInt64{Int64: now + int64(time.Hour/time.Millisecond), Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "dismissed-future", Status: 1, ExpiryTime: sql.NullInt64{Int64: now + int64(time.Hour/time.Millisecond), Valid: true}, ExpiryReminderDismissedUntil: sql.NullInt64{Int64: now + 1, Valid: true}, CreatedTime: now, UpdatedTime: now},
		{NodeID: 101, InstanceID: "dismissal-ended", Status: 1, ExpiryTime: sql.NullInt64{Int64: now + int64(2*time.Hour/time.Millisecond), Valid: true}, ExpiryReminderDismissedUntil: sql.NullInt64{Int64: now, Valid: true}, CreatedTime: now, UpdatedTime: now},
	}
	if err := r.db.Create(&instances).Error; err != nil {
		t.Fatalf("create instances: %v", err)
	}
	if err := r.db.Model(&model.Node{}).Where("id = ?", 102).Update("status", 0).Error; err != nil {
		t.Fatalf("disable node: %v", err)
	}
	if err := r.db.Model(&model.NodeInstance{}).Where("instance_id = ?", "disabled-instance").Update("status", 0).Error; err != nil {
		t.Fatalf("disable instance: %v", err)
	}

	got, err := r.ListNodeInstancesExpiringWithin(now, 3)
	if err != nil {
		t.Fatalf("list expiry reminders: %v", err)
	}
	gotIDs := make(map[string]bool, len(got))
	for _, item := range got {
		gotIDs[item.InstanceID] = true
	}
	wantIDs := []string{"future-zero-weight", "recently-expired", "expires-now", "dismissal-ended"}
	if len(gotIDs) != len(wantIDs) {
		t.Fatalf("expiry reminder IDs = %v, want %v", gotIDs, wantIDs)
	}
	for _, instanceID := range wantIDs {
		if !gotIDs[instanceID] {
			t.Errorf("expected %q in expiry reminders, got %v", instanceID, gotIDs)
		}
	}
}
