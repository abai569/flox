# 024 - Forward Traffic Reset Log Delete Refresh Bug

## Background
规则页面（Forward）流量归零记录的删除后刷新逻辑中存在数据路径错误，导致删除后日志列表渲染异常。同时也修复 API 类型声明与后端实际返回结构不匹配的问题。

## Changes

### 1. Fix delete log refresh data path — uses `data` instead of `data.logs`

**File:** `vite-frontend/src/pages/forward.tsx:2409`

**Problem:** 删除日志后重新获取列表时，使用了 `refreshRes.data || []`，但后端返回的 `data` 是一个 `{forwardId, forwardName, logs: [...]}` 对象，不是数组。这会导致 `trafficResetLogs`（`any[]`）被赋值为对象，UI 渲染异常（`.length`/`.map()` 报错）。

初始加载 line 2383 正确使用了 `(res.data as any)?.logs || []`。

**Fix:** 统一使用 `(refreshRes.data as any)?.logs || []`，与初始加载保持一致。

### 2. Fix API type declarations — mismatch with actual response shape

**Files:**
- `vite-frontend/src/api/index.ts:414-430` (`getForwardTrafficResetLogs`)
- `vite-frontend/src/api/index.ts:433-447` (`getNodeTrafficResetLogs`)

**Problem:** 泛型声明为 `{...}[]`（数组），但后端实际返回 `{forwardId, forwardName, logs: [...]}` 对象。类型擦除后不报错，但会引起调用方误用（正是 Bug 1 的诱因）。

**Fix:** 将泛型改为 `{ logs: {...}[] }` 对象包裹类型，使 TypeScript 类型准确反映后端响应结构。

## Tasks

- [x] Write plan document
- [ ] Fix delete log refresh data path in `forward.tsx`
- [ ] Fix `getForwardTrafficResetLogs` type in `api/index.ts`
- [ ] Fix `getNodeTrafficResetLogs` type in `api/index.ts`
