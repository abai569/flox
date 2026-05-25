# FLVX 授权系统改造计划：功能分级 + Handler 层防御

## 一、问题背景

### 当前架构缺陷

当前授权系统依赖 **中间件层** 进行限流和拦截：

```
请求 → TrialGuard(中间件) → LicenseGuard(中间件) → Handler
       ↑ 可被删除               ↑ 可被删除
```

**破解方法：**
1. 删除 `router.go` 中的 `LicenseGuard` 行 → 绕过所有授权检查
2. 删除 `trial_guard.go` 文件 → 免费版限制消失
3. 修改 `doVerify()` 永远返回 `true` → 授权永远有效
4. 重新编译 → 完全绕过授权

### 改造目标

```
请求 → LicenseGuard(保留) → Handler(核心防御)
                              ↓
                        每个 handler 自带限速检查
                        (删除中间件也无法绕过)
```

**核心原则：** 验证代码随便删除，移除后自动回退免费版限制。

---

## 二、架构设计

### 2.1 授权等级定义

| 等级 | 名称 | 条件 | 限制 |
|------|------|------|------|
| `premium` | 商业版 | LICENSE_KEY + 授权服务器验证通过 | 无限制 |
| `free` | 免费版 | 无 LICENSE_KEY / 验证服务不可达 | 5 节点 / 5 隧道 / 1 用户规则 |
| `blocked` | 锁定 | LICENSE_KEY 存在但授权明确无效（过期/域名不匹配/禁用） | 完全阻止 |

### 2.2 双保险机制

```
┌─ 第一层：中间件 ────────────────────┐
│  LicenseGuard: 仅拦截 blocked 状态     │
│  TrialGuard:   保留，作为 belt+braces │
└──────────────────────────────────────┘
                    ↓ attacker 删除中间件
┌─ 第二层：Handler ────────────────────┐
│  每个 CRUD handler 检查 tier          │
│  premium → 放行                       │
│  free    → 检查数量限制               │
│  blocked → 拒绝操作                   │
└──────────────────────────────────────┘
```

---

## 三、实施步骤

### 第一阶段：Handler 层限速基础设施（0.5 天）

#### 3.1.1 新增函数：`GetLicenseTier()`

**文件：** `internal/middleware/license_check.go`

```go
type TierType string

const (
    TierFree    TierType = "free"
    TierPremium TierType = "premium"
    TierBlocked TierType = "blocked"
)

func GetLicenseTier() (TierType, string) {
    globalLicenseState.mu.RLock()
    defer globalLicenseState.mu.RUnlock()

    checkParams.mu.RLock()
    hasKey := checkParams.licenseKey != ""
    checkParams.mu.RUnlock()

    if !hasKey {
        return TierFree, "未配置授权服务"   // ← 即使删除验证代码，这里也返回 free
    }

    if !globalLicenseState.valid {
        switch globalLicenseState.reason {
        case "域名不匹配", "授权已过期", "授权已被禁用":
            return TierBlocked, globalLicenseState.reason
        default:
            // 验证服务不可达 → 降级为免费版（宽限）
            return TierFree, "验证服务不可达，已降级为免费版"
        }
    }

    return TierPremium, ""
}
```

#### 3.1.2 新增辅助函数：`CheckResourceLimit()`

**文件：** `internal/middleware/license_check.go`

```go
var freeLimits = map[string]int{
    "node":   5,
    "tunnel": 5,
    "user":   1,
    "forward": 25,
}

func CheckResourceLimit(resourceType string, currentCount int) error {
    tier, reason := GetLicenseTier()
    if tier == TierPremium {
        return nil
    }
    if tier == TierBlocked {
        return fmt.Errorf("授权无效 (%s)，请联系管理员", reason)
    }
    limit, ok := freeLimits[resourceType]
    if !ok {
        return nil
    }
    if currentCount >= limit {
        return fmt.Errorf("免费版最多 %d 个%s，请配置正式授权以解除限制", limit, resourceType)
    }
    return nil
}
```

#### 3.1.3 新增文件：`license_tier.go`

**文件：** `internal/http/handler/license_tier.go`

```go
package handler

import (
    "go-backend/internal/http/response"
    "go-backend/internal/middleware"
    "net/http"
)

type ResourceType string

const (
    ResourceNode    ResourceType = "node"
    ResourceTunnel  ResourceType = "tunnel"
    ResourceUser    ResourceType = "user"
    ResourceForward ResourceType = "forward"
)

// requirePremium checks license tier and writes 403 if blocked or over free limit
func (h *Handler) requirePremium(w http.ResponseWriter, resourceType ResourceType, currentCount int) bool {
    err := middleware.CheckResourceLimit(string(resourceType), currentCount)
    if err != nil {
        response.WriteJSON(w, response.Err(403, err.Error()))
        return false
    }
    return true
}
```

---

### 第二阶段：修改所有 Mutation Handler（2 天）

#### 3.2.1 修改模式

每个 handler 按以下模式修改：

**文件：** `internal/http/handler/mutations.go`

```go
// ── 创建类 Handler ──────────────────────────

func (h *Handler) nodeCreate(w http.ResponseWriter, r *http.Request) {
    // 1. 检查授权等级（blocked → 立即拒绝）
    tier, _ := middleware.GetLicenseTier()
    if tier == middleware.TierBlocked {
        response.WriteJSON(w, response.Err(403, "授权无效，请联系管理员"))
        return
    }

    // 2. 解析请求
    // ... existing code ...

    // 3. 检查免费版限制（在创建前检查当前数量）
    if tier == middleware.TierFree {
        count, err := h.repo.CountNodes()
        if err == nil && count >= 5 {
            response.WriteJSON(w, response.Err(403, "免费版最多 5 个节点，请配置正式授权"))
            return
        }
    }

    // 4. 执行创建
    // ... existing code ...
}

// ── 更新/删除类 Handler ──────────────────────

func (h *Handler) nodeUpdate(w http.ResponseWriter, r *http.Request) {
    tier, _ := middleware.GetLicenseTier()
    if tier == middleware.TierBlocked {
        response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
        return
    }
    // ... existing code ...
}

func (h *Handler) nodeDelete(w http.ResponseWriter, r *http.Request) {
    tier, _ := middleware.GetLicenseTier()
    if tier == middleware.TierBlocked {
        response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
        return
    }
    // ... existing code ...
}
```

#### 3.2.2 需修改的 Handler 清单

| 序号 | Handler | 行号 | 操作 | 限制类型 |
|------|---------|------|------|---------|
| 1 | `nodeCreate` | ~518 | 新增 tier 检查 + 免费版数量限制 | blocked/free |
| 2 | `nodeUpdate` | ~592 | 新增 tier 检查 | blocked |
| 3 | `nodeDelete` | ~679 | 新增 tier 检查 | blocked |
| 4 | `nodeBatchDelete` | ~993 | 新增 tier 检查 | blocked |
| 5 | `nodeUpdateOrder` | ~922 | 新增 tier 检查 | blocked |
| 6 | `nodeInstallDomestic` | ~695 | 新增 tier 检查 | blocked |
| 7 | `nodeInstallOverseas` | ~754 | 新增 tier 检查 | blocked |
| 8 | `nodeInstallAlternative` | ~808 | 新增 tier 检查 | blocked |
| 9 | `nodeInstallOffline` | ~862 | 新增 tier 检查 | blocked |
| 10 | `nodeRefreshExpiryReminder` | ~943 | 新增 tier 检查 | blocked |
| 11 | `nodeDismissExpiryReminder` | ~970 | 新增 tier 检查 | blocked |
| 12 | `nodeCheckStatus` | ~1008 | 新增 tier 检查 | blocked |
| 13 | `tunnelCreate` | ~1021 | 新增 tier 检查 + 免费版数量限制 | blocked/free |
| 14 | `tunnelUpdate` | ~1299 | 新增 tier 检查 | blocked |
| 15 | `tunnelDelete` | ~1808 | 新增 tier 检查 | blocked |
| 16 | `tunnelBatchDelete` | ~1870 | 新增 tier 检查 | blocked |
| 17 | `tunnelBatchRedeploy` | ~2085 | 新增 tier 检查 | blocked |
| 18 | `tunnelUpdateOrder` | ~1849 | 新增 tier 检查 | blocked |
| 19 | `userCreate` | ~31 | 新增 tier 检查 + 免费版数量限制 | blocked/free |
| 20 | `userUpdate` | ~121 | 新增 tier 检查 | blocked |
| 21 | `userDelete` | ~321 | 新增 tier 检查 | blocked |
| 22 | `userBatchDelete` | ~377 | 新增 tier 检查 | blocked |
| 23 | `userResetFlow` | ~352 | 新增 tier 检查 | blocked |
| 24 | `userBatchResetFlow` | ~414 | 新增 tier 检查 | blocked |
| 25 | `userUpdateOrder` | ~442 | 新增 tier 检查 | blocked |
| 26 | `forwardCreate` | ~2385 | 新增 tier 检查 + 免费版数量限制 | blocked/free |
| 27 | `forwardUpdate` | ~2505 | 新增 tier 检查 | blocked |
| 28 | `forwardDelete` | ~2718 | 新增 tier 检查 | blocked |
| 29 | `forwardForceDelete` | ~2747 | 新增 tier 检查 | blocked |
| 30 | `forwardPause` | ~2771 | 新增 tier 检查 | blocked |
| 31 | `forwardResume` | ~2802 | 新增 tier 检查 | blocked |
| 32 | `forwardBatchDelete` | ~2874 | 新增 tier 检查 | blocked |
| 33 | `forwardBatchPause` | ~2909 | 新增 tier 检查 | blocked |
| 34 | `forwardBatchResume` | ~2944 | 新增 tier 检查 | blocked |
| 35 | `forwardBatchRedeploy` | ~2985 | 新增 tier 检查 | blocked |
| 36 | `forwardBatchChangeTunnel` | ~3015 | 新增 tier 检查 | blocked |
| 37 | `speedLimitCreate` | ~3155 | 新增 tier 检查 | blocked |
| 38 | `speedLimitUpdate` | ~3180 | 新增 tier 检查 | blocked |
| 39 | `speedLimitDelete` | ~3209 | 新增 tier 检查 | blocked |
| 40 | `groupTunnelCreate` | ~3223 | 新增 tier 检查 | blocked |
| 41 | `groupTunnelUpdate` | ~3227 | 新增 tier 检查 | blocked |
| 42 | `groupTunnelDelete` | ~3231 | 新增 tier 检查 | blocked |
| 43 | `groupUserCreate` | ~3235 | 新增 tier 检查 | blocked |
| 44 | `groupUserUpdate` | ~3239 | 新增 tier 检查 | blocked |
| 45 | `groupUserDelete` | ~3243 | 新增 tier 检查 | blocked |
| 46 | `groupPermissionAssign` | ~3314 | 新增 tier 检查 | blocked |
| 47 | `groupPermissionRemove` | ~3331 | 新增 tier 检查 | blocked |

**合计：47 个 handler 需要修改。**

---

### 第三阶段：重构中间件层（0.5 天）

#### 3.3.1 修改 LicenseGuard

**文件：** `internal/http/middleware/license_guard.go`

```go
func LicenseGuard(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. 放行授权相关端点（让前端的 config 页面能正常工作）
        if r.URL.Path == "/api/v1/license/info" || r.URL.Path == "/api/v1/license/config" {
            next.ServeHTTP(w, r)
            return
        }

        // 2. 仅拦截 TierBlocked（明确无效的授权）
        tier, reason := middleware.GetLicenseTier()
        if tier == middleware.TierBlocked {
            response.WriteJSON(w, response.Err(403, "访问被拒绝：授权无效 ("+reason+")"))
            return
        }

        // 3. TierFree 和 TierPremium 都放行
        //    → 由 handler 层做具体限制（双保险）
        //    → 即使验证代码被删除，GetLicenseTier() 返回 TierFree
        //    → 用户永远无法越过 handler 层的免费版限制
        next.ServeHTTP(w, r)
    })
}
```

#### 3.3.2 TrialGuard 保留不变

**文件：** `internal/http/middleware/trial_guard.go`

保持现有逻辑，作为 belt+braces 双重保险。TrialGuard 被删除后，handler 层仍然有限制。

---

### 第四阶段：License 服务器改造（1 天）

#### 3.4.1 模型扩展

**文件：** `license-server/internal/model/model.go`

```go
type License struct {
    // ... existing fields ...
    MaxNodes   int    `gorm:"column:max_nodes;default:0" json:"max_nodes"`
    MaxTunnels int    `gorm:"column:max_tunnels;default:0" json:"max_tunnels"`
    MaxUsers   int    `gorm:"column:max_users;default:0" json:"max_users"`
    Features   string `gorm:"column:features;type:text" json:"features"` // JSON array
}

type VerifyResponse struct {
    Valid      bool     `json:"valid"`
    ExpireTime int64    `json:"expire_time,omitempty"`
    Reason     string   `json:"reason,omitempty"`
    MaxNodes   int      `json:"max_nodes,omitempty"`
    MaxTunnels int      `json:"max_tunnels,omitempty"`
    MaxUsers   int      `json:"max_users,omitempty"`
    Features   []string `json:"features,omitempty"`
}
```

#### 3.4.2 验证逻辑扩展

**文件：** `license-server/internal/repo/repo.go`

```go
func (r *Repository) VerifyLicense(licenseKey, domain string) (*model.VerifyResponse, error) {
    // ... existing validation ...

    var features []string
    json.Unmarshal([]byte(license.Features), &features)

    return &model.VerifyResponse{
        Valid:      true,
        ExpireTime: license.ExpireTime,
        Username:   "admin",
        MaxNodes:   license.MaxNodes,
        MaxTunnels: license.MaxTunnels,
        MaxUsers:   license.MaxUsers,
        Features:   features,
    }, nil
}
```

#### 3.4.3 创建授权时支持自定义限制

**文件：** `license-server/internal/model/model.go`

```go
type LicenseCreateRequest struct {
    Domain     string   `json:"domain"`
    Remark     string   `json:"remark"`
    ExpireTime int64    `json:"expire_time"`
    MaxNodes   int      `json:"max_nodes"`
    MaxTunnels int      `json:"max_tunnels"`
    MaxUsers   int      `json:"max_users"`
    Features   []string `json:"features"`
}
```

---

### 第五阶段：前端改动（0.5 天）

#### 3.5.1 LicenseInfo 接口扩展

**文件：** `vite-frontend/src/api/index.ts`

```typescript
export interface LicenseInfo {
  valid: boolean;
  expire_time?: number;
  reason?: string;
  configured: boolean;
  has_license_key: boolean;
  license_key: string;
  domain: string;
  // 新增字段
  tier: "free" | "premium" | "blocked";
  max_nodes: number;
  max_tunnels: number;
  max_users: number;
  features: string[];
}
```

#### 3.5.2 免费版提示更新

**文件：** `vite-frontend/src/layouts/admin.tsx`

第 671 行：保持现有提示文本不变

第 1076 行（config.tsx）：
```
输入授权码和面板域名以解除免费版限制（5 节点 / 5 隧道 / 1 用户规则）
```

---

## 四、攻击向量防护验证

| 攻击方式 | 改造前 | 改造后 | 原理 |
|---------|--------|--------|------|
| 删除 `router.go:LicenseGuard` |   功能全开 |   免费版限制 | handler 层兜底 |
| 修改 `doVerify()` 返回 true |   功能全开 |   免费版限制 | `GetLicenseTier()` 根据实际 key/状态判断 |
| 设置 `SERVER_DOMAIN=xxx` |   可通过域名检查 |   需 LICENSE_KEY | 无 key 即为 free |
| 删除 `trial_guard.go` |   无限制 |   免费版限制 | handler 层兜底 |
| 删除 `GetLicenseTier()` |   编译失败 |   编译失败 | 函数被 handler 调用 |
| 修改 `GetLicenseTier()` 返回 premium |   功能全开 |   功能全开 | **理论上可绕过，但需要：** |
| | | | 1. 找到并修改该函数 |
| | | | 2. 不触发其他编译错误 |
| | | | 3. 重新编译整个项目 |
| | | | 4. 替换二进制文件 |
| 完全自行编译删除所有限制 |   容易 |   困难 | 需要逐一删除 47+ handler 中的检查代码 |

### 结论

**技术层面无法 100% 阻止编译级破解。** 但我们的方案将破解成本从"改 1 行代码"提升到"改 50+ 行代码"，配合后续措施：

1. **法律层面：** 明确授权协议，破解视为侵权
2. **更新层面：** 定期更新，旧版本功能逐步下线
3. **服务层面：** 关键功能逐步云端化（长期）

---

## 五、免费版 vs 商业版功能对照

| 功能 | 免费版 | 商业版 |
|------|--------|--------|
| **节点** | 最多 5 个 | 无限 |
| **隧道** | 最多 5 个 | 无限 |
| **用户** | 最多 1 个（非管理员） | 无限 |
| **转发规则** | 最多 25 条 | 无限 |
| **速度限制** | ✅ 可用 | ✅ 可用 |
| **监控告警** | ❌ | ✅ |
| **API 集成** | ❌ | ✅ |
| **多节点集群** | ❌ | ✅ |
| **联邦功能** | ❌ | ✅ |
| **自定义域名** | ✅ 可用 | ✅ 可用 |
| **面板 UI** | ✅ 完全可访问 | ✅ 完全可访问 |

---

## 六、时间估算

| 阶段 | 内容 | 预估时间 |
|------|------|---------|
| 第一阶段 | Handler 层基础设施（`GetLicenseTier`, `CheckResourceLimit`, `license_tier.go`） | 0.5 天 |
| 第二阶段 | 修改 47 个 handler | 2 天 |
| 第三阶段 | 中间件重构（`license_guard.go`） | 0.5 天 |
| 第四阶段 | License 服务器改造（模型 + API） | 1 天 |
| 第五阶段 | 前端改动 | 0.5 天 |
| 第六阶段 | 测试 + 修复 | 1 天 |
| **总计** | | **5.5 天** |

---

## 七、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 漏改 handler | 该操作无限制 | 对所有 handler 逐一 review 确认 |
| 免费版用户无法使用 | 用户流失 | 保留完整的 UI 和已创建功能，仅限制创建 |
| 验证服务不可达 | 误伤付费用户 | 降级为免费版，给予宽限期 |
| 编译级破解 | 无法完全阻止 | 法律 + 更新 + 云端化，长期策略 |

---

## 附录：计费系统防破解方案

### 问题分析

当前计费系统的余额管理完全依赖管理后台，存在以下风险：

| 攻击方式 | 风险等级 | 说明 |
|---------|---------|------|
| 管理员直接改余额 |   危急 | `userUpdate` API 可直接设置 `balance` 为任意值 |
| 篡改数据库 |   高 | 直接修改 SQLite/PostgreSQL 中的 `balance` 字段 |
| 重放充值请求 |   中 | 如果日后添加充值接口，可能被重放 |
| 越权调用 API |   中 | 子管理员可能修改非自己管理的用户余额 |

**核心问题：** 余额只是一个普通的数据库字段，没有来源追溯，没有审计日志。

### 解决方案：双表 + 签名锁定

#### 架构设计

```
┌─ 当前 ───────────────────┐    ┌─ 改造后 ───────────────────────────┐
│                          │    │                                    │
│  user.balance (直接改)    │    │  user.balance (只读，由签名决定)     │
│  无日志                   │    │  balance_log 表 (所有变更写日志)    │
│  管理可随意改             │    │  余额变更必须经签名验证             │
│                          │    │  管理改余额 → 记录 + 签名          │
└──────────────────────────┘    └────────────────────────────────────┘
```

#### 新增数据库表：`balance_log`

**文件：** `internal/store/model/model.go`

```go
// BalanceChangeType 余额变更类型
type BalanceChangeType string

const (
    BalanceChangeAdmin   BalanceChangeType = "admin"    // 管理员手动调整
    BalanceChangeRecharge BalanceChangeType = "recharge" // 用户充值
    BalanceChangeRenewal BalanceChangeType = "renewal"  // 自动续费
    BalanceChangeBuy     BalanceChangeType = "buy"      // 购买流量
    BalanceChangeRefund  BalanceChangeType = "refund"   // 退款
)

// BalanceLog 余额变更日志
type BalanceLog struct {
    ID            int64             `gorm:"primaryKey;autoIncrement" json:"id"`
    UserID        int64             `gorm:"column:user_id;not null;index" json:"user_id"`
    ChangeType    BalanceChangeType `gorm:"column:change_type;type:varchar(20);not null" json:"change_type"`
    ChangeAmount  int64             `gorm:"column:change_amount;not null" json:"change_amount"` // 正=增加，负=减少（单位：分）
    BalanceBefore int64             `gorm:"column:balance_before;not null" json:"balance_before"`
    BalanceAfter  int64             `gorm:"column:balance_after;not null" json:"balance_after"`
    OperatorID    int64             `gorm:"column:operator_id;default:0" json:"operator_id"`     // 操作人 ID（0=系统）
    OperatorName  string            `gorm:"column:operator_name;type:varchar(100)" json:"operator_name"` // 操作人名称
    Remark        string            `gorm:"column:remark;type:varchar(255)" json:"remark"`       // 备注
    Signature     string            `gorm:"column:signature;type:varchar(128)" json:"signature"` // HMAC 签名（防篡改）
    CreatedAt     int64             `gorm:"column:created_at;not null" json:"created_at"`
}

func (BalanceLog) TableName() string { return "balance_log" }
```

#### 签名机制

```go
// BalanceSignKey 用于余额签名的密钥（从环境变量读取，与授权签名共用或独立）
var balanceSignKey = func() []byte {
    key := os.Getenv("BALANCE_SIGN_KEY")
    if key == "" {
        key = os.Getenv("LICENSE_SIGN_KEY") // 共用密钥
    }
    return []byte(key)
}()

// signBalanceLog 对余额变更记录签名
func signBalanceLog(log *BalanceLog) string {
    data := fmt.Sprintf("%d:%s:%d:%d:%d",
        log.UserID,
        log.ChangeType,
        log.ChangeAmount,
        log.BalanceBefore,
        log.CreatedAt,
    )
    mac := hmac.New(sha256.New, balanceSignKey())
    mac.Write([]byte(data))
    return hex.EncodeToString(mac.Sum(nil))
}

// verifyBalanceLog 验证余额变更签名
func verifyBalanceLog(log *BalanceLog) bool {
    expected := signBalanceLog(log)
    return hmac.Equal([]byte(log.Signature), []byte(expected))
}
```

#### 余额查询：仅从日志计算

**文件：** `internal/store/repo/repository_mutations.go`

```go
// GetUserBalance 从 balance_log 表计算用户当前余额（不可篡改）
func (r *Repository) GetUserBalance(userID int64) (int64, error) {
    var result struct {
        Total int64
    }
    // 只汇总已验证签名的记录
    err := r.db.Model(&model.BalanceLog{}).
        Select("COALESCE(SUM(change_amount), 0) as total").
        Where("user_id = ? AND signature != ''", userID).
        Scan(&result).Error
    if err != nil {
        return 0, err
    }
    return result.Total, nil
}

// ValidateUserBalance 验证 user.balance 与 balance_log 汇总一致
func (r *Repository) ValidateUserBalance(userID int64) (bool, error) {
    computed, err := r.GetUserBalance(userID)
    if err != nil {
        return false, err
    }
    var user model.User
    if err := r.db.Select("balance").First(&user, userID).Error; err != nil {
        return false, err
    }
    return computed == user.Balance, nil
}
```

### 改造清单

#### 1. 新增表：`balance_log`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 自增 |
| user_id | BIGINT | 用户 ID |
| change_type | VARCHAR(20) | 变更类型：admin/recharge/renewal/buy/refund |
| change_amount | BIGINT | 变更金额（分），正=增加，负=减少 |
| balance_before | BIGINT | 变更前余额 |
| balance_after | BIGINT | 变更后余额 |
| operator_id | BIGINT | 操作人 ID |
| operator_name | VARCHAR(100) | 操作人名称 |
| remark | VARCHAR(255) | 备注 |
| signature | VARCHAR(128) | HMAC 签名（防篡改） |
| created_at | BIGINT | 创建时间 |

#### 2. 修改现有流程

| 流程 | 当前行为 | 改造后 |
|------|---------|--------|
| 管理员手动调余额 | `UpdateUser` 直接设 `balance` | ① 写 `balance_log` ② 签名 ③ 更新 `user.balance` |
| 自动续费扣余额 | `RenewUserWithBalance` 直接减 | ① 写 `balance_log`（change_type=renewal）② 签名 ③ 减余额 |
| 购买流量扣余额 | `BuyTrafficWithBalance` 直接减 | ① 写 `balance_log`（change_type=buy）② 签名 ③ 减余额 |
| 查询余额 | 直接读 `user.balance` | 改为从 `balance_log` SUM 计算 |

#### 3. 改动文件

| # | 文件 | 改动 |
|---|------|------|
| 1 | `internal/store/model/model.go` | 新增 `BalanceLog` 模型 + `BalanceChangeType` 常量 |
| 2 | `internal/store/repo/repository_mutations.go` | 新增 `GetUserBalance()`, `ValidateUserBalance()`, 改写 `UpdateUser` 系列 |
| 3 | `internal/http/handler/mutations.go` | `userUpdate` 中余额变更改为走 `balance_log` |
| 4 | `internal/store/repo/repository.go` | 启动时执行 `AutoMigrate` 添加 `balance_log` 表 |
| 5 | `internal/http/handler/handler.go` | 用户信息返回余额改为走 `GetUserBalance()` |
| 6 | `.env.example` / `install.sh` | 添加 `BALANCE_SIGN_KEY` 环境变量说明 |

#### 4. 前端改动

**文件：** `vite-frontend/src/pages/user.tsx`

当前管理员可直接输入余额（line 2600-2613）：
```tsx
<Input
  label="可用余额 (元)"
  value={userForm.balance > 0 ? userForm.balance.toString() : ""}
  onChange={(e) => setUserForm(prev => ({ ...prev, balance: Math.round(Number(e.target.value)) }))}
/>
```

改为此操作模式：
```tsx
// 输入框改为"充值金额"
<Input
  label="充值金额 (元)"
  placeholder="输入要增加的金额"
  value={userForm.rechargeAmount > 0 ? userForm.rechargeAmount.toString() : ""}
  onChange={(e) => setUserForm(prev => ({ ...prev, rechargeAmount: Math.round(Number(e.target.value)) }))}
/>

// 新增"余额变更记录"按钮
<Button onPress={() => setShowBalanceLog(true)}>余额变更记录</Button>

// 余额变更记录弹窗（表格）
<Modal>
  <Table>
    <Column>时间</Column>
    <Column>类型</Column>
    <Column>变更金额</Column>
    <Column>余额</Column>
    <Column>操作人</Column>
    <Column>备注</Column>
  </Table>
</Modal>
```

### 防破解效果

| 攻击方式 | 改造前 | 改造后 |
|---------|--------|--------|
| 数据库直接改 `balance` 为 99999 | ✅ 成功 | ❌ 自动校验发现不一致，触发告警/修复 |
| 管理员通过 API 把余额改成任意值 | ✅ 成功 | ❌ 走 `balance_log` + 签名，可追溯 |
| 改完数据库再改日志 | ❌ 无日志 | ❌ 日志有 HMAC 签名，改数据导致签名失效 |
| 重放充值请求 | ❌ 无幂等 | ✅ `created_at` + 签名防重放 |
| 越权调 API 改余额 | ✅ 成功 | ❌ 记录操作人，可追溯追责 |
| 完全删除检查逻辑重新编译 | ✅ 需要这么多工作 | ✅ 仍然需要这么多工作（与 tier 防护同级） |

### 与授权系统签名的关系

```
授权系统签名                         计费系统签名
┌─────────────────┐               ┌─────────────────┐
│ LICENSE_SIGN_KEY │  (可共用)     │ BALANCE_SIGN_KEY │
│ 验证授权服务器     │    或         │ 验证余额变更记录    │
│ 防止假授权服务器   │               │ 防止余额被篡改     │
└─────────────────┘               └─────────────────┘
```

**推荐：** 共用同一个密钥（少一个环境变量），但签名数据内容不同，无法互相伪造。
