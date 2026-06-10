package middleware

import (
	"net/http"
	"strings"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/repo"
)

// TrialGuard restricts resource creation in free tier (no premium license).
// Acts as a belt+braces layer alongside handler-level checks.
func TrialGuard(next http.Handler, r *repo.Repository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if r == nil {
			next.ServeHTTP(w, req)
			return
		}

		tier, _ := middleware.GetLicenseTier()
		if tier == middleware.TierPremium {
			next.ServeHTTP(w, req)
			return
		}

		switch req.URL.Path {
		case "/api/v1/node/create":
			if c, _ := r.CountNodes(); c >= 5 {
				response.WriteJSON(w, response.Err(403, "免费版限制：节点最多 5 个，请配置正式授权以解除限制"))
				return
			}
		case "/api/v1/tunnel/create":
			if c, _ := r.CountTunnels(); c >= 5 {
				response.WriteJSON(w, response.Err(403, "免费版限制：隧道最多 5 个，请配置正式授权以解除限制"))
				return
			}
		case "/api/v1/user/create":
			if c, _ := r.CountUsers(); c >= 1 {
				response.WriteJSON(w, response.Err(403, "免费版限制：用户最多 1 个，请配置正式授权以解除限制"))
				return
			}
		}

		// 免费版禁用商城系统
		if strings.HasPrefix(req.URL.Path, "/api/v1/package/") &&
			req.URL.Path != "/api/v1/package/store-status" {
			response.WriteJSON(w, response.Err(403, "免费版不支持商城系统，请配置正式授权以解除限制"))
			return
		}
		if strings.HasPrefix(req.URL.Path, "/api/v1/package-group/") {
			response.WriteJSON(w, response.Err(403, "免费版不支持商城系统，请配置正式授权以解除限制"))
			return
		}

		next.ServeHTTP(w, req)
	})
}
