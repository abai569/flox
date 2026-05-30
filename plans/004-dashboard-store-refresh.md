# 004-Dashboard-Store-Refresh

**Created:** 2026-05-30  
**Updated:** 2026-05-30 (修正商城开关逻辑)  
**Issue:** 商城关闭后，用户 Dashboard 页面和相关菜单不会实时更新隐藏  
**Root Cause:** `window.dispatchEvent` 只在同一个浏览器标签页内有效，无法跨标签页/窗口通信

## Problem Description

用户测试场景：
1. 浏览器 A - 用户登录 dashboard 页面
2. 浏览器 B - 管理员在设置页或套餐页面关闭商城
3. 浏览器 A 不会收到事件通知，相关内容不会隐藏

受影响的页面/组件：
- `vite-frontend/src/pages/dashboard.tsx` - 用户 Dashboard 页面
- `vite-frontend/src/layouts/admin.tsx` - 管理员布局（左侧菜单）
- `vite-frontend/src/layouts/h5.tsx` - H5 布局（左侧菜单）
- `vite-frontend/src/pages/admin-plans.tsx` - 套餐管理页面

## Solution

使用 `window.addEventListener('storage', ...)` 监听 localStorage 变化，实现跨标签页同步。

**注意：** `storage` 事件只在其他标签页修改 localStorage 时触发，当前标签页修改不触发。

## Tasks

- [x] **dashboard.tsx** - 添加 storage 事件监听
  - [x] 在 useEffect 中添加 `storage` 事件监听器
  - [x] 修复"去充值"入口使用 `storeEnabled` 状态（而非静态的 `isPaymentEnabled`）
  - [x] 修复"自动购流"卡片：商城关闭时显示手动设置的流量包信息（如 `100G/10 元`）

- [x] **admin.tsx** - 添加 storage 事件监听
  - [x] 在 useEffect 中添加 `storage` 事件监听器
  - [x] 将 `isPaymentEnabled` 改为状态管理（2026-05-30 修复）
  - [x] 在 storage 事件中同时更新 `storeEnabled` 和 `isPaymentEnabled`

- [x] **h5.tsx** - 添加 storage 事件监听
  - [x] 在 useEffect 中添加 `storage` 事件监听器
  - [x] 将 `isPaymentEnabled` 改为状态管理（2026-05-30 修复）
  - [x] 在 storage 事件中同时更新 `storeEnabled` 和 `isPaymentEnabled`

- [x] **admin-plans.tsx** - 添加 storage 事件监听
  - [x] 在 useEffect 中添加 `storage` 事件监听器（同步设置页面的商城开关状态）

- [x] **config.tsx** - 修正商城开关逻辑（2026-05-30）
  - [x] 修改 label 为"开启商城系统"
  - [x] 修改 description 为"关闭后，将隐藏..."
  - [x] 修正 handleDirectSwitchChange 中的逻辑（去掉取反）
  - [x] 修正开关的 isSelected 绑定（改为 configs[item.key] === "true"）
  - [x] 修正开关的 onValueChange 逻辑（去掉取反）
  - [x] 修正快捷开关的 isSelected 绑定
  - [x] 设置默认值为 "true"（默认开启商城）
  - [x] 添加 storage 事件监听（同步其他页面的商城开关变更）

## Implementation Details

### 1. dashboard.tsx

**文件位置：** `vite-frontend/src/pages/dashboard.tsx`

**修改点 1：** useEffect 添加 storage 监听（Line 139-166）

```tsx
useEffect(() => {
  getStoreStatus().then((res) => {
    if (res.code === 0) setStoreEnabled(res.data?.enabled ?? false);
  });
  listAutoBuyTrafficPackages().then((res) => {
    if (res.code === 0 && Array.isArray(res.data))
      setAutoBuyPackages(res.data);
  });
  const handleStoreEnabledChanged = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    setStoreEnabled(!!detail.enabled);
  };

  // 监听 storage 事件（其他标签页修改 localStorage 时触发）
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === "vite_config_payment_enabled") {
      const enabled = e.newValue !== "false";
      setStoreEnabled(enabled);
    }
  };

  window.addEventListener("storeEnabledChanged", handleStoreEnabledChanged);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener("storeEnabledChanged", handleStoreEnabledChanged);
    window.removeEventListener("storage", handleStorageChange);
  };
}, []);
```

**修改点 2：** "去充值"入口使用 `storeEnabled`（Line 653）

```tsx
// 修改前
isPaymentEnabled ? (

// 修改后
storeEnabled ? (
```

**修改点 3：** "自动购流"卡片显示手动设置信息（Line 842-856）

```tsx
// 修改前
: userInfo.autoBuyTraffic === 1 ? (
  <div className="mt-1 flex items-center gap-1">
    <div className="w-1.5 h-1.5 rounded-full bg-success" />
    <span className="text-xs text-success">
      自动购买流量运行中
    </span>
  </div>
)

// 修改后
: userInfo.autoBuyTraffic === 1 ? (
  <div className="mt-2 space-y-2">
    {userInfo.autoBuyTrafficPackageId && userInfo.autoBuyTrafficPackageId > 0 ? (
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-success" />
        <span className="text-xs text-success">
          自动购买流量运行中
        </span>
      </div>
    ) : (
      <div className="text-xs text-default-500">
        {userInfo.buyTrafficAmount || 0}GB / {userInfo.buyTrafficPrice || 0}元
      </div>
    )}
  </div>
)
```

### 2. admin.tsx

**文件位置：** `vite-frontend/src/layouts/admin.tsx`

**修改点：** useEffect 添加 storage 监听（Line 102-134）

```tsx
useEffect(() => {
  getStoreStatus().then((res) => {
    if (res.code === 0 && res.data) {
      setStoreEnabled(!!res.data.enabled);
    }
  });
  const handlePaymentChange = () => forceUpdate();
  const handleConfigUpdate = () => forceUpdate();
  const handleStoreEnabledChanged = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    setStoreEnabled(!!detail.enabled);
  };

  // 监听 storage 事件（其他标签页修改 localStorage 时触发）
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === "vite_config_payment_enabled") {
      const enabled = e.newValue !== "false";
      setStoreEnabled(enabled);
    }
  };

  window.addEventListener("paymentEnabledChanged", handlePaymentChange);
  window.addEventListener("configUpdated", handleConfigUpdate);
  window.addEventListener("storeEnabledChanged", handleStoreEnabledChanged);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener("paymentEnabledChanged", handlePaymentChange);
    window.removeEventListener("configUpdated", handleConfigUpdate);
    window.removeEventListener(
      "storeEnabledChanged",
      handleStoreEnabledChanged,
    );
    window.removeEventListener("storage", handleStorageChange);
  };
}, []);
```

### 3. h5.tsx

**文件位置：** `vite-frontend/src/layouts/h5.tsx`

**修改点：** useEffect 添加 storage 监听（Line 311-354）

```tsx
const handlePaymentChange = () => forceUpdate();
const handleConfigUpdate = () => forceUpdate();
const handleStoreEnabledChanged = (e: Event) => {
  const detail = (e as CustomEvent).detail;
  setStoreEnabled(!!detail.enabled);
};

// 监听 storage 事件（其他标签页修改 localStorage 时触发）
const handleStorageChange = (e: StorageEvent) => {
  if (e.key === "vite_config_payment_enabled") {
    const enabled = e.newValue !== "false";
    setStoreEnabled(enabled);
  }
};

window.addEventListener("paymentEnabledChanged", handlePaymentChange);
window.addEventListener("configUpdated", handleConfigUpdate);
window.addEventListener("storeEnabledChanged", handleStoreEnabledChanged);
window.addEventListener("storage", handleStorageChange);

return () => {
  clearInterval(licenseInterval);
  window.removeEventListener("paymentEnabledChanged", handlePaymentChange);
  window.removeEventListener("configUpdated", handleConfigUpdate);
  window.removeEventListener(
    "storeEnabledChanged",
    handleStoreEnabledChanged,
  );
  window.removeEventListener("storage", handleStorageChange);
};
```

### 4. admin-plans.tsx

**文件位置：** `vite-frontend/src/pages/admin-plans.tsx`

**修改点：** 添加 useEffect 监听 storage 事件（Line 179-198）

```tsx
useEffect(() => {
  const handleStoreEnabledChanged = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    setStoreEnabled(!!detail.enabled);
  };

  // 监听 storage 事件（其他标签页修改 localStorage 时触发）
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === "vite_config_payment_enabled") {
      const enabled = e.newValue !== "false";
      setStoreEnabled(enabled);
    }
  };

  window.addEventListener("storeEnabledChanged", handleStoreEnabledChanged);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener("storeEnabledChanged", handleStoreEnabledChanged);
    window.removeEventListener("storage", handleStorageChange);
  };
}, []);
```

## Testing

1. **跨标签页同步测试：**
   - 标签页 A：登录用户账号，打开 Dashboard
   - 标签页 B：登录管理员账号，打开设置页
   - 在设置页关闭"商城系统"
   - 验证标签页 A 的"去充值"入口、"自动购流"卡片是否实时隐藏/更新

2. **左侧菜单同步测试：**
   - 标签页 A：登录用户账号
   - 标签页 B：登录管理员账号，关闭商城
   - 验证标签页 A 的左侧菜单"商城"、"我的"是否实时隐藏

3. **套餐页面同步测试：**
   - 标签页 A：打开套餐管理页面
   - 标签页 B：打开设置页，关闭商城
   - 验证标签页 A 的商城开关状态是否同步更新

## Notes

- `storage` 事件只在**其他标签页**修改 localStorage 时触发，当前标签页修改不触发
- 因此需要同时保留 `storeEnabledChanged` 自定义事件（用于同标签页通知）和 `storage` 事件（用于跨标签页通知）
- 监听 key：`vite_config_payment_enabled`
- 值判断：`newValue !== "false"` 表示开启，否则关闭
