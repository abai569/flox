package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"go-backend/internal/dnsfailover"
	"go-backend/internal/http/response"
	"go-backend/internal/security"
	"go-backend/internal/store/model"
)

type dnsFailoverProviderConfig map[string]string

type dnsFailoverSaveRequest struct {
	NodeID              int64                     `json:"nodeId"`
	Enabled             bool                      `json:"enabled"`
	Provider            string                    `json:"provider"`
	Domain              string                    `json:"domain"`
	TTL                 int                       `json:"ttl"`
	ManageA             bool                      `json:"manageA"`
	ManageAAAA          bool                      `json:"manageAAAA"`
	MinRecords          int                       `json:"minRecords"`
	RemoveFailCount     int                       `json:"removeFailCount"`
	RestoreSuccessCount int                       `json:"restoreSuccessCount"`
	SyncIntervalSeconds int                       `json:"syncIntervalSeconds"`
	ProviderConfig      dnsFailoverProviderConfig `json:"providerConfig"`
}

type dnsFailoverResponse struct {
	NodeID              int64                     `json:"nodeId"`
	Enabled             bool                      `json:"enabled"`
	Provider            string                    `json:"provider"`
	Domain              string                    `json:"domain"`
	TTL                 int                       `json:"ttl"`
	ManageA             bool                      `json:"manageA"`
	ManageAAAA          bool                      `json:"manageAAAA"`
	MinRecords          int                       `json:"minRecords"`
	RemoveFailCount     int                       `json:"removeFailCount"`
	RestoreSuccessCount int                       `json:"restoreSuccessCount"`
	SyncIntervalSeconds int                       `json:"syncIntervalSeconds"`
	ProviderConfig      dnsFailoverProviderConfig `json:"providerConfig"`
	CurrentA            []string                  `json:"currentA"`
	CurrentAAAA         []string                  `json:"currentAAAA"`
	ExpectedA           []string                  `json:"expectedA"`
	ExpectedAAAA        []string                  `json:"expectedAAAA"`
	LastSyncAt          int64                     `json:"lastSyncAt"`
	LastError           string                    `json:"lastError"`
}

func (h *Handler) nodeDNSFailoverGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		NodeID int64 `json:"nodeId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	cfg, err := h.repo.GetNodeDNSFailover(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(h.dnsFailoverResponse(req.NodeID, cfg)))
}

func (h *Handler) nodeDNSFailoverSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	var req dnsFailoverSaveRequest
	if err := decodeJSON(r.Body, &req); err != nil || req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if _, err := h.getNodeRecord(req.NodeID); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	cfg, err := h.buildDNSFailoverConfig(req)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	if err := h.repo.UpsertNodeDNSFailover(cfg); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	saved, _ := h.repo.GetNodeDNSFailover(req.NodeID)
	response.WriteJSON(w, response.OK(h.dnsFailoverResponse(req.NodeID, saved)))
}

func (h *Handler) nodeDNSFailoverSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		NodeID int64 `json:"nodeId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	cfg, err := h.repo.GetNodeDNSFailover(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if cfg == nil {
		response.WriteJSON(w, response.ErrDefault("DNS 容灾未配置"))
		return
	}
	if err := h.syncNodeDNSFailover(r.Context(), *cfg); err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}
	cfg, _ = h.repo.GetNodeDNSFailover(req.NodeID)
	response.WriteJSON(w, response.OK(h.dnsFailoverResponse(req.NodeID, cfg)))
}

func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "未登录或token已过期"))
		return false
	}
	if roleID != 0 {
		response.WriteJSON(w, response.Err(403, "权限不足，仅管理员可操作"))
		return false
	}
	return true
}

func (h *Handler) buildDNSFailoverConfig(req dnsFailoverSaveRequest) (*model.NodeDNSFailover, error) {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "cloudflare"
	}
	if provider != "cloudflare" && provider != "aliyun" {
		return nil, errors.New("请选择 Cloudflare 或阿里云 DNS")
	}
	domain := strings.TrimSpace(req.Domain)
	if req.Enabled && domain == "" {
		return nil, errors.New("域名不能为空")
	}
	if req.TTL <= 0 {
		req.TTL = 1
	}
	if req.MinRecords <= 0 {
		req.MinRecords = 1
	}
	if req.RemoveFailCount <= 0 {
		req.RemoveFailCount = 3
	}
	if req.RestoreSuccessCount <= 0 {
		req.RestoreSuccessCount = 3
	}
	if req.SyncIntervalSeconds < 30 {
		req.SyncIntervalSeconds = 30
	}
	providerConfig, err := h.mergeDNSProviderConfig(req.NodeID, provider, req.Enabled, req.ProviderConfig)
	if err != nil {
		return nil, err
	}
	encodedConfig, err := h.encryptDNSProviderConfig(providerConfig)
	if err != nil {
		return nil, err
	}
	return &model.NodeDNSFailover{
		NodeID:              req.NodeID,
		Enabled:             boolInt(req.Enabled),
		Provider:            provider,
		Domain:              domain,
		TTL:                 req.TTL,
		ManageA:             boolInt(req.ManageA),
		ManageAAAA:          boolInt(req.ManageAAAA),
		MinRecords:          req.MinRecords,
		RemoveFailCount:     req.RemoveFailCount,
		RestoreSuccessCount: req.RestoreSuccessCount,
		SyncIntervalSeconds: req.SyncIntervalSeconds,
		ProviderConfig:      encodedConfig,
	}, nil
}

func (h *Handler) mergeDNSProviderConfig(nodeID int64, provider string, enabled bool, next dnsFailoverProviderConfig) (dnsFailoverProviderConfig, error) {
	merged := dnsFailoverProviderConfig{}
	existing, _ := h.repo.GetNodeDNSFailover(nodeID)
	if existing != nil && strings.EqualFold(existing.Provider, provider) {
		cfg, _ := h.decryptDNSProviderConfig(existing.ProviderConfig)
		for key, value := range cfg {
			merged[key] = value
		}
	}
	for key, value := range next {
		value = strings.TrimSpace(value)
		if value != "" {
			merged[key] = value
		}
	}
	if !enabled {
		return merged, nil
	}
	if provider == "cloudflare" {
		if merged["authMode"] == "" {
			merged["authMode"] = "token"
		}
		if merged["proxied"] == "" {
			merged["proxied"] = "false"
		}
		if merged["authMode"] == "token" && merged["apiToken"] == "" {
			return nil, errors.New("Cloudflare API Token 不能为空")
		}
		if merged["authMode"] == "global_key" && (merged["email"] == "" || merged["globalApiKey"] == "") {
			return nil, errors.New("Cloudflare Email 和 Global API Key 不能为空")
		}
	}
	if provider == "aliyun" {
		for _, key := range []string{"accessKeyId", "accessKeySecret"} {
			if merged[key] == "" {
				return nil, errors.New("阿里云 AccessKey 配置不完整")
			}
		}
	}
	return merged, nil
}

func (h *Handler) dnsFailoverResponse(nodeID int64, cfg *model.NodeDNSFailover) dnsFailoverResponse {
	if cfg == nil {
		return dnsFailoverResponse{NodeID: nodeID, TTL: 1, ManageA: true, ManageAAAA: true, MinRecords: 1, RemoveFailCount: 3, RestoreSuccessCount: 3, SyncIntervalSeconds: 30, ProviderConfig: dnsFailoverProviderConfig{"proxied": "false", "authMode": "token"}}
	}
	providerConfig, _ := h.decryptDNSProviderConfig(cfg.ProviderConfig)
	masked := maskDNSProviderConfig(providerConfig)
	return dnsFailoverResponse{
		NodeID:              cfg.NodeID,
		Enabled:             cfg.Enabled == 1,
		Provider:            cfg.Provider,
		Domain:              cfg.Domain,
		TTL:                 cfg.TTL,
		ManageA:             cfg.ManageA == 1,
		ManageAAAA:          cfg.ManageAAAA == 1,
		MinRecords:          cfg.MinRecords,
		RemoveFailCount:     cfg.RemoveFailCount,
		RestoreSuccessCount: cfg.RestoreSuccessCount,
		SyncIntervalSeconds: cfg.SyncIntervalSeconds,
		ProviderConfig:      masked,
		CurrentA:            splitCSV(cfg.CurrentA),
		CurrentAAAA:         splitCSV(cfg.CurrentAAAA),
		ExpectedA:           splitCSV(cfg.ExpectedA),
		ExpectedAAAA:        splitCSV(cfg.ExpectedAAAA),
		LastSyncAt:          cfg.LastSyncAt,
		LastError:           cfg.LastError,
	}
}

func (h *Handler) runDNSFailoverLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.syncEnabledDNSFailovers(ctx)
		}
	}
}

func (h *Handler) syncEnabledDNSFailovers(ctx context.Context) {
	configs, err := h.repo.ListEnabledNodeDNSFailovers()
	if err != nil {
		return
	}
	now := time.Now().UnixMilli()
	for _, cfg := range configs {
		intervalMs := int64(cfg.SyncIntervalSeconds) * 1000
		if intervalMs < 30_000 {
			intervalMs = 30_000
		}
		if cfg.LastSyncAt > 0 && now-cfg.LastSyncAt < intervalMs {
			continue
		}
		_ = h.syncNodeDNSFailover(ctx, cfg)
	}
}

func (h *Handler) syncNodeDNSFailover(ctx context.Context, cfg model.NodeDNSFailover) error {
	if cfg.Enabled != 1 {
		return nil
	}
	providerConfig, err := h.decryptDNSProviderConfig(cfg.ProviderConfig)
	if err != nil {
		h.storeDNSFailoverError(cfg, err)
		return err
	}
	provider, err := dnsfailover.NewProvider(cfg.Provider, dnsfailover.Config(providerConfig))
	if err != nil {
		h.storeDNSFailoverError(cfg, err)
		return err
	}
	instances, err := h.repo.ListNodeInstances(cfg.NodeID)
	if err != nil {
		h.storeDNSFailoverError(cfg, err)
		return err
	}
	expectedA, expectedAAAA := expectedDNSIPs(instances, cfg, time.Now().UnixMilli())
	currentA, err := h.syncDNSRecordType(ctx, provider, cfg, "A", expectedA)
	if err != nil {
		h.storeDNSFailoverState(cfg, currentA, nil, expectedA, expectedAAAA, err.Error())
		return err
	}
	currentAAAA, err := h.syncDNSRecordType(ctx, provider, cfg, "AAAA", expectedAAAA)
	if err != nil {
		h.storeDNSFailoverState(cfg, currentA, currentAAAA, expectedA, expectedAAAA, err.Error())
		return err
	}
	h.storeDNSFailoverState(cfg, currentA, currentAAAA, expectedA, expectedAAAA, "")
	return nil
}

func (h *Handler) syncDNSRecordType(ctx context.Context, provider dnsfailover.Provider, cfg model.NodeDNSFailover, recordType string, expected []string) ([]string, error) {
	if recordType == "A" && cfg.ManageA != 1 {
		return nil, nil
	}
	if recordType == "AAAA" && cfg.ManageAAAA != 1 {
		return nil, nil
	}
	records, err := provider.ListRecords(ctx, cfg.Domain, recordType)
	if err != nil {
		return nil, err
	}
	currentValues := recordValues(records)
	if len(expected) == 0 {
		return currentValues, nil
	}
	expectedSet := stringSet(expected)
	existingSet := stringSet(currentValues)
	proxied := false
	providerConfig, _ := h.decryptDNSProviderConfig(cfg.ProviderConfig)
	if strings.EqualFold(providerConfig["proxied"], "true") {
		proxied = true
	}
	for _, value := range expected {
		if _, ok := existingSet[value]; !ok {
			if err := provider.CreateRecord(ctx, dnsfailover.Record{Name: cfg.Domain, Type: recordType, Value: value, TTL: cfg.TTL, Proxied: proxied}); err != nil {
				return currentValues, err
			}
		}
	}
	for _, record := range records {
		if _, ok := expectedSet[record.Value]; ok && (record.TTL != cfg.TTL || record.Proxied != proxied) {
			record.TTL = cfg.TTL
			record.Proxied = proxied
			if err := provider.UpdateRecord(ctx, record); err != nil {
				return currentValues, err
			}
		}
	}
	availableCount := len(records)
	for _, value := range expected {
		if _, ok := existingSet[value]; !ok {
			availableCount++
		}
	}
	for _, record := range records {
		if _, ok := expectedSet[record.Value]; ok {
			continue
		}
		if availableCount <= cfg.MinRecords {
			continue
		}
		if err := provider.DeleteRecord(ctx, record.ID); err != nil {
			return currentValues, err
		}
		availableCount--
	}
	records, err = provider.ListRecords(ctx, cfg.Domain, recordType)
	if err != nil {
		return currentValues, err
	}
	return recordValues(records), nil
}

func (h *Handler) storeDNSFailoverError(cfg model.NodeDNSFailover, err error) {
	h.storeDNSFailoverState(cfg, splitCSV(cfg.CurrentA), splitCSV(cfg.CurrentAAAA), splitCSV(cfg.ExpectedA), splitCSV(cfg.ExpectedAAAA), err.Error())
}

func (h *Handler) storeDNSFailoverState(cfg model.NodeDNSFailover, currentA, currentAAAA, expectedA, expectedAAAA []string, lastError string) {
	_ = h.repo.UpdateNodeDNSFailoverState(cfg.NodeID, joinCSV(currentA), joinCSV(currentAAAA), joinCSV(expectedA), joinCSV(expectedAAAA), lastError, time.Now().UnixMilli())
}

func expectedDNSIPs(instances []model.NodeInstance, cfg model.NodeDNSFailover, now int64) ([]string, []string) {
	v4 := make([]string, 0)
	v6 := make([]string, 0)
	seen4 := map[string]struct{}{}
	seen6 := map[string]struct{}{}
	removeAfterMs := int64(cfg.RemoveFailCount) * int64(cfg.SyncIntervalSeconds) * 1000
	if removeAfterMs <= 0 {
		removeAfterMs = 90_000
	}
	for _, inst := range instances {
		if inst.Weight <= 0 {
			continue
		}
		if inst.Status != 1 {
			lastChange := inst.UpdatedTime
			if lastChange <= 0 {
				lastChange = inst.LastSeenAt
			}
			if lastChange <= 0 || now-lastChange >= removeAfterMs {
				continue
			}
		}
		if ip := strings.TrimSpace(inst.PublicIPV4); ip != "" {
			if _, ok := seen4[ip]; !ok {
				seen4[ip] = struct{}{}
				v4 = append(v4, ip)
			}
		}
		if ip := strings.TrimSpace(inst.PublicIPV6); ip != "" {
			if _, ok := seen6[ip]; !ok {
				seen6[ip] = struct{}{}
				v6 = append(v6, ip)
			}
		}
	}
	sort.Strings(v4)
	sort.Strings(v6)
	return v4, v6
}

func (h *Handler) encryptDNSProviderConfig(cfg dnsFailoverProviderConfig) (string, error) {
	data, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	crypto, err := security.NewAESCrypto(h.dnsFailoverSecret())
	if err != nil {
		return "", err
	}
	return crypto.Encrypt(data)
}

func (h *Handler) decryptDNSProviderConfig(value string) (dnsFailoverProviderConfig, error) {
	if strings.TrimSpace(value) == "" {
		return dnsFailoverProviderConfig{}, nil
	}
	crypto, err := security.NewAESCrypto(h.dnsFailoverSecret())
	if err != nil {
		return nil, err
	}
	data, err := crypto.Decrypt(value)
	if err != nil {
		return nil, err
	}
	var cfg dnsFailoverProviderConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (h *Handler) dnsFailoverSecret() string {
	secret := strings.TrimSpace(h.jwtSecret)
	if secret == "" {
		secret = "flox-dns-failover"
	}
	return "dns-failover:" + secret
}

func maskDNSProviderConfig(cfg dnsFailoverProviderConfig) dnsFailoverProviderConfig {
	masked := dnsFailoverProviderConfig{}
	for key, value := range cfg {
		switch key {
		case "apiToken", "globalApiKey", "accessKeySecret":
			if value != "" {
				masked[key+"Set"] = "true"
			}
		default:
			masked[key] = value
		}
	}
	return masked
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func recordValues(records []dnsfailover.Record) []string {
	values := make([]string, 0, len(records))
	seen := map[string]struct{}{}
	for _, record := range records {
		value := strings.TrimSpace(record.Value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func stringSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			set[value] = struct{}{}
		}
	}
	return set
}

func joinCSV(values []string) string {
	values = append([]string(nil), values...)
	sort.Strings(values)
	return strings.Join(values, ",")
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	sort.Strings(result)
	return result
}
