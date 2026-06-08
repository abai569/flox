package httpserver

import (
	"net/http"

	"go-backend/internal/http/handler"
	"go-backend/internal/http/middleware"
	"go-backend/internal/store/repo"
)

func NewRouter(h *handler.Handler, jwtSecret string, r *repo.Repository) http.Handler {
	mux := http.NewServeMux()
	h.Register(mux)
	mux.Handle("/system-info", h.WebSocketHandler())

	wrapped := middleware.Recover(mux)
	wrapped = middleware.JWT(middleware.AuthOptions{JWTSecret: jwtSecret})(wrapped)
	wrapped = middleware.LicenseGuard(wrapped)
	wrapped = middleware.TrialGuard(wrapped, r)
	wrapped = middleware.RequestLog(wrapped)
	wrapped = middleware.CORS(wrapped)
	return wrapped
}
