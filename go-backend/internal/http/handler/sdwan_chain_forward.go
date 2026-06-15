package handler

import (
	"errors"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
)

func (h *Handler) syncSDWANChainForwardServicesWithWarnings(forward *forwardRecord, tunnel *tunnelRecord, ports []forwardPortRecord, userTunnelID int64) ([]string, error) {
	if h == nil || forward == nil || tunnel == nil {
		return nil, errors.New("invalid sdwan chain sync context")
	}
	chainNodes, err := h.listChainNodesForTunnel(forward.TunnelID)
	if err != nil {
		return nil, err
	}
	if len(chainNodes) == 0 {
		return nil, errors.New("链式隧道节点不存在")
	}
	h.fillSDWANChainNodeConnectIPs(chainNodes)
	base := buildForwardServiceBaseWithResolvedUserTunnel(forward.ID, forward.UserID, userTunnelID)
	warnings := make([]string, 0)

	hasOtherModes, _ := h.tunnelHasNonSDWANActiveForwards(forward.TunnelID)
	for _, cn := range chainNodes {
		_ = h.deleteForwardServicesOnNodeBatch(forward, cn.NodeID)
		if !hasOtherModes {
			_ = h.deleteTunnelRelayService(cn.NodeID, forward.TunnelID)
		}
	}

	// 用 forward_port 分配端口替代 cn.Port（GOST relay 端口），与 nftables 端口分配一致
	portMap := make(map[int64]int)
	for _, fp := range ports {
		portMap[fp.NodeID] = fp.Port
	}
	for i, cn := range chainNodes {
		if p, ok := portMap[cn.NodeID]; ok {
			chainNodes[i].Port = p
		}
	}

	midsByHop := map[int][]chainNodeRecord{}
	var outNodes []chainNodeRecord
	for _, cn := range chainNodes {
		switch cn.ChainType {
		case 2:
			midsByHop[int(cn.Inx)] = append(midsByHop[int(cn.Inx)], cn)
		case 3:
			outNodes = append(outNodes, cn)
		}
	}
	if len(outNodes) == 0 {
		return warnings, errors.New("SDWAN 链式隧道出口不能为空")
	}
	orderedHops := make([]int, 0, len(midsByHop))
	for hop := range midsByHop {
		orderedHops = append(orderedHops, hop)
	}
	sort.Ints(orderedHops)
	nextHopGroup := func(hop int) []chainNodeRecord {
		if nodes := midsByHop[hop]; len(nodes) > 0 {
			return nodes
		}
		return outNodes
	}
	for _, protocol := range []string{"tcp", "udp"} {
		serviceName := base + "_" + protocol
		for _, fp := range ports {
			// 只为入口节点（ChainType 0/1）创建 entry forwarder，跳过中间/出口节点
			if fp.ChainType != 0 && fp.ChainType != 1 {
				continue
			}
			node, err := h.getNodeRecord(fp.NodeID)
			if err != nil {
				return warnings, err
			}
			services, err := h.buildSDWANNodeServiceConfigs(serviceName, protocol, node, fp.Port, strings.TrimSpace(fp.InIP), nextHopGroup(1), forward, "overlay", false)
			if err != nil {
				return warnings, err
			}
			// 打印 entry 连接的下一跳信息
			for _, nh := range nextHopGroup(1) {
				fmt.Printf("[sdwan.debug] entry forwarder: node=%s port=%d -> nextHop=%s:%d\n", node.Name, fp.Port, nh.ConnectIP, nh.Port)
			}
			if err := h.upsertNodeServices(node, services); err != nil {
				return warnings, fmt.Errorf("入口节点 %s 下发 SDWAN %s 服务失败: %w", node.Name, strings.ToUpper(protocol), err)
			}
		}

		for _, hop := range orderedHops {
			for _, cn := range midsByHop[hop] {
				node, err := h.getNodeRecord(cn.NodeID)
				if err != nil {
					return warnings, err
				}
				services, err := h.buildSDWANNodeServiceConfigs(serviceName, protocol, node, cn.Port, "", nextHopGroup(hop+1), forward, "overlay", true)
				if err != nil {
					return warnings, err
				}
				if err := h.upsertNodeServices(node, services); err != nil {
					return warnings, fmt.Errorf("中间节点 %s 下发 SDWAN %s 服务失败: %w", node.Name, strings.ToUpper(protocol), err)
				}
			}
		}

		for _, out := range outNodes {
			node, err := h.getNodeRecord(out.NodeID)
			if err != nil {
				return warnings, err
			}
			fmt.Printf("[sdwan.debug] exit service: node=%s port=%d target=%s\n", node.Name, out.Port, forward.RemoteAddr)
			services, err := h.buildSDWANExitServiceConfigs(serviceName, protocol, node, out.Port, forward)
			if err != nil {
				return warnings, err
			}
			if err := h.upsertNodeServices(node, services); err != nil {
				return warnings, fmt.Errorf("出口节点 %s 下发 SDWAN %s 服务失败: %w", node.Name, strings.ToUpper(protocol), err)
			}
			fmt.Printf("[sdwan.debug] exit service deployed OK on %s\n", node.Name)
		}
	}

	return warnings, nil
}

func (h *Handler) upsertNodeServices(node *nodeRecord, services []map[string]interface{}) error {
	if node == nil {
		return errors.New("节点不存在")
	}
	if _, err := h.sendNodeCommand(node.ID, "UpdateService", services, true, false); err != nil {
		if isNotFoundError(err) {
			_, err = h.sendNodeCommand(node.ID, "AddService", services, true, false)
		}
		return err
	}
	return nil
}

func (h *Handler) fillSDWANChainNodeConnectIPs(chainNodes []chainNodeRecord) {
	for i := range chainNodes {
		if strings.TrimSpace(chainNodes[i].ConnectIP) != "" {
			fmt.Printf("[sdwan.debug] node %d ConnectIP already set: %s\n", chainNodes[i].NodeID, chainNodes[i].ConnectIP)
			continue
		}
		node, err := h.getNodeRecord(chainNodes[i].NodeID)
		if err != nil || node == nil {
			fmt.Printf("[sdwan.debug] node %d getNodeRecord failed: %v\n", chainNodes[i].NodeID, err)
			continue
		}
		if vpnIP := parseSDWANNodeVPNIPFromRemoteConfig(node.RemoteConfig); vpnIP != "" {
			chainNodes[i].ConnectIP = vpnIP
			fmt.Printf("[sdwan.debug] node %d ConnectIP = VPN IP: %s\n", chainNodes[i].NodeID, vpnIP)
			continue
		}
		if v := strings.TrimSpace(node.IntranetIP); v != "" {
			chainNodes[i].ConnectIP = v
			fmt.Printf("[sdwan.debug] node %d ConnectIP = IntranetIP: %s (no VPN IP in RemoteConfig!)\n", chainNodes[i].NodeID, v)
			continue
		}
		if v := strings.TrimSpace(node.ServerIPv4); v != "" {
			chainNodes[i].ConnectIP = v
			fmt.Printf("[sdwan.debug] node %d ConnectIP = ServerIPv4: %s (no VPN IP!)\n", chainNodes[i].NodeID, v)
			continue
		}
		if v := strings.TrimSpace(node.ServerIPv6); v != "" {
			chainNodes[i].ConnectIP = v
			fmt.Printf("[sdwan.debug] node %d ConnectIP = ServerIPv6: %s (no VPN IP!)\n", chainNodes[i].NodeID, v)
			continue
		}
		chainNodes[i].ConnectIP = strings.TrimSpace(node.ServerIP)
		fmt.Printf("[sdwan.debug] node %d ConnectIP = ServerIP: %s (no VPN IP!)\n", chainNodes[i].NodeID, chainNodes[i].ConnectIP)
	}
}

func (h *Handler) buildSDWANNodeServiceConfigs(serviceName string, protocol string, node *nodeRecord, listenPort int, bindIP string, targets []chainNodeRecord, forward *forwardRecord, dialMode string, overlayListen bool) ([]map[string]interface{}, error) {
	if node == nil {
		return nil, errors.New("节点不存在")
	}
	if listenPort <= 0 {
		return nil, errors.New("SDWAN 链式端口不能为空")
	}
	strategy := "round"
	if len(targets) > 0 && strings.TrimSpace(targets[0].Strategy) != "" {
		strategy = strings.TrimSpace(targets[0].Strategy)
	}
	forwarderNodes := make([]map[string]interface{}, 0, len(targets))
	for idx, target := range targets {
		host := strings.TrimSpace(target.ConnectIP)
		if host == "" {
			return nil, errors.New("SDWAN 下一跳地址不能为空")
		}
		if target.Port <= 0 {
			return nil, errors.New("SDWAN 下一跳端口不能为空")
		}
		forwarderNodes = append(forwarderNodes, map[string]interface{}{
			"name": fmt.Sprintf("node_%d", idx+1),
			"addr": processServerAddress(net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(target.Port))),
		})
	}
	listenHost := "0.0.0.0"
	if !overlayListen {
		listenHost = strings.TrimSpace(bindIP)
		if listenHost == "" {
			listenHost = strings.TrimSpace(node.TCPListenAddr)
		}
		if listenHost == "" {
			listenHost = "0.0.0.0"
		}
	}
	service := map[string]interface{}{
		"name": serviceName,
		"addr": processServerAddress(net.JoinHostPort(strings.Trim(listenHost, "[]"), strconv.Itoa(listenPort))),
		"handler": map[string]interface{}{
			"type": protocol,
		},
		"listener": map[string]interface{}{
			"type": protocol,
		},
		"forwarder": map[string]interface{}{
			"nodes": forwarderNodes,
			"selector": map[string]interface{}{
				"strategy":    strategy,
				"maxFails":    1,
				"failTimeout": "600s",
			},
		},
		"metadata": h.buildSDWANMetadataForNode(node, dialMode, overlayListen),
	}
	return []map[string]interface{}{service}, nil
}

func (h *Handler) buildSDWANExitServiceConfigs(serviceName string, protocol string, node *nodeRecord, listenPort int, forward *forwardRecord) ([]map[string]interface{}, error) {
	if node == nil {
		return nil, errors.New("节点不存在")
	}
	if listenPort <= 0 {
		return nil, errors.New("SDWAN 出口端口不能为空")
	}
	targets := splitRemoteTargets(forward.RemoteAddr)
	for idx := range targets {
		targets[idx] = resolveTargetIP(targets[idx])
	}
	strategy := strings.TrimSpace(forward.Strategy)
	if strategy == "" {
		strategy = "fifo"
	}
	service := map[string]interface{}{
		"name": serviceName,
		"addr": processServerAddress(net.JoinHostPort("0.0.0.0", strconv.Itoa(listenPort))),
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
		"metadata": h.buildSDWANMetadataForNode(node, "direct", true),
	}
	return []map[string]interface{}{service}, nil
}

func (h *Handler) buildSDWANMetadataForNode(node *nodeRecord, dialMode string, overlayListen bool) map[string]interface{} {
	meta := map[string]interface{}{
		"kernel":             forwardModeSDWAN,
		"sdwanDialMode":      dialMode,
		"sdwanOverlayListen": fmt.Sprintf("%t", overlayListen),
	}
	if node == nil {
		return meta
	}
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
	if backupVPNIPs := parseSDWANValueFromRemoteConfig(node.RemoteConfig, "sdwanBackupLighthouseVPNIPs"); backupVPNIPs != "" {
		meta["sdwanBackupLighthouseVPNIPs"] = backupVPNIPs
	}
	if backupAddrs := parseSDWANValueFromRemoteConfig(node.RemoteConfig, "sdwanBackupLighthouseAddrs"); backupAddrs != "" {
		meta["sdwanBackupLighthouseAddrs"] = backupAddrs
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
	return meta
}

func (h *Handler) tunnelHasNonSDWANActiveForwards(tunnelID int64) (bool, error) {
	forwards, err := h.repo.ListActiveForwardsByTunnel(tunnelID)
	if err != nil {
		return false, err
	}
	for _, f := range forwards {
		if !strings.EqualFold(f.Mode, forwardModeSDWAN) {
			return true, nil
		}
	}
	return false, nil
}

func (h *Handler) deleteTunnelRelayService(nodeID, tunnelID int64) error {
	if nodeID <= 0 || tunnelID <= 0 {
		return nil
	}
	serviceName := fmt.Sprintf("%d_tls", tunnelID)
	payload := map[string]interface{}{"services": []string{serviceName}}
	_, err := h.sendNodeCommand(nodeID, "DeleteService", payload, false, true)
	return err
}
