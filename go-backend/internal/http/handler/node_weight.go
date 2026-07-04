package handler

import (
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
)

func (h *Handler) nodeWeightUpdate(w http.ResponseWriter, r *http.Request) {
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
		Weight     int    `json:"weight"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	if req.Weight < 0 {
		response.WriteJSON(w, response.ErrDefault("权重不能小于0"))
		return
	}
	if _, err := h.getNodeRecord(req.NodeID); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	if strings.TrimSpace(req.InstanceID) != "" {
		if err := h.repo.UpdateNodeInstanceWeight(req.NodeID, req.InstanceID, req.Weight, time.Now().UnixMilli()); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	} else {
		if err := h.repo.UpdateNodeWeight(req.NodeID, req.Weight, time.Now().UnixMilli()); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	}

	go h.redeployNodeRuntime(req.NodeID)
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":     req.NodeID,
		"instanceId": req.InstanceID,
		"weight":     req.Weight,
	}))
}
