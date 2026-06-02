# 025 - Forward Batch Pause Double Count Fix

## Background
规则页面批量停用时，toast 提示出现「成功 5 项，失败 5 项」这种总数翻倍的问题。

## Root Cause
`go-backend/internal/http/handler/mutations.go:3594-3608`

`forwardBatchPause` 的非 nftables 分支里，先执行 `PauseService`，再执行 `TerminateConnections`：

```go
if err := h.controlForwardServices(forward, "PauseService", false); err != nil {
    f++
    failures = appendBatchFailure(failures, id, forward.Name, err)
    continue
}
if err := h.controlForwardServices(forward, "TerminateConnections", false); err != nil {
    f++
    failures = appendBatchFailure(failures, id, forward.Name, err)
    // ← 缺少 continue，代码继续往下走
}
if err := h.repo.UpdateForwardStatus(id, 0, ...); err != nil {
    f++
    ...
} else {
    s++   // ← 同一项又被算成成功
}
```

当 `PauseService` 成功、`TerminateConnections` 失败时，同一规则被同时计入失败和成功，导致总数翻倍。

`forwardBatchResume` 没有 `TerminateConnections` 这一步，所以不受影响。nftables 分支也没有第二个独立操作，所以也没问题。

## Fix
在 `TerminateConnections` 失败块末尾加 `continue`。

## Tasks

- [x] Write plan document
- [ ] Add `continue` after `TerminateConnections` failure in `mutations.go`
- [ ] Build and verify
- [ ] Commit and push
