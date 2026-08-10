package repo

import (
	"testing"

	"go-backend/internal/store/model"
)

func TestTemporaryICMPProbeUnavailableLeavesRecoverableInstanceQuarantined(t *testing.T) {
	// Given: a healthy-weight instance was quarantined by a prior blocked probe.
	r := newCrossBorderTestRepository(t, "temporary-probe-precondition.db")
	target := createCrossBorderTestInstance(t, r, model.NodeInstance{
		NodeID: 70, InstanceID: "overseas-a", PublicIPV4: "8.8.8.8", Status: 1, Weight: 5, CreatedTime: 1, UpdatedTime: 1,
	})
	applyCrossBorderTestResult(t, r, target, CrossBorderBlocked, 100)

	// When: the next probe cannot run because the ICMP probe is unavailable.
	transition, err := r.ApplyCrossBorderProbeResult(
		target,
		CrossBorderUnknown,
		"",
		"icmp ping unavailable",
		"node",
		"",
		200,
		210,
	)
	if err != nil {
		t.Fatal(err)
	}

	// Then: the unavailable probe should be recorded as unknown and keep the instance routable.
	if transition.State.Status != CrossBorderUnknown || transition.State.Quarantined {
		t.Fatalf("probe prerequisite transition = %#v, want unknown and routable", transition)
	}
	var instance model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", target.NodeID, target.InstanceID).First(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if instance.Weight != 5 {
		t.Fatalf("instance weight = %d, want restored weight 5", instance.Weight)
	}
}

func TestTemporaryICMPProbeUnavailableDoesNotQuarantineFreshInstance(t *testing.T) {
	// Given: a fresh instance with a configured routing weight.
	r := newCrossBorderTestRepository(t, "temporary-probe-fresh.db")
	target := createCrossBorderTestInstance(t, r, model.NodeInstance{
		NodeID: 73, InstanceID: "overseas-a", PublicIPV4: "8.8.8.8", Status: 1, Weight: 5, CreatedTime: 1, UpdatedTime: 1,
	})

	// When: the ICMP probe prerequisite is unavailable.
	transition, err := r.ApplyCrossBorderProbeResult(
		target,
		CrossBorderUnknown,
		"",
		"icmp ping unavailable",
		"node",
		"",
		100,
		110,
	)
	if err != nil {
		t.Fatal(err)
	}

	// Then: the instance remains routable and the result is recorded as unknown.
	if transition.State.Status != CrossBorderUnknown || transition.State.Quarantined {
		t.Fatalf("fresh prerequisite transition = %#v, want unknown and not quarantined", transition)
	}
	var instance model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", target.NodeID, target.InstanceID).First(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if instance.Weight != 5 {
		t.Fatalf("fresh instance weight = %d, want 5", instance.Weight)
	}
}

func TestCrossBorderUnknownKeepsHardQuarantinedInstanceBlocked(t *testing.T) {
	// Given: a real TCP timeout hard-quarantined an instance with a recoverable weight.
	r := newCrossBorderTestRepository(t, "hard-quarantine-unknown.db")
	target := createCrossBorderTestInstance(t, r, model.NodeInstance{
		NodeID: 71, InstanceID: "overseas-a", PublicIPV4: "8.8.8.8", Status: 1, Weight: 5, CreatedTime: 1, UpdatedTime: 1,
	})
	applyCrossBorderTestResult(t, r, target, CrossBorderBlocked, 100)

	// When: a later probe returns an unrelated unknown result.
	transition, err := r.ApplyCrossBorderProbeResult(target, CrossBorderUnknown, "", "probe unavailable", "node", "", 200, 210)
	if err != nil {
		t.Fatal(err)
	}

	// Then: the unrelated result must not release the hard quarantine.
	if transition.State.Status != CrossBorderBlocked || !transition.State.Quarantined || transition.State.QuarantineReason != CrossBorderForward {
		t.Fatalf("hard quarantine transition = %#v, want blocked quarantine", transition)
	}
	var instance model.NodeInstance
	if err := r.db.Where("node_id = ? AND instance_id = ?", target.NodeID, target.InstanceID).First(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if instance.Weight != 0 {
		t.Fatalf("hard quarantined instance weight = %d, want 0", instance.Weight)
	}
}

func TestTemporaryICMPProbeUnavailableKeepsNonForwardQuarantineBlocked(t *testing.T) {
	tests := []struct {
		name   string
		reason string
	}{
		{name: "reverse blocked", reason: CrossBorderReverse},
		{name: "restore blocked", reason: CrossBorderRestore},
	}
	for index, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Given: an instance is hard-quarantined for a non-forward reason.
			r := newCrossBorderTestRepository(t, "non-forward-quarantine.db")
			target := createCrossBorderTestInstance(t, r, model.NodeInstance{
				NodeID: int64(72 + index), InstanceID: "overseas-a", PublicIPV4: "8.8.8.8", Status: 1, Weight: 0, CreatedTime: 1, UpdatedTime: 1,
			})
			if err := r.db.Create(&model.CrossBorderProbeState{
				NodeID: target.NodeID, InstanceID: target.InstanceID, Status: CrossBorderBlocked, Quarantined: true,
				QuarantineReason: tt.reason, IPFingerprint: target.ProbeAddress, RestoreWeight: 5,
			}).Error; err != nil {
				t.Fatal(err)
			}

			// When: a temporary ICMP probe reports the recoverable precondition error.
			transition, err := r.ApplyCrossBorderProbeResult(target, CrossBorderUnknown, "", "icmp ping unavailable", "node", "", 200, 210)
			if err != nil {
				t.Fatal(err)
			}

			// Then: non-forward quarantine remains protected.
			if transition.State.Status != CrossBorderBlocked || !transition.State.Quarantined || transition.State.QuarantineReason != tt.reason {
				t.Fatalf("non-forward quarantine transition = %#v, want reason %q protected", transition, tt.reason)
			}
		})
	}
}
