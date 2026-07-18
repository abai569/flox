package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"go-backend/internal/auth"
	"go-backend/internal/http/middleware"
	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestNodeWeightUpdateRejectsRemoteInstanceTrafficRatio(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "remote-ratio.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "127.0.0.1", Port: "0", IsRemote: 1, TrafficRatio: 2, CreatedTime: 1, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instance := model.NodeInstance{NodeID: node.ID, InstanceID: "instance-a", Weight: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.DB().Create(&instance).Error; err != nil {
		t.Fatalf("create instance: %v", err)
	}

	const jwtSecret = "remote-instance-ratio-secret"
	h := New(r, jwtSecret)
	mux := http.NewServeMux()
	h.Register(mux)
	router := middleware.JWT(middleware.AuthOptions{JWTSecret: jwtSecret})(mux)
	token, err := auth.GenerateToken(1, "admin", 0, jwtSecret)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	body := `{"nodeId":` + strconv.FormatInt(node.ID, 10) + `,"instanceId":"instance-a","weight":4,"trafficRatio":3.5,"flowResetTime":0,"trafficLimit":0}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/node/weight", bytes.NewBufferString(body))
	req.Header.Set("Authorization", token)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	var payload response.R
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Code == 0 {
		t.Fatalf("expected provider-controlled ratio rejection, got code %d message %q", payload.Code, payload.Msg)
	}
	instances, err := r.ListNodeInstances(node.ID)
	if err != nil || len(instances) != 1 || instances[0].TrafficRatio != 0 {
		t.Fatalf("expected ratio unchanged, instances=%+v err=%v", instances, err)
	}
}
