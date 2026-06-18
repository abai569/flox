package handler

import (
	"fmt"
)

func (h *Handler) syncFloxChainTunnel(forward *forwardRecord, tunnel *tunnelRecord) {
	if forward == nil || tunnel == nil || tunnel.Type != 2 {
		return
	}
	if !isPremiumForwardMode(forward.Mode) {
		return
	}
	relayMode, _ := h.resolveTunnelRelayMode(forward.TunnelID)
	state, stateErr := h.buildTunnelStateForNftRelay(forward.TunnelID, relayMode)
	if stateErr != nil {
		fmt.Printf("[fc.debug] buildTunnelStateForNftRelay failed: %v\n", stateErr)
	} else if _, _, applyErr := h.applyTunnelRuntime(state); applyErr != nil {
		fmt.Printf("[fc.debug] applyTunnelRuntime failed: %v\n", applyErr)
	}
}
