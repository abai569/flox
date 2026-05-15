# 自动续费功能实现计划

**创建时间**: 2026-05-16  
**需求**: 用户新增弹窗添加续费金额、可用余额文本框，状态旁边添加自动续费开关，列表视图显示相关字段，支持到期自动续费

## ✅ 任务清单 - 全部完成 🎉

### 后端修改 - 已完成 ✅
- [x] 1. `go-backend/internal/store/model/model.go` - User 模型添加 3 个字段
- [x] 2. `model.go` - 新增 UserRenewalLog 模型
- [x] 3. `go-backend/internal/store/repo/repository_mutations.go` - CreateUser 添加参数
- [x] 4. `repository_mutations.go` - UpdateUserWithPassword 添加参数
- [x] 5. `repository_mutations.go` - UpdateUserWithoutPassword 添加参数
- [x] 6. `repository_mutations.go` - 新增 RenewUserWithBalance 方法
- [x] 7. `repository_mutations.go` - 新增 GetUserRenewalLogs 方法
- [x] 8. `repository.go` - UserRenewalLog 注册到 AutoMigrate
- [x] 9. `go-backend/internal/http/handler/mutations.go` - userCreate 提取新参数
- [x] 10. `mutations.go` - userUpdate 提取新参数
- [x] 11. `mutations.go` - userUpdate 传递新参数
- [x] 12. `jobs.go` - disableExpiredUsers 添加自动续费逻辑（月对月 +1）
- [x] 13. `user_quota.go` - 新增 userRenewalLogs API
- [x] 14. `handler.go` - 注册 renewal-logs 路由

### 前端修改 - 已完成 ✅
- [x] 15. `vite-frontend/src/types/index.ts` - User 接口添加 3 个字段
- [x] 16. `index.ts` - 新增 UserRenewalLog 类型
- [x] 17. `user.tsx` - userForm 状态添加 3 个字段
- [x] 18. `user.tsx` - handleEdit 填充新字段
- [x] 19. `user.tsx` - 到期时间单元格删除时分秒 + 下箭头 + 点击事件
- [x] 20. `user.tsx` - 表头添加 3 列（续费金额、可用余额、自动续费）
- [x] 21. `user.tsx` - 表格内容添加 3 个单元格（样式与状态列一致）
- [x] 22. `user.tsx` - 弹窗添加自动续费 UI 控件（2 个 Input + 1 个 Switch）
- [x] 23. `user.tsx` - 新增续费日志弹窗组件
- [x] 24. `user.tsx` - 新增 handleOpenRenewalLogModal 函数
- [x] 25. `user.tsx` - 新增相关状态
- [x] 26. `user.tsx` - 卡片视图添加续费信息显示
- [x] 27. `dashboard/use-dashboard-data.ts` - DashboardUserInfo 添加 3 个字段
- [x] 28. `dashboard.tsx` - 主页添加续费金额、可用余额、自动续费状态卡片

## 实现顺序 - 全部完成 ✅

1. ✅ 后端模型层 (model.go)
2. ✅ 后端 Repository 层 (repository_mutations.go, repository.go)
3. ✅ 后端 Handler 层 (mutations.go, jobs.go, user_quota.go, handler.go)
4. ✅ 前端类型定义
5. ✅ 前端表单和状态
6. ✅ 前端列表视图
7. ✅ 前端弹窗组件
8. ✅ 主页显示（卡片视图 + Dashboard）
9.  ⏳ 测试验证

## 功能总结

### 后端
- ✅ User 模型新增 `renewal_amount`（续费金额）、`balance`（可用余额）、`auto_renew`（自动续费开关）
- ✅ UserRenewalLog 日志模型记录续费历史
- ✅ 自动续费逻辑：到期时检查余额，充足则自动扣款并延长 1 个月
- ✅ REST API 支持新字段的 CRUD 和日志查询

### 前端 - 管理员视图
- ✅ 新增用户弹窗：续费金额、可用余额输入框（单位：元），自动续费开关
- ✅ 列表视图：3 列显示续费信息，到期时间可点击打开日志弹窗
- ✅ 卡片视图：显示自动续费状态、续费金额、可用余额
- ✅ 续费日志弹窗：详细记录续费历史

### 前端 - 用户主页（Dashboard）
- ✅ 续费金额卡片：显示续费金额 + 自动续费状态
- ✅ 可用余额卡片：显示可用余额（绿色高亮）
