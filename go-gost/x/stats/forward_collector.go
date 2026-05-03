package stats

import (
	"sync"
	"time"
)

// BandwidthCalculator 带宽计算器
type BandwidthCalculator struct {
	interval time.Duration
	stopChan chan struct{}
	prevStats map[int64]struct {
		inBytes  uint64
		outBytes uint64
		time     time.Time
	}
	prevStatsMu sync.RWMutex
}

// NewBandwidthCalculator 创建带宽计算器
func NewBandwidthCalculator(interval time.Duration) *BandwidthCalculator {
	return &BandwidthCalculator{
		interval: interval,
		stopChan: make(chan struct{}),
		prevStats: make(map[int64]struct {
			inBytes  uint64
			outBytes uint64
			time     time.Time
		}),
	}
}

// Start 启动带宽计算协程
func (c *BandwidthCalculator) Start(manager *ForwardStatsManager) {
	go func() {
		ticker := time.NewTicker(c.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				c.calculate(manager)
			case <-c.stopChan:
				return
			}
		}
	}()
}

// Stop 停止带宽计算器
func (c *BandwidthCalculator) Stop() {
	close(c.stopChan)
}

// calculate 计算所有转发规则的实时带宽
func (c *BandwidthCalculator) calculate(manager *ForwardStatsManager) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()

	now := time.Now()

	// 获取并锁定 prevStats
	c.prevStatsMu.Lock()
	defer c.prevStatsMu.Unlock()

	for id, stats := range manager.stats {
		stats.mu.Lock()

		if _, exists := c.prevStats[id]; !exists {
			// 第一次计算，保存基准值
			c.prevStats[id] = struct {
				inBytes  uint64
				outBytes uint64
				time     time.Time
			}{
				inBytes:  stats.InBytes,
				outBytes: stats.OutBytes,
				time:     now,
			}
			stats.mu.Unlock()
			continue
		}

		// 计算带宽速度 (bytes/s)
		delta := now.Sub(c.prevStats[id].time).Seconds()
		if delta > 0 {
			// 计算增量
			inDelta := int64(stats.InBytes - c.prevStats[id].inBytes)
			outDelta := int64(stats.OutBytes - c.prevStats[id].outBytes)

			// 防止负数（计数器回滚等情况）
			if inDelta < 0 {
				inDelta = 0
			}
			if outDelta < 0 {
				outDelta = 0
			}

			stats.InSpeed = uint64(float64(inDelta) / delta)
			stats.OutSpeed = uint64(float64(outDelta) / delta)
		}

		// 更新前值
		c.prevStats[id] = struct {
			inBytes  uint64
			outBytes uint64
			time     time.Time
		}{
			inBytes:  stats.InBytes,
			outBytes: stats.OutBytes,
			time:     now,
		}

		stats.mu.Unlock()
	}

	// 清理 prev 中不存在的转发规则（超过 5 分钟未更新的才清理）
	for id, prev := range c.prevStats {
		if _, exists := manager.stats[id]; !exists {
			// 如果超过 5 分钟没有这个规则的数据，才清理
			if time.Since(prev.time) > 5*time.Minute {
				delete(c.prevStats, id)
			}
		}
	}
}
