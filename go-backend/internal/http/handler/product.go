package handler

import (
	"net/http"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
)

func (h *Handler) listProducts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "用户信息错误"))
		return
	}

	onlyActive := roleID != 0
	items, err := h.repo.ListProducts(onlyActive)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if items == nil {
		items = []*model.Product{}
	}
	response.WriteJSON(w, response.OK(items))
}

func (h *Handler) createProduct(w http.ResponseWriter, r *http.Request) {
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}

	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	name := asString(req["name"])
	if name == "" {
		response.WriteJSON(w, response.ErrDefault("商品名称不能为空"))
		return
	}

	product, err := h.repo.CreateProduct(
		name,
		asString(req["description"]),
		asString(req["type"]),
		asInt64(req["price"], 0),
		asInt64(req["value"], 0),
		asInt(req["sort_order"], 0),
		asInt(req["status"], 1),
	)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(product))
}

func (h *Handler) updateProduct(w http.ResponseWriter, r *http.Request) {
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}

	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	id := asInt64(req["id"], 0)
	if id <= 0 {
		response.WriteJSON(w, response.ErrDefault("商品ID不能为空"))
		return
	}

	name := asString(req["name"])
	if name == "" {
		response.WriteJSON(w, response.ErrDefault("商品名称不能为空"))
		return
	}

	if err := h.repo.UpdateProduct(
		id, name, asString(req["description"]),
		asInt64(req["price"], 0), asInt64(req["value"], 0),
		asInt(req["sort_order"], 0), asInt(req["status"], 1),
	); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) deleteProduct(w http.ResponseWriter, r *http.Request) {
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}

	id := idFromBody(r, w)
	if id <= 0 {
		return
	}

	if err := h.repo.DeleteProduct(id); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) updateProductOrder(w http.ResponseWriter, r *http.Request) {
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}

	var req map[string]interface{}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	ids := asInt64Slice(req["ids"])
	if len(ids) == 0 {
		response.WriteJSON(w, response.ErrDefault("排序数据不能为空"))
		return
	}

	if err := h.repo.UpdateProductOrder(ids); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}
