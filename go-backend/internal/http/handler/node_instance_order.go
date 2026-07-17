package handler

import (
	"errors"
	"net/http"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
)

func (h *Handler) nodeInstanceOrderUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		NodeID      int64    `json:"nodeId"`
		InstanceIDs []string `json:"instanceIds"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if err := h.repo.UpdateNodeInstanceOrder(req.NodeID, req.InstanceIDs); err != nil {
		if errors.Is(err, repo.ErrInvalidNodeInstanceOrder) {
			response.WriteJSON(w, response.ErrDefault("节点实例排序参数无效"))
			return
		}
		response.WriteJSON(w, response.Err(-2, "更新节点实例排序失败"))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}
