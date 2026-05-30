# 019 — 注册验证码 + 套餐库存/售罄 + 余额倍数购买

## 功能1：注册验证码

**需求**：注册添加验证码防爆破，与登录独立开关。

**方案**：新增配置 `register_captcha_enabled`，与登录共用 Cloudflare Turnstile 但独立控制。

### 后端
| # | 文件 | 改动 |
|---|------|------|
| 1 | `mutations.go:6121` `userRegister` | 请求体加 `captchaId`；注册前读 `register_captcha_enabled`，若 `"1"` 则 `consumeCaptchaToken()` / Turnstile 校验 |
| 2 | `handler.go` | 路由注册（`/user/register` 已在认证白名单，无需重复处理） |

### 前端
| # | 文件 | 改动 |
|---|------|------|
| 3 | `index.tsx` 注册弹窗 | 弹窗打开时调 `getConfigByName("register_captcha_enabled")`，若 `"1"` 则显示 Turnstile，验证通过才允许提交 |
| 4 | `config.tsx` | 后台配置页新增开关"注册验证码"（`register_captcha_enabled`） |

---

## 功能2：套餐库存/售罄 + 余额倍数购买

### 后端模型

| # | 文件 | 改动 |
|---|------|------|
| 5 | `model/product.go:4` `SubscriptionPackage` | 加字段 `Stock int64 \`gorm:"column:stock;default:-1" json:"stock"\``（-1=不限，0=售罄，>0=剩余） |
| 6 | 启动迁移 | `UPDATE subscription_package SET stock = -1 WHERE stock IS NULL` |

### 后端仓储

| # | 文件 | 改动 |
|---|------|------|
| 7 | `repository_mutations.go` | 新增 `CheckAndDecrementStock(pkgID int64, qty int64) error` — 原子事务：`SELECT stock` → 校验 → `UPDATE stock = stock - qty` |
| 8 | 同上 `CompletePackageOrder` (1432) | 交付前调 `CheckAndDecrementStock` + balance 类型到账金额按 `quantity` 倍数 |
| 9 | 同上 `DeliverBalancePackageToUser` (1730) | 加 `quantity` 参数，到账 = `amountCents * quantity` |
| 10 | 同上 `DeliverTrafficPackageToUser` (1748) | 加 `quantity` 参数，流量 = `trafficGB * quantity` |

### 后端下单/支付/退款

| # | 文件 | 改动 |
|---|------|------|
| 11 | `product.go:257` `createPackageOrder` | 接收可选 `quantity`（默认1）；balance 类允许 >1，其他强制=1；下单前调 `CheckAndDecrementStock`；`quantity` 写入 `ProductMeta` |
| 12 | `payment.go:95` `completePayment` | 从 `ProductMeta` 读 `quantity` 传给交付函数 |
| 13 | `order.go:289` `adminRefundOrder` | 退款时恢复 stock：`UPDATE subscription_package SET stock = stock + quantity WHERE id = ?` |

### 前端类型 + API

| # | 文件 | 改动 |
|---|------|------|
| 14 | `types.ts:782` | `SubscriptionPackageApiItem` 加 `stock: number` |
| 15 | `api/index.ts` | `createPackageOrder` 加 `quantity?: number` |

### 前端 Admin 管理

| # | 文件 | 改动 |
|---|------|------|
| 16 | `admin-plans.tsx` | 创建/编辑表单加"库存"数字输入框（placeholder "-1 = 不限"） |
| 17 | 同上 | 表格加"库存"列：-1→"不限"、0→"已售罄"、>0→"剩余 X" |

### 前端商城页

| # | 文件 | 改动 |
|---|------|------|
| 18 | `shop.tsx` | `stock===0` 按钮禁用+文字"已售罄"；`stock>0 && stock<=10` 显示"仅剩 X 份" |
| 19 | 同上 | balance 卡片加数字步进器（`<input type="number" min="1">`），默认1，总价联动显示 `¥price × qty = ¥total` |
| 20 | 同上 | 购买弹窗确认时传 `quantity` |

---

## 改动汇总

**后端 7 处**：model(1) + repo(4) + handler(3)
**前端 8 处**：types(1) + api(1) + index(1) + config(1) + admin-plans(2) + shop(3)
**总量**：~300-400 行
