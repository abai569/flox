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
	// 清理内核中残留的旧 DNAT 规则，防止 agent 重启后重复添加
	// 面板会通过 WebSocket 重新同步所有活跃规则
	if err := m.clearStaleRules(); err != nil {
		fmt.Printf("⚠️ clear stale rules failed: %v\n", err)
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

	// 检查并添加 MASQUERADE 规则（避免重复）
	postroutingChain := &nftables.Chain{
		Name:  PostroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, postroutingChain)
	if err != nil {
		return fmt.Errorf("get postrouting rules: %w", err)
	}
	hasMasq := false
	for _, r := range rules {
		for _, e := range r.Exprs {
			if _, ok := e.(*expr.Masq); ok {
				hasMasq = true
				break
			}
		}
		if hasMasq {
			break
		}
	}
	if !hasMasq {
		m.conn.AddRule(&nftables.Rule{
			Table: m.table,
			Chain: postroutingChain,
			Exprs: []expr.Any{&expr.Masq{}},
		})
	}
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
		fmt.Printf("️ DeleteRule: rule not in memory map %s, attempting kernel deletion\n", key)
		return m.deleteRuleFromKernel(forwardID, protocol)
	}

	// 从内存中移除，但不用 rs.Rule 删内核 — AddRule 不返回有效 handle
	delete(m.rules, key)
	if rs.Rule != nil && rs.Rule.Handle != 0 {
		m.conn.DelRule(rs.Rule)
		return m.conn.Flush()
	}
	return m.deleteRuleFromKernel(forwardID, protocol)
}

// DeleteRuleWithPort 通过 forwardID+协议+端口删除规则（精确匹配）
func (m *Manager) DeleteRuleWithPort(forwardID int64, protocol string, port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := ruleKey(forwardID, protocol)
	rs, exists := m.rules[key]
	if !exists {
		fmt.Printf("️ DeleteRuleWithPort: rule not in memory map %s, attempting kernel deletion\n", key)
		return m.deleteRuleByPortFromKernel(protocol, port)
	}

	// 从内存中移除，但不用 rs.Rule 删内核 — AddRule 不返回有效 handle
	// 直接通过协议+端口扫描内核删除
	delete(m.rules, key)
	return m.deleteRuleByPortFromKernel(protocol, port)
}

// DeleteRuleByPort 通过协议+端口从内核删除规则（更精确的匹配）
func (m *Manager) DeleteRuleByPort(protocol string, port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 先从内存 map 中查找
	for key, rs := range m.rules {
		if rs.Protocol == protocol && rs.Port == port {
			if rs.Rule != nil {
				m.conn.DelRule(rs.Rule)
			}
			delete(m.rules, key)
			fmt.Printf("✅ Deleted rule from memory map: %s\n", key)
			return m.conn.Flush()
		}
	}

	// 内存中没有，从内核直接删除
	fmt.Printf("⚠️ DeleteRuleByPort: rule not in memory map %s/%d, attempting kernel deletion\n", protocol, port)
	return m.deleteRuleByPortFromKernel(protocol, port)
}

// deleteRuleByPortFromKernel 通过协议+端口直接从内核删除规则
func (m *Manager) deleteRuleByPortFromKernel(protocol string, port int) error {
	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, preroutingChain)
	if err != nil {
		return fmt.Errorf("get prerouting rules: %w", err)
	}

	protoNum := uint8(unix.IPPROTO_TCP)
	if protocol == "udp" {
		protoNum = uint8(unix.IPPROTO_UDP)
	}
	portBytes := []byte{byte(port >> 8), byte(port & 0xFF)}

	deleted := false
	for _, rule := range rules {
		if isMasqueradeRule(rule) {
			continue
		}

		// 分两遍独立匹配：先匹配协议，再匹配端口（不依赖表达式顺序）
		protoMatch := matchProtoInRule(rule, byte(protoNum))
		portMatch := matchPortInRule(rule, portBytes)

		if protoMatch && portMatch {
			m.conn.DelRule(rule)
			deleted = true
			fmt.Printf("✅ Deleted kernel rule: %s port %d\n", protocol, port)
		}
	}

	if !deleted {
		fmt.Printf("⚠️ No matching kernel rule found for %s port %d (total prerouting rules: %d)\n", protocol, port, len(rules))
		for i, rule := range rules {
			if !isMasqueradeRule(rule) {
				fmt.Printf("  rule[%d] exprs: %d\n", i, len(rule.Exprs))
			}
		}
	}

	return m.conn.Flush()
}

// deleteRuleFromKernel 直接从内核删除规则，不依赖内存 map
// 当没有端口信息时的兜底策略：仅匹配协议，并借助内存 map 补充端口匹配
func (m *Manager) deleteRuleFromKernel(forwardID int64, protocol string) error {
	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, preroutingChain)
	if err != nil {
		return fmt.Errorf("get prerouting rules: %w", err)
	}

	protoNum := uint8(unix.IPPROTO_TCP)
	if protocol == "udp" {
		protoNum = uint8(unix.IPPROTO_UDP)
	}

	// 尝试从内存 map 中获取端口信息
	portBytes := findPortInRulesMap(m.rules, forwardID, protocol)

	deleted := false
	for _, rule := range rules {
		if isMasqueradeRule(rule) {
			continue
		}

		if !matchProtoInRule(rule, byte(protoNum)) {
			continue
		}

		// 如果有端口信息，精确匹配端口
		if portBytes != nil {
			if !matchPortInRule(rule, portBytes) {
				continue
			}
		}

		m.conn.DelRule(rule)
		deleted = true
		fmt.Printf("✅ Deleted kernel rule for forwardID=%d protocol=%s\n", forwardID, protocol)
		break
	}

	if !deleted {
		fmt.Printf("⚠️ No matching kernel rule found for forwardID=%d protocol=%s\n", forwardID, protocol)
	}

	return m.conn.Flush()
}

func findPortInRulesMap(rules map[string]*RuleState, forwardID int64, protocol string) []byte {
	key := ruleKey(forwardID, protocol)
	if rs, ok := rules[key]; ok {
		port := rs.Port
		return []byte{byte(port >> 8), byte(port & 0xFF)}
	}
	return nil
}

func isMasqueradeRule(rule *nftables.Rule) bool {
	for _, e := range rule.Exprs {
		if _, ok := e.(*expr.Masq); ok {
			return true
		}
	}
	return false
}

func matchProtoInRule(rule *nftables.Rule, protoByte byte) bool {
	for _, e := range rule.Exprs {
		if cmp, ok := e.(*expr.Cmp); ok && cmp.Register == 1 {
			if len(cmp.Data) == 1 && cmp.Data[0] == protoByte {
				return true
			}
		}
	}
	return false
}

func matchPortInRule(rule *nftables.Rule, portBytes []byte) bool {
	if len(portBytes) != 2 {
		return false
	}
	for _, e := range rule.Exprs {
		if cmp, ok := e.(*expr.Cmp); ok && cmp.Register == 1 {
			if len(cmp.Data) == 2 && cmp.Data[0] == portBytes[0] && cmp.Data[1] == portBytes[1] {
				return true
			}
		}
	}
	return false
}

// ClearStaleDNATRules 清理所有不属于当前活跃转发的 DNAT 规则
// 启动时调用，确保没有残留的无用规则
func (m *Manager) ClearStaleDNATRules(activeForwardIDs map[int64]bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, preroutingChain)
	if err != nil {
		return fmt.Errorf("get prerouting rules: %w", err)
	}

	deleted := 0
	for _, rule := range rules {
		// 跳过 MASQUERADE 规则
		isMasq := false
		for _, e := range rule.Exprs {
			if _, ok := e.(*expr.Masq); ok {
				isMasq = true
				break
			}
		}
		if isMasq {
			continue
		}

		// 检查这条规则是否属于活跃转发
		// 通过 counter name 中的 forwardID 来判断
		isActive := false
		for _, e := range rule.Exprs {
			if ctr, ok := e.(*expr.Counter); ok {
				// 检查内存中是否有对应的规则
				for _, rs := range m.rules {
					if rs.Rule != nil && rs.Rule.Handle == rule.Handle {
						if activeForwardIDs[rs.ForwardID] {
							isActive = true
						}
						break
					}
				}
				_ = ctr // counter 本身不携带 forwardID 信息
			}
		}

		// 如果不在活跃列表中，删除
		if !isActive {
			m.conn.DelRule(rule)
			deleted++
		}
	}

	if deleted > 0 {
		fmt.Printf("🧹 Cleared %d stale DNAT rules\n", deleted)
	}
	return m.conn.Flush()
}

// GetAllKernelRules 获取内核中所有 DNAT 规则（用于调试）
func (m *Manager) GetAllKernelRules() ([]*nftables.Rule, error) {
	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, preroutingChain)
	if err != nil {
		return nil, fmt.Errorf("get prerouting rules: %w", err)
	}

	var dnatRules []*nftables.Rule
	for _, rule := range rules {
		isMasq := false
		for _, e := range rule.Exprs {
			if _, ok := e.(*expr.Masq); ok {
				isMasq = true
				break
			}
		}
		if !isMasq {
			dnatRules = append(dnatRules, rule)
		}
	}
	return dnatRules, nil
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

// clearStaleRules 清理内核中残留的旧 DNAT 规则（保留 MASQUERADE）
// 防止 agent 重启后重复添加规则。面板会通过 WebSocket 重新同步所有活跃规则。
func (m *Manager) clearStaleRules() error {
	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
	}
	rules, err := m.conn.GetRules(m.table, preroutingChain)
	if err != nil {
		return fmt.Errorf("get prerouting rules: %w", err)
	}

	deleted := 0
	for _, rule := range rules {
		// 保留 MASQUERADE 规则
		isMasq := false
		for _, e := range rule.Exprs {
			if _, ok := e.(*expr.Masq); ok {
				isMasq = true
				break
			}
		}
		if isMasq {
			fmt.Printf("🔒 Keeping MASQUERADE rule\n")
			continue
		}
		// 删除所有 DNAT 规则（面板会重新同步）
		m.conn.DelRule(rule)
		deleted++
		fmt.Printf("🗑️  Deleted stale DNAT rule (handle=%d)\n", rule.Handle)
	}

	if deleted > 0 {
		fmt.Printf("🧹 Cleared %d stale DNAT rules on startup\n", deleted)
	}
	return m.conn.Flush()
}
