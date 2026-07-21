package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// GlobalTrafficManager 全局流量管理器（所有服务共享）
type GlobalTrafficManager struct {
	mu                sync.RWMutex
	serviceTraffic    map[string]*ServiceTraffic // key: 服务名, value: 流量数据
	totalUpBytes      uint64
	totalDownBytes    uint64
	baselineUpBytes   uint64
	baselineDownBytes uint64
	statePath         string
	ctx               context.Context
	cancel            context.CancelFunc
	reportTicker      *time.Ticker
}

// ServiceTraffic 单个服务的流量累积
type ServiceTraffic struct {
	mu          sync.Mutex
	ServiceName string
	UpBytes     int64 // 上行流量（累积）
	DownBytes   int64 // 下行流量（累积）
}

type businessTrafficState struct {
	TotalUpBytes      uint64                    `json:"total_up_bytes"`
	TotalDownBytes    uint64                    `json:"total_down_bytes"`
	BaselineUpBytes   uint64                    `json:"baseline_up_bytes"`
	BaselineDownBytes uint64                    `json:"baseline_down_bytes"`
	Pending           map[string]pendingTraffic `json:"pending"`
}

type pendingTraffic struct {
	UpBytes   int64 `json:"up_bytes"`
	DownBytes int64 `json:"down_bytes"`
}

var (
	globalManager     *GlobalTrafficManager
	globalManagerOnce sync.Once
)

// GetGlobalTrafficManager 获取全局流量管理器单例
func GetGlobalTrafficManager() *GlobalTrafficManager {
	globalManagerOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		globalManager = &GlobalTrafficManager{
			serviceTraffic: make(map[string]*ServiceTraffic),
			ctx:            ctx,
			cancel:         cancel,
			reportTicker:   time.NewTicker(5 * time.Second),
		}
		// 启动定时上报协程
		go globalManager.startReporting()
	})
	return globalManager
}

// ConfigureBusinessTrafficState restores and persists business counters and
// pending reports across agent restarts.
func ConfigureBusinessTrafficState(path string) error {
	m := GetGlobalTrafficManager()
	path = filepath.Clean(path)
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	m.mu.Lock()
	m.statePath = path
	if len(data) > 0 {
		var state businessTrafficState
		if err := json.Unmarshal(data, &state); err != nil {
			m.mu.Unlock()
			return err
		}
		m.totalUpBytes = state.TotalUpBytes
		m.totalDownBytes = state.TotalDownBytes
		m.baselineUpBytes = state.BaselineUpBytes
		m.baselineDownBytes = state.BaselineDownBytes
		for name, pending := range state.Pending {
			if pending.UpBytes == 0 && pending.DownBytes == 0 {
				continue
			}
			m.serviceTraffic[name] = &ServiceTraffic{
				ServiceName: name,
				UpBytes:     pending.UpBytes,
				DownBytes:   pending.DownBytes,
			}
		}
	}
	m.mu.Unlock()
	return nil
}

// AddTraffic 添加流量到指定服务（由各服务调用）
func (m *GlobalTrafficManager) AddTraffic(serviceName string, upBytes, downBytes int64) {
	if upBytes == 0 && downBytes == 0 {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if upBytes > 0 {
		m.totalUpBytes += uint64(upBytes)
	}
	if downBytes > 0 {
		m.totalDownBytes += uint64(downBytes)
	}

	// 获取或创建服务流量记录
	traffic, exists := m.serviceTraffic[serviceName]
	if !exists {
		traffic = &ServiceTraffic{
			ServiceName: serviceName,
		}
		m.serviceTraffic[serviceName] = traffic
	}

	// 累加流量
	traffic.mu.Lock()
	traffic.UpBytes += upBytes
	traffic.DownBytes += downBytes
	traffic.mu.Unlock()
}

// BusinessTraffic returns this agent instance's FLOX service traffic. The
// cumulative values are monotonic for the process lifetime; period values use
// the latest explicit reset as their baseline.
func (m *GlobalTrafficManager) BusinessTraffic() (up, down, periodUp, periodDown uint64) {
	if m == nil {
		return
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	up = m.totalUpBytes
	down = m.totalDownBytes
	if up >= m.baselineUpBytes {
		periodUp = up - m.baselineUpBytes
	}
	if down >= m.baselineDownBytes {
		periodDown = down - m.baselineDownBytes
	}
	return
}

// ResetBusinessTraffic starts a new business traffic period without touching
// pending HTTP report deltas.
func (m *GlobalTrafficManager) ResetBusinessTraffic() {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.baselineUpBytes = m.totalUpBytes
	m.baselineDownBytes = m.totalDownBytes
	m.mu.Unlock()
	m.persistState()
}

// startReporting 启动定时上报协程（每5秒执行一次）
func (m *GlobalTrafficManager) startReporting() {

	for {
		select {
		case <-m.reportTicker.C:
			m.collectAndReport()

		case <-m.ctx.Done():
			fmt.Printf("⏹️ 全局流量上报器已停止\n")
			return
		}
	}
}

// collectAndReport 收集所有服务流量并合并上报
func (m *GlobalTrafficManager) collectAndReport() {
	defer m.persistState()
	m.mu.Lock()

	// 如果没有流量，直接返回
	if len(m.serviceTraffic) == 0 {
		m.mu.Unlock()
		return
	}

	// 复制当前所有流量数据（避免长时间持锁）
	trafficSnapshot := make(map[string]*ServiceTraffic)
	reportData := make(map[string]struct {
		up   int64
		down int64
	})

	for name, traffic := range m.serviceTraffic {
		traffic.mu.Lock()
		if traffic.UpBytes > 0 || traffic.DownBytes > 0 {
			trafficSnapshot[name] = traffic
			reportData[name] = struct {
				up   int64
				down int64
			}{
				up:   traffic.UpBytes,
				down: traffic.DownBytes,
			}
		}
		traffic.mu.Unlock()
	}
	m.mu.Unlock()

	// 如果没有需要上报的流量，返回
	if len(reportData) == 0 {
		return
	}

	// 构建上报数据数组（保持每个服务独立）
	reportItems := make([]TrafficReportItem, 0, len(reportData))
	var totalUp, totalDown int64

	for serviceName, data := range reportData {
		reportItems = append(reportItems, TrafficReportItem{
			N: serviceName, // 保持服务名不变
			U: data.up,
			D: data.down,
		})
		totalUp += data.up
		totalDown += data.down
	}

	// 批量发送上报请求（一次HTTP请求包含所有服务）
	success, err := sendBatchTrafficReport(m.ctx, reportItems)
	if err != nil {
		fmt.Printf("❌ 全局流量上报失败: %v (总流量: ↑%d ↓%d, %d个服务)\n", err, totalUp, totalDown, len(reportItems))
		return
	}

	if !success {
		fmt.Printf("⚠️ 全局流量上报未成功 (总流量: ↑%d ↓%d, %d个服务)\n", totalUp, totalDown, len(reportItems))
		return
	}

	// 上报成功，清空已上报的流量
	m.clearReportedTraffic(reportData)
}

func (m *GlobalTrafficManager) persistState() {
	if m == nil {
		return
	}
	m.mu.RLock()
	path := m.statePath
	state := businessTrafficState{
		TotalUpBytes:      m.totalUpBytes,
		TotalDownBytes:    m.totalDownBytes,
		BaselineUpBytes:   m.baselineUpBytes,
		BaselineDownBytes: m.baselineDownBytes,
		Pending:           make(map[string]pendingTraffic, len(m.serviceTraffic)),
	}
	for name, traffic := range m.serviceTraffic {
		traffic.mu.Lock()
		state.Pending[name] = pendingTraffic{UpBytes: traffic.UpBytes, DownBytes: traffic.DownBytes}
		traffic.mu.Unlock()
	}
	m.mu.RUnlock()
	if path == "" {
		return
	}
	data, err := json.Marshal(state)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0600)
}

// clearReportedTraffic 清空已成功上报的流量
func (m *GlobalTrafficManager) clearReportedTraffic(reportedData map[string]struct {
	up   int64
	down int64
}) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for serviceName, reported := range reportedData {
		if traffic, exists := m.serviceTraffic[serviceName]; exists {
			traffic.mu.Lock()
			// 减去已上报的流量
			traffic.UpBytes -= reported.up
			traffic.DownBytes -= reported.down

			// 如果流量归零，从map中删除该服务记录（避免内存泄漏）
			if traffic.UpBytes <= 0 && traffic.DownBytes <= 0 {
				traffic.mu.Unlock()
				delete(m.serviceTraffic, serviceName)
			} else {
				traffic.mu.Unlock()
			}
		}
	}
}

// Stop 停止全局流量管理器
func (m *GlobalTrafficManager) Stop() {
	if m.reportTicker != nil {
		m.reportTicker.Stop()
	}
	if m.cancel != nil {
		m.cancel()
	}
	fmt.Printf("🛑 全局流量管理器已停止\n")
}

// GetServiceTraffic 获取指定服务的当前流量（用于调试）
func (m *GlobalTrafficManager) GetServiceTraffic(serviceName string) (upBytes, downBytes int64) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if traffic, exists := m.serviceTraffic[serviceName]; exists {
		traffic.mu.Lock()
		upBytes = traffic.UpBytes
		downBytes = traffic.DownBytes
		traffic.mu.Unlock()
	}
	return
}
