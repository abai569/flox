# Mall/Shop System — Private Module Extraction

**Status:** Complete (files extracted to `mall-private/`, main repo stripped)

## Task

After user compiles and gives the command, delete all mall/shop related files from `main` branch. This feature will not be open sourced.

## Files to Delete

### Backend Go

| # | File | Description |
|---|------|-------------|
| 1 | `go-backend/internal/store/model/product.go` | SubscriptionPackage model |
| 2 | `go-backend/internal/store/model/order.go` | Order model |
| 3 | `go-backend/internal/store/model/payment_config.go` | PaymentConfig model |
| 4 | `go-backend/internal/store/model/model.go` | ViteConfig, PackageGroup, BalanceLog |
| 5 | `go-backend/internal/store/repo/repository_order.go` | Order repo |
| 6 | `go-backend/internal/store/repo/repository_payment_config.go` | Payment config repo |
| 7 | `go-backend/internal/store/repo/repository_package_groups.go` | Package groups repo |
| 8 | `go-backend/internal/store/repo/repository_mutations.go` | Core shop transactions |
| 9 | `go-backend/internal/http/handler/product.go` | Package handlers |
| 10 | `go-backend/internal/http/handler/order.go` | Order handlers |
| 11 | `go-backend/internal/http/handler/payment.go` | Payment handlers + callbacks |
| 12 | `go-backend/internal/http/handler/package_group.go` | Package group handlers |
| 13 | `go-backend/internal/http/middleware/trial_guard.go` | Trial guard for shop routes |
| 14 | `go-backend/internal/payment/gateway.go` | Payment gateway interface |
| 15 | `go-backend/internal/payment/factory.go` | Gateway factory |
| 16 | `go-backend/internal/payment/yipay.go` | YiPay gateway |
| 17 | `go-backend/internal/payment/gmpay.go` | USDT/GMPay gateway |

### Frontend TSX/TS

| # | File | Description |
|---|------|-------------|
| 18 | `vite-frontend/src/pages/shop.tsx` | Shop page |
| 19 | `vite-frontend/src/pages/admin-orders.tsx` | Order management |
| 20 | `vite-frontend/src/pages/admin-payment.tsx` | Payment settings |
| 21 | `vite-frontend/src/pages/admin-plans.tsx` | Package/plan management |
| 22 | `vite-frontend/src/pages/myhome.tsx` | User center (with orders) |
| 23 | `vite-frontend/src/pages/admin-plans/package-grouped-view.tsx` | Package grouped view |
| 24 | `vite-frontend/src/pages/admin-plans/package-group-manager.tsx` | Package group manager |

### Plans

| # | File | Description |
|---|------|-------------|
| 25 | `plans/015-payment-and-shop.md` | Original shop design plan |
| 26 | `plans/003-redesign-product-payment-billing.md` | UI redesign plan |
| 27 | `plans/030-order-suboptions-and-ui-optimizations.md` | Order sub-options plan |
| 28 | `plans/031-payment-suboption-switches.md` | Payment switches plan |
| 29 | `plans/032-payment-quantity-double-count-fix.md` | Double count fix plan |
| 30 | `plans/033-order-batch-ops-and-manual-complete.md` | Batch operations plan |
| 31 | `plans/004-dashboard-store-refresh.md` | Store refresh plan |

### Also needs cleanup (edit references, not delete entire file)

| # | File | What to do |
|---|------|------------|
| A | `go-backend/internal/store/repo/repository.go` | Remove AutoMigrate lines for shop tables, remove shop type aliases, remove default payment_enabled seed |
| B | `go-backend/internal/http/handler/handler.go` | Remove shop route registrations, remove `openAPISubStore` |
| C | `go-backend/internal/http/handler/jobs.go` | Remove `runCancelExpiredOrdersLoop`, `runExpirePackageSubscriptionsLoop` |
| D | `vite-frontend/src/layouts/admin.tsx` | Remove shop/orders/payment nav menu items |
| E | `vite-frontend/src/layouts/h5.tsx` | Remove shop/orders/payment nav menu items |
| F | `vite-frontend/src/api/index.ts` | Remove all shop API functions |
| G | `vite-frontend/src/api/types.ts` | Remove shop-related type interfaces |
| H | `vite-frontend/src/pages/config.tsx` | Remove `payment_enabled` / 商城系统 toggle |
| I | `vite-frontend/src/App.tsx` | Remove shop routes and RESTRICTED_PATHS entries |
