package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
	"go-backend/internal/telegram"
)

type nodeRecordOfflineLogRequest struct {
	NodeID        int64  `json:"nodeId"`
	InstanceID    string `json:"instanceId"`
	InFlowBefore  int64  `json:"inFlowBefore"`
	OutFlowBefore int64  `json:"outFlowBefore"`
	Reason        string `json:"reason"`
}

type nodeTrafficInstanceTarget struct {
	NodeID     int64  `json:"nodeId"`
	InstanceID string `json:"instanceId"`
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
	nodeName := node.Name
	if strings.TrimSpace(req.InstanceID) != "" {
		instances, _ := h.repo.ListNodeInstances(req.NodeID)
		for _, inst := range instances {
			if inst.InstanceID != strings.TrimSpace(req.InstanceID) {
				continue
			}
			label := strings.TrimSpace(inst.DisplayName)
			if label == "" && inst.DisplayIndex > 0 {
				label = fmt.Sprintf("实例 %d", inst.DisplayIndex)
			}
			if label != "" {
				nodeName += " / " + label
			}
			break
		}
	}

	reason := req.Reason
	if reason == "" {
		reason = "节点离线"
	}

	if err := h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
		NodeID:        req.NodeID,
		NodeName:      nodeName,
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
	NodeIDs       []int64                     `json:"nodeIds"`
	Instances     []nodeTrafficInstanceTarget `json:"instances"`
	Reason        string                      `json:"reason"`
	InFlowBefore  int64                       `json:"inFlowBefore"`
	OutFlowBefore int64                       `json:"outFlowBefore"`
}

type nodeBatchResetTrafficResult struct {
	NodeID     int64  `json:"nodeId"`
	InstanceID string `json:"instanceId,omitempty"`
	NodeName   string `json:"nodeName,omitempty"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
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

	if len(req.NodeIDs) == 0 && len(req.Instances) == 0 {
		response.WriteJSON(w, response.Err(-1, "请选择至少一个节点"))
		return
	}

	actorUserID, _, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的 token 或 token 已过期"))
		return
	}

	actorUserName := h.repo.GetUsernameByID(actorUserID)

	results := make([]nodeBatchResetTrafficResult, 0, len(req.NodeIDs)+len(req.Instances))

	for _, instTarget := range req.Instances {
		result := nodeBatchResetTrafficResult{
			NodeID:     instTarget.NodeID,
			InstanceID: strings.TrimSpace(instTarget.InstanceID),
			Success:    false,
		}
		if result.NodeID == 0 || result.InstanceID == "" {
			result.Error = "无效实例"
			results = append(results, result)
			continue
		}
		node, err := h.repo.GetNodeByID(result.NodeID)
		if err != nil {
			result.Error = "节点不存在"
			results = append(results, result)
			continue
		}
		instList, _ := h.repo.ListNodeInstances(result.NodeID)
		matched := false
		for _, inst := range instList {
			if inst.InstanceID != result.InstanceID {
				continue
			}
			matched = true
			cmdResult, err := h.sendNodeCommandToInstanceWithTimeout(
				result.NodeID,
				result.InstanceID,
				"ResetTraffic",
				map[string]interface{}{
					"reason":     req.Reason,
					"nodeId":     result.NodeID,
					"instanceId": result.InstanceID,
				},
				10*time.Second,
				false,
				false,
			)
			if err != nil {
				result.Error = err.Error()
				results = append(results, result)
				break
			}
			if !cmdResult.Success {
				result.Error = cmdResult.Message
				results = append(results, result)
				break
			}
			label := strings.TrimSpace(inst.DisplayName)
			if label == "" && inst.DisplayIndex > 0 {
				label = fmt.Sprintf("实例 %d", inst.DisplayIndex)
			}
			nodeName := node.Name
			if label != "" {
				nodeName += " / " + label
			}
			if err := h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
				NodeID:        result.NodeID,
				NodeName:      nodeName,
				ResetTime:     time.Now().UnixMilli(),
				OperatorID:    actorUserID,
				OperatorName:  actorUserName,
				Reason:        req.Reason,
				InFlowBefore:  req.InFlowBefore,
				OutFlowBefore: req.OutFlowBefore,
			}); err != nil {
				result.Error = "归零成功但记录日志失败：" + err.Error()
				results = append(results, result)
				break
			}
			result.Success = true
			result.NodeName = nodeName
			results = append(results, result)
			_ = h.repo.UpdateNodeInstanceTrafficNotifiedMask(result.NodeID, result.InstanceID, 0)
			h.deleteNodeTrafficCacheEntries(result.NodeID)
			h.sendBotNotification(func(bot *telegram.Bot) {
				bot.SendNodeTrafficReset(nodeName, req.Reason)
			})
			break
		}
		if !matched {
			result.Error = "实例不存在"
			results = append(results, result)
		}
	}

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
			map[string]interface{}{"reason": req.Reason, "nodeId": nodeID},
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

		_ = h.repo.UpdateNodeTrafficNotifiedMask(nodeID, 0)
		h.deleteNodeTrafficCacheEntries(nodeID)

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendNodeTrafficReset(node.Name, req.Reason)
		})
	}

	response.WriteJSON(w, response.OK(results))
}

type nodeResetTotalFlowRequest struct {
	NodeID int64 `json:"nodeId"`
}

func (h *Handler) nodeResetTotalFlow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodeResetTotalFlowRequest
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
	_ = actorUserID

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "节点不存在"))
		return
	}

	if err := h.repo.ResetNodeTotalFlow(req.NodeID); err != nil {
		response.WriteJSON(w, response.Err(-1, "归零失败："+err.Error()))
		return
	}

	_ = h.repo.UpdateNodeTrafficNotifiedMask(req.NodeID, 0)
	h.deleteNodeTrafficCacheEntries(req.NodeID)

	h.sendBotNotification(func(bot *telegram.Bot) {
		bot.SendNodeTrafficReset(node.Name, "管理员归零全量流量")
	})

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":   req.NodeID,
		"nodeName": node.Name,
		"success":  true,
	}))
}

type nodePauseRequest struct {
	NodeID int64 `json:"nodeId"`
}

func (h *Handler) nodePause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodePauseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.NodeID == 0 {
		response.WriteJSON(w, response.Err(-1, "无效节点ID"))
		return
	}

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "节点不存在"))
		return
	}

	_, err = h.sendNodeCommand(req.NodeID, "PauseNode", nil, false, false)
	if err == nil && h.repo != nil {
		_ = h.repo.SetNodePaused(req.NodeID, 1)
	}

	if err != nil {
		response.WriteJSON(w, response.Err(-1, "暂停失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":   req.NodeID,
		"nodeName": node.Name,
		"success":  true,
	}))
}

func (h *Handler) nodeResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req nodePauseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.Err(-1, "无效的请求数据"))
		return
	}

	if req.NodeID == 0 {
		response.WriteJSON(w, response.Err(-1, "无效节点ID"))
		return
	}

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-1, "节点不存在"))
		return
	}

	_, err = h.sendNodeCommand(req.NodeID, "ResumeNode", nil, false, false)
	if err == nil && h.repo != nil {
		_ = h.repo.SetNodePaused(req.NodeID, 0)
	}

	if err != nil {
		response.WriteJSON(w, response.Err(-1, "恢复失败："+err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":   req.NodeID,
		"nodeName": node.Name,
		"success":  true,
	}))
}
