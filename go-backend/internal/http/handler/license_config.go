package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

func (h *Handler) licenseConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		LicenseKey     string `json:"license_key"`
		Domain         string `json:"domain"`
		HmacKey        string `json:"hmac_key"`
		ActualDomain   string `json:"actual_domain"`
		ActualProtocol string `json:"actual_protocol"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.Domain == "" {
		response.WriteJSON(w, response.ErrDefault("面板域名不能为空"))
		return
	}

	// 校验：实际访问域名必须与填写域名一致（无论 HTTP/HTTPS）
	if req.ActualDomain != req.Domain {
		response.WriteJSON(w, response.ErrDefault("实际访问域名与填写域名不一致"))
		return
	}

	// 非 HTTPS 访问记录警告，但不阻断（域名校验已确保访问域名与填写的域名一致）
	if req.ActualProtocol != "https:" {
		log.Println("⚠️ 授权配置通过 HTTP 保存，建议配置 HTTPS 访问面板")
	}

	const defaultLicenseServerURL = "https://sq.abai.eu.org"
	url := defaultLicenseServerURL
	if os.Getenv("LICENSE_SERVER_URL") != "" {
		url = os.Getenv("LICENSE_SERVER_URL")
	}

	now := time.Now().UnixMilli()

	// 授权码为空时自动生成7天体验授权
	actualLicenseKey := req.LicenseKey
	if actualLicenseKey == "" {
		// 优先检查本地是否已有授权，避免重复生成
		existingDomainCfg, _ := h.repo.GetConfigByName("server_domain")
		existingKeyCfg, _ := h.repo.GetConfigByName("license_key")

		if existingDomainCfg != nil && existingDomainCfg.Value == req.Domain {
			if existingKeyCfg != nil && existingKeyCfg.Value != "" {
				// 修复：检查本地旧 Key 是否还有效
				if !isLicenseKeyValid(url, existingKeyCfg.Value, req.Domain) {
					log.Println("⚠️ 本地缓存的授权已失效，将申请新体验授权")
				} else {
					actualLicenseKey = existingKeyCfg.Value
				}
			}
		}

		// 如果没有本地缓存的授权（或已失效），则向远程请求体验授权
		if actualLicenseKey == "" {
			trialKey, err := requestTrialLicense(url, req.Domain)
			if err != nil {
				response.WriteJSON(w, response.ErrDefault("获取体验授权失败: "+err.Error()))
				return
			}
			actualLicenseKey = trialKey
		}
	}

	if err := h.repo.UpsertConfig("license_key", actualLicenseKey, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.repo.UpsertConfig("server_domain", req.Domain, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	if err := h.repo.UpsertConfig("license_server_url", url, now); err != nil {
		log.Printf("⚠️ sync config license_server_url failed: %v", err)
	}

	// 保存 HMAC 密钥（允许清空）
	if err := h.repo.UpsertConfig("hmac_key", req.HmacKey, now); err != nil {
		log.Printf("⚠️ sync config hmac_key failed: %v", err)
	}

	middleware.UpdateCheckParams(url, actualLicenseKey, req.Domain, req.ActualDomain, req.ActualProtocol)
	go middleware.TriggerAsyncCheck()

	go func() {
		if err := UpdateEnvFile(actualLicenseKey, req.Domain, url, req.HmacKey); err != nil {
			log.Printf("⚠️ failed to write .env persistence: %v", err)
		}
	}()

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"triggered_check": true,
	}))
}

// isLicenseKeyValid checks if a license key is still valid by calling the verify API.
func isLicenseKeyValid(serverURL, licenseKey, domain string) bool {
	body, _ := json.Marshal(map[string]string{
		"license_key": licenseKey,
		"domain":      domain,
	})
	resp, err := http.Post(serverURL+"/api/verify", "application/json", bytes.NewReader(body))
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	var result struct {
		Valid bool `json:"valid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false
	}
	return result.Valid
}

func requestTrialLicense(serverURL, domain string) (string, error) {
	body, _ := json.Marshal(map[string]string{"domain": domain})
	resp, err := http.Post(serverURL+"/api/trial", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		LicenseKey string `json:"license_key"`
		Error      string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Error != "" {
		return "", fmt.Errorf(result.Error)
	}
	return result.LicenseKey, nil
}
