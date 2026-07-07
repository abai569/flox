package metrics

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

type SystemInfo struct {
	Uptime                 uint64  `json:"uptime"`
	BytesReceived          uint64  `json:"bytes_received"`
	BytesTransmitted       uint64  `json:"bytes_transmitted"`
	PeriodBytesReceived    uint64  `json:"period_bytes_received"`
	PeriodBytesTransmitted uint64  `json:"period_bytes_transmitted"`
	BaselineRecordedAt     int64   `json:"baseline_recorded_at"`
	NextResetAt            int64   `json:"next_reset_at"`
	RenewalCycle           string  `json:"renewal_cycle,omitempty"`
	CPUUsage               float64 `json:"cpu_usage"`
	MemoryUsage            float64 `json:"memory_usage"`
	DiskUsage              float64 `json:"disk_usage"`
	Load1                  float64 `json:"load1"`
	Load5                  float64 `json:"load5"`
	Load15                 float64 `json:"load15"`
	TCPConns               int64   `json:"tcp_conns"`
	UDPConns               int64   `json:"udp_conns"`
	NetInSpeed             int64   `json:"net_in_speed"`
	NetOutSpeed            int64   `json:"net_out_speed"`
	InstanceID             string  `json:"instance_id,omitempty"`
}

type IngestionService struct {
	repo              *repo.Repository
	nodeBuffer        map[int64]*nodeMetricAggregate
	nodeBufferSamples int
	nodeBufferMu      sync.Mutex
	flushInterval     time.Duration
	retentionDays     int
}

type nodeMetricAggregate struct {
	nodeID    int64
	timestamp int64
	instances map[string]*nodeInstanceMetricAggregate
}

type nodeInstanceMetricAggregate struct {
	count                  int64
	bytesReceived          uint64
	bytesTransmitted       uint64
	periodBytesReceived    uint64
	periodBytesTransmitted uint64
	cpuUsageSum            float64
	memoryUsageSum         float64
	diskUsageSum           float64
	load1Sum               float64
	load5Sum               float64
	load15Sum              float64
	tcpConnsSum            int64
	udpConnsSum            int64
	netInSpeedSum          int64
	netOutSpeedSum         int64
	uptimeMax              uint64
}

func NewIngestionService(repo *repo.Repository) *IngestionService {
	return &IngestionService{
		repo:          repo,
		nodeBuffer:    make(map[int64]*nodeMetricAggregate),
		flushInterval: 30 * time.Second,
		retentionDays: 1,
	}
}

func (s *IngestionService) Start(ctx context.Context) {
	flushTicker := time.NewTicker(s.flushInterval)
	defer flushTicker.Stop()

	pruneTicker := time.NewTicker(1 * time.Hour)
	defer pruneTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.flushNodeMetrics()
			return
		case <-flushTicker.C:
			s.flushNodeMetrics()
		case <-pruneTicker.C:
			s.pruneMetrics()
		}
	}
}

func (s *IngestionService) RecordNodeMetric(nodeID int64, info SystemInfo) {
	now := time.Now().UnixMilli()
	s.nodeBufferMu.Lock()
	agg := s.nodeBuffer[nodeID]
	if agg == nil {
		agg = &nodeMetricAggregate{nodeID: nodeID, timestamp: now, instances: make(map[string]*nodeInstanceMetricAggregate)}
		s.nodeBuffer[nodeID] = agg
	}
	instanceID := normalizeMetricInstanceID(info.InstanceID)
	inst := agg.instances[instanceID]
	if inst == nil {
		inst = &nodeInstanceMetricAggregate{}
		agg.instances[instanceID] = inst
	}
	agg.timestamp = now
	inst.count++
	inst.bytesReceived = info.BytesReceived
	inst.bytesTransmitted = info.BytesTransmitted
	inst.periodBytesReceived = info.PeriodBytesReceived
	inst.periodBytesTransmitted = info.PeriodBytesTransmitted
	inst.cpuUsageSum += info.CPUUsage
	inst.memoryUsageSum += info.MemoryUsage
	inst.diskUsageSum += info.DiskUsage
	inst.load1Sum += info.Load1
	inst.load5Sum += info.Load5
	inst.load15Sum += info.Load15
	inst.tcpConnsSum += info.TCPConns
	inst.udpConnsSum += info.UDPConns
	inst.netInSpeedSum += info.NetInSpeed
	inst.netOutSpeedSum += info.NetOutSpeed
	if info.Uptime > inst.uptimeMax {
		inst.uptimeMax = info.Uptime
	}
	s.nodeBufferSamples++
	shouldFlush := s.nodeBufferSamples >= 200
	s.nodeBufferMu.Unlock()

	if shouldFlush {
		s.flushNodeMetrics()
	}
}

func (s *IngestionService) flushNodeMetrics() {
	s.nodeBufferMu.Lock()
	if len(s.nodeBuffer) == 0 {
		s.nodeBufferMu.Unlock()
		return
	}
	buffer := s.nodeBuffer
	s.nodeBuffer = make(map[int64]*nodeMetricAggregate)
	s.nodeBufferSamples = 0
	s.nodeBufferMu.Unlock()

	if s.repo == nil {
		return
	}
	metrics := make([]*model.NodeMetric, 0, len(buffer)*2)
	for _, agg := range buffer {
		if agg == nil || len(agg.instances) == 0 {
			continue
		}
		var (
			instanceCount          int64
			bytesReceived          uint64
			bytesTransmitted       uint64
			periodBytesReceived    uint64
			periodBytesTransmitted uint64
			cpuUsageSum            float64
			memoryUsageSum         float64
			diskUsageSum           float64
			load1Sum               float64
			load5Sum               float64
			load15Sum              float64
			tcpConns               int64
			udpConns               int64
			netInSpeed             int64
			netOutSpeed            int64
			uptimeMax              uint64
		)
		for instanceID, inst := range agg.instances {
			if inst == nil || inst.count <= 0 {
				continue
			}
			if instanceID != "" {
				metrics = append(metrics, &model.NodeMetric{
					NodeID:      agg.nodeID,
					InstanceID:  instanceID,
					Timestamp:   agg.timestamp,
					CPUUsage:    inst.cpuUsageSum / float64(inst.count),
					MemUsage:    inst.memoryUsageSum / float64(inst.count),
					DiskUsage:   inst.diskUsageSum / float64(inst.count),
					NetInBytes:  int64(inst.bytesReceived),
					NetOutBytes: int64(inst.bytesTransmitted),
					NetInSpeed:  inst.netInSpeedSum / inst.count,
					NetOutSpeed: inst.netOutSpeedSum / inst.count,
					Load1:       inst.load1Sum / float64(inst.count),
					Load5:       inst.load5Sum / float64(inst.count),
					Load15:      inst.load15Sum / float64(inst.count),
					TCPConns:    inst.tcpConnsSum / inst.count,
					UDPConns:    inst.udpConnsSum / inst.count,
					Uptime:      int64(inst.uptimeMax),
					PeriodRx:    int64(inst.periodBytesReceived),
					PeriodTx:    int64(inst.periodBytesTransmitted),
				})
			}
			instanceCount++
			bytesReceived += inst.bytesReceived
			bytesTransmitted += inst.bytesTransmitted
			periodBytesReceived += inst.periodBytesReceived
			periodBytesTransmitted += inst.periodBytesTransmitted
			cpuUsageSum += inst.cpuUsageSum / float64(inst.count)
			memoryUsageSum += inst.memoryUsageSum / float64(inst.count)
			diskUsageSum += inst.diskUsageSum / float64(inst.count)
			load1Sum += inst.load1Sum / float64(inst.count)
			load5Sum += inst.load5Sum / float64(inst.count)
			load15Sum += inst.load15Sum / float64(inst.count)
			tcpConns += inst.tcpConnsSum / inst.count
			udpConns += inst.udpConnsSum / inst.count
			netInSpeed += inst.netInSpeedSum / inst.count
			netOutSpeed += inst.netOutSpeedSum / inst.count
			if inst.uptimeMax > uptimeMax {
				uptimeMax = inst.uptimeMax
			}
		}
		if instanceCount <= 0 {
			continue
		}
		metrics = append(metrics, &model.NodeMetric{
			NodeID:      agg.nodeID,
			Timestamp:   agg.timestamp,
			CPUUsage:    cpuUsageSum / float64(instanceCount),
			MemUsage:    memoryUsageSum / float64(instanceCount),
			DiskUsage:   diskUsageSum / float64(instanceCount),
			NetInBytes:  int64(bytesReceived),
			NetOutBytes: int64(bytesTransmitted),
			NetInSpeed:  netInSpeed,
			NetOutSpeed: netOutSpeed,
			Load1:       load1Sum / float64(instanceCount),
			Load5:       load5Sum / float64(instanceCount),
			Load15:      load15Sum / float64(instanceCount),
			TCPConns:    tcpConns,
			UDPConns:    udpConns,
			Uptime:      int64(uptimeMax),
			PeriodRx:    int64(periodBytesReceived),
			PeriodTx:    int64(periodBytesTransmitted),
		})
	}
	if len(metrics) == 0 {
		return
	}
	if err := s.repo.InsertNodeMetricBatch(metrics); err != nil {
		log.Printf("monitoring write failed op=node_metric.flush count=%d err=%v", len(metrics), err)
	}
}

func normalizeMetricInstanceID(instanceID string) string {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" || strings.EqualFold(instanceID, "default") {
		return "default"
	}
	return instanceID
}

func (s *IngestionService) pruneMetrics() {
	cutoff := time.Now().Add(-time.Duration(s.retentionDays) * 24 * time.Hour).UnixMilli()
	if s.repo == nil {
		return
	}
	if err := s.repo.PruneNodeMetrics(cutoff); err != nil {
		log.Printf("monitoring prune failed op=node_metric cutoff=%d err=%v", cutoff, err)
	}
	if err := s.repo.PruneTunnelMetrics(cutoff); err != nil {
		log.Printf("monitoring prune failed op=tunnel_metric cutoff=%d err=%v", cutoff, err)
	}
	if err := s.repo.PruneServiceMonitorResults(cutoff); err != nil {
		log.Printf("monitoring prune failed op=service_monitor_result cutoff=%d err=%v", cutoff, err)
	}
	staleInstanceCutoff := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	if err := s.repo.PruneStaleNodeInstances(staleInstanceCutoff); err != nil {
		log.Printf("monitoring prune failed op=node_instance cutoff=%d err=%v", staleInstanceCutoff, err)
	}
}

func (s *IngestionService) GetLatestMetric(nodeID int64) (*model.NodeMetric, error) {
	return s.repo.GetLatestNodeMetric(nodeID)
}

func (s *IngestionService) GetMetrics(nodeID int64, startMs, endMs int64) ([]model.NodeMetric, error) {
	return s.repo.GetNodeMetrics(nodeID, startMs, endMs, "")
}
