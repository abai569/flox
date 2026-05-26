# 003-redesign-product-payment-billing

商品页 UI 升级 + 支付配置页全面重写 + 新增账单/兑换码/折扣码管理。

## 范围

| 页面 | 改动幅度 | 说明 |
|------|---------|------|
| admin-products.tsx | 前端大改 | 保持 recharge/traffic/time 模型，UI 参照 Forwardx Plans 风格 |
| admin-payment.tsx | 前后端大改 | 参照 Forwardx Payments，Tab 布局 + 基础设置 + 测试下单 + 订单记录 |
| admin-billing.tsx | 全新 | 参照 Forwardx Billing，余额流水 + 兑换码 + 折扣码 + 功能开关 |
| 后端 | 新增 | redeem_code + discount_code 模型/仓库/Handler/路由 |

## 任务分解

### 0. 修复商品无法添加的 Bug

- [x] Product 模型添加 json tags（已完成）
- [ ] createProduct handler: `sort_order` → 兼容 `sort_order` 和 `sortOrder`
- [ ] updateProduct handler: 补上 `type` 字段读取和传递

### 1. admin-products.tsx 前端 UI 升级

- [ ] 顶部添加统计卡片：商品总数、上架数、各类型数量
- [ ] 表格优化：类型用 Badge 显示、状态用色块、价格显示为"元"
- [ ] 表单优化：价格输入用"元"（自动转分为后端单位），增加商品说明 textarea

### 2. admin-payment.tsx 全面重写

#### 2.1 前端
- [ ] Tab 布局：基础设置 / 易支付 / USDT / 测试下单 / 订单记录
- [ ] 统计卡片：支付状态、已收金额、已支付订单数、待支付订单数
- [ ] 基础设置 Tab：全局开关、商品名称、最低/最高金额、订单过期时间、最大待支付订单
- [ ] 易支付 Tab：网关地址、PID、密钥、下单方式(跳转/API)、支付宝CID、微信CID + 回调地址复制
- [ ] USDT Tab：API Key、IPN Secret
- [ ] 测试下单 Tab：金额 + 支付方式 + 创建 + 展示链接
- [ ] 订单记录 Tab：完整订单表格

#### 2.2 后端新增
- [ ] 支付统计接口 `/api/v1/payment/stats`
- [ ] 订单列表路由 `/api/v1/order/admin/list`（已有，确认可用）

### 3. admin-billing.tsx 全新页面

#### 3.1 前端
- [ ] Tab 布局：余额流水 / 兑换码 / 折扣码
- [ ] 统计卡片：用户余额总额、可用兑换码数、生效折扣码数、功能开关
- [ ] 余额流水 Tab：全量 balance_log 表格，可按用户筛选
- [ ] 兑换码 Tab：生成区(码/随机、类型、套餐、期限、金额、数量、有效期) + 列表(状态、使用人、删除)
- [ ] 折扣码 Tab：创建区(码/随机、百分比/固定金额、值、次数、适用套餐、有效期) + 列表(状态、次数、删除)
- [ ] 功能开关：兑换入口启用/关闭，折扣入口启用/关闭

#### 3.2 后端新增

##### redeem_code
- [ ] Model: `RedeemCode`（code unique, type plan/balance, plan_id, duration_days, amount_cents, is_active, used_by, used_at, starts_at, expires_at）
- [ ] Repository: CreateBatch / GetByCode / Use / List / Delete
- [ ] Handlers: `createRedeemCodes`, `listRedeemCodes`, `deleteRedeemCode`
- [ ] Routes: `/api/v1/billing/redeem/create`, `/api/v1/billing/redeem/list`, `/api/v1/billing/redeem/delete`

##### discount_code
- [ ] Model: `DiscountCode`（code unique, type percent/amount, value, max_uses, used_count, plan_ids JSON, is_active, starts_at, expires_at）
- [ ] Repository: Create / GetByCode / IncrementUsedCount / List / Delete
- [ ] Handlers: `createDiscountCode`, `listDiscountCodes`, `deleteDiscountCode`
- [ ] Routes: `/api/v1/billing/discount/create`, `/api/v1/billing/discount/list`, `/api/v1/billing/discount/delete`

##### balance_log + 功能开关
- [ ] Handler + Repo: `listBalanceLogs` 支持管理员全量查询 + 按用户筛选
- [ ] Handler: `getBillingFeatureStatus`, `setBillingFeatureStatus`
- [ ] Routes: `/api/v1/billing/balance-log/list`, `/api/v1/billing/feature-status`, `/api/v1/billing/feature-status/save`

### 4. 菜单与路由注册

- [ ] admin.tsx: 新增"账单"菜单项(adminOnly)，路径 `/admin/billing`
- [ ] App.tsx: 注册路由 `/admin/billing`

### 5. API 函数 + 类型

- [ ] vite-frontend/src/api/index.ts: 新增所有 billing API 函数
- [ ] vite-frontend/src/api/types.ts: 新增 BalanceLogItem, RedeemCodeItem, DiscountCodeItem, PaymentStatsItem

## 数据流

```
商品创建: 前端(元) → 后端(分) → DB(分) → 后端返回(分) → 前端显示(元)
支付配置: 前端表单 → JSON → DB(text) → 前端解析JSON → 填充表单
兑换码: 前端生成请求 → 后端批量创建 → DB → 前端列表展示
折扣码: 前端创建请求 → 后端保存 → DB → 前端列表展示
余额流水: 前端筛选条件 → 后端查询 balance_log → 返回列表 → 前端表格
```

## 注意事项

- 商品价格始终以「分」为单位存储和传输，前端仅在显示时除以100
- 兑换码使用随机字符串生成，6-10位大写字母+数字
- 折扣码百分比值不超过100，固定金额值单位：分
- 已有订单/支付路由不动，仅新增 billing 相关路由
- JSON 标签已在 Product 模型中修复（前一步已完成）
- 前端 UI 使用现有的 shadcn-bridge/heroui 组件
