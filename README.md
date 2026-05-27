# FLVX

> **联系我们**: [Telegram 群组](https://t.me/erflvx) | [文档](https://abai569.github.io/flvx/)

## 特性

- 支持按 **隧道账号级别** 管理流量转发数量，可用于用户/隧道配额控制
- 支持 **TCP** 和 **UDP** 协议的转发
- 支持两种转发模式：**端口转发** 与 **隧道转发**
- 可针对 **指定用户的指定隧道进行限速** 设置
- 提供灵活的转发策略配置，适用于多种网络场景
- 面板分享，支持将节点分享给其他人，面板对接面板
- 支持分组权限管理，隧道分组、用户分组
- 支持批量功能，可以批量下发配置，启停等
- 支持隧道修改配置、转发修改隧道
- 🔐 **正式授权系统** - License 验证、域名绑定、过期控制

## 部署流程
---
### Docker Compose部署

**交互式安装（最新版）：**
```bash
bash <(curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh)
```

**指定版本安装：**
```bash
bash <(curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh) 3.6.5
```

**一键升级（无交互）：**
```bash
bash <(curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh) update
```

**一键卸载（无交互）：**
```bash
bash <(curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh) uninstall
```

> ⚠️ 升级时会自动检测并兼容带 `v` 或不带 `v` 的版本号格式。

#### 默认管理员账号

- **账号**: admin_user
- **密码**: admin_user

> ⚠️ 首次登录后请立即修改默认密码！

---

## Original Project
- **Name**: flvx-svc
- **Source**: https://github.com/bqlpfy/flvx-svc
- **License**: Apache License 2.0

## Modifications
This fork (FLVX) is no longer a light patch on top of the upstream project. It has been deeply reworked, with both backend and frontend rebuilt around a Go-based architecture.

### 1. Backend (Rewritten)
- **Removed**: The original `springboot-backend/` (Java/Spring Boot) implementation.
- **Added**: A fully rewritten `go-backend/` service (Go), including updated data and API handling for panel management.

### 2. Frontend (Reworked)
- **Reworked**: `vite-frontend/` has been substantially rebuilt to match the new backend contract and current UI layer architecture.
- **Updated**: Dashboard pages/components and interaction flows for the current React/Vite stack.

### 3. Forwarding Stack (Modified)
- **Modified**: `go-gost/` forwarding agent wrapper.
- **Modified**: `go-gost/x/` local fork of `github.com/go-gost/x`.

### 4. Mobile Clients (Removed)
- **Removed**: `android-app/` source code.
- **Removed**: `ios-app/` source code.

### 5. Deployment & Project Infrastructure
- **Updated**: Docker deployment templates and installer output flow (IPv4/IPv6 compose variants).
- **Updated**: Release installation scripts (`install.sh`, `panel_install.sh`) and supporting automation.
- **Added/Updated**: Project-level engineering documentation (for example `AGENTS.md`).

---


## 免责声明

本项目仅供个人学习与研究使用，基于开源项目进行二次开发。  

使用本项目所带来的任何风险均由使用者自行承担，包括但不限于：  

- 配置不当或使用错误导致的服务异常或不可用；  
- 使用本项目引发的网络攻击、封禁、滥用等行为；  
- 服务器因使用本项目被入侵、渗透、滥用导致的数据泄露、资源消耗或损失；  
- 因违反当地法律法规所产生的任何法律责任。  

本项目为开源的流量转发工具，仅限合法、合规用途。  
使用者必须确保其使用行为符合所在国家或地区的法律法规。  

**作者不对因使用本项目导致的任何法律责任、经济损失或其他后果承担责任。**  
**禁止将本项目用于任何违法或未经授权的行为，包括但不限于网络攻击、数据窃取、非法访问等。**  

如不同意上述条款，请立即停止使用本项目。  

作者对因使用本项目所造成的任何直接或间接损失概不负责，亦不提供任何形式的担保、承诺或技术支持。  


请务必在合法、合规、安全的前提下使用本项目。

---
## ⭐ 喝杯咖啡！（USDT）

| 网络       | 地址                                                                 |
|------------|----------------------------------------------------------------------|
| BNB(BEP20) | `暂无`                          |
| TRC20      | `暂无`                                  |
| Aptos      | `暂无`  |
| polygon    | `暂无`    |
