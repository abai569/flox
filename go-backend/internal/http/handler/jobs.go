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
	h.handleAutoBuyTraffic(now.UnixMilli())
	h.disableExpiredUserTunnels(now.UnixMilli())
	h.disableExpiredForwards(now.UnixMilli())
	h.resetNodeMonthlyTraffic(now)
	h.verifyBalances(now)
}

func (h *Handler) verifyBalances(now time.Time) {
	mismatches, err := h.repo.VerifyAllBalances()
	if err != nil {
		log.Printf("[余额校验] 校验失败: %v", err)
		return
	}
	if len(mismatches) > 0 {
		log.Printf("[余额校验] 发现 %d 个用户余额不匹配（共 %d 个用户）", len(mismatches), len(mismatches))
		for _, m := range mismatches {
			log.Printf("[余额校验] 不匹配详情: %+v", m)
		}
	}

	invalidSigs, err := h.repo.VerifyBalanceSignatures()
	if err != nil {
		log.Printf("[余额签名校验] 校验失败: %v", err)
		return
	}
	if len(invalidSigs) > 0 {
		log.Printf("[余额签名校验] 发现 %d 条无效签名的记录", len(invalidSigs))
		for _, entry := range invalidSigs {
			log.Printf("[余额签名校验] 无效签名 ID=%d UserID=%d Amount=%d", entry.ID, entry.UserID, entry.Amount)
		}
	}
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
					// 续费成功后重置流量配额为初始值
					if user.BaseFlow > 0 && user.Flow != user.BaseFlow {
						_ = h.repo.ResetUserFlowToBase(userID, user.BaseFlow, nowMs)
					}
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

func (h *Handler) handleAutoBuyTraffic(nowMs int64) {
	if h == nil || h.repo == nil {
		return
	}

	users, err := h.repo.ListAutoBuyTrafficCandidates(nowMs)
	if err != nil {
		return
	}

	const triggerRemainingGB int64 = 10
	triggerBytes := triggerRemainingGB * 1024 * 1024 * 1024

	for _, user := range users {
		usedBytes := user.InFlow + user.OutFlow
		totalBytes := user.Flow * 1024 * 1024 * 1024
		remainingBytes := totalBytes - usedBytes

		if remainingBytes >= triggerBytes {
			continue
		}
		if user.Balance < user.BuyTrafficPrice {
			log.Printf("用户 %d 自动购买流量余额不足：余额 %d 分，需要 %d 分",
				user.ID, user.Balance, user.BuyTrafficPrice)
			continue
		}

		if err := h.repo.BuyTrafficWithBalance(user.ID, user.BuyTrafficPrice, user.BuyTrafficAmount, user.Flow, nowMs); err != nil {
			log.Printf("用户 %d 自动购买流量失败：%v", user.ID, err)
		} else {
			log.Printf("用户 %d 自动购买流量成功：扣款 %d 分，增加 %d GB",
				user.ID, user.BuyTrafficPrice, user.BuyTrafficAmount)
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

	_, err := h.repo.AdvanceNodeRenewalCycles(now.UnixMilli())
	if err != nil {
		return
	}
}
