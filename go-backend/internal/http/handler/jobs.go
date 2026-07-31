package handler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"go-backend/internal/http/client"
	"go-backend/internal/middleware"
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
	jobs := []func(context.Context){
		h.runHourlyStatsLoop,
		h.runDailyMaintenanceLoop,
		h.runAutoRenewLoop,
		h.runAutoBuyTrafficLoop,
		h.runNodeRenewalCycleLoop,
		h.runMetricsIngestion,
		h.runHealthChecks,
		h.runTunnelQualityProber,
		h.runBestExitLoop,
		h.runNftablesDomainRefreshLoop,
		h.runCancelExpiredOrdersLoop,
		h.runExpirePackageSubscriptionsLoop,
		h.runNodeNotifyCooldownLoop,
		h.runTelegramBotLoop,
		h.runSDWANReconcileLoop,
		h.runDNSFailoverLoop,
		h.runPeerShareExpiryLoop,
		h.runRemoteShareEventManager,
		h.runFederationTunnelReleaseRetryLoop,
		h.runAuthoritativeFlowResendLoop,
		h.runFlowRelayOutboxLoop,
		h.runCrossBorderLoop,
	}
	h.jobsCancel = cancel
	h.jobsStarted = true
	h.jobsWG.Add(len(jobs))
	h.jobsMu.Unlock()

	for _, job := range jobs {
		go job(ctx)
	}

	tier, _ := middleware.GetLicenseTier()
	if tier != middleware.TierFree {
		bot := h.TelegramBot()
		if bot != nil && bot.Enabled() {
			bot.SendSystemStartup(h.floxVersion)
		}
	}
}

func (h *Handler) runFlowRelayOutboxLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	lastCleanup := time.Time{}
	process := func() {
		now := time.Now()
		items, err := h.repo.ListDueFlowRelayOutbox(now.UnixMilli(), 100)
		if err != nil {
			log.Printf("list due flow relay outbox failed: %v", err)
		} else {
			for i := range items {
				h.tryFlowRelayOutbox(items[i].EventID)
			}
		}
		if lastCleanup.IsZero() || now.Sub(lastCleanup) >= time.Hour {
			if _, err := h.repo.DeleteFlowReportItemsBefore(now.Add(-7 * 24 * time.Hour).UnixMilli()); err != nil {
				log.Printf("cleanup flow report items failed: %v", err)
			}
			lastCleanup = now
		}
	}
	process()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			process()
		}
	}
}

func (h *Handler) runAuthoritativeFlowResendLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	resend := func() {
		snapshots, err := h.repo.ListRemoteAuthoritativeNodeFlowSnapshots()
		if err != nil {
			log.Printf("list authoritative flow snapshots failed: %v", err)
			return
		}
		for _, snapshot := range snapshots {
			if snapshot.RemoteURL == "" || snapshot.RemoteToken == "" {
				continue
			}
			if err := h.reportAuthoritativeNodeFlowSnapshot(snapshot, snapshot.TotalInFlow, snapshot.TotalOutFlow); err != nil {
				log.Printf("resend authoritative flow snapshot failed node=%d: %v", snapshot.NodeID, err)
			}
		}
	}
	resend()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			resend()
		}
	}
}

func (h *Handler) runFederationTunnelReleaseRetryLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	retry := func() {
		tunnelIDs, err := h.repo.ListPendingFederationTunnelTunnels()
		if err != nil {
			log.Printf("list pending federation tunnel releases failed: %v", err)
			return
		}
		for _, tunnelID := range tunnelIDs {
			if err := h.cleanupFederationRuntime(tunnelID); err != nil {
				log.Printf("federation tunnel release retry pending tunnel=%d: %v", tunnelID, err)
			}
		}
	}
	retry()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			retry()
		}
	}
}

func (h *Handler) runRemoteShareEventManager(ctx context.Context) {
	defer h.jobsWG.Done()
	var workersWG sync.WaitGroup
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	reconcile := func() {
		nodes, err := h.repo.ListRemoteNodes()
		if err != nil {
			log.Printf("list remote share event nodes failed: %v", err)
			return
		}
		active := make(map[int64]struct{}, len(nodes))
		h.remoteEventMu.Lock()
		if h.remoteEventWorkers == nil {
			h.remoteEventWorkers = make(map[int64]remoteEventWorker)
		}
		for _, node := range nodes {
			active[node.ID] = struct{}{}
			remoteURL := strings.TrimSpace(node.RemoteURL.String)
			token := strings.TrimSpace(node.RemoteToken.String)
			fingerprint := remoteURL + "\x00" + token
			if worker, exists := h.remoteEventWorkers[node.ID]; exists {
				if worker.fingerprint == fingerprint {
					continue
				}
				worker.cancel()
				delete(h.remoteEventWorkers, node.ID)
			}
			if remoteURL == "" || token == "" {
				continue
			}
			workerCtx, cancel := context.WithCancel(ctx)
			h.remoteEventWorkers[node.ID] = remoteEventWorker{cancel: cancel, fingerprint: fingerprint}
			workersWG.Add(1)
			go func(nodeID int64, workerURL, workerToken string) {
				defer workersWG.Done()
				h.runRemoteShareEventWorker(workerCtx, nodeID, workerURL, workerToken)
			}(node.ID, remoteURL, token)
		}
		for nodeID, worker := range h.remoteEventWorkers {
			if _, exists := active[nodeID]; !exists {
				worker.cancel()
				delete(h.remoteEventWorkers, nodeID)
			}
		}
		h.remoteEventMu.Unlock()
	}
	reconcile()
	for {
		select {
		case <-ctx.Done():
			h.remoteEventMu.Lock()
			for nodeID, worker := range h.remoteEventWorkers {
				worker.cancel()
				delete(h.remoteEventWorkers, nodeID)
			}
			h.remoteEventMu.Unlock()
			workersWG.Wait()
			return
		case <-ticker.C:
			reconcile()
		}
	}
}

func (h *Handler) runRemoteShareEventWorker(ctx context.Context, nodeID int64, remoteURL, token string) {
	federationClient := client.NewFederationClient()
	backoff := time.Second
	refreshMetrics := func() {
		info, err := federationClient.Connect(remoteURL, token, h.federationLocalDomain())
		if err != nil || info == nil {
			return
		}
		h.replaceRemoteForwardMetrics(nodeID, info.ForwardMetrics)
		h.scheduleRemoteNodeRuntimeReconcile(nodeID, info.Instances)
	}
	metricsDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		defer close(metricsDone)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				refreshMetrics()
			}
		}
	}()
	defer func() { <-metricsDone }()
	var debounceMu sync.Mutex
	var debounceTimer *time.Timer
	var pendingRevision int64
	defer func() {
		debounceMu.Lock()
		if debounceTimer != nil {
			debounceTimer.Stop()
		}
		debounceMu.Unlock()
	}()
	for {
		refreshMetrics()
		err := federationClient.WatchEvents(ctx, remoteURL, token, h.federationLocalDomain(), func(event client.PeerShareEvent) {
			if event.Type != "flow_changed" {
				h.invalidateRemoteNodeRuntimeReconcile(nodeID)
				debounceMu.Lock()
				if debounceTimer != nil {
					debounceTimer.Stop()
					debounceTimer = nil
				}
				debounceMu.Unlock()
				h.broadcastRemoteUsageChanged(nodeID, event.Revision)
				go h.redeployNodeTargetRuntime(nodeID)
				return
			}
			debounceMu.Lock()
			pendingRevision = event.Revision
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.AfterFunc(500*time.Millisecond, func() {
				debounceMu.Lock()
				revision := pendingRevision
				debounceTimer = nil
				debounceMu.Unlock()
				if ctx.Err() == nil {
					h.broadcastRemoteUsageChanged(nodeID, revision)
				}
			})
			debounceMu.Unlock()
		})
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("remote share event stream disconnected node=%d: %v", nodeID, err)
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (h *Handler) runPeerShareExpiryLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			shares, err := h.repo.ListPeerShares()
			if err != nil {
				log.Printf("peer share expiry scan failed: %v", err)
				continue
			}
			nowMs := now.UnixMilli()
			for i := range shares {
				share := &shares[i]
				if share.IsActive != 1 || share.ExpiryTime <= 0 || share.ExpiryTime > nowMs {
					continue
				}
				if err := h.cleanupPeerShareRuntimes(share.ID); err != nil {
					log.Printf("expired peer share cleanup failed share=%d: %v", share.ID, err)
					continue
				}
				if err := h.cleanupFederationTunnels(share.ID); err != nil {
					log.Printf("expired peer share tunnel cleanup failed share=%d: %v", share.ID, err)
					continue
				}
				if err := h.repo.UpdatePeerShareActive(share.ID, 0, nowMs); err != nil {
					log.Printf("disable expired peer share failed share=%d: %v", share.ID, err)
					continue
				}
				h.publishPeerShareEvent(share.ID, "share_expired")
			}
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

// Close releases handler-owned workers and transport resources before the repository closes.
func (h *Handler) Close() {
	if h == nil {
		return
	}
	h.closeCrossBorderChecks()
	h.StopBackgroundJobs()
	if h.wsServer != nil {
		h.wsServer.Close()
	}
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

func (h *Handler) runSDWANReconcileLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	ticker := time.NewTicker(h.getSDWANReconcileInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !h.getSDWANAutoReconcileEnabled() {
				continue
			}
			if h == nil || h.repo == nil {
				continue
			}
			if tier, _ := middleware.GetLicenseTier(); tier != middleware.TierPremium {
				continue
			}
			_ = h.reconcileSDWANLighthouses()
		}
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
	next := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 1, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
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

	snapshots, err := h.repo.ResetUserMonthlyFlow(currentDay, lastDay, now)
	if err == nil && len(snapshots) > 0 {
		periodKey := int64(now.Year()*100 + int(now.Month()))
		nowMs := now.UnixMilli()
		if err := h.repo.RecordFlowResetHistory(snapshots, periodKey, nowMs, "自动周期归零"); err != nil {
			log.Printf("[月度流量归零] 写入归零历史失败: %v", err)
		}
	} else if err != nil {
		log.Printf("[月度流量归零] 用户流量归零失败: %v", err)
	}
	if err := h.repo.ResetUserTunnelMonthlyFlow(currentDay, lastDay, now); err != nil {
		log.Printf("[月度流量归零] 隧道流量归零失败: %v", err)
	}
}

func (h *Handler) resetNodeMonthlyTraffic(now time.Time) {
	if h == nil || h.repo == nil {
		return
	}

	currentDay := now.Day()
	lastDay := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 1, 0, now.Location())
	dayEnd := dayStart.AddDate(0, 0, 1)

	instances, err := h.repo.ListNodeInstanceMonthlyFlowResetDue(currentDay, lastDay, dayStart.UnixMilli(), dayEnd.UnixMilli())
	if err != nil {
		return
	}
	cycleCandidates, err := h.repo.ListNodeInstanceCycleFlowResetCandidates(dayStart.UnixMilli(), dayEnd.UnixMilli())
	if err != nil {
		return
	}
	for _, inst := range cycleCandidates {
		if nodeInstanceCycleResetDue(inst.ExpiryTime, inst.RenewalCycle, now) {
			instances = append(instances, inst)
		}
	}
	if len(instances) == 0 {
		return
	}

	actorUserID := int64(1)
	actorUserName := "system"
	nowMs := now.UnixMilli()

	for _, inst := range instances {
		cmdResult, err := h.sendNodeCommandToInstanceWithTimeout(
			inst.NodeID,
			inst.InstanceID,
			"ResetTraffic",
			map[string]interface{}{
				"reason":     "自动周期归零",
				"nodeId":     inst.NodeID,
				"instanceId": inst.InstanceID,
			},
			10*time.Second,
			false,
			false,
		)

		if err != nil || !cmdResult.Success {
			log.Printf("WARN: auto-reset node %d instance %s traffic failed: %v", inst.NodeID, inst.InstanceID, err)
			continue
		}
		instanceName := inst.DisplayName
		if strings.TrimSpace(instanceName) == "" && inst.DisplayIndex > 0 {
			instanceName = fmt.Sprintf("实例 %d", inst.DisplayIndex)
		}
		logName := inst.NodeName
		if strings.TrimSpace(instanceName) != "" {
			logName += " / " + instanceName
		}

		_ = h.repo.CreateNodeTrafficResetLog(&repo.NodeTrafficResetLogCreateParams{
			NodeID:        inst.NodeID,
			NodeName:      inst.NodeName,
			InstanceID:    inst.InstanceID,
			InstanceName:  instanceName,
			ResetTime:     nowMs,
			OperatorID:    actorUserID,
			OperatorName:  actorUserName,
			Reason:        "自动周期归零",
			InFlowBefore:  inst.PeriodNetOutBytes,
			OutFlowBefore: inst.PeriodNetInBytes,
		})

		_ = h.repo.UpdateNodeInstanceTrafficNotifiedMask(inst.NodeID, inst.InstanceID, 0)
		netIn, netOut, bootID, interfaceKey, ok := resetTrafficNetSnapshot(cmdResult)
		if !ok {
			log.Printf("WARN: auto-reset node %d instance %s missing network snapshot", inst.NodeID, inst.InstanceID)
			continue
		}
		_ = h.repo.ResetNodeInstanceTotalFlow(inst.NodeID, inst.InstanceID)
		_ = h.repo.ResetNodeInstancePeriodNetTraffic(inst.NodeID, inst.InstanceID, netIn, netOut, bootID, interfaceKey, false)
		h.nodeTrafficCache.Delete(fmt.Sprintf("%d:%s", inst.NodeID, inst.InstanceID))

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendNodeTrafficReset(logName, "自动周期归零")
		})
	}
}

func nodeInstanceCycleResetDue(anchorMs int64, cycle string, now time.Time) bool {
	months := 0
	switch strings.TrimSpace(cycle) {
	case "month":
		months = 1
	case "quarter":
		months = 3
	case "halfYear", "halfyear":
		months = 6
	case "year":
		months = 12
	}
	if anchorMs <= 0 || months == 0 {
		return false
	}
	anchor := time.UnixMilli(anchorMs).In(now.Location())
	for period := 0; ; period++ {
		boundary := addCalendarMonthsClamped(anchor, period*months)
		if boundary.After(now) {
			return false
		}
		if boundary.Year() == now.Year() && boundary.YearDay() == now.YearDay() {
			return true
		}
	}
}

func addCalendarMonthsClamped(value time.Time, months int) time.Time {
	year, month, day := value.Date()
	hour, minute, second := value.Clock()
	targetMonth := int(month) - 1 + months
	targetYear := year + targetMonth/12
	targetMonth %= 12
	if targetMonth < 0 {
		targetMonth += 12
		targetYear--
	}
	lastDay := time.Date(targetYear, time.Month(targetMonth)+2, 0, hour, minute, second, value.Nanosecond(), value.Location()).Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(targetYear, time.Month(targetMonth)+1, day, hour, minute, second, value.Nanosecond(), value.Location())
}

func (h *Handler) disableExpiredUsers(nowMs int64) {
	h.processPendingRenewalResets(nowMs)
	userIDs, err := h.repo.ListAutoRenewUserIDs(nowMs + int64(72*time.Hour/time.Millisecond))
	if err != nil {
		return
	}

	for _, userID := range userIDs {
		user, err := h.repo.GetUserByID(userID)
		if err != nil {
			continue
		}

		resetReason := "到期自动归零"
		newExpTime, renewed, renewErr := h.repo.TryAutoRenewForUser(userID, nowMs)
		if renewErr == nil && renewed {
			log.Printf("用户 %d 自动续费成功：扣款 %d 分，新到期时间 %v",
				userID, user.RenewalAmount, time.UnixMilli(newExpTime))
			if user.ExpTime <= nowMs {
				_ = h.repo.MarkUserAutoRenewSuccess(userID, newExpTime, nowMs)
				_ = h.repo.UpdateUserForwardsStatus(userID, 1, nowMs)
				h.resumePausedForwardsByUser(userID, nowMs)
			}

			if user.ExpTime <= nowMs {
				h.sendBotNotification(func(bot *telegram.Bot) { bot.SendUserFlowReset(user.User) })
			}

			continue
		}
		if renewErr == nil {
			fresh, freshErr := h.repo.GetUserByID(userID)
			if freshErr != nil || fresh.ExpTime > nowMs {
				if freshErr != nil {
					log.Printf("用户 %d 自动续费候选读取失败：%v", userID, freshErr)
				} else {
					log.Printf("用户 %d 自动续费跳过：续费配置未满足", userID)
				}
				continue
			}
		}
		if renewErr != nil {
			if !errors.Is(renewErr, repo.ErrInsufficientBalance) {
				log.Printf("用户 %d 自动续费暂时失败：%v，将继续重试", userID, renewErr)
				continue
			}
			log.Printf("用户 %d 自动续费余额不足", userID)
			if user.ExpTime > nowMs {
				_ = h.repo.CreateUserNotification(repo.UserNotificationCreateParams{UserID: userID, EventKey: fmt.Sprintf("renewal-balance:%d:%d", userID, user.ExpTime), Type: "balance", Title: "自动续费余额不足", Content: fmt.Sprintf("账户余额不足以支付自动续费，请及时充值。续费金额 %.2f 元。", float64(user.RenewalAmount)/100), Metadata: fmt.Sprintf(`{"amount":%d,"expireAt":%d}`, user.RenewalAmount, user.ExpTime)}, nowMs)
				continue
			}
			resetReason = "自动续费失败（扣款失败）"
		}

		if err := h.repo.MarkExpiredUserAutoRenewFailure(userID, user.ExpTime, nowMs, resetReason); err != nil {
			continue
		}
		forwards, err := h.listActiveForwardsByUser(userID)
		if err == nil {
			h.pauseForwardRecords(forwards, nowMs)
		}

		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendUserFlowReset(user.User)
		})
	}
}

func (h *Handler) processPendingRenewalResets(nowMs int64) {
	userIDs, err := h.repo.ListPendingRenewalResetUserIDs(nowMs)
	if err != nil {
		return
	}
	for _, userID := range userIDs {
		user, err := h.repo.GetUserByID(userID)
		if err != nil {
			continue
		}
		if err := h.repo.MarkUserAutoRenewSuccess(userID, user.ExpTime, nowMs); err != nil {
			continue
		}
		_ = h.repo.UpdateUserForwardsStatus(userID, 1, nowMs)
		h.resumePausedForwardsByUser(userID, nowMs)
		h.sendBotNotification(func(bot *telegram.Bot) { bot.SendUserFlowReset(user.User) })
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
		if resetErr := h.repo.ResetForwardTrafficWithLog(forward.ID, &repo.ForwardTrafficResetLogCreateParams{
			ForwardID: forward.ID, ForwardName: forward.Name, UserID: forward.UserID, UserName: forward.UserName,
			ResetTime: nowMs, OperatorID: 1, OperatorName: "system", Reason: "到期归零",
		}); resetErr != nil {
			log.Printf("ERROR: reset forward %d traffic failed: %v", forward.ID, resetErr)
			continue
		}

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
			price = pkg.Price
			amount = pkg.TrafficLimit
		} else {
			price = user.BuyTrafficPrice
			amount = user.BuyTrafficAmount
		}

		if user.Balance < price {
			log.Printf("用户 %d 自动购流余额不足：余额 %d 分，需要 %d 分",
				user.ID, user.Balance, price)
			_ = h.repo.CreateUserNotification(repo.UserNotificationCreateParams{
				UserID: user.ID, EventKey: fmt.Sprintf("traffic-balance:%d:%d:%d", user.ID, price, user.Flow), Type: "balance",
				Title: "自动购流余额不足", Content: fmt.Sprintf("账户余额不足以自动购买流量，需要 %.2f 元。", float64(price)/100),
				Metadata: fmt.Sprintf(`{"amount":%d,"expireAt":%d}`, price, user.ExpTime),
			}, nowMs)
			continue
		}

		const maxRetries = 3
		purchased := false
		for attempt := 1; attempt <= maxRetries; attempt++ {
			var err error
			if user.AutoBuyTrafficPackageID > 0 {
				err = h.repo.BuyTrafficPackageWithBalance(user.ID, user.AutoBuyTrafficPackageID, threshold, nowMs)
			} else {
				err = h.repo.BuyTrafficWithBalance(user.ID, price, amount, threshold, nowMs)
			}
			if err != nil {
				log.Printf("用户 %d 自动购流失败（第%d/%d次）：%v", user.ID, attempt, maxRetries, err)
				if user.AutoBuyTrafficPackageID > 0 && (err.Error() == "库存不足" || err.Error() == "自动购流套餐不可用") {
					_ = h.repo.UpdateUserAutoBuyTraffic(user.ID, 0)
					if err.Error() == "库存不足" {
						pkgNow, _ := h.repo.GetPackageByID(user.AutoBuyTrafficPackageID)
						if pkgNow != nil && pkgNow.Stock == 0 {
							log.Printf("套餐 %d 已售罄，批量停用关联用户自动购流", pkgNow.ID)
							_ = h.repo.DisableUsersForZeroStockPackage(pkgNow.ID)
						}
					}
					break
				}
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

func (h *Handler) runAutoRenewLoop(ctx context.Context) {
	defer h.jobsWG.Done()
	h.disableExpiredUsers(time.Now().UnixMilli())
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.disableExpiredUsers(now.UnixMilli())
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

	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
		userTunnelID, _, ceilingSpeed, err := h.resolveUserTunnelAndLimiter(f.UserID, f.TunnelID)
		if err != nil {
			log.Printf("[nftables-dns] resolveUserTunnelAndLimiter(%d,%d) 失败: %v", f.UserID, f.TunnelID, err)
			continue
		}

		var speedLimit *int
		if effective, ok := h.resolveEffectiveForwardSpeedLimit(forwardRec); ok {
			speedLimit = &effective
		}
		if err := h.syncNftablesRules(forwardRec, tunnel, ports, userTunnelID, speedLimit, ceilingSpeed); err != nil {
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

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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

	cancelled := 0
	for _, o := range orders {
		if err := h.repo.CancelPendingPackageOrder(o.ID, 0); err != nil {
			log.Printf("[orders] 取消超时订单 %d 失败: %v", o.ID, err)
			continue
		}
		cancelled++
		h.sendBotNotification(func(bot *telegram.Bot) {
			bot.SendOrderCancelled(o.OrderNo, o.UserName)
		})
	}

	log.Printf("[orders] 已取消 %d 个超时未支付订单", cancelled)
}

func (h *Handler) runExpirePackageSubscriptionsLoop(ctx context.Context) {
	defer h.jobsWG.Done()

	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
		if err := h.syncUserForwardsEffectiveSpeedLimit(sub.UserID); err != nil {
			log.Printf("[packages] 同步用户 %d 限速失败: %v", sub.UserID, err)
		}
	}

	log.Printf("[packages] 已过期 %d 个套餐订阅", len(expired))
}

// checkNodeExpiryNotifications checks instances expiring within 3 days and sends Telegram notifications.
// Only notifies once per 24h per instance to avoid spam.
func (h *Handler) checkNodeExpiryNotifications(nowMs int64) {
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierFree {
		return
	}
	bot := h.TelegramBot()
	if bot == nil || !bot.Enabled() || !bot.Running() {
		return
	}

	instances, err := h.repo.ListNodeInstancesExpiringWithin(nowMs, 3)
	if err != nil || len(instances) == 0 {
		return
	}
	for _, inst := range instances {
		name := inst.NodeName
		if inst.DisplayName != "" {
			name += " / " + inst.DisplayName
		} else if inst.DisplayIndex > 0 {
			name += fmt.Sprintf(" / 实例 %d", inst.DisplayIndex)
		}

		expired, daysLeft := nodeExpiryReminderDays(inst.ExpiryTime, nowMs)
		if expired {
			bot.SendNodeExpired(name)
		} else {
			bot.SendNodeExpirySoon(name, daysLeft)
		}
		_ = h.repo.UpdateNodeInstanceExpiryReminderDismissedUntil(inst.NodeID, inst.InstanceID, nowMs+86400000)
	}
}

func nodeExpiryReminderDays(expiryMs, nowMs int64) (bool, int) {
	if expiryMs <= nowMs {
		return true, 0
	}
	const dayMs = int64(24 * time.Hour / time.Millisecond)
	days := int((expiryMs - nowMs + dayMs - 1) / dayMs)
	if days < 1 {
		days = 1
	}
	return false, days
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
	candidates := make(map[int64]nodeNotifyState, len(notifyStates))
	for id, state := range notifyStates {
		if state == nil {
			continue
		}
		candidates[id] = *state
	}
	notifyStateMu.RUnlock()
	nowMs := time.Now().UnixMilli()
	for nodeID, state := range candidates {
		if state.stillOfflineDone {
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
		if state.offlineSince <= 0 {
			notifyStateMu.Lock()
			if ns := notifyStates[nodeID]; ns != nil && ns.offlineSince <= 0 {
				ns.offlineSince = nowMs
				ns.stillOfflineDone = false
			}
			notifyStateMu.Unlock()
			continue
		}
		elapsedMs := nowMs - state.offlineSince
		if elapsedMs < offlineCooldownMs {
			continue
		}
		elapsedMin := elapsedMs / 60000
		if elapsedMin < 2 {
			elapsedMin = 2
		}
		bot.SendNodeStillOffline(node.Name, int(elapsedMin))
		notifyStateMu.Lock()
		if ns := notifyStates[nodeID]; ns != nil {
			ns.stillOfflineDone = true
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
