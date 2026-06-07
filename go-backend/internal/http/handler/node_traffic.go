package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
	"go-backend/internal/telegram"
)

type nodeRecordOfflineLogRequest struct {
	NodeID        int64  `json:"nodeId"`
	InFlowBefore  int64  `json:"inFlowBefore"`
	OutFlowBefore int64  `json:"outFlowBefore"`
	Reason        string `json:"reason"`
}

func (h *Handler) nodeRecordOfflineLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodeRecordOfflineLogRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.NodeID == 0 {
		response.WriteJSON(w, response.Err(-1, "无效节点ID"))
		return
	}

	actorUserID, _, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}

	actorUserName := h.repo.GetUsernameByID(actorUserID)

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "节点不存在"))
		return
	}

	reason := req.Reason
	if reason == "" {
		reason = "节点离线"
	}

	if err := h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
		NodeID:        req.NodeID,
		NodeName:      node.Name,
		ResetTime:     time.Now().UnixMilli(),
		OperatorID:    actorUserID,
		OperatorName:  actorUserName,
		Reason:        reason,
		InFlowBefore:  req.InFlowBefore,
		OutFlowBefore: req.OutFlowBefore,
	}); err != nil {
		response.WriteJSON(w, response.Err(-1, "记录离线日志失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(nil))
}

type nodeBatchResetTrafficRequest struct {
	NodeIDs       []int64 `json:"nodeIds"`
	Reason        string  `json:"reason"`
	InFlowBefore  int64   `json:"inFlowBefore"`
	OutFlowBefore int64   `json:"outFlowBefore"`
}

type nodeBatchResetTrafficResult struct {
	NodeID   int64  `json:"nodeId"`
	NodeName string `json:"nodeName,omitempty"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

func (h *Handler) nodeBatchResetTraffic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodeBatchResetTrafficRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if len(req.NodeIDs) == 0 {
		response.WriteJSON(w, response.Err(-1, "请选择至少一个节点"))
		return
	}

	actorUserID, _, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}

	actorUserName := h.repo.GetUsernameByID(actorUserID)

	results := make([]nodeBatchResetTrafficResult, 0, len(req.NodeIDs))

	for _, nodeID := range req.NodeIDs {
		result := nodeBatchResetTrafficResult{
			NodeID:  nodeID,
			Success: false,
		}

		node, err := h.repo.GetNodeByID(nodeID)
		if err != nil {
			result.Error = "节点不存在"
			results = append(results, result)
			continue
		}

		cmdResult, err := h.sendNodeCommandWithTimeout(
			nodeID,
			"ResetTraffic",
			map[string]interface{}{
				"reason": req.Reason,
				"nodeId": nodeID,
			},
			10*time.Second,
			false,
			false,
		)

		if err != nil {
			result.Error = err.Error()
			results = append(results, result)
			continue
		}

		if !cmdResult.Success {
			result.Error = cmdResult.Message
			results = append(results, result)
			continue
		}

		if err := h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
			NodeID:        nodeID,
			NodeName:      node.Name,
			ResetTime:     time.Now().UnixMilli(),
			OperatorID:    actorUserID,
			OperatorName:  actorUserName,
			Reason:        req.Reason,
			InFlowBefore:  req.InFlowBefore,
			OutFlowBefore: req.OutFlowBefore,
		}); err != nil {
			result.Error = "归零成功但记录日志失败：" + err.Error()
			results = append(results, result)
			continue
		}

		result.Success = true
		result.NodeName = node.Name
		results = append(results, result)

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendNodeTrafficReset(node.Name, req.Reason)
		})
	}

	response.WriteJSON(w, response.OK(results))
}
