# 011-panel-upgrade-with-progress-bar

## 问题

当前面板升级是黑盒执行：
1. 升级在后台 goroutine 执行，前端只收到"已提交"响应
2. 错误信息只输出到服务器日志 (fmt.Printf)，前端完全看不到
3. 用户不知道升级进度，只能通过 WebSocket 断连猜结果
4. 回滚也是静默执行，用户不知道是否成功

## 目标

参考节点升级的进度条机制，为面板升级添加：
1. **实时进度条** - 在升级 Modal 中显示各阶段进度
2. **错误回传** - 失败时把具体错误信息推送到前端显示
3. **阶段可视化** - 让用户看到当前执行到哪一步

## 方案

### 后端改造

#### 1. 新增进度广播方法 (upgrade.go)

```go
func (h *Handler) broadcastPanelUpgradeProgress(stage string, percent int, message string, hasError bool) {
    if h.wsServer == nil {
        return
    }
    payload := map[string]interface{}{
        "stage":   stage,
        "percent": percent,
        "message": message,
        "error":   hasError,
    }
    data, _ := json.Marshal(payload)
    h.wsServer.BroadcastToAdmins(fmt.Sprintf(`{"type":"panel_upgrade_progress","data":%s}`, string(data)))
}
```

#### 2. 在 executePanelUpgrade 各阶段插入进度报告

| 阶段 | stage | percent | message |
|------|-------|---------|---------|
| 开始 | starting | 0 | 开始升级面板... |
| 备份 | backing_up | 5 | 备份配置文件... |
| 下载 | downloading | 10 | 下载 docker-compose.yml... |
| 更新版本 | updating | 20 | 更新版本配置... |
| 拉取镜像 | pulling | 30 | 拉取镜像... |
| 停止服务 | stopping | 70 | 停止旧服务... |
| 启动服务 | starting_containers | 80 | 启动新服务... |
| 健康检查 | health_check | 90 | 等待服务就绪... |
| 完成 | completed | 100 | 升级完成 |

#### 3. 错误处理时广播具体错误

```go
if err := runDockerComposePull(installDir); err != nil {
    h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("拉取镜像失败：%v", err), true)
    return fmt.Errorf("拉取镜像失败：%v", err)
}
```

#### 4. WebSocket Server 新增公开广播方法

```go
// server.go
func (s *Server) BroadcastToAdmins(message string) {
    s.broadcastToAdmins(message)
}
```

### 前端改造

#### 1. version-footer.tsx 新增进度状态

```typescript
const [upgradeProgress, setUpgradeProgress] = useState<{
  stage: string;
  percent: number;
  message: string;
  error: boolean;
} | null>(null);
```

#### 2. Modal 内根据状态显示不同 UI

- **升级中**：显示进度条 + 阶段文字，隐藏版本选择和说明
- **成功**：toast 提示 + 关闭 Modal + 刷新页面
- **失败**：进度条变红色 + 显示错误信息，Modal 保持打开

#### 3. 全局 WebSocket 消息处理

在 `vite-frontend/src/pages/node.tsx` 已有的 `handleWebSocketMessage` 中新增 panel_upgrade_progress 处理，
或者创建一个全局的 hook 来处理面板级别的 WebSocket 消息。

## 文件变更清单

| 文件 | 变更内容 |
|------|---------|
| go-backend/internal/http/handler/upgrade.go | 新增 broadcastPanelUpgradeProgress；executePanelUpgrade 各阶段插入进度报告 |
| go-backend/internal/ws/server.go | 新增 BroadcastToAdmins 公开方法 |
| vite-frontend/src/components/version-footer.tsx | 新增进度状态、进度条 UI、Modal 内状态切换 |
| vite-frontend/src/pages/node.tsx | handleWebSocketMessage 新增 panel_upgrade_progress 处理 |

## 任务清单

- [x] 1. 后端：WebSocket Server 新增 BroadcastToAdmins 公开方法
- [x] 2. 后端：handler 新增 broadcastPanelUpgradeProgress 方法
- [x] 3. 后端：executePanelUpgrade 各阶段插入进度广播
- [x] 4. 前端：version-footer.tsx 新增进度状态管理
- [x] 5. 前端：Modal 内根据状态切换 UI（版本选择 → 进度条）
- [x] 6. 前端：进度条组件集成（Progress + 阶段文字）
- [x] 7. 前端：成功/失败/升级中三种状态的 UI 处理
- [x] 8. 前端：WebSocket 消息处理（panel_upgrade_progress）
- [ ] 9. 测试：验证各阶段进度显示正确
- [ ] 10. 测试：验证错误信息正确回传到前端
