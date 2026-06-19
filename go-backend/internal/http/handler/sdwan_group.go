package handler

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
)

const sdwanGroupsConfigName = "sdwan_groups"

type SDWANGroup struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	NetworkCIDR         string  `json:"networkCIDR"`
	LighthouseNodeID    int64   `json:"lighthouseNodeId"`
	BackupLighthouseIDs []int64 `json:"backupLighthouseNodeIds"`
	MemberNodeIDs       []int64 `json:"memberNodeIds"`
	ListenPort          int     `json:"listenPort"`
	CACertPEM           string  `json:"caCertPEM"`
	CAKeyPEM            string  `json:"caKeyPEM"`
}

type SDWANGroupNodeConfig struct {
	VPNIP           string `json:"vpnIP"`
	Role            string `json:"role"`
	LighthouseVPNIP string `json:"lighthouseVPNIP"`
	LighthouseAddr  string `json:"lighthouseAddr"`
	ListenPort      int    `json:"listenPort"`
	CAPEM           string `json:"caPEM"`
	CertPEM         string `json:"certPEM"`
	KeyPEM          string `json:"keyPEM"`
}

type sdwanGroupsData struct {
	Groups     []SDWANGroup `json:"groups"`
	NextSubnet string       `json:"nextSubnet"`
}

func (h *Handler) loadSDWANGroups() (*sdwanGroupsData, error) {
	cfg, _ := h.repo.GetConfigByName(sdwanGroupsConfigName)
	if cfg == nil || strings.TrimSpace(cfg.Value) == "" {
		return &sdwanGroupsData{Groups: []SDWANGroup{}, NextSubnet: "192.168.101.0/24"}, nil
	}
	var data sdwanGroupsData
	if err := json.Unmarshal([]byte(cfg.Value), &data); err != nil {
		return &sdwanGroupsData{Groups: []SDWANGroup{}, NextSubnet: "192.168.101.0/24"}, nil
	}
	if data.NextSubnet == "" {
		data.NextSubnet = "192.168.101.0/24"
	}
	return &data, nil
}

func (h *Handler) saveSDWANGroups(data *sdwanGroupsData) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return h.repo.UpsertConfig(sdwanGroupsConfigName, string(b), time.Now().UnixMilli())
}

func (h *Handler) findSDWANGroup(data *sdwanGroupsData, groupID string) *SDWANGroup {
	for i := range data.Groups {
		if data.Groups[i].ID == groupID {
			return &data.Groups[i]
		}
	}
	return nil
}

func (h *Handler) allocateSDWANGroupSubnet(data *sdwanGroupsData) string {
	cidr := data.NextSubnet
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return "192.168.101.0/24"
	}
	ip := ipNet.IP.To4()
	if ip == nil {
		return "192.168.101.0/24"
	}
	nextIP := net.IPv4(ip[0], ip[1], ip[2]+1, 0)
	data.NextSubnet = fmt.Sprintf("%s/24", nextIP.String())
	return cidr
}

func (h *Handler) getSDWANGroupNodeConfig(remoteConfig, groupID string) SDWANGroupNodeConfig {
	cfg := parseRemoteConfigMap(remoteConfig)
	groupsRaw, ok := cfg["sdwanGroups"]
	if !ok {
		return SDWANGroupNodeConfig{}
	}
	groupsMap, ok := groupsRaw.(map[string]interface{})
	if !ok {
		return SDWANGroupNodeConfig{}
	}
	groupRaw, ok := groupsMap[groupID]
	if !ok {
		return SDWANGroupNodeConfig{}
	}
	groupMap, ok := groupRaw.(map[string]interface{})
	if !ok {
		return SDWANGroupNodeConfig{}
	}
	result := SDWANGroupNodeConfig{}
	if v, ok := groupMap["vpnIP"].(string); ok {
		result.VPNIP = v
	}
	if v, ok := groupMap["role"].(string); ok {
		result.Role = v
	}
	if v, ok := groupMap["lighthouseVPNIP"].(string); ok {
		result.LighthouseVPNIP = v
	}
	if v, ok := groupMap["lighthouseAddr"].(string); ok {
		result.LighthouseAddr = v
	}
	if v, ok := groupMap["listenPort"].(float64); ok {
		result.ListenPort = int(v)
	}
	if v, ok := groupMap["caPEM"].(string); ok {
		result.CAPEM = v
	}
	if v, ok := groupMap["certPEM"].(string); ok {
		result.CertPEM = v
	}
	if v, ok := groupMap["keyPEM"].(string); ok {
		result.KeyPEM = v
	}
	return result
}

func (h *Handler) sdwanGroupList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网仅正式授权可用"))
		return
	}

	data, err := h.loadSDWANGroups()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	items, err := h.repo.ListNodes(nil)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	nodeMap := make(map[int64]map[string]interface{})
	for _, item := range items {
		nodeID := asInt64(item["id"], 0)
		nodeMap[nodeID] = item
	}

	groupList := make([]map[string]interface{}, 0, len(data.Groups))
	for _, g := range data.Groups {
		members := make([]map[string]interface{}, 0, len(g.MemberNodeIDs))
		for _, nodeID := range g.MemberNodeIDs {
			item, ok := nodeMap[nodeID]
			if !ok {
				continue
			}
			remoteConfig := asString(item["remoteConfig"])
			groupConfig := h.getSDWANGroupNodeConfig(remoteConfig, g.ID)
			certReady := groupConfig.CertPEM != "" && groupConfig.KeyPEM != ""
			members = append(members, map[string]interface{}{
				"id":             nodeID,
				"name":           asString(item["name"]),
				"status":         asInt(item["status"], 0),
				"vpnIp":          groupConfig.VPNIP,
				"intranetIp":     asString(item["intranetIp"]),
				"role":           groupConfig.Role,
				"hasCert":        certReady,
				"lighthouseAddr": groupConfig.LighthouseAddr,
				"overlayRunning": certReady && asInt(item["status"], 0) == 1,
			})
		}

		lighthouseName := ""
		if g.LighthouseNodeID > 0 {
			if item, ok := nodeMap[g.LighthouseNodeID]; ok {
				lighthouseName = asString(item["name"])
			}
		}

		groupList = append(groupList, map[string]interface{}{
			"id":               g.ID,
			"name":             g.Name,
			"networkCIDR":      g.NetworkCIDR,
			"lighthouseNodeId": g.LighthouseNodeID,
			"lighthouseName":   lighthouseName,
			"listenPort":       g.ListenPort,
			"memberCount":      len(g.MemberNodeIDs),
			"members":          members,
		})
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"groups": groupList,
	}))
}

func (h *Handler) sdwanGroupCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可创建 SDWAN 分组"))
		return
	}

	var req struct {
		Name             string  `json:"name"`
		NetworkCIDR      string  `json:"networkCIDR"`
		LighthouseNodeID int64   `json:"lighthouseNodeId"`
		MemberNodeIDs    []int64 `json:"memberNodeIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("分组名称不能为空"))
		return
	}
	if req.LighthouseNodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请选择中心节点"))
		return
	}
	if len(req.MemberNodeIDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("请选择成员节点"))
		return
	}

	hasLighthouse := false
	for _, id := range req.MemberNodeIDs {
		if id == req.LighthouseNodeID {
			hasLighthouse = true
			break
		}
	}
	if !hasLighthouse {
		response.WriteJSON(w, response.ErrDefault("中心节点必须在成员列表中"))
		return
	}

	data, err := h.loadSDWANGroups()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	networkCIDR := strings.TrimSpace(req.NetworkCIDR)
	if networkCIDR == "" {
		networkCIDR = h.allocateSDWANGroupSubnet(data)
	} else {
		if _, _, err := net.ParseCIDR(networkCIDR); err != nil {
			response.WriteJSON(w, response.ErrDefault("网段格式无效"))
			return
		}
		_, ipNet, _ := net.ParseCIDR(networkCIDR)
		ip := ipNet.IP.To4()
		if ip != nil {
			data.NextSubnet = fmt.Sprintf("%d.%d.%d.0/24", ip[0], ip[1], ip[2]+1)
		}
	}

	caCertPEM, caKeyPEM, err := generateSDWANCA(networkCIDR)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "生成 CA 失败: "+err.Error()))
		return
	}

	listenPort := 4242
	for _, g := range data.Groups {
		if g.ListenPort >= listenPort {
			listenPort = g.ListenPort + 1
		}
	}

	groupID := fmt.Sprintf("g%d", time.Now().UnixMilli())
	group := SDWANGroup{
		ID:                  groupID,
		Name:                req.Name,
		NetworkCIDR:         networkCIDR,
		LighthouseNodeID:    req.LighthouseNodeID,
		BackupLighthouseIDs: []int64{},
		MemberNodeIDs:       req.MemberNodeIDs,
		ListenPort:          listenPort,
		CACertPEM:           caCertPEM,
		CAKeyPEM:            caKeyPEM,
	}
	data.Groups = append(data.Groups, group)
	if err := h.saveSDWANGroups(data); err != nil {
		response.WriteJSON(w, response.Err(-2, "保存分组失败: "+err.Error()))
		return
	}

	if err := h.syncSDWANGroup(groupID); err != nil {
		response.WriteJSON(w, response.Err(-2, "同步分组配置失败: "+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"groupId":     groupID,
		"name":        req.Name,
		"networkCIDR": networkCIDR,
		"listenPort":  listenPort,
	}))
}

func (h *Handler) sdwanGroupUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可修改 SDWAN 分组"))
		return
	}

	var req struct {
		GroupID          string  `json:"groupId"`
		Name             string  `json:"name"`
		LighthouseNodeID int64   `json:"lighthouseNodeId"`
		MemberNodeIDs    []int64 `json:"memberNodeIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	req.GroupID = strings.TrimSpace(req.GroupID)
	if req.GroupID == "" {
		response.WriteJSON(w, response.ErrDefault("分组ID不能为空"))
		return
	}

	data, err := h.loadSDWANGroups()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	group := h.findSDWANGroup(data, req.GroupID)
	if group == nil {
		response.WriteJSON(w, response.ErrDefault("分组不存在"))
		return
	}

	if req.Name != "" {
		group.Name = strings.TrimSpace(req.Name)
	}
	if req.LighthouseNodeID > 0 {
		group.LighthouseNodeID = req.LighthouseNodeID
	}
	if len(req.MemberNodeIDs) > 0 {
		hasLighthouse := false
		for _, id := range req.MemberNodeIDs {
			if id == group.LighthouseNodeID {
				hasLighthouse = true
				break
			}
		}
		if !hasLighthouse {
			response.WriteJSON(w, response.ErrDefault("中心节点必须在成员列表中"))
			return
		}
		group.MemberNodeIDs = req.MemberNodeIDs
	}

	if err := h.saveSDWANGroups(data); err != nil {
		response.WriteJSON(w, response.Err(-2, "保存分组失败: "+err.Error()))
		return
	}

	if err := h.syncSDWANGroup(req.GroupID); err != nil {
		response.WriteJSON(w, response.Err(-2, "同步分组配置失败: "+err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) sdwanGroupDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可删除 SDWAN 分组"))
		return
	}

	var req struct {
		GroupID string `json:"groupId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	req.GroupID = strings.TrimSpace(req.GroupID)
	if req.GroupID == "" {
		response.WriteJSON(w, response.ErrDefault("分组ID不能为空"))
		return
	}

	data, err := h.loadSDWANGroups()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	group := h.findSDWANGroup(data, req.GroupID)
	if group == nil {
		response.WriteJSON(w, response.ErrDefault("分组不存在"))
		return
	}

	for _, nodeID := range group.MemberNodeIDs {
		if h.wsServer != nil {
			h.wsServer.SendCommand(nodeID, "SdwanShutdown", nil, 10*time.Second)
		}
		node, err := h.repo.GetNodeByID(nodeID)
		if err != nil || node == nil {
			continue
		}
		remoteConfig := node.RemoteConfig.String
		cfg := parseRemoteConfigMap(remoteConfig)
		if groupsRaw, ok := cfg["sdwanGroups"]; ok {
			if groupsMap, ok := groupsRaw.(map[string]interface{}); ok {
				delete(groupsMap, req.GroupID)
				if len(groupsMap) == 0 {
					delete(cfg, "sdwanGroups")
				}
				b, _ := json.Marshal(cfg)
				_ = h.repo.UpdateNodeRemoteConfig(nodeID, string(b))
			}
		}
	}

	newGroups := make([]SDWANGroup, 0, len(data.Groups)-1)
	for _, g := range data.Groups {
		if g.ID != req.GroupID {
			newGroups = append(newGroups, g)
		}
	}
	data.Groups = newGroups
	if err := h.saveSDWANGroups(data); err != nil {
		response.WriteJSON(w, response.Err(-2, "保存分组失败: "+err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) syncSDWANGroup(groupID string) error {
	data, err := h.loadSDWANGroups()
	if err != nil {
		return err
	}
	group := h.findSDWANGroup(data, groupID)
	if group == nil {
		return fmt.Errorf("分组不存在: %s", groupID)
	}

	items, err := h.repo.ListNodes(nil)
	if err != nil {
		return err
	}
	nodeMap := make(map[int64]*model.Node)
	for _, item := range items {
		nodeID := asInt64(item["id"], 0)
		node, err := h.repo.GetNodeByID(nodeID)
		if err != nil || node == nil {
			continue
		}
		nodeMap[nodeID] = node
	}

	lighthouseNode, ok := nodeMap[group.LighthouseNodeID]
	if !ok {
		return fmt.Errorf("中心节点不存在: %d", group.LighthouseNodeID)
	}

	allocatedIPs := make(map[string]struct{})
	lighthouseVPNIP := h.getSDWANGroupNodeVPNIP(lighthouseNode.RemoteConfig.String, groupID)
	if lighthouseVPNIP == "" {
		lighthouseVPNIP, err = h.allocateSDWANGroupNodeVPNIP(group, group.LighthouseNodeID, nodeMap, allocatedIPs)
		if err != nil {
			return err
		}
	}
	allocatedIPs[lighthouseVPNIP] = struct{}{}

	lighthouseAddr := h.buildSDWANLighthouseAddr(lighthouseNode, lighthouseVPNIP)
	parts := strings.Split(lighthouseAddr, ":")
	if len(parts) == 2 {
		lighthouseAddr = parts[0] + ":" + fmt.Sprintf("%d", group.ListenPort)
	}

	for _, nodeID := range group.MemberNodeIDs {
		node, ok := nodeMap[nodeID]
		if !ok {
			continue
		}

		// 先停止旧 overlay 释放端口
		if h.wsServer != nil {
			h.wsServer.SendCommand(nodeID, "SdwanShutdown", map[string]interface{}{"groupId": groupID}, 5*time.Second)
			time.Sleep(2 * time.Second)
		}

		vpnIP := h.getSDWANGroupNodeVPNIP(node.RemoteConfig.String, groupID)
		if vpnIP == "" {
			vpnIP, err = h.allocateSDWANGroupNodeVPNIP(group, nodeID, nodeMap, allocatedIPs)
			if err != nil {
				continue
			}
		}
		allocatedIPs[vpnIP] = struct{}{}

		hostCertPEM, hostKeyPEM, err := issueSDWANHostCert(node.Name, vpnIP, group.CACertPEM, group.CAKeyPEM)
		if err != nil {
			continue
		}

		isLighthouse := nodeID == group.LighthouseNodeID
		role := "peer"
		targetLighthouseVPNIP := lighthouseVPNIP
		targetLighthouseAddr := lighthouseAddr
		if isLighthouse {
			role = "lighthouse"
			targetLighthouseVPNIP = vpnIP
			targetLighthouseAddr = lighthouseAddr
		}

		remoteConfig := node.RemoteConfig.String
		cfg := parseRemoteConfigMap(remoteConfig)
		if cfg["sdwanGroups"] == nil {
			cfg["sdwanGroups"] = make(map[string]interface{})
		}
		groupsMap := cfg["sdwanGroups"].(map[string]interface{})
		groupsMap[groupID] = map[string]interface{}{
			"vpnIP":              vpnIP,
			"role":               role,
			"lighthouseVPNIP":    targetLighthouseVPNIP,
			"lighthouseAddr":     targetLighthouseAddr,
			"listenPort":         group.ListenPort,
			"caPEM":              group.CACertPEM,
			"certPEM":            hostCertPEM,
			"keyPEM":             hostKeyPEM,
		}
		b, _ := json.Marshal(cfg)
		if err := h.repo.UpdateNodeRemoteConfig(nodeID, string(b)); err != nil {
			continue
		}

		if h.wsServer != nil {
			serviceName := fmt.Sprintf("sdwan_%s_tcp", groupID)
			service := map[string]interface{}{
				"name": serviceName,
				"addr": fmt.Sprintf("0.0.0.0:%d", group.ListenPort),
				"handler": map[string]interface{}{
					"type": "tcp",
				},
				"listener": map[string]interface{}{
					"type": "tcp",
				},
				"forwarder": map[string]interface{}{
					"nodes": []map[string]interface{}{},
					"selector": map[string]interface{}{
						"strategy":    "fifo",
						"maxFails":    1,
						"failTimeout": "600s",
					},
				},
				"metadata": map[string]interface{}{
					"kernel":               "sdwan",
					"sdwanGroupId":         groupID,
					"sdwanDialMode":        "direct",
					"sdwanIsLighthouse":    fmt.Sprintf("%t", isLighthouse),
					"sdwanLighthouseVPNIP": targetLighthouseVPNIP,
					"sdwanLighthouseAddr":  targetLighthouseAddr,
					"sdwanListenPort":      fmt.Sprintf("%d", group.ListenPort),
					"sdwanCAPEM":           group.CACertPEM,
					"sdwanCertPEM":         hostCertPEM,
					"sdwanKeyPEM":          hostKeyPEM,
				},
			}
			h.wsServer.SendCommand(nodeID, "UpdateService", []interface{}{service}, 30*time.Second)
		}
	}

	return nil
}

func (h *Handler) getSDWANGroupNodeVPNIP(remoteConfig, groupID string) string {
	cfg := parseRemoteConfigMap(remoteConfig)
	groupsRaw, ok := cfg["sdwanGroups"]
	if !ok {
		return ""
	}
	groupsMap, ok := groupsRaw.(map[string]interface{})
	if !ok {
		return ""
	}
	groupRaw, ok := groupsMap[groupID]
	if !ok {
		return ""
	}
	groupMap, ok := groupRaw.(map[string]interface{})
	if !ok {
		return ""
	}
	if v, ok := groupMap["vpnIP"].(string); ok {
		return v
	}
	return ""
}

func (h *Handler) allocateSDWANGroupNodeVPNIP(group *SDWANGroup, excludeNodeID int64, nodeMap map[int64]*model.Node, allocatedIPs map[string]struct{}) (string, error) {
	_, cidr, err := net.ParseCIDR(group.NetworkCIDR)
	if err != nil {
		return "", err
	}
	base := cidr.IP.To4()
	if base == nil {
		return "", fmt.Errorf("当前仅支持 IPv4 SDWAN 网段")
	}

	used := make(map[string]struct{})
	for nodeID, node := range nodeMap {
		if nodeID == excludeNodeID {
			continue
		}
		vpnIP := h.getSDWANGroupNodeVPNIP(node.RemoteConfig.String, group.ID)
		if vpnIP != "" {
			used[vpnIP] = struct{}{}
		}
	}
	for ip := range allocatedIPs {
		used[ip] = struct{}{}
	}

	for i := 10; i < 250; i++ {
		candidateIP := net.IPv4(base[0], base[1], base[2], byte(i)).String()
		if !cidr.Contains(net.ParseIP(candidateIP)) {
			continue
		}
		if _, ok := used[candidateIP]; !ok {
			return candidateIP, nil
		}
	}
	return "", fmt.Errorf("没有可用的 SDWAN VPN IP")
}
