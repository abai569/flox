# 015-payment-and-shop

## 背景

当前 FLVX 已有余额系统（`User.Balance` + `BalanceLog` 签名账本）和自动续费/自动购流机制，但：
- 用户无法自助充值余额（当前提示"请联系管理员手动充值余额"）
- 没有商品/商城系统 — 续费金额、流量包价格硬编码在用户属性中
- 没有外部支付网关对接
- 订单生命周期管理缺失

## 目标

构建完整的支付+商城体系：
1. **商品系统** — 管理员可配置续费套餐、流量包等商品
2. **订单系统** — 完整订单生命周期（待支付 → 已支付 → 已完成/已取消）
3. **USDT 支付** — 对接 USDT (TRC-20) 支付网关（NowPayments）
4. **易支付** — 对接国内第三方聚合支付（支付宝/微信等）
5. **余额充值** — 用户通过 USDT 或易支付自助充值余额
6. **自助购买** — 用户可用余额、USDT 或易支付直接购买商品
7. **管理后台** — 商品管理、订单管理

---

## 核心设计

### 数据流

```
用户 → 商城页面 → 选择商品 → 下单
                              ├── 余额支付 → 扣余额 → 订单完成 → 交付产品
                              ├── USDT支付 → 生成支付地址 → 用户打款
                              │               → 网关回调 → 订单完成 → 交付产品
                              └── 易支付   → 跳转支付网关 → 用户扫码付款
                                              → 异步回调 → 订单完成 → 交付产品
```

### 支付通道

| channel | 名称 | 模式 | 适用场景 |
|---------|------|------|----------|
| `BALANCE` | 余额支付 | 即时扣款 | 账户有余额时 |
| `USDT` | USDT (TRC-20) | 地址收款+链上回调 | 加密货币用户 |
| `YIPAY` | 易支付 | 跳转网关+HTTP回调 | 国内支付宝/微信支付 |

### 商品类型

| type | 名称 | 效果 |
|------|------|------|
| `recharge` | 余额充值 | 用户余额增加 `value` 分 |
| `traffic` | 流量包 | 用户流量配额增加 `value` GB |
| `time` | 时长续费 | 用户有效期延长 `value` 天 |

### 订单状态

| status | 含义 |
|--------|------|
| 0 | 待支付 |
| 1 | 已支付/已完成 |
| 2 | 已取消 |
| 3 | 已退款 |

---

## 任务清单

> **状态：** ✅ 全部完成 (2026-05-26)

### Phase 1: 数据模型 & Repository

#### 1.1 商品模型 `Product`

**新建文件：** `go-backend/internal/store/model/product.go`

```go
type Product struct {
    ID            int64  `gorm:"primaryKey;autoIncrement"`
    Name          string `gorm:"column:name;type:varchar(100);not null"`
    Description   string `gorm:"column:description;type:varchar(500);default:''"`
    Type          string `gorm:"column:type;type:varchar(20);not null"` // recharge/traffic/time
    Price         int64  `gorm:"column:price;not null;default:0"`       // 价格 (分)
    Value         int64  `gorm:"column:value;not null;default:0"`       // 充值金额/流量GB/天数
    SortOrder     int    `gorm:"column:sort_order;default:0"`
    Status        int    `gorm:"column:status;default:1"`               // 0=下架 1=上架
    CreatedAt     int64  `gorm:"column:created_at;not null"`
    UpdatedAt     int64  `gorm:"column:updated_at;not null"`
}
func (Product) TableName() string { return "product" }
```

#### 1.2 订单模型 `Order`

**新建文件：** `go-backend/internal/store/model/order.go`

```go
type Order struct {
    ID            int64  `gorm:"primaryKey;autoIncrement"`
    OrderNo       string `gorm:"column:order_no;type:varchar(32);not null;uniqueIndex"`
    UserID        int64  `gorm:"column:user_id;not null;index"`
    UserName      string `gorm:"column:user_name;type:varchar(100);not null"`
    ProductID     int64  `gorm:"column:product_id;not null"`
    ProductName   string `gorm:"column:product_name;type:varchar(100);not null"`
    ProductType   string `gorm:"column:product_type;type:varchar(20);not null"`
    ProductMeta   string `gorm:"column:product_meta;type:text"`          // 商品快照 JSON
    Amount        int64  `gorm:"column:amount;not null"`                // 实付金额 (分)
    PayCurrency   string `gorm:"column:pay_currency;type:varchar(10);default:'BALANCE'"` // BALANCE / USDT / YIPAY
    Status        int    `gorm:"column:status;default:0"`              // 0=待支付 1=已支付 2=已取消 3=已退款
    PayTime       int64  `gorm:"column:pay_time;default:0"`
    PayURL        string `gorm:"column:pay_url;type:varchar(512);default:''"`   // 易支付跳转URL
    PayAddress    string `gorm:"column:pay_address;type:varchar(100);default:''"` // USDT收款地址
    TxHash        string `gorm:"column:tx_hash;type:varchar(100);default:''"`     // USDT/易支付交易流水号
    CreatedAt     int64  `gorm:"column:created_at;not null"`
    UpdatedAt     int64  `gorm:"column:updated_at;not null"`
}
func (Order) TableName() string { return "order" }
```

#### 1.3 支付配置模型

**新建文件：** `go-backend/internal/store/model/payment_config.go`

```go
type PaymentConfig struct {
    ID        int64  `gorm:"primaryKey;autoIncrement"`
    Channel   string `gorm:"column:channel;type:varchar(20);not null;uniqueIndex"` // USDT / YIPAY
    Config    string `gorm:"column:config;type:text;not null"`                     // JSON 配置
    Enabled   int    `gorm:"column:enabled;default:0"`
    CreatedAt int64  `gorm:"column:created_at;not null"`
    UpdatedAt int64  `gorm:"column:updated_at;not null"`
}
func (PaymentConfig) TableName() string { return "payment_config" }
```

#### 1.4 Repository 方法

**新建文件：** `go-backend/internal/store/repo/repository_product.go`
- `CreateProduct(p)`, `UpdateProduct(p)`, `DeleteProduct(id)`
- `GetProduct(id)`, `ListProducts(onlyActive)`
- `UpdateProductOrder(ids)`

**新建文件：** `go-backend/internal/store/repo/repository_order.go`
- `CreateOrder(o)`, `UpdateOrderStatus(id, status, payTime)`
- `GetOrder(id)`, `GetOrderByNo(orderNo)`
- `ListOrders(userID, status, page, size)`, `ListAllOrders(status, page, size, keyword)`

**新建文件：** `go-backend/internal/store/repo/repository_payment_config.go`
- `GetPaymentConfig(channel)`, `SavePaymentConfig(cfg)`

#### 1.5 AutoMigrate 注册

在 `repository.go` 的 AutoMigrate 列表中追加：`&model.Product{}`, `&model.Order{}`, `&model.PaymentConfig{}`

---

### Phase 2: 支付网关抽象层

#### 2.1 支付接口

**新建目录：** `go-backend/internal/payment/`
**新建文件：** `go-backend/internal/payment/gateway.go`

```go
// PaymentResult 支付网关返回的统一结果
type PaymentResult struct {
    PayURL     string // 易支付跳转链接
    PayAddress string // USDT 收款地址
    PayAmount  string // USDT 到账金额
    TxHash     string // 交易流水号（回调时填写）
}

type PaymentGateway interface {
    Name() string
    // CreateInvoice 创建支付单，返回支付所需信息
    CreateInvoice(order *model.Order) (*PaymentResult, error)
    // VerifyCallback 验证回调签名，返回内部订单号
    VerifyCallback(r *http.Request) (orderNo string, txHash string, err error)
    // QueryStatus 主动查询订单状态（备选，易支付不需要）
    QueryStatus(orderNo string) (paid bool, txHash string, err error)
}
```

#### 2.2 USDT (TRC-20) 实现

**新建文件：** `go-backend/internal/payment/nowpayments.go`

使用 NowPayments API：
- `CreateInvoice`: 调用 NowPayments API 创建发票，返回 USDT 收款地址
- `VerifyCallback`: 处理 NowPayments IPN 回调（验证 HMAC-SHA256 签名）
- `QueryStatus`: 查询发票支付状态（备选轮询）
- 配置项：`api_key`, `ipn_secret`, `wallet_address`（USDT 收款地址）

#### 2.3 易支付实现

**新建文件：** `go-backend/internal/payment/yipay.go`

易支付是国内常用的第三方支付聚合平台，流程如下：

`CreateInvoice(order)`:
1. 组装参数：`pid`(商户ID), `type`(支付方式), `out_trade_no`(订单号), `notify_url`(回调地址), `return_url`(跳回地址), `name`(商品名), `money`(金额), `sign`(MD5签名)
2. 请求易支付网关下单接口（GET 或 POST）
3. 解析返回的 `qrcode` 或 `payurl`，存入 `PaymentResult.PayURL`

`VerifyCallback(r)`:
1. 接收易支付 POST 回调
2. 验证 `sign` = md5(`money + pid + out_trade_no + key`)
3. 验证 `trade_status` = 'TRADE_SUCCESS'
4. 返回 `orderNo = out_trade_no`, `txHash = trade_no`（平台交易号）

配置项：`gateway_url`(易支付网关地址), `pid`(商户ID), `key`(商户密钥), `notify_url`(回调地址), `return_url`(跳回地址)

#### 2.4 网关工厂

**新建文件：** `go-backend/internal/payment/factory.go`

```go
func GetGateway(channel string) (PaymentGateway, error)
```

从 `PaymentConfig` 表读取配置（`Channel` 匹配 USDT/YIPAY），解析 `Config` JSON 后初始化对应网关实例。

---

### Phase 3: API Handlers

#### 3.1 商品管理 API

**新建文件：** `go-backend/internal/http/handler/product.go`

| 路由 | Handler 方法 | 说明 |
|------|-------------|------|
| `POST /api/v1/product/list` | `h.listProducts` | 商品列表（admin 看全部，user 只看上架的） |
| `POST /api/v1/product/create` | `h.createProduct` | 创建商品（admin） |
| `POST /api/v1/product/update` | `h.updateProduct` | 更新商品（admin） |
| `POST /api/v1/product/delete` | `h.deleteProduct` | 删除商品（admin） |
| `POST /api/v1/product/update-order` | `h.updateProductOrder` | 排序（admin） |

#### 3.2 订单 API

**新建文件：** `go-backend/internal/http/handler/order.go`

| 路由 | Handler 方法 | 说明 |
|------|-------------|------|
| `POST /api/v1/order/create` | `h.createOrder` | 用户下单 |
| `POST /api/v1/order/list` | `h.listOrders` | 用户查看自己的订单 |
| `POST /api/v1/order/admin/list` | `h.listAllOrders` | 管理员查看所有订单 |
| `POST /api/v1/order/cancel` | `h.cancelOrder` | 用户取消待支付订单 |
| `POST /api/v1/order/status` | `h.getOrderStatus` | 查询订单支付状态 |

#### 3.3 支付 API

**新建文件：** `go-backend/internal/http/handler/payment.go`

| 路由 | Handler 方法 | JWT | 说明 |
|------|-------------|-----|------|
| `POST /api/v1/payment/recharge` | `h.rechargeBalance` | 是 | 充值余额 |
| `POST /api/v1/payment/pay` | `h.payOrder` | 是 | 获取支付链接/地址 |
| `POST /api/v1/payment/callback/yipay` | `h.yipayCallback` | 否（签名验证） | 易支付异步回调 |
| `POST /api/v1/payment/callback/usdt` | `h.usdtCallback` | 否（签名验证） | USDT 支付回调 |
| `GET /api/v1/payment/config` | `h.getPaymentConfigs` | 是 | 获取启用的支付渠道 |

#### 3.4 交付逻辑

`deliverProduct(order)` 内部逻辑：
- `recharge` → `UPDATE user SET balance = balance + value` + `BalanceLog(reason="USDT充值/易支付充值")`
- `traffic` → `UPDATE user SET base_flow = base_flow + value` + `BalanceLog(reason="余额购买/USDT购买/易支付购买")`
- `time` → `UPDATE user SET exp_time = exp_time + value*86400` + `BalanceLog(reason="余额购买/USDT购买/易支付购买")`

#### 3.5 路由注册

在 `handler.go` 的 `Register()` 中添加所有新路由。

---

### Phase 4: 前端 — 商城页面

#### 4.1 API 类型

**编辑：** `vite-frontend/src/api/types.ts`

新增：
- `ProductApiItem`, `ProductListQuery`, `ProductMutationPayload`
- `OrderApiItem`, `OrderListQuery`, `CreateOrderPayload`
- `PaymentConfigItem`, `PaymentInfo`

#### 4.2 API 调用

**编辑：** `vite-frontend/src/api/index.ts`

新增函数：
```ts
getProductList(query), createProduct(data), updateProduct(data), deleteProduct(id), updateProductOrder(ids)
createOrder(data), getOrderList(query), getAdminOrderList(query), cancelOrder(id), getOrderStatus(id)
rechargeBalance(data), payOrder(data), getPaymentConfigs()
```

#### 4.3 商城页面

**新建文件：** `vite-frontend/src/pages/shop.tsx`
- 商品卡片网格（按类型分组）
- 购买弹窗：选择支付方式（余额 / USDT / 易支付）
- 余额不足时引导充值
- USDT 支付展示地址/二维码
- 易支付跳转支付网关（新窗口打开）

#### 4.4 用户订单页

**新建文件：** `vite-frontend/src/pages/orders.tsx`
- 订单列表（订单号、商品、金额、状态、支付方式）
- 待支付 USDT 订单展示支付地址
- 待支付易支付订单显示"去支付"按钮（重新获取跳转链接）
- 手动取消待支付订单

#### 4.5 余额充值入口

**修改：** `vite-frontend/src/pages/dashboard.tsx`

余额卡片中"请联系管理员手动充值余额"改为"去充值"按钮，跳转商城。

#### 4.6 管理页面

**新建文件：** `vite-frontend/src/pages/admin-products.tsx`
- 商品表格（名称、类型、价格、价值、状态、排序）
- CRUD 弹窗

**新建文件：** `vite-frontend/src/pages/admin-orders.tsx`
- 订单表格（订单号、用户、商品、金额、支付方式、状态）
- 按状态/用户搜索
- 手动标记已支付（线下充值场景）

#### 4.7 路由注册

**编辑：** `vite-frontend/src/App.tsx`

新增：
```tsx
<Route element={<ProtectedRoute><ShopPage /></ProtectedRoute>} path="/shop" />
<Route element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} path="/orders" />
<Route element={<ProtectedRoute><AdminProductsPage /></ProtectedRoute>} path="/admin/products" />
<Route element={<ProtectedRoute><AdminOrdersPage /></ProtectedRoute>} path="/admin/orders" />
```

#### 4.8 侧边栏菜单

**编辑：** `vite-frontend/src/layouts/admin.tsx`

新增菜单项：
```
/path: "/shop", label: "商城"
/path: "/orders", label: "我的订单"
/path: "/admin/products", label: "商品管理", adminOnly: true
/path: "/admin/orders", label: "订单管理", adminOnly: true
```

---

### Phase 5: 后台作业

#### 5.1 超时未支付订单自动取消

在 `jobs.go` / `go-backend/internal/http/handler/jobs.go` 中新增：

```
cancelExpiredOrders():
  - 每分钟执行
  - 查找超过 30 分钟未支付的订单（status=0, pay_currency IN ('USDT','YIPAY')）
  - 标记 status=2（已取消）
```

---

## 安全规则

1. **价格由服务端决定** — 前端传 `productID`，服务端从 DB 读价格，不从请求体读取金额
2. **余额扣减原子性** — 使用 `UPDATE user SET balance = balance - ? WHERE balance >= ? AND id = ?`
3. **支付回调幂等** — 按 `orderNo` 去重，重复回调不重复交付
4. **USDT 回调签名验证** — NowPayments IPN 验证 HMAC-SHA256 header
5. **易支付回调签名验证** — 验证 `sign = md5(money + pid + out_trade_no + key)`
6. **订单号唯一** — 格式 `FLVX + 13位时间戳 + 4位随机数`，DB unique index
7. **易支付金额校验** — 回调中 `money` 必须与数据库订单金额一致，防止篡改

---

## 文件清单

### 后端新增（13 文件）

| 文件 | 说明 |
|------|------|
| `go-backend/internal/store/model/product.go` | 商品模型 |
| `go-backend/internal/store/model/order.go` | 订单模型 |
| `go-backend/internal/store/model/payment_config.go` | 支付配置模型 |
| `go-backend/internal/store/repo/repository_product.go` | 商品 Repository |
| `go-backend/internal/store/repo/repository_order.go` | 订单 Repository |
| `go-backend/internal/store/repo/repository_payment_config.go` | 支付配置 Repository |
| `go-backend/internal/http/handler/product.go` | 商品 API Handler |
| `go-backend/internal/http/handler/order.go` | 订单 API Handler |
| `go-backend/internal/http/handler/payment.go` | 支付 API Handler |
| `go-backend/internal/payment/gateway.go` | 支付网关接口 + PaymentResult 结构体 |
| `go-backend/internal/payment/nowpayments.go` | NowPayments USDT 实现 |
| `go-backend/internal/payment/yipay.go` | 易支付实现 |
| `go-backend/internal/payment/factory.go` | 网关工厂 |

### 后端修改（3 文件）

| 文件 | 操作 |
|------|------|
| `go-backend/internal/store/repo/repository.go` | AutoMigrate 注册新模型 |
| `go-backend/internal/http/handler/handler.go` | Register() 注册新路由 |
| `go-backend/internal/http/handler/jobs.go` | 新增超时取消作业 |

### 前端新增（5 文件）

| 文件 | 说明 |
|------|------|
| `vite-frontend/src/pages/shop.tsx` | 商城页面 |
| `vite-frontend/src/pages/orders.tsx` | 用户订单页 |
| `vite-frontend/src/pages/admin-products.tsx` | 商品管理页 |
| `vite-frontend/src/pages/admin-orders.tsx` | 订单管理页 |

### 前端修改（5 文件）

| 文件 | 操作 |
|------|------|
| `vite-frontend/src/api/types.ts` | 新增 API 类型 |
| `vite-frontend/src/api/index.ts` | 新增 API 调用函数 |
| `vite-frontend/src/App.tsx` | 注册新路由 |
| `vite-frontend/src/layouts/admin.tsx` | 新增侧边栏菜单 |
| `vite-frontend/src/pages/dashboard.tsx` | 更新余额卡片充值入口 |
