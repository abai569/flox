//go:build linux

package nftables

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
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
	enableIPForwarding()
	return m, nil
}

func enableIPForwarding() {
	if err := exec.Command("sysctl", "-w", "net.ipv4.ip_forward=1").Run(); err != nil {
		fmt.Printf("⚠️ 设置 IPv4 转发失败: %v\n", err)
	}
	if err := exec.Command("sysctl", "-w", "net.ipv6.conf.all.forwarding=1").Run(); err != nil {
		fmt.Printf("⚠️ 设置 IPv6 转发失败: %v\n", err)
	}
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
	// Add masquerade rule to postrouting chain so that DNAT'd packets
	// get source-NAT'd, ensuring return traffic goes back through this node.
	postroutingChain := &nftables.Chain{
		Name:  PostroutingChain,
		Table: m.table,
	}
	m.conn.AddRule(&nftables.Rule{
		Table: m.table,
		Chain: postroutingChain,
		Exprs: []expr.Any{&expr.Masq{}},
	})
	return m.conn.Flush()
}

func (m *Manager) AddRule(forwardID, nodeID int64, protocol string, port int, target string, speedLimit int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	fmt.Printf("DEBUG AddRule: forwardID=%d protocol=%s port=%d target=%q speedLimit=%d\n", forwardID, protocol, port, target, speedLimit)

	key := ruleKey(forwardID, protocol)
	if _, exists := m.rules[key]; exists {
		return fmt.Errorf("rule already exists: %s", key)
	}

	dnatAddr, dnatPort := parseTarget(target)

	// Get prerouting chain
	preroutingChain := &nftables.Chain{
		Name:   PreroutingChain,
		Table:  m.table,
	}

	// Build match expressions: match protocol and ingress port
	var ruleExprs []expr.Any

	// Match protocol (tcp/udp)
	var protoNum uint32
	switch protocol {
	case "tcp":
		protoNum = unix.IPPROTO_TCP
	case "udp":
		protoNum = unix.IPPROTO_UDP
	default:
		return fmt.Errorf("unsupported protocol: %s", protocol)
	}

	ruleExprs = append(ruleExprs, &expr.Meta{Key: expr.MetaKeyL4PROTO, Register: 1})
	ruleExprs = append(ruleExprs, &expr.Cmp{
		Op:       expr.CmpOpEq,
		Register: 1,
		Data:     []byte{byte(protoNum)},
	})

	// Match ingress (listening) port
	portBytes := []byte{byte(port >> 8), byte(port & 0xFF)}
	ruleExprs = append(ruleExprs, &expr.Payload{
		DestRegister: 1,
		Base:         expr.PayloadBaseTransportHeader,
		Offset:       2,
		Len:          2,
	})
	ruleExprs = append(ruleExprs, &expr.Cmp{
		Op:       expr.CmpOpEq,
		Register: 1,
		Data:     portBytes,
	})

	// Speed limit
	if speedLimit > 0 {
		ruleExprs = append(ruleExprs, &expr.Limit{
			Type: expr.LimitTypePkts,
			Rate: uint64(speedLimit),
		})
	}

	// Counter
	counterName := fmt.Sprintf("ctr_fwd_%d_%s", forwardID, protocol)
	ruleExprs = append(ruleExprs, &expr.Counter{})

	// DNAT: load target address and port into registers, then apply NAT
	ip := net.ParseIP(dnatAddr)
	if ip == nil {
		return fmt.Errorf("invalid target IP: %s", dnatAddr)
	}

	var natFamily uint32
	var ipBytes []byte
	if ip4 := ip.To4(); ip4 != nil {
		natFamily = unix.NFPROTO_IPV4
		ipBytes = ip4
	} else {
		natFamily = unix.NFPROTO_IPV6
		ipBytes = ip.To16()
	}

	// Load destination address into register 1
	ruleExprs = append(ruleExprs, &expr.Immediate{
		Register: 1,
		Data:     ipBytes,
	})
	// Load destination port into register 2 (network byte order)
	portNet := []byte{byte(dnatPort >> 8), byte(dnatPort & 0xFF)}
	ruleExprs = append(ruleExprs, &expr.Immediate{
		Register: 2,
		Data:     portNet,
	})
	// Apply DNAT
	ruleExprs = append(ruleExprs, &expr.NAT{
		Type:        expr.NATTypeDestNAT,
		Family:      natFamily,
		RegAddrMin:  1,
		RegProtoMin: 2,
	})

	rule := &nftables.Rule{
		Table: m.table,
		Chain: preroutingChain,
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
		Chain:       preroutingChain,
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
	// Do not delete the chain - rules now use shared prerouting chain
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
	target = strings.TrimSpace(target)
	fmt.Printf("DEBUG parseTarget input: %q\n", target)
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		fmt.Printf("DEBUG parseTarget SplitHostPort failed: %v\n", err)
		return "", 0
	}
	port, _ := strconv.Atoi(portStr)
	fmt.Printf("DEBUG parseTarget result: host=%q port=%d\n", host, port)
	return host, port
}

func CheckNftablesSupport() (bool, error) {
	conn, err := nftables.New()
	if err != nil {
		return false, fmt.Errorf("nftables not available: %w", err)
	}
	conn.CloseLasting()
	return true, nil
}
