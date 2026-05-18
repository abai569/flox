//go:build linux

package nftables

import (
	"fmt"
	"sync"

	"github.com/google/nftables"
	"github.com/google/nftables/expr"
	"golang.org/x/sys/unix"
)

const (
	TableName      = "flvx"
	TableFamily    = nftables.TableFamilyINet
	PreroutingChain  = "prerouting"
	PostroutingChain = "postrouting"
)

type Manager struct {
	conn  *nftables.Conn
	table *nftables.Table
	rules map[string]*RuleState
	mu    sync.RWMutex
}

type RuleState struct {
	ForwardID   int64
	NodeID      int64
	Protocol    string
	Port        int
	Target      string
	SpeedLimit  int
	Chain       *nftables.Chain
	Rule        *nftables.Rule
	CounterName string
}

type CounterResult struct {
	ForwardID   int64  `json:"forward_id"`
	Protocol    string `json:"protocol"`
	Port        int    `json:"port"`
	Packets     uint64 `json:"packets"`
	Bytes       uint64 `json:"bytes"`
}

func NewManager() (*Manager, error) {
	conn, err := nftables.New()
	if err != nil {
		return nil, fmt.Errorf("open nftables: %w", err)
	}
	m := &Manager{
		conn:  conn,
		rules: make(map[string]*RuleState),
	}
	if err := m.initTable(); err != nil {
		return nil, fmt.Errorf("init table: %w", err)
	}
	return m, nil
}

func (m *Manager) initTable() error {
	table := &nftables.Table{
		Name:   TableName,
		Family: TableFamily,
	}
	m.conn.AddTable(table)
	if err := m.conn.Flush(); err != nil {
		return fmt.Errorf("add table: %w", err)
	}
	m.table = table
	if err := m.initChains(); err != nil {
		return fmt.Errorf("init chains: %w", err)
	}
	return nil
}

func (m *Manager) initChains() error {
	chains := []struct {
		name     string
		hook     *nftables.ChainHook
		priority *nftables.ChainPriority
	}{
		{
			name:     PreroutingChain,
			hook:     nftables.ChainHookPrerouting,
			priority: nftables.ChainPriorityNATDest,
		},
		{
			name:     PostroutingChain,
			hook:     nftables.ChainHookPostrouting,
			priority: nftables.ChainPriorityNATSource,
		},
	}
	for _, c := range chains {
		chain := &nftables.Chain{
			Name:     c.name,
			Table:    m.table,
			Hooknum:  c.hook,
			Priority: c.priority,
			Type:     nftables.ChainTypeNAT,
		}
		m.conn.AddChain(chain)
	}
	return m.conn.Flush()
}

func (m *Manager) AddRule(forwardID, nodeID int64, protocol string, port int, target string, speedLimit int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := ruleKey(forwardID, protocol)
	if _, exists := m.rules[key]; exists {
		return fmt.Errorf("rule already exists: %s", key)
	}

	chainName := fmt.Sprintf("fwd_%d_%s", forwardID, protocol)
	chain := &nftables.Chain{
		Name:  chainName,
		Table: m.table,
	}
	m.conn.AddChain(chain)

	var ruleExprs []expr.Any

	if speedLimit > 0 {
		ruleExprs = append(ruleExprs, &expr.Limit{
			Type: expr.LimitTypePkts,
			Rate: uint64(speedLimit),
		})
	}

	counterName := fmt.Sprintf("ctr_fwd_%d_%s", forwardID, protocol)
	ruleExprs = append(ruleExprs, &expr.Counter{})

	dnatAddr, dnatPort := parseTarget(target)
	_ = dnatAddr
	_ = dnatPort

	ruleExprs = append(ruleExprs, &expr.NAT{
		Type:   expr.NATTypeDestNAT,
		Family: unix.NFPROTO_IPV4,
	})

	rule := &nftables.Rule{
		Table: m.table,
		Chain: chain,
		Exprs: ruleExprs,
	}
	m.conn.AddRule(rule)

	if err := m.conn.Flush(); err != nil {
		return fmt.Errorf("add rule: %w", err)
	}

	m.rules[key] = &RuleState{
		ForwardID:   forwardID,
		NodeID:      nodeID,
		Protocol:    protocol,
		Port:        port,
		Target:      target,
		SpeedLimit:  speedLimit,
		Chain:       chain,
		Rule:        rule,
		CounterName: counterName,
	}
	return nil
}

func (m *Manager) UpdateRule(forwardID int64, protocol string, port int, target string, speedLimit int) error {
	if err := m.DeleteRule(forwardID, protocol); err != nil {
		return err
	}
	return m.AddRule(forwardID, 0, protocol, port, target, speedLimit)
}

func (m *Manager) DeleteRule(forwardID int64, protocol string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := ruleKey(forwardID, protocol)
	rs, exists := m.rules[key]
	if !exists {
		return fmt.Errorf("rule not found: %s", key)
	}

	if rs.Rule != nil {
		m.conn.DelRule(rs.Rule)
	}
	if rs.Chain != nil {
		m.conn.DelChain(rs.Chain)
	}
	delete(m.rules, key)
	return m.conn.Flush()
}

func (m *Manager) GetCounters() []CounterResult {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []CounterResult
	for _, rs := range m.rules {
		if rs.Rule != nil {
			for _, e := range rs.Rule.Exprs {
				if ctr, ok := e.(*expr.Counter); ok {
					results = append(results, CounterResult{
						ForwardID: rs.ForwardID,
						Protocol:  rs.Protocol,
						Port:      rs.Port,
						Packets:   ctr.Packets,
						Bytes:     ctr.Bytes,
					})
				}
			}
		}
	}
	return results
}

func (m *Manager) ResetCounters() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, rs := range m.rules {
		if rs.Rule != nil {
			for i, e := range rs.Rule.Exprs {
				if _, ok := e.(*expr.Counter); ok {
					rs.Rule.Exprs[i] = &expr.Counter{}
				}
			}
			m.conn.ReplaceRule(rs.Rule)
		}
	}
	return m.conn.Flush()
}

func ruleKey(forwardID int64, protocol string) string {
	return fmt.Sprintf("%d_%s", forwardID, protocol)
}

func parseTarget(target string) (string, int) {
	var addr string
	var port int
	fmt.Sscanf(target, "%[^:]:%d", &addr, &port)
	return addr, port
}

func CheckNftablesSupport() (bool, error) {
	conn, err := nftables.New()
	if err != nil {
		return false, fmt.Errorf("nftables not available: %w", err)
	}
	conn.Close()
	return true, nil
}