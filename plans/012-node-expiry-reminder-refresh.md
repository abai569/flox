# 012-node-expiry-reminder-refresh

## 背景
当前节点"关闭提醒"的功能仅是将 `expiry_reminder_dismissed` 设为 `1`，导致提醒永久关闭。对于包月/包季的用户，点击后应重置提醒周期（如剩 7 天时重置，变成 30 天后）并恢复提醒状态。

## 目标
点击"更新提醒周期"按钮后，执行以下逻辑：
1. **重置 dismissed 状态**：将 `expiry_reminder_dismissed` 恢复为 `0`。
2. **更新 dismissed 截止时间**：将 `expiry_reminder_dismissed_until` 设置为 `当前时间 + RenewalCycle`（月付+30天等）。

## 方案

### 1. 后端改造 (`go-backend`)
- **Handler**
  新增 Handler `nodeRefreshExpiryReminder`：
  - 路由：`POST /api/v1/node/refresh-expiry-reminder`。
  - 逻辑：计算新的 `dismissed_until`，更新数据库，并设置 `dismissed = 0`。

### 2. 前端改造 (`vite-frontend`)
- **API (`api/index.ts`)**
  新增函数 `refreshNodeExpiryReminder(id)` 指向新路由。

- **Node List UI (`node-list-view.tsx`)**
  - **文案变更**：按钮文字从"关闭提醒"改为"更新周期"。
  - **逻辑变更**：点击调用 `refreshNodeExpiryReminder`。

- **Node Page (`node.tsx`)**
  - **文案变更**：弹窗按钮文字改为"更新周期"。
  - **逻辑变更**：修改 `handleDismissExpiryReminder` 逻辑，调用新 API。

## 任务清单
- [ ] 1. 后端：新增 Refresh Handler 路由
- [ ] 2. 前端：API 更新
- [ ] 3. 前端：UI 文案与逻辑更新
- [ ] 4. 测试与提交
