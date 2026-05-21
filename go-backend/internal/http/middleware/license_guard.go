package middleware

import (
	"net/http"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

// LicenseGuard middleware blocks all access if license is TierBlocked.
// TierFree and TierPremium flow through to handler-level enforcement.
func LicenseGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Whitelist license check endpoints so the panel can refresh status
		if r.URL.Path == "/api/v1/license/info" || r.URL.Path == "/api/v1/license/config" {
			next.ServeHTTP(w, r)
			return
		}

		tier, reason := middleware.GetLicenseTier()
		if tier == middleware.TierBlocked {
			response.WriteJSON(w, response.Err(403, "访问被拒绝：授权无效 ("+reason+")"))
			return
		}

		next.ServeHTTP(w, r)
	})
}
