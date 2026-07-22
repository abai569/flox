package handler

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	federationclient "go-backend/internal/http/client"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
	"gorm.io/gorm"
)

const bytesPerGB int64 = 1024 * 1024 * 1024

type userTunnelPolicy struct {
	ID       int64
	UserID   int64
	TunnelID int64
	Flow     int64
	InFlow   int64
	OutFlow  int64
	ExpTime  int64
	Status   int
}

type gostConfigSnapshot struct {
	Services []namedConfigItem `json:"services"`
	Chains   []namedConfigItem `json:"chains"`
	Limiters []namedConfigItem `json:"limiters"`
}

type namedConfigItem struct {
	Name string `json:"name"`
}

func (h *Handler) processFlowItem(nodeID int64, instanceID string, item flowItem) error {
	serviceName := strings.TrimSpace(item.N)
	if serviceName == "" || serviceName == "web_api" {
		return nil
	}
	if shareID, ok := parseRemShareServiceName(serviceName); ok {
		if item.D+item.U <= 0 {
			return nil
		}
		if share, err := h.repo.GetPeerShare(shareID); err == nil && share != nil && share.ConsumerFlowAuthority == 0 {
			if err := h.repo.AddPeerShareFlow(shareID, 0, instanceID, item.D, item.U, time.Now()); err != nil {
				return err
			}
			if updated, err := h.repo.GetPeerShare(shareID); err == nil && updated != nil && isPeerShareFlowExceeded(updated) {
				h.afterFlowCommit(func() { h.enforcePeerShareFlowLimit(updated.ID) })
			}
		}
		// Once Consumer authority is established, relay remains only for user flow
		// compatibility and cannot mutate the Provider share ledger.
		eventID := h.flowRelayReportID
		if eventID == "" {
			var err error
			eventID, err = newFlowRelayEventID()
			if err != nil {
				return fmt.Errorf("generate flow relay event id: %w", err)
			}
		}
		nowMs := time.Now().UnixMilli()
		created, err := h.repo.UpsertFlowRelayOutbox(&model.FlowRelayOutbox{
			EventID: eventID, ShareID: shareID, ServiceName: serviceName,
			InstanceID: strings.TrimSpace(instanceID), Up: item.U, Down: item.D,
			NextRetryTime: nowMs, CreatedTime: nowMs,
		})
		if err != nil {
			return err
		}
		if created {
			h.afterFlowCommit(func() { h.tryFlowRelayOutbox(eventID) })
		}
		return nil
	}

	forwardID, userID, userTunnelID, ok := parseFlowServiceIDs(serviceName)
	if ok {
		runtimes, runtimeErr := h.repo.ListActiveForwardPeerShareRuntimesByNodeAndServiceName(nodeID, normalizeForwardRuntimeServiceName(serviceName))
		if runtimeErr != nil {
			return runtimeErr
		}
		if len(runtimes) > 0 {
			return h.processPeerShareFlowByServiceName(nodeID, instanceID, serviceName, item)
		}
		if forward, forwardErr := h.getForwardRecord(forwardID); forwardErr == nil && forward != nil {
			if tunnelName, nameErr := h.repo.GetTunnelName(forward.TunnelID); nameErr == nil {
				if shareID, _, federationTunnel := parsePeerShareInfoFromFederationTunnelName(tunnelName); federationTunnel {
					if share, shareErr := h.repo.GetPeerShare(shareID); shareErr == nil && share != nil && share.NodeID == nodeID {
						return h.processPeerShareFlowFromForward(forwardID, nodeID, instanceID, serviceName, item)
					}
				}
			}
		}
		topology, topologyErr := h.repo.GetForwardTrafficTopology(forwardID, nodeID)
		if topologyErr != nil {
			return topologyErr
		}
		actualUserID, actualUserTunnelID, ownershipErr := h.repo.GetForwardTrafficOwnership(forwardID)
		if ownershipErr != nil {
			return ownershipErr
		}
		if userID != actualUserID || userTunnelID != actualUserTunnelID {
			return fmt.Errorf("flow service ownership mismatch for forward %d", forwardID)
		}
		var source *repo.ForwardTrafficNode
		for i := range topology.Nodes {
			if topology.Nodes[i].NodeID == nodeID {
				source = &topology.Nodes[i]
				break
			}
		}
		if source == nil {
			return fmt.Errorf("node %d is not in forward %d topology", nodeID, forwardID)
		}
		if !source.AuthoritySource {
			if source.IsRemote {
				return nil
			}
			inFlow := int64(math.Round(float64(item.D) * source.TrafficRatio))
			outFlow := int64(math.Round(float64(item.U) * source.TrafficRatio))
			return h.repo.AddNonAuthoritativeLocalForwardInstanceTraffic(forwardID, nodeID, instanceID, inFlow, outFlow)
		}
		inFlow := int64(math.Round(float64(item.D) * topology.TotalRatio))
		outFlow := int64(math.Round(float64(item.U) * topology.TotalRatio))
		nodeDeltas := forwardTrafficNodeDeltas(topology, item.D, item.U)
		if err := h.repo.AddAuthoritativeForwardTraffic(forwardID, userID, userTunnelID, inFlow, outFlow, item.D, item.U, nodeID, instanceID, nodeDeltas); err != nil {
			return err
		}
		h.afterFlowCommit(func() { h.reportAuthoritativeFlowToProviders(topology, item) })
		if quota, quotaErr := h.repo.AddUserQuotaUsage(userID, inFlow+outFlow, time.Now()); quotaErr == nil {
			h.afterFlowCommit(func() { h.enforceUserQuotaIfNeeded(userID, quota) })
		} else {
			return quotaErr
		}
		if err := h.processPeerShareFlowFromForward(forwardID, nodeID, instanceID, serviceName, item); err != nil {
			return err
		}

		// ✅ 新增：检查 Forward 流量限制
		h.afterFlowCommit(func() { h.enforceForwardTrafficLimit(forwardID) })

		if userTunnelID > 0 {
			h.afterFlowCommit(func() { h.enforceFlowPolicies(userID, userTunnelID) })
		}
		return nil
	}

	runtimeID, ok := parsePeerShareRuntimeServiceID(serviceName)
	if !ok {
		return nil
	}
	return h.processPeerShareFlow(runtimeID, instanceID, item)
}

func forwardTrafficNodeDeltas(topology *repo.ForwardTrafficTopology, rawIn, rawOut int64) []repo.ForwardTrafficNodeDelta {
	if topology == nil {
		return nil
	}
	deltas := make([]repo.ForwardTrafficNodeDelta, 0, len(topology.Nodes))
	for _, trafficNode := range topology.Nodes {
		deltas = append(deltas, repo.ForwardTrafficNodeDelta{
			NodeID:   trafficNode.NodeID,
			InFlow:   int64(math.Round(float64(rawIn) * trafficNode.TrafficRatio)),
			OutFlow:  int64(math.Round(float64(rawOut) * trafficNode.TrafficRatio)),
			IsRemote: trafficNode.IsRemote,
		})
	}
	return deltas
}

func (h *Handler) reportAuthoritativeFlowToProviders(topology *repo.ForwardTrafficTopology, item flowItem) {
	if h == nil || topology == nil || item.D+item.U <= 0 {
		return
	}
	type remoteNodeFlow struct {
		nodeID  int64
		inFlow  int64
		outFlow int64
	}
	remoteNodes := make([]remoteNodeFlow, 0, len(topology.Nodes))
	for _, trafficNode := range topology.Nodes {
		if !trafficNode.IsRemote || trafficNode.NodeID <= 0 {
			continue
		}
		remoteNodes = append(remoteNodes, remoteNodeFlow{
			nodeID:  trafficNode.NodeID,
			inFlow:  int64(math.Round(float64(item.D) * trafficNode.TrafficRatio)),
			outFlow: int64(math.Round(float64(item.U) * trafficNode.TrafficRatio)),
		})
	}
	var wg sync.WaitGroup
	for _, node := range remoteNodes {
		snapshot, err := h.repo.GetAuthoritativeNodeFlowSnapshot(node.nodeID)
		if err != nil || snapshot == nil || snapshot.RemoteURL == "" || snapshot.RemoteToken == "" {
			continue
		}
		wg.Add(1)
		go func(current repo.AuthoritativeNodeFlowSnapshot, inFlow, outFlow int64) {
			defer wg.Done()
			if err := h.reportAuthoritativeNodeFlowSnapshot(current, inFlow, outFlow); err != nil {
				log.Printf("[flow] report authoritative share flow failed node=%d: %v", current.NodeID, err)
			}
		}(*snapshot, node.inFlow, node.outFlow)
	}
	wg.Wait()
}

func (h *Handler) reportAuthoritativeNodeFlowSnapshot(snapshot repo.AuthoritativeNodeFlowSnapshot, inFlow, outFlow int64) error {
	if h == nil || snapshot.NodeID <= 0 || snapshot.RemoteURL == "" || snapshot.RemoteToken == "" {
		return errors.New("invalid authoritative flow snapshot")
	}
	fc := federationclient.NewFederationClientWithTimeout(5 * time.Second)
	return fc.ReportAuthoritativeFlow(snapshot.RemoteURL, snapshot.RemoteToken, h.federationLocalDomain(), federationclient.RuntimeAuthoritativeFlowRequest{
		InFlow:       inFlow,
		OutFlow:      outFlow,
		TotalInFlow:  snapshot.TotalInFlow,
		TotalOutFlow: snapshot.TotalOutFlow,
		Epoch:        snapshot.Epoch,
	})
}

func parseRemShareServiceName(serviceName string) (int64, bool) {
	const prefix = "rem_s"
	serviceName = strings.TrimSpace(serviceName)
	if !strings.HasPrefix(serviceName, prefix) {
		return 0, false
	}
	raw := strings.TrimPrefix(serviceName, prefix)
	idx := strings.IndexByte(raw, '_')
	if idx <= 0 {
		return 0, false
	}
	shareID, err := strconv.ParseInt(raw[:idx], 10, 64)
	if err != nil || shareID <= 0 {
		return 0, false
	}
	return shareID, true
}

func parseRelayedForwardServiceName(serviceName string) (int64, int64, int64, int64, bool) {
	shareID, ok := parseRemShareServiceName(serviceName)
	if !ok {
		return 0, 0, 0, 0, false
	}
	parts := strings.Split(strings.TrimPrefix(serviceName, fmt.Sprintf("rem_s%d_", shareID)), "_")
	if len(parts) < 3 {
		return 0, 0, 0, 0, false
	}
	forwardID, err1 := strconv.ParseInt(parts[0], 10, 64)
	userID, err2 := strconv.ParseInt(parts[1], 10, 64)
	userTunnelID, err3 := strconv.ParseInt(parts[2], 10, 64)
	if err1 != nil || err2 != nil || err3 != nil || forwardID <= 0 || userID <= 0 {
		return 0, 0, 0, 0, false
	}
	return shareID, forwardID, userID, userTunnelID, true
}

func parseFlowServiceIDs(serviceName string) (int64, int64, int64, bool) {
	parts := strings.Split(serviceName, "_")
	if len(parts) < 3 {
		return 0, 0, 0, false
	}

	forwardID, err1 := strconv.ParseInt(parts[0], 10, 64)
	userID, err2 := strconv.ParseInt(parts[1], 10, 64)
	userTunnelID, err3 := strconv.ParseInt(parts[2], 10, 64)
	if err1 != nil || err2 != nil || err3 != nil || forwardID <= 0 || userID <= 0 {
		return 0, 0, 0, false
	}

	return forwardID, userID, userTunnelID, true
}

func parsePeerShareRuntimeServiceID(serviceName string) (int64, bool) {
	const prefix = "fed_svc_"
	if !strings.HasPrefix(serviceName, prefix) {
		return 0, false
	}
	raw := strings.TrimPrefix(serviceName, prefix)
	if raw == "" {
		return 0, false
	}
	parts := strings.SplitN(raw, "_", 2)
	runtimeID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || runtimeID <= 0 {
		return 0, false
	}
	return runtimeID, true
}

func parsePeerShareInfoFromFederationTunnelName(tunnelName string) (int64, int, bool) {
	tunnelName = strings.TrimSpace(tunnelName)
	if !strings.HasPrefix(tunnelName, "Share-") {
		return 0, 0, false
	}
	raw := strings.TrimPrefix(tunnelName, "Share-")
	idx := strings.Index(raw, "-Port-")
	if idx <= 0 {
		return 0, 0, false
	}
	shareID, err := strconv.ParseInt(raw[:idx], 10, 64)
	if err != nil || shareID <= 0 {
		return 0, 0, false
	}
	portValue := strings.TrimSpace(raw[idx+len("-Port-"):])
	port, err := strconv.Atoi(portValue)
	if err != nil || port <= 0 {
		return 0, 0, false
	}
	return shareID, port, true
}

func parsePeerShareIDFromFederationTunnelName(tunnelName string) (int64, bool) {
	tunnelName = strings.TrimSpace(tunnelName)
	if !strings.HasPrefix(tunnelName, "Share-") {
		return 0, false
	}
	raw := strings.TrimPrefix(tunnelName, "Share-")
	idx := strings.Index(raw, "-Port-")
	if idx <= 0 {
		return 0, false
	}
	shareID, err := strconv.ParseInt(raw[:idx], 10, 64)
	if err != nil || shareID <= 0 {
		return 0, false
	}
	return shareID, true
}

func (h *Handler) processPeerShareFlow(runtimeID int64, instanceID string, item flowItem) error {
	if h == nil || h.repo == nil || runtimeID <= 0 {
		return nil
	}
	runtime, err := h.repo.GetPeerShareRuntimeByID(runtimeID)
	if err != nil || runtime == nil || runtime.ShareID <= 0 || runtime.Status != 1 {
		return nil
	}

	delta := item.D + item.U
	if delta <= 0 {
		return nil
	}
	share, err := h.repo.GetPeerShare(runtime.ShareID)
	if err != nil || share == nil {
		return err
	}
	if share.ConsumerFlowAuthority == 1 {
		return nil
	}

	if err := h.repo.AddPeerShareFlow(runtime.ShareID, runtime.ID, instanceID, item.D, item.U, time.Now()); err != nil {
		return err
	}
	h.afterFlowCommit(func() { h.publishPeerShareEvent(runtime.ShareID, "flow_changed") })

	share, err = h.repo.GetPeerShare(runtime.ShareID)
	if err != nil || share == nil {
		return err
	}
	if !isPeerShareFlowExceeded(share) {
		return nil
	}
	h.afterFlowCommit(func() { h.enforcePeerShareFlowLimit(share.ID) })
	return nil
}

func (h *Handler) processPeerShareFlowFromForward(forwardID int64, nodeID int64, instanceID string, serviceName string, item flowItem) error {
	if h == nil || h.repo == nil || forwardID <= 0 {
		return nil
	}

	delta := item.D + item.U
	if delta <= 0 {
		return nil
	}

	forward, err := h.getForwardRecord(forwardID)
	if err != nil || forward == nil {
		// Forward not found in local database - might be a federation port-forward
		// Try to find by service name in peer_share_runtime
		return h.processPeerShareFlowByServiceName(nodeID, instanceID, serviceName, item)
	}
	tunnelName, err := h.repo.GetTunnelName(forward.TunnelID)
	if err != nil {
		return h.processPeerShareFlowByServiceName(nodeID, instanceID, serviceName, item)
	}
	shareID, port, ok := parsePeerShareInfoFromFederationTunnelName(tunnelName)
	if !ok {
		return h.processPeerShareFlowByServiceName(nodeID, instanceID, serviceName, item)
	}
	share, err := h.repo.GetPeerShare(shareID)
	if err != nil || share == nil || share.NodeID != nodeID {
		return h.processPeerShareFlowByServiceName(nodeID, instanceID, serviceName, item)
	}
	if share.ConsumerFlowAuthority == 1 {
		return nil
	}
	runtimeID := int64(0)
	if runtime, runtimeErr := h.repo.GetActiveForwardPeerShareRuntimeByPort(shareID, port); runtimeErr == nil && runtime != nil {
		runtimeID = runtime.ID
	}
	if err := h.repo.AddPeerShareFlow(shareID, runtimeID, instanceID, item.D, item.U, time.Now()); err != nil {
		return err
	}
	h.afterFlowCommit(func() { h.publishPeerShareEvent(shareID, "flow_changed") })

	updatedShare, err := h.repo.GetPeerShare(shareID)
	if err != nil || updatedShare == nil {
		return err
	}
	if !isPeerShareFlowExceeded(updatedShare) {
		return nil
	}
	h.afterFlowCommit(func() { h.enforcePeerShareFlowLimit(updatedShare.ID) })
	return nil
}

func normalizeForwardRuntimeServiceName(serviceName string) string {
	name := strings.TrimSpace(serviceName)
	if strings.HasSuffix(name, "_tcp") {
		return strings.TrimSuffix(name, "_tcp")
	}
	if strings.HasSuffix(name, "_udp") {
		return strings.TrimSuffix(name, "_udp")
	}
	return name
}

func (h *Handler) processPeerShareFlowByServiceName(nodeID int64, instanceID string, serviceName string, item flowItem) error {
	if h == nil || h.repo == nil || strings.TrimSpace(serviceName) == "" {
		return nil
	}

	delta := item.D + item.U
	if delta <= 0 {
		return nil
	}

	normalized := normalizeForwardRuntimeServiceName(serviceName)
	var runtimes []model.PeerShareRuntime
	var err error

	// Try node-scoped query first if nodeID is valid
	if nodeID > 0 {
		runtimes, err = h.repo.ListActiveForwardPeerShareRuntimesByNodeAndServiceName(nodeID, normalized)
		if err != nil {
			return err
		}
		if len(runtimes) == 0 && normalized != serviceName {
			runtimes, err = h.repo.ListActiveForwardPeerShareRuntimesByNodeAndServiceName(nodeID, serviceName)
			if err != nil {
				return err
			}
		}
	}

	// Legacy uploads without a node ID can only be matched globally.
	if len(runtimes) == 0 && nodeID <= 0 {
		runtimes, err = h.repo.ListActiveForwardPeerShareRuntimesByServiceName(normalized)
		if err != nil {
			return err
		}
		if len(runtimes) == 0 && normalized != serviceName {
			runtimes, err = h.repo.ListActiveForwardPeerShareRuntimesByServiceName(serviceName)
			if err != nil {
				return err
			}
		}
	}

	if len(runtimes) != 1 {
		if len(runtimes) > 1 {
			log.Printf("WARN: ambiguous peer share runtime match for service=%s nodeID=%d count=%d", serviceName, nodeID, len(runtimes))
		}
		return nil
	}
	runtime := runtimes[0]
	matchedShare, err := h.repo.GetPeerShare(runtime.ShareID)
	if err != nil || matchedShare == nil {
		return err
	}
	if matchedShare.ConsumerFlowAuthority == 1 {
		return nil
	}

	if err := h.repo.AddPeerShareFlow(runtime.ShareID, runtime.ID, instanceID, item.D, item.U, time.Now()); err != nil {
		return err
	}
	h.afterFlowCommit(func() { h.publishPeerShareEvent(runtime.ShareID, "flow_changed") })

	matchedShare, err = h.repo.GetPeerShare(runtime.ShareID)
	if err != nil || matchedShare == nil {
		return err
	}
	if isPeerShareFlowExceeded(matchedShare) {
		h.afterFlowCommit(func() { h.enforcePeerShareFlowLimit(matchedShare.ID) })
	}
	return nil
}

func (h *Handler) enforcePeerShareFlowLimit(shareID int64) {
	if h == nil || h.repo == nil || shareID <= 0 {
		return
	}
	if err := h.cleanupPeerShareRuntimes(shareID); err != nil {
		log.Printf("[flow] cleanup over-limit peer share failed share=%d: %v", shareID, err)
	}
}

func (h *Handler) enforceFlowPolicies(userID int64, userTunnelID int64) {
	now := time.Now().UnixMilli()

	if h.shouldPauseUser(userID, now) {
		h.pauseUserForwards(userID, now)
	}

	policy, err := h.getUserTunnelPolicy(userTunnelID)
	if err != nil || policy == nil {
		return
	}

	if shouldPauseUserTunnel(policy, now) {
		h.pauseUserTunnelForwards(policy.UserID, policy.TunnelID, now)
	}
}

func (h *Handler) ensureUserTunnelForwardAllowed(userID int64, tunnelID int64, now int64) error {
	if h == nil || h.repo == nil {
		return errors.New("invalid flow policy context")
	}
	if userID <= 0 || tunnelID <= 0 {
		return nil
	}

	user, err := h.repo.GetUserByID(userID)
	if err != nil {
		return err
	}
	if user == nil {
		return errors.New("用户不存在")
	}

	if user.Status != 1 {
		return errors.New("账号已禁用")
	}
	if user.ExpTime > 0 && user.ExpTime <= now {
		return errors.New("账号已过期")
	}

	flowLimit := user.Flow * bytesPerGB
	current := user.InFlow + user.OutFlow
	if flowLimit <= current {
		return errors.New("流量已超额，禁止开启转发")
	}
	if err := h.ensureUserForwardAllowedByQuota(userID, now); err != nil {
		return err
	}

	userTunnelID, _, _, err := h.resolveUserTunnelAndLimiter(userID, tunnelID)
	if err != nil {
		return err
	}
	if userTunnelID <= 0 {
		return nil
	}

	policy, err := h.getUserTunnelPolicy(userTunnelID)
	if err != nil {
		return err
	}
	if policy == nil {
		return nil
	}

	if policy.Status != 1 {
		return errors.New("该隧道已禁用")
	}
	if policy.ExpTime > 0 && policy.ExpTime <= now {
		return errors.New("该隧道已过期")
	}
	if policy.Flow > 0 {
		flowLimit := policy.Flow * bytesPerGB
		current := policy.InFlow + policy.OutFlow
		if flowLimit <= current {
			return errors.New("该隧道流量已超额")
		}
	}

	return nil
}

func (h *Handler) ensureForwardCountAvailable(userID, tunnelID int64) error {
	user, err := h.repo.GetUserByID(userID)
	if err != nil {
		return err
	}
	if user != nil && user.Num > 0 {
		count, err := h.repo.CountActiveForwardsByUser(userID)
		if err != nil {
			return err
		}
		if count >= int64(user.Num) {
			return errors.New("转发数量已达上限")
		}
	}
	_, _, num, _, _, _, _, _, status, err := h.repo.GetExistingUserTunnel(userID, tunnelID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if status == 1 && num > 0 {
		count, err := h.repo.CountActiveForwardsByUserTunnel(userID, tunnelID)
		if err != nil {
			return err
		}
		if count >= num {
			return errors.New("隧道转发数量已达上限")
		}
	}
	return nil
}

func (h *Handler) shouldPauseUser(userID int64, now int64) bool {
	user, err := h.repo.GetUserByID(userID)
	if err != nil || user == nil {
		return false
	}

	flowLimit := user.Flow * bytesPerGB
	current := user.InFlow + user.OutFlow
	if flowLimit <= current {
		return true
	}
	if user.ExpTime > 0 && user.ExpTime <= now {
		return true
	}
	return user.Status != 1
}

func shouldPauseUserTunnel(policy *userTunnelPolicy, now int64) bool {
	if policy == nil {
		return false
	}

	if policy.ExpTime > 0 && policy.ExpTime <= now {
		return true
	}
	if policy.Status != 1 {
		return true
	}
	if policy.Flow > 0 {
		flowLimit := policy.Flow * bytesPerGB
		current := policy.InFlow + policy.OutFlow
		if flowLimit <= current {
			return true
		}
	}
	return false
}

func (h *Handler) getUserTunnelPolicy(userTunnelID int64) (*userTunnelPolicy, error) {
	if userTunnelID <= 0 {
		return nil, nil
	}
	ut, err := h.repo.GetUserTunnelByID(userTunnelID)
	if err != nil {
		return nil, err
	}
	if ut == nil {
		return nil, nil
	}
	return &userTunnelPolicy{
		ID: ut.ID, UserID: ut.UserID, TunnelID: ut.TunnelID,
		Flow: ut.Flow, InFlow: ut.InFlow, OutFlow: ut.OutFlow,
		ExpTime: ut.ExpTime, Status: ut.Status,
	}, nil
}

func (h *Handler) pauseUserForwards(userID int64, now int64) {
	forwards, err := h.listActiveForwardsByUser(userID)
	if err != nil {
		return
	}
	h.pauseForwardRecords(forwards, now)
}

func (h *Handler) pauseUserTunnelForwards(userID int64, tunnelID int64, now int64) {
	forwards, err := h.listActiveForwardsByUserTunnel(userID, tunnelID)
	if err != nil {
		return
	}
	h.pauseForwardRecords(forwards, now)
}

func (h *Handler) pauseForwardRecords(forwards []forwardRecord, now int64) {
	for i := range forwards {
		forward := forwards[i]
		success := false
		if strings.EqualFold(forward.Mode, "nftables") {
			ports, _ := h.listForwardPorts(forward.ID)
			if err := h.deleteNftablesRules(&forward, ports); err != nil {
				log.Printf("pauseForwardRecords nftables %d failed: %v", forward.ID, err)
				continue
			}
			success = true
		} else {
			if err := h.controlForwardServices(&forward, "PauseService", false); err != nil {
				log.Printf("pauseForwardRecords PauseService %d failed: %v", forward.ID, err)
				continue
			}
			_ = h.controlForwardServices(&forward, "TerminateConnections", false)
			success = true
		}
		if success {
			if err := h.repo.UpdateForwardStatus(forward.ID, 0, now); err != nil {
				log.Printf("pauseForwardRecords UpdateForwardStatus %d failed: %v", forward.ID, err)
			}
			h.wsServer.ClearForwardMetrics(forward.ID)
		}
	}
}

func (h *Handler) listActiveForwardsByUser(userID int64) ([]forwardRecord, error) {
	return h.repo.ListActiveForwardsByUser(userID)
}

func (h *Handler) listActiveForwardsByUserTunnel(userID int64, tunnelID int64) ([]forwardRecord, error) {
	return h.repo.ListActiveForwardsByUserTunnel(userID, tunnelID)
}

func (h *Handler) listActiveForwardsByTunnel(tunnelID int64) ([]forwardRecord, error) {
	return h.repo.ListActiveForwardsByTunnel(tunnelID)
}

func (h *Handler) resumePausedForwardsByUser(userID int64, now int64) {
	paused, err := h.repo.ListPausedForwardsByUser(userID)
	if err != nil || len(paused) == 0 {
		return
	}
	for i := range paused {
		forward := paused[i]
		if err := h.ensureUserTunnelForwardAllowed(forward.UserID, forward.TunnelID, now); err != nil {
			continue
		}
		if strings.EqualFold(forward.Mode, "nftables") {
			if err := h.syncForwardServices(&forward, "UpdateService", true); err != nil {
				continue
			}
		} else {
			// 先确保服务在节点上存在，再恢复
			if err := h.syncForwardServices(&forward, "UpdateService", true); err != nil {
				continue
			}
			if err := h.controlForwardServices(&forward, "ResumeService", false); err != nil {
				continue
			}
		}
		_ = h.repo.UpdateForwardStatus(forward.ID, 1, now)
	}
}

func (h *Handler) cleanNodeConfigs(nodeID int64, rawConfig string) {
	if h == nil || h.repo == nil || nodeID <= 0 {
		return
	}
	if strings.TrimSpace(rawConfig) == "" {
		return
	}

	var snapshot gostConfigSnapshot
	if err := json.Unmarshal([]byte(rawConfig), &snapshot); err != nil {
		return
	}

	h.cleanOrphanedServices(nodeID, snapshot.Services)
	h.cleanOrphanedChains(nodeID, snapshot.Chains)
	h.cleanOrphanedLimiters(nodeID, snapshot.Limiters)
}

func (h *Handler) cleanOrphanedServices(nodeID int64, services []namedConfigItem) {
	runtimeServiceNames, err := h.repo.ListActiveForwardPeerShareRuntimeServiceNamesByNode(nodeID)
	if err != nil {
		return
	}
	minUpdatedTime := time.Now().Add(-10 * time.Minute).UnixMilli()
	hasUnboundForwardPeerRuntime, err := h.repo.HasRecentUnboundForwardPeerShareRuntimeOnNode(nodeID, minUpdatedTime)
	if err != nil {
		hasUnboundForwardPeerRuntime = false
	}
	runtimeServiceSet := make(map[string]struct{}, len(runtimeServiceNames))
	for _, serviceName := range runtimeServiceNames {
		serviceName = strings.TrimSpace(serviceName)
		if serviceName == "" {
			continue
		}
		runtimeServiceSet[serviceName] = struct{}{}
	}

	for _, item := range services {
		name := strings.TrimSpace(item.Name)
		if name == "" || name == "web_api" {
			continue
		}
		if strings.HasPrefix(name, "fed_svc_") {
			continue
		}
		normalizedName := normalizeForwardRuntimeServiceName(name)
		if _, ok := runtimeServiceSet[normalizedName]; ok {
			continue
		}
		if _, ok := runtimeServiceSet[name]; ok {
			continue
		}

		parts := strings.Split(name, "_")
		if len(parts) >= 3 {
			forwardID, err := strconv.ParseInt(parts[0], 10, 64)
			if err == nil && forwardID > 0 && hasUnboundForwardPeerRuntime {
				continue
			}
			if err == nil && forwardID > 0 && !h.forwardExists(forwardID) {
				_, _ = h.sendNodeCommand(nodeID, "DeleteService", map[string]interface{}{"services": []string{name, parts[0] + "_" + parts[1] + "_" + parts[2], parts[0] + "_" + parts[1] + "_" + parts[2] + "_tcp", parts[0] + "_" + parts[1] + "_" + parts[2] + "_udp"}}, false, true)
				continue
			}
		}
		suffix := parts[len(parts)-1]

		switch suffix {
		case "tls":
			tunnelID, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil || tunnelID <= 0 || h.tunnelExists(tunnelID) {
				continue
			}
			_, _ = h.sendNodeCommand(nodeID, "DeleteService", map[string]interface{}{"services": []string{name}}, false, true)
		case "tcp":
			if len(parts) < 4 {
				continue
			}
			forwardID, err := strconv.ParseInt(parts[0], 10, 64)
			if err == nil && forwardID > 0 && hasUnboundForwardPeerRuntime {
				continue
			}
			if err != nil || forwardID <= 0 || h.forwardExists(forwardID) {
				continue
			}
			base := strings.TrimSuffix(name, "_tcp")
			_, _ = h.sendNodeCommand(nodeID, "DeleteService", map[string]interface{}{"services": []string{base + "_tcp", base + "_udp"}}, false, true)
		}
	}
}

func (h *Handler) cleanOrphanedChains(nodeID int64, chains []namedConfigItem) {
	for _, item := range chains {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}

		idx := strings.LastIndex(name, "_")
		if idx <= 0 || idx >= len(name)-1 {
			continue
		}
		tunnelID, err := strconv.ParseInt(name[idx+1:], 10, 64)
		if err != nil || tunnelID <= 0 || h.tunnelExists(tunnelID) {
			continue
		}
		_, _ = h.sendNodeCommand(nodeID, "DeleteChains", map[string]interface{}{"chain": name}, false, true)
	}
}

func (h *Handler) cleanOrphanedLimiters(nodeID int64, limiters []namedConfigItem) {
	node, err := h.getNodeRecord(nodeID)
	if err != nil || !shouldManageLimiterOnNode(node) {
		return
	}
	for _, item := range limiters {
		name := strings.TrimSpace(item.Name)
		if name == "" || h.speedLimiterExists(name) {
			continue
		}
		_, _ = h.sendNodeCommand(nodeID, "DeleteLimiters", map[string]interface{}{"limiter": name}, false, true)
	}
}

func (h *Handler) tunnelExists(tunnelID int64) bool {
	ok, _ := h.repo.TunnelExists(tunnelID)
	return ok
}

func (h *Handler) forwardExists(forwardID int64) bool {
	ok, _ := h.repo.ForwardExists(forwardID)
	return ok
}

func (h *Handler) speedLimiterExists(name string) bool {
	if name == "" {
		return false
	}
	if strings.HasPrefix(name, "forward_") && strings.HasSuffix(name, "_speed") {
		forwardIDText := strings.TrimSuffix(strings.TrimPrefix(name, "forward_"), "_speed")
		forwardID, err := strconv.ParseInt(forwardIDText, 10, 64)
		if err != nil || forwardID <= 0 {
			return false
		}
		forward, err := h.getForwardRecord(forwardID)
		return err == nil && forward != nil && forward.SpeedLimitEnabled && forward.SpeedLimit > 0
	}
	if strings.HasPrefix(name, "user_tunnel_") && strings.HasSuffix(name, "_ceiling") {
		idText := strings.TrimSuffix(strings.TrimPrefix(name, "user_tunnel_"), "_ceiling")
		id, err := strconv.ParseInt(idText, 10, 64)
		if err != nil || id <= 0 {
			return false
		}
		ok, _ := h.repo.UserTunnelCeilingExists(id)
		return ok
	}
	id, err := strconv.ParseInt(name, 10, 64)
	if err != nil {
		return false
	}
	ok, _ := h.repo.SpeedLimitExists(id)
	return ok
}

// ✅ 新增：检查 Forward 流量限制
func (h *Handler) enforceForwardTrafficLimit(forwardID int64) {
	if h == nil || h.repo == nil || forwardID <= 0 {
		return
	}

	forward, err := h.getForwardRecord(forwardID)
	if err != nil || forward == nil || forward.TrafficLimit <= 0 {
		return // 未设置流量限制
	}

	// AddFlow has already persisted the current report.
	totalFlow := forward.InFlow + forward.OutFlow
	limitBytes := forward.TrafficLimit * bytesPerGB

	if totalFlow >= limitBytes {
		// 流量超限，暂停转发
		if pauseErr := h.pauseForward(forwardID, "流量超限"); pauseErr != nil {
			log.Printf("ERROR: pauseForward %d failed: %v", forwardID, pauseErr)
		} else {
			log.Printf("Forward %d paused: traffic limit exceeded (%.2f GB / %.2f GB)",
				forwardID, float64(totalFlow)/1e9, float64(limitBytes)/1e9)

			// 归零流量 + 记录日志
			if resetErr := h.repo.ResetForwardTrafficWithLog(forwardID, &repo.ForwardTrafficResetLogCreateParams{
				ForwardID: forwardID, ForwardName: forward.Name, UserID: forward.UserID, UserName: forward.UserName,
				ResetTime: time.Now().UnixMilli(), OperatorID: 1, OperatorName: "system", Reason: "流量超限",
			}); resetErr != nil {
				log.Printf("ERROR: reset forward %d traffic failed: %v", forwardID, resetErr)
			}
		}
	}
}

// ✅ 新增：暂停 Forward 规则
func (h *Handler) pauseForward(forwardID int64, reason string) error {
	if h == nil || h.repo == nil {
		return errors.New("invalid handler context")
	}

	forward, err := h.getForwardRecord(forwardID)
	if err != nil {
		return fmt.Errorf("get forward record: %w", err)
	}

	now := time.Now().UnixMilli()
	h.pauseForwardRecords([]forwardRecord{*forward}, now)

	log.Printf("Forward %d paused: %s", forwardID, reason)
	return nil
}

func (h *Handler) sendFlowRelayOutbox(item *model.FlowRelayOutbox) error {
	if h == nil || h.repo == nil || item == nil {
		return errors.New("invalid flow relay context")
	}
	target, err := h.repo.GetFlowRelayTarget(item.ShareID)
	if err != nil {
		return err
	}
	if target == nil || target.URL == "" || target.Token == "" {
		return errors.New("flow relay target is unavailable")
	}
	items := []map[string]interface{}{{"n": item.ServiceName, "u": item.Up, "d": item.Down, "i": item.InstanceID}}
	payload, err := json.Marshal(map[string]interface{}{"reportId": item.EventID, "items": items})
	if err != nil {
		return err
	}
	targetURL := target.URL
	if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
		targetURL = "https://" + targetURL
	}
	targetURL = strings.TrimRight(targetURL, "/") + "/flow/relay?secret=" + url.QueryEscape(target.Token)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(targetURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("flow relay returned status %d", resp.StatusCode)
	}
	return nil
}

func (h *Handler) tryFlowRelayOutbox(eventID string) {
	item, err := h.repo.GetFlowRelayOutbox(eventID)
	if err != nil || item == nil {
		if err != nil {
			log.Printf("[flow relay] load outbox failed event=%s: %v", eventID, err)
		}
		return
	}
	if err := h.sendFlowRelayOutbox(item); err == nil {
		if deleteErr := h.repo.DeleteFlowRelayOutbox(item.EventID); deleteErr != nil {
			log.Printf("[flow relay] delete outbox failed event=%s: %v", item.EventID, deleteErr)
		}
		return
	} else {
		attempt := item.Attempt + 1
		delay := 10 * time.Second
		for i := 1; i < attempt && delay < time.Hour; i++ {
			delay *= 2
		}
		if delay > time.Hour {
			delay = time.Hour
		}
		if retryErr := h.repo.RescheduleFlowRelayOutbox(item.EventID, attempt, time.Now().Add(delay).UnixMilli()); retryErr != nil {
			log.Printf("[flow relay] reschedule failed event=%s: %v", item.EventID, retryErr)
		}
		log.Printf("[flow relay] delivery failed event=%s share=%d attempt=%d: %v", item.EventID, item.ShareID, attempt, err)
	}
}
