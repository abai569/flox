# 流量套餐指定隧道 - 实施计划

## 需求

创建/编辑流量套餐（type=traffic）时，可以指定关联的隧道分组。客户购买流量套餐后：
1. 流量累加到全局 `user.flow`（现有逻辑不变）
2. 流量同时累加到指定隧道的 `user_tunnel.flow`
3. 如果用户没有该隧道的 `UserTunnel` 记录，自动创建
4. 隧道级流量也做限制：`user_tunnel.in_flow + out_flow` 超过 `user_tunnel.flow` 时暂停该隧道转发

## 现状分析

### 当前流量套餐交付流程

```
购买流量套餐
  ├─ 余额支付 → CompletePackageOrder (case "traffic")
  ├─ 外部支付 → completePayment → DeliverTrafficPackageToUser
  └─ 自动购买 → BuyTrafficPackageWithBalance

三条路径都只更新 user.flow（全局），不触碰 user_tunnel.flow
```

### 当前隧道级流量限制

| 层级 | 配额字段 | 已用字段 | 限制检查 |
|---|---|---|---|
| 用户级 | `user.flow` (GB) | `user.in_flow + out_flow` (bytes) | `shouldPauseUser` + `ensureUserTunnelForwardAllowed` ✅ |
| 隧道级 | `user_tunnel.flow` (GB) | `user_tunnel.in_flow + out_flow` (bytes) | `shouldPauseUserTunnel` 只检查 ExpTime/Status，**未检查 Flow** ❌ |

### 现有基础设施（可直接复用）

- `SubscriptionPackageTunnelGroup` — 套餐↔隧道分组 多对多关联表（已有）
- `GetPackageTunnelGroupIDs(pkgID)` — 获取套餐关联的隧道分组 ID 列表（已有）
- `GetTunnelsInGroups(groupIDs)` — 隧道分组 → 隧道 ID 列表（已有）
- `tunnelGroupIds` 在 admin handler 的 createPackage/updatePackage 中已支持（已有）
- 前端 admin-plans.tsx 的隧道分组选择器已有，但仅对 subscription 类型可见

---

## 实施步骤

### Step 1: 新增 helper — `addTrafficToUserTunnels`

**文件:** `go-backend/internal/store/repo/repository_mutations.go`

在事务内调用，对指定隧道列表累加流量或自动创建记录：

```go
func addTrafficToUserTunnels(tx *gorm.DB, userID int64, tunnelIDs []int64, trafficGB int64, userExpTime int64, userFlowResetTime int64) error {
    for _, tunnelID := range tunnelIDs {
        var existing model.UserTunnel
        err := tx.Select("id").Where("user_id = ? AND tunnel_id = ?", userID, tunnelID).First(&existing).Error
        if errors.Is(err, gorm.ErrRecordNotFound) {
            ut := model.UserTunnel{
                UserID:        userID,
                TunnelID:      tunnelID,
                Flow:          trafficGB,
                ExpTime:       userExpTime,
                FlowResetTime: userFlowResetTime,
                Status:        1,
            }
            if err := tx.Create(&ut).Error; err != nil {
                return err
            }
        } else if err != nil {
            return err
        } else {
            if err := tx.Model(&model.UserTunnel{}).Where("id = ?", existing.ID).
                Update("flow", gorm.Expr("flow + ?", trafficGB)).Error; err != nil {
                return err
            }
        }
    }
    return nil
}
```

### Step 2: 修改 `CompletePackageOrder`（余额支付路径）

**文件:** `go-backend/internal/store/repo/repository_mutations.go`
**位置:** `case "traffic":` 分支（约 line 1720）

改动：
- 在更新 `user.flow` 之后，查询 user 的 `exp_time` 和 `flow_reset_time`
- 调用 `addTrafficToUserTunnels(tx, userID, tunnelIDs, trafficGB, user.ExpTime, user.FlowResetTime)`

注意：`tunnelIDs` 已在函数开头通过 `GetTunnelsInGroups(tunnelGroupIDs)` 解析好了，无需重复解析。

### Step 3: 修改 `DeliverTrafficPackageToUser`（外部支付回调路径）

**文件:** `go-backend/internal/store/repo/repository_mutations.go`
**位置:** line 1974

改动：
- 签名增加 `tunnelGroupIDs []int64` 参数
- 在事务外解析 `tunnelIDs := GetTunnelsInGroups(tunnelGroupIDs)`
- 将原来的单次 `user.flow` 更新改为事务：先更新 `user.flow`，再查询 user 的 `exp_time`/`flow_reset_time`，再调用 `addTrafficToUserTunnels`

### Step 4: 修改 `BuyTrafficPackageWithBalance`（自动购买流量路径）

**文件:** `go-backend/internal/store/repo/repository_mutations.go`
**位置:** line 595

改动：
- 在事务内查询 `GetPackageTunnelGroupIDs(packageID)` 和 `GetTunnelsInGroups`
- 查询 user 的 `exp_time` 和 `flow_reset_time`
- 在更新 `user.flow` 后调用 `addTrafficToUserTunnels`

注意：此函数已在事务内，`GetPackageTunnelGroupIDs` 和 `GetTunnelsInGroups` 需要能在事务内工作（它们用的是 `r.db`，需要改为接受 `tx *gorm.DB` 参数，或者在事务外先解析好 tunnelIDs 再传入）。

**推荐方案：** 在事务外先解析好 tunnelIDs，传入函数。或者新增一个接受 `tx` 参数的内部版本。

### Step 5: 修改 `completePayment`（闭源 handler）

**文件:** `closed/go-backend/internal/http/handler/payment.go`
**位置:** line ~143，`case "traffic":` 分支

改动：
```go
case "traffic":
    tunnelGroupIDs, _ := h.repo.GetPackageTunnelGroupIDs(pkg.ID)
    _ = h.repo.DeliverTrafficPackageToUser(userID, pkg.TrafficLimit, pkg.Price, pkg.TrafficLimit, qty, tunnelGroupIDs)
```

### Step 6: 隧道级流量限制 — `shouldPauseUserTunnel`

**文件:** `go-backend/internal/http/handler/flow_policy.go`
**位置:** line 420

改动：增加 flow 检查

```go
func shouldPauseUserTunnel(policy *userTunnelPolicy, now int64) bool {
    if policy == nil {
        return false
    }
    if policy.ExpTime > 0 && policy.ExpTime <= now {
        return true
    }
    if policy.Status != 1 {
        return true
    }
    // 新增：隧道级流量限制
    if policy.Flow > 0 {
        flowLimit := policy.Flow * bytesPerGB
        current := policy.InFlow + policy.OutFlow
        if flowLimit < current {
            return true
        }
    }
    return false
}
```

### Step 7: 隧道级流量限制 — `ensureUserTunnelForwardAllowed`

**文件:** `go-backend/internal/http/handler/flow_policy.go`
**位置:** line 393-398，在 ExpTime/Status 检查之后

改动：增加 flow 检查，阻止超额隧道的转发开启

```go
// 在 policy.ExpTime 检查之后增加：
if policy.Flow > 0 {
    flowLimit := policy.Flow * bytesPerGB
    current := policy.InFlow + policy.OutFlow
    if flowLimit < current {
        return errors.New("该隧道流量已超额")
    }
}
```

### Step 8: 前端管理页 — 流量套餐显示隧道分组选择器（闭源）

**文件:** `closed/vite-frontend/src/pages/admin-plans.tsx`
**位置:** line ~1556

改动：将隧道分组选择器从 `{pkgForm.type === "subscription" && (...)}` 中提取出来，对 `subscription` 和 `traffic` 类型都显示。

方案：
- 将隧道分组选择器部分独立为一个条件块：`{(pkgForm.type === "subscription" || pkgForm.type === "traffic") && (...)}`
- 或者把整个 subscription 专属字段块拆分为两部分：
  - 订阅专属字段（validityDays, autoRenew 等）仍然只对 subscription 显示
  - 隧道分组选择器对 subscription + traffic 显示

### Step 9: 前端商城页 — 流量套餐卡片显示关联隧道信息（可选）

**文件:** `vite-frontend/src/pages/shop.tsx`

改动：在流量套餐卡片上显示关联的隧道分组名称，让用户知道购买的流量会加到哪些隧道。

需要：
- API 返回套餐时附带 tunnelGroupNames（或在套餐列表 API 中一并返回）
- 卡片上用小标签展示

---

## 文件清单

| # | 文件 | 类型 | 改动说明 |
|---|---|---|---|
| 1 | `go-backend/.../repo/repository_mutations.go` | 开源 | 新增 `addTrafficToUserTunnels` helper；修改 `CompletePackageOrder`、`DeliverTrafficPackageToUser`、`BuyTrafficPackageWithBalance` |
| 2 | `go-backend/.../handler/flow_policy.go` | 开源 | `shouldPauseUserTunnel` 和 `ensureUserTunnelForwardAllowed` 增加 flow 检查 |
| 3 | `closed/.../handler/payment.go` | 闭源 | `completePayment` traffic 分支传入 tunnelGroupIDs |
| 4 | `closed/vite-frontend/.../admin-plans.tsx` | 闭源 | 隧道分组选择器对 traffic 类型可见 |
| 5 | `vite-frontend/src/pages/shop.tsx` | 开源 | 可选：流量套餐卡片显示关联隧道信息 |

---

## 边界情况处理

| 场景 | 处理方式 |
|---|---|
| 用户没有指定隧道的 UserTunnel 记录 | 自动创建，从 user 继承 exp_time/flow_reset_time |
| 自动购买流量（BuyTrafficPackageWithBalance） | 同样累加到套餐指定的隧道 |
| 月重置 | user_tunnel.flow 是配额不重置，只重置 in_flow/out_flow，不受影响 |
| 多次购买同一隧道流量 | 累加生效，flow += totalGB |
| 套餐未关联隧道分组 | 只更新全局 user.flow，行为与现在一致（向后兼容） |
| user.exp_time = 0（永久用户） | 创建的 UserTunnel.exp_time 也为 0 |

---

## 验证要点

1. 创建流量套餐，关联隧道分组，购买后检查 `user.flow` 和 `user_tunnel.flow` 是否正确累加
2. 用户没有对应 UserTunnel 时购买，检查是否自动创建
3. 隧道流量超额后，该隧道的转发是否被暂停
4. 其他隧道的转发不受影响
5. 全局 user.flow 超额后，所有转发仍然被暂停
6. 自动购买流量路径同样正确累加隧道流量
7. 外部支付（USDT/YIPAY）回调后正确交付
8. 套餐未关联隧道分组时，行为与改动前一致
