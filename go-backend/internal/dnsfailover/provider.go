package dnsfailover

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type Record struct {
	ID      string
	Name    string
	Type    string
	Value   string
	TTL     int
	Proxied bool
}

type Provider interface {
	ListRecords(ctx context.Context, name string, recordType string) ([]Record, error)
	CreateRecord(ctx context.Context, record Record) error
	UpdateRecord(ctx context.Context, record Record) error
	DeleteRecord(ctx context.Context, recordID string) error
}

type Config map[string]string

func NewProvider(provider string, cfg Config) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "cloudflare":
		return newCloudflareProvider(cfg)
	case "aliyun":
		return newAliyunProvider(cfg)
	default:
		return nil, fmt.Errorf("unsupported dns provider %q", provider)
	}
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 15 * time.Second}
}

type cloudflareProvider struct {
	client       *http.Client
	zoneID       string
	authMode     string
	apiToken     string
	email        string
	globalAPIKey string
}

func newCloudflareProvider(cfg Config) (*cloudflareProvider, error) {
	p := &cloudflareProvider{
		client:       httpClient(),
		zoneID:       strings.TrimSpace(cfg["zoneId"]),
		authMode:     strings.TrimSpace(cfg["authMode"]),
		apiToken:     strings.TrimSpace(cfg["apiToken"]),
		email:        strings.TrimSpace(cfg["email"]),
		globalAPIKey: strings.TrimSpace(cfg["globalApiKey"]),
	}
	if p.authMode == "" {
		if p.apiToken != "" {
			p.authMode = "token"
		} else {
			p.authMode = "global_key"
		}
	}
	if p.authMode == "token" && p.apiToken == "" {
		return nil, errors.New("cloudflare api token is required")
	}
	if p.authMode == "global_key" && (p.email == "" || p.globalAPIKey == "") {
		return nil, errors.New("cloudflare email and global api key are required")
	}
	return p, nil
}

func (p *cloudflareProvider) ListRecords(ctx context.Context, name string, recordType string) ([]Record, error) {
	if err := p.ensureZoneID(ctx, name); err != nil {
		return nil, err
	}
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records?type=%s&name=%s", url.PathEscape(p.zoneID), url.QueryEscape(recordType), url.QueryEscape(name))
	var out struct {
		Success bool `json:"success"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Result []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Type    string `json:"type"`
			Content string `json:"content"`
			TTL     int    `json:"ttl"`
			Proxied bool   `json:"proxied"`
		} `json:"result"`
	}
	if err := p.do(ctx, http.MethodGet, endpoint, nil, &out); err != nil {
		return nil, err
	}
	records := make([]Record, 0, len(out.Result))
	for _, item := range out.Result {
		records = append(records, Record{ID: item.ID, Name: item.Name, Type: item.Type, Value: item.Content, TTL: item.TTL, Proxied: item.Proxied})
	}
	return records, nil
}

func (p *cloudflareProvider) CreateRecord(ctx context.Context, record Record) error {
	if err := p.ensureZoneID(ctx, record.Name); err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records", url.PathEscape(p.zoneID))
	body := map[string]interface{}{"type": record.Type, "name": record.Name, "content": record.Value, "ttl": record.TTL, "proxied": record.Proxied}
	return p.do(ctx, http.MethodPost, endpoint, body, nil)
}

func (p *cloudflareProvider) UpdateRecord(ctx context.Context, record Record) error {
	if record.ID == "" {
		return errors.New("cloudflare record id is required")
	}
	if err := p.ensureZoneID(ctx, record.Name); err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s", url.PathEscape(p.zoneID), url.PathEscape(record.ID))
	body := map[string]interface{}{"type": record.Type, "name": record.Name, "content": record.Value, "ttl": record.TTL, "proxied": record.Proxied}
	return p.do(ctx, http.MethodPatch, endpoint, body, nil)
}

func (p *cloudflareProvider) DeleteRecord(ctx context.Context, recordID string) error {
	if recordID == "" {
		return errors.New("cloudflare record id is required")
	}
	if p.zoneID == "" {
		return errors.New("cloudflare zone id is required")
	}
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s", url.PathEscape(p.zoneID), url.PathEscape(recordID))
	return p.do(ctx, http.MethodDelete, endpoint, nil, nil)
}

func (p *cloudflareProvider) ensureZoneID(ctx context.Context, recordName string) error {
	if p.zoneID != "" {
		return nil
	}
	zoneID, err := p.lookupZoneID(ctx, recordName)
	if err != nil {
		return err
	}
	p.zoneID = zoneID
	return nil
}

func (p *cloudflareProvider) lookupZoneID(ctx context.Context, recordName string) (string, error) {
	for _, zoneName := range cloudflareZoneCandidates(recordName) {
		endpoint := "https://api.cloudflare.com/client/v4/zones?name=" + url.QueryEscape(zoneName) + "&status=active&per_page=1"
		var out struct {
			Success bool `json:"success"`
			Errors  []struct {
				Message string `json:"message"`
			} `json:"errors"`
			Result []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"result"`
		}
		if err := p.do(ctx, http.MethodGet, endpoint, nil, &out); err != nil {
			return "", fmt.Errorf("cloudflare zone auto lookup failed: %w", err)
		}
		if len(out.Result) > 0 && out.Result[0].ID != "" {
			return out.Result[0].ID, nil
		}
	}
	return "", errors.New("cloudflare zone id not found, please fill zone id or grant zone read permission")
}

func cloudflareZoneCandidates(recordName string) []string {
	parts := strings.Split(strings.Trim(strings.TrimSpace(recordName), "."), ".")
	candidates := make([]string, 0)
	for i := 0; i <= len(parts)-2; i++ {
		candidate := strings.Join(parts[i:], ".")
		if candidate != "" {
			candidates = append(candidates, candidate)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return strings.Count(candidates[i], ".") < strings.Count(candidates[j], ".")
	})
	return candidates
}

func (p *cloudflareProvider) do(ctx context.Context, method string, endpoint string, body interface{}, out interface{}) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if p.authMode == "token" {
		req.Header.Set("Authorization", "Bearer "+p.apiToken)
	} else {
		req.Header.Set("X-Auth-Email", p.email)
		req.Header.Set("X-Auth-Key", p.globalAPIKey)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("cloudflare api status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var envelope struct {
		Success bool `json:"success"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	if !envelope.Success {
		if len(envelope.Errors) > 0 {
			return errors.New(envelope.Errors[0].Message)
		}
		return errors.New("cloudflare api failed")
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

type aliyunProvider struct {
	client          *http.Client
	accessKeyID     string
	accessKeySecret string
	domainName      string
	rr              string
}

func newAliyunProvider(cfg Config) (*aliyunProvider, error) {
	p := &aliyunProvider{
		client:          httpClient(),
		accessKeyID:     strings.TrimSpace(cfg["accessKeyId"]),
		accessKeySecret: strings.TrimSpace(cfg["accessKeySecret"]),
		domainName:      strings.TrimSpace(cfg["domainName"]),
		rr:              strings.TrimSpace(cfg["rr"]),
	}
	if p.accessKeyID == "" || p.accessKeySecret == "" {
		return nil, errors.New("aliyun access key id and secret are required")
	}
	return p, nil
}

func (p *aliyunProvider) ListRecords(ctx context.Context, name string, recordType string) ([]Record, error) {
	if err := p.ensureRecordTarget(ctx, name); err != nil {
		return nil, err
	}
	params := url.Values{}
	params.Set("Action", "DescribeDomainRecords")
	params.Set("DomainName", p.domainName)
	params.Set("RRKeyWord", p.rr)
	params.Set("TypeKeyWord", recordType)
	var out struct {
		DomainRecords struct {
			Record []struct {
				RecordID string `json:"RecordId"`
				RR       string `json:"RR"`
				Type     string `json:"Type"`
				Value    string `json:"Value"`
				TTL      int    `json:"TTL"`
			} `json:"Record"`
		} `json:"DomainRecords"`
	}
	if err := p.do(ctx, params, &out); err != nil {
		return nil, err
	}
	records := make([]Record, 0, len(out.DomainRecords.Record))
	for _, item := range out.DomainRecords.Record {
		fullName := aliyunFullRecordName(item.RR, p.domainName)
		if !strings.EqualFold(fullName, name) || !strings.EqualFold(item.Type, recordType) {
			continue
		}
		records = append(records, Record{ID: item.RecordID, Name: fullName, Type: item.Type, Value: item.Value, TTL: item.TTL})
	}
	return records, nil
}

func (p *aliyunProvider) CreateRecord(ctx context.Context, record Record) error {
	if err := p.ensureRecordTarget(ctx, record.Name); err != nil {
		return err
	}
	params := url.Values{}
	params.Set("Action", "AddDomainRecord")
	params.Set("DomainName", p.domainName)
	params.Set("RR", p.rr)
	params.Set("Type", record.Type)
	params.Set("Value", record.Value)
	params.Set("TTL", fmt.Sprintf("%d", record.TTL))
	return p.do(ctx, params, nil)
}

func (p *aliyunProvider) UpdateRecord(ctx context.Context, record Record) error {
	if record.ID == "" {
		return errors.New("aliyun record id is required")
	}
	if err := p.ensureRecordTarget(ctx, record.Name); err != nil {
		return err
	}
	params := url.Values{}
	params.Set("Action", "UpdateDomainRecord")
	params.Set("RecordId", record.ID)
	params.Set("RR", p.rr)
	params.Set("Type", record.Type)
	params.Set("Value", record.Value)
	params.Set("TTL", fmt.Sprintf("%d", record.TTL))
	return p.do(ctx, params, nil)
}

func (p *aliyunProvider) DeleteRecord(ctx context.Context, recordID string) error {
	if recordID == "" {
		return errors.New("aliyun record id is required")
	}
	params := url.Values{}
	params.Set("Action", "DeleteDomainRecord")
	params.Set("RecordId", recordID)
	return p.do(ctx, params, nil)
}

func (p *aliyunProvider) ensureRecordTarget(ctx context.Context, recordName string) error {
	recordName = strings.Trim(strings.TrimSpace(recordName), ".")
	if recordName == "" {
		return errors.New("aliyun record name is required")
	}
	if p.domainName != "" && p.rr != "" && aliyunRecordMatches(recordName, p.domainName, p.rr) {
		return nil
	}
	domainName, rr, err := p.resolveRecordTarget(ctx, recordName)
	if err != nil {
		return err
	}
	p.domainName = domainName
	p.rr = rr
	return nil
}

func (p *aliyunProvider) resolveRecordTarget(ctx context.Context, recordName string) (string, string, error) {
	domains, err := p.listDomains(ctx)
	if err != nil {
		return "", "", err
	}
	recordLower := strings.ToLower(recordName)
	best := ""
	for _, domain := range domains {
		domain = strings.Trim(strings.TrimSpace(domain), ".")
		if domain == "" {
			continue
		}
		domainLower := strings.ToLower(domain)
		if recordLower == domainLower || strings.HasSuffix(recordLower, "."+domainLower) {
			if best == "" || len(domain) > len(best) {
				best = domain
			}
		}
	}
	if best == "" {
		return "", "", fmt.Errorf("aliyun domain not found for record %q", recordName)
	}
	rr := "@"
	if len(recordName) > len(best) {
		rr = strings.TrimSuffix(recordName[:len(recordName)-len(best)], ".")
	}
	if rr == "" {
		rr = "@"
	}
	return best, rr, nil
}

func (p *aliyunProvider) listDomains(ctx context.Context) ([]string, error) {
	params := url.Values{}
	params.Set("Action", "DescribeDomains")
	params.Set("PageSize", "100")
	var out struct {
		Domains struct {
			Domain []struct {
				DomainName string `json:"DomainName"`
			} `json:"Domain"`
		} `json:"Domains"`
	}
	if err := p.do(ctx, params, &out); err != nil {
		return nil, fmt.Errorf("aliyun domain auto lookup failed: %w", err)
	}
	domains := make([]string, 0, len(out.Domains.Domain))
	for _, item := range out.Domains.Domain {
		if domain := strings.TrimSpace(item.DomainName); domain != "" {
			domains = append(domains, domain)
		}
	}
	if len(domains) == 0 {
		return nil, errors.New("aliyun domain list is empty")
	}
	return domains, nil
}

func aliyunRecordMatches(recordName, domainName, rr string) bool {
	return strings.EqualFold(strings.Trim(recordName, "."), aliyunFullRecordName(rr, domainName))
}

func aliyunFullRecordName(rr, domainName string) string {
	rr = strings.Trim(strings.TrimSpace(rr), ".")
	domainName = strings.Trim(strings.TrimSpace(domainName), ".")
	if rr == "" || rr == "@" {
		return domainName
	}
	return rr + "." + domainName
}

func (p *aliyunProvider) do(ctx context.Context, params url.Values, out interface{}) error {
	params.Set("Format", "JSON")
	params.Set("Version", "2015-01-09")
	params.Set("AccessKeyId", p.accessKeyID)
	params.Set("SignatureMethod", "HMAC-SHA1")
	params.Set("Timestamp", time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	params.Set("SignatureVersion", "1.0")
	params.Set("SignatureNonce", fmt.Sprintf("%d", time.Now().UnixNano()))
	params.Set("Signature", p.sign(params))
	endpoint := "https://alidns.aliyuncs.com/?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("aliyun api status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var apiErr struct {
		Code    string `json:"Code"`
		Message string `json:"Message"`
	}
	_ = json.Unmarshal(data, &apiErr)
	if apiErr.Code != "" {
		return fmt.Errorf("aliyun api %s: %s", apiErr.Code, apiErr.Message)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (p *aliyunProvider) sign(params url.Values) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		if key == "Signature" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, aliyunPercentEncode(key)+"="+aliyunPercentEncode(params.Get(key)))
	}
	canonicalizedQueryString := strings.Join(parts, "&")
	stringToSign := "GET&%2F&" + aliyunPercentEncode(canonicalizedQueryString)
	mac := hmac.New(sha1.New, []byte(p.accessKeySecret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func aliyunPercentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "*", "%2A")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}
