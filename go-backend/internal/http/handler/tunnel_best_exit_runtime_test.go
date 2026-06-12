package handler

import "testing"

func TestChainRecordsToRuntimeTargetsUsesConnectIPType(t *testing.T) {
	rows := []chainNodeRecord{{
		NodeID:        10,
		Protocol:      "tls",
		Strategy:      tunnelStrategyBest,
		Inx:           1,
		ChainType:     3,
		Port:          30001,
		ConnectIP:     "10.0.0.1",
		ConnectIPType: "v6",
	}}

	targets := chainRecordsToRuntimeTargets(rows)
	if len(targets) != 1 {
		t.Fatalf("expected one target, got %d", len(targets))
	}
	if targets[0].ConnectIPType != "v6" {
		t.Fatalf("expected connect ip type v6, got %q", targets[0].ConnectIPType)
	}
	if targets[0].Strategy != "fifo" {
		t.Fatalf("expected best runtime strategy to map to fifo, got %q", targets[0].Strategy)
	}
}

func TestPrepareRuntimeTargetsForOwnerOrdersPreferredExitFirst(t *testing.T) {
	h := &Handler{bestExit: newBestExitManager()}
	targets := []tunnelRuntimeNode{
		{NodeID: 30, Strategy: tunnelStrategyBest, Protocol: "tls", Port: 30001, ChainType: 3},
		{NodeID: 31, Strategy: tunnelStrategyBest, Protocol: "tls", Port: 30002, ChainType: 3},
	}

	first := h.prepareRuntimeTargetsForOwner(77, 10, targets, 0)
	if len(first) != 2 {
		t.Fatalf("expected two targets, got %d", len(first))
	}
	if first[0].NodeID != 30 || first[0].Strategy != "fifo" || first[1].Strategy != "fifo" {
		t.Fatalf("unexpected initial targets: %+v", first)
	}

	ordered := h.prepareRuntimeTargetsForOwner(77, 10, targets, 31)
	if ordered[0].NodeID != 31 {
		t.Fatalf("expected preferred exit to be ordered first, got %+v", ordered)
	}
}

func TestResolveBestExitProbeTargetUsesConnectIPType(t *testing.T) {
	fromNode := &nodeRecord{ServerIPv4: "1.1.1.1", ServerIPv6: "2001:db8::1", IntranetIP: "10.0.0.1"}
	toNode := &nodeRecord{ServerIPv4: "2.2.2.2", ServerIPv6: "2001:db8::2", IntranetIP: "10.0.0.2"}

	host, port, err := resolveBestExitProbeTarget(fromNode, toNode, 443, "", "v6")
	if err != nil {
		t.Fatalf("resolve best exit probe target failed: %v", err)
	}
	if host != "2001:db8::2" || port != 443 {
		t.Fatalf("expected v6 target, got host=%q port=%d", host, port)
	}
}

func TestBestExitManagerStoreScoresDefensiveCopy(t *testing.T) {
	m := newBestExitManager()
	key := bestExitOwnerKey{TunnelID: 77, OwnerNodeID: 10, HopIndex: 0}
	scores := []bestExitCandidateScore{scoreBestExitCandidate(10, chainNodeRecord{NodeID: 31, NodeName: "exit-b"}, 10, 0, 20, 0)}
	m.storeScores(key, scores, "testing")
	scores[0].ExitNodeID = 99
	snapshot, ok := m.snapshot(key)
	if !ok {
		t.Fatalf("expected snapshot after storeScores")
	}
	if snapshot.Reason != "testing" {
		t.Fatalf("expected reason to be stored, got %q", snapshot.Reason)
	}
	if len(snapshot.Scores) != 1 || snapshot.Scores[0].ExitNodeID != 31 {
		t.Fatalf("expected defensive copy of scores, got %+v", snapshot.Scores)
	}
}
