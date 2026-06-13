//go:build !linux

package socket

import (
	"encoding/json"
	"errors"
)

type AddNftablesRulesRequest struct {
	Rules []NftablesRulePayload `json:"rules"`
}

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

type UpdateNftablesRulesRequest struct {
	Rules []NftablesRulePayload `json:"rules"`
}

type DeleteNftablesRulesRequest struct {
	ForwardIDs []int64  `json:"forward_ids"`
	Protocols  []string `json:"protocols"`
}

type GetNftablesCountersRequest struct {
	ForwardIDs []int64 `json:"forward_ids"`
}

func (w *WebSocketReporter) handleAddNftablesRules(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}

func (w *WebSocketReporter) handleUpdateNftablesRules(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}

func (w *WebSocketReporter) handleDeleteNftablesRules(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}

func (w *WebSocketReporter) handleGetNftablesCounters(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}

func (w *WebSocketReporter) handleResetNftablesCounters(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}

type CleanStaleNftRulesRequest struct {
	ActiveForwardIDs []int64 `json:"active_forward_ids"`
}

func (w *WebSocketReporter) handleCleanStaleNftRules(data json.RawMessage) error {
	return errors.New("nftables not supported on this platform")
}
