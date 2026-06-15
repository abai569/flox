package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
)

func (h *Handler) sdwanStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if err := h.reconcileSDWANLighthouses(); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	items, err := h.repo.ListNodes(nil)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	caReady := false
	if cfg, _ := h.repo.GetConfigByName(sdwanCACertConfigName); cfg != nil && strings.TrimSpace(cfg.Value) != "" {
		caReady = true
	}
	primary, backups, err := h.listSDWANLighthouseNodes()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	lighthouseID := int64(0)
	if primary != nil {
		lighthouseID = primary.ID
	}
	statusNodes := make([]map[string]any, 0, len(items))
	lighthouseName := ""
	lighthouseVPNIP := ""
	lighthouseAddr := ""
	backupStatus := make([]map[string]any, 0, len(backups))
	backupSet := make(map[int64]struct{}, len(backups))
	for _, n := range backups {
		if n == nil {
			continue
		}
		backupSet[n.ID] = struct{}{}
		backupStatus = append(backupStatus, map[string]any{
			"id":    n.ID,
			"name":  n.Name,
			"vpnIp": parseSDWANNodeVPNIPFromRemoteConfig(n.RemoteConfig.String),
			"addr":  h.buildSDWANLighthouseAddr(n, parseSDWANNodeVPNIPFromRemoteConfig(n.RemoteConfig.String)),
		})
	}
	for _, item := range items {
		remoteConfig := asString(item["remoteConfig"])
		nodeID := asInt64(item["id"], 0)
		vpnIP := parseSDWANNodeVPNIPFromRemoteConfig(remoteConfig)
		isLighthouse := strings.EqualFold(parseSDWANIsLighthouseFromRemoteConfig(remoteConfig), "true")
		hasCert := parseSDWANCertPEMFromRemoteConfig(remoteConfig) != "" && parseSDWANKeyPEMFromRemoteConfig(remoteConfig) != ""
		addr := parseSDWANLighthouseAddrFromRemoteConfig(remoteConfig)
		role := "peer"
		if nodeID == lighthouseID {
			lighthouseName = asString(item["name"])
			lighthouseVPNIP = vpnIP
			lighthouseAddr = addr
			role = "primary"
		} else if _, ok := backupSet[nodeID]; ok {
			role = "backup"
		}
		statusNodes = append(statusNodes, map[string]any{
			"id":             nodeID,
			"name":           asString(item["name"]),
			"status":         asInt(item["status"], 0),
			"vpnIp":          vpnIP,
			"isLighthouse":   isLighthouse,
			"role":           role,
			"hasCert":        hasCert,
			"lighthouseAddr": addr,
		})
	}
	response.WriteJSON(w, response.OK(map[string]any{
		"tier":              string(tier),
		"caReady":           caReady,
		"lighthouseNodeId":  lighthouseID,
		"lighthouseName":    lighthouseName,
		"lighthouseVPNIP":   lighthouseVPNIP,
		"lighthouseAddr":    lighthouseAddr,
		"backupLighthouses": backupStatus,
		"nodes":             statusNodes,
	}))
}

func (h *Handler) sdwanReconcile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierPremium {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网管理仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可执行 SDWAN 故障切换检查"))
		return
	}
	if err := h.reconcileSDWANLighthouses(); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) sdwanSetLighthouse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierPremium {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网管理仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可切换中心节点"))
		return
	}
	var req struct {
		NodeID int64 `json:"nodeId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if node == nil {
		response.WriteJSON(w, response.ErrDefault("节点不存在"))
		return
	}
	vpnIP := parseSDWANNodeVPNIPFromRemoteConfig(node.RemoteConfig.String)
	if vpnIP == "" {
		response.WriteJSON(w, response.ErrDefault("目标节点尚未签发 SDWAN 证书"))
		return
	}
	addr := h.buildSDWANLighthouseAddr(node, vpnIP)
	if err := h.repo.UpsertConfig(sdwanLighthouseNodeID, asString(req.NodeID), time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	items, err := h.repo.ListNodes(nil)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	for _, item := range items {
		nodeID := asInt64(item["id"], 0)
		raw := asString(item["remoteConfig"])
		updated := mergeRemoteConfig(raw, map[string]string{
			"sdwanIsLighthouse":    fmt.Sprintf("%t", nodeID == req.NodeID),
			"sdwanLighthouseVPNIP": vpnIP,
			"sdwanLighthouseAddr":  addr,
		})
		_ = h.repo.UpdateNodeRemoteConfig(nodeID, updated)
	}
	_ = h.syncSDWANLighthouseTopology()
	response.WriteJSON(w, response.OK(map[string]any{
		"lighthouseNodeId": req.NodeID,
		"lighthouseVPNIP":  vpnIP,
		"lighthouseAddr":   addr,
	}))
}

func (h *Handler) sdwanToggleBackupLighthouse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierPremium {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网管理仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可管理备中心节点"))
		return
	}
	var req struct {
		NodeID  int64 `json:"nodeId"`
		Enabled bool  `json:"enabled"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if node == nil {
		response.WriteJSON(w, response.ErrDefault("节点不存在"))
		return
	}
	vpnIP := parseSDWANNodeVPNIPFromRemoteConfig(node.RemoteConfig.String)
	if vpnIP == "" {
		response.WriteJSON(w, response.ErrDefault("目标节点尚未签发 SDWAN 证书"))
		return
	}
	primary, backups, err := h.listSDWANLighthouseNodes()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	backupIDs := make([]int64, 0, len(backups)+1)
	seen := make(map[int64]struct{})
	for _, n := range backups {
		if n == nil || n.ID == req.NodeID {
			continue
		}
		if primary != nil && n.ID == primary.ID {
			continue
		}
		if _, ok := seen[n.ID]; ok {
			continue
		}
		seen[n.ID] = struct{}{}
		backupIDs = append(backupIDs, n.ID)
	}
	if req.Enabled {
		if primary != nil && req.NodeID == primary.ID {
			response.WriteJSON(w, response.ErrDefault("主中心节点不能同时作为备中心节点"))
			return
		}
		if _, ok := seen[req.NodeID]; !ok {
			backupIDs = append(backupIDs, req.NodeID)
		}
	}
	if err := h.repo.UpsertConfig(sdwanBackupLighthouseNodeIDs, formatSDWANNodeIDList(backupIDs), time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.syncSDWANLighthouseTopology(); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]any{"backupNodeIds": backupIDs}))
}

func (h *Handler) reconcileSDWANLighthouses() error {
	primary, backups, err := h.listSDWANLighthouseNodes()
	if err != nil {
		return err
	}
	if primary == nil {
		return nil
	}
	if primary.Status == 1 {
		return nil
	}
	var promoted *model.Node
	remainingBackupIDs := make([]int64, 0, len(backups))
	for _, node := range backups {
		if node == nil {
			continue
		}
		if promoted == nil && node.Status == 1 {
			promoted = node
			continue
		}
		remainingBackupIDs = append(remainingBackupIDs, node.ID)
	}
	if promoted == nil {
		return nil
	}
	remainingBackupIDs = append(remainingBackupIDs, primary.ID)
	now := time.Now().UnixMilli()
	if err := h.repo.UpsertConfig(sdwanLighthouseNodeID, fmt.Sprintf("%d", promoted.ID), now); err != nil {
		return err
	}
	if err := h.repo.UpsertConfig(sdwanBackupLighthouseNodeIDs, formatSDWANNodeIDList(remainingBackupIDs), now); err != nil {
		return err
	}
	return h.syncSDWANLighthouseTopology()
}
