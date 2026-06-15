//go:build !linux

package socket

import "encoding/json"

func (w *WebSocketReporter) handleAddNftablesRules(data json.RawMessage) error {
	return nil
}

func (w *WebSocketReporter) handleUpdateNftablesRules(data json.RawMessage) error {
	return nil
}

func (w *WebSocketReporter) handleDeleteNftablesRules(data json.RawMessage) error {
	return nil
}

func (w *WebSocketReporter) handleGetNftablesCounters(data json.RawMessage) error {
	return nil
}

func (w *WebSocketReporter) handleResetNftablesCounters(data json.RawMessage) error {
	return nil
}

func (w *WebSocketReporter) handleCleanStaleNftRules(data json.RawMessage) error {
	return nil
}
