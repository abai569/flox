package metrics

import (
	"context"
	"testing"
	"time"

	"go-backend/internal/store/repo"
)

func TestRecordNodeMetric(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	info := SystemInfo{
		Uptime:           86400,
		BytesReceived:    1024000,
		BytesTransmitted: 2048000,
		CPUUsage:         45.5,
		MemoryUsage:      60.2,
		DiskUsage:        30.1,
		Load1:            1.5,
		Load5:            1.2,
		Load15:           0.9,
		TCPConns:         100,
		UDPConns:         50,
		NetInSpeed:       51200,
		NetOutSpeed:      102400,
	}

	svc.RecordNodeMetric(1, info)
	svc.flushNodeMetrics()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}

	m := metrics[0]
	if m.CPUUsage != 45.5 {
		t.Fatalf("expected CPUUsage 45.5, got %f", m.CPUUsage)
	}
	if m.MemUsage != 60.2 {
		t.Fatalf("expected MemUsage 60.2, got %f", m.MemUsage)
	}
	if m.DiskUsage != 30.1 {
		t.Fatalf("expected DiskUsage 30.1, got %f", m.DiskUsage)
	}
	if m.Load1 != 1.5 {
		t.Fatalf("expected Load1 1.5, got %f", m.Load1)
	}
	if m.TCPConns != 100 {
		t.Fatalf("expected TCPConns 100, got %d", m.TCPConns)
	}
	if m.UDPConns != 50 {
		t.Fatalf("expected UDPConns 50, got %d", m.UDPConns)
	}
}

func TestRecordNodeMetricAutoFlush(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	info := SystemInfo{
		CPUUsage:    50.0,
		MemoryUsage: 60.0,
		DiskUsage:   30.0,
	}

	for i := 0; i < 250; i++ {
		svc.RecordNodeMetric(1, info)
	}

	time.Sleep(100 * time.Millisecond)

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected one aggregated metric after auto-flush, got %d", len(metrics))
	}
}

func TestIngestionServiceStart(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)
	svc.flushInterval = 100 * time.Millisecond

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	info := SystemInfo{
		CPUUsage:    45.0,
		MemoryUsage: 55.0,
		DiskUsage:   35.0,
	}

	go svc.Start(ctx)

	for i := 0; i < 10; i++ {
		svc.RecordNodeMetric(1, info)
		time.Sleep(50 * time.Millisecond)
	}

	<-ctx.Done()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) == 0 {
		t.Fatalf("expected metrics after service run")
	}
}

func TestGetLatestMetric(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	now := time.Now().UnixMilli()

	info1 := SystemInfo{CPUUsage: 40.0, MemoryUsage: 50.0, DiskUsage: 30.0}
	svc.RecordNodeMetric(1, info1)

	time.Sleep(5 * time.Millisecond)

	info2 := SystemInfo{CPUUsage: 60.0, MemoryUsage: 70.0, DiskUsage: 40.0}
	svc.RecordNodeMetric(1, info2)

	svc.flushNodeMetrics()

	latest, err := svc.GetLatestMetric(1)
	if err != nil {
		t.Fatalf("get latest: %v", err)
	}
	if latest == nil {
		t.Fatalf("expected latest metric")
	}
	if latest.CPUUsage != 50.0 {
		t.Fatalf("expected aggregated CPUUsage 50.0, got %f", latest.CPUUsage)
	}

	_ = now

	latestNone, err := svc.GetLatestMetric(999)
	if err != nil {
		t.Fatalf("get latest for non-existent: %v", err)
	}
	if latestNone != nil {
		t.Fatalf("expected nil for non-existent node")
	}
}

func TestGetMetricsWithTimeRange(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	now := time.Now().UnixMilli()

	for i := 0; i < 5; i++ {
		info := SystemInfo{
			CPUUsage:    float64(40 + i*5),
			MemoryUsage: 50.0,
			DiskUsage:   30.0,
		}
		svc.RecordNodeMetric(1, info)
		time.Sleep(10 * time.Millisecond)
	}

	svc.flushNodeMetrics()

	metrics, err := svc.GetMetrics(1, now-60000, now+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 aggregated metric, got %d", len(metrics))
	}
}

func TestRecordNodeMetricAggregatesInstances(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)
	svc.RecordNodeMetric(1, SystemInfo{InstanceID: "a", CPUUsage: 20, MemoryUsage: 40, DiskUsage: 60, TCPConns: 10, UDPConns: 5, NetInSpeed: 100, NetOutSpeed: 200, BytesReceived: 1000, BytesTransmitted: 2000})
	svc.RecordNodeMetric(1, SystemInfo{InstanceID: "b", CPUUsage: 40, MemoryUsage: 60, DiskUsage: 80, TCPConns: 30, UDPConns: 15, NetInSpeed: 300, NetOutSpeed: 400, BytesReceived: 3000, BytesTransmitted: 4000})
	svc.flushNodeMetrics()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}
	m := metrics[0]
	if m.CPUUsage != 30 || m.MemUsage != 50 || m.DiskUsage != 70 {
		t.Fatalf("expected averaged usage 30/50/70, got %.2f/%.2f/%.2f", m.CPUUsage, m.MemUsage, m.DiskUsage)
	}
	if m.TCPConns != 40 || m.UDPConns != 20 || m.NetInSpeed != 400 || m.NetOutSpeed != 600 {
		t.Fatalf("expected summed network values, got tcp=%d udp=%d in=%d out=%d", m.TCPConns, m.UDPConns, m.NetInSpeed, m.NetOutSpeed)
	}
}

func TestRecordNodeMetricKeepsLatestCumulativePerInstance(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)
	svc.RecordNodeMetric(1, SystemInfo{InstanceID: "a", BytesReceived: 1000, BytesTransmitted: 2000, PeriodBytesReceived: 100, PeriodBytesTransmitted: 200})
	svc.RecordNodeMetric(1, SystemInfo{InstanceID: "a", BytesReceived: 1500, BytesTransmitted: 2500, PeriodBytesReceived: 150, PeriodBytesTransmitted: 250})
	svc.RecordNodeMetric(1, SystemInfo{InstanceID: "b", BytesReceived: 3000, BytesTransmitted: 4000, PeriodBytesReceived: 300, PeriodBytesTransmitted: 400})
	svc.flushNodeMetrics()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}
	m := metrics[0]
	if m.NetInBytes != 4500 || m.NetOutBytes != 6500 || m.PeriodRx != 450 || m.PeriodTx != 650 {
		t.Fatalf("expected latest cumulative totals, got in=%d out=%d rx=%d tx=%d", m.NetInBytes, m.NetOutBytes, m.PeriodRx, m.PeriodTx)
	}
}

func TestPruneMetrics(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)
	svc.retentionDays = 1

	info := SystemInfo{CPUUsage: 50.0, MemoryUsage: 60.0, DiskUsage: 30.0}

	svc.RecordNodeMetric(1, info)
	svc.flushNodeMetrics()

	svc.pruneMetrics()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric (not pruned), got %d", len(metrics))
	}
}

func TestMultipleNodes(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	info := SystemInfo{
		CPUUsage:    50.0,
		MemoryUsage: 60.0,
		DiskUsage:   30.0,
	}

	svc.RecordNodeMetric(1, info)
	svc.RecordNodeMetric(2, info)
	svc.RecordNodeMetric(3, info)

	svc.flushNodeMetrics()

	for nodeID := int64(1); nodeID <= 3; nodeID++ {
		metrics, err := r.GetNodeMetrics(nodeID, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
		if err != nil {
			t.Fatalf("get metrics for node %d: %v", nodeID, err)
		}
		if len(metrics) != 1 {
			t.Fatalf("expected 1 metric for node %d, got %d", nodeID, len(metrics))
		}
	}
}

func TestZeroValues(t *testing.T) {
	r, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	defer r.Close()

	svc := NewIngestionService(r)

	info := SystemInfo{}

	svc.RecordNodeMetric(1, info)
	svc.flushNodeMetrics()

	metrics, err := r.GetNodeMetrics(1, time.Now().UnixMilli()-60000, time.Now().UnixMilli()+1000)
	if err != nil {
		t.Fatalf("get metrics: %v", err)
	}
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}

	m := metrics[0]
	if m.CPUUsage != 0 || m.MemUsage != 0 || m.DiskUsage != 0 {
		t.Fatalf("expected zero values, got CPU=%f Mem=%f Disk=%f", m.CPUUsage, m.MemUsage, m.DiskUsage)
	}
}
