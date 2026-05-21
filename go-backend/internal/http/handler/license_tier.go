package handler

import (
	"net/http"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

type ResourceType string

const (
	ResourceNode    ResourceType = "node"
	ResourceTunnel  ResourceType = "tunnel"
	ResourceUser    ResourceType = "user"
	ResourceForward ResourceType = "forward"
)

func (h *Handler) requirePremium(w http.ResponseWriter, resourceType ResourceType, currentCount int) bool {
	err := middleware.CheckResourceLimit(string(resourceType), currentCount)
	if err != nil {
		response.WriteJSON(w, response.Err(403, err.Error()))
		return false
	}
	return true
}
