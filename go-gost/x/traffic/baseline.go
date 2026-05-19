package traffic

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Baseline 表示一个流量统计基线
type Baseline struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"` // manual | auto_daily | auto_weekly | auto_monthly | auto_quarterly | auto_yearly
	InitialRX    uint64    `json:"initial_rx"`
	InitialTX    uint64    `json:"initial_tx"`
	RecordedAt   time.Time `json:"recorded_at"`
	RenewalCycle string    `json:"renewal_cycle"`
	NextResetAt  time.Time `json:"next_reset_at,omitempty"`
}

// HistoryBaseline 表示已结束的历史周期
type HistoryBaseline struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	InitialRX    uint64    `json:"initial_rx"`
	InitialTX    uint64    `json:"initial_tx"`
	FinalRX      uint64    `json:"final_rx"`
	FinalTX      uint64    `json:"final_tx"`
	PeriodStart  time.Time `json:"period_start"`
	PeriodEnd    time.Time `json:"period_end"`
	DurationDays int       `json:"duration_days"`
}

// BaselineFile 基线文件结构
type BaselineFile struct {
	Version         string            `json:"version"`
	NodeID          int64             `json:"node_id"`
	CurrentBaseline *Baseline         `json:"current_baseline"`
	History         []HistoryBaseline `json:"history"`
}

// BaselineManager 基线管理器
type BaselineManager struct {
	filepath string
	data     *BaselineFile
	mu       sync.RWMutex
}

var globalManager *BaselineManager

// InitBaselineManager 初始化基线管理器
func InitBaselineManager(nodeID int64, filePath string) (*BaselineManager, error) {
	// 确保目录存在
	dir := filepath.Dir(filePath)
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建目录失败：%w", err)
	}

	manager := &BaselineManager{
		filepath: filePath,
		data: &BaselineFile{
			Version: "2.0",
			NodeID:  nodeID,
			History: []HistoryBaseline{},
		},
	}

	// 尝试加载现有文件
	if err := manager.load(); err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("加载基线文件失败: %w", err)
		}
		// 文件不存在，首次启动，后续需要创建初始基线
	}

	globalManager = manager
	return manager, nil
}

// GetManager 获取全局管理器实例
func GetManager() *BaselineManager {
	return globalManager
}

// load 从文件加载基线数据
func (m *BaselineManager) load() error {
	data, err := os.ReadFile(m.filepath)
	if err != nil {
		return err
	}

	var bf BaselineFile
	if err := json.Unmarshal(data, &bf); err != nil {
		return fmt.Errorf("解析基线文件失败: %w", err)
	}

	m.mu.Lock()
	m.data = &bf
	m.mu.Unlock()

	return nil
}

// save 保存基线数据到文件
// 注意：调用 save() 前必须已经持有 m.mu 的锁！
func (m *BaselineManager) save() error {
	// m.mu.RLock()调用者已经持有锁，不需要再加锁
	jsonData, err := json.MarshalIndent(m.data, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化基线数据失败：%w", err)
	}

	if err := os.WriteFile(m.filepath, jsonData, 0644); err != nil {
		return fmt.Errorf("写入基线文件失败：%w", err)
	}

	return nil
}

// CreateInitialBaseline 创建初始基线（首次安装时调用）
func (m *BaselineManager) CreateInitialBaseline(initialRX, initialTX uint64, renewalCycle string) (*Baseline, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 如果已有当前基线，说明不是首次，不创建
	if m.data.CurrentBaseline != nil {
		return m.data.CurrentBaseline, nil
	}

	now := time.Now().UTC()
	nextReset := CalculateNextReset(renewalCycle, now)

	baseline := &Baseline{
		ID:           fmt.Sprintf("initial_%s", now.Format("20060102150405")),
		Type:         "initial",
		InitialRX:    initialRX,
		InitialTX:    initialTX,
		RecordedAt:   now,
		RenewalCycle: renewalCycle,
		NextResetAt:  nextReset,
	}

	m.data.CurrentBaseline = baseline

	if err := m.save(); err != nil {
		return nil, err
	}

	return baseline, nil
}

// CreateManualBaseline 手动归零基线
func (m *BaselineManager) CreateManualBaseline(currentRX, currentTX uint64, reason string) (*Baseline, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()

	// 归档当前周期到历史
	if m.data.CurrentBaseline != nil {
		history := HistoryBaseline{
			ID:           m.data.CurrentBaseline.ID,
			Type:         m.data.CurrentBaseline.Type,
			InitialRX:    m.data.CurrentBaseline.InitialRX,
			InitialTX:    m.data.CurrentBaseline.InitialTX,
			FinalRX:      currentRX,
			FinalTX:      currentTX,
			PeriodStart:  m.data.CurrentBaseline.RecordedAt,
			PeriodEnd:    now,
			DurationDays: int(now.Sub(m.data.CurrentBaseline.RecordedAt).Hours() / 24),
		}
		m.data.History = append(m.data.History, history)
	}

	// 保持原周期
	renewalCycle := ""
	nextReset := time.Time{}
	if m.data.CurrentBaseline != nil {
		renewalCycle = m.data.CurrentBaseline.RenewalCycle
		nextReset = CalculateNextReset(renewalCycle, now)
	}

	// 创建新基线
	baseline := &Baseline{
		ID:           fmt.Sprintf("manual_%s", now.Format("20060102150405")),
		Type:         "manual",
		InitialRX:    currentRX,
		InitialTX:    currentTX,
		RecordedAt:   now,
		RenewalCycle: renewalCycle,
		NextResetAt:  nextReset,
	}

	m.data.CurrentBaseline = baseline

	if err := m.save(); err != nil {
		return nil, err
	}

	return baseline, nil
}

// CheckAndAutoReset 检查并执行自动归零
// 返回 (新基线, 是否执行了归零)
func (m *BaselineManager) CheckAndAutoReset(currentRX, currentTX uint64) (*Baseline, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.data.CurrentBaseline == nil {
		return nil, false
	}

	// 检查是否到达归零时间
	if m.data.CurrentBaseline.NextResetAt.IsZero() {
		return m.data.CurrentBaseline, false
	}

	if time.Now().UTC().Before(m.data.CurrentBaseline.NextResetAt) {
		return m.data.CurrentBaseline, false
	}

	now := time.Now().UTC()
	renewalCycle := m.data.CurrentBaseline.RenewalCycle

	// 归档当前周期
	history := HistoryBaseline{
		ID:           m.data.CurrentBaseline.ID,
		Type:         m.data.CurrentBaseline.Type,
		InitialRX:    m.data.CurrentBaseline.InitialRX,
		InitialTX:    m.data.CurrentBaseline.InitialTX,
		FinalRX:      currentRX,
		FinalTX:      currentTX,
		PeriodStart:  m.data.CurrentBaseline.RecordedAt,
		PeriodEnd:    now,
		DurationDays: int(now.Sub(m.data.CurrentBaseline.RecordedAt).Hours() / 24),
	}
	m.data.History = append(m.data.History, history)

	// 创建新基线
	autoType := fmt.Sprintf("auto_%s", renewalCycle)
	baseline := &Baseline{
		ID:           fmt.Sprintf("%s_%s", autoType, now.Format("20060102150405")),
		Type:         autoType,
		InitialRX:    currentRX,
		InitialTX:    currentTX,
		RecordedAt:   now,
		RenewalCycle: renewalCycle,
		NextResetAt:  CalculateNextReset(renewalCycle, now),
	}

	m.data.CurrentBaseline = baseline

	if err := m.save(); err != nil {
		// 保存失败，但内存中已更新，继续运行
		// 下次检查时会重试保存
	}

	return baseline, true
}

// CalculatePeriodTraffic 计算周期流量
// 当检测到网卡计数器重置（当前值 < 基线值）时，自动更新基线
func (m *BaselineManager) CalculatePeriodTraffic(currentRX, currentTX uint64) (rx, tx uint64) {
	m.mu.Lock()
	baseline := m.data.CurrentBaseline
	m.mu.Unlock()

	if baseline == nil {
		return currentRX, currentTX
	}

	// 检测网卡计数器是否被重置（重启后计数器从 0 开始）
	// 如果当前值小于基线值，说明计数器重置了，需要更新基线
	if currentRX < baseline.InitialRX || currentTX < baseline.InitialTX {
		fmt.Printf("⚠️ 检测到网卡计数器重置，自动更新基线 (RX: %d→%d, TX: %d→%d)\n",
			baseline.InitialRX, currentRX, baseline.InitialTX, currentTX)

		m.mu.Lock()
		baseline.InitialRX = currentRX
		baseline.InitialTX = currentTX
		baseline.RecordedAt = time.Now().UTC()
		m.mu.Unlock()

		// 保存更新后的基线
		m.mu.Lock()
		_ = m.save()
		m.mu.Unlock()

		return 0, 0
	}

	rx = currentRX - baseline.InitialRX
	tx = currentTX - baseline.InitialTX

	return rx, tx
}

// GetCurrentBaseline 获取当前基线
func (m *BaselineManager) GetCurrentBaseline() *Baseline {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.data.CurrentBaseline
}

// GetHistory 获取历史周期列表
func (m *BaselineManager) GetHistory() []HistoryBaseline {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.data.History
}

// GetNextResetAt 获取下次归零时间
func (m *BaselineManager) GetNextResetAt() time.Time {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.data.CurrentBaseline == nil {
		return time.Time{}
	}
	return m.data.CurrentBaseline.NextResetAt
}

// UpdateRenewalCycle 更新续费周期（周期变更时调用）
func (m *BaselineManager) UpdateRenewalCycle(renewalCycle string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.data.CurrentBaseline == nil {
		return nil
	}

	m.data.CurrentBaseline.RenewalCycle = renewalCycle
	m.data.CurrentBaseline.NextResetAt = CalculateNextReset(renewalCycle, time.Now().UTC())

	return m.save()
}
