package handler

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

func (h *Handler) licenseTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		NewDomain string `json:"new_domain"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.NewDomain == "" {
		response.WriteJSON(w, response.ErrDefault("新域名不能为空"))
		return
	}

	licenseKey := os.Getenv("LICENSE_KEY")
	if licenseKey == "" {
		cfg, _ := h.repo.GetConfigByName("license_key")
		if cfg != nil {
			licenseKey = cfg.Value
		}
	}
	if licenseKey == "" {
		response.WriteJSON(w, response.ErrDefault("请先配置授权"))
		return
	}

	lsURL := os.Getenv("LICENSE_SERVER_URL")
	if lsURL == "" {
		lsURL = "https://sq.abai.eu.org"
	}

	trialPayload, _ := json.Marshal(map[string]string{
		"license_key": licenseKey,
		"new_domain":  req.NewDomain,
	})

	resp, err := http.Post(lsURL+"/api/transfer", "application/json", bytes.NewReader(trialPayload))
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("转让请求失败: "+err.Error()))
		return
	}
	defer resp.Body.Close()

	var transferResult struct {
		LicenseKey string `json:"license_key"`
		OldDomain  string `json:"old_domain"`
		NewDomain  string `json:"new_domain"`
		ExpireTime int64  `json:"expire_time"`
		Error      string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&transferResult); err != nil {
		response.WriteJSON(w, response.ErrDefault("解析响应失败"))
		return
	}

	if transferResult.Error != "" {
		response.WriteJSON(w, response.ErrDefault(transferResult.Error))
		return
	}

	log.Printf("✅ 转让成功: %s -> %s", transferResult.OldDomain, transferResult.NewDomain)

	// 转让成功后，不自动修改当前面板的本地域名配置。
	// 面板将继续使用旧域名进行验证，因域名不匹配自动失效。
	// (原代码会强制改为新域名，导致面板误以为转让成功，未失效)
	/*
	now := time.Now().UnixMilli()
	h.repo.UpsertConfig("server_domain", req.NewDomain, now)
	middleware.UpdateCheckParams(lsURL, licenseKey, req.NewDomain)
	*/

	go middleware.TriggerAsyncCheck() // 立即触发验证，让面板尽快检测到失效

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"old_domain": transferResult.OldDomain,
		"new_domain": req.NewDomain,
	}))
}
