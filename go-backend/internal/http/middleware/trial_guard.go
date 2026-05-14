package middleware

import (
	"net/http"
	"os"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
)

// TrialGuard restricts resource creation in trial mode (no license configured).
// Limits: nodes <= 5, tunnels <= 5, users <= 1 (admin excluded).
func TrialGuard(next http.Handler, r *repo.Repository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if r == nil {
			next.ServeHTTP(w, req)
			return
		}

		if isTrialMode(r) {
			switch req.URL.Path {
			case "/api/v1/node/create":
				if getNodeCount(r) >= 5 {
					response.WriteJSON(w, response.Err(403, "体验模式限制：节点最多 5 个，请配置授权码以解除限制"))
					return
				}
			case "/api/v1/tunnel/create":
				if getTunnelCount(r) >= 5 {
					response.WriteJSON(w, response.Err(403, "体验模式限制：隧道最多 5 个，请配置授权码以解除限制"))
					return
				}
			case "/api/v1/user/create":
				if getUserCount(r) >= 1 {
					response.WriteJSON(w, response.Err(403, "体验模式限制：用户最多 1 个，请配置授权码以解除限制"))
					return
				}
			}
		}

		next.ServeHTTP(w, req)
	})
}

func isTrialMode(r *repo.Repository) bool {
	licenseKey := os.Getenv("LICENSE_KEY")
	if licenseKey != "" {
		return false
	}
	cfg, _ := r.GetConfigByName("license_key")
	if cfg != nil && cfg.Value != "" {
		return false
	}
	return true
}

func getNodeCount(r *repo.Repository) int64 {
	var count int64
	r.DB().Table("node").Count(&count)
	return count
}

func getTunnelCount(r *repo.Repository) int64 {
	var count int64
	r.DB().Table("tunnel").Count(&count)
	return count
}

func getUserCount(r *repo.Repository) int64 {
	var count int64
	r.DB().Table("user").Where("role_id != ?", 0).Count(&count)
	return count
}
