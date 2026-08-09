package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestNodeInstanceResumeRestoresTrafficPauseAndInvalidatesCache(t *testing.T) {
	// Given: an instance paused after exceeding its traffic limit and a cached traffic snapshot.
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	node := model.Node{Name: "limited-node", Secret: "secret", CreatedTime: 1}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	instance := model.NodeInstance{NodeID: node.ID, InstanceID: "instance-a", Weight: 4, CreatedTime: 1, UpdatedTime: 1}
	if err := r.DB().Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if changed, err := r.PauseNodeInstanceRouting(node.ID, instance.InstanceID, 2); err != nil || !changed {
		t.Fatalf("pause instance: changed=%v err=%v", changed, err)
	}
	h := &Handler{repo: r}
	cacheKey := strconv.FormatInt(node.ID, 10) + ":" + instance.InstanceID
	h.nodeTrafficCache.Store(cacheKey, &nodeTrafficCacheEntry{limitGB: 1})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/node/instance-resume", bytes.NewBufferString(`{"nodeId":`+strconv.FormatInt(node.ID, 10)+`,"instanceId":"instance-a"}`))
	rec := httptest.NewRecorder()

	// When: the administrator resumes the instance through the HTTP handler.
	h.nodeInstanceResume(rec, req)

	// Then: routing weight and cache state reflect the restored instance.
	var payload response.R
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != 0 {
		t.Fatalf("resume response = %+v", payload)
	}
	instances, err := r.ListNodeInstances(node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 || instances[0].Weight != 4 || instances[0].PauseRestoreWeight.Valid {
		t.Fatalf("resumed instances = %+v", instances)
	}
	if _, cached := h.nodeTrafficCache.Load(cacheKey); cached {
		t.Fatal("traffic cache entry was not invalidated")
	}
}

func TestNodeInstanceResumeRejectsHardQuarantine(t *testing.T) {
	// Given: an instance paused at zero weight while a real cross-border quarantine remains active.
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	instance := model.NodeInstance{
		NodeID: 1, InstanceID: "instance-a", Weight: 0,
		PauseRestoreWeight: sql.NullInt64{Int64: 4, Valid: true}, CreatedTime: 1, UpdatedTime: 1,
	}
	if err := r.DB().Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.DB().Model(&model.NodeInstance{}).Where("id = ?", instance.ID).Update("weight", 0).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.DB().Create(&model.CrossBorderProbeState{
		NodeID: 1, InstanceID: instance.InstanceID, Status: repo.CrossBorderBlocked,
		Quarantined: true, QuarantineReason: repo.CrossBorderForward,
	}).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{repo: r}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/node/instance-resume", bytes.NewBufferString(`{"nodeId":1,"instanceId":"instance-a"}`))
	rec := httptest.NewRecorder()

	// When: the administrator tries to resume the hard-quarantined instance.
	h.nodeInstanceResume(rec, req)

	// Then: the API rejects the action and preserves the pending operator weight.
	var payload response.R
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code == 0 {
		t.Fatalf("resume response = %+v, want rejection", payload)
	}
	instances, err := r.ListNodeInstances(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 || instances[0].Weight != 0 || !instances[0].PauseRestoreWeight.Valid || instances[0].PauseRestoreWeight.Int64 != 4 {
		t.Fatalf("hard-quarantined instances = %+v", instances)
	}
}
