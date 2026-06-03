# Plan: 支付子选项后台开关控制

## 目标
在后台增加开关，控制易支付和 USDT 在用户下单弹窗中显示哪些子选项：
- **易支付**：可选开启「支付宝」「微信」
- **USDT**：可选开启「TRC-20」「Polygon」
- 全部关闭时，该支付渠道从用户下单弹窗中隐藏

## 改动范围

### 后端（Go）
| 文件 | 改动 |
|------|------|
| `go-backend/internal/payment/yipay.go` | `YiPayConfig` 增加 `EnableAlipay bool`、`EnableWxpay bool` |
| `go-backend/internal/payment/gmpay.go` | `GMPayConfig` 增加 `EnableTron bool`、`EnablePolygon bool` |

### 前端（React/TS）
| 文件 | 改动 |
|------|------|
| `vite-frontend/src/pages/admin-payment.tsx` | YiPayForm/UsdtForm 增加 enable 字段；UI 添加 Switch 开关；加载/保存逻辑处理 |
| `vite-frontend/src/pages/shop.tsx` | 解析配置中的 enable 字段；动态显示/隐藏子选项和支付渠道 |

## 详细设计

### 1. 后端配置结构

**YiPayConfig：**
```go
EnableAlipay bool `json:"enable_alipay"`
EnableWxpay  bool `json:"enable_wxpay"`
```

**GMPayConfig：**
```go
EnableTron     bool `json:"enable_tron"`
EnablePolygon  bool `json:"enable_polygon"`
```

JSON 序列化/反序列化自动处理 bool 类型。

### 2. 前端 admin-payment.tsx

**YiPayForm / defaultYiPay：**
```tsx
interface YiPayForm {
  // ... existing fields
  enable_alipay: boolean;
  enable_wxpay: boolean;
}

const defaultYiPay: YiPayForm = {
  // ...
  enable_alipay: true,
  enable_wxpay: true,
};
```

**UsdtForm / defaultUsdt：**
```tsx
interface UsdtForm {
  // ... existing fields
  enable_tron: boolean;
  enable_polygon: boolean;
}

const defaultUsdt: UsdtForm = {
  // ...
  enable_tron: true,
  enable_polygon: true,
};
```

**配置加载时回退默认值：**
- `parsed.enable_alipay !== false`（默认 true）
- `parsed.enable_wxpay !== false`
- `parsed.enable_tron !== false`
- `parsed.enable_polygon !== false`

**UI：**
- 易支付 Tab：在「签名模式」旁边或下面增加两个 Switch
  - ☑ 启用支付宝
  - ☑ 启用微信
- USDT Tab：在「U 支付网络」旁边或下面增加两个 Switch
  - ☑ 启用 TRC-20
  - ☑ 启用 Polygon

**保存逻辑：**
- Switch onValueChange 和「保存配置」按钮的 `rest` 已包含 enable 字段，无需额外过滤

### 3. 前端 shop.tsx

**availableChannels 构建逻辑：**

解析每个支付渠道的 config JSON，读取 enable 字段：

```tsx
const enabledChannels = payChannels.filter((c) => c.enabled);

// USDT
const usdt = enabledChannels.find((c) => c.channel === "USDT");
if (usdt) {
  let cfg: any = {};
  try { cfg = JSON.parse(usdt.config); } catch {}
  const hasTron = cfg.enable_tron !== false;
  const hasPolygon = cfg.enable_polygon !== false;
  if (hasTron || hasPolygon) {
    channels.push({ channel: "USDT", label: "USDT", desc: "加密货币支付" });
  }
}

// YIPAY
const yipay = enabledChannels.find((c) => c.channel === "YIPAY");
if (yipay) {
  let cfg: any = {};
  try { cfg = JSON.parse(yipay.config); } catch {}
  const hasAlipay = cfg.enable_alipay !== false;
  const hasWxpay = cfg.enable_wxpay !== false;
  if (hasAlipay || hasWxpay) {
    channels.push({ channel: "YIPAY", label: "易支付", desc: "扫码支付" });
  }
}
```

**子选项显示逻辑：**

```tsx
{selectedCurrency === "YIPAY" && (
  <div>
    {yipayHasAlipay && yipayHasWxpay && (
      // 显示两个按钮让用户选
    )}
    {yipayHasAlipay && !yipayHasWxpay && (
      // 只有一个选项，自动选中 alipay，不显示按钮
      useEffect(() => setSelectedPayType("alipay"), [])
    )}
    {!yipayHasAlipay && yipayHasWxpay && (
      // 只有一个选项，自动选中 wxpay
      useEffect(() => setSelectedPayType("wxpay"), [])
    )}
  </div>
)}
```

同理 USDT。

### 4. 兼容性

- 现有数据库配置中没有 enable 字段 → 默认 true（通过 `!== false` 判断）
- 不影响已有订单和支付流程
- 两个都关闭时，该渠道从下单弹窗消失，等同于关闭

## 验收标准
- [ ] 后台易支付 Tab 可开关「支付宝」「微信」
- [ ] 后台 USDT Tab 可开关「TRC-20」「Polygon」
- [ ] 只开一个时，用户下单自动选中该选项，不显示选择按钮
- [ ] 两个都关时，该渠道从下单弹窗消失
- [ ] 默认全部开启，兼容旧配置
