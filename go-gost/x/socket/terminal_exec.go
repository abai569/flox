package socket

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	terminalExecDefaultTimeoutSec = 30
	terminalExecMaxTimeoutSec     = 60
	terminalExecOutputLimitBytes  = 256 * 1024
)

type TerminalExecRequest struct {
	Command    string `json:"command"`
	TimeoutSec int    `json:"timeoutSec,omitempty"`
}

type TerminalExecResult struct {
	Command    string `json:"command"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
	TimedOut   bool   `json:"timedOut"`
	Truncated  bool   `json:"truncated"`
	Shell      string `json:"shell"`
}

type terminalLimitedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func init() {
	registerCommandExtension(func(w *WebSocketReporter, cmd CommandMessage, response *CommandResponse) (bool, error) {
		switch cmd.Type {
		case "TerminalExec":
			terminalResult, err := w.handleTerminalExec(cmd.Data)
			response.Type = "TerminalExecResponse"
			response.Data = terminalResult
			return true, err
		case "TerminalOpen":
			response.Type = "TerminalOpenResponse"
			return true, w.handleTerminalOpen(cmd.Data)
		case "TerminalInput":
			response.Type = "TerminalInputResponse"
			return true, handleTerminalInput(cmd.Data)
		case "TerminalResize":
			response.Type = "TerminalResizeResponse"
			return true, handleTerminalResize(cmd.Data)
		case "TerminalClose":
			response.Type = "TerminalCloseResponse"
			return true, handleTerminalClose(cmd.Data)
		default:
			return false, nil
		}
	})
}

type TerminalOpenRequest struct {
	SessionID string `json:"sessionId"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type TerminalInputRequest struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
}

type TerminalResizeRequest struct {
	SessionID string `json:"sessionId"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type TerminalCloseRequest struct {
	SessionID string `json:"sessionId"`
}

type TerminalDataEvent struct {
	SessionID string `json:"sessionId"`
	Event     string `json:"event"`
	Data      string `json:"data,omitempty"`
	Message   string `json:"message,omitempty"`
	ExitCode  int    `json:"exitCode,omitempty"`
}

func decodeTerminalRequest(data interface{}, out interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, out)
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

func (w *WebSocketReporter) sendTerminalEvent(event TerminalDataEvent) error {
	if strings.TrimSpace(event.SessionID) == "" {
		return fmt.Errorf("terminal session id is empty")
	}
	envelope := map[string]interface{}{
		"type": "TerminalData",
		"data": event,
	}
	jsonData, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	messageData := w.encryptPayload(jsonData)
	w.connMutex.Lock()
	defer w.connMutex.Unlock()
	if w.conn == nil || !w.connected {
		return fmt.Errorf("连接未建立")
	}
	_ = w.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	err = w.conn.WriteMessage(websocket.TextMessage, messageData)
	_ = w.conn.SetWriteDeadline(time.Time{})
	return err
}

func (b *terminalLimitedBuffer) Write(p []byte) (int, error) {
	written := len(p)
	if b.limit <= 0 {
		return written, nil
	}
	remaining := b.limit - b.buf.Len()
	if remaining <= 0 {
		if len(p) > 0 {
			b.truncated = true
		}
		return written, nil
	}
	if len(p) > remaining {
		_, _ = b.buf.Write(p[:remaining])
		b.truncated = true
		return written, nil
	}
	_, _ = b.buf.Write(p)
	return written, nil
}

func (b *terminalLimitedBuffer) String() string {
	return b.buf.String()
}

func (b *terminalLimitedBuffer) Truncated() bool {
	return b.truncated
}

func (w *WebSocketReporter) handleTerminalExec(data interface{}) (TerminalExecResult, error) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return TerminalExecResult{}, fmt.Errorf("序列化终端命令失败: %v", err)
	}

	var req TerminalExecRequest
	if err := json.Unmarshal(jsonData, &req); err != nil {
		return TerminalExecResult{}, fmt.Errorf("解析终端命令失败: %v", err)
	}

	command := strings.TrimSpace(req.Command)
	if command == "" {
		return TerminalExecResult{}, fmt.Errorf("命令不能为空")
	}
	if len(command) > 4096 {
		return TerminalExecResult{}, fmt.Errorf("命令过长")
	}

	timeoutSec := req.TimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = terminalExecDefaultTimeoutSec
	}
	if timeoutSec > terminalExecMaxTimeoutSec {
		timeoutSec = terminalExecMaxTimeoutSec
	}

	shell, args, err := terminalShellCommand(command)
	if err != nil {
		return TerminalExecResult{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, shell, args...)
	var stdout terminalLimitedBuffer
	var stderr terminalLimitedBuffer
	stdout.limit = terminalExecOutputLimitBytes
	stderr.limit = terminalExecOutputLimitBytes
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startedAt := time.Now()
	err = cmd.Run()
	durationMs := time.Since(startedAt).Milliseconds()
	timedOut := ctx.Err() == context.DeadlineExceeded
	exitCode := 0

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if timedOut {
			exitCode = -1
		} else {
			return TerminalExecResult{}, fmt.Errorf("执行命令失败: %v", err)
		}
	}
	if timedOut && stderr.String() == "" {
		_, _ = stderr.Write([]byte(fmt.Sprintf("command timed out after %ds\n", timeoutSec)))
	}

	return TerminalExecResult{
		Command:    command,
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ExitCode:   exitCode,
		DurationMs: durationMs,
		TimedOut:   timedOut,
		Truncated:  stdout.Truncated() || stderr.Truncated(),
		Shell:      shell,
	}, nil
}

func terminalShellCommand(command string) (string, []string, error) {
	if runtime.GOOS == "windows" {
		shell := strings.TrimSpace(os.Getenv("COMSPEC"))
		if shell == "" {
			shell = "cmd.exe"
		}
		if path, err := exec.LookPath(shell); err == nil {
			shell = path
		}
		return shell, []string{"/C", command}, nil
	}

	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		if path, err := exec.LookPath(shell); err == nil {
			return path, terminalShellArgs(path, command), nil
		}
	}
	for _, shell := range []string{"/bin/bash", "/bin/sh", "bash", "sh"} {
		if path, err := exec.LookPath(shell); err == nil {
			return path, terminalShellArgs(path, command), nil
		}
	}
	return "", nil, fmt.Errorf("找不到可用 shell")
}

func terminalShellArgs(shell string, command string) []string {
	name := strings.ToLower(filepath.Base(shell))
	if strings.Contains(name, "bash") || strings.Contains(name, "zsh") {
		return []string{"-lc", command}
	}
	return []string{"-c", command}
}
