# 001-gost-ipv6-domain-bracket-fix

## 问题描述

Gost 模式下，落地地址填写域名时，解析出的 IPv6 地址缺少中括号，导致格式错误：
- 输入：`kddi.folern.com:30011`
- 错误结果：`240f:108:760f:41:80:a5ff:fef8:7a32:30011`（无效格式）
- 正确格式：`[240f:108:760f:41:80:a5ff:fef8:7a32]:30011`

## 根因分析

### 代码路径对比

| 模式 | 调用链 | 是否调用 `resolveTargetIP` |
|------|--------|--------------------------|
| **NFTables** | `buildNftablesRulePayloads` → `splitRemoteTargets` → `resolveTargetIP` | ✅ 是 |
| **Gost** | `buildForwardServiceConfigs` → `splitRemoteTargets` → `buildForwarderNodes` | ❌ **否** |

### 关键代码位置

**Gost 模式 - `go-backend/internal/http/handler/control_plane.go:1710-1751`**
```go
func buildForwardServiceConfigs(...) {
    targets := splitRemoteTargets(forward.RemoteAddr)  // 只按逗号分割
    // ❌ 没有调用 resolveTargetIP()
    ...
    "forwarder": map[string]interface{}{
        "nodes": buildForwarderNodes(targets),  // 域名原样传给 Agent
    },
}
```

**NFTables 模式 - `go-backend/internal/http/handler/control_plane.go:2146-2148`**
```go
targets := splitRemoteTargets(forward.RemoteAddr)
for i, t := range targets {
    targets[i] = resolveTargetIP(t)  // ✅ 解析域名并添加中括号
}
```

### `resolveTargetIP` 函数逻辑 - `control_plane.go:1837-1857`
```go
func resolveTargetIP(target string) string {
    host, port, err := net.SplitHostPort(target)
    if err != nil {
        return target
    }
    if net.ParseIP(host) != nil {
        return target  // 已是 IP，直接返回
    }
    ips, err := net.LookupHost(host)
    if err != nil || len(ips) == 0 {
        return target  // 解析失败返回原域名
    }
    if strings.Contains(ips[0], ":") {
        return "[" + ips[0] + "]:" + port  // ✅ IPv6 添加中括号
    }
    return ips[0] + ":" + port
}
```

## 修复方案

### 方案：Gost 模式也调用 `resolveTargetIP`

在 `buildForwardServiceConfigs` 函数中，对 targets 进行解析：

**修改位置：** `go-backend/internal/http/handler/control_plane.go:1713`

**修改前：**
```go
targets := splitRemoteTargets(forward.RemoteAddr)
```

**修改后：**
```go
targets := splitRemoteTargets(forward.RemoteAddr)
for i, t := range targets {
    targets[i] = resolveTargetIP(t)
}
```

### 优点
1. 与 NFTables 模式行为一致
2. 面板端统一解析，Agent 端无需处理
3. IPv6 格式保证正确
4. 修改点集中，风险低

### 注意事项
1. Gost 模式失去运行时 DNS 更新的灵活性（但 DNS 定时刷新任务已存在）
2. 域名解析失败时 `resolveTargetIP` 会返回原域名，不影响现有逻辑
3. 需要确保 Agent 端的 DNS 配置正确（支持 IPv6 解析）

## 任务清单

- [ ] 修改 `buildForwardServiceConfigs` 函数，添加 `resolveTargetIP` 调用
- [ ] 验证 Gost 模式下域名解析为 IPv6 时格式正确
- [ ] 验证 Gost 模式下域名解析为 IPv4 时格式正确
- [ ] 验证 Gost 模式下直接填写 IP 地址时不受影响
- [ ] 验证域名解析失败时回退到原域名

## 测试用例

1. **IPv6 域名解析测试**
   - 输入：`kddi.folern.com:30011`（解析为 IPv6）
   - 预期：`[240f:108:760f:41:80:a5ff:fef8:7a32]:30011`

2. **IPv4 域名解析测试**
   - 输入：`example.com:8080`（解析为 IPv4）
   - 预期：`93.184.216.34:8080`

3. **直接填写 IPv6 地址测试**
   - 输入：`[2001:db8::1]:8080`
   - 预期：`[2001:db8::1]:8080`（不变）

4. **直接填写 IPv4 地址测试**
   - 输入：`1.2.3.4:8080`
   - 预期：`1.2.3.4:8080`（不变）

5. **域名解析失败测试**
   - 输入：`invalid.domain.example:8080`
   - 预期：`invalid.domain.example:8080`（回退到原域名）
