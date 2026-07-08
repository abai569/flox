package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"go-backend/internal/auth"
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

type nodeTerminalBrowserMessage struct {
	Type       string `json:"type"`
	Token      string `json:"token,omitempty"`
	NodeID     int64  `json:"nodeId,omitempty"`
	InstanceID string `json:"instanceId,omitempty"`
	SessionID  string `json:"sessionId,omitempty"`
	Data       string `json:"data,omitempty"`
	Cols       int    `json:"cols,omitempty"`
	Rows       int    `json:"rows,omitempty"`
}

type nodeTerminalEvent struct {
	SessionID string `json:"sessionId"`
	Event     string `json:"event"`
	Data      string `json:"data,omitempty"`
	Message   string `json:"message,omitempty"`
	ExitCode  int    `json:"exitCode,omitempty"`
}

var nodeTerminalUpgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func init() {
	registerRouteExtension(func(mux *http.ServeMux, h *Handler) {
		mux.HandleFunc("/api/v1/node/terminal/exec", h.nodeTerminalExec)
		mux.HandleFunc("/node-terminal/ws", h.nodeTerminalWS)
	})
}

func normalizeTerminalSize(cols, rows int) (int, int) {
	if cols < 20 {
		cols = 80
	}
	if cols > 300 {
		cols = 300
	}
	if rows < 5 {
		rows = 24
	}
	if rows > 120 {
		rows = 120
	}
	return cols, rows
}

func newTerminalSessionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b[:])
}

func (h *Handler) nodeTerminalWS(w http.ResponseWriter, r *http.Request) {
	conn, err := nodeTerminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var writeMu sync.Mutex
	writeJSON := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		err := conn.WriteJSON(v)
		_ = conn.SetWriteDeadline(time.Time{})
		return err
	}

	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	var openReq nodeTerminalBrowserMessage
	if err := conn.ReadJSON(&openReq); err != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Time{})

	if !strings.EqualFold(strings.TrimSpace(openReq.Type), "open") {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": "终端握手失败"})
		return
	}
	claims, ok := auth.ValidateToken(strings.TrimSpace(openReq.Token), h.jwtSecret)
	if !ok {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": "未登录或token已过期"})
		return
	}
	if claims.RoleID != 0 {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": "权限不足，仅管理员可操作"})
		return
	}
	openReq.InstanceID = strings.TrimSpace(openReq.InstanceID)
	if openReq.NodeID <= 0 || openReq.InstanceID == "" || strings.EqualFold(openReq.InstanceID, "default") {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": "节点实例不能为空"})
		return
	}
	if _, err := h.getNodeRecord(openReq.NodeID); err != nil {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": err.Error()})
		return
	}

	cols, rows := normalizeTerminalSize(openReq.Cols, openReq.Rows)
	sessionID := newTerminalSessionID()
	updates, unsubscribe := h.wsServer.SubscribeNodeMessages(128)
	defer unsubscribe()

	if err := h.wsServer.SendTypedMessageToInstance(openReq.NodeID, openReq.InstanceID, "TerminalOpen", map[string]interface{}{
		"sessionId": sessionID,
		"cols":      cols,
		"rows":      rows,
	}); err != nil {
		_ = writeJSON(map[string]interface{}{"event": "error", "message": err.Error()})
		return
	}
	defer func() {
		_ = h.wsServer.SendTypedMessageToInstance(openReq.NodeID, openReq.InstanceID, "TerminalClose", map[string]interface{}{"sessionId": sessionID})
	}()

	closed := make(chan struct{})
	var closeOnce sync.Once
	closeClosed := func() { closeOnce.Do(func() { close(closed) }) }
	go func() {
		defer closeClosed()
		for {
			var msg nodeTerminalBrowserMessage
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			switch strings.ToLower(strings.TrimSpace(msg.Type)) {
			case "input":
				_ = h.wsServer.SendTypedMessageToInstance(openReq.NodeID, openReq.InstanceID, "TerminalInput", map[string]interface{}{
					"sessionId": sessionID,
					"data":      msg.Data,
				})
			case "resize":
				cols, rows := normalizeTerminalSize(msg.Cols, msg.Rows)
				_ = h.wsServer.SendTypedMessageToInstance(openReq.NodeID, openReq.InstanceID, "TerminalResize", map[string]interface{}{
					"sessionId": sessionID,
					"cols":      cols,
					"rows":      rows,
				})
			case "close":
				return
			}
		}
	}()

	for {
		select {
		case <-closed:
			return
		case msg, ok := <-updates:
			if !ok {
				return
			}
			if msg.NodeID != openReq.NodeID || msg.InstanceID != openReq.InstanceID || msg.Type != "TerminalData" {
				continue
			}
			var event nodeTerminalEvent
			if err := json.Unmarshal(msg.Data, &event); err != nil || event.SessionID != sessionID {
				continue
			}
			if err := writeJSON(event); err != nil {
				return
			}
			if event.Event == "exit" || event.Event == "error" {
				return
			}
		}
	}
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
