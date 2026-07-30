package ws

import (
	"encoding/json"
	"testing"
)

func TestSanitizePublicMetricDataKeepsNetworkCounters(t *testing.T) {
	data, ok := sanitizePublicMetricData(`{"instance_id":"instance-1","net_in_bytes":123,"net_out_bytes":456,"secret":"hidden"}`)
	if !ok {
		t.Fatal("sanitizePublicMetricData returned false")
	}

	var metric map[string]interface{}
	if err := json.Unmarshal([]byte(data), &metric); err != nil {
		t.Fatal(err)
	}
	if metric["net_in_bytes"] != float64(123) || metric["net_out_bytes"] != float64(456) {
		t.Fatalf("network counters = (%v,%v), want (123,456)", metric["net_in_bytes"], metric["net_out_bytes"])
	}
	if _, exists := metric["secret"]; exists {
		t.Fatal("unexpected private field in public metric")
	}
}
