# 023 - Node Traffic Reset Log Fixes

## Background
节点页面流量归零记录功能存在 4 个 bug，涉及后端清理逻辑、鉴权缺失、以及前端字段使用不一致。

## Changes

### 1. Fix cleanup logic — only deletes 1 log instead of trimming to 30

**Files:** `go-backend/internal/store/repo/repository_mutations.go`
- `cleanupNodeTrafficResetLogs` (L3238-3261)
- `cleanupForwardTrafficResetLogs` (L3126-3149)

**Problem:** When `count > 30`, the code finds the single oldest log via `Order("created_time ASC").First()` and deletes `WHERE created_time <=` that timestamp — which only removes 1 log.

**Fix:** Use `Order("created_time DESC").Offset(29).Limit(1)` to find the 30th-from-newest log as cutoff, then delete everything with `created_time <` that timestamp.

### 2. Add auth check to `deleteNodeTrafficResetLog` and `deleteForwardTrafficResetLog`

**Files:** `go-backend/internal/http/handler/forward_traffic.go`
- `deleteNodeTrafficResetLog` (L201-226)
- `deleteForwardTrafficResetLog` (L228-253)

**Problem:** Both handlers have zero authentication — no JWT validation, no role check.

**Fix:** Add `userRoleFromRequest(r)` call and verify admin role (`actorRole != 1`).

### 3. Add auth check to `nodeTrafficResetLogs`

**Files:** `go-backend/internal/http/handler/forward_traffic.go`
- `nodeTrafficResetLogs` (L154-199)

**Problem:** Validates token but discards role — any authenticated user can query any node's reset logs.

**Fix:** Add admin role check (`actorRole != 1`).

### 4. Fix frontend batch reset using wrong metric fields

**Files:** `vite-frontend/src/pages/node.tsx`
- `handleBatchResetTraffic` (L1466-1477)

**Problem:** Batch reset reads `metrics.uploadTraffic/downloadTraffic` (total cumulative) instead of `metrics.periodTraffic?.tx/rx` (cycle traffic).

**Fix:** Use `metrics?.periodTraffic?.tx` and `metrics?.periodTraffic?.rx` (same as single reset, L1117-1118).

## Tasks

- [x] Write plan document
- [ ] Fix cleanup logic in `cleanupNodeTrafficResetLogs` and `cleanupForwardTrafficResetLogs`
- [ ] Add auth check to `deleteNodeTrafficResetLog`
- [ ] Add auth check to `deleteForwardTrafficResetLog`
- [ ] Add auth check to `nodeTrafficResetLogs`
- [ ] Fix batch reset metric fields in `handleBatchResetTraffic`
