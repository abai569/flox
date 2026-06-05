# 032 Payment Quantity Double-Count Fix

Fix `DeliverBalancePackageToUser` double-counting quantity when delivering balance packages via YIPAY/USDT callback, and clean up dead code.

## Bug Description

- **Location**: `repository_mutations.go:1795`
- **Root cause**: `totalAmount := amountCents * quantity` — `amountCents` is already `pkg.Price * quantity` (from `order.Amount`), so the function applies `quantity` twice, giving the user `Price × qty²`.
- **Impact**: Buying a 100 元 balance package × 2 credits 400 元 instead of 200 元.

All callers of `DeliverBalancePackageToUser`:

| Caller | `amountCents` | `quantity` | Current result | Expected |
|--------|--------------|-----------|---------------|----------|
| `payment.go:124` (YIPAY/USDT callback) | `order.Amount` = `Price × qty` | `qty` | `Price × qty²` | `Price × qty` |
| `product.go:447` (admin assign) | `pkg.Price` | `1` | `Price × 1` ✅ | `Price` ✅ |

## Tasks

- [x] Fix `DeliverBalancePackageToUser`: remove `totalAmount := amountCents * quantity`, use `amountCents` directly. Remove the `quantity` parameter from the function signature and update both callers.
- [x] Delete dead code `go-backend/internal/payment/nowpayments.go` (NowPayments gateway — `Name()` returns `"USDT"` conflicting with GMPay, never connected in factory, no callback route registered). Also remove its compile-time interface check from `yipay.go:177`.
