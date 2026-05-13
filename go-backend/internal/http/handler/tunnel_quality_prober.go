package handler

import (
	"context"
	"log"
	"sync"
	"time"

	"go-backend/internal/store/model"
)

const (
	tunnelQualityProbeInterval = 10 * time.Second
	tunnelQualityProbeTimeout  = 8 * time.Second
	tunnelQualityPingTimeoutMs = 5000
	tunnelQualityRetention     = 24 * time.Hour // keep 24h of history
	tunnelQualityPruneInterval = 10 * time.Minute
)

// tunnelQualitySnapshot is the in-memory latest probe result for a tunnel.
type tunnelQualitySnapshot struct {
	TunnelID           int64   `json:"tunnelId"`
	EntryToExitLatency float64 `json:"entryToExitLatency"`
	ExitToBingLatency  float64 `json:"exitToBingLatency"`
	EntryToExitLoss    float64 `json:"entryToExitLoss"`
	ExitToBingLoss     float64 `json:"exitToBingLoss"`
	Success            bool    `json:"success"`
	ErrorMessage       string  `json:"errorMessage,omitempty"`
	Timestamp          int64   `json:"timestamp"`
}

// tunnelQualityProber runs periodic TCP ping probes against all enabled tunnels.
// Design mirrors health.Checker: background goroutine with worker pool + scheduled cleanup.
type tunnelQualityProber struct {
	handler   *Handler
	cache     sync.Map // tunnelID (int64) → *tunnelQualitySnapshot
	ctx       context.Context
	cancel    context.CancelFunc
	interval  time.Duration
	lastPrune int64
}

// newTunnelQualityProber creates a new prober (not yet running).
func newTunnelQualityProber(h *Handler) *tunnelQualityProber {
	ctx, cancel := context.WithCancel(context.Background())
	return &tunnelQualityProber{
		handler:  h,
		ctx:      ctx,
		cancel:   cancel,
		interval: tunnelQualityProbeInterval,
	}
}

// Start launches the background probe loop (call from jobs.go).
func (p *tunnelQualityProber) Start(ctx context.Context) {
	// Use the provided context so we stop with other background jobs.
	p.ctx, p.cancel = context.WithCancel(ctx)
	p.loop()
}

// Stop halts the background probe loop.
func (p *tunnelQualityProber) Stop() {
	p.cancel()
}

// GetAll returns all cached quality snapshots (latest per tunnel).
func (p *tunnelQualityProber) GetAll() []tunnelQualitySnapshot {
	var items []tunnelQualitySnapshot
	p.cache.Range(func(_, value interface{}) bool {
		if snap, ok := value.(*tunnelQualitySnapshot); ok {
			items = append(items, *snap)
		}
		return true
	})
	return items
}

func (p *tunnelQualityProber) loop() {
	// Initial delay to let the system boot up
	select {
	case <-time.After(5 * time.Second):
	case <-p.ctx.Done():
		return
	}

	// Run once immediately
	p.probeAll()

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.probeAll()
			p.maybePrune()
		}
	}
}

// maybePrune deletes old quality rows periodically (mirrors PruneServiceMonitorResults).
func (p *tunnelQualityProber) maybePrune() {
	now := time.Now().UnixMilli()
	if p.lastPrune > 0 && now-p.lastPrune < int64(tunnelQualityPruneInterval/time.Millisecond) {
		return
	}
	p.lastPrune = now

	h := p.handler
	if h == nil || h.repo == nil {
		return
	}

	cutoff := now - int64(tunnelQualityRetention/time.Millisecond)
	if err := h.repo.PruneTunnelQualityResults(cutoff); err != nil {
		log.Printf("tunnel_quality_prober: prune err=%v", err)
	}
}

func (p *tunnelQualityProber) probeAll() {
	h := p.handler
	if h == nil || h.repo == nil {
		return
	}

	tunnelIDs, err := h.repo.ListEnabledTunnelIDs()
	if err != nil {
		log.Printf("tunnel_quality_prober: list enabled tunnels err=%v", err)
		return
	}
	if len(tunnelIDs) == 0 {
		return
	}

	// Probe tunnels concurrently with a worker limit
	// (mirrors health.Checker worker pool pattern)
	const maxWorkers = 4
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	for _, tunnelID := range tunnelIDs {
		select {
		case <-p.ctx.Done():
			return
		default:
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(tid int64) {
			defer wg.Done()
			defer func() { <-sem }()
			p.probeTunnel(tid)
		}(tunnelID)
	}
	wg.Wait()
}

func (p *tunnelQualityProber) probeTunnel(tunnelID int64) {
	h := p.handler
	if h == nil || h.repo == nil {
		return
	}

	now := time.Now().UnixMilli()
	snap := &tunnelQualitySnapshot{
		TunnelID:  tunnelID,
		Timestamp: now,
	}

	// Get tunnel chain info
	tunnel, err := h.getTunnelRecord(tunnelID)
	if err != nil {
		snap.ErrorMessage = "隧道不存在"
		p.storeResult(snap)
		return
	}

	chainRows, err := h.listChainNodesForTunnel(tunnelID)
	if err != nil || len(chainRows) == 0 {
		snap.ErrorMessage = "隧道配置不完整"
		p.storeResult(snap)
		return
	}

	ipPreference := h.repo.GetTunnelIPPreference(tunnelID)
	inNodes, _, outNodes := splitChainNodeGroups(chainRows)

	options := diagnosisExecOptions{
		commandTimeout: tunnelQualityProbeTimeout,
		pingTimeoutMS:  tunnelQualityPingTimeoutMs,
		timeoutMessage: "探测超时",
	}

	switch tunnel.Type {
	case 1:
		// Port forwarding: entry → exit test targets
		if len(inNodes) > 0 {
			lat, loss, _, err := p.tcpPingExitTest(inNodes[0].NodeID, options)
			if err == nil {
				snap.ExitToBingLatency = lat
				snap.ExitToBingLoss = loss
				snap.Success = true
			} else {
				snap.ErrorMessage = err.Error()
			}
		}
	case 2:
		// Tunnel forwarding: entry → exit + exit → Bing
		probeOK := true

		if len(inNodes) > 0 && len(outNodes) > 0 {
			// Entry → Exit
			targetNode, nodeErr := h.getNodeRecord(outNodes[0].NodeID)
			if nodeErr == nil && targetNode != nil {
				fromNode, _ := h.getNodeRecord(inNodes[0].NodeID)
				targetIP, targetPort, resolveErr := resolveChainProbeTarget(fromNode, targetNode, outNodes[0].Port, ipPreference, outNodes[0].ConnectIPType)
				if resolveErr == nil {
					lat, loss, err := p.tcpPingNode(inNodes[0].NodeID, targetIP, targetPort, options)
					if err == nil {
						snap.EntryToExitLatency = lat
						snap.EntryToExitLoss = loss
					} else {
						snap.EntryToExitLatency = -1
						snap.EntryToExitLoss = 100
						probeOK = false
					}
				} else {
					snap.ErrorMessage = resolveErr.Error()
					probeOK = false
				}
			} else {
				snap.ErrorMessage = "出口节点不可用"
				probeOK = false
			}
		}

		// Exit → exit test targets
		if len(outNodes) > 0 {
			lat, loss, _, err := p.tcpPingExitTest(outNodes[0].NodeID, options)
			if err == nil {
				snap.ExitToBingLatency = lat
				snap.ExitToBingLoss = loss
			} else {
				if snap.ErrorMessage == "" {
					snap.ErrorMessage = err.Error()
				}
				probeOK = false
			}
		}

		snap.Success = probeOK
	default:
		// Unknown type: entry → exit test targets
		if len(inNodes) > 0 {
			lat, loss, _, err := p.tcpPingExitTest(inNodes[0].NodeID, options)
			if err == nil {
				snap.ExitToBingLatency = lat
				snap.ExitToBingLoss = loss
				snap.Success = true
			} else {
				snap.ErrorMessage = err.Error()
			}
		}
	}

	p.storeResult(snap)
}

func (p *tunnelQualityProber) tcpPingNode(nodeID int64, ip string, port int, options diagnosisExecOptions) (latency float64, loss float64, err error) {
	h := p.handler
	if h == nil {
		return 0, 100, nil
	}

	node, nodeErr := h.getNodeRecord(nodeID)
	if nodeErr != nil {
		return 0, 100, nodeErr
	}

	var pingData map[string]interface{}
	var pingErr error
	if node != nil && node.IsRemote == 1 {
		pingData, pingErr = h.tcpPingViaRemoteNode(node, ip, port, options)
	} else {
		pingData, pingErr = h.tcpPingViaNode(nodeID, ip, port, options)
	}
	if pingErr != nil {
		return 0, 100, pingErr
	}

	avgTime := asFloat(pingData["averageTime"], 0)
	packetLoss := asFloat(pingData["packetLoss"], 100)

	return avgTime, packetLoss, nil
}

// tcpPingExitTest tries exit test targets in order and returns the first successful result.
// Returns the last error if all targets fail.
func (p *tunnelQualityProber) tcpPingExitTest(nodeID int64, options diagnosisExecOptions) (latency float64, loss float64, targetHost string, err error) {
	var lastErr error
	for _, t := range exitTestTargets {
		lat, loss, perr := p.tcpPingNode(nodeID, t.host, t.port, options)
		if perr == nil {
			return lat, loss, t.name, nil
		}
		lastErr = perr
	}
	return 0, 100, "", lastErr
}

func (p *tunnelQualityProber) storeResult(snap *tunnelQualitySnapshot) {
	if snap == nil {
		return
	}

	// Update in-memory cache (latest per tunnel)
	p.cache.Store(snap.TunnelID, snap)

	// Persist to database (history)
	h := p.handler
	if h == nil || h.repo == nil {
		return
	}

	successInt := 0
	if snap.Success {
		successInt = 1
	}

	q := &model.TunnelQuality{
		TunnelID:           snap.TunnelID,
		EntryToExitLatency: snap.EntryToExitLatency,
		ExitToBingLatency:  snap.ExitToBingLatency,
		EntryToExitLoss:    snap.EntryToExitLoss,
		ExitToBingLoss:     snap.ExitToBingLoss,
		Success:            successInt,
		ErrorMessage:       snap.ErrorMessage,
		Timestamp:          snap.Timestamp,
	}
	if err := h.repo.InsertTunnelQuality(q); err != nil {
		log.Printf("tunnel_quality_prober: insert db err=%v tunnel_id=%d", err, snap.TunnelID)
	}
}
