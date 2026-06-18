package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"go-backend/internal/store/repo"
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

func (h *Handler) processFlowItem(nodeID int64, item flowItem) {
	serviceName := strings.TrimSpace(item.N)
	if serviceName == "" || serviceName == "web_api" {
		return
	}

	forwardID, userID, userTunnelID, ok := parseFlowServiceIDs(serviceName)
	if ok {
		inFlow, outFlow := h.scaleFlowByTunnel(forwardID, item.D, item.U)
		if err := h.repo.AddFlow(forwardID, userID, userTunnelID, inFlow, outFlow); err != nil {
			log.Printf("[flow] AddFlow failed forward=%d user=%d: %v", forwardID, userID, err)
		}
		if quota, quotaErr := h.repo.AddUserQuotaUsage(userID, inFlow+outFlow, time.Now()); quotaErr == nil {
			h.enforceUserQuotaIfNeeded(userID, quota)
		}

		h.enforceForwardTrafficLimit(forwardID, inFlow, outFlow)

		if userTunnelID > 0 {
			h.enforceFlowPolicies(userID, userTunnelID)
		}
		return
	}
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

func (h *Handler) scaleFlowByTunnel(forwardID int64, inFlow int64, outFlow int64) (int64, int64) {
	forward, err := h.getForwardRecord(forwardID)
	if err != nil || forward == nil {
		return inFlow, outFlow
	}

	tunnel, err := h.getTunnelRecord(forward.TunnelID)
	if err != nil || tunnel == nil {
		return inFlow, outFlow
	}

	flowMode := tunnel.Flow
	if flowMode <= 0 {
		flowMode = 1
	}
	scaledIn := int64(float64(inFlow) * tunnel.TrafficRatio * float64(flowMode))
	scaledOut := int64(float64(outFlow) * tunnel.TrafficRatio * float64(flowMode))
	return scaledIn, scaledOut
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
	if flowLimit < current {
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

func (h *Handler) shouldPauseUser(userID int64, now int64) bool {
	user, err := h.repo.GetUserByID(userID)
	if err != nil || user == nil {
		return false
	}

	flowLimit := user.Flow * bytesPerGB
	current := user.InFlow + user.OutFlow
	if flowLimit < current {
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
		if strings.EqualFold(forward.Mode, "nftables") {
			ports, _ := h.listForwardPorts(forward.ID)
			_ = h.deleteNftablesRules(&forward, ports)
		} else {
			_ = h.controlForwardServices(&forward, "PauseService", false)
			_ = h.controlForwardServices(&forward, "TerminateConnections", false)
		}
		_ = h.repo.UpdateForwardStatus(forward.ID, 0, now)
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
	for _, item := range services {
		name := strings.TrimSpace(item.Name)
		if name == "" || name == "web_api" {
			continue
		}

		parts := strings.Split(name, "_")
		if len(parts) >= 3 {
			forwardID, err := strconv.ParseInt(parts[0], 10, 64)
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
	id, err := strconv.ParseInt(name, 10, 64)
	if err != nil {
		return false
	}
	ok, _ := h.repo.SpeedLimitExists(id)
	return ok
}

// ✅ 新增：检查 Forward 流量限制
func (h *Handler) enforceForwardTrafficLimit(forwardID int64, inFlow, outFlow int64) {
	if h == nil || h.repo == nil || forwardID <= 0 {
		return
	}

	forward, err := h.getForwardRecord(forwardID)
	if err != nil || forward == nil || forward.TrafficLimit <= 0 {
		return // 未设置流量限制
	}

	// 计算累计流量（包含本次上报）
	totalFlow := forward.InFlow + forward.OutFlow + inFlow + outFlow
	limitBytes := forward.TrafficLimit * bytesPerGB

	if totalFlow >= limitBytes {
		// 流量超限，暂停转发
		if pauseErr := h.pauseForward(forwardID, "流量超限"); pauseErr != nil {
			log.Printf("ERROR: pauseForward %d failed: %v", forwardID, pauseErr)
		} else {
			log.Printf("Forward %d paused: traffic limit exceeded (%.2f GB / %.2f GB)",
				forwardID, float64(totalFlow)/1e9, float64(limitBytes)/1e9)

			// 归零流量 + 记录日志
			inFlowBefore := forward.InFlow
			outFlowBefore := forward.OutFlow
			if resetErr := h.repo.ResetForwardTraffic(forwardID); resetErr != nil {
				log.Printf("ERROR: reset forward %d traffic failed: %v", forwardID, resetErr)
			} else {
				_ = h.repo.CreateForwardTrafficResetLog(&repo.ForwardTrafficResetLogCreateParams{
					ForwardID:     forwardID,
					ForwardName:   forward.Name,
					UserID:        forward.UserID,
					UserName:      forward.UserName,
					ResetTime:     time.Now().UnixMilli(),
					InFlowBefore:  inFlowBefore,
					OutFlowBefore: outFlowBefore,
					OperatorID:    1,
					OperatorName:  "system",
					Reason:        "流量超限",
				})
			}
		}
	}
}

// ✅ 新增：暂停 Forward 规则
func (h *Handler) pauseForward(forwardID int64, reason string) error {
	if h == nil || h.repo == nil {
		return errors.New("invalid handler context")
	}

	// 更新数据库状态
	now := time.Now().UnixMilli()
	if err := h.repo.UpdateForwardStatus(forwardID, 0, now); err != nil {
		return fmt.Errorf("update forward status: %w", err)
	}

	// 获取 Forward 信息
	forward, err := h.getForwardRecord(forwardID)
	if err != nil {
		return fmt.Errorf("get forward record: %w", err)
	}

	// 复用 pauseForwardRecords 的完整逻辑（支持 nftables 和 GOST 模式）
	h.pauseForwardRecords([]forwardRecord{*forward}, now)

	log.Printf("Forward %d paused: %s", forwardID, reason)
	return nil
}
