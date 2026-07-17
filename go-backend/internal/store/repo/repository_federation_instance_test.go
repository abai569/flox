package repo

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestAddPeerShareFlowTracksAggregateAndRuntimeInstance(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "flow.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	share := &PeerShare{Name: "multi", NodeID: 10, Token: "multi-token", ScopeType: "selected", MinHealthyInstances: 1, IsActive: 1, CreatedTime: now.UnixMilli(), UpdatedTime: now.UnixMilli()}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}
	runtime := &PeerShareRuntime{ShareID: share.ID, NodeID: 10, ReservationID: "res", ResourceKey: "resource", Protocol: "tls", Strategy: "round", Port: 30001, Status: 1, CreatedTime: now.UnixMilli(), UpdatedTime: now.UnixMilli()}
	if err := r.CreatePeerShareRuntime(runtime); err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	if err := r.UpsertPeerShareRuntimeInstance(&PeerShareRuntimeInstance{RuntimeID: runtime.ID, ShareID: share.ID, NodeID: 10, InstanceID: "instance-a", Port: 30001, Applied: 1, Healthy: 1, Status: 1, CreatedTime: now.UnixMilli(), UpdatedTime: now.UnixMilli()}); err != nil {
		t.Fatalf("create runtime instance: %v", err)
	}

	if err := r.AddPeerShareFlow(share.ID, runtime.ID, "instance-a", 100, 200, now); err != nil {
		t.Fatalf("add first flow: %v", err)
	}
	if err := r.AddPeerShareFlow(share.ID, runtime.ID, "instance-a", 30, 70, now.Add(time.Minute)); err != nil {
		t.Fatalf("add second flow: %v", err)
	}

	updated, err := r.GetPeerShare(share.ID)
	if err != nil || updated == nil || updated.CurrentFlow != 400 {
		t.Fatalf("unexpected aggregate flow: share=%+v err=%v", updated, err)
	}
	flows, err := r.ListPeerShareFlows(share.ID)
	if err != nil {
		t.Fatalf("list flows: %v", err)
	}
	if len(flows) != 4 {
		t.Fatalf("expected aggregate/runtime total and daily rows, got %d: %+v", len(flows), flows)
	}
	for _, flow := range flows {
		if flow.InFlow != 130 || flow.OutFlow != 270 {
			t.Fatalf("unexpected flow row: %+v", flow)
		}
	}
	instances, err := r.ListPeerShareRuntimeInstances(runtime.ID)
	if err != nil || len(instances) != 1 || instances[0].CurrentFlow != 400 {
		t.Fatalf("unexpected runtime instance flow: %+v err=%v", instances, err)
	}
}

func TestDeleteNodeCascadeRemovesPeerShareHierarchy(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "cascade.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	now := time.Now().UnixMilli()
	if err := r.DB().Create(&Node{Name: "node", Secret: "secret", ServerIP: "127.0.0.1", Port: "30000-30010", CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	var node Node
	if err := r.DB().Where("secret = ?", "secret").First(&node).Error; err != nil {
		t.Fatalf("load node: %v", err)
	}
	share := &PeerShare{Name: "share", NodeID: node.ID, Token: "token", ScopeType: "selected", MinHealthyInstances: 1, IsActive: 1, CreatedTime: now, UpdatedTime: now}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}
	if err := r.ReplacePeerShareInstances(share.ID, node.ID, []string{"instance-a"}, now); err != nil {
		t.Fatalf("replace instances: %v", err)
	}
	runtime := &PeerShareRuntime{ShareID: share.ID, NodeID: node.ID, ReservationID: "res", ResourceKey: "rk", Status: 1, CreatedTime: now, UpdatedTime: now}
	if err := r.CreatePeerShareRuntime(runtime); err != nil {
		t.Fatalf("create runtime: %v", err)
	}
	if err := r.UpsertPeerShareRuntimeInstance(&PeerShareRuntimeInstance{RuntimeID: runtime.ID, ShareID: share.ID, NodeID: node.ID, InstanceID: "instance-a", Status: 1, CreatedTime: now, UpdatedTime: now}); err != nil {
		t.Fatalf("create runtime instance: %v", err)
	}
	if err := r.AddPeerShareFlow(share.ID, runtime.ID, "instance-a", 1, 2, time.Now()); err != nil {
		t.Fatalf("add flow: %v", err)
	}

	if err := r.DeleteNodeCascade(node.ID); err != nil {
		t.Fatalf("delete node: %v", err)
	}
	for _, table := range []string{"peer_share", "peer_share_instance", "peer_share_runtime", "peer_share_runtime_instance", "peer_share_flow"} {
		var count int64
		if err := r.DB().Table(table).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("expected %s empty, count=%d err=%v", table, count, err)
		}
	}
}

func TestReservePeerShareRuntimePortSerializesNodePortAllocation(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "reserve.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	now := time.Now().UnixMilli()
	node := &Node{Name: "node", Secret: "reserve-secret", ServerIP: "127.0.0.1", Port: "31000-31001", CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	share := &PeerShare{Name: "share", NodeID: node.ID, Token: "reserve-token", PortRangeStart: 31000, PortRangeEnd: 31001, ScopeType: "all_enabled", MinHealthyInstances: 1, IsActive: 1, CreatedTime: now, UpdatedTime: now}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}

	results := make(chan *PeerShareRuntime, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, key := range []string{"resource-a", "resource-b"} {
		key := key
		wg.Add(1)
		go func() {
			defer wg.Done()
			runtime, reserveErr := r.ReservePeerShareRuntimePort(share, key, "reservation-"+key, "tls", 0, now)
			results <- runtime
			errs <- reserveErr
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for reserveErr := range errs {
		if reserveErr != nil {
			t.Fatalf("reserve port: %v", reserveErr)
		}
	}
	ports := make(map[int]struct{})
	for runtime := range results {
		if runtime == nil {
			t.Fatalf("expected runtime")
		}
		ports[runtime.Port] = struct{}{}
	}
	if len(ports) != 2 {
		t.Fatalf("expected distinct ports, got %v", ports)
	}
}

func TestCreateFederationTunnelRejectsReservedRuntimePort(t *testing.T) {
	r, err := Open(filepath.Join(t.TempDir(), "legacy-create.db"))
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	now := time.Now().UnixMilli()
	node := &Node{Name: "node", Secret: "legacy-secret", ServerIP: "127.0.0.1", Port: "32000-32001", CreatedTime: now, Status: 1, TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	if err := r.DB().Create(node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	share := &PeerShare{Name: "share", NodeID: node.ID, Token: "legacy-token", PortRangeStart: 32000, PortRangeEnd: 32001, ScopeType: "all_enabled", MinHealthyInstances: 1, IsActive: 1, CreatedTime: now, UpdatedTime: now}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create share: %v", err)
	}
	if _, err := r.ReservePeerShareRuntimePort(share, "resource", "reservation", "tls", 32000, now); err != nil {
		t.Fatalf("reserve runtime port: %v", err)
	}
	if _, err := r.CreateFederationTunnel("legacy", 1, "tls", now, node.ID, 32000); err == nil {
		t.Fatalf("expected legacy tunnel create to reject reserved runtime port")
	}
}
