# 001-rename-flvx-svc-alias.md

## Summary
将面板 Docker 镜像名、容器名、部署目录和数据库名从 `flvx-svc` 系列重命名为 `flvx-svc` 系列，以避开国内服务器对常见面板容器名的检测。

## Tasks
- [x] `docker-compose-v4.yml`: 镜像名/容器名/部署目录/数据库名 全部更新
- [x] `docker-compose-v6.yml`: 同上
- [x] `go-backend/internal/http/handler/system_upgrade.go`: 默认部署目录 + 默认容器名常量
- [x] `go-backend/internal/http/handler/upgrade.go`: 升级函数中的硬编码部署目录
- [x] `panel_install.sh`: 容器健康检查/停止操作/部署目录/数据库默认名 全部更新
- [x] `.github/workflows/docker-build.yml`: 镜像构建名 + release 镜像引用

## Breaking Change 提醒
> **⚠️ 此版本为非兼容更新！** 所有镜像名、容器名、部署目录和数据库名均更改，现有实例无法通过常规 `docker compose pull/up` 升级。用户需要：
>
> 1. **备份数据库**（SQLite: 复制 `gost.db`；PostgreSQL: `pg_dump`）
> 2. **导出配置**（`.env` 文件中的 JWT_SECRET、LICENSE_KEY 等）
> 3. **卸载旧实例**: `docker compose down && rm -rf /opt/flux_panel`
> 4. **重新安装新版本**: 使用新版安装脚本（新部署路径 `/opt/flvx-svc`）
> 5. **恢复数据**: 导入数据库备份

## 改名对照表
| 旧名称 | 新名称 |
|--------|--------|
| `flvx-svc-backend` | `flvx-svc-backend` |
| `flvx-svc-postgres` | `flvx-svc-postgres` |
| `vite-frontend` | `flvx-svc-frontend` |
| `/opt/flux_panel` | `/opt/flvx-svc` |
| `flux_panel` (DB名/用户) | `flvx_svc` |
