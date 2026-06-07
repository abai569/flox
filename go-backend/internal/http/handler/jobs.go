package handler

import (
	"context"
	"log"
	"strings"
	"time"

	"go-backend/internal/middleware"
	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
	"go-backend/internal/telegram"
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
	h.jobsWG.Add(12)
	h.jobsMu.Unlock()

	go h.runHourlyStatsLoop(ctx)
	go h.runDailyMaintenanceLoop(ctx)
	go h.runAutoBuyTrafficLoop(ctx)
	go h.runNodeRenewalCycleLoop(ctx)
	go h.runMetricsIngestion(ctx)
	go h.runHealthChecks(ctx)
	go h.runTunnelQualityProber(ctx)
	go h.runNftablesDomainRefreshLoop(ctx)
	go h.runCancelExpiredOrdersLoop(ctx)
	go h.runExpirePackageSubscriptionsLoop(ctx)
	go h.runNodeNotifyCooldownLoop(ctx)
	go h.runTelegramBotLoop(ctx)

	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierFree {
		bot := h.TelegramBot()
		if bot != nil && bot.Enabled() {
			bot.SendSystemStartup(h.fluxVersion)
		}
	}
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
	h.verifyBalances(now)
	h.checkNodeExpiryNotifications(now.UnixMilli())
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

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendNodeTrafficReset(node.Name, "自动周期归零")
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
		resetReason := "到期自动归零"
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
					h.repo.ResetUserFlowByUser(userID, nowMs)
					// 同步 UserTunnel 到期时间、流量归零、状态启用到 newExpTime
					_ = h.repo.DB().Model(&model.UserTunnel{}).Where("user_id = ?", userID).Updates(map[string]interface{}{
						"exp_time": newExpTime,
						"in_flow":  0,
						"out_flow": 0,
						"status":   1,
					}).Error
					// 恢复 Forward 规则（状态更新 + 节点服务恢复）
					_ = h.repo.UpdateUserForwardsStatus(userID, 1, nowMs)
					h.resumePausedForwardsByUser(userID, nowMs)

					h.sendBotNotification(func(bot *telegram.Bot) {
						bot.SendUserFlowReset(user.User)
					})

					continue // 续费成功，跳过禁用
				} else {
					log.Printf("用户 %d 自动续费失败：%v，将执行禁用", userID, renewErr)
					resetReason = "自动续费失败（扣款失败）"
				}
			} else {
				log.Printf("用户 %d 余额不足：余额 %d 分，需要 %d 分，将执行禁用",
					userID, user.Balance, user.RenewalAmount)
				resetReason = "自动续费失败（余额不足）"
			}
		}

		// 余额不足或未启用自动续费：执行禁用 + 归零流量
		forwards, err := h.listActiveForwardsByUser(userID)
		if err == nil {
			h.pauseForwardRecords(forwards, nowMs)
		}

		// 归零用户流量并记录日志
		inFlowBefore := user.InFlow
		outFlowBefore := user.OutFlow
		totalBytes := inFlowBefore + outFlowBefore

		_ = h.repo.DB().Model(&model.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
			"in_flow":      0,
			"out_flow":     0,
			"updated_time": nowMs,
		}).Error

		history := &model.UserQuotaHistory{
			UserID:        userID,
			PeriodType:    "monthly",
			PeriodKey:     int64(time.UnixMilli(nowMs).Year()*100 + int(time.UnixMilli(nowMs).Month())),
			InFlowBefore:  inFlowBefore,
			OutFlowBefore: outFlowBefore,
			UsedBytes:     totalBytes,
			ResetTime:     nowMs,
			CreatedTime:   nowMs,
			ResetReason:   resetReason,
		}
		_ = h.repo.DB().Create(history).Error

		// 归零 UserTunnel 流量（不记录日志）
		_ = h.repo.DB().Model(&model.UserTunnel{}).Where("user_id = ?", userID).Updates(map[string]interface{}{
			"in_flow":  0,
			"out_flow": 0,
		}).Error

		// 禁用用户
		_ = h.repo.DisableUser(userID)

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendUserFlowReset(user.User)
		})
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
			continue
		}
		log.Printf("Forward %d paused: expired at %v", forward.ID, time.UnixMilli(forward.ExpiryTime.Int64))

		// 归零流量 + 记录日志
		inFlowBefore := forward.InFlow
		outFlowBefore := forward.OutFlow
		if resetErr := h.repo.ResetForwardTraffic(forward.ID); resetErr != nil {
			log.Printf("ERROR: reset forward %d traffic failed: %v", forward.ID, resetErr)
			continue
		}
		_ = h.repo.CreateForwardTrafficResetLog(&repo.ForwardTrafficResetLogCreateParams{
			ForwardID:     forward.ID,
			ForwardName:   forward.Name,
			UserID:        forward.UserID,
			UserName:      forward.UserName,
			ResetTime:     nowMs,
			InFlowBefore:  inFlowBefore,
			OutFlowBefore: outFlowBefore,
			OperatorID:    1,
			OperatorName:  "system",
			Reason:        "到期归零",
		})

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendForwardTrafficReset(forward.Name, forward.UserName)
		})
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

	for _, user := range users {
		usedBytes := user.InFlow + user.OutFlow
		totalBytes := user.Flow * 1024 * 1024 * 1024
		// C2: C1: C2: C2: C3: Use user-specific threshold, default 10 GB
		threshold := user.AutoBuyTrafficThreshold
		if threshold <= 0 {
			threshold = 10
		}
		remainingBytes := totalBytes - usedBytes
		if remainingBytes >= threshold*1024*1024*1024 {
			continue
		}

		var price int64
		var amount int64
		if user.AutoBuyTrafficPackageID > 0 {
			pkg, err := h.repo.GetPackageByID(user.AutoBuyTrafficPackageID)
			if err != nil || pkg.Type != "traffic" || pkg.AutoBuyTrafficEnabled != 1 || pkg.Enabled != 1 {
				continue
			}
		// A1: Check and decrement stock
			if err := h.repo.CheckAndDecrementStock(pkg.ID, 1); err != nil {
				log.Printf("用户 %d 自动购流：套餐 %d %s", user.ID, pkg.ID, err.Error())
				// A2: Disable user auto-buy on stock error
				_ = h.repo.UpdateUserAutoBuyTraffic(user.ID, 0)
				// A3: If package stock is now 0, disable all associated users
				if err.Error() == "库存不足" {
					pkgNow, _ := h.repo.GetPackageByID(pkg.ID)
					if pkgNow != nil && pkgNow.Stock == 0 {
						log.Printf("套餐 %d 已售罄，批量停用关联用户自动购流", pkg.ID)
						_ = h.repo.DisableUsersForZeroStockPackage(pkg.ID)
					}
				}
				continue
			}
			price = pkg.Price
			amount = pkg.TrafficLimit
		} else {
			price = user.BuyTrafficPrice
			amount = user.BuyTrafficAmount
		}

		if user.Balance < price {
			log.Printf("用户 %d 自动购流余额不足：余额 %d 分，需要 %d 分",
				user.ID, user.Balance, price)
			continue
		}

		const maxRetries = 3
		purchased := false
		for attempt := 1; attempt <= maxRetries; attempt++ {
			if err := h.repo.BuyTrafficWithBalance(user.ID, price, amount, user.Flow, nowMs); err != nil {
				log.Printf("用户 %d 自动购流失败（第%d/%d次）：%v", user.ID, attempt, maxRetries, err)
				if attempt < maxRetries {
					time.Sleep(1 * time.Second)
					continue
				}
			} else {
				log.Printf("用户 %d 自动购流成功（第%d次尝试）：扣款 %d 分，增加 %d GB",
					user.ID, attempt, price, amount)
				purchased = true
				break
			}
		}
		if !purchased {
			log.Printf("用户 %d 自动购流最终失败（已重试 %d 次）", user.ID, maxRetries)
		}
	}
}

func (h *Handler) runAutoBuyTrafficLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.handleAutoBuyTraffic(time.Now().UnixMilli())
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

func (h *Handler) runNftablesDomainRefreshLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Minute):
			h.runNftablesDomainRefreshJob()
		}
	}
}

func (h *Handler) runNftablesDomainRefreshJob() {
	if h == nil || h.repo == nil {
		return
	}

	forwards, err := h.repo.ListActiveNftablesForwards()
	if err != nil {
		log.Printf("[nftables-dns] 查询活跃 nftables 转发失败: %v", err)
		return
	}
	if len(forwards) == 0 {
		return
	}

	h.nftablesDomainMu.Lock()
	defer h.nftablesDomainMu.Unlock()

	seen := make(map[int64]struct{}, len(forwards))

	for _, f := range forwards {
		seen[f.ID] = struct{}{}

		targets := splitRemoteTargets(f.RemoteAddr)
		resolvedTargets := make([]string, len(targets))
		hasDomain := false
		for i, t := range targets {
			resolved := resolveTargetIP(t)
			resolvedTargets[i] = resolved
			if resolved != t {
				hasDomain = true
			}
		}

		if !hasDomain {
			delete(h.nftablesDomainCache, f.ID)
			continue
		}

		joined := strings.Join(resolvedTargets, ",")
		cached, exists := h.nftablesDomainCache[f.ID]
		if exists && cached == joined {
			continue
		}

		forwardRec, err := h.getForwardRecord(f.ID)
		if err != nil {
			log.Printf("[nftables-dns] getForwardRecord(%d) 失败: %v", f.ID, err)
			continue
		}
		tunnel, err := h.getTunnelRecord(f.TunnelID)
		if err != nil {
			log.Printf("[nftables-dns] getTunnelRecord(%d) 失败: %v", f.TunnelID, err)
			continue
		}
		ports, err := h.listForwardPorts(f.ID)
		if err != nil {
			log.Printf("[nftables-dns] listForwardPorts(%d) 失败: %v", f.ID, err)
			continue
		}
		if len(ports) == 0 {
			continue
		}
		userTunnelID, _, speedLimit, err := h.resolveUserTunnelAndLimiter(f.UserID, f.TunnelID)
		if err != nil {
			log.Printf("[nftables-dns] resolveUserTunnelAndLimiter(%d,%d) 失败: %v", f.UserID, f.TunnelID, err)
			continue
		}

		if err := h.syncNftablesRules(forwardRec, tunnel, ports, userTunnelID, speedLimit); err != nil {
			log.Printf("[nftables-dns] forward %d 更新失败: %v", f.ID, err)
			continue
		}

		h.nftablesDomainCache[f.ID] = joined
		log.Printf("[nftables-dns] forward %d 域名IP已更新: %s", f.ID, joined)
	}

	for fid := range h.nftablesDomainCache {
		if _, ok := seen[fid]; !ok {
			delete(h.nftablesDomainCache, fid)
		}
	}
}

func (h *Handler) runCancelExpiredOrdersLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Minute):
			h.cancelExpiredOrders()
		}
	}
}

func (h *Handler) cancelExpiredOrders() {
	if h == nil || h.repo == nil {
		return
	}

	orders, err := h.repo.ListExpiredPendingOrders(30)
	if err != nil {
		log.Printf("[orders] 查询超时订单失败: %v", err)
		return
	}
	if len(orders) == 0 {
		return
	}

	ids := make([]int64, 0, len(orders))
	for _, o := range orders {
		ids = append(ids, o.ID)
	}

	if err := h.repo.BatchCancelOrders(ids); err != nil {
		log.Printf("[orders] 取消超时订单失败: %v", err)
		return
	}

	log.Printf("[orders] 已取消 %d 个超时未支付订单", len(ids))
}

func (h *Handler) runExpirePackageSubscriptionsLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Minute):
			h.expirePackageSubscriptions()
		}
	}
}

func (h *Handler) expirePackageSubscriptions() {
	if h == nil || h.repo == nil {
		return
	}

	expired, err := h.repo.ListExpiredPackageSubscriptions()
	if err != nil {
		log.Printf("[packages] 查询过期套餐失败: %v", err)
		return
	}
	if len(expired) == 0 {
		return
	}

	for _, sub := range expired {
		if err := h.repo.ExpirePackageSubscription(sub.ID); err != nil {
			log.Printf("[packages] 过期套餐 %d 失败: %v", sub.ID, err)
			continue
		}
		if err := h.repo.ResetUserPackageQuotas(sub.UserID); err != nil {
			log.Printf("[packages] 重置用户 %d 配额失败: %v", sub.UserID, err)
		}
	}

	log.Printf("[packages] 已过期 %d 个套餐订阅", len(expired))
}


// checkNodeExpiryNotifications checks nodes expiring within 3 days and sends Telegram notifications.
// Only notifies once per 24h per node to avoid spam.
func (h *Handler) checkNodeExpiryNotifications(nowMs int64) {
	nodes, err := h.repo.ListNodesExpiringWithin(nowMs, 3)
	if err != nil || len(nodes) == 0 {
		return
	}
	for _, node := range nodes {
		daysLeft := (node.ExpiryTime.Int64 - nowMs) / 86400000
		if daysLeft < 1 {
			daysLeft = 0
		}

		_ = h.repo.UpdateNodeExpiryReminderDismissedUntil(node.ID, nowMs+86400000)

		tier, _ := middleware.GetLicenseTier()
		if tier == middleware.TierFree {
			continue
		}
		bot := h.TelegramBot()
		if bot == nil || !bot.Enabled() || !bot.Running() {
			continue
		}

		if daysLeft <= 0 {
			bot.SendNodeExpired(node.Name)
		} else {
			bot.SendNodeExpirySoon(node.Name, int(daysLeft))
		}
	}
}

func (h *Handler) runNodeNotifyCooldownLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.checkStillOfflineNotifications()
		}
	}
}

func (h *Handler) checkStillOfflineNotifications() {
	notifyStateMu.RLock()
	candidates := make(map[int64]*nodeNotifyState, len(notifyStates))
	for id, state := range notifyStates {
		candidates[id] = state
	}
	notifyStateMu.RUnlock()
	nowMs := time.Now().UnixMilli()
	offlineMinutes := int64(2)
	for nodeID, state := range candidates {
		if state.stillOfflineNotified {
			continue
		}
		if nowMs-state.offlineNotifiedAt < notifyCooldownMs {
			continue
		}
		node, err := h.repo.GetNodeByID(nodeID)
		if err != nil || node == nil {
			continue
		}
		if node.Status == 1 {
			notifyStateMu.Lock()
			delete(notifyStates, nodeID)
			notifyStateMu.Unlock()
			continue
		}
		bot := h.TelegramBot()
		if bot == nil || !bot.Enabled() || !bot.Running() {
			continue
		}
		tier, _ := middleware.GetLicenseTier()
		if tier == middleware.TierFree {
			continue
		}
		elapsedMin := (nowMs - state.offlineSince) / 60000
		if elapsedMin < offlineMinutes {
			elapsedMin = offlineMinutes
		}
		bot.SendNodeStillOffline(node.Name, int(elapsedMin))
		notifyStateMu.Lock()
		if ns := notifyStates[nodeID]; ns != nil {
			ns.stillOfflineNotified = true
		}
		notifyStateMu.Unlock()
	}
}

func (h *Handler) runTelegramBotLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	refreshTicker := time.NewTicker(30 * time.Second)
	defer refreshTicker.Stop()

	readConfig := func() (token, chatID string, enabled bool) {
		cfg, err := h.repo.GetConfigsByNames([]string{"telegram_bot_token", "telegram_chat_id", "telegram_enabled"})
		if err != nil {
			return "", "", false
		}
		return cfg["telegram_bot_token"], cfg["telegram_chat_id"], cfg["telegram_enabled"] == "true"
	}

	token, chatID, enabled := readConfig()
	bot := h.TelegramBot()
	if bot != nil {
		bot.UpdateConfig(token, chatID, enabled)
	}

	tier, _ := middleware.GetLicenseTier()
	if bot != nil && enabled && tier != middleware.TierFree {
		bot.Start(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			if bot != nil {
				bot.Stop()
			}
			return
		case <-refreshTicker.C:
			newToken, newChatID, newEnabled := readConfig()
			if bot == nil {
				continue
			}

			oldToken := bot.Token()
			oldChatID := bot.ChatID()
			oldEnabled := bot.Enabled()

			if newToken != oldToken || newChatID != oldChatID || newEnabled != oldEnabled {
				bot.Stop()
				bot.UpdateConfig(newToken, newChatID, newEnabled)

				tier, _ := middleware.GetLicenseTier()
				if newEnabled && tier != middleware.TierFree {
					bot.Start(ctx)
				}
			}

			tier, _ := middleware.GetLicenseTier()
			if tier == middleware.TierFree && bot.Running() {
				log.Println("[telegram] license downgraded to free, stopping bot")
				bot.Stop()
			} else if tier != middleware.TierFree && bot.Enabled() && !bot.Running() {
				log.Println("[telegram] license upgraded, starting bot")
				bot.Start(ctx)
			}
		}
	}
}
