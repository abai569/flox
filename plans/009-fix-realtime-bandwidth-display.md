# Plan 009: Fix Real-time Bandwidth Display Issues

**Created:** Sun May 03 2026  
**Status:** Completed  
**Issue:** 实时带宽显示不稳定，一会有值一会显示 `-`

## Problem Analysis

### Root Causes

1. **Bandwidth Calculator State Loss** (`go-gost/x/stats/forward_collector.go`)
   - `prevStats` was a closure variable in `Start()` method
   - Lost state between calculation cycles
   - New forwarding rules showed 0 speed in first cycle
   - Rules temporarily disappearing caused re-initialization

2. **Agent Stops Reporting When No Traffic** (`go-gost/x/socket/websocket_reporter.go`)
   - `collectForwardMetrics()` returned `nil` when no metrics
   - Panel received empty data and cleared cache
   - Frontend displayed `-` instead of `0 B/s`

3. **Panel Metrics Cleanup Too Aggressive** (`go-backend/internal/ws/server.go`)
   - No tracking of node offline time
   - No graceful handling of temporary disconnections
   - Metrics lost immediately when node disconnected

## Changes Made

### 1. Fix Bandwidth Calculator State (`go-gost/x/stats/forward_collector.go`)

**Before:**
```go
type BandwidthCalculator struct {
    interval time.Duration
    stopChan chan struct{}
}

func (c *BandwidthCalculator) Start(manager *ForwardStatsManager) {
    go func() {
        prevStats := make(map[int64]struct{...}) // Lost on each call!
        for {
            select {
            case <-ticker.C:
                c.calculate(manager, prevStats)
            }
        }
    }()
}
```

**After:**
```go
type BandwidthCalculator struct {
    interval time.Duration
    stopChan chan struct{}
    prevStats map[int64]struct{...} // Persistent state
    prevStatsMu sync.RWMutex
}

func (c *BandwidthCalculator) Start(manager *ForwardStatsManager) {
    go func() {
        for {
            select {
            case <-ticker.C:
                c.calculate(manager) // Uses instance field
            }
        }
    }()
}

func (c *BandwidthCalculator) calculate(manager *ForwardStatsManager) {
    c.prevStatsMu.Lock()
    defer c.prevStatsMu.Unlock()
    // ... uses c.prevStats with proper locking
}
```

**Benefits:**
- State persists across calculation cycles
- Proper mutex protection for concurrent access
- Delayed cleanup (5 minutes) prevents premature data loss

### 2. Agent Always Reports Metrics (`go-gost/x/socket/websocket_reporter.go`)

**Before:**
```go
func collectForwardMetrics() []ForwardMetric {
    if len(internalMetrics) == 0 {
        return nil  // Panel clears cache!
    }
    // ...
}
```

**After:**
```go
func collectForwardMetrics() []ForwardMetric {
    if len(internalMetrics) == 0 {
        return []ForwardMetric{}  // Empty array, not nil
    }
    // ...
}
```

**Benefits:**
- Panel maintains cache even with no traffic
- Frontend shows `0 B/s` instead of `-`
- Consistent data flow for monitoring

### 3. Panel Graceful Metrics Cleanup (`go-backend/internal/ws/server.go`)

**Added:**
- `nodeOfflineTime map[int64]int64` - Track when nodes go offline
- `cleanupStaleMetrics()` - Background job to clean old data
- 10-minute grace period before cleaning metrics

**Behavior:**
- Node disconnects → Record offline time, keep metrics
- Node reconnects → Clear offline time, preserve metrics
- Offline > 10 minutes → Clean up metrics

**Benefits:**
- Temporary disconnections don't lose data
- Bandwidth continues showing after reconnection
- Automatic cleanup prevents memory leaks

## Testing Checklist

- [ ] Agent builds successfully
- [ ] Panel builds successfully
- [ ] New forwarding rules show speed immediately (not 0)
- [ ] Rules with no traffic show `0 B/s` (not `-`)
- [ ] Node disconnection preserves metrics for 10 minutes
- [ ] Node reconnection maintains bandwidth display
- [ ] Memory usage stable over time

## Files Modified

1. `go-gost/x/stats/forward_collector.go` - Bandwidth calculator state fix
2. `go-gost/x/socket/websocket_reporter.go` - Always report metrics
3. `go-backend/internal/ws/server.go` - Graceful metrics cleanup

## Related Issues

- Improves user experience for real-time monitoring
- Reduces support tickets about "bandwidth not showing"
- Better handling of network instability
