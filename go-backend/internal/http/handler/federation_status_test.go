package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"go-backend/internal/http/client"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestNormalizeRemotePanelURL(t *testing.T) {
	tests := map[string]string{
		"test.041224.xyz":           "https://test.041224.xyz",
		" test.041224.xyz/ ":        "https://test.041224.xyz",
		"http://panel.example.com/": "http://panel.example.com",
		"HTTPS://panel.example.com": "HTTPS://panel.example.com",
	}
	for input, expected := range tests {
		if got := normalizeRemotePanelURL(input); got != expected {
			t.Errorf("normalizeRemotePanelURL(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestFederationConnectReturnsInstanceTrafficRatioAndUsage(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "connect-instance.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	node := model.Node{Name: "source", Secret: "secret", ServerIP: "127.0.0.1", Port: "20000-20010", CreatedTime: 1, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instances := []model.NodeInstance{
		{NodeID: node.ID, InstanceID: "instance-a", DisplayName: "A", Hostname: "host-a", PublicIPV4: "203.0.113.10", PublicIPV6: "2001:db8::10", Status: 1, Weight: 4, TrafficRatio: 9, PeriodRx: 11, PeriodTx: 22, TrafficLimit: 100, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: node.ID, InstanceID: "instance-b", DisplayName: "B", Hostname: "host-b", Status: 1, Weight: 1, TrafficRatio: 8, CreatedTime: 1, UpdatedTime: 1},
	}
	if err := r.DB().Create(&instances).Error; err != nil {
		t.Fatalf("create instances: %v", err)
	}
	share := &repo.PeerShare{Name: "share", NodeID: node.ID, Token: "connect-token", TrafficRatio: 2.5, ScopeType: "all_enabled", AutoIncludeNewInstances: 1, MinHealthyInstances: 1, IsActive: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}
	if err := r.ReplacePeerShareInstances(share.ID, node.ID, []string{"instance-a", "instance-b"}, 1, map[string]float64{"instance-a": 3.5, "instance-b": 0}); err != nil {
		t.Fatalf("configure share instance: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/federation/connect", nil)
	req.Header.Set("Authorization", share.Token)
	res := httptest.NewRecorder()
	(&Handler{repo: r}).federationConnect(res, req)
	var payload struct {
		Code int `json:"code"`
		Data struct {
			TrafficRatio float64                     `json:"trafficRatio"`
			Instances    []client.RemoteNodeInstance `json:"instances"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Code != 0 || payload.Data.TrafficRatio != 2.5 || len(payload.Data.Instances) != 2 {
		t.Fatalf("unexpected response: code=%d instances=%+v", payload.Code, payload.Data.Instances)
	}
	got := payload.Data.Instances[0]
	if got.TrafficRatio != 3.5 || got.PeriodRx != 11 || got.PeriodTx != 22 || got.TrafficLimit != 100 || got.Hostname != "host-a" || got.PublicIPV4 != "203.0.113.10" || got.PublicIPV6 != "2001:db8::10" {
		t.Fatalf("unexpected instance fields: %+v", got)
	}
	if payload.Data.Instances[1].TrafficRatio != 2.5 {
		t.Fatalf("expected inherited share ratio 2.5, got %+v", payload.Data.Instances[1])
	}
}

func TestFederationConnectExcludesInstancesOutsideShareScope(t *testing.T) {
	r, err := repo.Open(filepath.Join(t.TempDir(), "connect-instance-scope.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	node := model.Node{Name: "source", Secret: "secret", ServerIP: "127.0.0.1", Port: "20000-20010", CreatedTime: 1, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	instances := []model.NodeInstance{
		{NodeID: node.ID, InstanceID: "shared", PublicIPV4: "203.0.113.40", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1},
		{NodeID: node.ID, InstanceID: "private", PublicIPV4: "203.0.113.41", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1},
	}
	if err := r.DB().Create(&instances).Error; err != nil {
		t.Fatalf("create instances: %v", err)
	}
	share := &repo.PeerShare{Name: "share", NodeID: node.ID, Token: "scope-token", TrafficRatio: 1, ScopeType: "selected", MinHealthyInstances: 1, IsActive: 1, CreatedTime: 1, UpdatedTime: 1}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}
	if err := r.ReplacePeerShareInstances(share.ID, node.ID, []string{"shared"}, 1); err != nil {
		t.Fatalf("configure share instance: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/federation/connect", nil)
	req.Header.Set("Authorization", share.Token)
	res := httptest.NewRecorder()
	(&Handler{repo: r}).federationConnect(res, req)
	var payload struct {
		Code int `json:"code"`
		Data struct {
			Instances []client.RemoteNodeInstance `json:"instances"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Code != 0 || len(payload.Data.Instances) != 1 || payload.Data.Instances[0].InstanceID != "shared" {
		t.Fatalf("expected only shared instance, got code=%d instances=%+v", payload.Code, payload.Data.Instances)
	}
}

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
				"shareId": 7, "status": 1, "currentFlow": 300, "maxBandwidth": 900, "expiryTime": 1234, "trafficRatio": 2.5,
				"portRangeStart": 20000, "portRangeEnd": 20010,
				"instances": []map[string]interface{}{{"instanceId": "instance-a", "displayName": "A", "publicIpV4": "203.0.113.20", "publicIpV6": "2001:db8::20", "weight": 4, "trafficRatio": 9.0, "periodRx": 11, "periodTx": 22}},
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
	instances, ok := item["remoteInstances"].([]client.RemoteNodeInstance)
	if !ok || len(instances) != 1 || instances[0].TrafficRatio != 9 || instances[0].PeriodRx != 11 || instances[0].PeriodTx != 22 || instances[0].PublicIPV4 != "203.0.113.20" || instances[0].PublicIPV6 != "2001:db8::20" {
		t.Fatalf("expected provider ratio and remote period traffic, got %#v", item["remoteInstances"])
	}
	storedInstances, err := r.ListNodeInstances(item["id"].(int64))
	if err != nil || len(storedInstances) != 1 || storedInstances[0].PublicIPV4 != "203.0.113.20" || storedInstances[0].PublicIPV6 != "2001:db8::20" {
		t.Fatalf("expected provider instance addresses to persist, got %+v err=%v", storedInstances, err)
	}

	stored, err := r.GetNodeByID(item["id"].(int64))
	if err != nil || stored == nil || !stored.RemoteConfig.Valid {
		t.Fatalf("load cached node: %v, %+v", err, stored)
	}
	cached := parseRemoteShareUsageConfigExtended(stored.RemoteConfig.String)
	if cached.inFlow != 103 || cached.outFlow != 204 || len(cached.instances) != 1 {
		t.Fatalf("unexpected cached usage: %+v", cached)
	}
	if stored.TrafficRatio != 2.5 {
		t.Fatalf("expected provider parent ratio 2.5, got %v", stored.TrafficRatio)
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
