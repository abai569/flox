package handler

import (
	"context"
	"log"
	"time"

	"go-backend/internal/store/repo"
)

func (h *Handler) StartBackgroundJobs() {
	if h == nil || h.repo == nil {
		return
	}

	h.jobsMu.Lock()
	if h.jobsStarted {
		h.jobsMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.jobsCancel = cancel
	h.jobsStarted = true
	h.jobsWG.Add(6)
	h.jobsMu.Unlock()

	go h.runHourlyStatsLoop(ctx)
	go h.runDailyMaintenanceLoop(ctx)
	go h.runNodeRenewalCycleLoop(ctx)
	go h.runMetricsIngestion(ctx)
	go h.runHealthChecks(ctx)
	go h.runTunnelQualityProber(ctx)
}

func (h *Handler) StopBackgroundJobs() {
	if h == nil {
		return
	}

	h.jobsMu.Lock()
	if !h.jobsStarted {
		h.jobsMu.Unlock()
		return
	}
	cancel := h.jobsCancel
	h.jobsCancel = nil
	h.jobsStarted = false
	h.jobsMu.Unlock()

	if cancel != nil {
		cancel()
	}
	h.jobsWG.Wait()
}

func (h *Handler) runMetricsIngestion(ctx context.Context) {
	defer h.jobsWG.Done()
	if h.metrics != nil {
		h.metrics.Start(ctx)
	}
}

func (h *Handler) runHealthChecks(ctx context.Context) {
	defer h.jobsWG.Done()
	if h.healthCheck != nil {
		h.healthCheck.Start(ctx)
	}
}

func (h *Handler) runTunnelQualityProber(ctx context.Context) {
	defer h.jobsWG.Done()
	if h.qualityProber != nil {
		h.qualityProber.Start(ctx)
	}
}

func (h *Handler) runHourlyStatsLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		wait := durationUntilNextHour(time.Now())
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
			h.runStatisticsFlowJob(time.Now())
		}
	}
}

func (h *Handler) runDailyMaintenanceLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		wait := durationUntilNextDailyMaintenance(time.Now())
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
			h.runResetAndExpiryJob(time.Now())
		}
	}
}

func durationUntilNextHour(now time.Time) time.Duration {
	next := now.Truncate(time.Hour).Add(time.Hour)
	return next.Sub(now)
}

func durationUntilNextDailyMaintenance(now time.Time) time.Duration {
	next := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 5, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next.Sub(now)
}

func (h *Handler) runStatisticsFlowJob(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}

	nowMs := now.UnixMilli()
	cutoffMs := nowMs - int64((48*time.Hour)/time.Millisecond)
	_ = h.repo.PurgeOldStatisticsFlows(cutoffMs)

	hourMark := now.Truncate(time.Hour)
	hourText := hourMark.Format("15:04")
	createdTime := hourMark.UnixMilli()

	users, err := h.repo.ListAllUserFlowSnapshots()
	if err != nil {
		return
	}

	for _, user := range users {
		currentTotal := user.InFlow + user.OutFlow
		increment := currentTotal

		lastTotal, err := h.repo.GetLastStatisticsFlowTotal(user.UserID)
		if err == nil && lastTotal.Valid {
			increment = currentTotal - lastTotal.Int64
			if increment < 0 {
				increment = currentTotal
			}
		}

		_ = h.repo.CreateStatisticsFlow(user.UserID, increment, currentTotal, hourText, createdTime)
	}
}

func (h *Handler) runResetAndExpiryJob(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}

	h.resetMonthlyFlow(now)
	h.resetUserQuotaWindows(now)
	h.disableExpiredUsers(now.UnixMilli())
	h.disableExpiredUserTunnels(now.UnixMilli())
	h.disableExpiredForwards(now.UnixMilli())
	h.resetNodeMonthlyTraffic(now)
}

func (h *Handler) resetMonthlyFlow(now time.Time) {
	currentDay := now.Day()
	lastDay := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()

	snapshots, err := h.repo.ResetUserMonthlyFlow(currentDay, lastDay)
	if err == nil && len(snapshots) > 0 {
		periodKey := int64(now.Year()*100 + int(now.Month()))
		nowMs := now.UnixMilli()
		h.repo.RecordFlowResetHistory(snapshots, periodKey, nowMs, "自动周期归零")
	}
	_ = h.repo.ResetUserTunnelMonthlyFlow(currentDay, lastDay)
}

func (h *Handler) resetNodeMonthlyTraffic(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}

	nodes, err := h.repo.ListNodesWithTrafficResetDue(now)
	if err != nil || len(nodes) == 0 {
		return
	}

	actorUserID := int64(1)
	actorUserName := "system"
	nowMs := now.UnixMilli()

	for _, node := range nodes {
		cmdResult, err := h.sendNodeCommandWithTimeout(
			node.ID,
			"ResetTraffic",
			map[string]interface{}{
				"reason": "自动周期归零",
				"nodeId": node.ID,
			},
			10*time.Second,
			false,
			false,
		)

		if err != nil || !cmdResult.Success {
			log.Printf("WARN: auto-reset node %d traffic failed: %v", node.ID, err)
			continue
		}

		_ = h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
			NodeID:        node.ID,
			NodeName:      node.Name,
			ResetTime:     nowMs,
			OperatorID:    actorUserID,
			OperatorName:  actorUserName,
			Reason:        "自动周期归零",
			InFlowBefore:  node.PeriodTx,
			OutFlowBefore: node.PeriodRx,
		})
	}
}

func (h *Handler) disableExpiredUsers(nowMs int64) {
	userIDs, err := h.repo.ListExpiredActiveUserIDs(nowMs)
	if err != nil {
		return
	}

	for _, userID := range userIDs {
		user, err := h.repo.GetUserByID(userID)
		if err != nil {
			continue
		}

		// 检查是否启用自动续费
		if user.AutoRenew == 1 && user.RenewalAmount > 0 {
			// 检查余额是否充足
			if user.Balance >= user.RenewalAmount {
				// 计算续费后的到期时间（+1 个月）
				baseTime := user.ExpTime
				if baseTime < nowMs {
					// 已过期，从当前时间开始计算
					baseTime = nowMs
				}
				newExpTime := time.UnixMilli(baseTime).AddDate(0, 1, 0).UnixMilli()

				// 扣款并续费
				if renewErr := h.repo.RenewUserWithBalance(userID, user.RenewalAmount, newExpTime, nowMs); renewErr == nil {
					log.Printf("用户 %d 自动续费成功：扣款 %d 分，新到期时间 %v",
						userID, user.RenewalAmount, time.UnixMilli(newExpTime))
					continue // 续费成功，跳过禁用
				} else {
					log.Printf("用户 %d 自动续费失败：%v，将执行禁用", userID, renewErr)
				}
			} else {
				log.Printf("用户 %d 余额不足：余额 %d 分，需要 %d 分，将执行禁用",
					userID, user.Balance, user.RenewalAmount)
			}
		}

		// 余额不足或未启用自动续费：执行禁用
		forwards, err := h.listActiveForwardsByUser(userID)
		if err == nil {
			h.pauseForwardRecords(forwards, nowMs)
		}
		_ = h.repo.DisableUser(userID)
	}
}

func (h *Handler) disableExpiredUserTunnels(nowMs int64) {
	items, err := h.repo.ListExpiredActiveUserTunnels(nowMs)
	if err != nil {
		return
	}

	for _, item := range items {
		forwards, err := h.listActiveForwardsByUserTunnel(item.UserID, item.TunnelID)
		if err == nil {
			h.pauseForwardRecords(forwards, nowMs)
		}
		_ = h.repo.DisableUserTunnel(item.ID)
	}
}

// ✅ 新增：禁用已过期的 Forward 规则
func (h *Handler) disableExpiredForwards(nowMs int64) {
	forwards, err := h.repo.ListExpiredActiveForwards(nowMs)
	if err != nil {
		return
	}

	for _, forward := range forwards {
		// 暂停 Forward 规则
		if pauseErr := h.pauseForward(forward.ID, "已到期"); pauseErr != nil {
			log.Printf("ERROR: pauseForward %d failed: %v", forward.ID, pauseErr)
		} else {
			log.Printf("Forward %d paused: expired at %v", forward.ID, time.UnixMilli(forward.ExpiryTime.Int64))
		}
	}
}

func (h *Handler) runNodeRenewalCycleLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		wait := durationUntilNextNodeRenewalCycle(time.Now())
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
			h.runNodeRenewalCycleJob(time.Now())
		}
	}
}

func durationUntilNextNodeRenewalCycle(now time.Time) time.Duration {
	next := now.Truncate(6 * time.Hour).Add(6 * time.Hour)
	return next.Sub(now)
}

func (h *Handler) runNodeRenewalCycleJob(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}

	results, err := h.repo.AdvanceNodeRenewalCycles(now.UnixMilli())
	if err != nil {
		return
	}

	// 归零流量并记录日志
	for _, result := range results {
		// 获取节点当前流量（从实时数据）
		// 由于这里无法直接获取实时流量，传入 0 作为归零前流量
		// Agent 会在 ResetTraffic 命令中上报实际流量
		if err := h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
			NodeID:        result.NodeID,
			NodeName:      result.NodeName,
			ResetTime:     now.UnixMilli(),
			OperatorID:    0, // 系统自动
			OperatorName:  "系统自动",
			Reason:        "自动周期归零",
			InFlowBefore:  0,
			OutFlowBefore: 0,
		}); err != nil {
			// 日志记录失败不影响主流程
			continue
		}

		// 发送归零命令到节点
		_, _ = h.sendNodeCommandWithTimeout(
			result.NodeID,
			"ResetTraffic",
			map[string]interface{}{
				"reason": "自动周期归零",
				"nodeId": result.NodeID,
			},
			10*time.Second,
			false,
			false,
		)
	}
}
