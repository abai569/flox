# 027 - Forward Batch Pause/Resume Logic Fixes

## Background
批量暂停/启用的完整逻辑审查中发现 3 个 bug：

### Bug A: forwardBatchPause TerminateConnections 失败导致状态不回写
**File:** `mutations.go:3599-3603`

之前修复计数翻倍加了 `continue`，但 `TerminateConnections` 失败时跳过 `UpdateForwardStatus`，导致数据库状态仍为"正常"（1），而端口实际已不通。

单条 `forwardPause`（`mutations.go:3376-3378`）处理正确——只打日志，不中断流程。

### Bug B: forwardBatchResume 缺少预先状态更新（竞争条件）
**File:** `mutations.go:3649-3660`

单条 `forwardResume`（`mutations.go:3417`）预先将 status 更新为 1，避免 `syncForwardServicesWithWarnings` 检查到规则未启用而删除刚添加的服务。

批量 `forwardBatchResume` 没有这一步，如果 `ResumeService` 执行过程中定时器触发到期/超限检查，会暂停刚启用的规则。

### Bug C: forwardBatchPause nftables 分支错误被吞
**File:** `mutations.go:3591`

`deleteForwardServiceBasesOnNode` 返回值用 `_` 忽略，失败时静默继续。应计入失败。

## Changes

### Fix A - forwardBatchPause TerminateConnections
将 `continue` + 失败计数 改为只打日志，和单条 `forwardPause` 一致。

### Fix B - forwardBatchResume pre-status update
在 `for` 循环中、`ResumeService` 之前加入 `_ = h.repo.UpdateForwardStatus(id, 1, now)`，和单条 `forwardResume` 一致。

### Fix C - forwardBatchPause nftables error handling
将 `_ = h.deleteForwardServiceBasesOnNode(...)` 改为检查错误并计入失败。

## Tasks

- [x] Write plan document
- [ ] Fix A: TerminateConnections 只打日志不中断
- [ ] Fix B: forwardBatchResume 加预置状态
- [ ] Fix C: nftables 错误处理
- [ ] Build and verify
- [ ] Commit and push
