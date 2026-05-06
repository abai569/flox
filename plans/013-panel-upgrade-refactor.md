# 013-panel-upgrade-refactor

## 背景
当前面板升级实现存在严重问题：
1. 直接在容器内执行 docker 命令，但容器内可能没有 docker CLI
2. 缺少环境验证，升级可能在中途失败
3. 没有备份回滚机制
4. 没有并发控制
5. 下载 URL 拼接逻辑有问题

参考官方 commit `5ebd4c2a` 的实现，采用 **Helper Container 模式**重构。

## 核心设计

### 1. Helper Container 模式
不直接在宿主机执行命令，而是启动一个临时容器来执行升级：
- 使用当前后端镜像启动临时容器
- 通过 `--volumes-from` 共享卷
- 挂载 docker socket 到容器内
- 在容器内执行 `docker compose pull && docker compose up -d`

### 2. 环境变量配置 (`docker-compose.yml`)
```yaml
environment:
  FLUX_VERSION: ${FLUX_VERSION:-dev}
  PANEL_DEPLOY_DIR: /opt/flvx-panel
  PANEL_BACKEND_CONTAINER: flux-panel-backend
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - ./:/opt/flvx-panel
```

### 3. 升级能力检查
升级前验证：
- docker CLI 可用
- docker socket 挂载
- docker-compose 可用
- 部署目录和配置文件存在
- 容器名称合法

### 4. 文件备份与回滚
- 升级前备份 `docker-compose.yml` 和 `.env`
- 升级失败时自动恢复备份

### 5. 互斥锁防止并发
- 使用 `sync.Mutex` 防止同时执行多个升级任务

## 实施步骤

### 后端改造 (`go-backend`)

#### 1. 新增 `system_upgrade.go`
- `systemUpgradeExecutor` 结构体
- 能力检查 `capability()`
- Helper 脚本生成 `helperScript()`
- 文件备份/恢复 `backupFile()` / `restoreBackup()`
- 启动 Helper 容器 `startHelper()`
- API Handler: `systemVersion`, `systemCheckUpdates`, `systemUpgrade`

#### 2. 修改 `handler.go`
- 添加 `systemUpgradeMu sync.Mutex`
- 注册新路由

#### 3. 修改 `Dockerfile`
- 添加 docker CLI 到镜像

#### 4. 修改 `docker-compose-v4.yml` / `v6.yml`
- 添加环境变量
- 挂载 docker socket
- 挂载部署目录

### 前端改造 (`vite-frontend`)

#### 1. 新增 API 类型 (`api/types.ts`)
- `SystemUpgradeCapabilityApiData`
- `SystemUpgradeVersionApiData`
- `SystemUpgradeCheckApiData`
- `SystemUpgradeRunApiData`

#### 2. 新增 API 函数 (`api/index.ts`)
- `getSystemUpgradeVersion()`
- `checkSystemUpgrade()`
- `runSystemUpgrade()`

#### 3. 设置页面集成 (`pages/config.tsx`)
- 升级状态显示
- 检查更新按钮
- 升级弹窗
- 版本选择

## 任务清单

- [x] 1. 后端：创建 `system_upgrade.go`
- [x] 2. 后端：修改 `handler.go` 注册路由
- [x] 3. 后端：修改 `Dockerfile` 添加 docker CLI
- [x] 4. 后端：修改 `docker-compose-*.yml` 添加配置
- [x] 5. 前端：新增 API 类型
- [x] 6. 前端：新增 API 函数
- [ ] 7. 前端：设置页面集成升级 UI
- [ ] 8. 删除旧的 `upgrade.go` 面板升级代码
- [x] 9. 测试与提交（前后端编译通过）
