# MKCloudAreYouOk × FLOX 互补集成计划

## 1. 背景与动机

### 1.1 现有问题

FLOX 节点间转发依赖 UDP 传输（GOST forward handler），国内出口节点面临：
- GFW 对 UDP 流量的主动探测和阻断
- 运营商对 UDP 端口的 QoS 限速
- 云服务商安全组对 UDP 的默认限制

用户反馈：国内→海外转发经常"连不上"，但诊断显示节点在线、Overlay 正常。

### 1.2 解决方案

MKCloudAreYouOk 项目提供：
- **Mimic**：eBPF XDP/TC 程序，将 WireGuard UDP 流量伪装成 TCP
- 绕过 GFW 的 UDP 封锁，因为看起来像普通 TCP 流量
- 支持 Debian/Ubuntu 官方内核 5.10+

### 1.3 互补关系

| 维度 | FLOX SDWAN | MKCloudAreYouOk (Mimic) |
|------|-----------|------------------------|
| 解决问题 | 多节点 Mesh 内网互通 | UDP 被封锁时绕过 GFW |
| 技术 | Nebula CA 证书加密 | WireGuard + eBPF UDP→TCP 伪装 |
| 拓扑 | 分组 + Lighthouse + 多成员 | 点对点（入口↔出口） |
| 适用场景 | 节点间需要互相访问 | 国内→海外单向转发 |

**组合使用**：
```
用户 → 入口节点(GOST) → Mimic客户端(UDP→TCP) → 公网/GFW → Mimic服务端(TCP→UDP) → 出口节点 → 目标
```

---

## 2. 技术架构

### 2.1 整体流程图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   用户       │────▶│  入口节点     │────▶│  Mimic 隧道   │────▶│  出口节点    │
│  (v2rayN)   │     │  (GOST)      │     │  (WG+Mimic)  │     │  (GOST)     │
─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
                           │                      │                      │
                           │  UDP 转发            │ TCP 伪装             │ UDP 转发
                           ▼                      ▼                      ▼
                     本地端口监听           WireGuard 加密          落地目标
                     41676/tcp              10.66.66.0/24          154.40.46.102
                                            Mimic 伪装端口
                                            44445/tcp+udp
```

### 2.2 数据流

1. 用户连接入口节点公网 IP:端口（TCP/UDP）
2. GOST forward handler 接收流量
3. 流量通过 WireGuard 隧道（Mimic 伪装成 TCP）传输到出口节点
4. 出口节点 GOST handler 转发到落地目标

### 2.3 内核要求

- Linux 5.10+（eBPF TC/XDP 能力）
- 支持 XDP native 或 skb 模式
- DKMS 编译 Mimic 内核模块

---

## 3. 实施阶段

### Phase 1: Mimic 点对点模式（优先级最高）

解决最紧迫的 UDP 封锁问题。

#### 3.1 后端改动

**文件**: `go-backend/internal/http/handler/`

| 文件 | 改动 |
|------|------|
| `mutations.go` | 新增 mimic 模式校验，生成 WG 密钥对，存储 Mimic 配置 |
| `control_plane.go` | 新增 Mimic 隧道下发逻辑，WebSocket 命令 |
| `forward_mode.go` | 新增 mimic 模式的 forward 创建/更新/删除 |

**新增 API**:
```
POST /api/v1/forward/mimic/config      # 生成 Mimic 配置
GET  /api/v1/forward/mimic/status      # 查询 Mimic 隧道状态
POST /api/v1/forward/mimic/restart     # 重启 Mimic 隧道
```

**数据库改动**:
- `forward` 表 `mode` 字段新增 `mimic` 值
- 新增 `mimic_configs` 表存储 WG 密钥、Mimic 端口、隧道地址

#### 3.2 节点脚本改动

**文件**: `install.sh`

新增 Mimic 安装流程：
```bash
# 检测内核版本
# 安装 DKMS + linux-headers
# 编译/安装 mimic-dkms
# 配置 systemd 服务
# 初始化 nftables 规则
```

**新增命令**:
```bash
bash install.sh mimic-install    # 安装 Mimic
bash install.sh mimic-status     # 查看状态
bash install.sh mimic-uninstall  # 卸载
```

#### 3.3 GOST/x 改动

**新增目录**: `go-gost/x/mimic/`

| 文件 | 功能 |
|------|------|
| `handler.go` | Mimic forward handler，管理 WG 接口 |
| `listener.go` | Mimic listener，监听 WG 隧道流量 |
| `dialer.go` | Mimic dialer，通过 WG 隧道拨号 |
| `service.go` | Mimic systemd 服务管理 |
| `nftables.go` | nftables 规则管理（放行 Mimic 端口） |

**WebSocket 命令**:
```json
{
  "type": "MimicInstall",
  "data": {
    "role": "server|client",
    "mimicPort": 44445,
    "wgAddress": "10.66.66.1/24",
    "wgAllowedIPs": "10.66.66.2/32",
    "wgPublicKey": "...",
    "wgPrivateKey": "..."
  }
}
```

#### 3.4 前端改动

**文件**: `vite-frontend/src/pages/forward.tsx`

- 转发模式下拉新增 "Mimic (WG+UDP伪装)"
- 新增 Mimic 配置表单（端口、WG 地址、公钥）
- 转发规则列表显示 Mimic 隧道状态
- 诊断页面显示 Mimic 健康检查

### Phase 2: Mimic + SDWAN 组合

链式转发中某段用 Mimic 替代直连。

#### 2.1 架构

```
入口节点 → [Mimic 隧道] → 中间节点 → [SDWAN Overlay] → 出口节点
```

#### 2.2 改动

- 链式隧道支持 mimic 段
- 路由表自动计算最优路径（Mimic vs 直连 vs SDWAN）
- 前端显示组合拓扑图

### Phase 3: 自动化优化

- 自动检测 UDP 是否被封锁，自动切换 Mimic
- Mimic 端口自动轮换（避免被特征识别）
- 多 Mimic 隧道负载均衡

---

## 4. 文件清单

### 闭源文件（需要新增/修改）

**Go Backend**:
- `go-backend/internal/http/handler/forward_mimic.go` (新增)
- `go-backend/internal/http/handler/mutations.go` (修改)
- `go-backend/internal/http/handler/control_plane.go` (修改)
- `go-backend/internal/store/model/mimic_config.go` (新增)
- `go-backend/internal/store/repo/repository_mimic.go` (新增)

**Go Gost**:
- `go-gost/x/mimic/handler.go` (新增)
- `go-gost/x/mimic/listener.go` (新增)
- `go-gost/x/mimic/dialer.go` (新增)
- `go-gost/x/mimic/service.go` (新增)
- `go-gost/x/mimic/nftables.go` (新增)
- `go-gost/x/socket/mimic_handler.go` (新增)

**Frontend**:
- `vite-frontend/src/pages/forward.tsx` (修改)
- `vite-frontend/src/api/index.ts` (修改)

**节点脚本**:
- `install.sh` (修改，新增 mimic 安装流程)

---

## 5. 数据库设计

### mimic_configs 表

```sql
CREATE TABLE mimic_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    forward_id INTEGER NOT NULL,
    role TEXT NOT NULL,              -- 'server' or 'client'
    mimic_port INTEGER NOT NULL,     -- Mimic 伪装端口
    wg_interface TEXT NOT NULL,      -- WG 接口名 (wg0, wg1...)
    wg_address TEXT NOT NULL,        -- WG 隧道地址
    wg_allowed_ips TEXT NOT NULL,    -- WG AllowedIPs
    wg_public_key TEXT NOT NULL,     -- WG 公钥
    wg_private_key TEXT NOT NULL,    -- WG 私钥 (加密存储)
    server_public_ip TEXT,           -- 服务端公网 IP
    server_public_key TEXT,          -- 服务端 WG 公钥
    persistent_keepalive INTEGER DEFAULT 15,
    status INTEGER DEFAULT 0,        -- 0=未部署 1=运行中 2=异常
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (forward_id) REFERENCES forward(id)
);
```

---

## 6. API 设计

### 6.1 生成 Mimic 配置

```
POST /api/v1/forward/{id}/mimic/config

Request:
{
  "role": "server|client",
  "mimicPort": 44445,
  "wgAddress": "10.66.66.1/24",
  "wgAllowedIPs": "10.66.66.2/32"
}

Response:
{
  "code": 0,
  "data": {
    "wgPublicKey": "...",
    "wgPrivateKey": "...",
    "mimicPort": 44445,
    "wgAddress": "10.66.66.1/24"
  }
}
```

### 6.2 部署 Mimic 隧道

```
POST /api/v1/forward/{id}/mimic/deploy

Request:
{
  "serverConfig": { ... },
  "clientConfig": { ... }
}

Response:
{
  "code": 0,
  "msg": "Mimic 隧道部署中"
}
```

### 6.3 查询 Mimic 状态

```
GET /api/v1/forward/{id}/mimic/status

Response:
{
  "code": 0,
  "data": {
    "wgStatus": "connected",
    "mimicStatus": "running",
    "lastHandshake": "2026-06-18T10:30:00Z",
    "bytesReceived": 1234567,
    "bytesSent": 7654321
  }
}
```

---

## 7. 前端 UI 设计

### 7.1 转发规则创建

转发模式下拉新增选项：
```
○ gost
○ nftables
○ floxcore
○ sdwan
● mimic (WG+UDP伪装)  ← 新增
```

选择 mimic 后显示配置表单：
```
┌─────────────────────────────────────
│ Mimic 配置                           │
─────────────────────────────────────┤
│ 伪装端口: [44445] (TCP+UDP)         │
│ WG 隧道地址: [10.66.66.1/24]        │
│ WG AllowedIPs: [10.66.66.2/32]      │
│                                     │
│ [生成密钥对]                         │
│                                     │
│ 服务端公钥: [自动显示] [复制]        │
│ 客户端公钥: [自动显示] [复制]        │
└─────────────────────────────────────┘
```

### 7.2 转发规则列表

Mimic 规则显示额外状态列：
```
| 规则名称 | 模式   | WG状态 | Mimic状态 | 最后握手 | 操作 |
|---------|-------|--------|----------|---------|------|
| test1   | mimic | 🟢连接 | 🟢运行   | 2分钟前  | ...  |
```

### 7.3 诊断页面

Mimic 规则诊断显示：
```
┌─────────────────────────────────────┐
│ Mimic 隧道状态                        │
├─────────────────────────────────────┤
│ ✅ WireGuard 接口: wg0 (运行中)      │
│ ✅ Mimic 服务: mimic@eth0 (运行中)   │
│ ✅ 最后握手: 2026-06-18 10:30:00     │
│ ✅ nftables 规则: 已放行 44445       │
│                                     │
│ 接收: 1.2 MB  发送: 7.6 MB          │
└─────────────────────────────────────┘
```

---

## 8. 测试计划

### 8.1 单元测试

- WG 密钥生成/解析
- Mimic 配置验证
- nftables 规则生成

### 8.2 集成测试

- 完整隧道建立（服务端→客户端）
- 数据传输测试（通过 Mimic 隧道转发 HTTP 请求）
- 断线重连测试
- 多隧道并发测试

### 8.3 场景测试

| 场景 | 预期结果 |
|------|---------|
| 国内→海外 UDP 被封锁 | Mimic 伪装后正常传输 |
| Mimic 端口被识别 | 自动轮换端口 |
| 内核不支持 eBPF | 提示升级内核或回退到 gost 模式 |
| 多隧道并发 | 每条隧道独立 WG 接口和端口 |

---

## 9. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 内核版本不满足 | 检测并提示，提供升级脚本 |
| Mimic 被特征识别 | 端口轮换 + 流量混淆 |
| XDP 挂载失败 | 自动回退到 skb 模式 |
| DKMS 编译失败 | 提供预编译包 + 官方内核安装 |
| 与现有 SDWAN 冲突 | 独立 WG 接口，端口不重叠 |

---

## 10. 时间估算

| 阶段 | 工作量 | 优先级 |
|------|-------|-------|
| Phase 1: Mimic 点对点 | 2-3 周 | P0 |
| Phase 2: Mimic + SDWAN 组合 | 1-2 周 | P1 |
| Phase 3: 自动化优化 | 1 周 | P2 |

---

## 11. 参考资源

- MKCloudAreYouOk: https://github.com/GHUNLIL/MKCloudAreYouOk
- Mimic (eBPF UDP→TCP): https://github.com/hack3ric/mimic
- WireGuard: https://www.wireguard.com/
- FLOX SDWAN 现有实现: `go-gost/x/adapter/sdwan_service.go`
