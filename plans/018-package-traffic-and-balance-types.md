# 018 套餐新增流量包和余额类型

## 目标
在现有套餐模型上扩展流量包（额外流量）和余额充值（直接加余额）两类产品，复用下单→支付→交付流程。

## 设计

### 排序约定
前端展示/筛选/下拉顺序：**订阅套餐 → 余额充值 → 流量包**

### 订阅多次购买行为（仅 subscription 类型）
用户已有有效订阅时再次购买订阅套餐，新购将替换（覆盖）旧套餐。为避免用户误操作：
- **卡片底部提醒**：订阅套餐卡片底部显示"已有订阅套餐时新购将替换现有套餐"
- **确认弹窗**：点击购买时检测是否已有有效订阅，有则弹出确认框，用户确认后才进入支付流程

traffic 和 balance 类型多次购买叠加累加，无需限制或提醒。

### 三种类型的完整行为

| Type | 交付行为 | 过期规则 | 归零日期 | 后台字段回填 |
|------|---------|---------|---------|-------------|
| `subscription` | 替换配额 + 授权隧道分组（现有） | 到期取消订阅，清空配额 | `FlowResetTime = expireAt` | `RenewalAmount = pkg.Price` |
| `traffic` | `User.Flow += pkg.TrafficLimit`（叠加） | 随账户到期归零；续费订阅时也归零 | 不设，跟随订阅的 `FlowResetTime` | `BuyTrafficPrice = pkg.Price` + `BuyTrafficAmount = pkg.TrafficLimit` |
| `balance` | `User.Balance += pkg.Price`（叠加）+ 写 BalanceLog | 不过期 | 无 | 无 |

### 关键行为说明

#### 1. `subscription` 替换配额（修改现有 merge 逻辑）
当前 `DeliverPackageToUser` 采用"保留较大值"合并配额。改为：
- `flow` → 直接替换为 `pkg.TrafficLimit`（不再保留原值）
- 其他配额（num/speed_limit/max_connections/max_ip_access）仍保留较大值
- **新增** `RenewalAmount = pkg.Price`（续费金额自动回填套餐价格）
- **新增** `FlowResetTime = expireAt`（归零日期自动读取订阅到期时间）

#### 2. `traffic` 叠加 + 过期归零
- `User.Flow += pkg.TrafficLimit`（追加，不替换）
- `BuyTrafficPrice = pkg.Price` / `BuyTrafficAmount = pkg.TrafficLimit`
- 不设 `FlowResetTime`（跟随已有订阅的归零日期）
- 用户没有订阅时就买了流量包：仍然叠加到 `User.Flow`，过期随账号
- 续费/新购订阅时，`DeliverPackageToUser` 替换 flow 后自然清空流量包

#### 3. `balance` 叠加 + 不过期
- `User.Balance += pkg.Price`
- 写 `BalanceLog`（金额为正，reason="余额充值"）
- 不涉及订阅、不设任何配额
- 普通用户只能 USDT/YIPAY 支付（禁用 BALANCE）
- **管理员**可以通过 `assignPackageToUser` 跳过支付直接充值

#### 4. 归零日期 (`FlowResetTime`) + 续费金额 (`RenewalAmount`) 自动回填
- `DeliverPackageToUser` 在创建新订阅时：
  - `FlowResetTime = expireAt`（新订阅的到期时间）
  - `RenewalAmount = pkg.Price`
- 管理员在用户编辑页的"续费金额"和"重置日期"字段会在交付时自动回填

### 交付逻辑
- 走现有 `createPackageOrder` → `payOrder` → `completePayment` 流程
- `completePayment` 根据 `pkg.Type` 分发：
  - `subscription`: 走现有 `DeliverPackageToUser`（含上述改动）
  - `balance`: 走新 `DeliverBalancePackageToUser`
  - `traffic`: 走新 `DeliverTrafficPackageToUser`
- `createPackageOrder` 中 balance 类型禁用 `BALANCE` 支付方式（不能用余额充值余额）

### 退款行为

管理员在订单管理页退款时，退到余额 + 按类型撤销交付：

| Type | 退款操作 | 关键注意 |
|------|---------|---------|
| `subscription` | `Balance += Amount` + 查找关联 `PackageSubscription`（`order_id` 匹配），若 status=1 则 `ExpirePackageSubscription` + `ResetUserPackageQuotas` | **不**影响用户其他有效订阅（通过 `order_id` 精确匹配） |
| `traffic` | `Balance += Amount` + `User.Flow -= pkg.TrafficLimit`（允许负数，已用量不退） | 扣减的是 `BuyTrafficAmount` 记录的数值 |
| `balance` | `Balance += Amount` + 写 BalanceLog | 退款即退余额，管理员通过其他方式处理 |

关键原则：
- **不追溯历史订单**：已失效的 subscription（status=0）找到也不重置配额
- **精确匹配**：`GetPackageSubscriptionByOrderID(order.ID)` 只影响退款订单对应的那一条记录
- **ProductMeta 兼容**：从 `order.ProductMeta` 解析 `Type`，旧订单无 `type` 字段默认走 `subscription` 分支
- 后端 handler：`/api/v1/order/admin/refund`（已有），补充分支逻辑即可

---

## 实施步骤

### Step 1: 后端模型加 Type 字段
**文件：** `go-backend/internal/store/model/subscription_package.go`
- 加 `Type string gorm:"column:type;type:varchar(20);default:'subscription'" json:"type"`
- 其他字段不变

### Step 2: 后端 Repository

**文件：** `go-backend/internal/store/repo/repository_mutations.go`
- 修改 `DeliverPackageToUser`：
  - user updates 加 `flow_reset_time = expireAt`、`renewal_amount = pkg.Price`
  - flow 改为直接替换：`"flow": pkg.TrafficLimit`
- 新增 `DeliverBalancePackageToUser(userID, amountCents, reason)`：
  - `User.Balance += amountCents`，写 BalanceLog（正数）
- 新增 `DeliverTrafficPackageToUser(userID, trafficGB, price, trafficLimit)`：
  - `User.Flow += trafficGB`
  - `BuyTrafficPrice = price`、`BuyTrafficAmount = trafficLimit`
- 修改 `CompletePackageOrder`：根据 `pkg.Type` 分支到不同交付方法

**文件：** `go-backend/internal/store/repo/repository_package.go`
- `CreatePackage` / `UpdatePackage`：透传 `Type` 字段

### Step 3: 后端 Handler

**文件：** `go-backend/internal/http/handler/product.go`
- `createPackage` / `updatePackage`：接受 `type` 参数
- `createPackageOrder`：balance 类型强制 YIPAY/USDT（非管理员禁用 BALANCE）
- `assignPackageToUser`：支持三种类型分配

**文件：** `go-backend/internal/http/handler/payment.go`
- `completePayment`：在 `ProductType == "package"` 内根据 `pkg.Type` 分支交付

### Step 4: 前端 API 类型
**文件：** `vite-frontend/src/api/types.ts`
- `SubscriptionPackageApiItem` 加 `type: string`

### Step 5: 前端套餐管理页
**文件：** `vite-frontend/src/pages/admin-plans.tsx`
- 表格加"类型"列（订阅套餐 / 余额充值 / 流量包）
- 创建/编辑弹窗加"类型"下拉框，选中后动态切换：
  - `subscription`：显示全部字段（现有）
  - `balance`：仅显示价格字段，标签改"充值金额(元)"
  - `traffic`：显示价格 + 流量字段

### Step 6: 前端商城页
**文件：** `vite-frontend/src/pages/shop.tsx`
- 按类型分区展示（标题 + 卡片区）
- 排序：订阅套餐 → 余额充值 → 流量包
- balance 类型只显示 USDT/YIPAY 支付选项
- **订阅套餐卡片底部添加提醒**："已有订阅套餐时新购将替换现有套餐"（仅 subscription 类型显示）
- **订阅套餐购买确认弹窗**：用户已有有效订阅时点击"购买"按钮，弹出确认框：
  > "当前已有有效订阅套餐，新购后将替换现有套餐，剩余流量和有效期将作废。确定继续？"
  - 通过 `getUserActiveSubscription` 判断是否有有效订阅
  - 无有效订阅时直接跳转支付流程
  - 确认后走正常支付流程，取消则不做任何操作

### Step 7: 前端我的页面
**文件：** `vite-frontend/src/pages/myhome.tsx`
- 如有必要加充值入口（或现有商城入口已覆盖）

### Step 8: 后端退款逻辑（按类型撤销交付）

**文件：** `go-backend/internal/store/repo/repository_mutations.go`
- 新增 `GetPackageSubscriptionByOrderID(orderID int64) (*PackageSubscription, error)`
- 新增 `RefundTrafficPackage(userID int64, trafficGB int64) error`：`User.Flow -= trafficGB`（允许负数）

**文件：** `go-backend/internal/http/handler/order.go`
- 修改 `adminRefundOrder`：退余额后，按类型分支处理：
  ```go
  if order.ProductType == "package" {
      从 ProductMeta 解析 Type（默认 "subscription"）
      switch type {
      case "traffic":
          RefundTrafficPackage(userID, trafficLimit)
      case "balance":
          // 只退余额，已完成
      default: // subscription
          sub = GetPackageSubscriptionByOrderID(order.ID)
          if sub != nil && sub.Status == 1 {
              ExpirePackageSubscription(sub.ID)
              ResetUserPackageQuotas(userID)
          }
      }
  }
  ```

---

## 不涉及的文件
- ❌ `SubscriptionPackageTunnelGroup` —— 流量包/余额无关
- ❌ 支付网关 —— 不改
- ❌ `RedeemCode` —— 现有兑换码已支持 plan / balance，后续可按需加 traffic

---

## 任务清单
- [ ] Step 1: 模型加 Type 字段
- [ ] Step 2: 后端 Repository
  - [ ] 修改 `DeliverPackageToUser`（FlowResetTime + RenewalAmount + 替换 flow）
  - [ ] 新增 `DeliverBalancePackageToUser`
  - [ ] 新增 `DeliverTrafficPackageToUser`
  - [ ] 修改 `CompletePackageOrder`（按 type 分支）
  - [ ] CreatePackage/UpdatePackage 透传 Type
- [ ] Step 3: 后端 Handler（product.go + payment.go）
- [ ] Step 4: 前端类型更新
- [ ] Step 5: 套餐管理页（表格列 + 弹窗表单）
- [ ] Step 6: 商城页（按类型分组）
  - [ ] 订阅套餐卡片底部添加提醒文字
  - [ ] 购买订阅套餐时检测有效订阅，弹确认框
- [ ] Step 7: 我的页面
- [ ] Step 8: 后端退款逻辑（按类型撤销交付）
  - [ ] 新增 `GetPackageSubscriptionByOrderID`
  - [ ] 新增 `RefundTrafficPackage`（flow -= trafficGB）
  - [ ] 修改 `adminRefundOrder`：解析 ProductMeta.Type，按类型分支处理
- [ ] 构建验证
