package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"go-backend/internal/auth"
	"go-backend/internal/http/middleware"
	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestNodeInstanceOrderUpdateRoutePersistsOrderAndRequiresAdmin(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	node := model.Node{Name: "node-1", Secret: "secret", CreatedTime: 1}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	for i, instanceID := range []string{"instance-a", "instance-b"} {
		instance := model.NodeInstance{NodeID: node.ID, InstanceID: instanceID, DisplayIndex: i + 1, CreatedTime: 1, UpdatedTime: 1}
		if err := r.DB().Create(&instance).Error; err != nil {
			t.Fatalf("create node instance: %v", err)
		}
	}

	const jwtSecret = "node-instance-order-secret"
	h := New(r, jwtSecret)
	mux := http.NewServeMux()
	h.Register(mux)
	router := middleware.JWT(middleware.AuthOptions{JWTSecret: jwtSecret})(mux)

	request := func(roleID int, body string) response.R {
		t.Helper()
		token, err := auth.GenerateToken(1, "tester", roleID, jwtSecret)
		if err != nil {
			t.Fatalf("generate token: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/node/instance-order/update", bytes.NewBufferString(body))
		req.Header.Set("Authorization", token)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		var payload response.R
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		return payload
	}

	if payload := request(1, `{"nodeId":1,"instanceIds":["instance-b","instance-a"]}`); payload.Code != 403 {
		t.Fatalf("expected non-admin rejection, got code %d message %q", payload.Code, payload.Msg)
	}
	if payload := request(0, `{"nodeId":1,"instanceIds":["instance-b","instance-a"]}`); payload.Code != 0 {
		t.Fatalf("expected success, got code %d message %q", payload.Code, payload.Msg)
	}
	instances, err := r.ListNodeInstances(node.ID)
	if err != nil {
		t.Fatalf("list node instances: %v", err)
	}
	if len(instances) != 2 || instances[0].InstanceID != "instance-b" || instances[0].DisplayIndex != 1 || instances[1].InstanceID != "instance-a" || instances[1].DisplayIndex != 2 {
		t.Fatalf("unexpected persisted order: %+v", instances)
	}
}

func TestNodeInstanceOrderUpdateRejectsInvalidParameters(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	h := New(r, "secret")

	for _, body := range []string{`{`, `{"nodeId":0,"instanceIds":[]}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/node/instance-order/update", bytes.NewBufferString(body))
		res := httptest.NewRecorder()
		h.nodeInstanceOrderUpdate(res, req)
		var payload response.R
		if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if payload.Code != -1 {
			t.Fatalf("expected parameter error for %q, got code %d message %q", body, payload.Code, payload.Msg)
		}
	}
}
