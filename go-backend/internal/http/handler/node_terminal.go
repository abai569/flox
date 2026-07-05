package handler

import (
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
)

const (
	terminalExecDefaultTimeoutSec = 30
	terminalExecMaxTimeoutSec     = 60
	terminalExecPanelGrace        = 5 * time.Second
)

type nodeTerminalExecRequest struct {
	NodeID     int64  `json:"nodeId"`
	InstanceID string `json:"instanceId"`
	Command    string `json:"command"`
	TimeoutSec int    `json:"timeoutSec"`
}

func (h *Handler) nodeTerminalExec(w http.ResponseWriter, r *http.Request) {
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

	var req nodeTerminalExecRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	req.InstanceID = strings.TrimSpace(req.InstanceID)
	req.Command = strings.TrimSpace(req.Command)
	if req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	if req.InstanceID == "" || strings.EqualFold(req.InstanceID, "default") {
		response.WriteJSON(w, response.ErrDefault("节点实例不能为空"))
		return
	}
	if req.Command == "" {
		response.WriteJSON(w, response.ErrDefault("命令不能为空"))
		return
	}
	if len(req.Command) > 4096 {
		response.WriteJSON(w, response.ErrDefault("命令过长"))
		return
	}
	if _, err := h.getNodeRecord(req.NodeID); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = terminalExecDefaultTimeoutSec
	}
	if timeoutSec > terminalExecMaxTimeoutSec {
		timeoutSec = terminalExecMaxTimeoutSec
	}

	result, err := h.sendNodeCommandToInstanceWithTimeout(
		req.NodeID,
		req.InstanceID,
		"TerminalExec",
		map[string]interface{}{
			"command":    req.Command,
			"timeoutSec": timeoutSec,
		},
		time.Duration(timeoutSec)*time.Second+terminalExecPanelGrace,
		false,
		false,
	)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	data := result.Data
	if data == nil {
		data = map[string]interface{}{}
	}
	data["nodeId"] = req.NodeID
	data["instanceId"] = result.InstanceID
	data["hostname"] = result.Hostname
	response.WriteJSON(w, response.OK(data))
}
