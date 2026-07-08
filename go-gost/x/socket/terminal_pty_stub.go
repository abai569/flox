//go:build !linux

package socket

import "fmt"

func (w *WebSocketReporter) handleTerminalOpen(data interface{}) error {
	var req TerminalOpenRequest
	_ = decodeTerminalRequest(data, &req)
	if req.SessionID != "" {
		_ = w.sendTerminalEvent(TerminalDataEvent{SessionID: req.SessionID, Event: "error", Message: "当前系统不支持交互式终端"})
	}
	return fmt.Errorf("当前系统不支持交互式终端")
}

func handleTerminalInput(data interface{}) error {
	return fmt.Errorf("当前系统不支持交互式终端")
}

func handleTerminalResize(data interface{}) error {
	return fmt.Errorf("当前系统不支持交互式终端")
}

func handleTerminalClose(data interface{}) error {
	return nil
}

func (w *WebSocketReporter) CloseTerminalSessions() {}
