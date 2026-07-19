package repo

import (
	"database/sql"
	"path/filepath"
	"testing"

	"go-backend/internal/store/model"
)

func TestListTunnelsInfersRemoteConnectIPTypeFromInstances(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	node := model.Node{Name: "remote", Secret: "secret", ServerIP: "auto", Port: "30000-30010", CreatedTime: 1, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]", IsRemote: 1}
	if err := r.db.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := r.db.Create(&model.NodeInstance{NodeID: node.ID, InstanceID: "remote-a", PublicIPV6: "2001:db8::10", Status: 1, Weight: 1, CreatedTime: 1, UpdatedTime: 1}).Error; err != nil {
		t.Fatalf("create node instance: %v", err)
	}
	tunnel := model.Tunnel{Name: "remote-v6", TrafficRatio: 1, Type: 2, Protocol: "tls", Flow: 1, CreatedTime: 1, UpdatedTime: 1, Status: 1, IPPreference: "v6"}
	if err := r.db.Create(&tunnel).Error; err != nil {
		t.Fatalf("create tunnel: %v", err)
	}
	chain := model.ChainTunnel{TunnelID: tunnel.ID, ChainType: "3", NodeID: node.ID, Port: sql.NullInt64{Int64: 30001, Valid: true}}
	if err := r.db.Create(&chain).Error; err != nil {
		t.Fatalf("create chain tunnel: %v", err)
	}

	items, err := r.ListTunnelsIncludingManual()
	if err != nil {
		t.Fatalf("list tunnels: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one tunnel, got %d", len(items))
	}
	outNodes := items[0]["outNodeId"].([]map[string]interface{})
	if len(outNodes) != 1 || outNodes[0]["connectIpType"] != "v6" {
		t.Fatalf("expected inferred v6 connectIpType, got %+v", outNodes)
	}
}
