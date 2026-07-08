package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go-backend/internal/http/response"
)

func (h *Handler) nodeInstancePortList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "未登录或token已过期"))
		return
	}
	if roleID != 0 {
		response.WriteJSON(w, response.Err(403, "权限不足，仅管理员可操作"))
		return
	}
	nodeID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("nodeId")), 10, 64)
	if err != nil || nodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	node, err := h.getNodeRecord(nodeID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	instances, err := h.repo.ListNodeInstances(nodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	items := make([]map[string]interface{}, 0, len(instances))
	for _, inst := range instances {
		items = append(items, map[string]interface{}{
			"id":           inst.ID,
			"nodeId":       inst.NodeID,
			"instanceId":   inst.InstanceID,
			"displayIndex": inst.DisplayIndex,
			"displayName":  strings.TrimSpace(inst.DisplayName),
			"hostname":     inst.Hostname,
			"publicIpV4":   inst.PublicIPV4,
			"publicIpV6":   inst.PublicIPV6,
			"status":       inst.Status,
			"weight":       inst.Weight,
			"portRange":    strings.TrimSpace(inst.PortRange),
		})
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":        nodeID,
		"nodeName":      node.Name,
		"nodePortRange": strings.TrimSpace(node.PortRange),
		"instances":     items,
	}))
}

func (h *Handler) nodeInstancePortSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "未登录或token已过期"))
		return
	}
	if roleID != 0 {
		response.WriteJSON(w, response.Err(403, "权限不足，仅管理员可操作"))
		return
	}
	var req struct {
		NodeID     int64  `json:"nodeId"`
		InstanceID string `json:"instanceId"`
		PortRange  string `json:"portRange"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	if strings.TrimSpace(req.InstanceID) == "" {
		response.WriteJSON(w, response.ErrDefault("实例ID不能为空"))
		return
	}
	portRange := strings.TrimSpace(req.PortRange)
	if err := validateInstancePortRange(portRange); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	if _, err := h.getNodeRecord(req.NodeID); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	if err := h.repo.UpdateNodeInstancePortRange(req.NodeID, req.InstanceID, portRange, time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	go h.redeployNodeRuntime(req.NodeID)
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":     req.NodeID,
		"instanceId": strings.TrimSpace(req.InstanceID),
		"portRange":  portRange,
	}))
}

func (h *Handler) nodeInstancePortDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "未登录或token已过期"))
		return
	}
	if roleID != 0 {
		response.WriteJSON(w, response.Err(403, "权限不足，仅管理员可操作"))
		return
	}
	var req struct {
		NodeID     int64  `json:"nodeId"`
		InstanceID string `json:"instanceId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	if strings.TrimSpace(req.InstanceID) == "" {
		response.WriteJSON(w, response.ErrDefault("实例ID不能为空"))
		return
	}
	if _, err := h.getNodeRecord(req.NodeID); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	if err := h.repo.DeleteNodeInstance(req.NodeID, req.InstanceID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":     req.NodeID,
		"instanceId": strings.TrimSpace(req.InstanceID),
	}))
}

func validateInstancePortRange(value string) error {
	if value == "" {
		return nil
	}
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return errors.New("端口范围格式错误")
		}
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) != 2 {
				return errors.New("端口范围格式错误")
			}
			start, err1 := strconv.Atoi(strings.TrimSpace(rangeParts[0]))
			end, err2 := strconv.Atoi(strings.TrimSpace(rangeParts[1]))
			if err1 != nil || err2 != nil || start < 1 || end > 65535 || start >= end {
				return errors.New("端口范围必须在 1-65535 之间，且起始端口小于结束端口")
			}
			continue
		}
		port, err := strconv.Atoi(part)
		if err != nil || port < 1 || port > 65535 {
			return errors.New("端口必须在 1-65535 之间")
		}
	}
	return nil
}
