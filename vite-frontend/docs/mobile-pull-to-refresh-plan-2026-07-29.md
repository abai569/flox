# 移动端下拉刷新修复计划

- 范围：`vite-frontend/src`、`closed/vite-frontend/src/pages`
- 计划日期：2026-07-29
- 当前状态：待实施
- 验证命令：`npm run build`

## 1. 背景

移动端 H5 布局已经通过 `GlobalPullToRefresh` 和 `usePullToRefresh` 为主要业务页面提供下拉刷新，但当前机制是全局 DOM 事件广播，刷新动画、异步请求和页面数据范围之间没有可靠的生命周期约束。

现状的主要问题不是业务页面整页漏接，而是：

- 刷新回调执行后立即结束动画，没有等待异步请求完成
- 刷新期间可以重复触发，可能产生并发请求和旧响应覆盖
- 没有注册刷新回调时缺少自动复位和超时兜底
- 横向滚动、拖拽、弹窗和局部滚动容器可能误触发全局刷新
- 部分页面只刷新外层列表，没有刷新当前可见详情或依赖数据
- 页面之间对 loading、错误和刷新完成状态的处理不一致

## 2. 范围边界

### 2.1 纳入修复

- H5 布局内全局下拉手势和刷新状态管理
- `usePullToRefresh` 异步回调接口
- 已接入下拉刷新的业务路由
- 当前页面、当前 Tab 和当前详情所需数据的刷新覆盖
- 请求互斥、超时、取消、异常处理和组件卸载清理
- Android WebView、iOS Safari 和常规移动浏览器的触摸行为

### 2.2 不纳入修复

- `/tz` 不增加下拉刷新：该页面数据通过实时机制更新，不需要手动下拉
- 登录页、修改密码页和面板地址页不增加下拉刷新
- 不为本次修复引入 TanStack Query 或其他全局数据缓存框架
- 不重构页面无关的数据请求和 UI 结构
- 不新增前端测试框架

### 2.3 清理项

- 删除 `/tz` 中无效的 `usePullToRefresh(loadGroups)` 注册及对应 import

## 3. 目标

修复后应满足以下行为：

1. 只有 H5 主滚动容器位于顶部时才允许开始下拉。
2. 只有明确的纵向下拉手势才会被接管，横向滚动和拖拽不受影响。
3. 刷新指示器持续到当前页面刷新 Promise 完成，而不是请求刚发出时结束。
4. 同一时间最多执行一次下拉刷新。
5. 路由切换、组件卸载或超时后可以终止或忽略旧请求结果。
6. 没有注册处理器、处理器抛错或网络超时时，指示器都能可靠复位。
7. 下拉刷新覆盖当前用户能看到的主要数据，同时避免无条件刷新无关 Tab。
8. 桌面 Admin 布局行为保持不变。

## 4. 方案设计

### 4.1 使用布局级 Provider 管理刷新

在 H5 布局中引入下拉刷新 Provider，由 Provider 统一持有：

- 当前页面注册的异步刷新处理器
- `idle`、`pulling`、`ready`、`refreshing`、`settling` 状态
- 当前拉动距离、起点坐标和手势方向
- `AbortController`、超时计时器和组件挂载状态
- 是否存在可用处理器

页面通过 hook 注册处理器，不再直接监听和广播全局 DOM 事件。

建议接口：

```ts
type PullToRefreshContext = {
  signal: AbortSignal;
};

type PullToRefreshHandler = (
  context: PullToRefreshContext,
) => void | Promise<void>;

usePullToRefresh(async ({ signal }) => {
  await loadData({ signal });
});
```

如果现有 API 暂时不能接收 `AbortSignal`，第一阶段仍应等待 Promise，并通过请求序号或 mounted ref 忽略过期结果；后续再逐步把 `signal` 传入网络层。

### 4.2 统一异步生命周期

触发刷新时执行以下流程：

1. 检查已注册处理器且当前不是 `refreshing`。
2. 创建新的 `AbortController` 和超时计时器。
3. 将状态切换为 `refreshing`。
4. 使用 `await Promise.resolve(handler({ signal }))` 等待页面请求。
5. 捕获同步异常和 Promise reject，交由页面现有 toast 或统一错误回调处理。
6. 在 `finally` 中清理超时、复位距离并结束动画。
7. 路由切换或 Provider 卸载时 abort 当前刷新并清理监听器。

建议超时为 15 秒。超时只负责结束手势状态和取消可取消请求，不应让已卸载页面继续更新状态。

### 4.3 收紧手势判定

- 事件绑定到 `#h5-main`，不在整个 `document` 上接管触摸
- `#h5-main.scrollTop <= 0` 时才记录候选手势
- 记录 `startX` 和 `startY`，移动超过最小距离后锁定方向
- 仅当 `deltaY > 0` 且 `deltaY` 明显大于 `abs(deltaX)` 时进入拉动状态
- 横向手势一旦锁定，本次触摸不再尝试触发下拉刷新
- 忽略多点触控、输入控件、弹窗、下拉菜单和标记为禁用刷新的区域
- 增加 `touchcancel`，与 `touchend` 共用状态清理逻辑
- `refreshing` 状态下不接受新的拉动手势
- 只在真正接管纵向手势后调用 `preventDefault()`

可为局部区域提供 `data-pull-to-refresh-ignore` 属性，供弹窗、横向表格和拖拽容器显式禁用。

### 4.4 稳定 H5 滚动容器

检查并调整 H5 根布局，使滚动责任明确落在 `#h5-main`：

- 根容器使用稳定的视口高度约束
- 主内容区使用 `min-h-0 flex-1 overflow-y-auto`
- 保留安全区、固定顶栏和现有底部间距
- 避免页面内容把根容器撑高后改由 `window` 滚动

该项实施时需要在真实移动视口检查固定导航、弹窗和长列表，不能只依赖 TypeScript 构建。

## 5. 页面刷新范围

| 路由 | 计划刷新范围 | 处理重点 |
|------|--------------|----------|
| `/dashboard` | 套餐/用户信息、规则统计、公告、管理员到期提醒、当前展示的配额历史 | 将分散请求组成可等待 Promise；只刷新已展示的延迟数据 |
| `/monitor` | 当前 Tab 的列表及当前打开详情 | 节点详情刷新指标；隧道详情刷新快照、历史和流量图 |
| `/forward` | 隧道、规则、限速、授权、套餐及必要节点数据 | 保持现有范围，确保轮询和下拉请求不会竞态 |
| `/tunnel` | 隧道、节点、节点组、隧道组 | 保持现有范围并等待全部请求完成 |
| `/node` | 节点、分享计数、节点组、节点实例及当前可见远程用量 | 把脱离 Promise 链的请求纳入刷新完成周期 |
| `/sdwan` | SDWAN 分组和节点 | 与 30 秒轮询互斥或使用请求序号避免旧响应覆盖 |
| `/user` | 当前筛选和分页用户、页面操作依赖数据 | 修复 `searchKeyword` 闭包依赖；按需刷新权限和配置数据 |
| `/config` | 配置、公告、授权信息 | 使用 `Promise.all` 或等价方式统一等待 |
| `/shop` | 支付配置、套餐、当前订阅、套餐组 | 保持现有范围并等待完成 |
| `/myhome` | 当前筛选和分页订单、订阅、用户套餐信息 | 保留请求序号保护并接入统一刷新生命周期 |
| `/admin/plans` | 套餐、隧道组、套餐组 | 去除初始化阶段重复请求套餐组的问题 |
| `/admin/orders` | 当前筛选和分页订单、统计、必要用户筛选数据 | 用户列表可按缓存时效刷新，避免每次拉取 1000 条 |
| `/admin/payment` | 当前主 Tab 数据及跨 Tab 公共统计 | 不再每次无条件刷新支付和账务两个大数据域 |
| `/admin/telegram` | Telegram 配置和授权信息 | 保持现有范围并等待完成 |

## 6. 实施阶段

### Phase A：修复基础机制

- [ ] A1. 将 `usePullToRefresh` 改为 Promise 感知的处理器注册接口
- [ ] A2. 在 H5 布局建立 Provider，并移除全局刷新 DOM 事件广播
- [ ] A3. 增加刷新互斥、15 秒超时、异常复位和卸载清理
- [ ] A4. 增加方向锁、`touchcancel`、多点触控和忽略区域处理
- [ ] A5. 明确 `#h5-main` 为唯一纵向主滚动容器
- [ ] A6. 删除 `/tz` 的无效下拉刷新注册

### Phase B：修复开源页面数据覆盖

- [ ] B1. `/dashboard` 返回并等待完整刷新 Promise，补齐当前展示数据
- [ ] B2. `/monitor` 按当前 Tab 和当前详情刷新
- [ ] B3. `/forward`、`/tunnel` 接入统一生命周期并处理并发请求
- [ ] B4. `/node` 补齐节点组、实例和远程用量刷新链路
- [ ] B5. `/user` 修复搜索闭包并补齐必要支撑数据
- [ ] B6. `/config` 合并分散异步请求

### Phase C：修复闭源页面数据覆盖

- [ ] C1. 先运行 `scripts/merge-closed.ps1` 恢复闭源页面
- [ ] C2. `/sdwan`、`/shop`、`/myhome` 接入统一生命周期
- [ ] C3. `/admin/plans`、`/admin/orders` 修复重复或缺失请求
- [ ] C4. `/admin/payment` 改为按当前 Tab 刷新
- [ ] C5. `/admin/telegram` 接入统一生命周期
- [ ] C6. 修改闭源文件后按项目闭源流程同步回 `closed`

### Phase D：验证与收尾

- [ ] D1. 执行 `npm run build`
- [ ] D2. 在窄屏浏览器验证所有业务路由的触发和完成状态
- [ ] D3. 在 Android WebView 验证下拉、横向滚动、弹窗和拖拽冲突
- [ ] D4. 在 iOS Safari 或等价 WebKit 环境验证滚动边界和系统回弹
- [ ] D5. 验证慢请求、失败请求、超时、路由切换和连续手势
- [ ] D6. 更新本文档任务状态和最终修改文件清单

## 7. 验收标准

### 7.1 功能验收

- 所有纳入范围的 H5 业务页面都能在主内容顶部触发刷新
- `/tz` 不显示、不注册下拉刷新
- 刷新动画至少持续到页面刷新 Promise settle
- 刷新过程中再次下拉不会发起第二组请求
- 当前 Tab 或当前详情刷新后可见数据发生对应更新
- 没有处理器、请求失败和请求超时都不会留下永久旋转指示器

### 7.2 手势验收

- 横向滑动表格、Tab 和图表不会触发下拉刷新
- 拖拽排序不会被下拉刷新中断
- 弹窗内部滚动到顶部后继续下拉不会刷新底层页面
- 页面不在顶部时下拉不会触发刷新
- `touchcancel` 后所有视觉和内部状态恢复为 idle

### 7.3 工程验收

- `npm run build` 通过
- 不运行会自动修改前端文件的 lint 命令
- 不新增前端测试框架
- 闭源页面改动不会提交到主仓库
- 不改变桌面 Admin 布局的滚动与数据加载行为

## 8. 预计修改文件

基础机制预计涉及：

- `vite-frontend/src/components/global-pull-to-refresh.tsx`
- `vite-frontend/src/hooks/usePullToRefresh.ts`
- `vite-frontend/src/layouts/h5.tsx`
- `vite-frontend/src/pages/tz.tsx`

开源页面预计涉及：

- `vite-frontend/src/pages/dashboard/use-dashboard-data.ts`
- `vite-frontend/src/pages/dashboard.tsx`
- `vite-frontend/src/pages/monitor.tsx`
- `vite-frontend/src/pages/node/monitor-view.tsx`
- `vite-frontend/src/pages/tunnel/tunnel-monitor-view.tsx`
- `vite-frontend/src/pages/forward.tsx`
- `vite-frontend/src/pages/tunnel.tsx`
- `vite-frontend/src/pages/node.tsx`
- `vite-frontend/src/pages/user.tsx`
- `vite-frontend/src/pages/config.tsx`

闭源页面预计涉及：

- `vite-frontend/src/pages/sdwan.tsx`
- `vite-frontend/src/pages/shop.tsx`
- `vite-frontend/src/pages/myhome.tsx`
- `vite-frontend/src/pages/admin-plans.tsx`
- `vite-frontend/src/pages/admin-orders.tsx`
- `vite-frontend/src/pages/admin-payment.tsx`
- `vite-frontend/src/pages/admin-telegram.tsx`

最终实施时以实际必要改动为准，不为了匹配清单而修改行为已经正确的页面。

## 9. 风险与回退

| 风险 | 控制措施 |
|------|----------|
| 主滚动容器调整导致布局高度变化 | 先独立验证 H5 顶栏、长列表和安全区，再接入手势修改 |
| 页面刷新函数返回值不一致 | 分批改造，每个页面显式返回 Promise |
| 轮询与手动刷新竞态 | 使用互斥、请求序号或 AbortSignal，旧响应不得覆盖新状态 |
| 弹窗和拖拽手势冲突 | 方向锁加忽略区域，逐个高交互页面手工验证 |
| 闭源文件同步遗漏 | 严格执行 merge、构建、strip 和 closed 仓库同步流程 |

如果基础机制改造出现兼容性问题，可以按 Phase 回退：先保留新的异步 hook，仅暂时恢复旧手势组件；页面刷新 Promise 的整理仍可独立保留。
