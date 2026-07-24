# 节点实例流量实时统计方案

## 背景

当前实例流量统计依赖节点上线时同步一次网卡流量，存在以下问题：
- 节点在线期间产生的流量无法实时体现
- 用户看到的流量数据严重滞后
- 流量限额检查不准确

## 目标

实现节点实例流量的实时统计，用户看到的流量数据延迟不超过 2 秒。

## 方案概述

利用节点每 2 秒上报一次系统指标（含网卡累计流量 `NetInBytes/NetOutBytes`）的机制，在每次指标上报时实时计算流量差值并累加到实例流量。

## 核心设计

### 1. 内存缓存层

```
nodeNetTrafficCache (sync.Map)
  key:   "nodeID:instanceID"
  value: { LastSyncNetInBytes, LastSyncNetOutBytes, LastSyncTime }
```

- 节点每次上报指标时，从内存缓存读取上次同步值
- 计算差值：`diff = currentNet - lastSyncNet`
- 差值 > 0 时累加到实例 `total_in_flow/total_out_flow`
- 更新内存缓存

### 2. 网卡归零检测

```go
if currentNet < lastSyncNet {
    // 网卡归零（节点重启）
    diff = currentNet  // 从 0 重新开始
} else {
    diff = currentNet - lastSyncNet
}
```

节点重启后网卡流量从 0 开始，自动检测并处理，不会导致流量为负。

### 3. 定期持久化

- 频率：每 1 分钟
- 将内存缓存中的 `last_sync_net_bytes` 写入数据库
- 面板重启时从数据库重新加载缓存，不丢数据

### 4. 面板重启恢复

```
面板启动 → 查询所有实例的 last_sync_net_bytes → 加载到内存缓存
```

## 数据流

```
节点 (每2秒)
  ↓ 上报 NetInBytes/NetOutBytes
面板 WebSocket 处理
  ↓
读取内存缓存 last_sync_net_bytes
  ↓
计算差值 diff
  ↓
diff > 0 → repo.AdjustNodeInstanceTraffic(nodeID, instanceID, inDiff, outDiff)
  ↓
更新内存缓存 currentNet → last_sync_net_bytes
  ↓
定时任务 (每1分钟) → 持久化到数据库
```

## 父节点流量

父节点流量 = 所有实例流量之和 × 节点倍率（实时计算，已实现）

## 流量限额检查

- 使用实例的 `total_in_flow + total_out_flow`
- 实时统计后，限额检查更准确
- 超限立即暂停节点

## 流量归零

归零日自动重置：
- 实例 `total_in_flow/total_out_flow` → 0
- 数据库 `last_sync_net_in_bytes/last_sync_net_out_bytes` → 0
- 内存缓存对应条目删除

手动归零同理。

## 手动矫正

保留手动矫正功能，用于以下场景：
1. 新节点接入时设置初始流量值
2. Bug 导致统计错误时人工纠偏
3. 业务调整（赠送流量等）

前端加提示："仅在流量异常时使用，正常情况下系统会自动统计"

### 手动矫正输入框位置

在编辑实例弹窗中，"流量限额"和"流量累计模式"下方新增"已用流量(GB)"输入框：
- 默认值：当前实例的 `totalInFlow + totalOutFlow`（GB）
- 留空：不矫正
- 输入目标值：保存时自动计算差值，按当前上下行比例分配

## 流量累计模式锁定

### 问题

选了"终身累计"保存后，再点编辑又变成"按月累计"。

### 原因

后端只在首次设置流量限额时才写入 `traffic_limit_mode`，已有流量限额的实例修改模式会被静默丢弃。前端下拉框始终可操作，但后端不保存。

### 修复方案（B：锁定模式）

- 前端：已有流量限额时禁用下拉框，显示"首次设置后不可更改"
- 后端：保持现有逻辑不变

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `go-backend/internal/http/handler/monitoring.go` | 节点指标上报处理中增加实时流量同步 |
| `go-backend/internal/http/handler/jobs.go` | 添加定时持久化任务 |
| `go-backend/internal/http/handler/upgrade.go` | 移除 `onNodeInstanceOnline` 中的同步逻辑（改为缓存加载） |
| `go-backend/internal/store/repo/repository_node_instances.go` | 添加缓存加载方法 |
| `go-backend/internal/store/model/model.go` | 保留 `last_sync_net_in_bytes/last_sync_net_out_bytes` 字段 |
| `vite-frontend/src/pages/node.tsx` | 1. 流量累计模式下拉框添加禁用条件 2. 新增"已用流量"输入框 |

## 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 节点首次上报 | 从数据库加载 last_sync_net_bytes，无记录则从 0 开始 |
| 节点重启（网卡归零） | 检测 currentNet < lastSyncNet，从 0 重新计算 |
| 面板重启 | 启动时从数据库加载所有实例的 last_sync_net_bytes 到内存缓存 |
| 实例删除 | 删除内存缓存对应条目 |
| 流量归零 | 重置实例流量 + 重置 last_sync_net_bytes + 删除内存缓存 |
| 节点离线 | 不处理，下次上报时自动继续 |

## 性能评估

- 每次指标上报：1 次内存读 + 1 次内存写 + 条件性 1 次 DB 写
- 内存缓存使用 `sync.Map`，无锁竞争
- 定时持久化：批量更新，每 1 分钟一次
- 预计对现有性能影响可忽略

## 实施步骤

1. 添加内存缓存结构体和全局变量
2. 在节点指标上报处理中添加实时同步逻辑
3. 添加定时持久化任务
4. 面板启动时加载缓存
5. 更新流量归零逻辑（清理缓存）
6. 前端手动矫正加提示
7. 测试验证
