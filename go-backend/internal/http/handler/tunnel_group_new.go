package handler

import (
	"net/http"
	"time"

	"go-backend/internal/http/response"
)

func (h *Handler) tunnelGroupNewList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	groups, err := h.repo.ListTunnelGroupsNew()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	// Build response with tunnel count
	type GroupWithCount struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
		Inx         int    `json:"inx"`
		Status      int    `json:"status"`
		CreatedTime int64  `json:"createdTime"`
		UpdatedTime int64  `json:"updatedTime"`
		TunnelCount int64  `json:"tunnelCount"`
	}

	result := make([]GroupWithCount, 0, len(groups))
	for _, g := range groups {
		count, _ := h.repo.ListTunnelIDsByTunnelGroup(g.ID)
		result = append(result, GroupWithCount{
			ID:          g.ID,
			Name:        g.Name,
			Color:       g.Color,
			Description: g.Description,
			Inx:         g.Inx,
			Status:      g.Status,
			CreatedTime: g.CreatedTime,
			UpdatedTime: g.UpdatedTime,
			TunnelCount: int64(len(count)),
		})
	}

	response.WriteJSON(w, response.OK(result))
}

func (h *Handler) tunnelGroupNewCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
		Inx         int    `json:"inx"`
		Status      int    `json:"status"`
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

	now := time.Now().UnixMilli()
	group, err := h.repo.CreateTunnelGroupNew(req.Name, req.Color, req.Description, req.Inx, req.Status, now)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	type GroupResp struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
		Inx         int    `json:"inx"`
		Status      int    `json:"status"`
		CreatedTime int64  `json:"createdTime"`
		UpdatedTime int64  `json:"updatedTime"`
	}

	response.WriteJSON(w, response.OK(GroupResp{
		ID:          group.ID,
		Name:        group.Name,
		Color:       group.Color,
		Description: group.Description,
		Inx:         group.Inx,
		Status:      group.Status,
		CreatedTime: group.CreatedTime,
		UpdatedTime: group.UpdatedTime,
	}))
}

func (h *Handler) tunnelGroupNewUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		ID          int64  `json:"id"`
		Name        string `json:"name"`
		Color       string `json:"color"`
		Description string `json:"description"`
		Inx         int    `json:"inx"`
		Status      int    `json:"status"`
	}

	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("分组 ID 无效"))
		return
	}

	if req.Name == "" {
		response.WriteJSON(w, response.ErrDefault("分组名称不能为空"))
		return
	}

	if req.Color == "" {
		req.Color = "#3b82f6"
	}

	now := time.Now().UnixMilli()
	if err := h.repo.UpdateTunnelGroupNew(req.ID, req.Name, req.Color, req.Description, req.Inx, req.Status, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) tunnelGroupNewDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}

	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("分组 ID 无效"))
		return
	}

	if err := h.repo.DeleteTunnelGroupNew(req.ID); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) tunnelGroupNewAssign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		GroupId   int64   `json:"groupId"`
		TunnelIds []int64 `json:"tunnelIds"`
	}

	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.GroupId <= 0 {
		response.WriteJSON(w, response.ErrDefault("分组 ID 无效"))
		return
	}

	// 批量更新隧道的分组 - 直接传递所有隧道 ID 和分组 ID
	// 允许传空数组来清空分组
	if err := h.repo.AssignTunnelsToGroupNew(req.TunnelIds, req.GroupId); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}

func (h *Handler) tunnelGroupAssignSingle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		TunnelId int64   `json:"tunnelId"`
		GroupIds []int64 `json:"groupIds"`
	}

	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	if req.TunnelId <= 0 {
		response.WriteJSON(w, response.ErrDefault("隧道 ID 无效"))
		return
	}

	if err := h.repo.AssignTunnelToGroupNew(req.TunnelId, req.GroupIds); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	response.WriteJSON(w, response.OKEmpty())
}
