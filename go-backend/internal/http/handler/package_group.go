package handler

import (
	"net/http"

	"go-backend/internal/http/response"
	"go-backend/internal/store/repo"
)

type PackageGroupHandler struct {
	repo *repo.Repository
}

func NewPackageGroupHandler(repo *repo.Repository) *PackageGroupHandler {
	return &PackageGroupHandler{repo: repo}
}

type GroupWithPackageCount struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Color        string `json:"color"`
	Inx          int    `json:"inx"`
	CreatedTime  int64  `json:"createdTime"`
	UpdatedTime  *int64 `json:"updatedTime"`
	PackageCount int64  `json:"packageCount"`
}

func (h *PackageGroupHandler) list(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListPackageGroups()
	if err != nil {
		response.WriteJSON(w, response.Err(-1, err.Error()))
		return
	}

	result := make([]GroupWithPackageCount, 0, len(groups)+1)
	for _, g := range groups {
		count, _ := h.repo.GetPackageGroupCount(g.ID)

		desc := ""
		if g.Description.Valid {
			desc = g.Description.String
		}

		var updatedTime *int64
		if g.UpdatedTime.Valid {
			ut := g.UpdatedTime.Int64
			updatedTime = &ut
		}

		result = append(result, GroupWithPackageCount{
			ID:           g.ID,
			Name:         g.Name,
			Description:  desc,
			Color:        g.Color,
			Inx:          g.Inx,
			CreatedTime:  g.CreatedTime,
			UpdatedTime:  updatedTime,
			PackageCount: count,
		})
	}

	response.WriteJSON(w, response.OK(result))
}

func (h *PackageGroupHandler) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
		Inx         int    `json:"inx"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("分组名称不能为空"))
		return
	}
	if req.Color == "" {
		req.Color = "#3b82f6"
	}

	group, err := h.repo.CreatePackageGroup(req.Name, req.Description, req.Color, req.Inx)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OK(group))
}

func (h *PackageGroupHandler) update(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Color       string `json:"color"`
		Inx         int    `json:"inx"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("分组ID无效"))
		return
	}
	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("分组名称不能为空"))
		return
	}
	if req.Color == "" {
		req.Color = "#3b82f6"
	}

	if err := h.repo.UpdatePackageGroup(req.ID, req.Name, req.Description, req.Color, req.Inx); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *PackageGroupHandler) delete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("分组ID无效"))
		return
	}

	if err := h.repo.DeletePackageGroup(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *PackageGroupHandler) assign(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PackageID *int64 `json:"packageId"`
		GroupID   *int64 `json:"groupId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.PackageID == nil || *req.PackageID <= 0 {
		response.WriteJSON(w, response.ErrDefault("套餐ID无效"))
		return
	}

	if err := h.repo.AssignPackageToGroup(req.PackageID, req.GroupID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}
