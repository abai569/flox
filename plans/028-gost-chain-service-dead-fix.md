# 028 - GOST 链节点服务失效与诊断不匹配修复

## 背景

用户反馈链式隧道运行一段时间后，入口节点无法连接到出口节点（TCP 连接失败），但出口节点访问外网正常。重新保存隧道后立即恢复。

同时存在诊断显示正常但实际转发不通的情况。

## 根因分析

### 根因 1（P0）：GOST Agent 服务退出后无自动恢复

**位置：** `go-gost/x/service/service.go:189-243`

`Serve()` 的 accept 循环在 listener 被关闭后退出：
```go
conn, e := s.listener.Accept()
if e != nil {
    // ...
    s.setState(StateClosed)
    return e  // goroutine 退出
}
```

**问题：** goroutine 退出后，服务仍留在 `ServiceRegistry` 中，没有任何自动注销或重启机制。

**触发场景：**
- TLS listener 异常导致底层 listener 被关闭
- 文件描述符耗尽，accept 失败后重试退出
- 其他运行时错误导致 accept 循环退出

### 根因 2（P1）：WebSocket 重连后不自动恢复服务

**位置：** `go-gost/x/socket/websocket_reporter.go:256-301`

WebSocket 断连后 agent 会自动重连，但重连后仅发送心跳和系统信息，不会：
- 检查已注册服务是否仍在监听
- 自动从 `gost.json` 重新加载配置
- 重启已停止的服务

### 根因 3（P2）：后端清理命令错误被静默丢弃

**位置：** `go-backend/internal/http/handler/mutations.go:1502-1524`

```go
_, _ = h.sendNodeCommand(row.NodeID, "DeleteChains", ..., false, true)
_, _ = h.sendNodeCommand(row.NodeID, "DeleteService", ..., false, true)
```

`cleanupTunnelRuntime` 对节点离线/超时错误静默丢弃。如果旧服务的 `DeleteService` 没送到节点，旧服务残留；新服务创建时可能冲突。

### 根因 4（P3）：诊断只测 TCP ping，不测服务状态

**位置：** `go-backend/internal/http/handler/control_plane.go:1182-1200`

`appendChainHopDiagnosis` 只做 TCP ping，不验证 GOST 服务的 TLS 握手或 relay 协议响应。无法区分"端口开放但服务已死"和"服务正常运行"。

### 根因 5（P4）：nftables 模式下 `resolveChainNextHop` 退化

**位置：** `go-backend/internal/http/handler/control_plane.go:2225-2231`

当链节点 `ConnectIP` 为空时，nftables DNAT 规则退化到最终 target，完全绕过链式节点。

## 修复方案

### 修复 1：Agent 侧增加服务状态监控和自动恢复

**文件：** `go-gost/x/socket/service.go`

1. 在 `createServices` 启动服务后，为每个服务启动一个 watchdog goroutine
2. watchdog 定期（每 30 秒）检查服务状态
3. 发现 `StateClosed` 的服务时，自动从 `gost.json` 重新加载配置并重启

### 修复 2：WebSocket 重连后自动同步配置

**文件：** `go-gost/x/socket/websocket_reporter.go`

1. 在 `handleConnection` 的 `connect()` 成功后，增加配置同步逻辑
2. 对比 `ServiceRegistry` 当前状态与 `gost.json` 配置
3. 对缺失的服务自动重新创建

### 修复 3：后端清理增加重试和日志

**文件：** `go-backend/internal/http/handler/mutations.go`

1. `cleanupTunnelRuntime` 改为带重试的清理（最多 3 次）
2. 最终失败时记录错误日志而非静默丢弃

### 修复 4：诊断增加服务状态验证

**文件：** `go-backend/internal/http/handler/control_plane.go`

1. 在 `appendChainHopDiagnosis` 中，TCP ping 成功后增加 GOST 协议级验证
2. 或增加新的诊断命令 `CheckServiceStatus` 让 agent 返回服务状态

### 修复 5：修复 `resolveChainNextHop`

**文件：** `go-backend/internal/http/handler/control_plane.go`

1. 当 `ConnectIP` 为空时，从 nodeRecord 获取实际 IP
2. 不再退化到 finalTarget

## 任务清单

- [x] 修复 1：Agent 侧服务 watchdog 自动恢复
- [x] 修复 2：Agent 侧 WebSocket 重连后配置同步
- [x] 修复 3：后端 cleanupTunnelRuntime 重试和日志
- [ ] 修复 4：诊断增加服务状态验证（后续迭代：需在 agent 新增 `ListServices` 命令）
- [x] 修复 5：resolveChainNextHop 退化修复
- [x] 验证：诊断 contract 测试通过 (`TestDiagnosisChainCoverageContracts`, `TestDiagnosisUsesFederationRuntimeForRemoteNodes`)
- [x] 验证：联邦 contract 测试通过 (`TestFederationDualPanelMiddleExitAutoPortContract` 等)
- [x] 验证：后端编译通过 `go build ./...`
- [x] 验证：Agent 编译通过 `go build .`
