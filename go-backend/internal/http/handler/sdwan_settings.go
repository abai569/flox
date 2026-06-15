package handler

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

func (h *Handler) getSDWANNetworkCIDR() string {
	if h != nil && h.repo != nil {
		if cfg, _ := h.repo.GetConfigByName(sdwanNetworkCIDRConfigName); cfg != nil {
			if s := strings.TrimSpace(cfg.Value); s != "" {
				return s
			}
		}
	}
	return sdwanDefaultCIDR
}

func (h *Handler) getSDWANAutoReconcileEnabled() bool {
	if h != nil && h.repo != nil {
		if cfg, _ := h.repo.GetConfigByName(sdwanAutoReconcileConfigName); cfg != nil {
			v := strings.ToLower(strings.TrimSpace(cfg.Value))
			if v == "false" || v == "0" || v == "no" {
				return false
			}
		}
	}
	return true
}

func (h *Handler) getSDWANReconcileInterval() time.Duration {
	if h != nil && h.repo != nil {
		if cfg, _ := h.repo.GetConfigByName(sdwanReconcileIntervalConfigName); cfg != nil {
			if sec := asInt(cfg.Value, 0); sec > 0 {
				return time.Duration(sec) * time.Second
			}
		}
	}
	return 30 * time.Second
}

func (h *Handler) sdwanSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	response.WriteJSON(w, response.OK(map[string]any{
		"networkCIDR":          h.getSDWANNetworkCIDR(),
		"autoReconcileEnabled": h.getSDWANAutoReconcileEnabled(),
		"reconcileIntervalSec": int(h.getSDWANReconcileInterval() / time.Second),
	}))
}

func (h *Handler) sdwanSaveSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierPremium {
		response.WriteJSON(w, response.Err(403, "SDWAN 组网管理仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可修改 SDWAN 设置"))
		return
	}
	var req struct {
		NetworkCIDR          string `json:"networkCIDR"`
		AutoReconcileEnabled bool   `json:"autoReconcileEnabled"`
		ReconcileIntervalSec int    `json:"reconcileIntervalSec"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	req.NetworkCIDR = strings.TrimSpace(req.NetworkCIDR)
	if req.NetworkCIDR == "" {
		req.NetworkCIDR = sdwanDefaultCIDR
	}
	if _, _, err := net.ParseCIDR(req.NetworkCIDR); err != nil {
		response.WriteJSON(w, response.ErrDefault("SDWAN 网段格式无效"))
		return
	}
	if req.ReconcileIntervalSec <= 0 {
		req.ReconcileIntervalSec = 30
	}
	currentCIDR := h.getSDWANNetworkCIDR()
	if currentCIDR != req.NetworkCIDR {
		if cfg, _ := h.repo.GetConfigByName(sdwanCACertConfigName); cfg != nil && strings.TrimSpace(cfg.Value) != "" {
			response.WriteJSON(w, response.ErrDefault("已存在 SDWAN CA，暂不允许直接修改网段，请先轮换 CA"))
			return
		}
	}
	now := time.Now().UnixMilli()
	if err := h.repo.UpsertConfig(sdwanNetworkCIDRConfigName, req.NetworkCIDR, now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.repo.UpsertConfig(sdwanAutoReconcileConfigName, fmt.Sprintf("%t", req.AutoReconcileEnabled), now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if err := h.repo.UpsertConfig(sdwanReconcileIntervalConfigName, fmt.Sprintf("%d", req.ReconcileIntervalSec), now); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	response.WriteJSON(w, response.OKEmpty())
}
