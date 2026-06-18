//go:build linux

package nftables

import (
	"bytes"
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
	TableName        = "FLOX"
	TableFamily      = nftables.TableFamilyINet
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
	ForwardID    int64
	NodeID       int64
	UserID       int64
	UserTunnelID int64
	Protocol     string
	Port         int
	Target       string
	SpeedLimit   int
	ChainType    int
	Chain        *nftables.Chain
	Rule         *nftables.Rule
	CounterName  string
}

type CounterResult struct {
	ForwardID    int64  `json:"forward_id"`
	UserID       int64  `json:"user_id"`
	UserTunnelID int64  `json:"user_tunnel_id"`
	Protocol     string `json:"protocol"`
	Port         int    `json:"port"`
	Packets      uint64 `json:"packets"`
	Bytes        uint64 `json:"bytes"`
	NodeID       int64  `json:"node_id"`
	ChainType    int    `json:"chain_type"`
}

type ConntrackByteResult struct {
	ForwardID    int64  `json:"forward_id"`
	UserID       int64  `json:"user_id"`
	UserTunnelID int64  `json:"user_tunnel_id"`
	Protocol     string `json:"protocol"`
	Port         int    `json:"port"`
	Bytes        uint64 `json:"bytes"`
	NodeID       int64  `json:"node_id"`
	ChainType    int    `json:"chain_type"`
}

type RuleConnInfo struct {
	ForwardID int64  `json:"forward_id"`
	UserID    int64  `json:"user_id"`
	TunnelID  int64  `json:"tunnel_id"`
	Protocol  string `json:"protocol"`
	Port      int    `json:"port"`
	ConnCount int    `json:"conn_count"`
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
	if err := exec.Command("sysctl", "-w", "net.netfilter.nf_conntrack_acct=1").Run(); err != nil {
		fmt.Printf("⚠️ 开启 conntrack 字节统计失败: %v\n", err)
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

func (m *Manager) AddRule(forwardID, nodeID, userID, userTunnelID int64, protocol string, port int, target string, speedLimit int, chainType int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	dnatAddr, dnatPort := parseTarget(target)

	key := ruleKey(forwardID, protocol, port, dnatAddr)
	if _, exists := m.rules[key]; exists {
		return fmt.Errorf("rule already exists: %s", key)
	}

	// Get prerouting chain
	preroutingChain := &nftables.Chain{
		Name:  PreroutingChain,
		Table: m.table,
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
		ForwardID:    forwardID,
		NodeID:       nodeID,
		UserID:       userID,
		UserTunnelID: userTunnelID,
		Protocol:     protocol,
		Port:         port,
		Target:       target,
		SpeedLimit:   speedLimit,
		ChainType:    chainType,
		Chain:        preroutingChain,
		Rule:         rule,
		CounterName:  counterName,
	}
	return nil
}

func (m *Manager) UpdateRule(forwardID int64, protocol string, port int, target string, speedLimit int, chainType int) error {
	m.mu.RLock()
	var userID, userTunnelID int64
	prefix := fmt.Sprintf("%d_%s_%d_", forwardID, protocol, port)
	for key, rs := range m.rules {
		if strings.HasPrefix(key, prefix) {
			userID = rs.UserID
			userTunnelID = rs.UserTunnelID
			break
		}
	}
	m.mu.RUnlock()

	if err := m.DeleteRule(forwardID, protocol); err != nil {
		return err
	}
	return m.AddRule(forwardID, 0, userID, userTunnelID, protocol, port, target, speedLimit, chainType)
}

func (m *Manager) DeleteRule(forwardID int64, protocol string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	prefix := fmt.Sprintf("%d_%s_", forwardID, protocol)
	var matchedKeys []string
	for key := range m.rules {
		if strings.HasPrefix(key, prefix) {
			matchedKeys = append(matchedKeys, key)
		}
	}

	if len(matchedKeys) == 0 {
		fmt.Printf("⚠️ DeleteRule: no rules in memory map for forwardID=%d protocol=%s, attempting kernel deletion\n", forwardID, protocol)
		return m.deleteRuleFromKernel(forwardID, protocol)
	}

	var errs []error
	for _, key := range matchedKeys {
		rs := m.rules[key]
		delete(m.rules, key)
		if rs.Rule != nil && rs.Rule.Handle != 0 {
			m.conn.DelRule(rs.Rule)
		} else {
			if err := m.deleteRuleFromKernel(forwardID, protocol); err != nil {
				errs = append(errs, err)
			}
			continue
		}
	}
	if len(errs) > 0 {
		return errs[0]
	}
	return m.conn.Flush()
}

// DeleteRuleWithPort 通过 forwardID+协议+端口删除规则（精确匹配）
func (m *Manager) DeleteRuleWithPort(forwardID int64, protocol string, port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	prefix := fmt.Sprintf("%d_%s_%d_", forwardID, protocol, port)
	var matchedKeys []string
	var targets []string
	for key, rs := range m.rules {
		if strings.HasPrefix(key, prefix) {
			matchedKeys = append(matchedKeys, key)
			targets = append(targets, rs.Target)
		}
	}

	if len(matchedKeys) == 0 {
		fmt.Printf("⚠️ DeleteRuleWithPort: no rules in memory map for forwardID=%d/%s:%d, attempting kernel deletion\n", forwardID, protocol, port)
		return m.deleteRuleByPortFromKernel(protocol, port, "")
	}

	for i, key := range matchedKeys {
		delete(m.rules, key)
		if err := m.deleteRuleByPortFromKernel(protocol, port, targets[i]); err != nil {
			fmt.Printf("⚠️ DeleteRuleWithPort: delete kernel rule failed for %s: %v\n", key, err)
		}
	}
	return m.conn.Flush()
}

// DeleteRuleByPort 通过协议+端口从内核删除规则
func (m *Manager) DeleteRuleByPort(protocol string, port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var matchedKeys []string
	for key, rs := range m.rules {
		if rs.Protocol == protocol && rs.Port == port {
			matchedKeys = append(matchedKeys, key)
		}
	}

	for _, key := range matchedKeys {
		delete(m.rules, key)
		fmt.Printf("✅ Removed rule from memory map: %s\n", key)
	}

	return m.deleteRuleByPortFromKernel(protocol, port, "")
}

// deleteRuleByPortFromKernel 通过协议+端口从内核删除规则
// 当 target 非空时，额外匹配 DNAT 目标地址，避免误删同端口其他 forward 的规则
func (m *Manager) deleteRuleByPortFromKernel(protocol string, port int, target string) error {
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
			if target != "" && !matchNATTargetInRule(rule, target) {
				continue
			}
			m.conn.DelRule(rule)
			deleted = true
			fmt.Printf("✅ Deleted kernel rule: %s port %d target=%s\n", protocol, port, target)
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
	prefix := fmt.Sprintf("%d_%s_", forwardID, protocol)
	for key, rs := range rules {
		if strings.HasPrefix(key, prefix) {
			port := rs.Port
			return []byte{byte(port >> 8), byte(port & 0xFF)}
		}
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

// matchNATTargetInRule checks if a kernel nft rule contains a DNAT target matching the given host:port.
func matchNATTargetInRule(rule *nftables.Rule, target string) bool {
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	var ipBytes []byte
	if ip4 := ip.To4(); ip4 != nil {
		ipBytes = ip4
	} else {
		ipBytes = ip.To16()
	}
	if ipBytes == nil {
		return false
	}
	port, _ := strconv.Atoi(portStr)
	portBytes := []byte{byte(port >> 8), byte(port & 0xFF)}

	for i, e := range rule.Exprs {
		if _, ok := e.(*expr.NAT); !ok {
			continue
		}
		if i < 2 {
			continue
		}
		imm2, ok2 := rule.Exprs[i-1].(*expr.Immediate)
		imm1, ok1 := rule.Exprs[i-2].(*expr.Immediate)
		if ok1 && ok2 && len(imm1.Data) == len(ipBytes) && len(imm2.Data) == 2 {
			if bytes.Equal(imm1.Data, ipBytes) && bytes.Equal(imm2.Data, portBytes) {
				return true
			}
		}
	}
	return false
}

// ClearStaleDNATRules 清理所有不属于当前活跃转发的 DNAT 规则
// 通过匹配协议+端口+DNAT目标来识别活跃规则，删除不匹配的残留规则
func (m *Manager) ClearStaleDNATRules(activeForwardIDs map[int64]bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Build set of active rule keys: "protocol_port_target"
	activeKeys := make(map[string]bool)
	for _, rs := range m.rules {
		if activeForwardIDs[rs.ForwardID] {
			dnatAddr, _ := parseTarget(rs.Target)
			key := fmt.Sprintf("%s_%d_%s", rs.Protocol, rs.Port, dnatAddr)
			activeKeys[key] = true
		}
	}

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
		if isMasqueradeRule(rule) {
			continue
		}

		// Extract protocol, port, and DNAT target from kernel rule
		var protocol string
		var port int
		protoFound := false
		portFound := false

		for _, e := range rule.Exprs {
			switch ex := e.(type) {
			case *expr.Cmp:
				if len(ex.Data) == 1 {
					switch ex.Data[0] {
					case unix.IPPROTO_TCP:
						protocol = "tcp"
						protoFound = true
					case unix.IPPROTO_UDP:
						protocol = "udp"
						protoFound = true
					}
				} else if len(ex.Data) == 2 {
					port = int(ex.Data[0])<<8 | int(ex.Data[1])
					portFound = true
				}
			}
		}

		if protoFound && portFound {
			natTarget := extractNATTarget(rule)
			key := fmt.Sprintf("%s_%d_%s", protocol, port, natTarget)
			if !activeKeys[key] {
				m.conn.DelRule(rule)
				deleted++
				fmt.Printf("🧹 Deleted stale DNAT rule: %s %d -> %s\n", protocol, port, natTarget)
			}
		}
	}

	if deleted > 0 {
		fmt.Printf("🧹 Cleared %d stale DNAT rules\n", deleted)
	}
	return m.conn.Flush()
}

// extractNATTarget extracts the DNAT target IP from a kernel nft rule.
// Rule matching keys already include the listen port, so keep this aligned with parseTarget.
func extractNATTarget(rule *nftables.Rule) string {
	for i, e := range rule.Exprs {
		if _, ok := e.(*expr.NAT); !ok {
			continue
		}
		if i < 2 {
			continue
		}
		imm2, ok2 := rule.Exprs[i-1].(*expr.Immediate)
		imm1, ok1 := rule.Exprs[i-2].(*expr.Immediate)
		if !ok1 || !ok2 {
			continue
		}
		if len(imm2.Data) != 2 {
			continue
		}
		ip := net.IP(imm1.Data)
		if ip == nil {
			continue
		}
		return ip.String()
	}
	return ""
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
						ForwardID:    rs.ForwardID,
						UserID:       rs.UserID,
						UserTunnelID: rs.UserTunnelID,
						Protocol:     rs.Protocol,
						Port:         rs.Port,
						Packets:      ctr.Packets,
						Bytes:        ctr.Bytes,
						NodeID:       rs.NodeID,
						ChainType:    rs.ChainType,
					})
				}
			}
		}
	}
	return results
}
// RefreshCounters fetches latest counter values from kernel via conn.GetRules().
// It matches kernel rules to stored rules by protocol + port, and returns fresh counter data.
func (m *Manager) RefreshCounters() []CounterResult {
	rules, err := m.GetAllKernelRules()
	if err != nil {
		fmt.Printf("⚠️ [nft] GetAllKernelRules failed: %v, fallback to in-memory counters\n", err)
		return m.GetCounters()
	}

	// Parse kernel rules: extract proto+port from Cmp expressions, counter values, and DNAT target
	type kernelEntry struct {
		protocol string
		port     int
		target   string
		packets  uint64
		bytes    uint64
	}
	var kernelEntries []kernelEntry

	for _, rule := range rules {
		var protocol string
		var port int
		var packets, bytes uint64
		protoFound := false
		portFound := false
		counterFound := false

		for _, e := range rule.Exprs {
			switch ex := e.(type) {
			case *expr.Cmp:
				if len(ex.Data) == 1 {
					switch ex.Data[0] {
					case unix.IPPROTO_TCP:
						protocol = "tcp"
						protoFound = true
					case unix.IPPROTO_UDP:
						protocol = "udp"
						protoFound = true
					}
				} else if len(ex.Data) == 2 {
					port = int(ex.Data[0])<<8 | int(ex.Data[1])
					portFound = true
				}
			case *expr.Counter:
				packets = ex.Packets
				bytes = ex.Bytes
				counterFound = true
			}
		}

		if protoFound && portFound && counterFound {
			natTarget := extractNATTarget(rule)
			kernelEntries = append(kernelEntries, kernelEntry{
				protocol: protocol,
				port:     port,
				target:   natTarget,
				packets:  packets,
				bytes:    bytes,
			})
		}
	}

	fmt.Printf("[nft] RefreshCounters: kernelRules=%d, parsedEntries=%d, storedRules=%d\n", len(rules), len(kernelEntries), len(m.rules))

	// Build port_protocol_target lookup from kernel entries
	kernelMultiMap := make(map[string][]kernelEntry)
	for _, ke := range kernelEntries {
		key := fmt.Sprintf("%s_%d_%s", ke.protocol, ke.port, ke.target)
		kernelMultiMap[key] = append(kernelMultiMap[key], ke)
	}

	// Match against stored rules by protocol + port + DNAT target, return fresh counters
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []CounterResult
	for _, rs := range m.rules {
		dnatAddr, _ := parseTarget(rs.Target)
		key := fmt.Sprintf("%s_%d_%s", rs.Protocol, rs.Port, dnatAddr)
		if entries, ok := kernelMultiMap[key]; ok && len(entries) > 0 {
			ke := entries[0]
			// Update in-memory counter objects so GetCounters also returns fresh data
			if rs.Rule != nil {
				for _, e := range rs.Rule.Exprs {
					if ctr, ok := e.(*expr.Counter); ok {
						ctr.Packets = ke.packets
						ctr.Bytes = ke.bytes
						break
					}
				}
			}
			results = append(results, CounterResult{
				ForwardID:    rs.ForwardID,
				UserID:       rs.UserID,
				UserTunnelID: rs.UserTunnelID,
				Protocol:     ke.protocol,
				Port:         ke.port,
				Packets:      ke.packets,
				Bytes:        ke.bytes,
				NodeID:       rs.NodeID,
				ChainType:    rs.ChainType,
			})
		} else {
			// Fallback to in-memory counter
			if rs.Rule != nil {
				for _, e := range rs.Rule.Exprs {
					if ctr, ok := e.(*expr.Counter); ok {
						results = append(results, CounterResult{
							ForwardID:    rs.ForwardID,
							UserID:       rs.UserID,
							UserTunnelID: rs.UserTunnelID,
							Protocol:     rs.Protocol,
							Port:         rs.Port,
							Packets:      ctr.Packets,
							Bytes:        ctr.Bytes,
							NodeID:       rs.NodeID,
							ChainType:    rs.ChainType,
						})
						break
					}
				}
			}
		}
	}

	fmt.Printf("[nft] RefreshCounters: matched=%d results\n", len(results))
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

func (m *Manager) CountConnectionsByRule() ([]RuleConnInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.rules) == 0 {
		return nil, nil
	}

	snap, err := CountActiveConnections()
	if err != nil {
		return nil, err
	}

	aggregated := make(map[int64]RuleConnInfo)
	for _, rs := range m.rules {
		key := fmt.Sprintf("%s:%d", rs.Protocol, rs.Port)
		info := aggregated[rs.ForwardID]
		if info.ForwardID == 0 {
			info = RuleConnInfo{
				ForwardID: rs.ForwardID,
				UserID:    rs.UserID,
				TunnelID:  rs.UserTunnelID,
				Protocol:  rs.Protocol,
				Port:      rs.Port,
			}
		}
		info.ConnCount += snap[key]
		aggregated[rs.ForwardID] = info
	}

	results := make([]RuleConnInfo, 0, len(aggregated))
	for _, info := range aggregated {
		results = append(results, info)
	}
	return results, nil
}

func (m *Manager) CountConnectionBytesByRule() ([]ConntrackByteResult, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.rules) == 0 {
		return nil, nil
	}

	snap, err := CountActiveConnectionBytes()
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	results := make([]ConntrackByteResult, 0, len(m.rules))
	for _, rs := range m.rules {
		if rs.ChainType == 3 {
			continue
		}
		key := fmt.Sprintf("%s:%d", rs.Protocol, rs.Port)
		if seen[key] {
			continue
		}
		seen[key] = true

		bytes := snap[key]
		if bytes == 0 {
			continue
		}
		results = append(results, ConntrackByteResult{
			ForwardID:    rs.ForwardID,
			UserID:       rs.UserID,
			UserTunnelID: rs.UserTunnelID,
			Protocol:     rs.Protocol,
			Port:         rs.Port,
			Bytes:        bytes,
			NodeID:       rs.NodeID,
			ChainType:    rs.ChainType,
		})
	}

	return results, nil
}

func ruleKey(forwardID int64, protocol string, port int, targetIP string) string {
	return fmt.Sprintf("%d_%s_%d_%s", forwardID, protocol, port, targetIP)
}

func parseTarget(target string) (string, int) {
	target = strings.TrimSpace(target)
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		return "", 0
	}
	port, _ := strconv.Atoi(portStr)
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
