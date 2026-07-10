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
