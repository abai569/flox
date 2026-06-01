# 021 Package Grouping

## Goal
为套餐管理页面（订阅/流量/余额三类）新增分组功能，完整参考节点分组实现：分组管理弹窗 + 分组筛选 + 分组列 + 分组视图 + 表单分组选择。

## Context
- 节点分组完整实现位于：`go-backend/internal/store/model/model.go:880` (NodeGroup) → `repository_node_groups.go` → `node_group.go` (handler) → `node.tsx` + `node-group-manager.tsx`
- 套餐模型位于：`go-backend/internal/store/model/product.go` (`SubscriptionPackage`)
- 前端套餐页面：`vite-frontend/src/pages/admin-plans.tsx`

## Design Decisions
- **分组跨类型共享**：三类套餐（订阅/流量/余额）共用同一组分组列表（同节点分组模式）
- **完整分组视图**：支持 `viewMode: "grouped"` 折叠卡片视图
- **完整分组管理 UI**：参考 `NodeGroupManager` 全部功能

## Task Checklist

### A — 后端模型
- [x] **A1**: `model.go` 新增 `PackageGroup` 结构体（参考 `NodeGroup`，表名 `package_group`）
- [x] **A2**: `product.go` / `model.go` 中 `SubscriptionPackage` 新增 `GroupID sql.NullInt64` 字段
- [x] **A3**: `repository.go` AutoMigrate 注册 `&model.PackageGroup{}`

### B — 后端仓库
- [x] **B1**: 新建 `repository_package_groups.go`，参照 `repository_node_groups.go` 实现 8 个方法
- [x] **C1**: 新建 `package_group.go` (`PackageGroupHandler`)，参照 `node_group.go` 5 个端点
- [x] **C2**: `product.go` — `createPackage` / `updatePackage` 请求体新增 `groupId` 字段
- [x] **C3**: `product.go` — 已通过 JSON 序列化自然返回 `groupId`
- [x] **D1**: `handler.go` 注册 5 条新路由 + 初始化 `packageGroupHandler`
- [x] **D2**: `handler.go` Handler struct 新增 `packageGroupHandler` 字段
- [x] **E1**: `types.ts` 新增 `PackageGroupApiItem` 和 `PackageGroupMutationPayload`
- [x] **E2**: `types.ts` `SubscriptionPackageApiItem` 新增 `groupId?: number`
- [x] **E3**: `index.ts` 新增 5 个 API 函数
- [x] **F1**: 新建 `package-group-manager.tsx`（549 行），完整参照 `node-group-manager.tsx`
- [x] **G1**: 工具栏新增"管理分组"按钮 → `PackageGroupManager`
- [x] **G2**: 工具栏新增视图切换按钮（列表 ↔ 分组）
- [x] **G3**: 全局分组 Select 筛选器（全部/未分组/各分组+数量）+ 重置按钮
- [x] **G4**: 三表各新增"分组"列，显示颜色色标 + 名称，点击筛选
- [x] **G5**: 创建/编辑表单新增分组 Select（可选）
- [x] **G6**: `handlePkgEdit` 加载 `groupId`
- [x] **G7**: `handlePkgSubmit` + `handleDescSave` 发送 `groupId`
- [x] **G8**: 新增 `viewMode` 状态 + `filterGroupId` 筛选
- [x] **G9**: 分组视图 `PackageGroupedView` — 折叠卡片 + 套餐列表 + 快速分配 Select
- [x] **G10**: 空行 colSpan 已更新
- [x] **H1**: 商店页按分组展示（保留类型 Tab，Tab 内按 groupId 分块渲染 + 色标 + 可折叠 + 未分组）

### Verify
- [x] `go build` 编译通过
- [x] 前端 `npm run build` 编译通过

## Files to Modify/Create

| File | Action | Notes |
|------|--------|-------|
| `go-backend/internal/store/model/model.go` | 修改 | 新增 `PackageGroup` 模型 |
| `go-backend/internal/store/model/product.go` | 修改 | `SubscriptionPackage` 加 `GroupID` |
| `go-backend/internal/store/repo/repository.go` | 修改 | AutoMigrate + ListPackagesOptions 加 GroupID 筛选 + 返回 `groupId` |
| `go-backend/internal/store/repo/repository_package_groups.go` | 新建 | 8 个仓库方法 |
| `go-backend/internal/http/handler/package_group.go` | 新建 | `PackageGroupHandler` 5 个端点 |
| `go-backend/internal/http/handler/product.go` | 修改 | CRUD handler 支持 `groupId` |
| `go-backend/internal/http/handler/handler.go` | 修改 | 5 路由 + Handler 字段 |
| `vite-frontend/src/api/types.ts` | 修改 | 新增类型定义 |
| `vite-frontend/src/api/index.ts` | 修改 | 5 API 函数 |
| `vite-frontend/src/pages/admin-plans/package-group-manager.tsx` | 新建 | 分组管理弹窗（~400 行） |
| `vite-frontend/src/pages/admin-plans.tsx` | 修改 | 分组筛选/列/表单/视图/工具栏 |
| `vite-frontend/src/pages/shop.tsx` | 可选修改 | 分组筛选 |
