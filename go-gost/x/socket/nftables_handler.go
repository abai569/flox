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
	ForwardID   int64  `json:"forward_id"`
	NodeID      int64  `json:"node_id"`
	Protocol    string `json:"protocol"`
	Port        int    `json:"port"`
	Target      string `json:"target"`
	SpeedLimit  int    `json:"speed_limit"`
	ChainType   int    `json:"chain_type"`
	NextHopIP   string `json:"next_hop_ip"`
	NextHopPort int    `json:"next_hop_port"`
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
	fmt.Printf("DEBUG handleAddNftablesRules raw data: %s\n", string(data))
	if w.nftablesMgr == nil {
		return fmt.Errorf("nftables manager not initialized")
	}

	var req AddNftablesRulesRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	fmt.Printf("DEBUG handleAddNftablesRules parsed rules count: %d\n", len(req.Rules))
	for i, rule := range req.Rules {
		fmt.Printf("DEBUG rule[%d]: ForwardID=%d NodeID=%d Protocol=%s Port=%d Target=%q ChainType=%d NextHopIP=%q NextHopPort=%d\n",
			i, rule.ForwardID, rule.NodeID, rule.Protocol, rule.Port, rule.Target, rule.ChainType, rule.NextHopIP, rule.NextHopPort)
	}

	if len(req.Rules) == 0 {
		return fmt.Errorf("rules list cannot be empty")
	}

	for _, rule := range req.Rules {
		target := rule.Target
		if rule.ChainType > 0 && rule.NextHopIP != "" {
			target = net.JoinHostPort(rule.NextHopIP, strconv.Itoa(rule.NextHopPort))
		}
		if err := w.nftablesMgr.AddRule(rule.ForwardID, rule.NodeID, rule.Protocol, rule.Port, target, rule.SpeedLimit); err != nil {
			return fmt.Errorf("add rule for forward %d/%s (target=%q): %w", rule.ForwardID, rule.Protocol, target, err)
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
		if err := w.nftablesMgr.UpdateRule(rule.ForwardID, rule.Protocol, rule.Port, target, rule.SpeedLimit); err != nil {
			return fmt.Errorf("update rule for forward %d/%s: %w", rule.ForwardID, rule.Protocol, err)
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
		results = append(results, nftables.CounterResult{
			ForwardID: c.ForwardID,
			Protocol:  c.Protocol,
			Port:      c.Port,
			Packets:   c.Packets,
			Bytes:     c.Bytes,
		})
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
	w.nftablesPrevCounters = make(map[int64]uint64)
	w.nftablesPrevMu.Unlock()
	return nil
}
