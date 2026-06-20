//go:build linux

package socket

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"

	"github.com/go-gost/x/nftables"
)

// AddNftablesRulesRequest nftables 规则创建请求
type AddNftablesRulesRequest struct {
	Rules []NftablesRulePayload `json:"rules"`
}

// NftablesRulePayload 单条 nftables 规则数据
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
	NextHopIPv6  string `json:"next_hop_ipv6,omitempty"`
}

// UpdateNftablesRulesRequest nftables 规则更新请求
type UpdateNftablesRulesRequest struct {
	Rules []NftablesRulePayload `json:"rules"`
}

// DeleteNftablesRulesRequest nftables 规则删除请求
type DeleteNftablesRulesRequest struct {
	ForwardIDs []int64  `json:"forward_ids"`
	Protocols  []string `json:"protocols"`
	Ports      []int    `json:"ports"`
}

// GetNftablesCountersRequest 获取计数器请求
type GetNftablesCountersRequest struct {
	ForwardIDs []int64 `json:"forward_ids"`
}

// nftables.CounterResult 计数器结果

// handleAddNftablesRules 处理添加 nftables 规则命令
func (w *WebSocketReporter) handleAddNftablesRules(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	var req AddNftablesRulesRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	if len(req.Rules) == 0 {
		return fmt.Errorf("rules list cannot be empty")
	}

	for _, rule := range req.Rules {
		target := rule.Target
		if rule.ChainType > 0 && rule.NextHopIP != "" {
			target = net.JoinHostPort(rule.NextHopIP, strconv.Itoa(rule.NextHopPort))
		}
		if target != "" {
			if err := w.nftablesMgr.AddRule(rule.ForwardID, rule.NodeID, rule.UserID, rule.UserTunnelID, rule.Protocol, rule.Port, target, rule.SpeedLimit, rule.ChainType); err != nil {
				return fmt.Errorf("add rule for forward %d/%s (target=%q): %w", rule.ForwardID, rule.Protocol, target, err)
			}
		}
		// 如果有 IPv6 下一跳，额外创建 IPv6 DNAT 规则
		if rule.NextHopIPv6 != "" {
			ipv6Target := net.JoinHostPort(rule.NextHopIPv6, strconv.Itoa(rule.NextHopPort))
			if err := w.nftablesMgr.AddRule(rule.ForwardID, rule.NodeID, rule.UserID, rule.UserTunnelID, rule.Protocol, rule.Port, ipv6Target, rule.SpeedLimit, rule.ChainType); err != nil {
				return fmt.Errorf("add ipv6 rule for forward %d/%s (target=%q): %w", rule.ForwardID, rule.Protocol, ipv6Target, err)
			}
		}
	}
	return nil
}

// handleUpdateNftablesRules 处理更新 nftables 规则命令
func (w *WebSocketReporter) handleUpdateNftablesRules(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	var req UpdateNftablesRulesRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	for _, rule := range req.Rules {
		target := rule.Target
		if rule.ChainType > 0 && rule.NextHopIP != "" {
			target = net.JoinHostPort(rule.NextHopIP, strconv.Itoa(rule.NextHopPort))
		}
		if target != "" {
			if err := w.nftablesMgr.UpdateRule(rule.ForwardID, rule.Protocol, rule.Port, target, rule.SpeedLimit, rule.ChainType); err != nil {
				return fmt.Errorf("update rule for forward %d/%s: %w", rule.ForwardID, rule.Protocol, err)
			}
		}
		// 如果有 IPv6 下一跳，额外更新 IPv6 规则
		if rule.NextHopIPv6 != "" {
			ipv6Target := net.JoinHostPort(rule.NextHopIPv6, strconv.Itoa(rule.NextHopPort))
			if err := w.nftablesMgr.UpdateRule(rule.ForwardID, rule.Protocol, rule.Port, ipv6Target, rule.SpeedLimit, rule.ChainType); err != nil {
				return fmt.Errorf("update ipv6 rule for forward %d/%s: %w", rule.ForwardID, rule.Protocol, err)
			}
		}
	}
	return nil
}

// handleDeleteNftablesRules 处理删除 nftables 规则命令
func (w *WebSocketReporter) handleDeleteNftablesRules(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	var req DeleteNftablesRulesRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	protocols := req.Protocols
	if len(protocols) == 0 {
		protocols = []string{"tcp", "udp"}
	}

	var errs []error
	for _, forwardID := range req.ForwardIDs {
		for _, protocol := range protocols {
			// 如果有端口信息，使用精确匹配删除
			if len(req.Ports) > 0 {
				for _, port := range req.Ports {
					if err := w.nftablesMgr.DeleteRuleWithPort(forwardID, protocol, port); err != nil {
						errs = append(errs, fmt.Errorf("delete rule forwardID=%d/%s:%d: %w", forwardID, protocol, port, err))
					}
				}
			} else {
				// 向后兼容：没有端口信息时使用 forwardID 删除
				if err := w.nftablesMgr.DeleteRule(forwardID, protocol); err != nil {
					errs = append(errs, fmt.Errorf("delete rule forwardID=%d/%s: %w", forwardID, protocol, err))
				}
			}
		}
	}

	if len(errs) > 0 {
		fmt.Printf("️ DeleteNftablesRules errors: %v\n", errs)
		return fmt.Errorf("some rules failed to delete: %v", errs)
	}
	return nil
}

// handleGetNftablesCounters 处理获取计数器命令
func (w *WebSocketReporter) handleGetNftablesCounters(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	counters := w.nftablesMgr.GetCounters()
	var results []nftables.CounterResult
	for _, c := range counters {
		results = append(results, c)
	}
	return nil
}

// handleResetNftablesCounters 处理重置计数器命令
func (w *WebSocketReporter) handleResetNftablesCounters(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	if err := w.nftablesMgr.ResetCounters(); err != nil {
		return fmt.Errorf("reset counters: %w", err)
	}
	w.nftablesPrevMu.Lock()
	w.nftablesPrevCounters = make(map[string]uint64)
	w.nftablesPrevMu.Unlock()
	return nil
}

// CleanStaleNftRulesRequest 清理残留 nft 规则请求
type CleanStaleNftRulesRequest struct {
	ActiveForwardIDs []int64 `json:"active_forward_ids"`
}

// handleCleanStaleNftRules 清理不属于活跃 forward 的残留 nft 规则
func (w *WebSocketReporter) handleCleanStaleNftRules(data json.RawMessage) error {
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	var req CleanStaleNftRulesRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	activeIDs := make(map[int64]bool, len(req.ActiveForwardIDs))
	for _, id := range req.ActiveForwardIDs {
		activeIDs[id] = true
	}

	return w.nftablesMgr.ClearStaleDNATRules(activeIDs)
}
