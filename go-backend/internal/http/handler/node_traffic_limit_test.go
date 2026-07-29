package handler

import (
	"testing"
	"time"

	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestEnforceNodeTrafficLimitPausesExceededInstance(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	node := model.Node{Name: "limited-node", Secret: "secret", CreatedTime: 1}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instance := model.NodeInstance{
		NodeID:       node.ID,
		InstanceID:   "instance-a",
		DisplayIndex: 1,
		Weight:       2,
		TrafficLimit: 2000,
		CreatedTime:  1,
		UpdatedTime:  1,
	}
	if err := r.DB().Create(&instance).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}

	h := &Handler{repo: r}
	h.enforceNodeTrafficLimit(
		node.ID,
		instance.InstanceID,
		1600*1024*1024*1024,
		1620*1024*1024*1024,
	)

	instances, err := r.ListNodeInstances(node.ID)
	if err != nil {
		t.Fatalf("list node instances: %v", err)
	}
	if len(instances) != 1 {
		t.Fatalf("expected one node instance, got %d", len(instances))
	}
	if instances[0].Weight != 0 {
		t.Fatalf("expected exceeded instance weight=0, got %d", instances[0].Weight)
	}
	if !instances[0].PauseRestoreWeight.Valid || instances[0].PauseRestoreWeight.Int64 != 2 {
		t.Fatalf("expected restore weight=2, got %+v", instances[0].PauseRestoreWeight)
	}

	time.Sleep(20 * time.Millisecond)
}
