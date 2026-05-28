# 017 - 注册开关 + 试用期 + 受限用户流

## 概述
- 开放注册开关（用户页面右上角）
- 注册账号默认 3 天试用期
- 到期后仍可登录但受限（只能进商城购买）
- 购买套餐后恢复所有功能
- 修复购买套餐 "套餐ID不能为空" bug

## 改动清单

### 后端
1. `mutations.go:userRegister` — 检查 registration_enabled + 设 3 天过期
2. `handler.go:login` — 过期用户仍可登录，返回 restricted 标志

### 前端
3. `session.ts` — 存储 restricted 标志 + isRestricted()
4. `App.tsx` — ProtectedRoute 受限重定向
5. `admin.tsx` — 菜单灰显
6. `shop.tsx` + `admin-payment.tsx` — 修复 packageId→package_id
7. `user.tsx` — 注册开关
8. `index.tsx` — 关闭时隐藏注册按钮

## 任务状态
- [ ] 后端: userRegister 加 registration_enabled 检查 + 3天有效期
- [ ] 后端: login 允许过期用户登录返回 restricted 标志
- [ ] 前端: shop.tsx/admin-payment.tsx 修复 packageId→package_id
- [ ] 前端: session.ts 存储 restricted 标志 + isRestricted()
- [ ] 前端: App.tsx ProtectedRoute 限制受限用户只访问 /myhome /shop
- [ ] 前端: admin.tsx 受限用户菜单灰显不可点击
- [ ] 前端: user.tsx 右上角加开放注册开关
- [ ] 前端: index.tsx 注册关闭时隐藏注册按钮
- [ ] 构建测试后端+前端，确认无编译错误
