package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConnectDecodesRemoteUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "token" {
			t.Fatalf("unexpected authorization header %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"code": 0,
			"data": map[string]interface{}{
				"currentFlow": 90, "maxBandwidth": 1000, "expiryTime": 12345,
				"flows":     []map[string]interface{}{{"runtimeId": 0, "instanceId": "", "periodType": "total", "inFlow": 40, "outFlow": 50}},
				"instances": []map[string]interface{}{{"instanceId": "instance-a", "displayName": "A", "displayIndex": 2, "weight": 3}},
			},
		})
	}))
	defer server.Close()

	info, err := NewFederationClient().Connect(server.URL, "token", "")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if info.CurrentFlow != 90 || info.MaxBandwidth != 1000 || info.ExpiryTime != 12345 {
		t.Fatalf("unexpected usage: %+v", info)
	}
	if len(info.Flows) != 1 || info.Flows[0].InFlow != 40 || info.Flows[0].OutFlow != 50 {
		t.Fatalf("unexpected flows: %+v", info.Flows)
	}
	if len(info.Instances) != 1 || info.Instances[0].DisplayName != "A" || info.Instances[0].Weight != 3 {
		t.Fatalf("unexpected instances: %+v", info.Instances)
	}
}

func TestCommandPreservesInstanceResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"msg":"","data":{"type":"TcpPing","success":true,"message":"","data":{"latency":12},"instances":[{"instanceId":"a","success":true},{"instanceId":"b","success":false,"message":"timeout"}]}}`))
	}))
	defer server.Close()

	result, err := NewFederationClient().Command(server.URL, "token", "", RuntimeNodeCommandRequest{CommandType: "TcpPing"})
	if err != nil {
		t.Fatalf("command: %v", err)
	}
	if result == nil || len(result.Instances) != 2 {
		t.Fatalf("expected two instance results, got %+v", result)
	}
}
