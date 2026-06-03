# Plan: 易支付签名模式可配置（兼容 MPay）

## 背景
- FLVX 当前易支付签名末尾格式为 `&key=商户密钥`（标准易支付）
- MPay（码支付）v1.2.3 签名末尾格式为直接拼接密钥（无 `key=` 前缀）
- 市面上易支付实现有两种签名流派，需要让用户切换

## 目标
添加「签名模式」配置项，支持：
- `epay` — 标准易支付（默认，兼容彩虹易支付等）
- `mpay` — 码支付 MPay（兼容 MPay v1.2.x）

## 改动范围

### 后端
- `go-backend/internal/payment/yipay.go`

### 前端
- `vite-frontend/src/pages/admin-payment.tsx`

## 实现步骤

### 1. 后端 `yipay.go`

- [x] `YiPayConfig` 添加 `SignMode string` 字段
- [x] `yipaySign` 函数增加 `signMode` 参数
  - `mpay`：去掉末尾 `&`，直接拼接密钥
  - `epay`（默认）：末尾 `&key=密钥`
- [x] `CreateInvoice` 和 `VerifyCallback` 传入 `g.config.SignMode`

### 2. 前端 `admin-payment.tsx`

- [x] `YiPayForm` 接口添加 `sign_mode: string`
- [x] `defaultYiPay` 默认 `sign_mode: "epay"`
- [x] 配置加载 `useEffect` 回退 `sign_mode: "epay"`
- [x] UI 添加「签名模式」Select（标准易支付 / 码支付 MPay）
- [x] 保存逻辑已兼容（`rest` 包含 `sign_mode`）

## 兼容性
- 现有未设 `sign_mode` 的配置 → 默认 `epay`，不破坏已有标准易支付用户
- 用户手动切换到 `mpay` 即可对接 MPay

## 验收标准
- [x] 后端编译通过
- [x] 前端 TypeScript 编译通过
- [ ] 新建配置默认「标准易支付」，切换「码支付 MPay」后能正常下单
- [ ] 切换回「标准易支付」后标准网关验证通过
