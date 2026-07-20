package handler

import (
	"testing"

	"go-backend/internal/store/model"
)

// ---------------------------------------------------------------------------
// nodeSupportsV4 / nodeSupportsV6
// ---------------------------------------------------------------------------

func TestSelectTunnelDialHost_ConnectIpPriority(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")

	// Empty connectIpType should fallback to default (v4 preference)
	host, _, err := selectTunnelDialHost(from, to, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "10.0.0.2" {
		t.Fatalf("empty connectIpType should fallback to v4 preference, got %q", host)
	}
	// connectIpType v6 should select IPv6 address
	host, _, err = selectTunnelDialHost(from, to, "", "v6")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("connectIpType v6 should select IPv6 address, got %q", host)
	}
}

func TestBuildTunnelChainServiceConfig_UsesConnectIPForListen(t *testing.T) {
	node := &nodeRecord{TCPListenAddr: "[::]"}
	chain := tunnelRuntimeNode{Protocol: "tls", Port: 21000}
	services := buildTunnelChainServiceConfig(99, chain, node, 1, "gost")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	addr, _ := services[0]["addr"].(string)
	if addr != "[::]:21000" {
		t.Fatalf("expected listen [::]:21000, got %q", addr)
	}
}

func TestBuildTunnelChainServiceConfig_FallsBackToNodeListenAddr(t *testing.T) {
	node := &nodeRecord{TCPListenAddr: "10.8.0.5"}
	chain := tunnelRuntimeNode{Protocol: "tls", Port: 21002}
	services := buildTunnelChainServiceConfig(99, chain, node, 1, "gost")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	addr, _ := services[0]["addr"].(string)
	if addr != "10.8.0.5:21002" {
		t.Fatalf("expected node listen addr 10.8.0.5:21002, got %q", addr)
	}
}

func TestBuildTunnelChainServiceConfig_DefaultListenAddrWhenConnectIPEmpty(t *testing.T) {
	node := &nodeRecord{TCPListenAddr: "[::]"}
	chain := tunnelRuntimeNode{Protocol: "tls", Port: 21001}
	services := buildTunnelChainServiceConfig(99, chain, node, 1, "gost")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	addr, _ := services[0]["addr"].(string)
	if addr != "[::]:21001" {
		t.Fatalf("expected default listen [::]:21001, got %q", addr)
	}
}

func TestBuildTunnelChainServiceConfig_SetsRetriesWhenMultipleCandidates(t *testing.T) {
	node := &nodeRecord{TCPListenAddr: "[::]"}
	chain := tunnelRuntimeNode{Protocol: "tls", Port: 21001}
	services := buildTunnelChainServiceConfig(99, chain, node, 3, "gost")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	handler, _ := services[0]["handler"].(map[string]interface{})
	if handler == nil {
		t.Fatal("expected handler config")
	}
	retries, ok := handler["retries"].(int)
	if !ok {
		t.Fatal("expected retries to be set when nextHopCandidateCount > 1")
	}
	if retries != 2 {
		t.Fatalf("expected retries=2 (candidates-1), got %d", retries)
	}
}

func TestBuildTunnelChainServiceConfig_NoRetriesWhenSingleCandidate(t *testing.T) {
	node := &nodeRecord{TCPListenAddr: "[::]"}
	chain := tunnelRuntimeNode{Protocol: "tls", Port: 21001}
	services := buildTunnelChainServiceConfig(99, chain, node, 1, "gost")
	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	handler, _ := services[0]["handler"].(map[string]interface{})
	if handler == nil {
		t.Fatal("expected handler config")
	}
	if _, hasRetries := handler["retries"]; hasRetries {
		t.Fatal("expected no retries when nextHopCandidateCount is 1")
	}
}

func TestNodeSupportsV6_Nil(t *testing.T) {
	if nodeSupportsV6(nil) {
		t.Fatal("nil node must not support v6")
	}
}

func TestNodeSupportsV4_ExplicitV4(t *testing.T) {
	n := &nodeRecord{ServerIPv4: "10.0.0.1"}
	if !nodeSupportsV4(n) {
		t.Fatal("explicit server_ip_v4 needs support v4")
	}
}

func TestNodeSupportsV6_ExplicitV6(t *testing.T) {
	n := &nodeRecord{ServerIPv6: "2001:db8::1"}
	if !nodeSupportsV6(n) {
		t.Fatal("explicit server_ip_v6 needs support v6")
	}
}

func TestNodeSupportsV4_OnlyV6Set(t *testing.T) {
	n := &nodeRecord{ServerIPv6: "2001:db8::1"}
	if nodeSupportsV4(n) {
		t.Fatal("node with only v6 should not support v4")
	}
}

func TestNodeSupportsV6_OnlyV4Set(t *testing.T) {
	n := &nodeRecord{ServerIPv4: "10.0.0.1"}
	if nodeSupportsV6(n) {
		t.Fatal("node with only v4 should not support v6")
	}
}

func TestNodeSupportsV4_DualStack(t *testing.T) {
	n := &nodeRecord{ServerIPv4: "10.0.0.1", ServerIPv6: "2001:db8::1"}
	if !nodeSupportsV4(n) {
		t.Fatal("dual-stack node must support v4")
	}
}

func TestNodeSupportsV6_DualStack(t *testing.T) {
	n := &nodeRecord{ServerIPv4: "10.0.0.1", ServerIPv6: "2001:db8::1"}
	if !nodeSupportsV6(n) {
		t.Fatal("dual-stack node must support v6")
	}
}

func TestNodeSupportsV4_LegacyV4Only(t *testing.T) {
	n := &nodeRecord{ServerIP: "192.168.1.1"}
	if !nodeSupportsV4(n) {
		t.Fatal("legacy v4 ip in server_ip must support v4")
	}
	if nodeSupportsV6(n) {
		t.Fatal("legacy v4 ip in server_ip should not support v6")
	}
}

func TestNodeSupportsV6_LegacyV6Only(t *testing.T) {
	n := &nodeRecord{ServerIP: "2001:db8::1"}
	if !nodeSupportsV6(n) {
		t.Fatal("legacy v6 ip in server_ip must support v6")
	}
	if nodeSupportsV4(n) {
		t.Fatal("legacy v6 ip in server_ip should not support v4")
	}
}

func TestNodeSupportsV4_EmptyNode(t *testing.T) {
	n := &nodeRecord{}
	if nodeSupportsV4(n) {
		t.Fatal("empty node must not support v4")
	}
	if nodeSupportsV6(n) {
		t.Fatal("empty node must not support v6")
	}
}

func TestNodeSupportsV4_LegacyBracketed(t *testing.T) {
	n := &nodeRecord{ServerIP: "[::1]"}
	if nodeSupportsV4(n) {
		t.Fatal("bracketed ipv6 must not support v4")
	}
	if !nodeSupportsV6(n) {
		t.Fatal("bracketed ipv6 must support v6")
	}
}

func TestNodeSupportsV4_LegacyAutoIgnored(t *testing.T) {
	n := &nodeRecord{ServerIP: "auto"}
	if nodeSupportsV4(n) {
		t.Fatal("legacy auto server_ip must not support v4")
	}
	if nodeSupportsV6(n) {
		t.Fatal("legacy auto server_ip must not support v6")
	}
	if pickNodeAddressV4(n) != "" {
		t.Fatal("legacy auto server_ip must not return v4 address")
	}
	if pickNodeAddressV6(n) != "" {
		t.Fatal("legacy auto server_ip must not return v6 address")
	}
}

// ---------------------------------------------------------------------------
// pickNodeAddressV4 / pickNodeAddressV6
// ---------------------------------------------------------------------------

func TestPickNodeAddressV4_Nil(t *testing.T) {
	if pickNodeAddressV4(nil) != "" {
		t.Fatal("nil node must return empty")
	}
}

func TestPickNodeAddressV6_Nil(t *testing.T) {
	if pickNodeAddressV6(nil) != "" {
		t.Fatal("nil node must return empty")
	}
}

func TestPickNodeAddressV4_PreferExplicit(t *testing.T) {
	n := &nodeRecord{ServerIPv4: "10.0.0.1", ServerIP: "192.168.0.1"}
	got := pickNodeAddressV4(n)
	if got != "10.0.0.1" {
		t.Fatalf("expected explicit v4 10.0.0.1, got %q", got)
	}
}

func TestPickNodeAddressV4_FallbackLegacy(t *testing.T) {
	n := &nodeRecord{ServerIP: "192.168.0.1"}
	got := pickNodeAddressV4(n)
	if got != "192.168.0.1" {
		t.Fatalf("expected legacy 192.168.0.1, got %q", got)
	}
}

func TestPickNodeAddressV6_PreferExplicit(t *testing.T) {
	n := &nodeRecord{ServerIPv6: "2001:db8::1", ServerIP: "::1"}
	got := pickNodeAddressV6(n)
	if got != "2001:db8::1" {
		t.Fatalf("expected explicit v6 2001:db8::1, got %q", got)
	}
}

func TestPickNodeAddressV6_FallbackLegacy(t *testing.T) {
	n := &nodeRecord{ServerIP: "::1"}
	got := pickNodeAddressV6(n)
	if got != "::1" {
		t.Fatalf("expected legacy ::1, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// selectTunnelDialHost — core IP preference selection logic
// ---------------------------------------------------------------------------

func dualStackNode(name, v4, v6 string) *nodeRecord {
	return &nodeRecord{
		Name:       name,
		ServerIPv4: v4,
		ServerIPv6: v6,
	}
}

func v4OnlyNode(name, v4 string) *nodeRecord {
	return &nodeRecord{
		Name:       name,
		ServerIPv4: v4,
	}
}

func v6OnlyNode(name, v6 string) *nodeRecord {
	return &nodeRecord{
		Name:       name,
		ServerIPv6: v6,
	}
}

func TestSelectTunnelDialHost_NilNodes(t *testing.T) {
	_, _, err := selectTunnelDialHost(nil, nil, "", "")
	if err == nil {
		t.Fatal("expected error for nil nodes")
	}
	_, _, err = selectTunnelDialHost(dualStackNode("a", "1.1.1.1", "::1"), nil, "", "")
	if err == nil {
		t.Fatal("expected error for nil toNode")
	}
	_, _, err = selectTunnelDialHost(nil, dualStackNode("b", "1.1.1.1", "::1"), "", "")
	if err == nil {
		t.Fatal("expected error for nil fromNode")
	}
}

func TestSelectTunnelDialHost_DualStack_DefaultPreference(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	host, _, err := selectTunnelDialHost(from, to, "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Default prefers v4 when both available
	if host != "10.0.0.2" {
		t.Fatalf("default preference should pick v4, got %q", host)
	}
}

func TestSelectTunnelDialHost_DualStack_PreferV4(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	host, _, err := selectTunnelDialHost(from, to, "v4", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "10.0.0.2" {
		t.Fatalf("v4 preference should pick v4 address, got %q", host)
	}
}

func TestSelectTunnelDialHost_DualStack_PreferV6(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	host, _, err := selectTunnelDialHost(from, to, "v6", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("v6 preference should pick v6 address, got %q", host)
	}
}

func TestSelectTunnelDialHost_V4Only_PreferV6Fallback(t *testing.T) {
	from := v4OnlyNode("from", "10.0.0.1")
	to := v4OnlyNode("to", "10.0.0.2")
	// User prefers v6, but both nodes are v4-only — should fallback to v4
	host, _, err := selectTunnelDialHost(from, to, "v6", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "10.0.0.2" {
		t.Fatalf("v6 preference on v4-only nodes should fallback to v4, got %q", host)
	}
}

func TestSelectTunnelDialHost_V6Only_PreferV4Fallback(t *testing.T) {
	from := v6OnlyNode("from", "2001:db8::1")
	to := v6OnlyNode("to", "2001:db8::2")
	// User prefers v4, but both nodes are v6-only — should fallback to v6
	host, _, err := selectTunnelDialHost(from, to, "v4", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("v4 preference on v6-only nodes should fallback to v6, got %q", host)
	}
}

func TestSelectTunnelDialHost_Incompatible(t *testing.T) {
	from := v4OnlyNode("from", "10.0.0.1")
	to := v6OnlyNode("to", "2001:db8::2")
	_, _, err := selectTunnelDialHost(from, to, "", "")
	if err == nil {
		t.Fatal("expected error for incompatible nodes (v4-only -> v6-only)")
	}
}

func TestSelectTunnelDialHost_Incompatible_Reverse(t *testing.T) {
	from := v6OnlyNode("from", "2001:db8::1")
	to := v4OnlyNode("to", "10.0.0.2")
	_, _, err := selectTunnelDialHost(from, to, "", "")
	if err == nil {
		t.Fatal("expected error for incompatible nodes (v6-only -> v4-only)")
	}
}

func TestSelectTunnelDialHost_WhitespacePreference(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	// Whitespace should be trimmed, treated as "v6"
	host, _, err := selectTunnelDialHost(from, to, "  v6  ", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("trimmed v6 preference should pick v6 address, got %q", host)
	}
}

func TestSelectTunnelDialHost_MixedStack_FromDualToV4(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := v4OnlyNode("to", "10.0.0.2")
	// v6 preferred, but target only has v4 — should succeed with v4
	host, _, err := selectTunnelDialHost(from, to, "v6", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "10.0.0.2" {
		t.Fatalf("should fallback to v4 when target is v4-only, got %q", host)
	}
}

func TestSelectTunnelDialHost_MixedStack_FromDualToV6(t *testing.T) {
	from := dualStackNode("from", "10.0.0.1", "2001:db8::1")
	to := v6OnlyNode("to", "2001:db8::2")
	// v4 preferred, but target only has v6 — should succeed with v6
	host, _, err := selectTunnelDialHost(from, to, "v4", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("should fallback to v6 when target is v6-only, got %q", host)
	}
}

func TestSelectTunnelDialHost_MixedStack_FromV4ToDual(t *testing.T) {
	from := v4OnlyNode("from", "10.0.0.1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	// v6 preferred, but from only has v4 — should use v4 (from can only reach v4 of target)
	host, _, err := selectTunnelDialHost(from, to, "v6", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "10.0.0.2" {
		t.Fatalf("should use v4 when from is v4-only, got %q", host)
	}
}

func TestSelectTunnelDialHost_MixedStack_FromV6ToDual(t *testing.T) {
	from := v6OnlyNode("from", "2001:db8::1")
	to := dualStackNode("to", "10.0.0.2", "2001:db8::2")
	// v4 preferred, but from only has v6 — should use v6
	host, _, err := selectTunnelDialHost(from, to, "v4", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if host != "2001:db8::2" {
		t.Fatalf("should use v6 when from is v6-only, got %q", host)
	}
}

func TestBuildTunnelChainConfig_UsesNodeInstancesWithWeights(t *testing.T) {
	nodes := map[int64]*nodeRecord{
		1: {ID: 1, Name: "from", ServerIPv4: "10.0.0.1"},
		2: {ID: 2, Name: "to", Weight: 9},
	}
	instances := map[int64][]model.NodeInstance{
		2: {
			{NodeID: 2, InstanceID: "a", PublicIPV4: "198.51.100.1", Weight: 3},
			{NodeID: 2, InstanceID: "b", PublicIPV4: "198.51.100.2", Weight: 7},
		},
	}
	targets := []tunnelRuntimeNode{{NodeID: 2, Protocol: "tls", Strategy: "round", Port: 21000}}

	chain, err := buildTunnelChainConfig(99, 1, targets, nodes, instances, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	hops := chain["hops"].([]map[string]interface{})
	selector := hops[0]["selector"].(map[string]interface{})
	if selector["strategy"] != "round" {
		t.Fatalf("expected weighted round strategy, got %v", selector["strategy"])
	}
	items := hops[0]["nodes"].([]map[string]interface{})
	if len(items) != 2 {
		t.Fatalf("expected 2 instance targets, got %d", len(items))
	}
	if items[0]["addr"] != "198.51.100.1:21000" || items[1]["addr"] != "198.51.100.2:21000" {
		t.Fatalf("expected instance addresses, got %#v", items)
	}
	if items[0]["metadata"].(map[string]interface{})["weight"] != 3 || items[1]["metadata"].(map[string]interface{})["weight"] != 7 {
		t.Fatalf("expected instance weights, got %#v", items)
	}
}

func TestBuildTunnelChainConfig_PrefersConfiguredLanDomainOverInstances(t *testing.T) {
	nodes := map[int64]*nodeRecord{
		1: {ID: 1, Name: "from", ServerIPv4: "10.0.0.1"},
		2: {ID: 2, Name: "to", IntranetIP: "ix.example.com", Weight: 9},
	}
	instances := map[int64][]model.NodeInstance{
		2: {
			{NodeID: 2, InstanceID: "a", PublicIPV4: "198.51.100.1", Weight: 3},
			{NodeID: 2, InstanceID: "b", PublicIPV4: "198.51.100.2", Weight: 7},
		},
	}
	targets := []tunnelRuntimeNode{{NodeID: 2, Protocol: "tls", Strategy: "round", Port: 21000, ConnectIPType: "lan"}}

	chain, err := buildTunnelChainConfig(99, 1, targets, nodes, instances, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	hops := chain["hops"].([]map[string]interface{})
	items := hops[0]["nodes"].([]map[string]interface{})
	if len(items) != 1 || items[0]["addr"] != "ix.example.com:21000" {
		t.Fatalf("expected one configured LAN domain target, got %#v", items)
	}
}

func TestDiagnosisTargetEndpoints_PrefersConfiguredLanDomainOverInstances(t *testing.T) {
	node := chainNodeRecord{NodeID: 2, NodeName: "to"}
	targetNode := &nodeRecord{ID: 2, IntranetIP: "ix.example.com"}
	instances := map[int64][]model.NodeInstance{
		2: {
			{NodeID: 2, InstanceID: "a", PublicIPV4: "198.51.100.1", Weight: 3},
			{NodeID: 2, InstanceID: "b", PublicIPV4: "198.51.100.2", Weight: 7},
		},
	}

	endpoints := diagnosisTargetEndpoints(node, targetNode, "", "lan", instances)
	if len(endpoints) != 1 || endpoints[0].targetHost != "ix.example.com" {
		t.Fatalf("expected one configured LAN diagnosis target, got %+v", endpoints)
	}
	if endpoints[0].instanceID != "" {
		t.Fatalf("configured node address must not be attributed to one instance, got %+v", endpoints[0])
	}
}

func TestDiagnosisTargetEndpoints_FallsBackToInstancesWhenNodeAddressMissing(t *testing.T) {
	node := chainNodeRecord{NodeID: 2, NodeName: "to"}
	instances := map[int64][]model.NodeInstance{
		2: {
			{NodeID: 2, InstanceID: "a", PublicIPV4: "198.51.100.1", Weight: 3},
			{NodeID: 2, InstanceID: "b", PublicIPV4: "198.51.100.2", Weight: 7},
		},
	}

	endpoints := diagnosisTargetEndpoints(node, &nodeRecord{ID: 2}, "", "lan", instances)
	if len(endpoints) != 2 {
		t.Fatalf("expected two instance fallback targets, got %+v", endpoints)
	}
	if endpoints[0].targetHost != "198.51.100.1" || endpoints[1].targetHost != "198.51.100.2" {
		t.Fatalf("unexpected instance fallback targets: %+v", endpoints)
	}
}

func TestCalculateTunnelTrafficRatioUsesMaximumPerLayer(t *testing.T) {
	state := &tunnelCreateState{
		Type: 2,
		InNodes: []tunnelRuntimeNode{
			{NodeID: 1},
			{NodeID: 2},
		},
		ChainHops: [][]tunnelRuntimeNode{
			{{NodeID: 3}, {NodeID: 4}},
			{{NodeID: 5}},
		},
		OutNodes: []tunnelRuntimeNode{
			{NodeID: 6},
			{NodeID: 7},
		},
		Nodes: map[int64]*nodeRecord{
			1: {ID: 1, TrafficRatio: 1},
			2: {ID: 2, TrafficRatio: 3},
			3: {ID: 3, TrafficRatio: 2},
			4: {ID: 4, TrafficRatio: 5},
			5: {ID: 5, TrafficRatio: 4},
			6: {ID: 6, TrafficRatio: 2},
			7: {ID: 7, TrafficRatio: 6},
		},
	}

	if got := calculateTunnelTrafficRatio(state); got != 18 {
		t.Fatalf("expected entry max 3 + hop max 5 + hop max 4 + exit max 6 = 18, got %v", got)
	}
}

func TestCalculatePortForwardTrafficRatioUsesEntryMaximumOnly(t *testing.T) {
	state := &tunnelCreateState{
		Type:     1,
		InNodes:  []tunnelRuntimeNode{{NodeID: 1}, {NodeID: 2}},
		OutNodes: []tunnelRuntimeNode{{NodeID: 3}},
		Nodes: map[int64]*nodeRecord{
			1: {ID: 1, TrafficRatio: 1},
			2: {ID: 2, TrafficRatio: 3},
			3: {ID: 3, TrafficRatio: 9},
		},
	}

	if got := calculateTunnelTrafficRatio(state); got != 3 {
		t.Fatalf("expected entry maximum 3, got %v", got)
	}
}

func TestBuildTunnelChainConfig_DoesNotFallbackWhenInstancesDisabled(t *testing.T) {
	nodes := map[int64]*nodeRecord{
		1: {ID: 1, Name: "from", ServerIPv4: "10.0.0.1"},
		2: {ID: 2, Name: "to", ServerIPv4: "192.0.2.10", Weight: 9},
	}
	instances := map[int64][]model.NodeInstance{
		2: {{NodeID: 2, InstanceID: "disabled", PublicIPV4: "198.51.100.1", Weight: 0}},
	}
	targets := []tunnelRuntimeNode{{NodeID: 2, Protocol: "tls", Strategy: "round", Port: 21000}}

	_, err := buildTunnelChainConfig(99, 1, targets, nodes, instances, "")
	if err == nil {
		t.Fatal("expected no usable chain target when online instances are disabled")
	}
}

// ---------------------------------------------------------------------------
// nodeDisplayName
// ---------------------------------------------------------------------------

func TestNodeDisplayName_Nil(t *testing.T) {
	got := nodeDisplayName(nil)
	if got != "node" {
		t.Fatalf("nil node display name should be 'node', got %q", got)
	}
}

func TestNodeDisplayName_Named(t *testing.T) {
	n := &nodeRecord{ID: 42, Name: "hk-node"}
	got := nodeDisplayName(n)
	if got != "hk-node" {
		t.Fatalf("expected 'hk-node', got %q", got)
	}
}
func TestNodeDisplayName_Unnamed(t *testing.T) {
	n := &nodeRecord{ID: 42}
	got := nodeDisplayName(n)
	if got != "node_42" {
		t.Fatalf("expected 'node_42', got %q", got)
	}
}
