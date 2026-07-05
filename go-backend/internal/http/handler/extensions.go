package handler

import "net/http"

type routeExtensionRegistrar func(mux *http.ServeMux, h *Handler)

var routeExtensionRegistrars []routeExtensionRegistrar

func registerRouteExtension(registrar routeExtensionRegistrar) {
	if registrar == nil {
		return
	}
	routeExtensionRegistrars = append(routeExtensionRegistrars, registrar)
}

func (h *Handler) registerRouteExtensions(mux *http.ServeMux) {
	for _, registrar := range routeExtensionRegistrars {
		registrar(mux, h)
	}
}
