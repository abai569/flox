package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"go-backend/internal/http/client"
	"go-backend/internal/store/repo"
)

func TestSyncRemoteNodeStatusesReturnsAndCachesUsage(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "remote-status.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"code": 0,
			"data": map[string]interface{}{
				"shareId": 7, "status": 1, "currentFlow": 300, "maxBandwidth": 900, "expiryTime": 1234,
				"portRangeStart": 20000, "portRangeEnd": 20010,
				"instances": []map[string]interface{}{{"instanceId": "instance-a", "displayName": "A", "weight": 4}},
				"flows": []map[string]interface{}{
					{"runtimeId": 0, "instanceId": "", "periodType": "total", "inFlow": 100, "outFlow": 200},
					{"runtimeId": 0, "instanceId": "", "periodType": "total", "inFlow": 3, "outFlow": 4},
					{"runtimeId": 9, "instanceId": "", "periodType": "total", "inFlow": 999, "outFlow": 999},
				},
			},
		})
	}))
	t.Cleanup(server.Close)

	if err := r.CreateRemoteNode("remote", "secret", "127.0.0.1", "20000-20010", 1, 0, 0, server.URL, "token", `{}`); err != nil {
		t.Fatalf("create remote node: %v", err)
	}
	nodes, err := r.ListNodes(nil)
	if err != nil || len(nodes) != 1 {
		t.Fatalf("list nodes: %v, %+v", err, nodes)
	}
	(&Handler{repo: r}).syncRemoteNodeStatuses(nodes)

	item := nodes[0]
	if item["status"] != 1 || item["remoteCurrentFlow"] != int64(300) || item["remoteInFlow"] != int64(103) || item["remoteOutFlow"] != int64(204) {
		t.Fatalf("unexpected synchronized usage: %+v", item)
	}
	if item["remoteMaxBandwidth"] != int64(900) || item["remoteExpiryTime"] != int64(1234) {
		t.Fatalf("unexpected synchronized limits: %+v", item)
	}

	stored, err := r.GetNodeByID(item["id"].(int64))
	if err != nil || stored == nil || !stored.RemoteConfig.Valid {
		t.Fatalf("load cached node: %v, %+v", err, stored)
	}
	cached := parseRemoteShareUsageConfigExtended(stored.RemoteConfig.String)
	if cached.inFlow != 103 || cached.outFlow != 204 || len(cached.instances) != 1 {
		t.Fatalf("unexpected cached usage: %+v", cached)
	}
}

func TestSyncRemoteNodeStatusesUsesCacheButKeepsOffline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)

	items := []map[string]interface{}{{
		"id": int64(8), "isRemote": 1, "status": 1, "remoteUrl": server.URL, "remoteToken": "token",
		"remoteConfig": `{"remoteCurrentFlow":300,"remoteInFlow":100,"remoteOutFlow":200,"remoteMaxBandwidth":900,"remoteExpiryTime":1234,"remoteInstances":[{"instanceId":"cached"}]}`,
	}}
	(&Handler{}).syncRemoteNodeStatuses(items)

	item := items[0]
	if item["status"] != 0 || item["remoteCurrentFlow"] != int64(300) || item["remoteInFlow"] != int64(100) || item["remoteOutFlow"] != int64(200) {
		t.Fatalf("unexpected offline cached usage: %+v", item)
	}
	instances, ok := item["remoteInstances"].([]client.RemoteNodeInstance)
	if !ok || len(instances) != 1 || instances[0].InstanceID != "cached" {
		t.Fatalf("unexpected cached instances: %#v", item["remoteInstances"])
	}
	if item["syncError"] == "" {
		t.Fatalf("expected sync error: %+v", item)
	}
}
