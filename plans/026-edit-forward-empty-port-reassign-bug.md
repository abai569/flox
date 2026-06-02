# 026 - Edit Forward Rule Empty Port Reassign Bug

## Background
编辑规则时，用户清空入口端口后保存，期望重新随机分配端口，但实际保留了原端口。

## Root Cause
`go-backend/internal/http/handler/mutations.go:3089-3097`

`forwardUpdate` 中非 nftables 分支的端口处理逻辑：

```go
port := asInt(req["inPort"], 0)
if port <= 0 {
    minPort := h.repo.GetMinForwardPort(id)  // ← 查询旧端口复用
    if minPort.Valid {
        port = int(minPort.Int64)
    }
    if port <= 0 {
        port = h.pickTunnelPort(tunnelID)
    }
}
```

当 `inPort` 为空/0 时，先调用 `GetMinForwardPort` 查询旧端口复用。只有在旧端口无效时才分配新端口。

而创建规则时 (line 2943) 没有 `GetMinForwardPort` 回退，空端口直接走 `pickTunnelPort`。

## Fix
去掉 `GetMinForwardPort` 回退，让编辑行为和创建行为一致：空端口直接重新随机分配。

修改内容：
- 删除 `minPort := h.repo.GetMinForwardPort(id)` 及其 `if minPort.Valid` 分支
- 空端口直接走 `pickTunnelPort(tunnelID)`
- 新增 `if port <= 0 { port = 10000 }` 兜底保护

## Tasks

- [x] Write plan document
- [x] Fix forwardUpdate port logic in mutations.go
- [x] Build and verify
- [ ] Commit and push
