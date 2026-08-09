package repo

import (
	"database/sql"
	"testing"

	"go-backend/internal/store/model"
)

func TestResumeNodeInstanceRoutingRestoresOperatorWeightAfterFalsePositiveCorrection(t *testing.T) {
	// Given: a paused instance whose false-positive quarantine has an older restore weight.
	r, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	node := model.Node{Name: "overseas", Secret: "secret", CreatedTime: 1}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	instance := model.NodeInstance{
		NodeID: node.ID, InstanceID: "instance-a", Weight: 0,
		PauseRestoreWeight: sql.NullInt64{Int64: 7, Valid: true},
		CreatedTime:        1, UpdatedTime: 1,
	}
	if err := r.db.Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Update("weight", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Create(&model.CrossBorderProbeState{
		NodeID: node.ID, InstanceID: instance.InstanceID, Status: CrossBorderBlocked,
		Quarantined: true, QuarantineReason: CrossBorderForward, RestoreWeight: 5,
	}).Error; err != nil {
		t.Fatal(err)
	}
	transition, restored, err := r.CorrectCrossBorderFalsePositive(node.ID, instance.InstanceID, 1000, 100)
	if err != nil {
		t.Fatal(err)
	}
	if restored || transition.State.Quarantined || transition.State.Status != CrossBorderObserving || transition.State.RestoreWeight != 0 {
		t.Fatalf("correction transition = %+v restored=%v", transition, restored)
	}

	// When: the administrator resumes routing after the correction.
	changed, err := r.ResumeNodeInstanceRouting(node.ID, instance.InstanceID, 200)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected corrected instance routing to resume")
	}

	// Then: the later operator-selected pause weight wins and its marker is cleared.
	var got model.NodeInstance
	if err := r.db.First(&got, instance.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.Weight != 7 || got.PauseRestoreWeight.Valid {
		t.Fatalf("resumed instance = %+v, want weight 7 and no restore marker", got)
	}
}
