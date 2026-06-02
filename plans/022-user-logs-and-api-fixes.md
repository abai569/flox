# 022 - 用户页面日志功能修复与 API 安全加固

## 概述

修复用户页面两个日志记录（流量归零日志、续费记录）的已知问题，并加固相关 API 权限校验。

## 修复清单

### 任务 1：续费记录前端改用统一 API 层
- **文件**：`vite-frontend/src/pages/user.tsx`
- **问题**：续费记录加载和删除后刷新使用了原始 `fetch`，绕过了 axios 拦截器、错误处理等
- **修复**：在 `src/api/index.ts` 中定义 `getUserRenewalLogs` 函数，替换原始 `fetch` 调用
- **优先级**：高

### 任务 2：后端 API 增加权限校验
- **文件**：`go-backend/internal/http/handler/user_quota.go`
- **问题**：四个相关接口缺少权限校验（`/user/quota/history`、`/user/quota/history/delete`、`/user/renewal-logs`、`/user/renewal-log/delete`）
- **修复**：在 handler 中增加 JWT 角色验证
- **优先级**：高

### 任务 3：手动修改余额/到期时间时记录续费日志
- **文件**：`go-backend/internal/http/handler/mutations.go`
- **问题**：管理员手动修改用户余额或到期时间时，不会创建 `UserRenewalLog`
- **修复**：在 `userUpdate` handler 中添加续费日志创建逻辑
- **优先级**：高

### 任务 4：`ResetUserFlowByUser` 增加事务保护
- **文件**：`go-backend/internal/store/repo/repository_mutations.go`
- **问题**：流量更新和历史记录创建不在同一事务中，可能数据不一致
- **修复**：使用 `r.db.Transaction` 包裹相关操作
- **优先级**：中

### 任务 5：修复 `UserQuotaHistoryItem` 的 `periodType` 类型
- **文件**：`vite-frontend/src/api/types.ts`
- **问题**：`periodType` 定义为 `"daily" | "monthly"`，但后端会写入 `"tunnel"`
- **修复**：类型定义增加 `"tunnel"`
- **优先级**：中

### 任务 6：修复 `loadUsers` 分页 total 设置
- **文件**：`vite-frontend/src/pages/user.tsx`
- **问题**：`total` 设置为当前页条数而非数据库总用户数
- **修复**：正确设置 `total` 使用后端返回的总数
- **优先级**：低

## 状态跟踪

- [ ] 任务 1：续费记录改用统一 API 层
- [ ] 任务 2：后端 API 增加权限校验
- [ ] 任务 3：手动修改余额/到期时间时记录续费日志
- [ ] 任务 4：`ResetUserFlowByUser` 增加事务保护
- [ ] 任务 5：修复 `periodType` 类型
- [ ] 任务 6：修复分页 total 设置
