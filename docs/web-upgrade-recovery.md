> **⚠️ 重要提醒：强烈建议使用 SSH 脚本升级，不要使用 Web 面板在线升级！**
>
> Web 面板升级存在数据丢失风险（如本文档所述）。SSH 脚本升级会自动处理数据库备份、Docker 卷迁移、旧数据恢复等操作，安全可靠。
>
> 升级命令：SSH 登录服务器后执行 `bash <(curl -fsSL https://raw.githubusercontent.com/abai569/flox/main/panel_install.sh) update`
>
> 如已通过 Web 升级导致数据丢失，请参考下方恢复步骤。

---

# Web 升级后数据恢复教程（3.9.x → 4.0.0）

## 问题描述

通过面板 Web 在线升级从 3.9.x 升级到 4.0.0 后，面板数据（用户、隧道、节点等）全部消失，显示为空白面板。

## 根因

3.9.x 版本使用 `flvx-svc` 前缀，Docker 数据卷名为 `flvx-svc_sqlite_data`。
4.0.0 版本改用 `flox-svc` 前缀，compose 文件引用 `flox-svc_sqlite_data`。

升级时 Docker 发现新卷名不存在，自动创建了一个**空卷**，后端启动后连接到空卷，所以数据"消失"了。

**旧数据仍然完整保存在 `flvx-svc_sqlite_data` 卷中，可以恢复。**

## 恢复步骤

SSH 登录服务器，依次执行以下命令：

### 1. 确认旧卷存在

```bash
docker volume ls | grep sqlite
```

应看到类似输出：

```
local     flox-svc_sqlite_data    ← 4.0.0 的空卷
local     flvx-svc_sqlite_data    ← 3.9.x 的旧数据卷
```

如果只有 `flox-svc_sqlite_data` 且没有 `flvx-svc_sqlite_data`，说明旧卷已被删除，无法恢复。

### 2. 停止后端容器

```bash
docker stop flox-svc-backend
```

### 3. 从旧卷复制数据到新卷

```bash
docker run --rm \
  -v flvx-svc_sqlite_data:/old \
  -v flox-svc_sqlite_data:/new \
  alpine sh -c "rm -f /new/gost.db /new/gost.db-wal /new/gost.db-shm && cp -a /old/. /new/"
```

### 4. 重启后端

```bash
docker start flox-svc-backend
```

### 5. 验证数据恢复

等待约 30 秒后，刷新面板页面，检查用户、隧道、节点等数据是否恢复。

也可以通过 API 验证：

```bash
curl -s http://localhost:63665/flow/test
```

返回正常响应说明后端已启动。

### 6. 清理旧卷

确认数据恢复无误后，删除旧卷释放空间：

```bash
docker volume rm flvx-svc_sqlite_data
```

如果旧版使用了 PostgreSQL：

```bash
docker volume ls | grep postgres
# 如果存在 flvx-svc_postgres_data，同样需要迁移
docker stop flox-svc-backend
docker run --rm \
  -v flvx-svc_postgres_data:/old \
  -v flox-svc_postgres_data:/new \
  alpine sh -c "cp -a /old/. /new/"
docker start flox-svc-backend
# 验证后删除旧卷
docker volume rm flvx-svc_postgres_data
```

## 常见问题

### Q: 执行恢复后数据还是空的？

检查后端日志确认是否连接到了正确的数据库：

```bash
docker logs flox-svc-backend --tail 20
```

确认日志中 `DB_PATH` 指向 `/app/data/gost.db`，且没有 "database is locked" 等错误。

### Q: 旧卷名不是 `flvx-svc_sqlite_data` 怎么办？

用以下命令查看所有 Docker 卷，找到包含 `sqlite` 的旧卷名：

```bash
docker volume ls | grep -i sqlite
```

然后将上述恢复命令中的 `flvx-svc_sqlite_data` 替换为实际的旧卷名。

### Q: 升级前手动备份过 gost.db 文件？

可以直接用备份文件恢复：

```bash
docker stop flox-svc-backend
docker run --rm \
  -v flox-svc_sqlite_data:/data \
  -v /备份目录:/backup \
  alpine sh -c "rm -f /data/gost.db /data/gost.db-wal /data/gost.db-shm && cp /backup/gost.db /data/ && cp /backup/gost.db-wal /data/ 2>/dev/null; cp /backup/gost.db-shm /data/ 2>/dev/null; chown 1000:1000 /data/gost.db*"
docker start flox-svc-backend
```

## 预防措施

以后升级前建议先手动备份数据库：

```bash
docker cp flox-svc-backend:/app/data/gost.db /root/gost.db.bak
docker cp flox-svc-backend:/app/data/gost.db-wal /root/gost.db-wal.bak 2>/dev/null
docker cp flox-svc-backend:/app/data/gost.db-shm /root/gost.db-shm.bak 2>/dev/null
```
