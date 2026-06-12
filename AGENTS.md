# FLOX 项目记忆

## 项目概览
FLOX 流量转发管理系统，GOST v3 fork。Go 后端 + React/Vite 前端 + Go 转发代理。

## 目录结构
```
./
├── go-gost/x/             # 转发代理核心（handlers/listeners/dialers）
── go-backend/            # Admin API（GORM + SQLite/PostgreSQL）
│   ── internal/store/repo/  # 数据层（repository.go 83k LOC）
├── vite-frontend/         # React 管理面板
│   └── src/shadcn-bridge/heroui/  # HeroUI 兼容层
├── docker-compose-v4.yml  # IPv4 部署
├── docker-compose-v6.yml  # IPv6 部署
├── panel_install.sh       # 面板安装脚本
├── install.sh             # 节点安装脚本
└── .github/workflows/     # CI
```

## 关键约定
- **Auth**: `Authorization` header 直接传 JWT，不加 `Bearer` 前缀
- **API 响应**: `{code, msg, data, ts}`，code 0 = 成功
- **加密**: 节点通信 AES + secret PSK
- **Go 版本**: backend 1.24, gost 1.23, x 1.22
- **前端 UI**: 从 `src/shadcn-bridge/heroui/*` 导入，不用 `@heroui/*`
- **Tailwind**: `globals.css` 必须 import `tailwind-theme.pcss`

## 禁止事项
- 不编辑 `go-gost/x/internal/util/grpc/proto/*.pb.go`
- 不加 `Bearer` 前缀
- 不改 `install.sh` / `panel_install.sh`（CI 会覆盖）
- handler 不直接调 `repo.DB()`，加 Repository 方法
- 不加前端测试（无 Vitest/Jest）
- GORM tags 不用 `type:jsonb` 或 `type:serial`（SQLite 不兼容）

## 常用命令
```bash
# 本地开发
(cd go-backend && make build)
(cd vite-frontend && npm run dev)
(cd go-gost && go run .)

# 测试
(cd go-backend && go test ./...)
(cd go-backend && go test ./tests/contract/...)

# Docker 部署
docker compose -f docker-compose-v4.yml up -d
docker compose -f docker-compose-v6.yml up -d
```

## 闭源工作流（CRITICAL）

### 闭源文件列表

**Go Backend:**
- `go-backend/internal/store/model/{product,order,payment_config,billing}.go`
- `go-backend/internal/store/repo/repository_{order,payment_config,package_groups,billing}.go`
- `go-backend/internal/http/handler/{product,order,payment,package_group,billing,admin_telegram}.go`
- `go-backend/internal/http/middleware/trial_guard.go`
- `go-backend/internal/telegram/{bot,notifier}.go`
- `go-backend/internal/payment/` (整个目录)

**Frontend:**
- `vite-frontend/src/pages/{admin-telegram,shop,admin-orders,admin-payment,admin-plans,myhome}.tsx`
- `vite-frontend/src/pages/admin-plans/{package-grouped-view,package-group-manager}.tsx`

**Go Gost (FloxCore):**
- `go-gost/x/adapter/` (整个目录)
- `go-gost/x/flox-core/` (整个目录)
- `go-gost/x/nftables/conntrack.go`
- `go-gost/x/nftables/conntrack_stub.go`

### 日常开发流程

```
1. ./scripts/merge-closed.ps1
   → 从 closed/ 恢复所有闭源文件到主仓库

2. 直接在主仓库修改文件（包括闭源文件）
   → 不要区分开源/闭源，正常改

3. git add -A && git commit && git push
   → 主仓库提交（闭源文件此时在主仓库中）
```

### 发布流程（CRITICAL）

```
1. ./scripts/strip-closed.ps1
   → ① 自动把改过的闭源文件复制回 closed/ 目录
   → ② 从主仓库删除所有闭源文件

2. cd closed
   git add -A && git commit -m "update closed"
   git push origin main
   → 闭源文件改动推送到私有仓库 abai569/flox-closed

3. cd ..
   git add -A && git commit -m "..."
   git push origin main
   → 主仓库提交（此时不含闭源文件）

4. git tag <version>; git push origin <version>
   → CI 发版，自动拉私有仓库 → 全功能镜像
```

### 继续开发

```
1. ./scripts/merge-closed.ps1
   → 恢复最新闭源文件到主仓库
```

### 绝对禁止

- ❌ 修改闭源文件后直接推主仓库，不跑 strip-closed.ps1
- ❌ 手动复制闭源文件到 closed/（用脚本）
- ❌ 在 main repo 提交闭源文件（发布前必须 strip）
- ❌ 忘记同步 closed 仓库（发布时必须先推 closed）

### 判断文件是否闭源

如果文件路径出现在上面的闭源文件列表中，它就是闭源文件。
不确定时，检查 `closed/scripts/merge-closed.ps1` 和 `closed/scripts/strip-closed.ps1`。
