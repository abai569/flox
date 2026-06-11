package socket

import (
	"github.com/go-gost/x/nftables"
)

// NftablesManagerInterface defines the interface for nftables manager operations.
type NftablesManagerInterface interface {
	AddRule(forwardID, nodeID, userID, userTunnelID int64, protocol string, port int, target string, speedLimit int) error
	UpdateRule(forwardID int64, protocol string, port int, target string, speedLimit int) error
	DeleteRule(forwardID int64, protocol string) error
	DeleteRuleWithPort(forwardID int64, protocol string, port int) error
	GetCounters() []nftables.CounterResult
	RefreshCounters() []nftables.CounterResult
	CountConnectionsByRule() ([]nftables.RuleConnInfo, error)
	ResetCounters() error
}
