# Plan: 支付子选项下单时可选 + 支付弹窗 UI 优化

## 目标
1. **用户下单时可自选支付子选项**：
   - 易支付 → 可选「支付宝(`alipay`)」或「微信(`wxpay`)」
   - USDT → 可选「TRC-20(`tron`)」或「Polygon(`polygon`)」
2. **子选项随订单保存**：创建订单时传给后端，存入订单表；`payOrder` 时网关从订单读取
3. **myhome.tsx 支付弹窗 UI 优化**：按钮移到 ModalFooter、提示语精简

## 改动范围

### 后端（Go）
| # | 文件 | 说明 |
|---|------|------|
| 1 | `go-backend/internal/store/model/order.go` | 增加 `pay_type`、`pay_network` 字段 |
| 2 | `go-backend/internal/http/handler/product.go` | `createPackageOrder` 接收并保存 `pay_type`、`pay_network` |
| 3 | `go-backend/internal/http/handler/order.go` | `payOrder` 把 `order.PayType`/`order.PayNetwork` 传给网关（已通过 `order` 对象传递） |
| 4 | `go-backend/internal/payment/yipay.go` | `CreateInvoice` 从 `order.PayType` 读取 `type`，默认 `"alipay"` |
| 5 | `go-backend/internal/payment/gmpay.go` | `CreateInvoice` 从 `order.PayNetwork` 读取网络，回退到配置默认 |

### 前端（React/TS）
| # | 文件 | 说明 |
|---|------|------|
| 6 | `vite-frontend/src/api/index.ts` | `createPackageOrder` 参数增加 `pay_type?`、`pay_network?` |
| 7 | `vite-frontend/src/pages/shop.tsx` | 支付弹窗：选中「易支付」→ 出现「支付宝/微信」子选项；选中「USDT」→ 出现「TRC-20/Polygon」子选项 |
| 8 | `vite-frontend/src/pages/myhome.tsx` | 支付弹窗 UI：「前去支付」按钮移到 ModalFooter 与「关闭」并排，文字改为「支付」；提示语优化 |

## 详细设计

### 1. 订单模型（`model/order.go`）

在 `Order` 结构体末尾追加两个字段：

```go
PayType    string `gorm:"column:pay_type;type:varchar(20);default:''" json:"payType"`      // alipay | wxpay
PayNetwork string `gorm:"column:pay_network;type:varchar(20);default:''" json:"payNetwork"` // tron | polygon
```

GORM AutoMigrate 会自动创建新列，无需手写 DDL。

### 2. 创建订单接口（`handler/product.go`）

在 `createPackageOrder` handler 中，读取请求体中的 `pay_type`、`pay_network`，保存到订单。

新增字段写库逻辑放在 `repo` 层，已有 `SaveOrder` 或类似方法，需确认是否支持动态字段更新。如果现有 `CreateOrder` 不支持动态字段，改为 `repo.CreateOrderWithOptions(order, payType, payNetwork)` 或在创建后 `UpdateOrder`。

**实现策略**：最小侵入——先正常创建订单，再通过 `UpdateOrder` 写入 `pay_type` 和 `pay_network`。

```go
// 创建订单后
if req["pay_type"] != nil {
    h.repo.UpdateOrder(orderID, map[string]interface{}{"pay_type": asString(req["pay_type"])})
}
if req["pay_network"] != nil {
    h.repo.UpdateOrder(orderID, map[string]interface{}{"pay_network": asString(req["pay_network"])})
}
```

### 3. YIPAY 网关（`payment/yipay.go`）

`CreateInvoice` 不再写死 `type: "alipay"`：

```go
payType := order.PayType
if payType == "" {
    payType = "alipay"
}
params := map[string]string{
    "pid":          g.config.PID,
    "type":         payType,  // ← 不再写死
    ...
}
```

回调验签不受影响（`VerifyCallback` 的 `params` 用的是回调参数，没有 `type` 参与签名的特殊问题）。

### 4. USDT 网关（`payment/gmpay.go`）

`CreateInvoice` 网络选择优先级：
1. 订单级 `order.PayNetwork`
2. 配置级 `g.config.Network`

```go
network := order.PayNetwork
if network == "" {
    network = g.config.Network
}
```

### 5. 前端 API（`api/index.ts`）

```ts
export const createPackageOrder = (data: {
  package_id: number;
  pay_currency: string;
  quantity?: number;
  pay_type?: string;      // alipay | wxpay
  pay_network?: string;   // tron | polygon
}) => Network.post<{ orderId: number }>("/package/order/create", data);
```

### 6. shop.tsx 支付弹窗

在「支付方式」列表下方，当选中「易支付」或「USDT」时，动态渲染子选项：

```tsx
{selectedCurrency === "YIPAY" && (
  <div className="space-y-2 mt-2">
    <label className="text-xs text-gray-400">支付方式</label>
    <div className="flex gap-2">
      <Button
        variant={selectedPayType === "alipay" ? "solid" : "flat"}
        size="sm"
        onPress={() => setSelectedPayType("alipay")}
      >支付宝</Button>
      <Button
        variant={selectedPayType === "wxpay" ? "solid" : "flat"}
        size="sm"
        onPress={() => setSelectedPayType("wxpay")}
      >微信</Button>
    </div>
  </div>
)}

{selectedCurrency === "USDT" && (
  <div className="space-y-2 mt-2">
    <label className="text-xs text-gray-400">网络</label>
    <div className="flex gap-2">
      <Button
        variant={selectedPayNetwork === "tron" ? "solid" : "flat"}
        size="sm"
        onPress={() => setSelectedPayNetwork("tron")}
      >TRC-20</Button>
      <Button
        variant={selectedPayNetwork === "polygon" ? "solid" : "flat"}
        size="sm"
        onPress={() => setSelectedPayNetwork("polygon")}
      >Polygon</Button>
    </div>
  </div>
)}
```

新增 state：
```tsx
const [selectedPayType, setSelectedPayType] = useState("alipay");
const [selectedPayNetwork, setSelectedPayNetwork] = useState("tron");
```

`handleConfirmBuy` 创建订单时：
```ts
const createRes = await createPackageOrder({
  package_id: selectedPackage.id,
  pay_currency: selectedCurrency,
  quantity: 1,
  ...(selectedCurrency === "YIPAY" ? { pay_type: selectedPayType } : {}),
  ...(selectedCurrency === "USDT" ? { pay_network: selectedPayNetwork } : {}),
});
```

### 7. myhome.tsx 支付弹窗 UI 优化

当前布局（ModalBody 中间有一个大按钮）：
```tsx
<ModalBody>
  <p>点击下方按钮跳转支付：</p>
  <Button className="w-full" color="primary">前去支付</Button>
  ...
</ModalBody>
<ModalFooter>
  <Button variant="flat">关闭</Button>
</ModalFooter>
```

改为：
```tsx
<ModalBody>
  {payResult?.payUrl && (
    <p className="text-sm text-gray-500">
      订单已创建，请点击「支付」按钮跳转至收银台完成付款。
    </p>
  )}
  {payResult?.payAddress && (/* USDT 地址显示，保持不变 */)}
  <p className="text-xs text-gray-400">
    支付完成后请返回本页面，状态将自动刷新。
  </p>
</ModalBody>
<ModalFooter>
  <Button variant="flat" onPress={handleClose}>关闭</Button>
  {payResult?.payUrl && (
    <Button color="primary" onPress={() => window.open(payResult.payUrl, "_blank")}>
      支付
    </Button>
  )}
</ModalFooter>
```

按钮从 ModalBody 移至 ModalFooter，与「关闭」并排；文字从「前去支付」改为「支付」；提示语更简洁。

## 兼容性
- 现有未设 `pay_type`/`pay_network` 的订单 → 后端默认 `alipay`/`config.network`，不破坏旧订单
- 前端「去支付」按钮位置变更 → 纯 UI 优化，不影响逻辑
- myhome.tsx 的 USDT 地址显示逻辑不受影响

## 验收标准
- [ ] 新建订单时，选「易支付」→ 出现「支付宝/微信」子选项，选微信 → `payOrder` 时 `type=wxpay`
- [ ] 新建订单时，选「USDT」→ 出现「TRC-20/Polygon」子选项，选 Polygon → `payOrder` 时网络为 polygon
- [ ] 现有未设子选项的订单 → `payOrder` 默认 `alipay` / 配置默认网络
- [ ] myhome.tsx 支付弹窗：按钮在右下角与「关闭」并排，文字为「支付」，提示语精简
- [ ] 后端编译通过，前端 TypeScript 编译通过
