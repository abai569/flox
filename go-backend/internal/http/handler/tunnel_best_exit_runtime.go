package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

const (
	bestExitProbeInterval = 10 * time.Second
	bestExitProbeTimeout  = 8 * time.Second
)

func normalizeForwardStrategy(strategy string) string {
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "", "fifo", "ha":
		return "fifo"
	case "round", "rr":
		return "round"
	case "rand", "random":
		return "rand"
	case "hash":
		return "hash"
	default:
		return "fifo"
	}
}

func normalizeTunnelStrategy(strategy string) string {
	if isBestTunnelStrategy(strategy) {
		return tunnelStrategyBest
	}
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "", "round", "rr":
		return "round"
	case "fifo", "ha":
		return "fifo"
	case "rand", "random":
		return "rand"
	case "hash":
		return "hash"
	default:
		return "round"
	}
}

func strategyOfRuntimeTargets(targets []tunnelRuntimeNode) string {
	if len(targets) == 0 {
		return ""
	}
	return normalizeTunnelStrategy(targets[0].Strategy)
}

func strategyOfChainRecords(rows []chainNodeRecord) string {
	if len(rows) == 0 {
		return ""
	}
	return normalizeTunnelStrategy(rows[0].Strategy)
}

func cloneRuntimeTargets(targets []tunnelRuntimeNode) []tunnelRuntimeNode {
	return append([]tunnelRuntimeNode(nil), targets...)
}

func (h *Handler) prepareRuntimeTargetsForOwner(tunnelID, ownerNodeID int64, targets []tunnelRuntimeNode, preferredExitID int64) []tunnelRuntimeNode {
	out := cloneRuntimeTargets(targets)
	if len(out) == 0 {
		return out
	}
	strategy := strategyOfRuntimeTargets(out)
	for i := range out {
		out[i].Strategy = runtimeTunnelStrategy(strategy)
	}
	if strategy != tunnelStrategyBest {
		return out
	}
	if preferredExitID > 0 {
		return orderRuntimeTargetsByNodeID(out, []int64{preferredExitID})
	}
	return out
}

func (m *bestExitManager) storeScores(key bestExitOwnerKey, scores []bestExitCandidateScore, reason string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.decisionLocked(key)
	d.Scores = cloneBestExitScores(scores)
	d.LastReason = strings.TrimSpace(reason)
}

func (h *Handler) updateTunnelChainOnNode(nodeID int64, chainData map[string]interface{}) error {
	if h == nil {
		return fmt.Errorf("invalid handler")
	}
	name := strings.TrimSpace(asString(chainData["name"]))
	payload := map[string]interface{}{
		"chain": name,
		"data":  chainData,
	}
	if _, err := h.sendNodeCommand(nodeID, "UpdateChains", payload, false, false); err != nil {
		if _, addErr := h.sendNodeCommand(nodeID, "AddChains", chainData, true, false); addErr != nil {
			return fmt.Errorf("update chains failed: %v; add fallback failed: %v", err, addErr)
		}
	}
	return nil
}

func (h *Handler) applyBestExitSwitch(tunnelID, ownerNodeID, preferredExitID int64, targets []tunnelRuntimeNode, nodes map[int64]*nodeRecord, ipPreference string) error {
	if h == nil || len(targets) == 0 {
		return nil
	}
	preparedTargets := h.prepareRuntimeTargetsForOwner(tunnelID, ownerNodeID, targets, preferredExitID)
	chainData, err := buildTunnelChainConfig(tunnelID, ownerNodeID, preparedTargets, nodes, ipPreference)
	if err != nil {
		return err
	}
	return h.updateTunnelChainOnNode(ownerNodeID, chainData)
}

func (h *Handler) applyBestHopSwitch(tunnelID, ownerNodeID int64, hopIndex int, preferredNodeID int64, targets []tunnelRuntimeNode, nodes map[int64]*nodeRecord, ipPreference string) error {
	if h == nil || len(targets) == 0 {
		return nil
	}
	preparedTargets := h.prepareRuntimeTargetsForOwner(tunnelID, ownerNodeID, targets, preferredNodeID)
	chainData, err := buildTunnelChainConfig(tunnelID, ownerNodeID, preparedTargets, nodes, ipPreference)
	if err != nil {
		return err
	}
	return h.updateTunnelChainOnNode(ownerNodeID, chainData)
}

func (h *Handler) runBestExitLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	if h == nil || h.repo == nil || h.bestExit == nil {
		return
	}

	select {
	case <-time.After(5 * time.Second):
	case <-ctx.Done():
		return
	}

	h.evaluateBestExitTunnelsOnce(ctx)

	ticker := time.NewTicker(bestExitProbeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.evaluateBestExitTunnelsOnce(ctx)
		}
	}
}

func (h *Handler) evaluateBestExitTunnelsOnce(ctx context.Context) {
	if h == nil || h.repo == nil {
		return
	}
	tunnelIDs, err := h.repo.ListEnabledTunnelIDs()
	if err != nil {
		log.Printf("best_exit: list enabled tunnels failed: %v", err)
		return
	}
	if len(tunnelIDs) == 0 {
		return
	}

	const maxWorkers = 4
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup
	for _, tunnelID := range tunnelIDs {
		select {
		case <-ctx.Done():
			wg.Wait()
			return
		default:
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(id int64) {
			defer wg.Done()
			defer func() { <-sem }()
			h.evaluateBestExitTunnel(ctx, id)
		}(tunnelID)
	}
	wg.Wait()
}

func (h *Handler) evaluateBestExitTunnel(ctx context.Context, tunnelID int64) {
	if h == nil || h.repo == nil {
		return
	}
	tunnel, err := h.getTunnelRecord(tunnelID)
	if err != nil || tunnel == nil || tunnel.Type != 2 || tunnel.Status != 1 {
		return
	}
	chainRows, err := h.listChainNodesForTunnel(tunnelID)
	if err != nil || len(chainRows) == 0 {
		return
	}
	if ctx.Err() != nil {
		return
	}
	ipPreference := h.repo.GetTunnelIPPreference(tunnelID)
	inNodes, chainHops, outNodes := splitChainNodeGroups(chainRows)

	bestHops := bestTunnelStrategyHops(inNodes, chainHops, outNodes)
	if len(bestHops) == 0 {
		return
	}

	state, err := h.reconstructTunnelState(tunnelID)
	if err != nil {
		log.Printf("best_exit: reconstruct tunnel %d failed: %v", tunnelID, err)
		return
	}
	options := diagnosisExecOptions{
		commandTimeout: bestExitProbeTimeout,
		pingTimeoutMS:  int(bestExitProbeTimeout / time.Millisecond),
		pingCount:      4,
		timeoutMessage: "探测超时",
	}
	ping := newBestExitRoundPinger(func(nodeID int64, ip string, port int, options diagnosisExecOptions) (float64, float64, error) {
		return h.bestExitProbe(ctx, nodeID, ip, port, options)
	})
	now := time.Now()
	for _, hop := range bestHops {
		for _, owner := range hop.Owners {
			select {
			case <-ctx.Done():
				return
			default:
			}
			key := bestExitOwnerKey{TunnelID: tunnelID, OwnerNodeID: owner.NodeID, HopIndex: hop.HopIndex}
			snapshot, ok := h.bestExit.snapshot(key)
			hadApplied := ok && snapshot.AppliedExitNodeID > 0

			var scores []bestExitCandidateScore
			if hop.HopIndex == 0 {
				scores = evaluateBestExitOwner(owner, hop.Targets, state.Nodes, ipPreference, options, ping)
			} else {
				scores = evaluateBestChainHopOwner(owner, hop.Targets, state.Nodes, ipPreference, options, ping)
			}

			targets := chainRecordsToRuntimeTargets(hop.Targets)
			if !hadApplied {
				reason := "initial best"
				if len(scores) == 0 || !scores[0].Success {
					reason = "all candidates failed"
				}
				h.bestExit.storeScores(key, scores, reason)
				if len(scores) == 0 || !scores[0].Success {
					continue
				}
				desiredID := scores[0].ExitNodeID
				if err := h.applyBestHopSwitch(tunnelID, owner.NodeID, hop.HopIndex, desiredID, targets, state.Nodes, state.IPPreference); err != nil {
					h.bestExit.recordApplyFailure(key, desiredID, now)
					log.Printf("best_exit: initial apply tunnel=%d owner=%d hop=%d node=%d failed: %v", tunnelID, owner.NodeID, hop.HopIndex, desiredID, err)
					continue
				}
				h.bestExit.setApplied(key, desiredID, now)
				continue
			}

			decision := h.bestExit.observeScores(key, scores, now)
			if !decision.Switch || decision.ExitNodeID <= 0 {
				continue
			}
			if err := h.applyBestHopSwitch(tunnelID, owner.NodeID, hop.HopIndex, decision.ExitNodeID, targets, state.Nodes, state.IPPreference); err != nil {
				h.bestExit.recordApplyFailure(key, decision.ExitNodeID, now)
				log.Printf("best_exit: tunnel=%d owner=%d hop=%d switch to node=%d failed: %v", tunnelID, owner.NodeID, hop.HopIndex, decision.ExitNodeID, err)
				continue
			}
			h.bestExit.setApplied(key, decision.ExitNodeID, now)
		}
	}
}

func (h *Handler) bestExitProbe(ctx context.Context, nodeID int64, ip string, port int, options diagnosisExecOptions) (float64, float64, error) {
	if h == nil {
		return 0, 100, fmt.Errorf("handler is nil")
	}
	select {
	case <-ctx.Done():
		return 0, 100, ctx.Err()
	default:
	}
	node, err := h.getNodeRecord(nodeID)
	if err != nil {
		return 0, 100, err
	}
	var pingData map[string]interface{}
	if node != nil && node.IsRemote == 1 {
		pingData, err = h.tcpPingViaRemoteNode(node, ip, port, options)
	} else {
		pingData, err = h.tcpPingViaNode(nodeID, ip, port, options)
	}
	if err != nil {
		return 0, 100, err
	}
	return asFloat(pingData["averageTime"], 0), asFloat(pingData["packetLoss"], 100), nil
}
