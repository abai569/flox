package middleware

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// LicenseVerifier handles license verification with remote server
type LicenseVerifier struct {
	serverURL      string
	licenseKey     string
	domain         string
	accessDomain   string
	accessProtocol string
	httpClient     *http.Client
}

// VerifyRequest is the request body for license verification
type VerifyRequest struct {
	LicenseKey     string `json:"license_key"`
	Domain         string `json:"domain"`
	AccessDomain   string `json:"access_domain,omitempty"`
	AccessProtocol string `json:"access_protocol,omitempty"`
}

// VerifyResponse is the response body for license verification
type VerifyResponse struct {
	Valid      bool   `json:"valid"`
	ExpireTime int64  `json:"expire_time,omitempty"`
	Username   string `json:"username,omitempty"`
	Reason     string `json:"reason,omitempty"`
	IsTrial    bool   `json:"is_trial"`
	Signature  string `json:"signature,omitempty"`
}

// licenseState stores the current license state
type licenseState struct {
	valid      bool
	expireTime int64
	reason     string
	isTrial    bool
	LastCheck  time.Time
	mu         sync.RWMutex
}

// ObscuredHMACKey returns the HMAC secret key used to verify license server signatures.
// Priority: HMAC_SECRET_KEY env var → empty string.
// An empty secret disables signature verification, which is fine when the license server
// also has no key configured (e.g. self-hosted without custom key).
func ObscuredHMACKey() string {
	return os.Getenv("HMAC_SECRET_KEY")
}

// VerifyResponseSignature checks the HMAC signature of a license server response.
func VerifyResponseSignature(resp *VerifyResponse, secret string) bool {
	if resp.Signature == "" || secret == "" {
		return true
	}
	sigPayload := fmt.Sprintf("%v:%d:%s", resp.Valid, resp.ExpireTime, resp.Reason)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigPayload))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(resp.Signature))
}

var globalLicenseState = &licenseState{}

// NewLicenseVerifier creates a new LicenseVerifier instance
func NewLicenseVerifier(serverURL, licenseKey, domain, accessDomain, accessProtocol string) *LicenseVerifier {
	return &LicenseVerifier{
		serverURL:      serverURL,
		licenseKey:     licenseKey,
		domain:         domain,
		accessDomain:   accessDomain,
		accessProtocol: accessProtocol,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Verify performs license verification
func (v *LicenseVerifier) Verify(ctx context.Context) (*VerifyResponse, error) {
	if v.serverURL == "" || v.licenseKey == "" {
		return &VerifyResponse{Valid: false, Reason: "未配置授权服务"}, nil
	}

	reqBody := VerifyRequest{
		LicenseKey:     v.licenseKey,
		Domain:         v.domain,
		AccessDomain:   v.accessDomain,
		AccessProtocol: v.accessProtocol,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.serverURL+"/api/verify", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := v.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("verify request: %w", err)
	}
	defer resp.Body.Close()

	var result VerifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	// Verify HMAC signature to prevent fake license server attacks
	if !VerifyResponseSignature(&result, ObscuredHMACKey()) {
		return nil, fmt.Errorf("invalid response signature")
	}

	return &result, nil
}

// GetServerDomain extracts domain from environment or hostname
func GetServerDomain() string {
	// Check if a domain was recovered from DB config at startup
	checkParams.mu.RLock()
	domainFromConfig := checkParams.domainFromConfig
	checkParams.mu.RUnlock()
	if domainFromConfig != "" {
		return domainFromConfig
	}

	domain := os.Getenv("SERVER_DOMAIN")
	if domain != "" {
		return domain
	}

	hostname, err := os.Hostname()
	if err != nil {
		return ""
	}
	return hostname
}

var checkParams struct {
	serverURL        string
	licenseKey       string
	domain           string
	accessDomain     string
	accessProtocol   string
	domainFromConfig string
	mu               sync.RWMutex
}

// StartLicenseVerification starts license verification and stores the result
func StartLicenseVerification(serverURL, licenseKey, domain, accessDomain, accessProtocol string) error {
	if serverURL == "" || licenseKey == "" {
		globalLicenseState.mu.Lock()
		globalLicenseState.valid = false
		globalLicenseState.reason = "未配置授权服务"
		globalLicenseState.LastCheck = time.Now() // 标记为已检查（无配置）
		globalLicenseState.mu.Unlock()
		return nil
	}

	checkParams.mu.Lock()
	checkParams.serverURL = serverURL
	checkParams.licenseKey = licenseKey
	checkParams.domain = domain
	checkParams.accessDomain = accessDomain
	checkParams.accessProtocol = accessProtocol
	checkParams.mu.Unlock()

	// 立即执行一次验证
	if err := doVerify(); err != nil {
		return err
	}

	// 启动后台定时验证任务
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			lockedReason := getLockedReason()
			// 如果当前是锁定状态，提高验证频率（3 分钟）
			if lockedReason != "" {
				ticker.Reset(3 * time.Minute)
			} else {
				ticker.Reset(10 * time.Minute)
			}
			
			if err := doVerify(); err != nil {
				// log.Printf("⚠️ 后台验证失败：%v", err)
			}
		}
	}()

	return nil
}

// TriggerAsyncCheck triggers a background verification immediately
func TriggerAsyncCheck() {
	// 异步执行，避免阻塞当前请求
	go func() {
		// log.Println("🔄 触发异步授权验证...")
		doVerify()
	}()
}

// ForceSyncCheck performs synchronous verification and updates global state
// This is used during page refresh to ensure state is strictly up-to-date.
func ForceSyncCheck() {
	
	checkParams.mu.Lock()
	serverURL := checkParams.serverURL
	licenseKey := checkParams.licenseKey
	domain := checkParams.domain
	accessDomain := checkParams.accessDomain
	accessProtocol := checkParams.accessProtocol
	checkParams.mu.Unlock()

	if serverURL == "" || licenseKey == "" {
		globalLicenseState.mu.Lock()
		globalLicenseState.valid = false
		globalLicenseState.reason = "未配置授权服务"
		globalLicenseState.LastCheck = time.Now()
		globalLicenseState.mu.Unlock()
		return
	}

	verifier := NewLicenseVerifier(serverURL, licenseKey, domain, accessDomain, accessProtocol)

	// Use a shorter timeout for page refresh to avoid long UI blocking (3 seconds)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := verifier.Verify(ctx)
	
	globalLicenseState.mu.Lock()
	if err != nil {
		globalLicenseState.valid = false
		globalLicenseState.reason = fmt.Sprintf("同步验证失败: %v", err)
		// log.Printf("⚠️ 授权同步验证失败: %v", err)
	} else {
		globalLicenseState.valid = resp.Valid
		globalLicenseState.expireTime = resp.ExpireTime
		globalLicenseState.reason = resp.Reason
		globalLicenseState.isTrial = resp.IsTrial
		// log.Printf("✅ 授权同步验证成功: valid=%v", resp.Valid)
	}
	globalLicenseState.LastCheck = time.Now()
	globalLicenseState.mu.Unlock()
}

func getLockedReason() string {
	globalLicenseState.mu.RLock()
	defer globalLicenseState.mu.RUnlock()
	return globalLicenseState.reason
}

func doVerify() error {
	checkParams.mu.Lock()
	serverURL := checkParams.serverURL
	licenseKey := checkParams.licenseKey
	domain := checkParams.domain
	accessDomain := checkParams.accessDomain
	accessProtocol := checkParams.accessProtocol
	checkParams.mu.Unlock()

	if serverURL == "" || licenseKey == "" {
		globalLicenseState.mu.Lock()
		globalLicenseState.valid = false
		globalLicenseState.reason = "未配置授权服务"
		globalLicenseState.LastCheck = time.Now()
		globalLicenseState.mu.Unlock()
		return nil
	}

	verifier := NewLicenseVerifier(serverURL, licenseKey, domain, accessDomain, accessProtocol)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := verifier.Verify(ctx)
	if err != nil {
		globalLicenseState.mu.Lock()
		globalLicenseState.valid = false
		globalLicenseState.reason = fmt.Sprintf("验证服务不可达：%v", err)
		globalLicenseState.LastCheck = time.Now()
		globalLicenseState.mu.Unlock()
		return err
	}

	globalLicenseState.mu.Lock()
	globalLicenseState.valid = resp.Valid
	globalLicenseState.expireTime = resp.ExpireTime
	globalLicenseState.reason = resp.Reason
	globalLicenseState.isTrial = resp.IsTrial
	globalLicenseState.LastCheck = time.Now()
	globalLicenseState.mu.Unlock()

	return nil
}

// TierType 定义授权等级
type TierType string

const (
	TierFree    TierType = "free"
	TierPremium TierType = "premium"
	TierBlocked TierType = "blocked"
)

// GetLicenseTier 获取当前授权等级
func GetLicenseTier() (TierType, string) {
	globalLicenseState.mu.RLock()
	defer globalLicenseState.mu.RUnlock()

	checkParams.mu.RLock()
	hasKey := checkParams.licenseKey != ""
	checkParams.mu.RUnlock()

	if !hasKey {
		return TierFree, "未配置授权服务"
	}

	if !globalLicenseState.valid {
		switch globalLicenseState.reason {
		case "域名不匹配", "授权已过期", "授权已被禁用":
			return TierBlocked, globalLicenseState.reason
		default:
			return TierFree, "验证服务不可达，已降级为免费版"
		}
	}

	return TierPremium, ""
}

// freeLimits 免费版资源限制
var freeLimits = map[string]int{
	"node":    5,
	"tunnel":  5,
	"user":    1,
	"forward": 25,
}

// CheckResourceLimit 检查资源是否超出免费版限制
func CheckResourceLimit(resourceType string, currentCount int) error {
	tier, reason := GetLicenseTier()
	if tier == TierPremium {
		return nil
	}
	if tier == TierBlocked {
		return fmt.Errorf("授权无效 (%s)，请联系管理员", reason)
	}
	limit, ok := freeLimits[resourceType]
	if !ok {
		return nil
	}
	if currentCount >= limit {
		return fmt.Errorf("免费版最多 %d 个%s，请配置商业授权以解除限制", limit, resourceType)
	}
	return nil
}

// GetLicenseState returns the current license state
func GetLicenseState() (valid bool, expireTime int64, reason string, isTrial bool) {
	globalLicenseState.mu.RLock()
	defer globalLicenseState.mu.RUnlock()
	return globalLicenseState.valid, globalLicenseState.expireTime, globalLicenseState.reason, globalLicenseState.isTrial
}

// SetLicenseState sets the license state (for testing)
func SetLicenseState(valid bool, expireTime int64, reason string) {
	globalLicenseState.mu.Lock()
	defer globalLicenseState.mu.Unlock()
	globalLicenseState.valid = valid
	globalLicenseState.expireTime = expireTime
	globalLicenseState.reason = reason
}

// UpdateServerDomainFromConfig sets the domain recovered from DB config.
// This is used by main.go to override the domain before verification starts
// if it was missing from environment variables but present in the database.
func UpdateServerDomainFromConfig(domain string) {
	checkParams.mu.Lock()
	checkParams.domainFromConfig = domain
	checkParams.mu.Unlock()
}

// UpdateCheckParams updates the stored check parameters for license verification
func UpdateCheckParams(serverURL, licenseKey, domain, accessDomain, accessProtocol string) {
	checkParams.mu.Lock()
	defer checkParams.mu.Unlock()
	checkParams.serverURL = serverURL
	checkParams.licenseKey = licenseKey
	checkParams.domain = domain
	checkParams.accessDomain = accessDomain
	checkParams.accessProtocol = accessProtocol
}

