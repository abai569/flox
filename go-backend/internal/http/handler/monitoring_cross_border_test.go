package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"go-backend/internal/auth"
	httpmiddleware "go-backend/internal/http/middleware"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestMonitorNodeInstanceGroupsOutputsCrossBorderObservationUntil(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "monitor-cross-border.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	node := model.Node{Name: "overseas", Secret: "secret", ServerIP: "10.0.0.1", Port: "10000-20000", NetworkRegion: repo.NetworkRegionOverseas, CreatedTime: 1, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	instance := model.NodeInstance{NodeID: node.ID, InstanceID: "instance-a", PublicIPV4: "10.0.0.1", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.DB().Create(&instance).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.DB().Create(&model.CrossBorderProbeState{NodeID: node.ID, InstanceID: instance.InstanceID, Status: repo.CrossBorderObserving, ObservationUntil: 9000}).Error; err != nil {
		t.Fatal(err)
	}
	admin, err := r.GetUserByUsername("admin")
	if err != nil || admin == nil {
		t.Fatalf("get admin: user=%+v err=%v", admin, err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/monitor/node-instance-groups", nil)
	req = req.WithContext(context.WithValue(req.Context(), httpmiddleware.ClaimsContextKey, auth.Claims{Sub: strconv.FormatInt(admin.ID, 10), User: admin.User, RoleID: 0}))
	res := httptest.NewRecorder()
	h := New(r, "test-secret")
	t.Cleanup(h.Close)
	h.monitorNodeInstanceGroupsHandler(res, req)
	var payload struct {
		Code int `json:"code"`
		Data []struct {
			Members []struct {
				CrossBorderObservationUntil int64 `json:"crossBorderObservationUntil"`
			} `json:"members"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != 0 || len(payload.Data) != 1 || len(payload.Data[0].Members) != 1 || payload.Data[0].Members[0].CrossBorderObservationUntil != 9000 {
		t.Fatalf("monitor response = %#v", payload)
	}
}
