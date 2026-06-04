# Plan: MPay Docker 化并发布 GitHub

## 目标
将本地修改后的 MPay v1.2.3 打包成 Docker 镜像，支持一键部署，并发布到 GitHub 开源仓库。

## 技术选型

| 组件 | 选择 | 说明 |
|------|------|------|
| PHP | 8.2-FPM | ThinkPHP 8 要求 >= 8.0 |
| Web 服务器 | Nginx | 轻量、容器化友好 |
| 数据库 | MySQL 8.0 | 独立容器 |
| 自动安装 | entrypoint.sh + SQL | 容器首次启动时自动初始化 |
| 进程管理 | supervisord | 同时管理 PHP-FPM + Nginx |

## 需要确认

1. **仓库名**：建议 `mpay-docker` 还是直接 fork 原 MPay 后在原仓库加 Docker 支持？
2. **PHP 版本**：8.2 是否可以？（MPay v1.2.3 官方要求 PHP > 8.0）
3. **端口映射**：MPay 默认用 8080 还是 80？
4. **是否保留安装程序**：Docker 环境下禁用 /install，通过环境变量配置管理员
5. **数据库**：是否考虑支持 SQLite 简化部署？（ThinkPHP ORM 支持，但需改源码）

## 改动范围

| # | 文件 | 说明 |
|---|------|------|
| 1 | `Dockerfile` | 多阶段构建 |
| 2 | `docker-compose.yml` | MPay + MySQL + Nginx 编排 |
| 3 | `docker/entrypoint.sh` | 自动初始化数据库和 .env |
| 4 | `docker/install.sql` | 替代 PHP 安装程序 |
| 5 | `docker/nginx.conf` | ThinkPHP rewrite 规则 |
| 6 | `docker/php.ini` | PHP 配置 |
| 7 | `docker/supervisord.conf` | 进程管理 |
| 8 | `.dockerignore` | 排除文件 |
| 9 | `README.md` | 部署文档 |
| 10 | `.github/workflows/docker-build.yml` | CI 自动构建 |

## 部署方式

```bash
git clone https://github.com/yourname/mpay-docker.git
cd mpay-docker
cp .env.example .env
docker compose up -d
# 访问 http://localhost:8080
```

## 关键设计

- 首次启动时 entrypoint.sh 自动生成 .env、建表、创建管理员账号
- 无需访问 /install 安装程序
- 管理员账号通过环境变量配置
- 数据库和文件上传通过 volume 持久化
