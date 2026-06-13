package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go-backend/internal/http/client"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
	"go-backend/internal/ws"
)

var errForwardNotFound = errors.New("forward not found")

type forwardRecord = model.ForwardRecord
type tunnelRecord = model.TunnelRecord
type forwardPortRecord = model.ForwardPortRecord
type nodeRecord = model.NodeRecord

type chainNodeRecord = model.ChainNodeRecord

type diagnosisTarget struct {
	Address string
	IP      string
	Port    int
}

type diagnosisWorkItem struct {
	fromNodeID    int64
	targetIP      string
	targetPort    int
	description   string
	metadata      map[string]interface{}
	toNode        chainNodeRecord
	hasChainHop   bool
	ipPreference  string
	connectIpType string
}

type diagnosisExecOptions struct {
	commandTimeout time.Duration
	pingTimeoutMS  int
	pingCount      int
	timeoutMessage string
}

type diagnosisProgress struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
	Success   int `json:"success"`
	Failed    int `json:"failed"`
}

type diagnosisItemEmitter func(index int, item map[string]interface{}, progress diagnosisProgress)

func (h *Handler) buildDiagnosisStreamStartItems(workItems []diagnosisWorkItem) []map[string]interface{} {
	if len(workItems) == 0 {
		return []map[string]interface{}{}
	}

	nodeCache := map[int64]*nodeRecord{}
	items := make([]map[string]interface{}, 0, len(workItems))
	for _, workItem := range workItems {
		targetIP := strings.TrimSpace(workItem.targetIP)
		targetPort := workItem.targetPort
		if workItem.hasChainHop {
			fromNode, _ := h.cachedNode(nodeCache, workItem.fromNodeID)
			targetNode, err := h.cachedNode(nodeCache, workItem.toNode.NodeID)
			if err == nil {
				resolvedIP, resolvedPort, resolveErr := resolveChainProbeTarget(fromNode, targetNode, workItem.toNode.Port, workItem.ipPreference, workItem.connectIpType)
				if resolveErr == nil {
					targetIP = resolvedIP
					targetPort = resolvedPort
				}
			}
		}
		if targetPort <= 0 {
			targetPort = 443
		}

		// For exitTest items with empty targetIP, use the first rotation target for stream start display
		if targetIP == "" && workItem.metadata["exitTest"] == true && len(exitTestTargets) > 0 {
			targetIP = exitTestTargets[0].host
		}

		nodeName := fmt.Sprintf("node_%d", workItem.fromNodeID)
		if node, err := h.cachedNode(nodeCache, workItem.fromNodeID); err == nil && strings.TrimSpace(node.Name) != "" {
			nodeName = node.Name
		}

		item := map[string]interface{}{
			"success":     false,
			"diagnosing":  true,
			"description": workItem.description,
			"nodeName":    nodeName,
			"nodeId":      strconv.FormatInt(workItem.fromNodeID, 10),
			"targetIp":    targetIP,
			"targetPort":  targetPort,
			"message":     "诊断中...",
		}
		for key, value := range workItem.metadata {
			item[key] = value
		}
		items = append(items, item)
	}

	return items
}

const diagnosisMaxConcurrency = 8

const (
	defaultNodeCommandTimeout  = 6 * time.Second
	diagnosisCommandTimeout    = 30 * time.Second
	diagnosisRequestTimeout    = 2 * time.Minute
	diagnosisCommandTimeoutMsg = "诊断超时（30秒）"
	diagnosisRequestTimeoutMsg = "诊断超时（2分钟）"
)

const exitTestCommandTimeout = 18 * time.Second
const exitTestPingCount = 3

var exitTestTargets = []struct {
	name   string
	host   string
	port   int
}{
	{"www.google.com", "www.google.com", 443},
	{"www.bing.com", "www.bing.com", 443},
	{"www.cloudflare.com", "www.cloudflare.com", 443},
}

func (h *Handler) resolveForwardAccess(r *http.Request, forwardID int64) (*forwardRecord, int64, int, error) {
	userID, roleID, err := userRoleFromRequest(r)
	if err != nil {
		return nil, 0, 0, err
	}
	forward, err := h.ensureForwardAccessByActor(userID, roleID, forwardID)
	if err != nil {
		return nil, userID, roleID, err
	}
	return forward, userID, roleID, nil
}

func (h *Handler) ensureForwardAccessByActor(actorUserID int64, actorRole int, forwardID int64) (*forwardRecord, error) {
	forward, err := h.getForwardRecord(forwardID)
	if err != nil {
		return nil, err
	}
	if actorRole != 0 && forward.UserID != actorUserID {
		return nil, errForwardNotFound
	}
	return forward, nil
}

func (h *Handler) ensureTunnelPermission(userID int64, roleID int, tunnelID int64) error {
	if roleID == 0 {
		return nil
	}
	ok, err := h.repo.UserTunnelExistsByUserAndTunnel(userID, tunnelID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("你没有该隧道的权限")
	}
	return nil
}

func (h *Handler) getForwardRecord(forwardID int64) (*forwardRecord, error) {
	fr, err := h.repo.GetForwardRecord(forwardID)
	if err != nil {
		return nil, err
	}
	if fr == nil {
		return nil, errForwardNotFound
	}
	return fr, nil
}

func (h *Handler) getTunnelRecord(tunnelID int64) (*tunnelRecord, error) {
	tr, err := h.repo.GetTunnelRecord(tunnelID)
	if err != nil {
		return nil, err
	}
	if tr == nil {
		return nil, errors.New("隧道不存在")
	}
	return tr, nil
}

func (h *Handler) listForwardsByTunnel(tunnelID int64) ([]forwardRecord, error) {
	return h.repo.ListForwardsByTunnel(tunnelID)
}

func (h *Handler) listForwardPorts(forwardID int64) ([]forwardPortRecord, error) {
	return h.repo.ListForwardPorts(forwardID)
}

func (h *Handler) isTunnelSelectedTLSProtocol(tunnelID int64) (bool, error) {
	protocol, err := h.repo.GetTunnelOutProtocol(tunnelID)
	if err != nil {
		return false, err
	}
	return isTLSTunnelProtocol(protocol), nil
}

func (h *Handler) getNodeRecord(nodeID int64) (*nodeRecord, error) {
	n, err := h.repo.GetNodeRecord(nodeID)
	if err != nil {
		return nil, err
	}
	if n == nil {
		return nil, errors.New("节点不存在")
	}
	return n, nil
}

func (h *Handler) resolveUserTunnelAndLimiter(userID, tunnelID int64) (int64, *int64, *int, error) {
	info, err := h.repo.ResolveUserTunnelAndLimiter(userID, tunnelID)
	if err != nil {
		return 0, nil, nil, err
	}
	if info == nil {
		return 0, nil, nil, nil
	}
	return info.UserTunnelID, info.LimiterID, info.Speed, nil
}

func (h *Handler) listUserTunnelIDs(userID, tunnelID int64) ([]int64, error) {
	return h.repo.ListUserTunnelIDs(userID, tunnelID)
}

func (h *Handler) listUserTunnelIDsByUser(userID int64) ([]int64, error) {
	return h.repo.ListUserTunnelIDsByUser(userID)
}

func (h *Handler) syncForwardServices(forward *forwardRecord, method string, allowFallbackAdd bool) error {
	_, err := h.syncForwardServicesWithWarnings(forward, method, allowFallbackAdd)
	return err
}

func (h *Handler) syncForwardServicesWithWarnings(forward *forwardRecord, method string, allowFallbackAdd bool) ([]string, error) {
	if h == nil || forward == nil {
		return nil, errors.New("invalid forward sync context")
	}

	tunnel, err := h.getTunnelRecord(forward.TunnelID)
	if err != nil {
		return nil, err
	}
	// nftables mode handling
	ports, err := h.listForwardPorts(forward.ID)
	if err != nil {
		return nil, err
	}
	if len(ports) == 0 {
		return nil, errors.New("转发入口端口不存在")
	}

	warnings := make([]string, 0)

	// Resolve user tunnel first so runtime service name can carry the real user_tunnel id.
	userTunnelID, utLimiterID, utSpeed, err := h.resolveUserTunnelAndLimiter(forward.UserID, forward.TunnelID)
	if err != nil {
		return nil, err
	}

	// Determine limiter from forward's SpeedID first, fallback to UserTunnel's limiter
	var limiterID *int64
	var speed *int

	if forward.SpeedID.Valid && forward.SpeedID.Int64 > 0 {
		// Forward has its own speed limit
		speedVal, err := h.repo.GetSpeedLimitSpeed(forward.SpeedID.Int64)
		if err == nil && speedVal > 0 {
			limiterID = &forward.SpeedID.Int64
			speed = &speedVal
		}
	}

	if limiterID == nil {
		// Fall back to UserTunnel speed limit
		limiterID = utLimiterID
		speed = utSpeed
	}

	// nftables mode branch
	if strings.EqualFold(forward.Mode, "nftables") {
		fmt.Printf("[nft.debug] syncForwardServicesWithWarnings: nft mode branch, forwardID=%d\n", forward.ID)
		return nil, h.syncNftablesRules(forward, tunnel, ports, userTunnelID, speed)
	}
	if tier, _ := middleware.GetLicenseTier(); tier == middleware.TierFree && isPremiumForwardMode(forward.Mode) {
		return nil, ensureForwardModeAllowedForTier(tier, forward.Mode)
	}
	if strings.EqualFold(forward.Mode, forwardModeSDWAN) && tunnel != nil && tunnel.Type == 2 {
		return h.syncSDWANChainForwardServicesWithWarnings(forward, tunnel, ports, userTunnelID)
	}

	// ✅ 动态限速器名称
	var dynamicLimiterName string
	if forward.SpeedLimitEnabled && forward.SpeedLimit > 0 {
		dynamicLimiterName = fmt.Sprintf("forward_%d_speed", forward.ID)
	}
	serviceBase := buildForwardServiceBaseWithResolvedUserTunnel(forward.ID, forward.UserID, userTunnelID)
	tunnelTLSProtocol, err := h.isTunnelSelectedTLSProtocol(forward.TunnelID)
	if err != nil {
		return nil, err
	}

	for _, fp := range ports {
		// ✅ 应用动态限速器
		if dynamicLimiterName != "" {
			if err := h.ensureDynamicLimiterOnNode(fp.NodeID, dynamicLimiterName, forward.SpeedLimit); err != nil {
				if isNodeOfflineOrTimeoutError(err) {
					node, _ := h.getNodeRecord(fp.NodeID)
					nodeName := fmt.Sprintf("%d", fp.NodeID)
					if node != nil && strings.TrimSpace(node.Name) != "" {
						nodeName = strings.TrimSpace(node.Name)
					}
					warnings = append(warnings, fmt.Sprintf("节点 %s 不在线，已跳过下发", nodeName))
				} else {
					return nil, err
				}
			}
		} else if limiterID != nil && speed != nil {
			// 旧的限速逻辑
			if err := h.ensureLimiterOnNode(fp.NodeID, *limiterID, *speed); err != nil {
				if isNodeOfflineOrTimeoutError(err) {
					node, _ := h.getNodeRecord(fp.NodeID)
					nodeName := fmt.Sprintf("%d", fp.NodeID)
					if node != nil && strings.TrimSpace(node.Name) != "" {
						nodeName = strings.TrimSpace(node.Name)
					}
					warnings = append(warnings, fmt.Sprintf("节点 %s 不在线，已跳过下发", nodeName))
					continue
				}
				return nil, err
			}
		}

		node, err := h.getNodeRecord(fp.NodeID)
		if err != nil {
			return nil, err
		}
		services := buildForwardServiceConfigs(serviceBase, forward, tunnel, node, fp.Port, strings.TrimSpace(fp.InIP), limiterID, tunnelTLSProtocol)
		_, err = h.sendNodeCommand(node.ID, method, services, true, false)
		if err != nil && allowFallbackAdd && method == "UpdateService" {
			if isNotFoundError(err) {
				if delErr := h.deleteForwardServicesOnNode(forward, node.ID); delErr != nil && !isNotFoundError(delErr) {
					return warnings, fmt.Errorf("节点 %s 清理旧服务失败: %w", node.Name, delErr)
				}
			}
			_, err = h.sendNodeCommand(node.ID, "AddService", services, true, false)
		}
		if err != nil && strings.EqualFold(strings.TrimSpace(method), "UpdateService") && isAddressAlreadyInUseError(err) {
			err = h.rebindForwardServiceOnSelfOccupiedPort(forward, node, fp.Port, services)
		}
		if err != nil && strings.EqualFold(strings.TrimSpace(method), "UpdateService") && isCannotAssignRequestedAddressError(err) {
			var warning string
			warning, err = h.fallbackForwardPortToDefaultBind(forward, tunnel, node, fp, serviceBase, limiterID, tunnelTLSProtocol)
			if err == nil && warning != "" {
				warnings = append(warnings, warning)
			}
		}
		// When a node is offline, skip it with a warning instead of failing.
		// This lets users modify forward rules even when some entry nodes are down.
		if err != nil && isNodeOfflineOrTimeoutError(err) {
			warnings = append(warnings, fmt.Sprintf("节点 %s 不在线，已跳过下发", node.Name))
			continue
		}
		if err != nil {
			return warnings, fmt.Errorf("节点 %s 下发失败: %w", node.Name, err)
		}
	}

	// Keep paused forwards paused after UpdateService/AddService, since agent-side UpdateService
	// always restarts services.
	if forward.Status != 1 {
		if strings.EqualFold(forward.Mode, "nftables") {
			ports, _ := h.listForwardPorts(forward.ID)
			if err := h.deleteNftablesRules(forward, ports); err != nil {
				return warnings, fmt.Errorf("暂停nftables转发失败: %w", err)
			}
		} else {
			if err := h.controlForwardServices(forward, "PauseService", false); err != nil {
				return warnings, err
			}
		}
	}
	return warnings, nil
}

func (h *Handler) fallbackForwardPortToDefaultBind(forward *forwardRecord, tunnel *tunnelRecord, node *nodeRecord, fp forwardPortRecord, serviceBase string, limiterID *int64, tunnelTLSProtocol bool) (string, error) {
	if h == nil || forward == nil || tunnel == nil || node == nil {
		return "", errors.New("invalid bind fallback context")
	}
	if fp.Port <= 0 {
		return "", errors.New("invalid forward port")
	}
	explicitBindIP := strings.TrimSpace(fp.InIP)
	if explicitBindIP == "" {
		return "", errors.New("default bind address cannot be assigned")
	}

	if err := h.deleteForwardServicesOnNode(forward, node.ID); err != nil {
		return "", err
	}

	time.Sleep(150 * time.Millisecond)
	defaultServices := buildForwardServiceConfigs(serviceBase, forward, tunnel, node, fp.Port, "", limiterID, tunnelTLSProtocol)
	if _, err := h.sendNodeCommand(node.ID, "AddService", defaultServices, true, false); err != nil {
		return "", err
	}
	if err := h.repo.UpdateForwardPortBindIP(forward.ID, node.ID, fp.Port, ""); err != nil {
		return "", err
	}

	warning := fmt.Sprintf("节点 %s 监听IP %s 不在主机网卡地址中，已自动回退为默认监听IP", strings.TrimSpace(node.Name), explicitBindIP)
	return warning, nil
}

func (h *Handler) rebindForwardServiceOnSelfOccupiedPort(forward *forwardRecord, node *nodeRecord, port int, services []map[string]interface{}) error {
	if h == nil || forward == nil || node == nil {
		return errors.New("invalid self-occupy rebind context")
	}
	if port <= 0 {
		return errors.New("invalid forward port")
	}

	hasOtherForward, err := h.repo.HasOtherForwardOnNodePort(node.ID, port, forward.ID)
	if err != nil {
		return err
	}
	if hasOtherForward {
		return fmt.Errorf("端口 %d 已被其他转发占用", port)
	}

	bases, err := h.forwardServiceBaseCandidates(forward)
	if err != nil {
		return err
	}

	if err := h.deleteForwardServiceBasesOnNode(node.ID, bases); err != nil {
		return err
	}

	time.Sleep(150 * time.Millisecond)

	_, err = h.sendNodeCommand(node.ID, "AddService", services, true, false)
	if err != nil {
		return err
	}

	return nil
}

func (h *Handler) deleteForwardServicesOnNode(forward *forwardRecord, nodeID int64) error {
	if h == nil || forward == nil {
		return errors.New("invalid forward delete context")
	}
	// nftables mode: skip gost service deletion
	if strings.EqualFold(forward.Mode, "nftables") {
		return nil
	}
	bases, err := h.forwardServiceBaseCandidates(forward)
	if err != nil {
		return err
	}
	return h.deleteForwardServiceBasesOnNode(nodeID, bases)

}

func (h *Handler) forwardServiceBaseCandidates(forward *forwardRecord) ([]string, error) {
	if h == nil || forward == nil {
		return nil, errors.New("invalid forward service base context")
	}
	userTunnelID, _, _, err := h.resolveUserTunnelAndLimiter(forward.UserID, forward.TunnelID)
	if err != nil {
		return nil, err
	}
	userTunnelIDs, err := h.listUserTunnelIDs(forward.UserID, forward.TunnelID)
	if err != nil {
		return nil, err
	}
	allUserTunnelIDs, err := h.listUserTunnelIDsByUser(forward.UserID)
	if err != nil {
		return nil, err
	}
	candidateTunnelIDs := make([]int64, 0, len(userTunnelIDs)+len(allUserTunnelIDs))
	candidateTunnelIDs = append(candidateTunnelIDs, userTunnelIDs...)
	candidateTunnelIDs = append(candidateTunnelIDs, allUserTunnelIDs...)
	return buildForwardServiceBaseCandidates(forward.ID, forward.UserID, userTunnelID, candidateTunnelIDs), nil

}

func (h *Handler) deleteForwardServiceBasesOnNode(nodeID int64, bases []string) error {
	return deleteForwardServiceCandidates(bases, func(name string) error {
		payload := map[string]interface{}{
			"services": []string{name},
		}
		_, err := h.sendNodeCommand(nodeID, "DeleteService", payload, false, false)
		return err
	})
}

func (h *Handler) controlForwardServices(forward *forwardRecord, commandType string, tolerateNotFound bool) error {
	if h == nil || forward == nil {
		return errors.New("invalid forward control context")
	}
	// nftables mode: skip gost service control
	if strings.EqualFold(forward.Mode, "nftables") {
		return nil
	}
	ports, err := h.listForwardPorts(forward.ID)
	if err != nil {
		return err
	}
	if len(ports) == 0 {
		return nil
	}
	userTunnelID, _, _, err := h.resolveUserTunnelAndLimiter(forward.UserID, forward.TunnelID)
	if err != nil {
		return err
	}
	userTunnelIDs, err := h.listUserTunnelIDs(forward.UserID, forward.TunnelID)
	if err != nil {
		return err
	}
	allUserTunnelIDs, err := h.listUserTunnelIDsByUser(forward.UserID)
	if err != nil {
		return err
	}
	candidateTunnelIDs := make([]int64, 0, len(userTunnelIDs)+len(allUserTunnelIDs))
	candidateTunnelIDs = append(candidateTunnelIDs, userTunnelIDs...)
	candidateTunnelIDs = append(candidateTunnelIDs, allUserTunnelIDs...)
	bases := buildForwardServiceBaseCandidates(forward.ID, forward.UserID, userTunnelID, candidateTunnelIDs)
	seen := map[int64]struct{}{}
	healed := false
	for _, nodeID := range h.forwardServiceNodeIDs(forward, ports) {
		if _, ok := seen[nodeID]; ok {
			continue
		}
		seen[nodeID] = struct{}{}

		nodeHandled, lastNotFoundErr, err := h.controlForwardServicesOnNode(nodeID, bases, commandType)
		if err != nil {
			return err
		}

		if !nodeHandled && lastNotFoundErr != nil && !healed && shouldSelfHealForwardServiceControl(commandType) {
			if healErr := h.syncForwardServices(forward, "UpdateService", true); healErr != nil {
				return healErr
			}
			healed = true
			nodeHandled, lastNotFoundErr, err = h.controlForwardServicesOnNode(nodeID, bases, commandType)
			if err != nil {
				return err
			}
		}

		if nodeHandled {
			continue
		}
		if tolerateNotFound {
			continue
		}
		if lastNotFoundErr != nil {
			return lastNotFoundErr
		}
		return errors.New("service control failed")
	}
	return nil
}

func (h *Handler) controlForwardServicesOnNode(nodeID int64, bases []string, commandType string) (bool, error, error) {
	return controlForwardServiceCommand(bases, commandType, func(name string) error {
		payload := map[string]interface{}{
			"services": []string{name},
		}
		_, err := h.sendNodeCommand(nodeID, commandType, payload, false, false)
		return err
	})
}

func controlForwardServiceCommand(bases []string, commandType string, send func(name string) error) (bool, error, error) {
	var lastNotFoundErr error
	for _, base := range bases {
		variants := []string{base + "_tcp", base + "_udp"}
		if shouldTryLegacySingleService(commandType) || strings.EqualFold(strings.TrimSpace(commandType), "DeleteService") {
			variants = append(variants, base)
		}

		candidateHandled := false
		for _, name := range variants {
			err := send(name)
			if err == nil {
				candidateHandled = true
				continue
			}
			if !isNotFoundError(err) {
				return false, lastNotFoundErr, err
			}
			lastNotFoundErr = err
		}

		if candidateHandled {
			return true, nil, nil
		}
	}
	return false, lastNotFoundErr, nil
}

func deleteForwardServiceCandidates(bases []string, send func(name string) error) error {
	for _, base := range bases {
		for _, name := range append([]string{base + "_tcp", base + "_udp", base}, []string{}...) {
			err := send(name)
			if err == nil {
				continue
			}
			if isNotFoundError(err) {
				continue
			}
			return err
		}
	}
	return nil
}

func shouldSelfHealForwardServiceControl(commandType string) bool {
	cmd := strings.ToLower(strings.TrimSpace(commandType))
	return cmd == "pauseservice" || cmd == "resumeservice"
}

func (h *Handler) applyNodeProtocolChange(nodeID int64, httpVal, tlsVal, socksVal, blockOtherVal int) error {
	_, err := h.sendNodeCommand(nodeID, "SetProtocol", map[string]interface{}{
		"http":       httpVal,
		"tls":        tlsVal,
		"socks":      socksVal,
		"blockOther": blockOtherVal,
	}, false, false)
	return err
}

func (h *Handler) sendNodeCommand(nodeID int64, commandType string, data interface{}, tolerateExists bool, tolerateNotFound bool) (ws.CommandResult, error) {
	return h.sendNodeCommandWithTimeout(nodeID, commandType, data, defaultNodeCommandTimeout, tolerateExists, tolerateNotFound)
}

func (h *Handler) sendNodeCommandWithTimeout(nodeID int64, commandType string, data interface{}, timeout time.Duration, tolerateExists bool, tolerateNotFound bool) (ws.CommandResult, error) {
	var (
		result ws.CommandResult
		err    error
	)
	if timeout <= 0 {
		timeout = defaultNodeCommandTimeout
	}

	node, nodeErr := h.getNodeRecord(nodeID)
	if nodeErr == nil && node != nil && node.IsRemote == 1 {
		result, err = h.sendRemoteNodeCommandWithTimeout(node, commandType, data, timeout)
	} else {
		result, err = h.wsServer.SendCommand(nodeID, commandType, data, timeout)
	}
	if err == nil {
		return result, nil
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if tolerateExists {
		if isAlreadyExistsMessage(msg) {
			return result, nil
		}
	}
	if tolerateNotFound {
		if strings.Contains(msg, "not found") || strings.Contains(msg, "不存在") {
			return result, nil
		}
	}
	return result, err
}

func (h *Handler) sendRemoteNodeCommand(node *nodeRecord, commandType string, data interface{}) (ws.CommandResult, error) {
	return h.sendRemoteNodeCommandWithTimeout(node, commandType, data, 0)
}

func (h *Handler) sendRemoteNodeCommandWithTimeout(node *nodeRecord, commandType string, data interface{}, timeout time.Duration) (ws.CommandResult, error) {
	if node == nil {
		return ws.CommandResult{}, errors.New("节点不存在")
	}
	remoteURL := strings.TrimSpace(node.RemoteURL)
	remoteToken := strings.TrimSpace(node.RemoteToken)
	if remoteURL == "" || remoteToken == "" {
		return ws.CommandResult{}, errors.New("远程节点缺少共享配置")
	}

	fc := client.NewFederationClient()
	if timeout > 0 {
		fc = client.NewFederationClientWithTimeout(timeout)
	}
	res, err := fc.Command(remoteURL, remoteToken, h.federationLocalDomain(), client.RuntimeNodeCommandRequest{
		CommandType: commandType,
		Data:        data,
	})
	if err != nil {
		return ws.CommandResult{}, err
	}
	if res == nil {
		return ws.CommandResult{}, errors.New("远程节点未返回命令结果")
	}

	result := ws.CommandResult{
		Type:    res.Type,
		Success: res.Success,
		Message: res.Message,
		Data:    res.Data,
	}
	if !result.Success {
		msg := strings.TrimSpace(result.Message)
		if msg == "" {
			msg = "命令执行失败"
		}
		return result, errors.New(msg)
	}
	return result, nil
}

func (h *Handler) diagnoseForwardRuntime(ctx context.Context, forward *forwardRecord) (map[string]interface{}, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	forwardName, workItems, err := h.prepareForwardDiagnosis(forward)
	if err != nil {
		return nil, err
	}

	results := h.runDiagnosisWorkItems(ctx, workItems, nil)

	payload := map[string]interface{}{
		"forwardName": forwardName,
		"timestamp":   time.Now().UnixMilli(),
		"results":     results,
	}
	return payload, nil
}

func (h *Handler) prepareForwardDiagnosis(forward *forwardRecord) (string, []diagnosisWorkItem, error) {
	if forward == nil {
		return "", nil, errForwardNotFound
	}
	targets, err := resolveDiagnosisTargets(forward.RemoteAddr)
	if err != nil {
		return "", nil, err
	}

	tunnel, err := h.getTunnelRecord(forward.TunnelID)
	if err != nil {
		return "", nil, err
	}

	chainRows, err := h.listChainNodesForTunnel(forward.TunnelID)
	if err != nil {
		return "", nil, err
	}
	if len(chainRows) == 0 {
		return "", nil, errors.New("隧道配置不完整")
	}

	ipPreference := h.repo.GetTunnelIPPreference(forward.TunnelID)

	inNodes, chainHops, outNodes := splitChainNodeGroups(chainRows)
	workItems := make([]diagnosisWorkItem, 0, len(chainRows)*2+len(targets))

	switch tunnel.Type {
	case 1:
		for _, inNode := range inNodes {
			for _, target := range targets {
				description := fmt.Sprintf("入口(%s)->目标(%s)", inNode.NodeName, target.Address)
				workItems = append(workItems, diagnosisWorkItem{
					fromNodeID:  inNode.NodeID,
					targetIP:    target.IP,
					targetPort:  target.Port,
					description: description,
					metadata: map[string]interface{}{
						"fromChainType": 1,
					},
				})
			}
		}
	case 2:
		for _, inNode := range inNodes {
			if len(chainHops) > 0 {
				for _, firstNode := range chainHops[0] {
					description := fmt.Sprintf("入口(%s)->第1跳(%s)", inNode.NodeName, firstNode.NodeName)
					workItems = append(workItems, diagnosisWorkItem{
						fromNodeID:    inNode.NodeID,
						toNode:        firstNode,
						hasChainHop:   true,
						connectIpType: firstNode.ConnectIPType,
						ipPreference:  ipPreference,
						description:   description,
						metadata: map[string]interface{}{
							"fromChainType": 1,
							"toChainType":   2,
							"toInx":         firstNode.Inx,
						},
					})
				}
			} else {
				for _, outNode := range outNodes {
					description := fmt.Sprintf("入口(%s)->出口(%s)", inNode.NodeName, outNode.NodeName)
					workItems = append(workItems, diagnosisWorkItem{
						fromNodeID:    inNode.NodeID,
						toNode:        outNode,
						hasChainHop:   true,
						connectIpType: outNode.ConnectIPType,
						ipPreference:  ipPreference,
						description:   description,
						metadata: map[string]interface{}{
							"fromChainType": 1,
							"toChainType":   3,
						},
					})
				}
			}
		}

		for i, hop := range chainHops {
			for _, currentNode := range hop {
				if i+1 < len(chainHops) {
					for _, nextNode := range chainHops[i+1] {
						description := fmt.Sprintf("第%d跳(%s)->第%d跳(%s)", i+1, currentNode.NodeName, i+2, nextNode.NodeName)
						workItems = append(workItems, diagnosisWorkItem{
							fromNodeID:    currentNode.NodeID,
							toNode:        nextNode,
							hasChainHop:   true,
							connectIpType: nextNode.ConnectIPType,
							ipPreference:  ipPreference,
							description:   description,
							metadata: map[string]interface{}{
								"fromChainType": 2,
								"fromInx":       currentNode.Inx,
								"toChainType":   2,
								"toInx":         nextNode.Inx,
							},
						})
					}
				} else {
					for _, outNode := range outNodes {
						description := fmt.Sprintf("第%d跳(%s)->出口(%s)", i+1, currentNode.NodeName, outNode.NodeName)
						workItems = append(workItems, diagnosisWorkItem{
							fromNodeID:    currentNode.NodeID,
							toNode:        outNode,
							hasChainHop:   true,
							connectIpType: outNode.ConnectIPType,
							ipPreference:  ipPreference,
							description:   description,
							metadata: map[string]interface{}{
								"fromChainType": 2,
								"fromInx":       currentNode.Inx,
								"toChainType":   3,
							},
						})
					}
				}
			}
		}

		for _, outNode := range outNodes {
			for _, target := range targets {
				description := fmt.Sprintf("出口(%s)->目标(%s)", outNode.NodeName, target.Address)
				workItems = append(workItems, diagnosisWorkItem{
					fromNodeID:  outNode.NodeID,
					targetIP:    target.IP,
					targetPort:  target.Port,
					description: description,
					metadata: map[string]interface{}{
						"fromChainType": 3,
					},
				})
			}
		}
	default:
		for _, inNode := range inNodes {
			for _, target := range targets {
				description := fmt.Sprintf("入口(%s)->目标(%s)", inNode.NodeName, target.Address)
				workItems = append(workItems, diagnosisWorkItem{
					fromNodeID:  inNode.NodeID,
					targetIP:    target.IP,
					targetPort:  target.Port,
					description: description,
					metadata: map[string]interface{}{
						"fromChainType": 1,
					},
				})
			}
		}
	}

	return forward.Name, workItems, nil
}

func (h *Handler) diagnoseTunnelRuntime(ctx context.Context, tunnelID int64) (map[string]interface{}, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	tunnelName, tunnelType, workItems, err := h.prepareTunnelDiagnosis(tunnelID)
	if err != nil {
		return nil, err
	}

	results := h.runDiagnosisWorkItems(ctx, workItems, nil)

	payload := map[string]interface{}{
		"tunnelName": tunnelName,
		"tunnelType": tunnelType,
		"timestamp":  time.Now().UnixMilli(),
		"results":    results,
	}
	return payload, nil
}

func (h *Handler) prepareTunnelDiagnosis(tunnelID int64) (string, string, []diagnosisWorkItem, error) {
	tunnel, err := h.getTunnelRecord(tunnelID)
	if err != nil {
		return "", "", nil, err
	}

	tunnelName, err := h.repo.GetTunnelName(tunnelID)
	if err != nil {
		return "", "", nil, err
	}
	if tunnelName == "" {
		return "", "", nil, errors.New("隧道不存在")
	}

	chainRows, err := h.listChainNodesForTunnel(tunnelID)
	if err != nil {
		return "", "", nil, err
	}
	if len(chainRows) == 0 {
		return "", "", nil, errors.New("隧道配置不完整")
	}

	ipPreference := h.repo.GetTunnelIPPreference(tunnelID)
	inNodes, chainHops, outNodes := splitChainNodeGroups(chainRows)
	workItems := make([]diagnosisWorkItem, 0, len(chainRows)*2)

	switch tunnel.Type {
	case 1:
		for _, inNode := range inNodes {
			description := fmt.Sprintf("入口(%s)->外网", inNode.NodeName)
			workItems = append(workItems, diagnosisWorkItem{
				fromNodeID:  inNode.NodeID,
				targetIP:    "",
				targetPort:  443,
				description: description,
				metadata: map[string]interface{}{
					"fromChainType": 1,
					"exitTest":      true,
				},
			})
		}
	case 2:
		for _, inNode := range inNodes {
			if len(chainHops) > 0 {
				for _, firstNode := range chainHops[0] {
					description := fmt.Sprintf("入口(%s)->第1跳(%s)", inNode.NodeName, firstNode.NodeName)
					workItems = append(workItems, diagnosisWorkItem{
						fromNodeID:    inNode.NodeID,
						toNode:        firstNode,
						hasChainHop:   true,
						connectIpType: firstNode.ConnectIPType,
						ipPreference:  ipPreference,
						description:   description,
						metadata: map[string]interface{}{
							"fromChainType": 1,
							"toChainType":   2,
							"toInx":         firstNode.Inx,
						},
					})
				}
			} else {
				for _, outNode := range outNodes {
					description := fmt.Sprintf("入口(%s)->出口(%s)", inNode.NodeName, outNode.NodeName)
					workItems = append(workItems, diagnosisWorkItem{
						fromNodeID:    inNode.NodeID,
						toNode:        outNode,
						hasChainHop:   true,
						connectIpType: outNode.ConnectIPType,
						ipPreference:  ipPreference,
						description:   description,
						metadata: map[string]interface{}{
							"fromChainType": 1,
							"toChainType":   3,
						},
					})
				}
			}
		}

		for i, hop := range chainHops {
			for _, currentNode := range hop {
				if i+1 < len(chainHops) {
					for _, nextNode := range chainHops[i+1] {
						description := fmt.Sprintf("第%d跳(%s)->第%d跳(%s)", i+1, currentNode.NodeName, i+2, nextNode.NodeName)
						workItems = append(workItems, diagnosisWorkItem{
							fromNodeID:    currentNode.NodeID,
							toNode:        nextNode,
							hasChainHop:   true,
							connectIpType: nextNode.ConnectIPType,
							ipPreference:  ipPreference,
							description:   description,
							metadata: map[string]interface{}{
								"fromChainType": 2,
								"fromInx":       currentNode.Inx,
								"toChainType":   2,
								"toInx":         nextNode.Inx,
							},
						})
					}
				} else {
					for _, outNode := range outNodes {
						description := fmt.Sprintf("第%d跳(%s)->出口(%s)", i+1, currentNode.NodeName, outNode.NodeName)
						workItems = append(workItems, diagnosisWorkItem{
							fromNodeID:    currentNode.NodeID,
							toNode:        outNode,
							hasChainHop:   true,
							connectIpType: outNode.ConnectIPType,
							ipPreference:  ipPreference,
							description:   description,
							metadata: map[string]interface{}{
								"fromChainType": 2,
								"fromInx":       currentNode.Inx,
								"toChainType":   3,
							},
						})
					}
				}
			}
		}

		for _, outNode := range outNodes {
			description := fmt.Sprintf("出口(%s)->外网", outNode.NodeName)
			workItems = append(workItems, diagnosisWorkItem{
				fromNodeID:  outNode.NodeID,
				targetIP:    "",
				targetPort:  443,
				description: description,
				metadata: map[string]interface{}{
					"fromChainType": 3,
					"exitTest":      true,
				},
			})
		}
	default:
		for _, inNode := range inNodes {
			description := fmt.Sprintf("入口(%s)->外网", inNode.NodeName)
			workItems = append(workItems, diagnosisWorkItem{
				fromNodeID:  inNode.NodeID,
				targetIP:    "",
				targetPort:  443,
				description: description,
				metadata: map[string]interface{}{
					"fromChainType": 1,
					"exitTest":      true,
				},
			})
		}
	}

	tunnelType := map[bool]string{true: "端口转发", false: "隧道转发"}[tunnel.Type == 1]
	return tunnelName, tunnelType, workItems, nil
}

func splitChainNodeGroups(rows []chainNodeRecord) ([]chainNodeRecord, [][]chainNodeRecord, []chainNodeRecord) {
	inNodes := make([]chainNodeRecord, 0)
	outNodes := make([]chainNodeRecord, 0)
	chainByInx := map[int64][]chainNodeRecord{}
	hopOrder := make([]int64, 0)

	for _, row := range rows {
		switch row.ChainType {
		case 1:
			inNodes = append(inNodes, row)
		case 2:
			if _, ok := chainByInx[row.Inx]; !ok {
				hopOrder = append(hopOrder, row.Inx)
			}
			chainByInx[row.Inx] = append(chainByInx[row.Inx], row)
		case 3:
			outNodes = append(outNodes, row)
		}
	}

	sort.Slice(hopOrder, func(i, j int) bool { return hopOrder[i] < hopOrder[j] })
	chainHops := make([][]chainNodeRecord, 0, len(hopOrder))
	for _, inx := range hopOrder {
		chainHops = append(chainHops, chainByInx[inx])
	}

	return inNodes, chainHops, outNodes
}

func resolveDiagnosisTargets(remoteAddr string) ([]diagnosisTarget, error) {
	rawTargets := splitRemoteTargets(remoteAddr)
	if len(rawTargets) == 0 {
		return nil, errors.New("目标地址不能为空")
	}

	targets := make([]diagnosisTarget, 0, len(rawTargets))
	for _, raw := range rawTargets {
		ip, port, err := parseTargetAddress(raw)
		if err != nil {
			continue
		}
		targets = append(targets, diagnosisTarget{Address: raw, IP: ip, Port: port})
	}
	if len(targets) == 0 {
		return nil, errors.New("目标地址格式错误")
	}
	return targets, nil
}

func diagnosisContextMessage(ctx context.Context) string {
	if ctx == nil {
		return diagnosisRequestTimeoutMsg
	}
	switch ctx.Err() {
	case context.DeadlineExceeded:
		return diagnosisRequestTimeoutMsg
	case context.Canceled:
		return "诊断已取消"
	default:
		return diagnosisRequestTimeoutMsg
	}
}

func diagnosisExecOptionsFromContext(ctx context.Context) diagnosisExecOptions {
	timeout := diagnosisCommandTimeout
	if ctx != nil {
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				remaining = 100 * time.Millisecond
			}
			if remaining < timeout {
				timeout = remaining
			}
		}
	}
	if timeout <= 0 {
		timeout = 100 * time.Millisecond
	}
	pingTimeoutMS := int(timeout / time.Millisecond)
	if pingTimeoutMS <= 0 {
		pingTimeoutMS = 100
	}
	return diagnosisExecOptions{
		commandTimeout: timeout,
		pingTimeoutMS:  pingTimeoutMS,
		timeoutMessage: diagnosisContextMessage(ctx),
	}
}

func newDiagnosisTimeoutItem(workItem diagnosisWorkItem, message string) map[string]interface{} {
	targetPort := workItem.targetPort
	if targetPort <= 0 {
		targetPort = workItem.toNode.Port
	}
	item := newDiagnosisResultItem(workItem.fromNodeID, workItem.targetIP, targetPort, workItem.description, workItem.metadata)
	item["success"] = false
	if strings.TrimSpace(message) == "" {
		message = diagnosisCommandTimeoutMsg
	}
	item["message"] = message
	return item
}

func (h *Handler) executeDiagnosisWorkItem(workItem diagnosisWorkItem, options diagnosisExecOptions) map[string]interface{} {
	single := make([]map[string]interface{}, 0, 1)
	nodeCache := map[int64]*nodeRecord{}
	if workItem.hasChainHop {
		h.appendChainHopDiagnosis(&single, nodeCache, workItem.fromNodeID, workItem.toNode, workItem.description, workItem.metadata, workItem.ipPreference, workItem.connectIpType, options)
	} else if workItem.metadata["exitTest"] == true {
		exitOptions := options
		exitOptions.commandTimeout = exitTestCommandTimeout
		exitOptions.pingTimeoutMS = int(exitTestCommandTimeout / time.Millisecond)
		exitOptions.pingCount = exitTestPingCount
		h.appendExitTestRotation(&single, workItem.fromNodeID, workItem.description, workItem.metadata, exitOptions)
	} else {
		h.appendPathDiagnosis(&single, nodeCache, workItem.fromNodeID, workItem.targetIP, workItem.targetPort, workItem.description, workItem.metadata, options)
	}
	if len(single) == 0 {
		return newDiagnosisTimeoutItem(workItem, "诊断任务未返回结果")
	}
	return single[0]
}

func (h *Handler) runDiagnosisWorkItems(ctx context.Context, workItems []diagnosisWorkItem, emitter diagnosisItemEmitter) []map[string]interface{} {
	if ctx == nil {
		ctx = context.Background()
	}
	results := make([]map[string]interface{}, len(workItems))
	if len(workItems) == 0 {
		return results
	}

	workerLimit := diagnosisMaxConcurrency
	if workerLimit < 1 {
		workerLimit = 1
	}
	if workerLimit > len(workItems) {
		workerLimit = len(workItems)
	}

	type diagnosisWorkResult struct {
		index int
		item  map[string]interface{}
	}

	jobs := make(chan int)
	resultCh := make(chan diagnosisWorkResult, len(workItems))

	var wg sync.WaitGroup
	for i := 0; i < workerLimit; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				select {
				case <-ctx.Done():
					resultCh <- diagnosisWorkResult{index: index, item: newDiagnosisTimeoutItem(workItems[index], diagnosisContextMessage(ctx))}
					continue
				default:
				}
				options := diagnosisExecOptionsFromContext(ctx)
				resultCh <- diagnosisWorkResult{index: index, item: h.executeDiagnosisWorkItem(workItems[index], options)}
			}
		}()
	}

enqueueLoop:
	for i := 0; i < len(workItems); i++ {
		select {
		case <-ctx.Done():
			message := diagnosisContextMessage(ctx)
			for j := i; j < len(workItems); j++ {
				resultCh <- diagnosisWorkResult{index: j, item: newDiagnosisTimeoutItem(workItems[j], message)}
			}
			break enqueueLoop
		case jobs <- i:
		}
	}
	close(jobs)
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	progress := diagnosisProgress{Total: len(workItems)}
	for result := range resultCh {
		results[result.index] = result.item
		progress.Completed++
		if asBool(result.item["success"], false) {
			progress.Success++
		} else {
			progress.Failed++
		}
		if emitter != nil {
			emitter(result.index, result.item, progress)
		}
	}

	for i := range results {
		if results[i] == nil {
			results[i] = newDiagnosisTimeoutItem(workItems[i], diagnosisCommandTimeoutMsg)
		}
	}
	return results
}

func (h *Handler) cachedNode(nodeCache map[int64]*nodeRecord, nodeID int64) (*nodeRecord, error) {
	if node, ok := nodeCache[nodeID]; ok {
		return node, nil
	}
	node, err := h.getNodeRecord(nodeID)
	if err != nil {
		return nil, err
	}
	nodeCache[nodeID] = node
	return node, nil
}

func newDiagnosisResultItem(fromNodeID int64, targetIP string, targetPort int, description string, metadata map[string]interface{}) map[string]interface{} {
	item := map[string]interface{}{
		"nodeName":    fmt.Sprintf("node_%d", fromNodeID),
		"nodeId":      strconv.FormatInt(fromNodeID, 10),
		"targetIp":    targetIP,
		"targetPort":  targetPort,
		"description": description,
		"averageTime": 0,
		"packetLoss":  100,
	}
	for k, v := range metadata {
		item[k] = v
	}
	return item
}

func (h *Handler) appendFailedDiagnosis(results *[]map[string]interface{}, nodeCache map[int64]*nodeRecord, fromNodeID int64, targetIP string, targetPort int, description string, metadata map[string]interface{}, message string) {
	item := newDiagnosisResultItem(fromNodeID, targetIP, targetPort, description, metadata)
	if node, err := h.cachedNode(nodeCache, fromNodeID); err == nil {
		item["nodeName"] = node.Name
	}
	if strings.TrimSpace(message) == "" {
		message = "TCP连接失败"
	}
	item["success"] = false
	item["message"] = message
	*results = append(*results, item)
}

func (h *Handler) appendPathDiagnosis(results *[]map[string]interface{}, nodeCache map[int64]*nodeRecord, fromNodeID int64, targetIP string, targetPort int, description string, metadata map[string]interface{}, options diagnosisExecOptions) {
	item := newDiagnosisResultItem(fromNodeID, targetIP, targetPort, description, metadata)

	fromNode, err := h.cachedNode(nodeCache, fromNodeID)
	if err != nil {
		item["success"] = false
		item["message"] = err.Error()
		*results = append(*results, item)
		return
	}
	item["nodeName"] = fromNode.Name

	var (
		pingData map[string]interface{}
		pingErr  error
	)
	if fromNode.IsRemote == 1 {
		pingData, pingErr = h.tcpPingViaRemoteNode(fromNode, targetIP, targetPort, options)
	} else {
		pingData, pingErr = h.tcpPingViaNode(fromNodeID, targetIP, targetPort, options)
	}
	if pingErr != nil {
		item["success"] = false
		item["message"] = pingErr.Error()
		*results = append(*results, item)
		return
	}

	success := asBool(pingData["success"], false)
	item["success"] = success
	item["averageTime"] = asFloat(pingData["averageTime"], 0)
	item["packetLoss"] = asFloat(pingData["packetLoss"], 100)

	message := strings.TrimSpace(asString(pingData["message"]))
	if success {
		if message == "" {
			message = "TCP连接成功"
		}
	} else {
		if message == "" {
			message = strings.TrimSpace(asString(pingData["errorMessage"]))
		}
		if message == "" {
			message = "TCP连接失败"
		}
	}
	item["message"] = message
	*results = append(*results, item)
}

func (h *Handler) appendChainHopDiagnosis(results *[]map[string]interface{}, nodeCache map[int64]*nodeRecord, fromNodeID int64, toNode chainNodeRecord, description string, metadata map[string]interface{}, ipPreference string, connectIpType string, options diagnosisExecOptions) {
	fromNode, _ := h.cachedNode(nodeCache, fromNodeID)
	targetNode, err := h.cachedNode(nodeCache, toNode.NodeID)
	if err != nil {
		h.appendFailedDiagnosis(results, nodeCache, fromNodeID, "", 0, description, metadata, err.Error())
		return
	}
	targetIP, targetPort, err := resolveChainProbeTarget(fromNode, targetNode, toNode.Port, ipPreference, toNode.ConnectIPType)
	if err != nil {
		h.appendFailedDiagnosis(results, nodeCache, fromNodeID, strings.Trim(strings.TrimSpace(targetNode.ServerIP), "[]"), toNode.Port, description, metadata, err.Error())
		return
	}

	item := newDiagnosisResultItem(fromNodeID, targetIP, targetPort, description, metadata)
	if fromNode != nil {
		item["nodeName"] = fromNode.Name
	}

	var pingData map[string]interface{}
	var pingErr error
	if fromNode != nil && fromNode.IsRemote == 1 {
		pingData, pingErr = h.tcpPingViaRemoteNode(fromNode, targetIP, targetPort, options)
	} else {
		pingData, pingErr = h.tcpPingViaNode(fromNodeID, targetIP, targetPort, options)
	}
	if pingErr != nil {
		item["success"] = false
		item["message"] = pingErr.Error()
		*results = append(*results, item)
		return
	}

	success := asBool(pingData["success"], false)
	item["success"] = success
	item["averageTime"] = asFloat(pingData["averageTime"], 0)
	item["packetLoss"] = asFloat(pingData["packetLoss"], 100)

	msg := strings.TrimSpace(asString(pingData["message"]))
	if success {
		if msg == "" {
			msg = "TCP连接成功"
		}
		// TCP ping 通过后，尝试检查目标节点的服务状态（仅辅助信息，不覆盖 TCP ping 结果）
		if targetNode != nil && targetNode.IsRemote != 1 {
			svcState, svcErr := h.checkServiceStatusViaNode(toNode.NodeID, targetPort, options)
			if svcErr == nil {
				item["serviceState"] = svcState
				msg = fmt.Sprintf("%s，服务状态正常(%s)", msg, svcState)
			} else {
				item["serviceState"] = svcState
				// 服务状态检查失败时记录到 message 但不覆盖 success（例如节点离线时无法检查）
				if !strings.Contains(svcErr.Error(), "节点不在线") {
					msg = fmt.Sprintf("%s，服务状态警告: %v", msg, svcErr)
				}
			}
		}
	} else {
		if msg == "" {
			msg = strings.TrimSpace(asString(pingData["errorMessage"]))
		}
		if msg == "" {
			msg = "TCP连接失败"
		}
	}
	item["message"] = msg
	*results = append(*results, item)
}

func (h *Handler) appendExitTestRotation(results *[]map[string]interface{}, fromNodeID int64, description string, metadata map[string]interface{}, options diagnosisExecOptions) {
	var mu sync.Mutex
	allFailedTargets := make([]string, len(exitTestTargets))
	resultCh := make(chan map[string]interface{}, len(exitTestTargets))
	var wg sync.WaitGroup

	for i, t := range exitTestTargets {
		wg.Add(1)
		go func(idx int, target struct{ name, host string; port int }) {
			defer wg.Done()
			single := make([]map[string]interface{}, 0, 1)
			h.appendPathDiagnosis(&single, map[int64]*nodeRecord{}, fromNodeID, target.host, target.port, description, metadata, options)
			if len(single) > 0 && asBool(single[0]["success"], false) {
				item := single[0]
				item["targetIp"] = exitTestTargets[0].host
				if idx > 0 {
					item["actualTarget"] = target.name
				}
				select {
				case resultCh <- item:
				default:
				}
			} else {
				mu.Lock()
				allFailedTargets[idx] = target.name
				mu.Unlock()
			}
		}(i, t)
	}

	// Wait for first result or timeout
	select {
	case item := <-resultCh:
		*results = append(*results, item)
		return
	case <-time.After(exitTestCommandTimeout):
	}

	wg.Wait()
	close(resultCh)

	// Collect results from channel (may have late arrivals within timeout)
	for item := range resultCh {
		if item != nil {
			*results = append(*results, item)
			return
		}
	}

	// All failed
	var failedNames []string
	for _, name := range allFailedTargets {
		if name != "" {
			failedNames = append(failedNames, name)
		}
	}
	failedDescription := fmt.Sprintf("%s [%s (全部失败)]", description, strings.Join(failedNames, "/"))
	failedItem := newDiagnosisResultItem(fromNodeID, "", 443, failedDescription, metadata)
	failedItem["message"] = "所有TCP连接尝试都失败"
	*results = append(*results, failedItem)
}

func resolveChainProbeTarget(fromNode, targetNode *nodeRecord, preferredPort int, ipPreference string, connectIpType string) (string, int, error) {
	if targetNode == nil {
		return "", 0, errors.New("目标节点不存在")
	}
	host, _, err := selectTunnelDialHost(fromNode, targetNode, ipPreference, connectIpType)
	if err != nil {
		host = strings.Trim(strings.TrimSpace(targetNode.ServerIP), "[]")
	}
	if host == "" {
		return "", 0, errors.New("目标节点地址为空")
	}
	port := preferredPort
	if port <= 0 {
		port = firstPortFromRange(targetNode.PortRange)
	}
	if port <= 0 {
		port = 443
	}
	return host, port, nil
}

func firstPortFromRange(portRange string) int {
	portRange = strings.TrimSpace(portRange)
	if portRange == "" {
		return 0
	}
	first := strings.Split(portRange, ",")[0]
	first = strings.TrimSpace(first)
	if strings.Contains(first, "-") {
		parts := strings.SplitN(first, "-", 2)
		if len(parts) != 2 {
			return 0
		}
		p, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil || p <= 0 {
			return 0
		}
		return p
	}
	p, err := strconv.Atoi(first)
	if err != nil || p <= 0 {
		return 0
	}
	return p
}

func (h *Handler) listChainNodesForTunnel(tunnelID int64) ([]chainNodeRecord, error) {
	return h.repo.ListChainNodesForTunnel(tunnelID)
}

func (h *Handler) forwardServiceNodeIDs(forward *forwardRecord, ports []forwardPortRecord) []int64 {
	return h.forwardServiceNodeIDsForTunnel(forward, ports, forward.TunnelID)
}

func (h *Handler) forwardServiceNodeIDsForTunnel(forward *forwardRecord, ports []forwardPortRecord, tunnelID int64) []int64 {
	seen := make(map[int64]struct{})
	ids := make([]int64, 0, len(ports))
	appendID := func(id int64) {
		if id <= 0 {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, fp := range ports {
		appendID(fp.NodeID)
	}
	if forward == nil || !strings.EqualFold(forward.Mode, forwardModeSDWAN) {
		return ids
	}
	tunnel, err := h.getTunnelRecord(tunnelID)
	if err != nil || tunnel == nil || tunnel.Type != 2 {
		return ids
	}
	chainNodes, err := h.listChainNodesForTunnel(tunnelID)
	if err != nil {
		return ids
	}
	for _, cn := range chainNodes {
		appendID(cn.NodeID)
	}
	return ids
}

// checkServiceStatusViaNode sends a ListServices command to the target node and
// checks whether a service is listening on the specified port with a healthy state.
func (h *Handler) checkServiceStatusViaNode(nodeID int64, port int, options diagnosisExecOptions) (string, error) {
	if options.commandTimeout <= 0 {
		options.commandTimeout = diagnosisCommandTimeout
	}
	res, err := h.sendNodeCommandWithTimeout(nodeID, "ListServices", map[string]interface{}{}, options.commandTimeout, false, false)
	if err != nil {
		return "", err
	}
	if res.Data == nil {
		return "", errors.New("节点未返回服务列表")
	}
	servicesRaw, ok := res.Data["services"].([]interface{})
	if !ok || len(servicesRaw) == 0 {
		return "", errors.New("节点服务列表为空")
	}
	for _, s := range servicesRaw {
		svc, ok := s.(map[string]interface{})
		if !ok {
			continue
		}
		addr := asString(svc["addr"])
		if addr == "" {
			continue
		}
		_, svcPort, splitErr := net.SplitHostPort(addr)
		if splitErr != nil {
			continue
		}
		if asInt(svcPort, 0) != port {
			continue
		}
		state := strings.ToLower(asString(svc["state"]))
		if state == "running" || state == "ready" {
			return state, nil
		}
		return state, fmt.Errorf("服务状态异常: %s", state)
	}
	return "", fmt.Errorf("端口 %d 无监听服务", port)
}

func (h *Handler) tcpPingViaNode(nodeID int64, ip string, port int, options diagnosisExecOptions) (map[string]interface{}, error) {
	if options.commandTimeout <= 0 {
		options.commandTimeout = diagnosisCommandTimeout
	}
	if options.pingTimeoutMS <= 0 {
		options.pingTimeoutMS = int(diagnosisCommandTimeout / time.Millisecond)
	}
	if options.pingCount <= 0 {
		options.pingCount = 4
	}
	res, err := h.sendNodeCommandWithTimeout(nodeID, "TcpPing", map[string]interface{}{
		"ip":      ip,
		"port":    port,
		"count":   options.pingCount,
		"timeout": options.pingTimeoutMS,
	}, options.commandTimeout, false, false)
	if err != nil {
		return nil, err
	}
	if res.Data == nil {
		return nil, errors.New("节点未返回诊断数据")
	}
	return res.Data, nil
}

func (h *Handler) tcpPingViaRemoteNode(node *nodeRecord, ip string, port int, options diagnosisExecOptions) (map[string]interface{}, error) {
	if node == nil {
		return nil, errors.New("节点不存在")
	}
	remoteURL := strings.TrimSpace(node.RemoteURL)
	remoteToken := strings.TrimSpace(node.RemoteToken)
	if remoteURL == "" || remoteToken == "" {
		return nil, errors.New("远程节点缺少共享配置")
	}
	if options.commandTimeout <= 0 {
		options.commandTimeout = diagnosisCommandTimeout
	}
	if options.pingTimeoutMS <= 0 {
		options.pingTimeoutMS = int(diagnosisCommandTimeout / time.Millisecond)
	}

	fc := client.NewFederationClientWithTimeout(options.commandTimeout)
	return fc.Diagnose(remoteURL, remoteToken, h.federationLocalDomain(), client.RuntimeDiagnoseRequest{
		IP:      strings.TrimSpace(ip),
		Port:    port,
		Count:   4,
		Timeout: options.pingTimeoutMS,
	})
}

func splitRemoteTargets(remoteAddr string) []string {
	parts := strings.Split(remoteAddr, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, processServerAddress(part))
	}
	return out
}

func parseTargetAddress(addr string) (string, int, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "", 0, errors.New("empty address")
	}
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		idx := strings.LastIndex(addr, ":")
		if idx <= 0 || idx >= len(addr)-1 {
			return "", 0, err
		}
		host = strings.TrimSpace(addr[:idx])
		portStr = strings.TrimSpace(addr[idx+1:])
	}
	port, err := strconv.Atoi(strings.TrimSpace(portStr))
	if err != nil || port <= 0 || port > 65535 {
		return "", 0, errors.New("invalid port")
	}
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if host == "" {
		return "", 0, errors.New("invalid host")
	}
	return host, port, nil
}

func buildForwardServiceBase(forwardID, userID, userTunnelID int64) string {
	return fmt.Sprintf("%d_%d_%d", forwardID, userID, userTunnelID)
}

func buildForwardServiceBaseWithResolvedUserTunnel(forwardID, userID, resolvedUserTunnelID int64) string {
	if resolvedUserTunnelID <= 0 {
		return buildForwardServiceBase(forwardID, userID, 0)
	}
	return buildForwardServiceBase(forwardID, userID, resolvedUserTunnelID)
}

func buildForwardServiceBaseCandidates(forwardID, userID, preferredUserTunnelID int64, userTunnelIDs []int64) []string {
	orderedIDs := make([]int64, 0, len(userTunnelIDs)+2)
	seen := make(map[int64]struct{}, len(userTunnelIDs)+2)

	appendID := func(id int64) {
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		orderedIDs = append(orderedIDs, id)
	}

	appendID(preferredUserTunnelID)
	for _, id := range userTunnelIDs {
		appendID(id)
	}
	appendID(0)

	bases := make([]string, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		bases = append(bases, buildForwardServiceBase(forwardID, userID, id))
	}
	return bases
}

func buildForwardControlServiceNames(base, commandType string) []string {
	names := []string{base + "_tcp", base + "_udp"}
	if strings.EqualFold(strings.TrimSpace(commandType), "DeleteService") {
		return append([]string{base}, names...)
	}
	return names
}

func shouldTryLegacySingleService(commandType string) bool {
	cmd := strings.ToLower(strings.TrimSpace(commandType))
	return cmd == "pauseservice" || cmd == "resumeservice"
}

func isNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(msg, "not found") || strings.Contains(msg, "不存在")
}

func isAlreadyExistsMessage(message string) bool {
	msg := strings.ToLower(strings.TrimSpace(message))
	if msg == "" {
		return false
	}
	if isAddressAlreadyInUseMessage(msg) {
		return false
	}
	compact := compactErrorMessage(msg)
	return strings.Contains(msg, "already exists") || strings.Contains(msg, "已存在") || strings.Contains(compact, "alreadyexists")
}

func isBindAddressInUseError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return false
	}
	return isAddressAlreadyInUseMessage(msg) || strings.Contains(msg, "cannot assign requested address")
}

func isAddressAlreadyInUseError(err error) bool {
	if err == nil {
		return false
	}
	return isAddressAlreadyInUseMessage(strings.ToLower(strings.TrimSpace(err.Error())))
}

func isAddressAlreadyInUseMessage(msg string) bool {
	if msg == "" {
		return false
	}
	if strings.Contains(msg, "address already in use") {
		return true
	}
	return strings.Contains(compactErrorMessage(msg), "addressalreadyinuse")
}

func isCannotAssignRequestedAddressError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return false
	}
	if strings.Contains(msg, "cannot assign requested address") {
		return true
	}
	return strings.Contains(compactErrorMessage(msg), "cannotassignrequestedaddress")
}

func compactErrorMessage(msg string) string {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return ""
	}
	return strings.Join(strings.Fields(strings.ToLower(msg)), "")
}

func buildForwardServiceConfigs(baseName string, forward *forwardRecord, tunnel *tunnelRecord, node *nodeRecord, port int, bindIP string, limiterID *int64, tunnelTLSProtocol bool) []map[string]interface{} {
	protocols := []string{"tcp", "udp"}
	services := make([]map[string]interface{}, 0, 2)
	targets := splitRemoteTargets(forward.RemoteAddr)
	for i, t := range targets {
		targets[i] = resolveTargetIP(t)
	}
	strategy := strings.TrimSpace(forward.Strategy)
	if strategy == "" {
		strategy = "fifo"
	}

	// ✅ 动态限速器名称
	var dynamicLimiterName string
	if forward.SpeedLimitEnabled && forward.SpeedLimit > 0 {
		dynamicLimiterName = fmt.Sprintf("forward_%d_speed", forward.ID)
	}

	for _, protocol := range protocols {
		listenerAddr := node.TCPListenAddr
		if protocol == "udp" {
			listenerAddr = node.UDPListenAddr
		}
		var serviceAddr string
		if bindIP != "" {
			trimmedBindIP := strings.TrimSpace(bindIP)
			if _, _, err := net.SplitHostPort(trimmedBindIP); err == nil {
				serviceAddr = processServerAddress(trimmedBindIP)
			} else {
				serviceAddr = processServerAddress(net.JoinHostPort(strings.Trim(trimmedBindIP, "[]"), strconv.Itoa(port)))
			}
		} else {
			serviceAddr = processServerAddress(fmt.Sprintf("%s:%d", listenerAddr, port))
		}
		service := map[string]interface{}{
			"name": fmt.Sprintf("%s_%s", baseName, protocol),
			"addr": serviceAddr,
			"handler": map[string]interface{}{
				"type": protocol,
			},
			"listener": map[string]interface{}{
				"type": protocol,
			},
			"forwarder": map[string]interface{}{
				"nodes": buildForwarderNodes(targets),
				"selector": map[string]interface{}{
					"strategy":    strategy,
					"maxFails":    1,
					"failTimeout": "600s",
				},
			},
		}
		if protocol == "udp" {
			listenerMetadata := map[string]interface{}{"keepAlive": true}
			if tunnelTLSProtocol {
				listenerMetadata["ttl"] = "10s"
			}
			service["listener"].(map[string]interface{})["metadata"] = listenerMetadata
		}
		if tunnel != nil && tunnel.Type == 2 {
			service["handler"].(map[string]interface{})["chain"] = fmt.Sprintf("chains_%d", forward.TunnelID)
		}
		// 合并 metadata
		meta := make(map[string]interface{})
		if tunnel != nil && tunnel.Type == 1 && strings.TrimSpace(node.InterfaceName) != "" {
			meta["interface"] = node.InterfaceName
		}
		if forward.MaxConnections > 0 {
			meta["maxConnections"] = forward.MaxConnections
		}
		if isPremiumForwardMode(forward.Mode) {
			meta["kernel"] = normalizeForwardMode(forward.Mode)
		}
		if strings.EqualFold(forward.Mode, forwardModeSDWAN) {
			if cfgYAML := parseSDWANConfigYAMLFromRemoteConfig(node.RemoteConfig); cfgYAML != "" {
				meta["sdwanConfigYAML"] = cfgYAML
			}
			if cfgPath := parseSDWANConfigPathFromRemoteConfig(node.RemoteConfig); cfgPath != "" {
				meta["sdwanConfigPath"] = cfgPath
			}
			if caPath := parseSDWANCAPathFromRemoteConfig(node.RemoteConfig); caPath != "" {
				meta["sdwanCAPath"] = caPath
			}
			if caPEM := parseSDWANCAPEMFromRemoteConfig(node.RemoteConfig); caPEM != "" {
				meta["sdwanCAPEM"] = caPEM
			}
			if certPath := parseSDWANCertPathFromRemoteConfig(node.RemoteConfig); certPath != "" {
				meta["sdwanCertPath"] = certPath
			}
			if certPEM := parseSDWANCertPEMFromRemoteConfig(node.RemoteConfig); certPEM != "" {
				meta["sdwanCertPEM"] = certPEM
			}
			if keyPath := parseSDWANKeyPathFromRemoteConfig(node.RemoteConfig); keyPath != "" {
				meta["sdwanKeyPath"] = keyPath
			}
			if keyPEM := parseSDWANKeyPEMFromRemoteConfig(node.RemoteConfig); keyPEM != "" {
				meta["sdwanKeyPEM"] = keyPEM
			}
			if lighthouseVPNIP := parseSDWANLighthouseVPNIPFromRemoteConfig(node.RemoteConfig); lighthouseVPNIP != "" {
				meta["sdwanLighthouseVPNIP"] = lighthouseVPNIP
			}
			if lighthouseAddr := parseSDWANLighthouseAddrFromRemoteConfig(node.RemoteConfig); lighthouseAddr != "" {
				meta["sdwanLighthouseAddr"] = lighthouseAddr
			}
			if listenHost := parseSDWANListenHostFromRemoteConfig(node.RemoteConfig); listenHost != "" {
				meta["sdwanListenHost"] = listenHost
			}
			if listenPort := parseSDWANListenPortFromRemoteConfig(node.RemoteConfig); listenPort != "" {
				meta["sdwanListenPort"] = listenPort
			}
			if isLighthouse := parseSDWANIsLighthouseFromRemoteConfig(node.RemoteConfig); isLighthouse != "" {
				meta["sdwanIsLighthouse"] = isLighthouse
			}
		}
		if len(meta) > 0 {
			service["metadata"] = meta
		}
		// ✅ 应用限速器（优先使用动态限速器）
		if dynamicLimiterName != "" {
			service["limiter"] = dynamicLimiterName
		} else if limiterID != nil && *limiterID > 0 {
			service["limiter"] = strconv.FormatInt(*limiterID, 10)
		}
		services = append(services, service)
	}

	return services
}

func buildForwarderNodes(targets []string) []map[string]interface{} {
	nodes := make([]map[string]interface{}, 0, len(targets))
	for i, addr := range targets {
		nodes = append(nodes, map[string]interface{}{
			"name": fmt.Sprintf("node_%d", i+1),
			"addr": addr,
		})
	}
	return nodes
}

func processServerAddress(serverAddr string) string {
	serverAddr = normalizeServerAddressInput(serverAddr)
	if serverAddr == "" {
		return serverAddr
	}
	if strings.HasPrefix(serverAddr, "[") {
		return serverAddr
	}
	// If the input is a bare IPv6 host (no port), bracket it.
	// IPv6-with-port must be provided in bracket form: [::1]:443.
	if looksLikeIPv6(serverAddr) {
		if ip := net.ParseIP(serverAddr); ip != nil && ip.To4() == nil {
			return "[" + serverAddr + "]"
		}
	}

	idx := strings.LastIndex(serverAddr, ":")
	if idx < 0 {
		if looksLikeIPv6(serverAddr) {
			return "[" + serverAddr + "]"
		}
		return serverAddr
	}
	host := strings.TrimSpace(serverAddr[:idx])
	port := strings.TrimSpace(serverAddr[idx+1:])
	if host == "" || port == "" {
		return serverAddr
	}
	if looksLikeIPv6(host) {
		return "[" + host + "]:" + port
	}
	return serverAddr
}

// resolveTargetIP resolves domain name in target host:port to IP address.
// If host is already an IP, returns target unchanged.
func resolveTargetIP(target string) string {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return target
	}
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if net.ParseIP(host) != nil {
		return target
	}
	ips, err := net.LookupHost(host)
	if err != nil || len(ips) == 0 {
		return target
	}
	if strings.Contains(ips[0], ":") {
		return "[" + ips[0] + "]:" + port
	}
	return ips[0] + ":" + port
}

func normalizeServerAddressInput(serverAddr string) string {
	serverAddr = strings.TrimSpace(serverAddr)
	if serverAddr == "" {
		return serverAddr
	}

	if idx := strings.Index(serverAddr, "://"); idx > 0 {
		if parsed, err := url.Parse(serverAddr); err == nil {
			if host := strings.TrimSpace(parsed.Host); host != "" {
				return host
			}
		}
		serverAddr = serverAddr[idx+3:]
	}

	if idx := strings.IndexAny(serverAddr, "/?#"); idx >= 0 {
		serverAddr = serverAddr[:idx]
	}
	return strings.TrimSpace(serverAddr)
}

func looksLikeIPv6(address string) bool {
	return strings.Count(address, ":") >= 2
}

func asBool(v interface{}, def bool) bool {
	s := strings.TrimSpace(strings.ToLower(asString(v)))
	if s == "" {
		return def
	}
	switch s {
	case "1", "t", "true", "yes", "y":
		return true
	case "0", "f", "false", "no", "n":
		return false
	default:
		return def
	}
}

func (h *Handler) ensureLimiterOnNode(nodeID int64, limiterID int64, speed int) error {
	if err := h.upsertLimiterOnNode(nodeID, limiterID, speed); err != nil {
		return fmt.Errorf("限速规则下发失败：%w", err)
	}

	return nil
}

// ✅ 新增：确保 Forward 动态限速器存在（所有入口节点）
func (h *Handler) ensureForwardDynamicLimiter(forward *forwardRecord, limiterName string) error {
	ports, err := h.listForwardPorts(forward.ID)
	if err != nil {
		return err
	}

	for _, fp := range ports {
		if err := h.ensureDynamicLimiterOnNode(fp.NodeID, limiterName, forward.SpeedLimit); err != nil {
			if !isNodeOfflineOrTimeoutError(err) {
				return err
			}
		}
	}
	return nil
}

// ✅ 新增：在节点上创建/更新动态限速器
func (h *Handler) ensureDynamicLimiterOnNode(nodeID int64, limiterName string, speedLimit int) error {
	// 构建限速器配置
	// gost traffic limiter 使用 MB/s 作为单位（通过 units.ParseBase2Bytes 解析）
	// 前端输入是 Mbps，需要转换：MB/s = Mbps / 8
	// 配置格式："$ <in> <out>"，其中 $ 是 ServiceLimitKey
	var limits []string
	if speedLimit > 0 {
		// 上下行使用相同的限速值
		speedMB := float64(speedLimit) / 8.0
		limits = []string{fmt.Sprintf("$ %.1fMB %.1fMB", speedMB, speedMB)}
	} else {
		// 没设置限速，删除限速器
		_, _ = h.sendNodeCommand(nodeID, "DeleteLimiters", map[string]interface{}{
			"limiter": limiterName,
		}, false, true)
		return nil
	}

	// 先尝试删除已存在的限速器（确保更新时配置被刷新）
	_, _ = h.sendNodeCommand(nodeID, "DeleteLimiters", map[string]interface{}{
		"limiter": limiterName,
	}, false, true)

	// 等待一小段时间让删除生效
	time.Sleep(100 * time.Millisecond)

	// 创建新的限速器
	addPayload := map[string]interface{}{
		"name":   limiterName,
		"limits": limits,
	}

	if _, err := h.sendNodeCommand(nodeID, "AddLimiters", addPayload, false, false); err != nil {
		return err
	}

	return nil
}

// ✅ 新增：删除 Forward 动态限速器
func (h *Handler) deleteForwardDynamicLimiter(forward *forwardRecord) {
	limiterName := fmt.Sprintf("forward_%d_speed", forward.ID)
	ports, _ := h.listForwardPorts(forward.ID)

	for _, fp := range ports {
		node, err := h.getNodeRecord(fp.NodeID)
		if err != nil {
			continue
		}
		_, _ = h.sendNodeCommand(node.ID, "DeleteLimiters", map[string]interface{}{
			"limiter": limiterName,
		}, false, true)
	}
}

func buildLimiterAddPayload(limiterID int64, speed int) (string, map[string]interface{}) {
	rate := float64(speed) / 8.0
	limitStr := fmt.Sprintf("$ %.1fMB %.1fMB", rate, rate)
	name := strconv.FormatInt(limiterID, 10)

	return name, map[string]interface{}{
		"name":   name,
		"limits": []string{limitStr},
	}
}

func buildLimiterUpdatePayload(name string, data map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"limiter": name,
		"data":    data,
	}
}

func (h *Handler) upsertLimiterOnNode(nodeID int64, limiterID int64, speed int) error {
	name, addPayload := buildLimiterAddPayload(limiterID, speed)
	if _, err := h.sendNodeCommand(nodeID, "AddLimiters", addPayload, false, false); err != nil {
		if !isAlreadyExistsMessage(err.Error()) {
			return err
		}
		payload := map[string]interface{}{
			"name":   name,
			"limits": addPayload["limits"],
		}
		if _, updateErr := h.sendNodeCommand(nodeID, "UpdateLimiters", buildLimiterUpdatePayload(name, payload), false, false); updateErr != nil {
			return updateErr
		}
	}

	return nil
}



// NftablesRulePayload nftables rule payload (matches agent side)
type NftablesRulePayload struct {
	ForwardID    int64  `json:"forward_id"`
	NodeID       int64  `json:"node_id"`
	UserID       int64  `json:"user_id"`
	UserTunnelID int64  `json:"user_tunnel_id"`
	Protocol     string `json:"protocol"`
	Port         int    `json:"port"`
	Target       string `json:"target"`
	SpeedLimit   int    `json:"speed_limit"`
	ChainType    int    `json:"chain_type"`
	NextHopIP    string `json:"next_hop_ip"`
	NextHopPort  int    `json:"next_hop_port"`
}

// AddNftablesRulesRequest nftables rules create request
type AddNftablesRulesRequest struct {
	Rules []NftablesRulePayload `json:"rules"`
}

// DeleteNftablesRulesRequest nftables rules delete request
type DeleteNftablesRulesRequest struct {
	ForwardIDs []int64  `json:"forward_ids"`
	Protocols  []string `json:"protocols"`
	Ports      []int    `json:"ports"`
}

// syncNftablesRules sync nftables forwarding rules to nodes
func (h *Handler) syncNftablesRules(forward *forwardRecord, tunnel *tunnelRecord, ports []forwardPortRecord, userTunnelID int64, speedLimit *int) error {
	if h == nil || forward == nil {
		return errors.New("invalid nftables sync context")
	}

	fmt.Printf("[nft.debug] syncNftablesRules called: forwardID=%d mode=%s\n", forward.ID, forward.Mode)

	// Clean up any residual gost services before applying nftables rules.
	// Only needed when switching from gost to nftables, not for pure nftables forwards.
	// Pass the full forward object so deleteForwardServicesOnNode can check the mode.
	for _, fp := range ports {
		node, err := h.getNodeRecord(fp.NodeID)
		if err != nil {
			fmt.Printf("[nft.debug] getNodeRecord failed for nodeID=%d: %v\n", fp.NodeID, err)
			continue
		}
		_ = h.deleteForwardServicesOnNode(forward, node.ID)
	}

	chainNodes, _ := h.listChainNodesForTunnel(forward.TunnelID)

	// 🛠 修复：为链节点填充缺失的 ConnectIP，避免 resolveChainNextHop 退化到 finalTarget
	for i := range chainNodes {
		if strings.TrimSpace(chainNodes[i].ConnectIP) != "" {
			continue
		}
		node, err := h.getNodeRecord(chainNodes[i].NodeID)
		if err != nil || node == nil {
			continue
		}
		// 与 selectTunnelDialHost 保持一致：LAN → IPv4 → IPv6 → ServerIP
		if v := strings.TrimSpace(node.IntranetIP); v != "" {
			chainNodes[i].ConnectIP = v
			continue
		}
		if v := strings.TrimSpace(node.ExtraIPs); v != "" {
			for _, ip := range strings.Split(v, ",") {
				ip = strings.TrimSpace(ip)
				if ip != "" && !strings.HasPrefix(ip, "[") {
					chainNodes[i].ConnectIP = ip
					break
				}
			}
			if chainNodes[i].ConnectIP != "" {
				continue
			}
		}
		if v := strings.TrimSpace(node.ServerIPv4); v != "" {
			chainNodes[i].ConnectIP = v
			continue
		}
		if v := strings.TrimSpace(node.ServerIPv6); v != "" {
			chainNodes[i].ConnectIP = v
			continue
		}
		if v := strings.TrimSpace(node.ServerIP); v != "" {
			chainNodes[i].ConnectIP = v
		}
	}

	rules := buildNftablesRulePayloads(forward, tunnel, ports, chainNodes, userTunnelID, speedLimit)
	fmt.Printf("[nft.debug] built %d rule payloads for forwardID=%d\n", len(rules), forward.ID)

	// Group ports by node for batch operations
	nodePorts := make(map[int64][]int)
	for _, fp := range ports {
		nodePorts[fp.NodeID] = append(nodePorts[fp.NodeID], fp.Port)
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	var syncErr error

	for nodeID, portList := range nodePorts {
		wg.Add(1)
		go func(nid int64, plist []int) {
			defer wg.Done()
			node, err := h.getNodeRecord(nid)
			if err != nil {
				fmt.Printf("[nft.debug] getNodeRecord failed for nodeID=%d: %v\n", nid, err)
				return
			}
			nodeRules := filterRulesByNodeID(rules, nid)
			fmt.Printf("[nft.debug] node %s: %d rules, ports %v\n", node.Name, len(nodeRules), plist)
			if len(nodeRules) == 0 {
				return
			}

			// Batch delete old rules for this forward on all ports
			delPayload := DeleteNftablesRulesRequest{
				ForwardIDs: []int64{forward.ID},
				Protocols:  []string{"tcp", "udp"},
				Ports:      plist,
			}
			fmt.Printf("[nft.debug] sending batch DeleteNftablesRules to node %s for ports %v\n", node.Name, plist)
			if node.IsRemote == 1 && strings.TrimSpace(node.RemoteURL) != "" {
				if err := h.sendRemoteNftablesCommand(node, delPayload); err != nil {
					fmt.Printf("️ syncNftablesRules remote delete error: %v\n", err)
				}
			} else {
				if _, err := h.sendNodeCommand(node.ID, "DeleteNftablesRules", delPayload, true, false); err != nil {
					fmt.Printf("️ syncNftablesRules node delete error: %v\n", err)
				}
			}

			// Batch add new rules for this forward
			payload := AddNftablesRulesRequest{Rules: nodeRules}
			fmt.Printf("[nft.debug] sending AddNftablesRules to node %s with %d rules\n", node.Name, len(nodeRules))
			if node.IsRemote == 1 && strings.TrimSpace(node.RemoteURL) != "" {
				if err := h.sendRemoteNftablesCommand(node, payload); err != nil {
					mu.Lock()
					syncErr = fmt.Errorf("remote node %s nftables sync failed: %w", node.Name, err)
					mu.Unlock()
				}
			} else {
				if _, err := h.sendNodeCommand(node.ID, "AddNftablesRules", payload, true, false); err != nil {
					if isNodeOfflineOrTimeoutError(err) {
						fmt.Printf("[nft.debug] node %s offline/timeout, skipping\n", node.Name)
					} else {
						mu.Lock()
						syncErr = fmt.Errorf("node %s nftables sync failed: %w", node.Name, err)
						mu.Unlock()
					}
				}
			}
		}(nodeID, portList)
	}
	wg.Wait()

	if syncErr != nil {
		return syncErr
	}
	fmt.Printf("[nft.debug] syncNftablesRules completed successfully for forwardID=%d\n", forward.ID)
	return nil
}

// buildNftablesRulePayloads build nftables rule payloads
func buildNftablesRulePayloads(forward *forwardRecord, tunnel *tunnelRecord, ports []forwardPortRecord, chainNodes []chainNodeRecord, userTunnelID int64, speedLimit *int) []NftablesRulePayload {
	var rules []NftablesRulePayload
	protocols := []string{"tcp", "udp"}
	targets := splitRemoteTargets(forward.RemoteAddr)
	for i, t := range targets {
		targets[i] = resolveTargetIP(t)
	}

	spdLimit := 0
	if forward.SpeedLimitEnabled && forward.SpeedLimit > 0 {
		spdLimit = forward.SpeedLimit
	} else if speedLimit != nil {
		spdLimit = *speedLimit
	}

	for _, fp := range ports {
		for _, protocol := range protocols {
			if tunnel.Type == 1 {
				// nft DNAT 只能匹配 协议+dport，同一端口同一协议只能有一条规则。
				// 如果 remoteAddr 有多个目标，只取第一个。
				if len(targets) == 0 {
					continue
				}
				rules = append(rules, NftablesRulePayload{
					ForwardID:    forward.ID,
					NodeID:       fp.NodeID,
					UserID:       forward.UserID,
					UserTunnelID: userTunnelID,
					Protocol:     protocol,
					Port:         fp.Port,
					Target:       targets[0],
					SpeedLimit:   spdLimit,
					ChainType:    1,
				})
			} else if tunnel.Type == 2 {
				for _, target := range targets {
					rules = append(rules, buildChainNftablesRule(forward.ID, forward.UserID, userTunnelID, chainNodes, fp, protocol, target, spdLimit))
				}
			}
		}
	}
	return rules
}

// buildChainNftablesRule build nftables rule for chained tunnel
func buildChainNftablesRule(forwardID, userID, userTunnelID int64, chainNodes []chainNodeRecord, fp forwardPortRecord, protocol string, target string, speedLimit int) NftablesRulePayload {
	nextHopIP, nextHopPort := resolveChainNextHop(chainNodes, fp.NodeID, target)
	return NftablesRulePayload{
		ForwardID:    forwardID,
		NodeID:       fp.NodeID,
		UserID:       userID,
		UserTunnelID: userTunnelID,
		Protocol:     protocol,
		Port:         fp.Port,
		Target:       net.JoinHostPort(nextHopIP, strconv.Itoa(nextHopPort)),
		SpeedLimit:   speedLimit,
		ChainType:    2,
		NextHopIP:    nextHopIP,
		NextHopPort:  nextHopPort,
	}
}

// resolveChainNextHop resolve next hop in chain tunnel
func resolveChainNextHop(chainNodes []chainNodeRecord, nodeID int64, finalTarget string) (string, int) {
	if len(chainNodes) == 0 {
		host, port, _ := net.SplitHostPort(finalTarget)
		p, _ := strconv.Atoi(port)
		return host, p
	}

	inNodes, chainHops, outNodes := splitChainNodeGroups(chainNodes)

	// Check if current node is an entry node (chainType=1)
	for _, inNode := range inNodes {
		if inNode.NodeID == nodeID {
			// Entry node: next hop is first chain hop node, or first exit node
			if len(chainHops) > 0 && len(chainHops[0]) > 0 {
				next := chainHops[0][0]
				if ip := strings.TrimSpace(next.ConnectIP); ip != "" && next.Port > 0 {
					return ip, next.Port
				}
			}
			if len(outNodes) > 0 {
				next := outNodes[0]
				if ip := strings.TrimSpace(next.ConnectIP); ip != "" && next.Port > 0 {
					return ip, next.Port
				}
			}
			host, port, _ := net.SplitHostPort(finalTarget)
			p, _ := strconv.Atoi(port)
			return host, p
		}
	}

	// Check if current node is a chain hop node (chainType=2)
	for hopIdx, hop := range chainHops {
		for _, chainNode := range hop {
			if chainNode.NodeID == nodeID {
				// Chain hop node: next hop is first node in next hop group, or first exit node
				if hopIdx+1 < len(chainHops) && len(chainHops[hopIdx+1]) > 0 {
					next := chainHops[hopIdx+1][0]
					if ip := strings.TrimSpace(next.ConnectIP); ip != "" && next.Port > 0 {
						return ip, next.Port
					}
				}
				if len(outNodes) > 0 {
					next := outNodes[0]
					if ip := strings.TrimSpace(next.ConnectIP); ip != "" && next.Port > 0 {
						return ip, next.Port
					}
				}
				host, port, _ := net.SplitHostPort(finalTarget)
				p, _ := strconv.Atoi(port)
				return host, p
			}
		}
	}

	// Fallback: node not found in any group
	host, port, _ := net.SplitHostPort(finalTarget)
	p, _ := strconv.Atoi(port)
	return host, p
}

// filterRulesByNodeID filter rules by node ID
func filterRulesByNodeID(rules []NftablesRulePayload, nodeID int64) []NftablesRulePayload {
	var filtered []NftablesRulePayload
	for _, r := range rules {
		if r.NodeID == nodeID {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

// deleteNftablesRules delete nftables forwarding rules
func (h *Handler) deleteNftablesRules(forward *forwardRecord, ports []forwardPortRecord) error {
	if h == nil || forward == nil {
		return errors.New("invalid nftables delete context")
	}

	nodeIDs := make(map[int64]bool)
	var portNumbers []int
	for _, fp := range ports {
		nodeIDs[fp.NodeID] = true
		portNumbers = append(portNumbers, fp.Port)
	}

	payload := DeleteNftablesRulesRequest{
		ForwardIDs: []int64{forward.ID},
		Protocols:  []string{"tcp", "udp"},
		Ports:      portNumbers,
	}

	var errs []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	for nodeID := range nodeIDs {
		wg.Add(1)
		go func(nid int64) {
			defer wg.Done()
			node, err := h.getNodeRecord(nid)
			if err != nil {
				mu.Lock()
				errs = append(errs, fmt.Sprintf("node %d: %v", nid, err))
				mu.Unlock()
				return
			}
			if node.IsRemote == 1 && strings.TrimSpace(node.RemoteURL) != "" {
				if err := h.sendRemoteNftablesCommand(node, payload); err != nil {
					mu.Lock()
					errs = append(errs, fmt.Sprintf("remote node %s: %v", node.Name, err))
					mu.Unlock()
				}
			} else {
				if _, err := h.sendNodeCommand(node.ID, "DeleteNftablesRules", payload, true, false); err != nil {
					mu.Lock()
					errs = append(errs, fmt.Sprintf("node %s: %v", node.Name, err))
					mu.Unlock()
				}
			}
		}(nodeID)
	}
	wg.Wait()

	if len(errs) > 0 {
		return fmt.Errorf("nftables rule deletion errors: %s", strings.Join(errs, "; "))
	}
	return nil
}

// sendRemoteNftablesCommand send nftables command to remote node
func (h *Handler) sendRemoteNftablesCommand(node *nodeRecord, payload interface{}) error {
	if h == nil || node == nil {
		return errors.New("invalid remote nftables command context")
	}
	remoteURL := strings.TrimSpace(node.RemoteURL)
	if remoteURL == "" {
		return errors.New("remote node URL is empty")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", remoteURL+"/api/v1/nftables/sync", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(node.RemoteToken) != "" {
		req.Header.Set("Authorization", strings.TrimSpace(node.RemoteToken))
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("remote node returned status %d", resp.StatusCode)
	}
	return nil
}
