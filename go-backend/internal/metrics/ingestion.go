package metrics

import (
	"context"
	"log"
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
	nodeID                 int64
	timestamp              int64
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
	tcpConns               int64
	udpConns               int64
	netInSpeed             int64
	netOutSpeed            int64
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
		agg = &nodeMetricAggregate{nodeID: nodeID, timestamp: now}
		s.nodeBuffer[nodeID] = agg
	}
	agg.timestamp = now
	agg.count++
	agg.bytesReceived += info.BytesReceived
	agg.bytesTransmitted += info.BytesTransmitted
	agg.periodBytesReceived += info.PeriodBytesReceived
	agg.periodBytesTransmitted += info.PeriodBytesTransmitted
	agg.cpuUsageSum += info.CPUUsage
	agg.memoryUsageSum += info.MemoryUsage
	agg.diskUsageSum += info.DiskUsage
	agg.load1Sum += info.Load1
	agg.load5Sum += info.Load5
	agg.load15Sum += info.Load15
	agg.tcpConns += info.TCPConns
	agg.udpConns += info.UDPConns
	agg.netInSpeed += info.NetInSpeed
	agg.netOutSpeed += info.NetOutSpeed
	if info.Uptime > agg.uptimeMax {
		agg.uptimeMax = info.Uptime
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
	metrics := make([]*model.NodeMetric, 0, len(buffer))
	for _, agg := range buffer {
		if agg == nil || agg.count <= 0 {
			continue
		}
		metrics = append(metrics, &model.NodeMetric{
			NodeID:      agg.nodeID,
			Timestamp:   agg.timestamp,
			CPUUsage:    agg.cpuUsageSum / float64(agg.count),
			MemUsage:    agg.memoryUsageSum / float64(agg.count),
			DiskUsage:   agg.diskUsageSum / float64(agg.count),
			NetInBytes:  int64(agg.bytesReceived),
			NetOutBytes: int64(agg.bytesTransmitted),
			NetInSpeed:  agg.netInSpeed,
			NetOutSpeed: agg.netOutSpeed,
			Load1:       agg.load1Sum / float64(agg.count),
			Load5:       agg.load5Sum / float64(agg.count),
			Load15:      agg.load15Sum / float64(agg.count),
			TCPConns:    agg.tcpConns,
			UDPConns:    agg.udpConns,
			Uptime:      int64(agg.uptimeMax),
			PeriodRx:    int64(agg.periodBytesReceived),
			PeriodTx:    int64(agg.periodBytesTransmitted),
		})
	}
	if len(metrics) == 0 {
		return
	}
	if err := s.repo.InsertNodeMetricBatch(metrics); err != nil {
		log.Printf("monitoring write failed op=node_metric.flush count=%d err=%v", len(metrics), err)
	}
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
	return s.repo.GetNodeMetrics(nodeID, startMs, endMs)
}
