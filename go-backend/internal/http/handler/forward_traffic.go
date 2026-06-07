package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
	"go-backend/internal/telegram"
)

type forwardBatchResetTrafficRequest struct {
	ForwardIDs []int64 `json:"forwardIds"`
}

type forwardBatchResetTrafficResult struct {
	ForwardID   int64  `json:"forwardId"`
	ForwardName string `json:"forwardName,omitempty"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
}

func (h *Handler) forwardBatchResetTraffic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req forwardBatchResetTrafficRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if len(req.ForwardIDs) == 0 {
		response.WriteJSON(w, response.Err(-1, "请选择至少一个规则"))
		return
	}

	actorUserID, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}

	actorUserName := h.repo.GetUsernameByID(actorUserID)

	results := make([]forwardBatchResetTrafficResult, 0, len(req.ForwardIDs))

	for _, forwardID := range req.ForwardIDs {
		result := forwardBatchResetTrafficResult{
			ForwardID: forwardID,
			Success:   false,
		}

		forward, accessErr := h.ensureForwardAccessByActor(actorUserID, actorRole, forwardID)
		if accessErr != nil {
			result.Error = "规则不存在或无权访问"
			results = append(results, result)
			continue
		}

		inFlowBefore := forward.InFlow
		outFlowBefore := forward.OutFlow

		if err := h.repo.ResetForwardTraffic(forwardID); err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}

		if err := h.repo.CreateForwardTrafficResetLog(&repo.ForwardTrafficResetLogCreateParams{
			ForwardID:     forwardID,
			ForwardName:   forward.Name,
			UserID:        forward.UserID,
			UserName:      forward.UserName,
			ResetTime:     time.Now().UnixMilli(),
			InFlowBefore:  inFlowBefore,
			OutFlowBefore: outFlowBefore,
			OperatorID:    actorUserID,
			OperatorName:  actorUserName,
			Reason:        "手动归零",
		}); err != nil {
			result.Error = "归零成功但记录日志失败：" + err.Error()
			results = append(results, result)
			continue
		}

		result.Success = true
		result.ForwardName = forward.Name
		results = append(results, result)

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendForwardTrafficReset(forward.Name, forward.UserName)
		})
	}

	response.WriteJSON(w, response.OK(results))
}

type forwardTrafficResetLogsRequest struct {
	ForwardID int64 `json:"forwardId"`
	Limit     int   `json:"limit"`
}

func (h *Handler) forwardTrafficResetLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req forwardTrafficResetLogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.ForwardID <= 0 {
		response.WriteJSON(w, response.Err(-1, "规则 ID 无效"))
		return
	}

	actorUserID, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}

	forward, accessErr := h.ensureForwardAccessByActor(actorUserID, actorRole, req.ForwardID)
	if accessErr != nil {
		response.WriteJSON(w, response.Err(403, "无权访问该规则"))
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 30
	}

	logs, err := h.repo.GetForwardTrafficResetLogs(req.ForwardID, limit)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "获取日志失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"forwardId":   forward.ID,
		"forwardName": forward.Name,
		"logs":        logs,
	}))
}

type nodeTrafficResetLogsRequest struct {
	NodeID int64 `json:"nodeId"`
	Limit  int   `json:"limit"`
}

func (h *Handler) nodeTrafficResetLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodeTrafficResetLogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.NodeID <= 0 {
		response.WriteJSON(w, response.Err(-1, "节点 ID 无效"))
		return
	}

	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "无权操作"))
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 30
	}

	logs, err := h.repo.GetNodeTrafficResetLogs(req.NodeID, limit)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "获取日志失败："+err.Error()))
		return
	}

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "节点不存在"))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":   node.ID,
		"nodeName": node.Name,
		"logs":     logs,
	}))
}

func (h *Handler) deleteNodeTrafficResetLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求方法错误"))
		return
	}

	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "无权操作"))
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.ID <= 0 {
		response.WriteJSON(w, response.Err(-1, "日志 ID 无效"))
		return
	}

	if err := h.repo.DeleteNodeTrafficResetLog(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-1, "删除失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) deleteForwardTrafficResetLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求方法错误"))
		return
	}

	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "无权操作"))
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.ID <= 0 {
		response.WriteJSON(w, response.Err(-1, "日志 ID 无效"))
		return
	}

	if err := h.repo.DeleteForwardTrafficResetLog(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-1, "删除失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}
