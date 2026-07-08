# WGMimic 转发模式 Bug 修复与增强计划

## 0. 背景

对比 MKCloudAreYouOk（shell 版 WGMimic 部署工具）后发现 FLOX 的 Go 实现存在多个严重缺陷。本计划按优先级分三阶段修复。

对比参考：https://github.com/GHUNLIL/MKCloudAreYouOk

---

## 1. 问题汇总

### P0 — 生产阻塞（8 项）

| # | 问题 | 文件 | 严重程度 |
|---|------|------|---------|
| 1 | nftables 规则重启丢失 | `go-gost/x/socket/websocket_reporter.go` → `setupMimicNftables` | 节点重启后防火墙规则全丢，隧道裸奔或不通 |
| 2 | nftables 错误被静默吞掉 | 同上，函数始终 return nil | 调用方不知道防火墙配没配成功 |
| 3 | 无 XDP native→skb 回退 | 整个 mimic 安装/启动流程 | native XDP 挂载失败时直接报错，不降级 |
| 4 | 无残留 XDP/lock/进程清理 | `handleMimicInstall` 启动前 | 残留 XDP/lock 导致新实例永远起不来 |
| 5 | 删除转发时不清理退出节点 | `uninstallMimicForward` in `control_plane.go` | server 角色永远不卸载，留下孤儿进程 |
| 6 | 卸载时不清理 nftables | `handleMimicUninstall` in `websocket_reporter.go` | wgmimic_filter/wgmimic_nat 表不断累积 |
| 7 | 重复运行产生重复 nftables 规则 | `setupMimicNftables` 用 nft add rule 不幂等 | 每次重新部署追加重复规则 |
| 8 | API 生成密钥仍依赖 `wg` 二进制 | `forward_mimic.go` （后端 API 创建转发） | 面板没装 wireguard-tools 时报错 |

### P1 — 重要缺失（6 项）

| # | 问题 | 说明 |
|---|------|------|
| 9 | 节点重启后 WG 不自动恢复 | 没有 `systemctl enable wg-quick@wg0` |
| 10 | 无 MTU 设置 | WG 默认 MTU 1420 不计算 Mimic TCP 封装开销 |
| 11 | 只支持 apt-get | CentOS/Alpine 无法自动安装 |
| 12 | 无容器环境检测 | Docker/LXC 里 `modprobe mimic` 静默失败 |
| 13 | 无 GitHub 代理 | 国内机器下载 mimic deb 超时 |
| 14 | 无内核头文件兜底 | linux-headers 找不到时直接报错 |

### P2 — 增强项（5 项）

| # | 问题 | 说明 |
|---|------|------|
| 15 | 无 WG 握手健康检查 | 面板看不到隧道通了没 |
| 16 | 无云安全组提示 | 用户不知道要放行什么端口 |
| 17 | 卸载无备份 | 配置直接删除无备份 |
| 18 | 无 mimic 进程 keepalive | MK 传 `--keepalive 15` 给 mimic，我们没有 |
| 19 | DKMS BUILD_EXCLUSIVE 不兼容 | cloud 内核缺少 kfunc 时不会自动切通用内核 |

---

## 2. 修复方案

### Phase 1 — P0 修复（8 项，当前阶段）

#### P0-1: nftables 规则持久化

**目标**：重启后自动恢复 `wgmimic_filter`/`wgmimic_nat` 规则。

**文件**：`go-gost/x/socket/websocket_reporter.go`

**改动内容**：
- `setupMimicNftables` 执行 `nft add rule` 后，追加 `nft list ruleset > /etc/nftables.d/wgmimic.conf`
- 创建 `/etc/nftables.d/` 目录（如果不存在）
- 创建 systemd oneshot 服务 `wgmimic-nft-restore.service`：
  ```
  [Unit]
  Description=Restore WGMimic nftables rules
  Before=nftables.service
  
  [Service]
  Type=oneshot
  RemainAfterExit=yes
  ExecStartPre=/usr/sbin/nft delete table inet wgmimic_filter
  ExecStartPre=/usr/sbin/nft delete table inet wgmimic_nat
  ExecStart=/usr/sbin/nft -f /etc/nftables.d/wgmimic.conf
  
  [Install]
  WantedBy=multi-user.target
  ```
- `systemctl enable wgmimic-nft-restore.service`
- `handleMimicUninstall` 中删除持久化文件和 systemd 服务

**注意**：`nft delete table` 要检查表是否存在（`nft list table` 先），避免 non-zero exit code。

#### P0-2: nftables 错误传播

**目标**：`setupMimicNftables` 的错误返回给调用方，不再静默。

**改动内容**：
- 修改 `setupMimicNftables` 签名：返回 `error`，不再是 `nil` swallow
- 每个 `exec.Command` 的 `Run()`/`CombinedOutput()` 错误都 `return fmt.Errorf(...)`
- `handleMimicInstall` 收到 error 后通过 WebSocket 回复 `MimicInstallError` 给面板
- 面板 `syncMimicForward` 收到 error 后更新 `MimicConfig.Status = 2`（异常）

#### P0-3: XDP native→skb 回退

**目标**：Mimic native XDP 挂载失败时自动降级 skb。

**改动内容**（在 `autoInstallMimic` 或新函数中）：

```go
func setupMimicXDP(publicIF string) error {
    // 1. 尝试 native XDP
    //    ip link set dev <iface> xdp obj /usr/lib/mimic/mimic_bpf.o
    // 2. 如果失败，尝试 skb (xdpgeneric)
    //    ip link set dev <iface> xdpgeneric obj /usr/lib/mimic/mimic_bpf.o
    // 3. 如果仍然失败，return error
}
```

**前置条件**：
- 安装 `iproute2`（`ip` 命令）
- 识别 Mimic BPF 对象路径（`find /usr/lib /usr/local/lib -name "mimic_bpf.o"`）
- 清理网卡上的旧 XDP 程序（`ip link set dev <iface> xdp off`）

#### P0-4: 启动前清理残留

**目标**：每次启动 mimic 前清理旧状态。

**改动内容**（在 `handleMimicInstall` 中，调用 `setupMimicWireGuard` 之前）：

```go
func cleanupStaleMimicState(publicIF string) {
    // 1. 清理 XDP: ip link set dev <iface> xdp off
    // 2. 删除锁文件: os.RemoveAll(fmt.Sprintf("/run/mimic/*_%d.lock", ifindex))
    // 3. 杀死残留 mimic 进程:
    //    pgrep -x mimic | while read pid; do
    //      if grep -q <iface> /proc/$pid/cmdline; then kill $pid; fi
    //    done
}
```

从 `/sys/class/net/<iface>/ifindex` 读取 ifindex。

#### P0-5: 删除转发时清理退出节点

**目标**：`forwardForceDelete` 时不仅要清理 entry 节点（已在 `uninstallMimicForward`），还要清理 exit/chain 节点。

**改动内容**：
- `control_plane.go` 的 `uninstallMimicForward` 改为同时遍历 entry 和 exit 节点
- 对 exit 节点发 `MimicUninstall{role:"server"}`
- 需要获取 chain 类型中的 exit 节点信息（`tunnel.ServerID` 或 `tunnel.NodeID` 取决于 chain 类型）

**现有代码问题**（`control_plane.go` 约 2930 行）：
```go
func (h *Handler) uninstallMimicForward(forward *forwardRecord, log bool) {
    for _, fp := range forward.ForwardPorts {
        // sendNodeCommand(fp.NodeID, MimicUninstall{role:"client"})
    }
    // 没有遍历 exit/chain 节点!
}
```

修改为：
```go
func (h *Handler) uninstallMimicForward(forward *forwardRecord, log bool) {
    // 清理 entry 节点
    for _, fp := range forward.ForwardPorts {
        sendNodeCommand(fp.NodeID, MimicUninstall{role:"client", ...})
    }
    // 清理 exit/chain 节点
    tunnels := h.repo.GetTunnelsByForwardID(forward.ID)
    for _, t := range tunnels {
        if t.TunnelType == 2 || t.TunnelType == 3 {
            exitNodeID := t.ServerID // 或 t.NodeID
            sendNodeCommand(exitNodeID, MimicUninstall{role:"server", ...})
        }
    }
}
```

#### P0-6: 卸载时清理 nftables + WG 配置

**目标**：`handleMimicUninstall` 清理所有残留。

**改动内容**（`websocket_reporter.go` 中的 `handleMimicUninstall`）：

```go
func handleMimicUninstall(req MimicInstallRequest) {
    // 1. wg-quick down <iface> （已有）
    // 2. 删除 /etc/wireguard/<iface>.conf
    // 3. nft delete table inet wgmimic_filter
    // 4. nft delete table inet wgmimic_nat
    // 5. 如果角色是 server，删除 wgmimic_filter 中本端口的规则
    //    而不是删整张表（如果是单一隧道）
    // 6. 清理 /etc/nftables.d/wgmimic.conf 持久化文件
    // 7. 如果所有隧道都删完了，清理 systemd 服务 + 模块
}
```

**注意**：`nft delete table` 前要先检查表是否存在，否则返回非零 exit code。

**幂等处理**：多个隧道共享一张 nftables 表，不能一删了之。改用按端口精确删除：
```go
// 用 nft -a list table ... 找到规则的 handle，
// 然后 nft delete rule inet wgmimic_filter input handle <N>
```

#### P0-7: nftables 规则幂等

**目标**：重复 `handleMimicInstall` 不会追加重复规则。

**方案**：用 `nft list chain` 先检查规则是否存在（匹配 comment 或端口），不存在才添加。或者更简单：每次 setup 前先删除该端口的旧规则，再添加新规则。

```go
func setupMimicNftables(req MimicInstallRequest) error {
    // 1. 确保 table 存在
    // 2. 确保 chain 存在
    // 3. 删除已存在的该端口规则（如果有）
    //    nft --handle list chain inet wgmimic_filter input | grep "dport <port>" | ...
    // 4. 添加新规则
    //    nft add rule inet wgmimic_filter input tcp dport <port> counter accept
    //    nft add rule inet wgmimic_filter input udp dport <port> counter accept
}
```

#### P0-8: API `forward_mimic.go` 改用纯 Go 密钥生成

**目标**：后端 API 创建 Mimic 转发时不依赖 `wg` 二进制。

**文件**：`go-backend/internal/http/handler/forward_mimic.go`（闭源）

**改动**：
- 删除 `exec.Command("wg", "genkey")` 调用
- 复用 `control_plane.go` 中的纯 Go `generateWGKeyPair()` 函数
- 如果两个文件在同一个 package，直接调用即可
- 如果不在，将 `generateWGKeyPair` 提取到公共文件或者直接复制

---

### Phase 2 — P1 修复（6 项）

#### P1-9: WG 接口开机自启

**目标**：`setupMimicWireGuard` 创建 WG 配置后执行 `systemctl enable wg-quick@<iface>`。

```go
exec.Command("systemctl", "enable", fmt.Sprintf("wg-quick@%s", iface)).Run()
```

#### P1-10: MTU 自动设置

**目标**：根据外层协议自动计算 WG MTU。

```go
func calcMimicMTU(serverIP string) int {
    // Mimic TCP 封装开销: IP(20) + TCP(20) ≈ 40 bytes
    // WG 封装开销: IP(20) + UDP(8) + WG(32) ≈ 60 bytes
    // 总开销: ~100 bytes
    // IPv4: 1500 - 100 = 1400
    // IPv6: 1500 - 120 = 1380
    if strings.Contains(serverIP, ":") {
        return 1380
    }
    return 1400
}
```

在 `setupMimicWireGuard` 中将 MTU 写入 WG 配置文件 `[Interface]` 段。

#### P1-11: 多包管理器支持

**目标**：`autoInstallMimic` 支持 yum/dnf。

**方案**：
- 检测 `/etc/os-release` 中的 `ID`
- 对 `centos`/`rhel`/`fedora`/`rocky`/`alma` 用 `yum install -y` 或 `dnf install -y`
- 对 `alpine` 用 `apk add`
- 安装包：`wireguard-tools`、`linux-headers-*`（包名因发行版而异）、`dkms`、`make`、`gcc`、`git`、`curl`
- 对不可用的发行版返回友好错误提示

#### P1-12: 容器环境检测

**目标**：在 Docker/LXC 中运行给出明确提示。

```go
func detectContainer() bool {
    // 读取 /proc/1/cgroup 或 /.dockerenv
    // 检测 /proc/1/sched 中的 "docker" / "lxc" / "containerd"
    data, _ := os.ReadFile("/proc/1/cgroup")
    return strings.Contains(string(data), "docker") || 
           strings.Contains(string(data), "lxc")
}
```

在 `handleMimicInstall` 开始处调用，如果检测到容器则返回错误。

#### P1-13: GitHub 代理

**目标**：国内机器下载 mimic 自动走代理。

```go
func githubDownloadURL(repo, asset string) string {
    raw := fmt.Sprintf("https://github.com/%s/releases/latest/download/%s", repo, asset)
    // 先探测 GitHub Raw 可访问性
    // 如果失败，加代理前缀 https://gh-proxy.com/
    // 或通过面板配置获取代理地址
}
```

简单起见：先直连，直连失败后从可配置的 `GITHUB_PROXY_PREFIX` 环境变量读取代理地址。

#### P1-14: 内核头文件兜底

**目标**：`linux-headers-$(uname -r)` 找不到时自动安装最新通用内核。

```go
func ensureKernelHeaders() error {
    kr := getKernelRelease()
    if err := aptInstall("linux-headers-" + kr); err != nil {
        // 仓库里没有当前内核的头文件
        // 安装最新通用内核 + 头文件
        aptInstall("linux-image-amd64", "linux-headers-amd64")
        // 提示重启
        return fmt.Errorf("kernel headers for %s not found, installed generic kernel, please reboot", kr)
    }
    return nil
}
```

---

### Phase 3 — P2 增强（5 项）

#### P2-15: WG 握手健康检查

**目标**：面板/代理可以查询 Mimic 隧道健康状态。

**新增 WebSocket 命令**：
```json
{
  "type": "MimicStatus",
  "data": { "wgInterface": "wg0" }
}
```

节点回复：
```json
{
  "type": "MimicStatusReply",
  "data": {
    "wgRunning": true,
    "lastHandshake": "2026-06-19T10:30:00Z",
    "bytesReceived": 1234567,
    "bytesSent": 7654321,
    "mimicRunning": true
  }
}
```

**后端新增 API**：
- `GET /api/v1/forward/{id}/mimic/status` → 向节点发 `MimicStatus`，返回结果

#### P2-16: 云安全组提示

**目标**：部署后打印/返回需要放行的端口信息。

**改动**：
- `handleMimicInstall` 执行完毕后，在日志中打印黄色提示：
  ```
  ╔══════════════════════════════════════════════╗
  ║  云安全组放行以下端口:                        ║
  ║  入站 TCP: <MimicPort>                       ║
  ║  入站 UDP: <MimicPort>                       ║
  ║  出站 TCP: <MimicPort>                       ║
  ║  出站 UDP: <MimicPort>                       ║
  ║  公网 IP: <serverPublicIP>                   ║
  ╚══════════════════════════════════════════════╝
  ```
- 面板 `syncMimicForward` 收到安装确认后，将安全组提示返回前端

#### P2-17: 卸载备份

**目标**：`handleMimicUninstall` 删除 WG 配置前先备份。

```go
backupDir := fmt.Sprintf("/root/wgmimic-uninstall-backup-%d", time.Now().Unix())
os.MkdirAll(backupDir, 0700)
exec.Command("cp", "-a", "/etc/wireguard", backupDir).Run()
exec.Command("cp", "-a", "/etc/nftables.d/wgmimic.conf", backupDir).Run()
```

#### P2-18: Mimic 进程 keepalive

**目标**：Mimic 进程启动时传 `--keepalive 15` 参数。

**改动**：在 mimic 服务的 systemd unit 或直接命令行参数中加 `--keepalive 15`。

由于我们不走 systemd，是用 `exec.Command` 直接启动 mimic 进程，在构建参数时加：
```go
args := []string{"--keepalive", "15", "--interface", publicIF, "--port", strconv.Itoa(mimicPort)}
```

#### P2-19: DKMS BUILD_EXCLUSIVE 容错

**目标**：cloud/minimal 内核缺少 kfunc 时自动切通用内核。

**方案**：
- 监测 `mimic-dkms` 安装后的 `make.log` 中是否包含 `BUILD_EXCLUSIVE`、`does not match`、`should not be built` 等关键字
- 如果发现，自动 `apt-get install -y linux-image-amd64 linux-headers-amd64`
- 写入 `/etc/default/grub.d/99-wgmimic-kernel.cfg` 设置 GRUB 默认启动通用内核
- 运行 `update-grub` + `grub-set-default`
- 提示用户重启

---

## 3. 文件变更总表

### Go Gost (`go-gost/x/socket/websocket_reporter.go`)

| 改动区域 | 涉及函数 | 对应 Phase |
|---------|---------|-----------|
| nftables 持久化 | `setupMimicNftables` | P0-1 |
| nftables 错误传播 | `setupMimicNftables`、`handleMimicInstall` | P0-2 |
| XDP 回退 | 新建 `setupMimicXDP` | P0-3 |
| 残留清理 | 新建 `cleanupStaleMimicState` | P0-4 |
| 卸载 nftables+WG | `handleMimicUninstall` | P0-6 |
| 规则幂等 | `setupMimicNftables` | P0-7 |
| WG 开机自启 | `setupMimicWireGuard` | P1-9 |
| MTU 设置 | `setupMimicWireGuard`、新建 `calcMimicMTU` | P1-10 |
| 多包管理器 | `autoInstallMimic` | P1-11 |
| 容器检测 | 新建 `detectContainer` | P1-12 |
| GitHub 代理 | `autoInstallMimic` | P1-13 |
| 内核头文件兜底 | `autoInstallMimic` 中的 `ensureKernelHeaders` | P1-14 |
| 健康检查 | 新建 `handleMimicStatus` | P2-15 |
| 安全组提示 | `handleMimicInstall` | P2-16 |
| 卸载备份 | `handleMimicUninstall` | P2-17 |
| mimic keepalive | `handleMimicInstall` 启动参数 | P2-18 |
| DKMS BUILD_EXCLUSIVE | `autoInstallMimic` | P2-19 |

### Go Backend (`go-backend/internal/http/handler/`)

| 文件 | 改动 | 对应 Phase |
|------|------|-----------|
| `control_plane.go` | `uninstallMimicForward` 增加 exit 节点清理 | P0-5 |
| `control_plane.go` | `syncMimicForward` 处理 WebSocket 安装失败回执 | P0-2 |
| `forward_mimic.go` | 改用纯 Go `generateWGKeyPair` | P0-8 |
| `control_plane.go` | 新增 `GET /mimic/status` 接口 | P2-15 |

### 新增工具函数

可以放在 `go-gost/x/socket/mimic_util.go`（如果不想继续膨胀 `websocket_reporter.go`）：

- `generateWGKeyPair`（与后端重复，但 x 是独立 module）
- `calcMimicMTU`
- `detectContainer`
- `cleanupStaleMimicState`
- `setupMimicXDP`
- `githubDownloadURL`
- `ensureKernelHeaders`

---

## 4. 实施顺序

```
Phase 1 (P0):
  P0-2 错误传播 → P0-7 规则幂等 → P0-1 持久化
  → P0-6 卸载清理 → P0-5 exit 节点清理
  → P0-3 XDP 回退 → P0-4 残留清理
  → P0-8 API 纯 Go 密钥

Phase 2 (P1):
  P1-9 WG 自启 → P1-10 MTU → P1-14 内核头文件
  → P1-13 GitHub 代理 → P1-12 容器检测 → P1-11 多包管理器

Phase 3 (P2):
  P2-15 健康检查 → P2-16 安全组提示
  → P2-18 keepalive → P2-17 备份 → P2-19 DKMS
```

---

## 5. 验证标准

**Phase 1 完成后**：
- 重复部署/删除 Mimic 转发 5 次，nftables 规则无重复
- 节点重启后，nftables 规则自动恢复
- 删除转发后，entry 和 exit 节点都被清理
- 面板没有安装 `wireguard-tools` 也能创建 Mimic 转发

**Phase 2 完成后**：
- 节点重启后 WG 接口自动恢复
- 国内机器（GitHub 访问慢）也能自动安装 mimic
- 容器环境给出明确提示

**Phase 3 完成后**：
- 面板能看到 WG 握手时间和流量
- 用户看到明确的安全组放行提示

---

## 6. 与现有 mimic-integration-plan.md 的关系

本文档是 `mimic-integration-plan.md` 的补充，专注于代码层面的 bug 修复和安全加固。两者的关系：

| 维度 | mimic-integration-plan.md | wgmimic-bugfix-plan.md |
|------|--------------------------|----------------------|
| 定位 | 功能设计文档（做什么） | Bug 修复计划（修什么） |
| 目标 | 实现 Mimic 转发模式 | 让 Mimic 转发在生产环境可用 |
| 涉及阶段 | Phase 1-3 功能设计 | Phase 1-3 Bug 修复 |
| 优先级 | 新功能开发 | 生产环境稳定性 |

两个文档都存放在 closed/docs/，属于闭源资料。
