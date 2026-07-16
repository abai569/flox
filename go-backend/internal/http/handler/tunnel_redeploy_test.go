package handler

import (
	"testing"
	"time"

	"go-backend/internal/store/repo"
)

func TestTunnelRedeployLockSerializesSameTunnel(t *testing.T) {
	lock := tunnelRedeployLock(900001)
	if lock != tunnelRedeployLock(900001) {
		t.Fatal("expected the same tunnel ID to reuse one lock")
	}

	lock.Lock()
	acquired := make(chan struct{})
	go func() {
		second := tunnelRedeployLock(900001)
		second.Lock()
		close(acquired)
		second.Unlock()
	}()

	select {
	case <-acquired:
		lock.Unlock()
		t.Fatal("second redeploy acquired the lock before the first released it")
	case <-time.After(30 * time.Millisecond):
	}
	lock.Unlock()

	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("second redeploy did not continue after the first released the lock")
	}
}

func TestReconstructTunnelStateIncludesOnlineInstances(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	now := time.Now().UnixMilli()
	if err := r.DB().Exec(`
		INSERT INTO node(id, name, secret, server_ip, server_ip_v4, server_ip_v6, port, interface_name, version, http, tls, socks, created_time, updated_time, status, tcp_listen_addr, udp_listen_addr, inx)
		VALUES(1, 'entry', 'entry-secret', '192.0.2.1', '192.0.2.1', '', '30000-30100', '', 'v1', 1, 1, 1, ?, ?, 1, '0.0.0.0', '[::]', 0),
		      (2, 'exit', 'exit-secret', '198.51.100.1', '198.51.100.1', '', '31000-31100', '', 'v1', 1, 1, 1, ?, ?, 1, '0.0.0.0', '[::]', 1)
	`, now, now, now, now).Error; err != nil {
		t.Fatalf("insert nodes: %v", err)
	}
	if err := r.DB().Exec(`
		INSERT INTO tunnel(id, name, traffic_ratio, type, protocol, flow, created_time, updated_time, status, in_ip, inx)
		VALUES(1, 'instance-redeploy', 1, 2, 'tls', 1, ?, ?, 1, '192.0.2.1', 0)
	`, now, now).Error; err != nil {
		t.Fatalf("insert tunnel: %v", err)
	}
	if err := r.DB().Exec(`
		INSERT INTO chain_tunnel(tunnel_id, chain_type, node_id, port, strategy, inx, protocol)
		VALUES(1, 1, 1, 30001, 'round', 1, 'tls'),
		      (1, 3, 2, 31001, 'round', 1, 'tls')
	`).Error; err != nil {
		t.Fatalf("insert chain nodes: %v", err)
	}
	if err := r.UpsertNodeInstance(repo.NodeInstanceUpsert{
		NodeID:     2,
		InstanceID: "exit-instance",
		PublicIPV4: "198.51.100.2",
		Now:        now,
	}); err != nil {
		t.Fatalf("insert node instance: %v", err)
	}

	h := &Handler{repo: r}
	state, err := h.reconstructTunnelState(1)
	if err != nil {
		t.Fatalf("reconstruct tunnel state: %v", err)
	}
	instances := state.NodeInstances[2]
	if len(instances) != 1 {
		t.Fatalf("expected one online exit instance, got %d", len(instances))
	}
	if instances[0].InstanceID != "exit-instance" || instances[0].PublicIPV4 != "198.51.100.2" {
		t.Fatalf("unexpected reconstructed instance: %+v", instances[0])
	}
}
