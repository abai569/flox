package repo

import (
	"path/filepath"
	"testing"

	"go-backend/internal/store/model"
)

func TestListMonitorNodeInstanceGroupsWithCrossBorderState(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "monitor-instances.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	node := model.Node{
		Name:          "overseas-node",
		Secret:        "secret",
		ServerIP:      "8.8.8.8",
		Port:          "10000-20000",
		NetworkRegion: NetworkRegionOverseas,
		CreatedTime:   1,
		Status:        1,
		TCPListenAddr: "[::]",
		UDPListenAddr: "[::]",
	}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	instance := model.NodeInstance{
		NodeID:      node.ID,
		InstanceID:  "instance-a",
		PublicIPV4:  "8.8.8.8",
		Status:      1,
		Weight:      1,
		CreatedTime: 1,
		UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	state := model.CrossBorderProbeState{
		NodeID:           node.ID,
		InstanceID:       instance.InstanceID,
		Status:           CrossBorderBlocked,
		Quarantined:      true,
		QuarantineReason: CrossBorderReverse,
		LastCheckedAt:    2,
		ObservationUntil: 9000,
		LastError:        "timeout",
		UpdatedAt:        2,
	}
	if err := r.db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	rows, err := r.ListMonitorNodeInstanceGroups([]int64{node.ID}, true)
	if err != nil {
		t.Fatalf("list monitor node instances: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].InstanceID != instance.InstanceID {
		t.Fatalf("instance id = %q, want %q", rows[0].InstanceID, instance.InstanceID)
	}
	if rows[0].NetworkRegion != NetworkRegionOverseas {
		t.Fatalf("network region = %q", rows[0].NetworkRegion)
	}
	if rows[0].CrossBorderStatus != CrossBorderReverse {
		t.Fatalf("cross-border status = %q, want %q", rows[0].CrossBorderStatus, CrossBorderReverse)
	}
	if rows[0].CrossBorderError != "timeout" || rows[0].CrossBorderCheckedAt != 2 {
		t.Fatalf("cross-border details = error %q checkedAt %d", rows[0].CrossBorderError, rows[0].CrossBorderCheckedAt)
	}
	if rows[0].CrossBorderObservationUntil != 9000 {
		t.Fatalf("cross-border observation until = %d, want 9000", rows[0].CrossBorderObservationUntil)
	}
}
