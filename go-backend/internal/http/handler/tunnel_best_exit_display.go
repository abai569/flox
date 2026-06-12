package handler

import (
	"fmt"
	"log"
	"strings"
)

const (
	bestExitDisplayStatusApplied = "applied"
	bestExitDisplayStatusWaiting = "waiting"
	bestExitDisplaySummaryMulti  = "多个出口"
	bestExitDisplaySummaryWait   = "等待探测"
	bestExitUnknownExitName      = "未知出口"
	bestExitUnknownEntryName     = "未知入口"
	bestExitUnknownChainName     = "未知中转"
)

type bestExitDecisionSnapshot struct {
	AppliedExitNodeID int64
	UpdatedAt         int64
	Reason            string
	Scores            []bestExitCandidateScore
}

type bestExitDisplayState struct {
	Enabled   bool                  `json:"enabled"`
	Summary   string                `json:"summary"`
	Status    string                `json:"status"`
	UpdatedAt int64                 `json:"updatedAt,omitempty"`
	Reason    string                `json:"reason,omitempty"`
	Items     []bestExitDisplayItem `json:"items"`
}

type bestExitDisplayItem struct {
	OwnerNodeID   int64  `json:"ownerNodeId"`
	OwnerNodeName string `json:"ownerNodeName"`
	OwnerRole     string `json:"ownerRole"`
	ExitNodeID    int64  `json:"exitNodeId,omitempty"`
	ExitNodeName  string `json:"exitNodeName"`
	HopIndex      int    `json:"hopIndex,omitempty"`
	UpdatedAt     int64  `json:"updatedAt,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

type bestExitNodeNameLookup func(nodeID int64) (string, bool)

func (m *bestExitManager) snapshot(key bestExitOwnerKey) (bestExitDecisionSnapshot, bool) {
	if m == nil {
		return bestExitDecisionSnapshot{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.decisions[key]
	if d == nil {
		return bestExitDecisionSnapshot{}, false
	}
	updatedAt := int64(0)
	if !d.LastSwitchAt.IsZero() {
		updatedAt = d.LastSwitchAt.UnixMilli()
	}
	return bestExitDecisionSnapshot{
		AppliedExitNodeID: d.AppliedExitNodeID,
		UpdatedAt:         updatedAt,
		Reason:            d.LastReason,
		Scores:            cloneBestExitScores(d.Scores),
	}, true
}

func (h *Handler) attachBestExitStates(items []map[string]interface{}) {
	if h == nil || len(items) == 0 {
		return
	}
	lookup := h.bestExitNodeNameLookup()
	for _, item := range items {
		state, ok := buildBestExitDisplayState(item, h.bestExit, lookup)
		if !ok {
			delete(item, "bestExitState")
			continue
		}
		item["bestExitState"] = state
	}
}

func (h *Handler) bestExitNodeNameLookup() bestExitNodeNameLookup {
	cache := map[int64]string{}
	return func(nodeID int64) (string, bool) {
		if nodeID <= 0 || h == nil {
			return "", false
		}
		if name, ok := cache[nodeID]; ok {
			return name, name != ""
		}
		node, err := h.getNodeRecord(nodeID)
		if err != nil || node == nil {
			cache[nodeID] = ""
			return "", false
		}
		name := strings.TrimSpace(node.Name)
		cache[nodeID] = name
		return name, name != ""
	}
}

func buildBestExitDisplayState(tunnel map[string]interface{}, manager *bestExitManager, lookup bestExitNodeNameLookup) (*bestExitDisplayState, bool) {
	if tunnel == nil {
		return nil, false
	}
	tunnelID := asInt64(tunnel["id"], 0)
	if tunnelID <= 0 {
		return nil, false
	}

	chainGroups := bestExitDisplayChainGroups(tunnel["chainNodes"])
	entryNodes := bestExitDisplayMapSlice(tunnel["inNodeId"])
	outNodes := bestExitDisplayMapSlice(tunnel["outNodeId"])

	type hopInfo struct {
		hopIndex int
		targets  []map[string]interface{}
		owners   []map[string]interface{}
		role     string
	}
	var bestHops []hopInfo

	if len(chainGroups) == 0 {
		if len(outNodes) <= 1 || !isBestTunnelStrategy(asString(outNodes[0]["strategy"])) {
			return nil, false
		}
		bestHops = append(bestHops, hopInfo{hopIndex: 0, targets: outNodes, owners: entryNodes, role: "entry"})
	} else {
		for i, group := range chainGroups {
			if len(group) <= 1 {
				continue
			}
			if !isBestTunnelStrategy(asString(group[0]["strategy"])) {
				continue
			}
			var owners []map[string]interface{}
			if i == 0 {
				owners = entryNodes
			} else {
				owners = chainGroups[i-1]
			}
			bestHops = append(bestHops, hopInfo{hopIndex: i + 1, targets: group, owners: owners, role: "chain"})
		}
		if len(outNodes) > 1 && isBestTunnelStrategy(asString(outNodes[0]["strategy"])) {
			var owners []map[string]interface{}
			if len(chainGroups) > 0 {
				owners = chainGroups[len(chainGroups)-1]
			} else {
				owners = entryNodes
			}
			bestHops = append(bestHops, hopInfo{hopIndex: 0, targets: outNodes, owners: owners, role: "entry"})
		}
	}

	if len(bestHops) == 0 {
		return nil, false
	}

	state := &bestExitDisplayState{
		Enabled: true,
		Summary: bestExitDisplaySummaryWait,
		Status:  bestExitDisplayStatusWaiting,
		Items:   make([]bestExitDisplayItem, 0),
	}

	appliedCount := 0
	latestUpdatedAt := int64(0)
	latestReason := ""
	appliedNames := map[string]bool{}

	for _, hop := range bestHops {
		targetsByID := map[int64]map[string]interface{}{}
		for _, t := range hop.targets {
			if id := asInt64(t["nodeId"], 0); id > 0 {
				targetsByID[id] = t
			}
		}
		for _, owner := range hop.owners {
			ownerNodeID := asInt64(owner["nodeId"], 0)
			if ownerNodeID <= 0 {
				continue
			}
			item := bestExitDisplayItem{
				OwnerNodeID:   ownerNodeID,
				OwnerNodeName: bestExitDisplayNodeName(owner, ownerNodeID, lookup, bestExitUnknownOwnerName(hop.role)),
				OwnerRole:     hop.role,
				HopIndex:      hop.hopIndex,
				ExitNodeName:  bestExitDisplaySummaryWait,
				Reason:        bestExitDisplayStatusWaiting,
			}
			key := bestExitOwnerKey{TunnelID: tunnelID, OwnerNodeID: ownerNodeID, HopIndex: hop.hopIndex}
			if snapshot, ok := manager.snapshot(key); ok && snapshot.AppliedExitNodeID > 0 {
				target, ok := targetsByID[snapshot.AppliedExitNodeID]
				if !ok {
					state.Items = append(state.Items, item)
					continue
				}
				item.ExitNodeID = snapshot.AppliedExitNodeID
				item.ExitNodeName = bestExitDisplayNodeName(target, snapshot.AppliedExitNodeID, lookup, bestExitUnknownExitName)
				item.UpdatedAt = snapshot.UpdatedAt
				item.Reason = snapshot.Reason
				name := item.ExitNodeName
				if hop.hopIndex > 0 {
					name = fmt.Sprintf("第%d跳→%s", hop.hopIndex, name)
				}
				appliedNames[name] = true
				appliedCount++
				if snapshot.UpdatedAt > latestUpdatedAt {
					latestUpdatedAt = snapshot.UpdatedAt
					latestReason = snapshot.Reason
				}
			}
			state.Items = append(state.Items, item)
		}
	}

	if appliedCount == 0 {
		return state, true
	}
	if appliedCount < len(state.Items) {
		return state, true
	}
	state.Status = bestExitDisplayStatusApplied
	state.UpdatedAt = latestUpdatedAt
	state.Reason = latestReason
	if len(appliedNames) == 1 {
		for name := range appliedNames {
			state.Summary = name
		}
	} else {
		state.Summary = bestExitDisplaySummaryMulti
	}
	return state, true
}

func bestExitDisplayMapSlice(v interface{}) []map[string]interface{} {
	switch arr := v.(type) {
	case []map[string]interface{}:
		return arr
	case []interface{}:
		out := make([]map[string]interface{}, 0, len(arr))
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func bestExitDisplayChainGroups(v interface{}) [][]map[string]interface{} {
	switch groups := v.(type) {
	case [][]map[string]interface{}:
		return groups
	case []interface{}:
		out := make([][]map[string]interface{}, 0, len(groups))
		for _, group := range groups {
			items := bestExitDisplayMapSlice(group)
			if len(items) > 0 {
				out = append(out, items)
			}
		}
		return out
	default:
		return nil
	}
}

func bestExitDisplayNodeName(source map[string]interface{}, nodeID int64, lookup bestExitNodeNameLookup, fallback string) string {
	if source != nil {
		for _, key := range []string{"nodeName", "name"} {
			if name := strings.TrimSpace(asString(source[key])); name != "" {
				return name
			}
		}
	}
	if lookup != nil {
		if name, ok := lookup(nodeID); ok && strings.TrimSpace(name) != "" {
			return strings.TrimSpace(name)
		}
	}
	return fallback
}

func bestExitUnknownOwnerName(role string) string {
	if role == "chain" {
		return bestExitUnknownChainName
	}
	return bestExitUnknownEntryName
}

func (h *Handler) attachBestExitStatesOrLog(items []map[string]interface{}) {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("best_exit: attach display state failed: %v", recovered)
		}
	}()
	h.attachBestExitStates(items)
}
