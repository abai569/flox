package handler

import (
	"net/http"
	"os"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

// licenseInfo returns the current license state
// This endpoint is called on page load/refresh
// It always triggers a background check to ensure status is up-to-date
func (h *Handler) licenseInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	valid, expireTime, reason := middleware.GetLicenseState()

	// Always trigger background check on page refresh to get latest status
	// We use synchronous check here to ensure the state is updated *before* the handler returns.
	// This prevents a race condition where the user sees "Valid" but the LicenseGuard still thinks it's "Invalid"
	// immediately after a refresh.
	middleware.ForceSyncCheck()

	// Check if license is configured
	// 1. Prioritize Environment Variables (used by StartLicenseVerification)
	serverUrl := os.Getenv("LICENSE_SERVER_URL")
	licenseKey := os.Getenv("LICENSE_KEY")
	
	configured := serverUrl != "" || licenseKey != ""

	// 2. Fallback to DB if not in ENV
	if !configured {
		cfg1, _ := h.repo.GetConfigByName("license_server_url")
		cfg2, _ := h.repo.GetConfigByName("license_key")
		configured = cfg1 != nil || cfg2 != nil
	}

	hasLicenseKey := licenseKey != ""
	actualLicenseKey := licenseKey

	if !hasLicenseKey {
		cfg, _ := h.repo.GetConfigByName("license_key")
		if cfg != nil {
			hasLicenseKey = cfg.Value != ""
			actualLicenseKey = cfg.Value
		}
	}

	domain := os.Getenv("SERVER_DOMAIN")
	if domain == "" {
		cfg, _ := h.repo.GetConfigByName("server_domain")
		if cfg != nil {
			domain = cfg.Value
		}
	}

	tier, _ := middleware.GetLicenseTier()

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"valid":           valid,
		"expire_time":     expireTime,
		"reason":          reason,
		"configured":      configured,
		"has_license_key": hasLicenseKey,
		"license_key":     actualLicenseKey,
		"domain":          domain,
		"tier":            string(tier),
	}))
}
