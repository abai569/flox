package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go-backend/internal/http/response"
)

func (h *Handler) nodeWeightUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	_, roleID, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "未登录或 token 已过期"))
		return
	}
	if roleID != 0 {
		response.WriteJSON(w, response.Err(403, "权限不足，仅管理员可操作"))
		return
	}

	var req struct {
		NodeID           int64       `json:"nodeId"`
		InstanceID       string      `json:"instanceId"`
		DisplayName      string      `json:"displayName"`
		Remark           string      `json:"remark"`
		Weight           int         `json:"weight"`
		PortRange        string      `json:"portRange"`
		ExpiryTime       interface{} `json:"expiryTime"`
		RenewalCycle     interface{} `json:"renewalCycle"`
		FlowResetTime    int         `json:"flowResetTime"`
		TrafficLimit     int64       `json:"trafficLimit"`
		TrafficLimitMode *int        `json:"trafficLimitMode"`
		TrafficRatio     *float64    `json:"trafficRatio"`
		InFlowAdjust     int64       `json:"inFlowAdjust"`
		OutFlowAdjust    int64       `json:"outFlowAdjust"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.NodeID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点 ID 不能为空"))
		return
	}
	if req.Weight < 0 || req.Weight > 10 {
		response.WriteJSON(w, response.ErrDefault("权重必须在 0-10 之间，0 表示禁用承载"))
		return
	}
	node, err := h.getNodeRecord(req.NodeID)
	if err != nil {
		response.WriteJSON(w, response.ErrDefault(err.Error()))
		return
	}

	instanceID := strings.TrimSpace(req.InstanceID)
	portRange := strings.TrimSpace(req.PortRange)
	trafficLimitMode := 1
	if req.TrafficLimitMode != nil {
		trafficLimitMode = *req.TrafficLimitMode
		if trafficLimitMode < 0 || trafficLimitMode > 1 {
			response.WriteJSON(w, response.ErrDefault("流量累计模式必须为 0 或 1"))
			return
		}
	}

	if instanceID != "" {
		if req.TrafficRatio != nil {
			if node.IsRemote == 1 {
				response.WriteJSON(w, response.ErrDefault("远程节点实例倍率由分享方控制"))
				return
			}
			response.WriteJSON(w, response.ErrDefault("仅分享方可设置实例独立倍率"))
			return
		}
		if err := validateNodeWeightInstancePortRange(portRange); err != nil {
			response.WriteJSON(w, response.ErrDefault(err.Error()))
			return
		}
		if len([]rune(strings.TrimSpace(req.DisplayName))) > 100 {
			response.WriteJSON(w, response.ErrDefault("实例名称不能超过 100 个字符"))
			return
		}
		if len([]rune(strings.TrimSpace(req.Remark))) > 200 {
			response.WriteJSON(w, response.ErrDefault("实例备注不能超过 200 个字符"))
			return
		}
		renewalCycle := normalizeNodeRenewalCycle(asString(req.RenewalCycle))
		expiryTime := asInt64(req.ExpiryTime, 0)
		if (renewalCycle != "" && expiryTime <= 0) || (renewalCycle == "" && expiryTime > 0) {
			response.WriteJSON(w, response.ErrDefault("请同时设置续费周期和到期时间"))
			return
		}
		flowResetTime := req.FlowResetTime
		if flowResetTime < 0 || flowResetTime > 31 {
			response.WriteJSON(w, response.ErrDefault("流量归零日必须在 0-31 之间，0 表示不归零"))
			return
		}
		if req.TrafficLimit < 0 {
			response.WriteJSON(w, response.ErrDefault("流量限额不能小于 0"))
			return
		}
		var expiryInput interface{}
		if expiryTime > 0 {
			expiryInput = expiryTime
		}
		if err := h.repo.UpdateNodeInstanceProfile(req.NodeID, instanceID, req.DisplayName, req.Remark, req.Weight, portRange, expiryInput, renewalCycle, flowResetTime, req.TrafficLimit, trafficLimitMode, req.TrafficRatio, time.Now().UnixMilli()); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}

		// 处理流量矫正
		if req.InFlowAdjust != 0 || req.OutFlowAdjust != 0 {
			if err := h.repo.AdjustNodeInstanceTraffic(req.NodeID, instanceID, req.InFlowAdjust, req.OutFlowAdjust); err != nil {
				log.Printf("WARN: adjust node %d instance %s traffic failed: %v", req.NodeID, instanceID, err)
			}
		}

		h.deleteNodeInstanceTrafficCacheEntry(req.NodeID, instanceID)
	} else {
		if err := h.repo.UpdateNodeWeight(req.NodeID, req.Weight, time.Now().UnixMilli()); err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	}

	go h.redeployNodeRuntime(req.NodeID)
	response.WriteJSON(w, response.OK(map[string]interface{}{
		"nodeId":           req.NodeID,
		"instanceId":       instanceID,
		"displayName":      strings.TrimSpace(req.DisplayName),
		"remark":           strings.TrimSpace(req.Remark),
		"weight":           req.Weight,
		"portRange":        portRange,
		"expiryTime":       asInt64(req.ExpiryTime, 0),
		"renewalCycle":     normalizeNodeRenewalCycle(asString(req.RenewalCycle)),
		"flowResetTime":    req.FlowResetTime,
		"trafficLimit":     req.TrafficLimit,
		"trafficLimitMode": trafficLimitMode,
		"trafficRatio":     req.TrafficRatio,
	}))
}

func validateNodeWeightInstancePortRange(value string) error {
	if value == "" {
		return nil
	}
	for _, part := range strings.Split(value, ",") {
		item := strings.TrimSpace(part)
		if item == "" {
			return errors.New("端口范围格式错误")
		}
		if strings.Contains(item, "-") {
			pieces := strings.Split(item, "-")
			if len(pieces) != 2 {
				return errors.New("端口范围格式错误")
			}
			start, err1 := strconv.Atoi(strings.TrimSpace(pieces[0]))
			end, err2 := strconv.Atoi(strings.TrimSpace(pieces[1]))
			if err1 != nil || err2 != nil || start < 1 || end > 65535 || start >= end {
				return errors.New("端口范围必须在 1-65535 之间，且起始端口小于结束端口")
			}
			continue
		}
		port, err := strconv.Atoi(item)
		if err != nil || port < 1 || port > 65535 {
			return errors.New("端口必须在 1-65535 之间")
		}
	}
	return nil
}
