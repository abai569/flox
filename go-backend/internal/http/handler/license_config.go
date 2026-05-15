package handler

import (
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
		LicenseKey string `json:"license_key"`
		Domain     string `json:"domain"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	licenseKey := req.LicenseKey != ""
	domain := req.Domain != ""

	if !licenseKey {
		response.WriteJSON(w, response.ErrDefault("授权码不能为空"))
		return
	}

	if !domain {
		response.WriteJSON(w, response.ErrDefault("面板域名不能为空"))
		return
	}

	now := time.Now().UnixMilli()

	if err := h.repo.UpsertConfig("license_key", req.LicenseKey, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.repo.UpsertConfig("server_domain", req.Domain, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	const defaultLicenseServerURL = "https://sq.abai.eu.org"
	if os.Getenv("LICENSE_SERVER_URL") == "" {
		middleware.UpdateCheckParams(defaultLicenseServerURL, req.LicenseKey, req.Domain)
		go middleware.TriggerAsyncCheck()
	} else {
		middleware.UpdateCheckParams(os.Getenv("LICENSE_SERVER_URL"), req.LicenseKey, req.Domain)
		go middleware.TriggerAsyncCheck()
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"triggered_check": true,
	}))
}
