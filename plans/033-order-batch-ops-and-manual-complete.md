# 033 Order Batch Ops and Manual Complete

Add batch operations (complete, refund, delete) for orders and balance logs, plus manual single-order completion.

## Backend

### order.go — 4 new handlers

| Handler | Route | Logic |
|---------|-------|-------|
| `adminCompleteOrder` | `POST /api/v1/order/admin/complete` | Single: find order by id, call `completePayment(orderNo, "")` |
| `adminBatchCompleteOrders` | `POST /api/v1/order/admin/batch-complete` | Batch: iterate `{ids}`, skip non-status-0, call `completePayment` each |
| `adminBatchRefundOrders` | `POST /api/v1/order/admin/batch-refund` | Batch: iterate `{ids}`, skip non-status-1, reuse refund logic (balance + reverse delivery) |
| `adminBatchDeleteOrders` | `POST /api/v1/order/admin/batch-delete` | Batch: iterate `{ids}`, delete each (follow existing `adminDeleteOrder` pattern) |

### billing.go — 1 new handler

| Handler | Route | Logic |
|---------|-------|-------|
| `adminBatchDeleteBalanceLogs` | `POST /api/v1/billing/balance-log/batch-delete` | Batch: iterate `{ids}`, delete each balance log |

### handler.go — 5 route registrations

### Frontend API (api/index.ts) — 5 new functions

- `completeOrder(id)`
- `batchCompleteOrders(ids)`
- `batchRefundOrders(ids)`
- `batchDeleteOrders(ids)`
- `batchDeleteBalanceLogs(ids)`

### Frontend Pages

#### admin-orders.tsx
- Checkbox column + header "全选"
- Top toolbar: 批量补单 | 批量退款 | 批量删除 (disabled when none selected)
- Per-row ops: status=0 → 补单 + 删除; status=1 → 退款 + 删除

#### admin-payment.tsx (账单 tab)
- Checkbox column + header "全选"
- Top toolbar: 批量删除

## Tasks

- [x] Add `adminCompleteOrder` handler in order.go
- [x] Add `adminBatchCompleteOrders` handler in order.go
- [x] Add `adminBatchRefundOrders` handler in order.go
- [x] Add `adminBatchDeleteOrders` handler in order.go
- [x] Add `adminBatchDeleteBalanceLogs` handler in billing.go
- [x] Register 5 routes in handler.go
- [x] Add 5 frontend API functions in api/index.ts
- [x] Add batch ops UI to admin-orders.tsx
- [x] Add batch delete UI to admin-payment.tsx (账单 tab)
- [x] Build and verify
