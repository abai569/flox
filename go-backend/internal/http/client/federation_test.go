package client

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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
