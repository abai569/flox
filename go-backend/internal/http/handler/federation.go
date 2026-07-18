package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go-backend/internal/http/client"
	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
)

type federationTunnelRequest struct {
	Protocol   string `json:"protocol"`
	RemotePort int    `json:"remotePort"`
	Target     string `json:"target"`
}

type createPeerShareRequest struct {
	Name                    string             `json:"name"`
	NodeID                  int64              `json:"nodeId"`
	MaxBandwidth            int64              `json:"maxBandwidth"`
	ExpiryTime              int64              `json:"expiryTime"`
	PortRangeStart          int                `json:"portRangeStart"`
	PortRangeEnd            int                `json:"portRangeEnd"`
	AllowedDomains          string             `json:"allowedDomains"`
	AllowedIPs              string             `json:"allowedIps"`
	ScopeType               string             `json:"scopeType"`
	AutoIncludeNewInstances *bool              `json:"autoIncludeNewInstances"`
	MinHealthyInstances     int                `json:"minHealthyInstances"`
	InstanceIDs             []string           `json:"instanceIds"`
	TrafficRatio            *float64           `json:"trafficRatio"`
	InstanceTrafficRatios   map[string]float64 `json:"instanceTrafficRatios"`
}

type deletePeerShareRequest struct {
	ID int64 `json:"id"`
}

type resetPeerShareFlowRequest struct {
	ID int64 `json:"id"`
}

type updatePeerShareStatusRequest struct {
	ID       int64 `json:"id"`
	IsActive int   `json:"isActive"`
}

type updatePeerShareRequest struct {
	ID                      int64              `json:"id"`
	Name                    string             `json:"name"`
	MaxBandwidth            int64              `json:"maxBandwidth"`
	ExpiryTime              int64              `json:"expiryTime"`
	PortRangeStart          int                `json:"portRangeStart"`
	PortRangeEnd            int                `json:"portRangeEnd"`
	AllowedDomains          string             `json:"allowedDomains"`
	AllowedIPs              string             `json:"allowedIps"`
	ScopeType               string             `json:"scopeType"`
	AutoIncludeNewInstances *bool              `json:"autoIncludeNewInstances"`
	MinHealthyInstances     int                `json:"minHealthyInstances"`
	InstanceIDs             []string           `json:"instanceIds"`
	TrafficRatio            *float64           `json:"trafficRatio"`
	InstanceTrafficRatios   map[string]float64 `json:"instanceTrafficRatios"`
}

type nodeImportRequest struct {
	RemoteURL string `json:"remoteUrl"`
	Token     string `json:"token"`
}

func normalizeRemotePanelURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(strings.ToLower(value), "http://") && !strings.HasPrefix(strings.ToLower(value), "https://") {
		value = "https://" + value
	}
	return strings.TrimRight(value, "/")
}

type federationRuntimeReservePortRequest struct {
	ResourceKey   string `json:"resourceKey"`
	Protocol      string `json:"protocol"`
	RequestedPort int    `json:"requestedPort"`
}

type federationRuntimeTarget struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
}

type federationRuntimeApplyRoleRequest struct {
	ReservationID string                    `json:"reservationId"`
	ResourceKey   string                    `json:"resourceKey"`
	Role          string                    `json:"role"`
	Protocol      string                    `json:"protocol"`
	Strategy      string                    `json:"strategy"`
	Targets       []federationRuntimeTarget `json:"targets"`
}

type federationRuntimeReleaseRoleRequest struct {
	BindingID     string `json:"bindingId"`
	ReservationID string `json:"reservationId"`
	ResourceKey   string `json:"resourceKey"`
}

type federationRuntimeDiagnoseRequest struct {
	IP      string `json:"ip"`
	Port    int    `json:"port"`
	Count   int    `json:"count"`
	Timeout int    `json:"timeout"`
}

type federationRuntimeCommandRequest struct {
	CommandType string      `json:"commandType"`
	Data        interface{} `json:"data"`
}

type peerShareUsedPort struct {
	RuntimeID   int64                           `json:"runtimeId"`
	Port        int                             `json:"port"`
	Role        string                          `json:"role"`
	Protocol    string                          `json:"protocol"`
	ResourceKey string                          `json:"resourceKey"`
	Applied     int                             `json:"applied"`
	UpdatedTime int64                           `json:"updatedTime"`
	Instances   []repo.PeerShareRuntimeInstance `json:"instances"`
}

type peerShareListItem struct {
	repo.PeerShare
	UsedPorts        []int                     `json:"usedPorts"`
	UsedPortDetails  []peerShareUsedPort       `json:"usedPortDetails"`
	ActiveRuntimeNum int                       `json:"activeRuntimeNum"`
	Instances        []peerShareInstanceStatus `json:"instances"`
	Flows            []repo.PeerShareFlow      `json:"flows"`
}

type peerShareInstanceStatus struct {
	InstanceID    string  `json:"instanceId"`
	DisplayName   string  `json:"displayName,omitempty"`
	DisplayIndex  int     `json:"displayIndex,omitempty"`
	Hostname      string  `json:"hostname"`
	PublicIPV4    string  `json:"publicIpV4"`
	PublicIPV6    string  `json:"publicIpV6"`
	Version       string  `json:"version"`
	Status        int     `json:"status"`
	Weight        int     `json:"weight"`
	TrafficRatio  float64 `json:"trafficRatio"`
	ExpiryTime    int64   `json:"expiryTime"`
	RenewalCycle  string  `json:"renewalCycle"`
	FlowResetTime int     `json:"flowResetTime"`
	TrafficLimit  int64   `json:"trafficLimit"`
	TotalInFlow   int64   `json:"totalInFlow"`
	TotalOutFlow  int64   `json:"totalOutFlow"`
	PeriodRx      int64   `json:"periodRx"`
	PeriodTx      int64   `json:"periodTx"`
	NetInSpeed    int64   `json:"netInSpeed"`
	NetOutSpeed   int64   `json:"netOutSpeed"`
	NetInBytes    int64   `json:"netInBytes"`
	NetOutBytes   int64   `json:"netOutBytes"`
	TCPConns      int64   `json:"tcpConns"`
	UDPConns      int64   `json:"udpConns"`
	Uptime        int64   `json:"uptime"`
	CPUUsage      float64 `json:"cpuUsage"`
	MemUsage      float64 `json:"memUsage"`
	DiskUsage     float64 `json:"diskUsage"`
	Selected      bool    `json:"selected"`
	InScope       bool    `json:"inScope"`
}

type remoteUsageBindingItem struct {
	BindingID       int64  `json:"bindingId"`
	TunnelID        int64  `json:"tunnelId"`
	TunnelName      string `json:"tunnelName"`
	ChainType       int    `json:"chainType"`
	HopInx          int    `json:"hopInx"`
	AllocatedPort   int    `json:"allocatedPort"`
	ResourceKey     string `json:"resourceKey"`
	RemoteBindingID string `json:"remoteBindingId"`
	UpdatedTime     int64  `json:"updatedTime"`
}

type remoteUsageNodeItem struct {
	NodeID             int64                          `json:"nodeId"`
	NodeName           string                         `json:"nodeName"`
	RemoteURL          string                         `json:"remoteUrl"`
	ShareID            int64                          `json:"shareId"`
	PortRangeStart     int                            `json:"portRangeStart"`
	PortRangeEnd       int                            `json:"portRangeEnd"`
	MaxBandwidth       int64                          `json:"maxBandwidth"`
	CurrentFlow        int64                          `json:"currentFlow"`
	RemoteCurrentFlow  int64                          `json:"remoteCurrentFlow"`
	RemoteInFlow       int64                          `json:"remoteInFlow"`
	RemoteOutFlow      int64                          `json:"remoteOutFlow"`
	RemoteMaxBandwidth int64                          `json:"remoteMaxBandwidth"`
	RemoteExpiryTime   int64                          `json:"remoteExpiryTime"`
	ExpiryTime         int64                          `json:"expiryTime"`
	UsedPorts          []int                          `json:"usedPorts"`
	Bindings           []remoteUsageBindingItem       `json:"bindings"`
	ActiveBindingNum   int                            `json:"activeBindingNum"`
	SyncError          string                         `json:"syncError,omitempty"`
	Instances          []client.RemoteNodeInstance    `json:"instances"`
	Flows              []client.RemoteShareFlow       `json:"flows"`
	RuntimeInstances   []client.RemoteRuntimeInstance `json:"runtimeInstances"`
}

func (h *Handler) validatePeerShareScope(nodeID int64, rawScope string, autoRequested *bool, minHealthy int, requested []string) (string, int, int, []string, error) {
	scopeType := strings.ToLower(strings.TrimSpace(rawScope))
	if scopeType == "" {
		scopeType = "all_enabled"
	}
	if scopeType != "all_enabled" && scopeType != "selected" {
		return "", 0, 0, nil, fmt.Errorf("scopeType must be all_enabled or selected")
	}
	autoInclude := scopeType == "all_enabled"
	if autoRequested != nil {
		autoInclude = *autoRequested
	}
	instances, err := h.repo.ListNodeInstances(nodeID)
	if err != nil {
		return "", 0, 0, nil, err
	}
	valid := make(map[string]struct{}, len(instances))
	allIDs := make([]string, 0, len(instances))
	for _, inst := range instances {
		instanceID := strings.TrimSpace(inst.InstanceID)
		if instanceID == "" {
			continue
		}
		valid[instanceID] = struct{}{}
		allIDs = append(allIDs, instanceID)
	}
	selected := make([]string, 0, len(requested))
	seen := make(map[string]struct{}, len(requested))
	for _, raw := range requested {
		instanceID := strings.TrimSpace(raw)
		if instanceID == "" {
			continue
		}
		if _, ok := valid[instanceID]; !ok {
			return "", 0, 0, nil, fmt.Errorf("instance %s does not belong to node %d", instanceID, nodeID)
		}
		if _, ok := seen[instanceID]; ok {
			continue
		}
		seen[instanceID] = struct{}{}
		selected = append(selected, instanceID)
	}
	if scopeType == "selected" && len(selected) == 0 {
		return "", 0, 0, nil, fmt.Errorf("instanceIds are required for selected scope")
	}
	if scopeType == "all_enabled" {
		selected = allIDs
	}
	sort.Strings(selected)
	if minHealthy <= 0 {
		minHealthy = 1
	}
	effectiveInstanceCount := len(selected)
	if effectiveInstanceCount == 0 && scopeType == "all_enabled" {
		// Nodes without instance records use the legacy single-session command path.
		effectiveInstanceCount = 1
	}
	if minHealthy > effectiveInstanceCount {
		return "", 0, 0, nil, fmt.Errorf("minHealthyInstances cannot exceed scoped instance count")
	}
	return scopeType, federationBoolInt(autoInclude), minHealthy, selected, nil
}

func federationBoolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func (h *Handler) peerShareInstanceStatuses(share *repo.PeerShare) ([]peerShareInstanceStatus, error) {
	if share == nil {
		return []peerShareInstanceStatus{}, nil
	}
	instances, err := h.repo.ListNodeInstances(share.NodeID)
	if err != nil {
		return nil, err
	}
	selectedRows, err := h.repo.ListPeerShareInstances(share.ID)
	if err != nil {
		return nil, err
	}
	selected := make(map[string]float64, len(selectedRows))
	for _, row := range selectedRows {
		selected[row.InstanceID] = row.TrafficRatio
	}
	out := make([]peerShareInstanceStatus, 0, len(instances)+len(selectedRows))
	seen := make(map[string]struct{}, len(instances))
	for _, inst := range instances {
		overrideRatio, explicitlySelected := selected[inst.InstanceID]
		inScope := explicitlySelected
		if share.ScopeType == "all_enabled" && share.AutoIncludeNewInstances == 1 {
			inScope = true
		}
		out = append(out, peerShareInstanceStatus{
			InstanceID: inst.InstanceID, DisplayName: inst.DisplayName,
			DisplayIndex: inst.DisplayIndex, Hostname: inst.Hostname,
			PublicIPV4: inst.PublicIPV4, PublicIPV6: inst.PublicIPV6,
			Version: inst.Version, Status: inst.Status, Weight: inst.Weight, TrafficRatio: overrideRatio,
			ExpiryTime: nullableInt64Value(inst.ExpiryTime), RenewalCycle: nullableStringValue(inst.RenewalCycle),
			FlowResetTime: inst.FlowResetTime, TrafficLimit: inst.TrafficLimit,
			TotalInFlow: inst.TotalInFlow, TotalOutFlow: inst.TotalOutFlow, PeriodRx: inst.PeriodRx, PeriodTx: inst.PeriodTx,
			NetInSpeed: inst.NetInSpeed, NetOutSpeed: inst.NetOutSpeed, NetInBytes: inst.NetInBytes, NetOutBytes: inst.NetOutBytes,
			TCPConns: inst.TCPConns, UDPConns: inst.UDPConns, Uptime: inst.Uptime,
			CPUUsage: inst.CPUUsage, MemUsage: inst.MemUsage, DiskUsage: inst.DiskUsage,
			Selected: explicitlySelected, InScope: inScope,
		})
		seen[inst.InstanceID] = struct{}{}
	}
	for _, row := range selectedRows {
		if _, ok := seen[row.InstanceID]; ok {
			continue
		}
		out = append(out, peerShareInstanceStatus{InstanceID: row.InstanceID, TrafficRatio: row.TrafficRatio, Selected: true, InScope: true})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].DisplayIndex != out[j].DisplayIndex {
			return out[i].DisplayIndex < out[j].DisplayIndex
		}
		return out[i].InstanceID < out[j].InstanceID
	})
	return out, nil
}

func nullableInt64Value(value sql.NullInt64) int64 {
	if value.Valid {
		return value.Int64
	}
	return 0
}

func nullableStringValue(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func remoteNodeInstanceSyncItems(items []client.RemoteNodeInstance) []repo.RemoteNodeInstanceSync {
	out := make([]repo.RemoteNodeInstanceSync, 0, len(items))
	for _, item := range items {
		out = append(out, repo.RemoteNodeInstanceSync{
			InstanceID: item.InstanceID, DisplayName: item.DisplayName, DisplayIndex: item.DisplayIndex,
			Hostname: item.Hostname, PublicIPV4: item.PublicIPV4, PublicIPV6: item.PublicIPV6,
			Version: item.Version, Status: item.Status, Weight: item.Weight,
			TrafficRatio: item.TrafficRatio,
			ExpiryTime:   item.ExpiryTime, RenewalCycle: item.RenewalCycle, FlowResetTime: item.FlowResetTime,
			TrafficLimit: item.TrafficLimit, TotalInFlow: item.TotalInFlow, TotalOutFlow: item.TotalOutFlow,
			PeriodRx: item.PeriodRx, PeriodTx: item.PeriodTx, NetInSpeed: item.NetInSpeed, NetOutSpeed: item.NetOutSpeed,
			NetInBytes: item.NetInBytes, NetOutBytes: item.NetOutBytes, TCPConns: item.TCPConns, UDPConns: item.UDPConns,
			Uptime: item.Uptime, CPUUsage: item.CPUUsage, MemUsage: item.MemUsage, DiskUsage: item.DiskUsage,
		})
	}
	return out
}

func mustPeerShareConnectInstances(h *Handler, share *repo.PeerShare) []peerShareInstanceStatus {
	items, err := h.peerShareInstanceStatuses(share)
	if err != nil {
		return []peerShareInstanceStatus{}
	}
	result := make([]peerShareInstanceStatus, 0, len(items))
	for _, item := range items {
		if !item.InScope {
			continue
		}
		if item.TrafficRatio <= 0 {
			item.TrafficRatio = share.TrafficRatio
		}
		result = append(result, item)
	}
	return result
}

func validatePeerShareTrafficRatios(trafficRatio float64, instanceIDs []string, instanceRatios map[string]float64) error {
	if math.IsNaN(trafficRatio) || math.IsInf(trafficRatio, 0) || trafficRatio <= 0 || trafficRatio > 100 {
		return errors.New("trafficRatio must be greater than 0 and at most 100")
	}
	allowed := make(map[string]struct{}, len(instanceIDs))
	for _, instanceID := range instanceIDs {
		allowed[instanceID] = struct{}{}
	}
	for instanceID, ratio := range instanceRatios {
		if _, ok := allowed[strings.TrimSpace(instanceID)]; !ok {
			return fmt.Errorf("instanceTrafficRatios contains out-of-scope instance %s", instanceID)
		}
		if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 100 {
			return fmt.Errorf("instance traffic ratio for %s must be 0 or greater than 0 and at most 100", instanceID)
		}
	}
	return nil
}

func buildFederationServiceConfig(serviceName, addr, protocol, role, chainName string, targetCount int, interfaceName string) map[string]interface{} {
	handler := map[string]interface{}{
		"type": "relay",
	}
	if strings.EqualFold(protocol, "tls") {
		handler["metadata"] = map[string]interface{}{
			"nodelay": true,
			"udpTTL":  "5s",
		}
	}
	service := map[string]interface{}{
		"name":    serviceName,
		"addr":    addr,
		"handler": handler,
		"listener": map[string]interface{}{
			"type": protocol,
		},
	}
	if role == "middle" {
		service["handler"].(map[string]interface{})["chain"] = chainName
		if targetCount > 1 {
			service["handler"].(map[string]interface{})["retries"] = targetCount - 1
		}
	}
	if role == "exit" && strings.TrimSpace(interfaceName) != "" {
		service["metadata"] = map[string]interface{}{"interface": interfaceName}
	}
	return service
}

func (h *Handler) federationShareList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	shares, err := h.repo.ListPeerShares()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	items := make([]peerShareListItem, 0, len(shares))
	for i := range shares {
		share := shares[i]
		instances, err := h.peerShareInstanceStatuses(&share)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
		flows, err := h.repo.ListPeerShareFlows(share.ID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
		runtimes, err := h.repo.ListActivePeerShareRuntimesByShareID(share.ID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}

		usedSet := make(map[int]struct{}, len(runtimes))
		details := make([]peerShareUsedPort, 0, len(runtimes))
		for _, runtime := range runtimes {
			runtimeInstances, runtimeInstanceErr := h.repo.ListPeerShareRuntimeInstances(runtime.ID)
			if runtimeInstanceErr != nil {
				response.WriteJSON(w, response.Err(-2, runtimeInstanceErr.Error()))
				return
			}
			if runtime.Port > 0 {
				usedSet[runtime.Port] = struct{}{}
			}
			details = append(details, peerShareUsedPort{
				RuntimeID:   runtime.ID,
				Port:        runtime.Port,
				Role:        runtime.Role,
				Protocol:    runtime.Protocol,
				ResourceKey: runtime.ResourceKey,
				Applied:     runtime.Applied,
				UpdatedTime: runtime.UpdatedTime,
				Instances:   runtimeInstances,
			})
		}

		usedPorts := make([]int, 0, len(usedSet))
		for port := range usedSet {
			usedPorts = append(usedPorts, port)
		}
		sort.Ints(usedPorts)

		sort.Slice(details, func(i, j int) bool {
			if details[i].Port == details[j].Port {
				return details[i].RuntimeID < details[j].RuntimeID
			}
			return details[i].Port < details[j].Port
		})

		items = append(items, peerShareListItem{
			PeerShare:        share,
			UsedPorts:        usedPorts,
			UsedPortDetails:  details,
			ActiveRuntimeNum: len(details),
			Instances:        instances,
			Flows:            flows,
		})
	}

	response.WriteJSON(w, response.OK(items))
}

func (h *Handler) federationShareCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	var req createPeerShareRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	if req.Name == "" || req.NodeID == 0 {
		response.WriteJSON(w, response.ErrDefault("Name and NodeID are required"))
		return
	}

	if req.MaxBandwidth < 0 {
		response.WriteJSON(w, response.ErrDefault("Max bandwidth cannot be negative"))
		return
	}

	if req.ExpiryTime < 0 {
		response.WriteJSON(w, response.ErrDefault("Expiry time cannot be negative"))
		return
	}

	if req.PortRangeStart < 0 || req.PortRangeStart > 65535 || req.PortRangeEnd < 0 || req.PortRangeEnd > 65535 {
		response.WriteJSON(w, response.ErrDefault("Invalid port range"))
		return
	}

	if req.PortRangeStart > req.PortRangeEnd {
		response.WriteJSON(w, response.ErrDefault("Port range start cannot be greater than end"))
		return
	}

	allowedIPs, err := normalizePeerShareAllowedIPs(req.AllowedIPs)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	node, err := h.repo.GetNodeByID(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if node == nil {
		response.WriteJSON(w, response.ErrDefault("Node not found"))
		return
	}
	if node.IsRemote == 1 {
		response.WriteJSON(w, response.ErrDefault("Only local nodes can be shared"))
		return
	}
	scopeType, autoInclude, minHealthy, instanceIDs, err := h.validatePeerShareScope(req.NodeID, req.ScopeType, req.AutoIncludeNewInstances, req.MinHealthyInstances, req.InstanceIDs)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	trafficRatio := 1.0
	if req.TrafficRatio != nil {
		trafficRatio = *req.TrafficRatio
	}
	if err := validatePeerShareTrafficRatios(trafficRatio, instanceIDs, req.InstanceTrafficRatios); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	now := time.Now().UnixMilli()
	token := randomToken(32)

	share := &repo.PeerShare{
		Name:                    req.Name,
		NodeID:                  req.NodeID,
		Token:                   token,
		MaxBandwidth:            req.MaxBandwidth,
		TrafficRatio:            trafficRatio,
		ExpiryTime:              req.ExpiryTime,
		PortRangeStart:          req.PortRangeStart,
		PortRangeEnd:            req.PortRangeEnd,
		IsActive:                1,
		CreatedTime:             now,
		UpdatedTime:             now,
		AllowedDomains:          req.AllowedDomains,
		AllowedIPs:              allowedIPs,
		ScopeType:               scopeType,
		AutoIncludeNewInstances: autoInclude,
		MinHealthyInstances:     minHealthy,
	}

	if err := h.repo.CreatePeerShare(share); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.repo.ReplacePeerShareInstances(share.ID, share.NodeID, instanceIDs, now, req.InstanceTrafficRatios); err != nil {
		_ = h.repo.DeletePeerShare(share.ID)
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationShareDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	var req deletePeerShareRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	share, _ := h.repo.GetPeerShare(req.ID)

	h.cleanupPeerShareRuntimes(req.ID)
	h.cleanupFederationTunnels(req.ID)

	if err := h.repo.DeletePeerShare(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	if share != nil && h.wsServer != nil {
		h.wsServer.SendCommand(share.NodeID, "reload", nil, time.Second*5)
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationShareResetFlow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	var req resetPeerShareFlowRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("Share ID is required"))
		return
	}

	share, err := h.repo.GetPeerShare(req.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if share == nil {
		response.WriteJSON(w, response.ErrDefault("Share not found"))
		return
	}
	if err := h.repo.ResetPeerShareCurrentFlow(req.ID, time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationShareUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	var req updatePeerShareStatusRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	if req.ID <= 0 || (req.IsActive != 0 && req.IsActive != 1) {
		response.WriteJSON(w, response.ErrDefault("Invalid share status"))
		return
	}
	share, err := h.repo.GetPeerShare(req.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if share == nil {
		response.WriteJSON(w, response.ErrDefault("Share not found"))
		return
	}
	if err := h.repo.UpdatePeerShareActive(req.ID, req.IsActive, time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if req.IsActive == 0 {
		h.cleanupPeerShareRuntimes(req.ID)
		h.cleanupFederationTunnels(req.ID)
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationShareUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	var req updatePeerShareRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("Share ID is required"))
		return
	}

	share, err := h.repo.GetPeerShare(req.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if share == nil {
		response.WriteJSON(w, response.ErrDefault("Share not found"))
		return
	}
	previousInstanceStatuses, err := h.peerShareInstanceStatuses(share)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("Name is required"))
		return
	}

	if req.MaxBandwidth < 0 {
		response.WriteJSON(w, response.ErrDefault("Max bandwidth cannot be negative"))
		return
	}

	if req.ExpiryTime < 0 {
		response.WriteJSON(w, response.ErrDefault("Expiry time cannot be negative"))
		return
	}

	if req.PortRangeStart < 0 || req.PortRangeStart > 65535 || req.PortRangeEnd < 0 || req.PortRangeEnd > 65535 {
		response.WriteJSON(w, response.ErrDefault("Invalid port range"))
		return
	}

	if req.PortRangeStart > req.PortRangeEnd {
		response.WriteJSON(w, response.ErrDefault("Port range start cannot be greater than end"))
		return
	}

	allowedIPs, err := normalizePeerShareAllowedIPs(req.AllowedIPs)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	scopeType := req.ScopeType
	if strings.TrimSpace(scopeType) == "" {
		scopeType = share.ScopeType
	}
	autoRequested := req.AutoIncludeNewInstances
	if autoRequested == nil {
		current := share.AutoIncludeNewInstances == 1
		autoRequested = &current
	}
	minHealthy := req.MinHealthyInstances
	if minHealthy <= 0 {
		minHealthy = share.MinHealthyInstances
	}
	requestedInstanceIDs := req.InstanceIDs
	if requestedInstanceIDs == nil {
		existingInstances, listErr := h.repo.ListPeerShareInstances(share.ID)
		if listErr != nil {
			response.WriteJSON(w, response.Err(-2, listErr.Error()))
			return
		}
		requestedInstanceIDs = make([]string, 0, len(existingInstances))
		for _, item := range existingInstances {
			requestedInstanceIDs = append(requestedInstanceIDs, item.InstanceID)
		}
		if req.InstanceTrafficRatios == nil {
			req.InstanceTrafficRatios = make(map[string]float64, len(existingInstances))
			for _, item := range existingInstances {
				req.InstanceTrafficRatios[item.InstanceID] = item.TrafficRatio
			}
		}
	}
	scopeType, autoInclude, minHealthy, instanceIDs, err := h.validatePeerShareScope(share.NodeID, scopeType, autoRequested, minHealthy, requestedInstanceIDs)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	trafficRatio := share.TrafficRatio
	if trafficRatio == 0 {
		trafficRatio = 1
	}
	if req.TrafficRatio != nil {
		trafficRatio = *req.TrafficRatio
	}
	if err := validatePeerShareTrafficRatios(trafficRatio, instanceIDs, req.InstanceTrafficRatios); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	share.Name = req.Name
	share.MaxBandwidth = req.MaxBandwidth
	share.ExpiryTime = req.ExpiryTime
	share.PortRangeStart = req.PortRangeStart
	share.PortRangeEnd = req.PortRangeEnd
	share.AllowedDomains = req.AllowedDomains
	share.AllowedIPs = allowedIPs
	share.ScopeType = scopeType
	share.AutoIncludeNewInstances = autoInclude
	share.MinHealthyInstances = minHealthy
	share.TrafficRatio = trafficRatio
	share.UpdatedTime = time.Now().UnixMilli()

	if err := h.repo.UpdatePeerShareWithInstances(share, instanceIDs, req.InstanceTrafficRatios); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	h.reconcilePeerShareRuntimeScope(share, previousInstanceStatuses)

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationRemoteUsageList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	remoteNodes, err := h.repo.ListRemoteNodes()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	fc := client.NewFederationClient()
	localDomain := h.federationLocalDomain()

	items := make([]remoteUsageNodeItem, 0)
	for _, node := range remoteNodes {
		nodeID := node.ID
		nodeName := node.Name

		cached := parseRemoteShareUsageConfigExtended(node.RemoteConfig.String)
		shareID, maxBandwidth, currentFlow, expiryTime, portRangeStart, portRangeEnd := cached.shareID, cached.maxBandwidth, cached.currentFlow, cached.expiryTime, cached.portRangeStart, cached.portRangeEnd
		remoteInFlow, remoteOutFlow := cached.inFlow, cached.outFlow

		var syncError string
		remoteInstances := make([]client.RemoteNodeInstance, 0)
		remoteFlows := make([]client.RemoteShareFlow, 0)
		remoteRuntimeInstances := make([]client.RemoteRuntimeInstance, 0)
		url := strings.TrimSpace(node.RemoteURL.String)
		token := strings.TrimSpace(node.RemoteToken.String)
		if url != "" && token != "" {
			info, connectErr := fc.Connect(url, token, localDomain)
			if connectErr != nil {
				syncError = connectErr.Error()
			} else if info != nil {
				shareID = info.ShareID
				maxBandwidth = info.MaxBandwidth
				currentFlow = info.CurrentFlow
				expiryTime = info.ExpiryTime
				portRangeStart = info.PortRangeStart
				portRangeEnd = info.PortRangeEnd
				_, syncErr := h.repo.SyncRemoteNodeInstances(nodeID, remoteNodeInstanceSyncItems(info.Instances), time.Now().UnixMilli())
				if syncErr != nil {
					syncError = syncErr.Error()
				}
				remoteInstances = info.Instances
				_ = h.repo.UpdateRemoteNodeTrafficRatio(nodeID, info.TrafficRatio)
				remoteFlows = info.Flows
				remoteRuntimeInstances = info.RuntimeInstances
				currentFlow, remoteInFlow, remoteOutFlow = aggregateRemoteShareFlows(info)

				configData := remoteShareUsageConfigMap(node.RemoteConfig.String)
				for key, value := range map[string]interface{}{
					"shareId":           info.ShareID,
					"trafficRatio":      info.TrafficRatio,
					"maxBandwidth":      info.MaxBandwidth,
					"currentFlow":       info.CurrentFlow,
					"remoteCurrentFlow": currentFlow,
					"remoteInFlow":      remoteInFlow,
					"remoteOutFlow":     remoteOutFlow,
					"expiryTime":        info.ExpiryTime,
					"portRangeStart":    info.PortRangeStart,
					"portRangeEnd":      info.PortRangeEnd,
					"remoteInstances":   remoteInstances,
				} {
					configData[key] = value
				}
				configBytes, _ := json.Marshal(configData)
				_ = h.repo.UpdateNodeRemoteConfig(nodeID, string(configBytes))
			}
		}
		if len(remoteInstances) == 0 && len(cached.instances) > 0 {
			remoteInstances = cached.instances
		}

		bindingRows, err := h.repo.ListActiveBindingsForNode(nodeID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
		forwardPortRows, err := h.repo.ListActiveForwardPortsForNode(nodeID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}

		usedSet := make(map[int]struct{})
		bindings := make([]remoteUsageBindingItem, 0, len(bindingRows)+len(forwardPortRows))
		for _, b := range bindingRows {
			bindings = append(bindings, remoteUsageBindingItem{
				BindingID:       b.ID,
				TunnelID:        b.TunnelID,
				TunnelName:      b.TunnelName,
				ChainType:       b.ChainType,
				HopInx:          b.HopInx,
				AllocatedPort:   b.AllocatedPort,
				ResourceKey:     b.ResourceKey,
				RemoteBindingID: b.RemoteBindingID,
				UpdatedTime:     b.UpdatedTime,
			})
			if b.AllocatedPort > 0 {
				usedSet[b.AllocatedPort] = struct{}{}
			}
		}
		for _, fp := range forwardPortRows {
			bindings = append(bindings, remoteUsageBindingItem{
				BindingID:       -fp.ForwardID,
				TunnelID:        fp.TunnelID,
				TunnelName:      fp.TunnelName,
				ChainType:       1,
				HopInx:          0,
				AllocatedPort:   fp.Port,
				ResourceKey:     fmt.Sprintf("forward:%d", fp.ForwardID),
				RemoteBindingID: "",
				UpdatedTime:     fp.UpdatedTime,
			})
			if fp.Port > 0 {
				usedSet[fp.Port] = struct{}{}
			}
		}

		sort.Slice(bindings, func(i, j int) bool {
			if bindings[i].AllocatedPort == bindings[j].AllocatedPort {
				return bindings[i].BindingID < bindings[j].BindingID
			}
			return bindings[i].AllocatedPort < bindings[j].AllocatedPort
		})

		usedPorts := make([]int, 0, len(usedSet))
		for port := range usedSet {
			usedPorts = append(usedPorts, port)
		}
		sort.Ints(usedPorts)

		items = append(items, remoteUsageNodeItem{
			NodeID:             nodeID,
			NodeName:           nodeName,
			RemoteURL:          url,
			ShareID:            shareID,
			PortRangeStart:     portRangeStart,
			PortRangeEnd:       portRangeEnd,
			MaxBandwidth:       maxBandwidth,
			CurrentFlow:        currentFlow,
			RemoteCurrentFlow:  currentFlow,
			RemoteInFlow:       remoteInFlow,
			RemoteOutFlow:      remoteOutFlow,
			RemoteMaxBandwidth: maxBandwidth,
			RemoteExpiryTime:   expiryTime,
			ExpiryTime:         expiryTime,
			UsedPorts:          usedPorts,
			Bindings:           bindings,
			ActiveBindingNum:   len(bindings),
			SyncError:          syncError,
			Instances:          remoteInstances,
			Flows:              remoteFlows,
			RuntimeInstances:   remoteRuntimeInstances,
		})
	}

	response.WriteJSON(w, response.OK(items))
}

func remoteNodePortRange(node *nodeRecord) (int, int) {
	if node == nil || node.IsRemote != 1 || node.RemoteConfig == "" {
		return 0, 0
	}
	_, _, _, _, portRangeStart, portRangeEnd := parseRemoteShareUsageConfig(node.RemoteConfig)
	return portRangeStart, portRangeEnd
}

func validateRemoteNodePort(node *nodeRecord, port int) error {
	if node == nil || node.IsRemote != 1 || port <= 0 {
		return nil
	}
	start, end := remoteNodePortRange(node)
	if start <= 0 || end <= 0 {
		return nil
	}
	if port < start || port > end {
		return fmt.Errorf("远程节点端口 %d 超出允许范围 %d-%d", port, start, end)
	}
	return nil
}

func parseRemoteShareUsageConfig(raw string) (int64, int64, int64, int64, int, int) {
	parsed := parseRemoteShareUsageConfigExtended(raw)
	return parsed.shareID, parsed.maxBandwidth, parsed.currentFlow, parsed.expiryTime, parsed.portRangeStart, parsed.portRangeEnd
}

type parsedRemoteShareUsageConfig struct {
	shareID        int64
	maxBandwidth   int64
	currentFlow    int64
	inFlow         int64
	outFlow        int64
	expiryTime     int64
	portRangeStart int
	portRangeEnd   int
	instances      []client.RemoteNodeInstance
}

func parseRemoteShareUsageConfigExtended(raw string) parsedRemoteShareUsageConfig {
	cfg := remoteShareUsageConfigMap(raw)
	if len(cfg) == 0 {
		return parsedRemoteShareUsageConfig{}
	}

	parsed := parsedRemoteShareUsageConfig{
		shareID:        asInt64(cfg["shareId"], 0),
		maxBandwidth:   asInt64(cfg["remoteMaxBandwidth"], asInt64(cfg["maxBandwidth"], 0)),
		currentFlow:    asInt64(cfg["remoteCurrentFlow"], asInt64(cfg["currentFlow"], 0)),
		inFlow:         asInt64(cfg["remoteInFlow"], 0),
		outFlow:        asInt64(cfg["remoteOutFlow"], 0),
		expiryTime:     asInt64(cfg["remoteExpiryTime"], asInt64(cfg["expiryTime"], 0)),
		portRangeStart: int(asInt64(cfg["portRangeStart"], 0)),
		portRangeEnd:   int(asInt64(cfg["portRangeEnd"], 0)),
	}
	if rawInstances, ok := cfg["remoteInstances"]; ok {
		instancesJSON, _ := json.Marshal(rawInstances)
		_ = json.Unmarshal(instancesJSON, &parsed.instances)
	}
	return parsed
}

func remoteShareUsageConfigMap(raw string) map[string]interface{} {
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &cfg); err != nil || cfg == nil {
		return make(map[string]interface{})
	}
	return cfg
}

func aggregateRemoteShareFlows(info *client.RemoteNodeInfo) (currentFlow, inFlow, outFlow int64) {
	if info == nil {
		return 0, 0, 0
	}
	currentFlow = info.CurrentFlow
	matched := false
	for _, flow := range info.Flows {
		if strings.ToLower(strings.TrimSpace(flow.PeriodType)) != "total" || flow.RuntimeID != 0 || strings.TrimSpace(flow.InstanceID) != "" {
			continue
		}
		matched = true
		inFlow += flow.InFlow
		outFlow += flow.OutFlow
	}
	if !matched {
		inFlow, outFlow = 0, 0
	}
	return currentFlow, inFlow, outFlow
}

func (h *Handler) nodeImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}
	if !h.ensureAdminAccess(w, r) {
		return
	}

	var req nodeImportRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	if req.RemoteURL == "" || req.Token == "" {
		response.WriteJSON(w, response.ErrDefault("Remote URL and Token are required"))
		return
	}
	req.RemoteURL = normalizeRemotePanelURL(req.RemoteURL)
	req.Token = strings.TrimSpace(req.Token)
	exists, err := h.repo.RemoteNodeExists(req.RemoteURL, req.Token)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if exists {
		response.WriteJSON(w, response.ErrDefault("Remote node already imported"))
		return
	}

	domainCfg, _ := h.repo.GetConfigByName("panel_domain")
	localDomain := ""
	if domainCfg != nil {
		localDomain = domainCfg.Value
	}

	fc := client.NewFederationClient()
	info, err := fc.Connect(req.RemoteURL, req.Token, localDomain)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "Failed to connect: "+err.Error()))
		return
	}

	// Prepare config json for local storage (metadata about limits)
	configData := map[string]interface{}{
		"shareId":        info.ShareID,
		"trafficRatio":   info.TrafficRatio,
		"maxBandwidth":   info.MaxBandwidth,
		"currentFlow":    info.CurrentFlow,
		"expiryTime":     info.ExpiryTime,
		"portRangeStart": info.PortRangeStart,
		"portRangeEnd":   info.PortRangeEnd,
	}
	configBytes, _ := json.Marshal(configData)

	portRange := "0"
	if info.PortRangeStart > 0 && info.PortRangeEnd >= info.PortRangeStart {
		portRange = fmt.Sprintf("%d-%d", info.PortRangeStart, info.PortRangeEnd)
	}

	inx := h.repo.NextIndex("node")
	now := time.Now().UnixMilli()

	if err = h.repo.CreateRemoteNode(
		fmt.Sprintf("%s (Remote)", info.NodeName),
		randomToken(16),
		info.ServerIP,
		portRange,
		now,
		info.Status,
		inx,
		req.RemoteURL,
		req.Token,
		string(configBytes),
		info.TrafficRatio,
	); err != nil {
		response.WriteJSON(w, response.Err(-2, "Database error: "+err.Error()))
		return
	}
	remoteNode, err := h.repo.GetRemoteNodeByCredentials(req.RemoteURL, req.Token)
	if err != nil || remoteNode == nil {
		response.WriteJSON(w, response.Err(-2, "Database error: failed to load imported node"))
		return
	}
	if _, err = h.repo.SyncRemoteNodeInstances(remoteNode.ID, remoteNodeInstanceSyncItems(info.Instances), now); err != nil {
		response.WriteJSON(w, response.Err(-2, "Database error: "+err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) authPeer(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get("Authorization"))
		if token == "" {
			response.WriteJSON(w, response.Err(401, "Missing Authorization header"))
			return
		}
		share, err := h.repo.GetPeerShareByToken(token)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
		if share == nil {
			response.WriteJSON(w, response.Err(401, "Invalid token"))
			return
		}

		if share.IsActive == 0 {
			response.WriteJSON(w, response.Err(403, "Share is disabled"))
			return
		}

		if share.ExpiryTime > 0 && share.ExpiryTime < time.Now().UnixMilli() {
			response.WriteJSON(w, response.Err(403, "Share expired"))
			return
		}

		if strings.TrimSpace(share.AllowedIPs) != "" {
			clientIP := resolvePeerClientIP(r)
			if clientIP == nil {
				response.WriteJSON(w, response.Err(403, "Unable to determine client IP"))
				return
			}
			if !isPeerIPAllowed(clientIP, share.AllowedIPs) {
				response.WriteJSON(w, response.Err(403, "IP not allowed"))
				return
			}
		}

		if share.AllowedDomains != "" {
			clientDomain := r.Header.Get("X-Panel-Domain")
			if clientDomain == "" {
				response.WriteJSON(w, response.Err(403, "Domain verification required"))
				return
			}
			allowed := false
			domains := strings.Split(share.AllowedDomains, ",")
			for _, d := range domains {
				if strings.TrimSpace(d) == clientDomain {
					allowed = true
					break
				}
			}
			if !allowed {
				response.WriteJSON(w, response.Err(403, "Domain not allowed"))
				return
			}
		}

		next(w, r)
	}
}

func (h *Handler) federationConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	nodeInfo, err := h.repo.GetNodeBasicInfo(share.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "Node not found"))
		return
	}
	flows, err := h.repo.ListPeerShareFlows(share.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	runtimeInstances, err := h.repo.ListActivePeerShareRuntimeInstancesByShareID(share.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"shareId":                 share.ID,
		"shareName":               share.Name,
		"nodeId":                  share.NodeID,
		"nodeName":                nodeInfo.Name,
		"serverIp":                nodeInfo.ServerIP,
		"status":                  nodeInfo.Status,
		"maxBandwidth":            share.MaxBandwidth,
		"currentFlow":             share.CurrentFlow,
		"trafficRatio":            share.TrafficRatio,
		"expiryTime":              share.ExpiryTime,
		"portRangeStart":          share.PortRangeStart,
		"portRangeEnd":            share.PortRangeEnd,
		"scopeType":               share.ScopeType,
		"autoIncludeNewInstances": share.AutoIncludeNewInstances == 1,
		"minHealthyInstances":     share.MinHealthyInstances,
		"instances":               mustPeerShareConnectInstances(h, share),
		"flows":                   flows,
		"runtimeInstances":        runtimeInstances,
	}))
}

func (h *Handler) federationTunnelCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}
	if isPeerShareFlowExceeded(share) {
		response.WriteJSON(w, response.Err(403, "Share traffic limit exceeded"))
		return
	}

	var req federationTunnelRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	if req.RemotePort < share.PortRangeStart || req.RemotePort > share.PortRangeEnd {
		response.WriteJSON(w, response.Err(403, "Port out of range"))
		return
	}

	usedPorts, err := h.repo.ListUsedPortsOnNode(share.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	for _, port := range usedPorts {
		if port == req.RemotePort {
			response.WriteJSON(w, response.Err(403, "Port already in use"))
			return
		}
	}

	runtimeOnPort, err := h.repo.GetActiveForwardPeerShareRuntimeByPort(share.ID, req.RemotePort)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if runtimeOnPort != nil {
		response.WriteJSON(w, response.Err(403, "Port already in use"))
		return
	}
	existsOnNodePort, err := h.repo.ExistsActivePeerShareRuntimeOnNodePort(share.NodeID, req.RemotePort)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if existsOnNodePort {
		response.WriteJSON(w, response.Err(403, "Port already in use"))
		return
	}

	now := time.Now().UnixMilli()
	tunnelID, err := h.repo.CreateFederationTunnel(
		fmt.Sprintf("Share-%d-Port-%d", share.ID, req.RemotePort),
		1,
		req.Protocol,
		now,
		share.NodeID,
		req.RemotePort,
	)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	runtime := &repo.PeerShareRuntime{
		ShareID:       share.ID,
		NodeID:        share.NodeID,
		ReservationID: randomToken(24),
		ResourceKey:   fmt.Sprintf("federation-forward-%d-%d-%d", share.ID, tunnelID, req.RemotePort),
		BindingID:     "",
		Role:          "forward",
		ChainName:     "",
		ServiceName:   "",
		Protocol:      defaultString(req.Protocol, "tcp"),
		Strategy:      "fifo",
		Port:          req.RemotePort,
		Target:        strings.TrimSpace(req.Target),
		Applied:       0,
		Status:        1,
		CreatedTime:   now,
		UpdatedTime:   now,
	}
	if err := h.repo.CreatePeerShareRuntime(runtime); err != nil {
		_ = h.deleteTunnelByID(tunnelID)
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	h.wsServer.SendCommand(share.NodeID, "reload", nil, time.Second*5)

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"tunnelId": tunnelID,
	}))
}

func (h *Handler) federationRuntimeReservePort(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	var req federationRuntimeReservePortRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	req.ResourceKey = strings.TrimSpace(req.ResourceKey)
	if req.ResourceKey == "" {
		response.WriteJSON(w, response.ErrDefault("resourceKey is required"))
		return
	}

	existing, err := h.repo.GetPeerShareRuntimeByResourceKey(share.ID, req.ResourceKey)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if existing != nil && existing.Status == 1 {
		response.WriteJSON(w, response.OK(map[string]interface{}{
			"reservationId": existing.ReservationID,
			"allocatedPort": existing.Port,
			"bindingId":     existing.BindingID,
		}))
		return
	}
	if isPeerShareFlowExceeded(share) {
		response.WriteJSON(w, response.Err(403, "Share traffic limit exceeded"))
		return
	}

	now := time.Now().UnixMilli()
	reservationID := randomToken(24)
	if existing != nil {
		reservationID = existing.ReservationID
	}
	runtime, err := h.repo.ReservePeerShareRuntimePort(share, req.ResourceKey, reservationID, defaultString(req.Protocol, "tls"), req.RequestedPort, now)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	h.reservePeerShareRuntimeInstances(share, runtime)

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"reservationId": runtime.ReservationID,
		"allocatedPort": runtime.Port,
		"bindingId":     runtime.BindingID,
	}))
}

func (h *Handler) reservePeerShareRuntimeInstances(share *repo.PeerShare, runtime *repo.PeerShareRuntime) {
	if h == nil || h.repo == nil || share == nil || runtime == nil {
		return
	}
	instances, legacy, err := h.scopedPeerShareInstances(share)
	if err != nil || legacy {
		return
	}
	now := time.Now().UnixMilli()
	for _, inst := range instances {
		lastError := ""
		if inst.Status != 1 {
			lastError = "instance offline"
		}
		_ = h.repo.UpsertPeerShareRuntimeInstance(&repo.PeerShareRuntimeInstance{
			RuntimeID: runtime.ID, ShareID: share.ID, NodeID: share.NodeID, InstanceID: inst.InstanceID,
			Port: runtime.Port, Status: 1, LastError: lastError, CreatedTime: now, UpdatedTime: now,
		})
	}
}

func (h *Handler) federationRuntimeApplyRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	var req federationRuntimeApplyRoleRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	req.Role = strings.ToLower(strings.TrimSpace(req.Role))
	if req.Role != "middle" && req.Role != "exit" {
		response.WriteJSON(w, response.ErrDefault("Invalid role"))
		return
	}

	var runtime *repo.PeerShareRuntime
	if strings.TrimSpace(req.ReservationID) != "" {
		runtime, err = h.repo.GetPeerShareRuntimeByReservationID(share.ID, strings.TrimSpace(req.ReservationID))
	} else {
		runtime, err = h.repo.GetPeerShareRuntimeByResourceKey(share.ID, strings.TrimSpace(req.ResourceKey))
	}
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if runtime == nil || runtime.Status == 0 {
		response.WriteJSON(w, response.ErrDefault("Reservation not found"))
		return
	}

	if runtime.Applied == 1 && strings.TrimSpace(runtime.BindingID) != "" {
		response.WriteJSON(w, response.OK(map[string]interface{}{
			"bindingId":     runtime.BindingID,
			"allocatedPort": runtime.Port,
			"reservationId": runtime.ReservationID,
		}))
		return
	}
	if isPeerShareFlowExceeded(share) {
		response.WriteJSON(w, response.Err(403, "Share traffic limit exceeded"))
		return
	}

	if share.PortRangeStart > 0 && share.PortRangeEnd > 0 && runtime.Port > 0 {
		if runtime.Port < share.PortRangeStart || runtime.Port > share.PortRangeEnd {
			response.WriteJSON(w, response.Err(403, fmt.Sprintf("port %d out of allowed range %d-%d", runtime.Port, share.PortRangeStart, share.PortRangeEnd)))
			return
		}
	}

	node, err := h.getNodeRecord(share.NodeID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	protocol := defaultString(req.Protocol, runtime.Protocol)
	strategy := defaultString(req.Strategy, "round")
	chainName := fmt.Sprintf("fed_chain_%d", runtime.ID)
	serviceName := fmt.Sprintf("fed_svc_%d", runtime.ID)
	var chainData map[string]interface{}

	if req.Role == "middle" {
		if len(req.Targets) == 0 {
			response.WriteJSON(w, response.ErrDefault("targets are required for middle role"))
			return
		}
		nodeItems := make([]map[string]interface{}, 0, len(req.Targets))
		for i, target := range req.Targets {
			host := strings.TrimSpace(target.Host)
			if host == "" || target.Port <= 0 {
				response.WriteJSON(w, response.ErrDefault("Invalid target"))
				return
			}
			targetProtocol := defaultString(target.Protocol, protocol)
			// ✅ 修复 1: 为所有 Relay Connector 启用 noDelay 模式
			connector := map[string]interface{}{
				"type": "relay",
				"metadata": map[string]interface{}{
					"nodelay": true,
					"udpTTL":  "5s", // ✅ 修复 2: 添加 UDP TTL 默认配置
				},
			}
			nodeItems = append(nodeItems, map[string]interface{}{
				"name":      fmt.Sprintf("node_%d", i+1),
				"addr":      processServerAddress(fmt.Sprintf("%s:%d", host, target.Port)),
				"connector": connector,
				"dialer": map[string]interface{}{
					"type": targetProtocol,
				},
			})
		}

		chainData = map[string]interface{}{
			"name": chainName,
			"hops": []map[string]interface{}{
				{
					"name": fmt.Sprintf("hop_%d", runtime.ID),
					"selector": map[string]interface{}{
						"strategy":    strategy,
						"maxFails":    1,
						"failTimeout": int64(600000000000),
					},
					"nodes": nodeItems,
				},
			},
		}
		if strings.TrimSpace(node.InterfaceName) != "" {
			hops := chainData["hops"].([]map[string]interface{})
			hops[0]["interface"] = node.InterfaceName
		}
	}

	targetCount := len(req.Targets)
	service := buildFederationServiceConfig(
		serviceName,
		fmt.Sprintf("%s:%d", node.TCPListenAddr, runtime.Port),
		protocol,
		req.Role,
		chainName,
		targetCount,
		node.InterfaceName,
	)
	runtime.Role = req.Role
	runtime.ChainName = ""
	if req.Role == "middle" {
		runtime.ChainName = chainName
	}
	runtime.ServiceName = serviceName
	runtime.Protocol = protocol
	runtime.Strategy = strategy
	if err := h.deployPeerShareRuntime(share, runtime, chainData, service); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	targetBytes, _ := json.Marshal(req.Targets)
	runtime.BindingID = fmt.Sprintf("%d", runtime.ID)
	runtime.Target = string(targetBytes)
	runtime.Applied = 1
	runtime.Status = 1
	runtime.UpdatedTime = time.Now().UnixMilli()
	if err := h.repo.UpdatePeerShareRuntime(runtime); err != nil {
		h.releasePeerShareRuntimeInstances(runtime)
		_ = h.repo.MarkPeerShareRuntimeReleased(runtime.ID, time.Now().UnixMilli())
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"bindingId":     runtime.BindingID,
		"reservationId": runtime.ReservationID,
		"allocatedPort": runtime.Port,
	}))
}

func (h *Handler) federationRuntimeReleaseRole(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	var req federationRuntimeReleaseRoleRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	var runtime *repo.PeerShareRuntime
	if strings.TrimSpace(req.BindingID) != "" {
		runtime, err = h.repo.GetPeerShareRuntimeByBindingID(share.ID, strings.TrimSpace(req.BindingID))
	} else if strings.TrimSpace(req.ReservationID) != "" {
		runtime, err = h.repo.GetPeerShareRuntimeByReservationID(share.ID, strings.TrimSpace(req.ReservationID))
	} else if strings.TrimSpace(req.ResourceKey) != "" {
		runtime, err = h.repo.GetPeerShareRuntimeByResourceKey(share.ID, strings.TrimSpace(req.ResourceKey))
	} else {
		response.WriteJSON(w, response.ErrDefault("bindingId or reservationId or resourceKey is required"))
		return
	}
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if runtime == nil {
		response.WriteJSON(w, response.OKEmpty())
		return
	}

	h.releasePeerShareRuntimeInstances(runtime)

	if err := h.repo.MarkPeerShareRuntimeReleased(runtime.ID, time.Now().UnixMilli()); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) federationRuntimeDiagnose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	var req federationRuntimeDiagnoseRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}

	req.IP = strings.TrimSpace(req.IP)
	if req.IP == "" || req.Port <= 0 || req.Port > 65535 {
		response.WriteJSON(w, response.ErrDefault("Invalid target"))
		return
	}
	if req.Count <= 0 {
		req.Count = 4
	}
	if req.Timeout <= 0 || req.Timeout > int(diagnosisCommandTimeout/time.Millisecond) {
		req.Timeout = int(diagnosisCommandTimeout / time.Millisecond)
	}
	commandTimeout := time.Duration(req.Timeout) * time.Millisecond
	if commandTimeout <= 0 || commandTimeout > diagnosisCommandTimeout {
		commandTimeout = diagnosisCommandTimeout
	}

	results, err := h.sendPeerShareCommand(share, "TcpPing", map[string]interface{}{
		"ip":      req.IP,
		"port":    req.Port,
		"count":   req.Count,
		"timeout": req.Timeout,
	}, commandTimeout, false, false)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	payload := map[string]interface{}{"instances": results}
	for _, result := range results {
		if success, _ := result["success"].(bool); !success {
			continue
		}
		if data, ok := result["data"].(map[string]interface{}); ok {
			for key, value := range data {
				payload[key] = value
			}
		}
		break
	}
	response.WriteJSON(w, response.OK(payload))
}

func (h *Handler) federationRuntimeCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("Invalid method"))
		return
	}

	token := extractBearerToken(r)
	share, err := h.repo.GetPeerShareByToken(token)
	if err != nil || share == nil {
		response.WriteJSON(w, response.Err(401, "Unauthorized"))
		return
	}

	var req federationRuntimeCommandRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("Invalid JSON"))
		return
	}
	cmd := strings.TrimSpace(req.CommandType)
	if cmd == "" {
		response.WriteJSON(w, response.ErrDefault("commandType is required"))
		return
	}
	if !isFederationRuntimeCommandAllowed(cmd) {
		response.WriteJSON(w, response.ErrDefault("command not allowed"))
		return
	}

	if isFederationServiceCommand(cmd) {
		if err := validateFederationCommandPorts(share, req.Data); err != nil {
			response.WriteJSON(w, response.Err(403, err.Error()))
			return
		}
	}

	results, err := h.sendPeerShareCommand(share, cmd, req.Data, defaultNodeCommandTimeout, false, false)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	if strings.EqualFold(cmd, "addservice") || strings.EqualFold(cmd, "updateservice") {
		h.bindPeerShareForwardRuntimeServices(share, req.Data)
		h.updateForwardRuntimeInstanceStates(share, req.Data, results)
	} else if strings.EqualFold(cmd, "deleteservice") {
		h.releasePeerShareForwardRuntimeServices(share, req.Data)
	}
	payload := map[string]interface{}{"type": cmd, "success": true, "message": "", "data": map[string]interface{}{}, "instances": results}
	for _, result := range results {
		if success, _ := result["success"].(bool); !success {
			continue
		}
		payload["message"] = result["message"]
		payload["data"] = result["data"]
		if result["type"] != nil {
			payload["type"] = result["type"]
		}
		break
	}
	response.WriteJSON(w, response.OK(payload))
}

type federationForwardServiceBinding struct {
	Name string
	Port int
}

func extractFederationServiceEntries(data interface{}) []map[string]interface{} {
	if data == nil {
		return nil
	}

	if entries := asMapSlice(data); len(entries) > 0 {
		return entries
	}

	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return nil
	}

	if entries := asMapSlice(dataMap["services"]); len(entries) > 0 {
		return entries
	}

	return nil
}

func parseFederationForwardServiceBindings(data interface{}) []federationForwardServiceBinding {
	serviceList := extractFederationServiceEntries(data)
	bindings := make([]federationForwardServiceBinding, 0, len(serviceList))
	for _, svcMap := range serviceList {
		name := normalizeForwardRuntimeServiceName(asString(svcMap["name"]))
		if name == "" {
			continue
		}
		if _, _, _, ok := parseFlowServiceIDs(name); !ok {
			continue
		}
		addr := strings.TrimSpace(asString(svcMap["addr"]))
		if addr == "" {
			continue
		}
		_, portStr, err := net.SplitHostPort(addr)
		if err != nil {
			continue
		}
		port, err := strconv.Atoi(portStr)
		if err != nil || port <= 0 {
			continue
		}
		bindings = append(bindings, federationForwardServiceBinding{Name: name, Port: port})
	}
	return bindings
}

func parseFederationForwardServiceNamesForRelease(data interface{}) []string {
	names := make(map[string]struct{})
	appendName := func(raw string) {
		name := normalizeForwardRuntimeServiceName(raw)
		if name == "" {
			return
		}
		if _, _, _, ok := parseFlowServiceIDs(name); !ok {
			return
		}
		names[name] = struct{}{}
	}

	for _, svcMap := range extractFederationServiceEntries(data) {
		appendName(asString(svcMap["name"]))
	}

	if dataMap, ok := data.(map[string]interface{}); ok {
		for _, item := range asAnySlice(dataMap["services"]) {
			appendName(asString(item))
		}
	}

	for _, item := range asAnySlice(data) {
		appendName(asString(item))
	}

	if len(names) == 0 {
		return nil
	}

	out := make([]string, 0, len(names))
	for name := range names {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func (h *Handler) bindPeerShareForwardRuntimeServices(share *repo.PeerShare, data interface{}) {
	if h == nil || h.repo == nil || share == nil {
		return
	}
	bindings := parseFederationForwardServiceBindings(data)
	if len(bindings) == 0 {
		return
	}

	now := time.Now().UnixMilli()
	for _, binding := range bindings {
		runtime, err := h.repo.GetActiveForwardPeerShareRuntimeByPort(share.ID, binding.Port)
		if err != nil {
			continue
		}
		if runtime == nil {
			runtime, err = h.repo.GetActiveForwardPeerShareRuntimeByServiceName(share.ID, binding.Name)
			if err != nil {
				continue
			}
		}
		if runtime == nil {
			_ = h.repo.CreatePeerShareRuntime(&repo.PeerShareRuntime{
				ShareID:       share.ID,
				NodeID:        share.NodeID,
				ReservationID: randomToken(24),
				ResourceKey:   fmt.Sprintf("forward-runtime:%d:%s:%d:%s", share.ID, binding.Name, binding.Port, randomToken(8)),
				BindingID:     "",
				Role:          "forward",
				ChainName:     "",
				ServiceName:   binding.Name,
				Protocol:      "tcp",
				Strategy:      "fifo",
				Port:          binding.Port,
				Target:        "",
				Applied:       1,
				Status:        1,
				CreatedTime:   now,
				UpdatedTime:   now,
			})
			continue
		}
		if runtime.ServiceName == binding.Name && runtime.Applied == 1 && runtime.Port == binding.Port && runtime.Status == 1 {
			continue
		}
		runtime.ServiceName = binding.Name
		runtime.Port = binding.Port
		runtime.Applied = 1
		runtime.Status = 1
		runtime.UpdatedTime = now
		if strings.TrimSpace(runtime.Protocol) == "" {
			runtime.Protocol = "tcp"
		}
		if strings.TrimSpace(runtime.Strategy) == "" {
			runtime.Strategy = "fifo"
		}
		_ = h.repo.UpdatePeerShareRuntime(runtime)
	}
}

func (h *Handler) updateForwardRuntimeInstanceStates(share *repo.PeerShare, data interface{}, results []map[string]interface{}) {
	if h == nil || h.repo == nil || share == nil {
		return
	}
	bindings := parseFederationForwardServiceBindings(data)
	if len(bindings) == 0 {
		return
	}
	now := time.Now().UnixMilli()
	for _, binding := range bindings {
		runtime, err := h.repo.GetActiveForwardPeerShareRuntimeByPort(share.ID, binding.Port)
		if err != nil || runtime == nil {
			continue
		}
		for _, result := range results {
			instanceID := strings.TrimSpace(asString(result["instanceId"]))
			if instanceID == "" {
				continue
			}
			success, _ := result["success"].(bool)
			lastError := ""
			if !success {
				lastError = asString(result["message"])
			}
			_ = h.repo.UpsertPeerShareRuntimeInstance(&repo.PeerShareRuntimeInstance{
				RuntimeID: runtime.ID, ShareID: share.ID, NodeID: share.NodeID, InstanceID: instanceID,
				Port: runtime.Port, Applied: federationBoolInt(success), Healthy: federationBoolInt(success), Status: 1,
				LastError: lastError, CreatedTime: now, UpdatedTime: now,
			})
		}
	}
}

func (h *Handler) releasePeerShareForwardRuntimeServices(share *repo.PeerShare, data interface{}) {
	if h == nil || h.repo == nil || share == nil {
		return
	}
	names := parseFederationForwardServiceNamesForRelease(data)
	if len(names) == 0 {
		return
	}

	now := time.Now().UnixMilli()
	for _, name := range names {
		_ = h.repo.MarkForwardPeerShareRuntimeReleasedByServiceName(share.ID, name, now)
	}
}

func isFederationRuntimeCommandAllowed(commandType string) bool {
	switch strings.ToLower(strings.TrimSpace(commandType)) {
	case "addservice", "updateservice", "deleteservice", "pauseservice", "resumeservice", "addchains", "deletechains", "addlimiters", "updatelimiters", "deletelimiters", "tcpping", "reload":
		return true
	default:
		return false
	}
}

func isFederationServiceCommand(commandType string) bool {
	switch strings.ToLower(strings.TrimSpace(commandType)) {
	case "addservice", "updateservice":
		return true
	default:
		return false
	}
}

func validateFederationCommandPorts(share *repo.PeerShare, data interface{}) error {
	if share == nil || (share.PortRangeStart <= 0 && share.PortRangeEnd <= 0) {
		return nil
	}

	serviceList := extractFederationServiceEntries(data)
	if len(serviceList) == 0 {
		return nil
	}
	for _, svcMap := range serviceList {
		addr := asString(svcMap["addr"])
		if addr == "" {
			continue
		}
		_, portStr, err := net.SplitHostPort(addr)
		if err != nil {
			return fmt.Errorf("invalid service address: %s", addr)
		}
		port, err := strconv.Atoi(portStr)
		if err != nil || port <= 0 {
			return fmt.Errorf("invalid port in service address: %s", addr)
		}
		if port < share.PortRangeStart || port > share.PortRangeEnd {
			return fmt.Errorf("port %d out of allowed range %d-%d", port, share.PortRangeStart, share.PortRangeEnd)
		}
	}

	return nil
}

func (h *Handler) pickPeerSharePort(share *repo.PeerShare, requestedPort int) (int, error) {
	if share == nil {
		return 0, fmt.Errorf("share not found")
	}
	if share.PortRangeStart <= 0 || share.PortRangeEnd <= 0 || share.PortRangeEnd < share.PortRangeStart {
		return 0, fmt.Errorf("No available port")
	}

	used := make(map[int]struct{})

	nodePorts, err := h.repo.ListUsedPortsOnNode(share.NodeID)
	if err != nil {
		return 0, err
	}
	for _, p := range nodePorts {
		used[p] = struct{}{}
	}

	ports, err := h.repo.ListActivePeerShareRuntimePorts(share.ID, share.NodeID)
	if err != nil {
		return 0, err
	}
	for _, p := range ports {
		if p > 0 {
			used[p] = struct{}{}
		}
	}

	if requestedPort > 0 {
		if requestedPort < share.PortRangeStart || requestedPort > share.PortRangeEnd {
			return 0, fmt.Errorf("Port out of range")
		}
		if _, ok := used[requestedPort]; ok {
			return 0, fmt.Errorf("No available port")
		}
		return requestedPort, nil
	}

	for p := share.PortRangeStart; p <= share.PortRangeEnd; p++ {
		if _, ok := used[p]; ok {
			continue
		}
		return p, nil
	}

	return 0, fmt.Errorf("No available port")
}

func extractBearerToken(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("Authorization"))
}

func isPeerShareFlowExceeded(share *repo.PeerShare) bool {
	if share == nil {
		return false
	}
	if share.MaxBandwidth <= 0 {
		return false
	}
	return share.CurrentFlow >= share.MaxBandwidth
}

func normalizePeerShareAllowedIPs(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}

	parts := strings.Split(raw, ",")
	normalized := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))

	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}

		if strings.Contains(item, "/") {
			_, network, err := net.ParseCIDR(item)
			if err != nil {
				return "", fmt.Errorf("Invalid allowed IP or CIDR: %s", item)
			}
			item = network.String()
		} else {
			ip := parseIPLiteral(item)
			if ip == nil {
				return "", fmt.Errorf("Invalid allowed IP or CIDR: %s", item)
			}
			item = ip.String()
		}

		if _, exists := seen[item]; exists {
			continue
		}
		seen[item] = struct{}{}
		normalized = append(normalized, item)
	}

	return strings.Join(normalized, ","), nil
}

func resolvePeerClientIP(r *http.Request) net.IP {
	if r == nil {
		return nil
	}

	remoteIP := parseIPLiteral(r.RemoteAddr)
	if isTrustedProxyIP(remoteIP) {
		if ip := parseForwardedFor(r.Header.Get("X-Forwarded-For")); ip != nil {
			return ip
		}
		if ip := parseIPLiteral(r.Header.Get("X-Real-IP")); ip != nil {
			return ip
		}
	}

	return remoteIP
}

func parseForwardedFor(raw string) net.IP {
	for _, part := range strings.Split(raw, ",") {
		if ip := parseIPLiteral(part); ip != nil {
			return ip
		}
	}
	return nil
}

func parseIPLiteral(raw string) net.IP {
	value := strings.Trim(strings.TrimSpace(raw), "\"")
	if value == "" {
		return nil
	}

	if ip := net.ParseIP(value); ip != nil {
		return normalizeIPAddress(ip)
	}

	host, _, err := net.SplitHostPort(value)
	if err != nil {
		return nil
	}

	host = strings.Trim(strings.TrimSpace(host), "[]")
	if host == "" {
		return nil
	}
	return normalizeIPAddress(net.ParseIP(host))
}

func normalizeIPAddress(ip net.IP) net.IP {
	if ip == nil {
		return nil
	}
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip.To16()
}

func isTrustedProxyIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func isPeerIPAllowed(clientIP net.IP, whitelist string) bool {
	if clientIP == nil {
		return false
	}

	for _, part := range strings.Split(whitelist, ",") {
		entry := strings.TrimSpace(part)
		if entry == "" {
			continue
		}

		if strings.Contains(entry, "/") {
			_, network, err := net.ParseCIDR(entry)
			if err != nil {
				continue
			}
			if network.Contains(clientIP) {
				return true
			}
			continue
		}

		allowedIP := parseIPLiteral(entry)
		if allowedIP != nil && allowedIP.Equal(clientIP) {
			return true
		}
	}

	return false
}

func (h *Handler) syncRemoteNodeStatuses(items []map[string]interface{}) {
	type remoteEntry struct {
		index       int
		remoteURL   string
		remoteToken string
		cached      parsedRemoteShareUsageConfig
	}

	var remotes []remoteEntry
	for i, item := range items {
		isRemote, _ := item["isRemote"].(int)
		if isRemote != 1 {
			continue
		}
		url, _ := item["remoteUrl"].(string)
		token, _ := item["remoteToken"].(string)
		url = strings.TrimSpace(url)
		token = strings.TrimSpace(token)
		if url == "" || token == "" {
			continue
		}
		remotes = append(remotes, remoteEntry{index: i, remoteURL: url, remoteToken: token, cached: parseRemoteShareUsageConfigExtended(asString(item["remoteConfig"]))})
	}
	if len(remotes) == 0 {
		return
	}

	localDomain := h.federationLocalDomain()
	fc := client.NewFederationClientWithTimeout(5 * time.Second)

	type syncResult struct {
		index        int
		status       int
		syncError    string
		instances    []client.RemoteNodeInstance
		currentFlow  int64
		inFlow       int64
		outFlow      int64
		maxBandwidth int64
		expiryTime   int64
		info         *client.RemoteNodeInfo
	}

	results := make([]syncResult, len(remotes))
	var wg sync.WaitGroup
	for i, entry := range remotes {
		wg.Add(1)
		go func(idx int, e remoteEntry) {
			defer wg.Done()
			info, err := fc.Connect(e.remoteURL, e.remoteToken, localDomain)
			if err != nil {
				errMsg := err.Error()
				result := syncResult{index: e.index, status: 0, syncError: errMsg, instances: e.cached.instances, currentFlow: e.cached.currentFlow, inFlow: e.cached.inFlow, outFlow: e.cached.outFlow, maxBandwidth: e.cached.maxBandwidth, expiryTime: e.cached.expiryTime}
				if strings.Contains(errMsg, "401") || strings.Contains(errMsg, "Invalid token") || strings.Contains(errMsg, "Unauthorized") {
					result.syncError = "provider_share_deleted"
				} else if strings.Contains(errMsg, "403") || strings.Contains(errMsg, "Share is disabled") {
					result.syncError = "provider_share_disabled"
				} else if strings.Contains(errMsg, "Share expired") {
					result.syncError = "provider_share_expired"
				}
				results[idx] = result
			} else {
				currentFlow, inFlow, outFlow := aggregateRemoteShareFlows(info)
				results[idx] = syncResult{
					index: e.index, status: info.Status, syncError: "",
					instances:   info.Instances,
					currentFlow: currentFlow, inFlow: inFlow, outFlow: outFlow,
					maxBandwidth: info.MaxBandwidth, expiryTime: info.ExpiryTime, info: info,
				}
			}
		}(i, entry)
	}
	wg.Wait()

	for _, r := range results {
		if r.info != nil && h.repo != nil {
			nodeID := asInt64(items[r.index]["id"], 0)
			_, err := h.repo.SyncRemoteNodeInstances(nodeID, remoteNodeInstanceSyncItems(r.instances), time.Now().UnixMilli())
			if err != nil {
				r.syncError = err.Error()
			}
			_ = h.repo.UpdateRemoteNodeTrafficRatio(nodeID, r.info.TrafficRatio)
			items[r.index]["trafficRatio"] = r.info.TrafficRatio
		}
		items[r.index]["status"] = r.status
		items[r.index]["remoteCurrentFlow"] = r.currentFlow
		items[r.index]["remoteInFlow"] = r.inFlow
		items[r.index]["remoteOutFlow"] = r.outFlow
		items[r.index]["remoteMaxBandwidth"] = r.maxBandwidth
		items[r.index]["remoteExpiryTime"] = r.expiryTime
		items[r.index]["remoteInstances"] = r.instances
		if r.info != nil {
			configData, _ := json.Marshal(map[string]interface{}{
				"shareId": r.info.ShareID, "maxBandwidth": r.info.MaxBandwidth, "currentFlow": r.info.CurrentFlow,
				"trafficRatio":      r.info.TrafficRatio,
				"remoteCurrentFlow": r.currentFlow, "remoteInFlow": r.inFlow, "remoteOutFlow": r.outFlow,
				"expiryTime": r.info.ExpiryTime, "portRangeStart": r.info.PortRangeStart, "portRangeEnd": r.info.PortRangeEnd,
				"remoteInstances": r.instances,
			})
			_ = h.repo.UpdateNodeRemoteConfig(asInt64(items[r.index]["id"], 0), string(configData))
		}
		if r.syncError != "" {
			items[r.index]["syncError"] = r.syncError
		}
	}
}

func (h *Handler) cleanupPeerShareRuntimes(shareID int64) {
	if h == nil || h.repo == nil || shareID <= 0 {
		return
	}
	runtimes, err := h.repo.ListActivePeerShareRuntimesByShareID(shareID)
	if err != nil || len(runtimes) == 0 {
		return
	}

	now := time.Now().UnixMilli()
	for _, runtime := range runtimes {
		h.releasePeerShareRuntimeInstances(&runtime)
		_ = h.repo.MarkPeerShareRuntimeReleased(runtime.ID, now)
	}
}

func (h *Handler) scopedPeerShareInstances(share *repo.PeerShare) ([]peerShareInstanceStatus, bool, error) {
	if share == nil {
		return nil, false, fmt.Errorf("share not found")
	}
	instances, err := h.peerShareInstanceStatuses(share)
	if err != nil {
		return nil, false, err
	}
	if len(instances) == 0 {
		return nil, true, nil
	}
	out := make([]peerShareInstanceStatus, 0, len(instances))
	for _, inst := range instances {
		if inst.InScope {
			out = append(out, inst)
		}
	}
	return out, false, nil
}

func (h *Handler) deployPeerShareRuntime(share *repo.PeerShare, runtime *repo.PeerShareRuntime, chainData map[string]interface{}, service map[string]interface{}) error {
	instances, legacy, err := h.scopedPeerShareInstances(share)
	if err != nil {
		return err
	}
	if legacy {
		if chainData != nil {
			if _, err := h.sendNodeCommand(runtime.NodeID, "AddChains", chainData, true, false); err != nil {
				return err
			}
		}
		if _, err := h.sendNodeCommand(runtime.NodeID, "AddService", []map[string]interface{}{service}, true, false); err != nil {
			if chainData != nil {
				_, _ = h.sendNodeCommand(runtime.NodeID, "DeleteChains", map[string]interface{}{"chain": runtime.ChainName}, false, true)
			}
			return err
		}
		return nil
	}
	if len(instances) == 0 {
		return fmt.Errorf("share has no scoped instances")
	}
	now := time.Now().UnixMilli()
	healthy := 0
	succeeded := make([]string, 0, len(instances))
	errorsByInstance := make([]string, 0)
	for _, inst := range instances {
		state := &repo.PeerShareRuntimeInstance{RuntimeID: runtime.ID, ShareID: runtime.ShareID, NodeID: runtime.NodeID, InstanceID: inst.InstanceID, Port: runtime.Port, Status: 1, CreatedTime: now, UpdatedTime: now}
		if inst.Status != 1 {
			state.LastError = "instance offline"
			_ = h.repo.UpsertPeerShareRuntimeInstance(state)
			errorsByInstance = append(errorsByInstance, inst.InstanceID+": instance offline")
			continue
		}
		if chainData != nil {
			if _, cmdErr := h.sendNodeCommandToInstanceWithTimeout(runtime.NodeID, inst.InstanceID, "AddChains", chainData, defaultNodeCommandTimeout, true, false); cmdErr != nil {
				state.LastError = cmdErr.Error()
				_ = h.repo.UpsertPeerShareRuntimeInstance(state)
				errorsByInstance = append(errorsByInstance, inst.InstanceID+": "+cmdErr.Error())
				continue
			}
		}
		if _, cmdErr := h.sendNodeCommandToInstanceWithTimeout(runtime.NodeID, inst.InstanceID, "AddService", []map[string]interface{}{service}, defaultNodeCommandTimeout, true, false); cmdErr != nil {
			if chainData != nil {
				_, _ = h.sendNodeCommandToInstanceWithTimeout(runtime.NodeID, inst.InstanceID, "DeleteChains", map[string]interface{}{"chain": runtime.ChainName}, defaultNodeCommandTimeout, false, true)
			}
			state.LastError = cmdErr.Error()
			_ = h.repo.UpsertPeerShareRuntimeInstance(state)
			errorsByInstance = append(errorsByInstance, inst.InstanceID+": "+cmdErr.Error())
			continue
		}
		state.Applied = 1
		state.Healthy = 1
		state.LastError = ""
		_ = h.repo.UpsertPeerShareRuntimeInstance(state)
		healthy++
		succeeded = append(succeeded, inst.InstanceID)
	}
	minimum := share.MinHealthyInstances
	if minimum <= 0 {
		minimum = 1
	}
	if healthy >= minimum {
		return nil
	}
	for _, instanceID := range succeeded {
		h.releasePeerShareRuntimeOnInstance(runtime, instanceID)
	}
	_ = h.repo.MarkPeerShareRuntimeInstancesReleased(runtime.ID, time.Now().UnixMilli())
	return fmt.Errorf("healthy instances %d below required %d: %s", healthy, minimum, strings.Join(errorsByInstance, "; "))
}

func (h *Handler) releasePeerShareRuntimeOnInstance(runtime *repo.PeerShareRuntime, instanceID string) {
	if runtime == nil {
		return
	}
	if strings.TrimSpace(runtime.ServiceName) != "" {
		_, _ = h.sendNodeCommandToInstanceWithTimeout(runtime.NodeID, instanceID, "DeleteService", map[string]interface{}{"services": []string{runtime.ServiceName}}, defaultNodeCommandTimeout, false, true)
	}
	if strings.EqualFold(runtime.Role, "middle") && strings.TrimSpace(runtime.ChainName) != "" {
		_, _ = h.sendNodeCommandToInstanceWithTimeout(runtime.NodeID, instanceID, "DeleteChains", map[string]interface{}{"chain": runtime.ChainName}, defaultNodeCommandTimeout, false, true)
	}
}

func (h *Handler) releasePeerShareRuntimeInstances(runtime *repo.PeerShareRuntime) {
	if runtime == nil || runtime.Applied != 1 {
		return
	}
	instances, err := h.repo.ListPeerShareRuntimeInstances(runtime.ID)
	if err != nil || len(instances) == 0 {
		if strings.TrimSpace(runtime.ServiceName) != "" {
			_, _ = h.sendNodeCommand(runtime.NodeID, "DeleteService", map[string]interface{}{"services": []string{runtime.ServiceName}}, false, true)
		}
		if strings.EqualFold(runtime.Role, "middle") && strings.TrimSpace(runtime.ChainName) != "" {
			_, _ = h.sendNodeCommand(runtime.NodeID, "DeleteChains", map[string]interface{}{"chain": runtime.ChainName}, false, true)
		}
		return
	}
	for _, inst := range instances {
		if inst.Applied == 1 || inst.Status == 1 {
			h.releasePeerShareRuntimeOnInstance(runtime, inst.InstanceID)
		}
	}
	_ = h.repo.MarkPeerShareRuntimeInstancesReleased(runtime.ID, time.Now().UnixMilli())
}

func (h *Handler) sendPeerShareCommand(share *repo.PeerShare, commandType string, data interface{}, timeout time.Duration, tolerateExists, tolerateNotFound bool) ([]map[string]interface{}, error) {
	instances, legacy, err := h.scopedPeerShareInstances(share)
	if err != nil {
		return nil, err
	}
	if legacy {
		res, err := h.sendNodeCommandWithTimeout(share.NodeID, commandType, data, timeout, tolerateExists, tolerateNotFound)
		if err != nil {
			return nil, err
		}
		return []map[string]interface{}{{"instanceId": "", "success": true, "type": res.Type, "data": res.Data, "message": res.Message}}, nil
	}
	results := make([]map[string]interface{}, 0, len(instances))
	healthy := 0
	for _, inst := range instances {
		if inst.Status != 1 {
			results = append(results, map[string]interface{}{"instanceId": inst.InstanceID, "success": false, "message": "instance offline"})
			continue
		}
		res, cmdErr := h.sendNodeCommandToInstanceWithTimeout(share.NodeID, inst.InstanceID, commandType, data, timeout, tolerateExists, tolerateNotFound)
		if cmdErr != nil {
			results = append(results, map[string]interface{}{"instanceId": inst.InstanceID, "success": false, "message": cmdErr.Error()})
			continue
		}
		healthy++
		results = append(results, map[string]interface{}{"instanceId": inst.InstanceID, "success": true, "type": res.Type, "message": res.Message, "data": res.Data})
	}
	minimum := share.MinHealthyInstances
	if minimum <= 0 {
		minimum = 1
	}
	if healthy < minimum {
		return results, fmt.Errorf("healthy instances %d below required %d", healthy, minimum)
	}
	return results, nil
}

func (h *Handler) syncPeerShareRuntimesToInstance(nodeID int64, instanceID string) {
	if h == nil || h.repo == nil || nodeID <= 0 || strings.TrimSpace(instanceID) == "" {
		return
	}
	shares, err := h.repo.ListPeerSharesByNodeID(nodeID)
	if err != nil {
		return
	}
	for i := range shares {
		share := shares[i]
		statuses, statusErr := h.peerShareInstanceStatuses(&share)
		if statusErr != nil {
			continue
		}
		inScope := false
		for _, status := range statuses {
			if status.InstanceID == instanceID && status.InScope {
				inScope = true
				break
			}
		}
		if !inScope {
			continue
		}
		runtimes, runtimeErr := h.repo.ListActivePeerShareRuntimesByShareID(share.ID)
		if runtimeErr != nil {
			continue
		}
		for j := range runtimes {
			runtime := runtimes[j]
			if runtime.Applied != 1 || strings.TrimSpace(runtime.ServiceName) == "" {
				continue
			}
			chainData, service, buildErr := h.peerShareRuntimeConfig(&runtime)
			if buildErr != nil {
				continue
			}
			now := time.Now().UnixMilli()
			state := &repo.PeerShareRuntimeInstance{RuntimeID: runtime.ID, ShareID: runtime.ShareID, NodeID: runtime.NodeID, InstanceID: instanceID, Port: runtime.Port, Status: 1, CreatedTime: now, UpdatedTime: now}
			if chainData != nil {
				if _, cmdErr := h.sendNodeCommandToInstanceWithTimeout(nodeID, instanceID, "AddChains", chainData, defaultNodeCommandTimeout, true, false); cmdErr != nil {
					state.LastError = cmdErr.Error()
					_ = h.repo.UpsertPeerShareRuntimeInstance(state)
					continue
				}
			}
			if _, cmdErr := h.sendNodeCommandToInstanceWithTimeout(nodeID, instanceID, "AddService", []map[string]interface{}{service}, defaultNodeCommandTimeout, true, false); cmdErr != nil {
				state.LastError = cmdErr.Error()
				_ = h.repo.UpsertPeerShareRuntimeInstance(state)
				continue
			}
			state.Applied, state.Healthy = 1, 1
			_ = h.repo.UpsertPeerShareRuntimeInstance(state)
		}
	}
}

func (h *Handler) reconcilePeerShareRuntimeScope(share *repo.PeerShare, previous []peerShareInstanceStatus) {
	if h == nil || h.repo == nil || share == nil {
		return
	}
	current, err := h.peerShareInstanceStatuses(share)
	if err != nil {
		return
	}
	previousScope := make(map[string]struct{}, len(previous))
	currentScope := make(map[string]peerShareInstanceStatus, len(current))
	for _, status := range previous {
		if status.InScope {
			previousScope[status.InstanceID] = struct{}{}
		}
	}
	for _, status := range current {
		if status.InScope {
			currentScope[status.InstanceID] = status
		}
	}
	runtimes, err := h.repo.ListActivePeerShareRuntimesByShareID(share.ID)
	if err != nil {
		return
	}
	for instanceID := range previousScope {
		if _, stillInScope := currentScope[instanceID]; stillInScope {
			continue
		}
		for i := range runtimes {
			runtime := &runtimes[i]
			h.releasePeerShareRuntimeOnInstance(runtime, instanceID)
			_ = h.repo.DeletePeerShareRuntimeInstance(runtime.ID, instanceID)
		}
	}
	for instanceID, status := range currentScope {
		if _, alreadyInScope := previousScope[instanceID]; alreadyInScope || status.Status != 1 {
			continue
		}
		h.syncPeerShareRuntimesToInstance(share.NodeID, instanceID)
	}
}

func (h *Handler) peerShareRuntimeConfig(runtime *repo.PeerShareRuntime) (map[string]interface{}, map[string]interface{}, error) {
	if runtime == nil {
		return nil, nil, fmt.Errorf("runtime not found")
	}
	node, err := h.getNodeRecord(runtime.NodeID)
	if err != nil {
		return nil, nil, err
	}
	var targets []federationRuntimeTarget
	if strings.TrimSpace(runtime.Target) != "" {
		if err := json.Unmarshal([]byte(runtime.Target), &targets); err != nil {
			return nil, nil, err
		}
	}
	var chainData map[string]interface{}
	if strings.EqualFold(runtime.Role, "middle") {
		nodes := make([]map[string]interface{}, 0, len(targets))
		for i, target := range targets {
			nodes = append(nodes, map[string]interface{}{
				"name": fmt.Sprintf("node_%d", i+1), "addr": processServerAddress(fmt.Sprintf("%s:%d", target.Host, target.Port)),
				"connector": map[string]interface{}{"type": "relay", "metadata": map[string]interface{}{"nodelay": true, "udpTTL": "5s"}},
				"dialer":    map[string]interface{}{"type": defaultString(target.Protocol, runtime.Protocol)},
			})
		}
		chainData = map[string]interface{}{"name": runtime.ChainName, "hops": []map[string]interface{}{{
			"name": fmt.Sprintf("hop_%d", runtime.ID), "selector": map[string]interface{}{"strategy": runtime.Strategy, "maxFails": 1, "failTimeout": int64(600000000000)}, "nodes": nodes,
		}}}
	}
	service := buildFederationServiceConfig(runtime.ServiceName, fmt.Sprintf("%s:%d", node.TCPListenAddr, runtime.Port), runtime.Protocol, runtime.Role, runtime.ChainName, len(targets), node.InterfaceName)
	return chainData, service, nil
}

func (h *Handler) cleanupFederationTunnels(shareID int64) {
	if h == nil || h.repo == nil || shareID <= 0 {
		return
	}
	namePrefix := fmt.Sprintf("Share-%d-Port-", shareID)
	tunnelIDs, err := h.repo.ListTunnelIDsByNamePrefix(namePrefix)
	if err != nil || len(tunnelIDs) == 0 {
		return
	}

	for _, tid := range tunnelIDs {
		_ = h.deleteTunnelByID(tid)
	}
}
