import type { SubscriptionPackageApiItem } from "@/api/types";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { PageEmptyState, PageLoadingState } from "@/components/page-state";
import { AnnouncementBanner } from "@/pages/dashboard/components/announcement-banner";
import { FlowChartCard } from "@/pages/dashboard/components/flow-chart-card";
import { MetricCard } from "@/pages/dashboard/components/metric-card";
import {
  formatNodeRenewalTime,
  getNodeRenewalCycleLabel,
  getNodeRenewalSnapshot,
} from "@/pages/node/renewal";
import {
  useDashboardData,
  type DashboardNodeExpiryItem,
  type DashboardUserTunnel as UserTunnel,
} from "@/pages/dashboard/use-dashboard-data";
import {
  toggleUserAutoRenew,
  toggleUserAutoBuyTraffic,
  getStoreStatus,
  listAutoBuyTrafficPackages,
} from "@/api";

export default function DashboardPage() {
  const [quotaHistoryModalOpen, setQuotaHistoryModalOpen] = useState(false);
  const {
    loading,
    userInfo,
    userTunnels,
    forwardList,
    statisticsFlows,
    nodeExpiryReminders,
    isAdmin,
    announcement,
    quotaHistory,
    fetchQuotaHistory,
    deleteQuotaHistory,
    refresh,
  } = useDashboardData();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [historyToDelete, setHistoryToDelete] = useState<number | null>(null);
  const [autoRenewSwitchLoading, setAutoRenewSwitchLoading] = useState(false);
  const [autoRenewOverride, setAutoRenewOverride] = useState<number | null>(
    null,
  );
  const [autoBuySwitchLoading, setAutoBuySwitchLoading] = useState(false);
  const [autoBuyOverride, setAutoBuyOverride] = useState<number | null>(null);
  const [autoBuyPackageIdOverride, setAutoBuyPackageIdOverride] = useState<
    number | null
  >(null);
  const [autoBuyThresholdOverride, setAutoBuyThresholdOverride] = useState<
    number | null
  >(null);
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [autoBuyPackages, setAutoBuyPackages] = useState<
    SubscriptionPackageApiItem[]
  >([]);
  const [autoBuySettingsModalOpen, setAutoBuySettingsModalOpen] =
    useState(false);

  const handleToggleAutoRenew = async (enabled: boolean) => {
    if (!userInfo.id || autoRenewSwitchLoading) return;
    setAutoRenewSwitchLoading(true);
    try {
      const newValue = enabled ? 1 : 0;
      const res = await toggleUserAutoRenew(userInfo.id, newValue);

      if (res.code === 0) {
        toast.success(enabled ? "自动续费已启用" : "自动续费已禁用");
        setAutoRenewOverride(newValue);
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("操作失败");
    } finally {
      setAutoRenewSwitchLoading(false);
    }
  };

  const handleToggleAutoBuyTraffic = async (enabled: boolean) => {
    if (!userInfo.id || autoBuySwitchLoading) return;

    if (enabled) {
      setDraftThreshold(userInfo.autoBuyTrafficThreshold ?? 10);
      setDraftPackageId(userInfo.autoBuyTrafficPackageId ?? 0);
      setAutoBuySettingsModalOpen(true);

      return;
    }

    setAutoBuySwitchLoading(true);
    try {
      const res = await toggleUserAutoBuyTraffic(userInfo.id, 0);

      if (res.code === 0) {
        toast.success("自动购流已禁用");
        setAutoBuyOverride(0);
        setAutoBuyPackageIdOverride(null);
        setAutoBuyThresholdOverride(null);
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("操作失败");
    } finally {
      setAutoBuySwitchLoading(false);
    }
  };

  const [draftThreshold, setDraftThreshold] = useState(10);
  const [draftPackageId, setDraftPackageId] = useState(0);

  useEffect(() => {
    if (autoBuySettingsModalOpen) {
      setDraftThreshold(
        autoBuyThresholdOverride ?? userInfo.autoBuyTrafficThreshold ?? 10,
      );
      setDraftPackageId(
        autoBuyPackageIdOverride ?? userInfo.autoBuyTrafficPackageId ?? 0,
      );
    }
  }, [autoBuySettingsModalOpen]);

  const handleAutoBuySettingsSave = async () => {
    if (!userInfo.id || autoBuySwitchLoading) return;
    if (draftPackageId <= 0) {
      toast.error("请选择套餐");

      return;
    }
    setAutoBuySwitchLoading(true);
    try {
      const res = await toggleUserAutoBuyTraffic(
        userInfo.id,
        1,
        draftPackageId,
        draftThreshold,
      );

      if (res.code === 0) {
        toast.success("自动购流设置已保存");
        setAutoBuyPackageIdOverride(draftPackageId);
        setAutoBuyThresholdOverride(draftThreshold);
        setAutoBuyOverride(1);
        setAutoBuySettingsModalOpen(false);
        localStorage.setItem("autoBuyConfigUpdated", Date.now().toString());
        void refresh();
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("操作失败");
    } finally {
      setAutoBuySwitchLoading(false);
    }
  };

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
      window.removeEventListener(
        "storeEnabledChanged",
        handleStoreEnabledChanged,
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    fetchQuotaHistory();
  }, [fetchQuotaHistory]);

  const handleDeleteHistory = async () => {
    if (historyToDelete) {
      await deleteQuotaHistory(historyToDelete);
      setHistoryToDelete(null);
      setDeleteConfirmOpen(false);
    }
  };
  const formatFlow = (value: number, unit: string = "bytes"): string => {
    // 99999 表示无限制
    if (value === 99999) {
      return "无限制";
    }
    if (unit === "gb") {
      return value + " GB";
    } else {
      if (value === 0) return "0 B";
      if (value < 1024) return value + " B";
      if (value < 1024 * 1024) return (value / 1024).toFixed(2) + " KB";
      if (value < 1024 * 1024 * 1024)
        return (value / (1024 * 1024)).toFixed(2) + " MB";

      return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }
  };
  const formatNumber = (value: number): string => {
    // 99999 表示无限制
    if (value === 99999) {
      return "无限制";
    }

    return value.toString();
  };
  const getNodeExpiryStatus = (
    nextDueTime?: number,
    renewalState: "unset" | "expired" | "dueSoon" | "scheduled" = "unset",
  ) => {
    if (!nextDueTime || renewalState === "unset") {
      return {
        label: "未设置",
        badgeClassName:
          "bg-default-100 text-default-700 dark:bg-default-50 dark:text-default-300",
        nextDueTime: undefined as number | undefined,
      };
    }
    const diffDays = Math.ceil(
      (nextDueTime - Date.now()) / (1000 * 60 * 60 * 24),
    );

    if (renewalState === "expired" || diffDays <= 0) {
      return {
        label: "已逾期",
        badgeClassName:
          "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
        nextDueTime,
      };
    }
    if (diffDays === 1) {
      return {
        label: "明天到期",
        badgeClassName:
          "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
        nextDueTime,
      };
    }

    return {
      label: `${diffDays}天后到期`,
      badgeClassName:
        diffDays <= 7
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
      nextDueTime,
    };
  };
  const renderNodeExpiryCard = (node: DashboardNodeExpiryItem) => {
    const renewalSnapshot = getNodeRenewalSnapshot(
      node.expiryTime,
      node.renewalCycle,
    );
    const expiryStatus = getNodeExpiryStatus(
      renewalSnapshot.nextDueTime,
      renewalSnapshot.state,
    );

    return (
      <div
        key={node.id}
        className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-sm dark:border-amber-500/20 dark:from-amber-950/20 dark:via-background dark:to-orange-950/10"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {node.name}
            </div>
            <div className="mt-1 text-xs text-default-500">
              节点 ID: {node.id}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${expiryStatus.badgeClassName}`}
          >
            {expiryStatus.label}
          </span>
        </div>
        <div className="mt-3 text-sm text-default-700 dark:text-default-300">
          {formatNodeRenewalTime(renewalSnapshot.nextDueTime)}
        </div>
        <div className="mt-1 text-xs text-default-500">
          {getNodeRenewalCycleLabel(node.renewalCycle)}
        </div>
        {node.remark?.trim() && (
          <p className="mt-3 line-clamp-2 text-xs leading-5 text-default-600 dark:text-default-400">
            {node.remark.trim()}
          </p>
        )}
      </div>
    );
  };
  // 处理24小时流量统计数据
  const processFlowChartData = () => {
    // 生成最近24小时的时间数组（从当前小时往前推24小时）
    const now = new Date();
    const hours: string[] = [];

    for (let i = 23; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourString = time.getHours().toString().padStart(2, "0") + ":00";

      hours.push(hourString);
    }
    // 创建数据映射
    const flowMap = new Map<string, number>();

    statisticsFlows.forEach((item) => {
      flowMap.set(item.time, item.flow || 0);
    });

    // 生成图表数据，没有数据的小时显示为0
    return hours.map((hour) => ({
      time: hour,
      flow: flowMap.get(hour) || 0,
      // 格式化显示用的流量值
      formattedFlow: formatFlow(flowMap.get(hour) || 0),
    }));
  };
  const getExpStatus = (expTime?: string | number) => {
    if (!expTime)
      return {
        color: "text-green-600 dark:text-green-400",
        bg: "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20",
        text: "永久",
      };
    const now = new Date();
    const expDate = new Date(expTime);

    if (isNaN(expDate.getTime())) {
      return {
        color: "text-gray-600 dark:text-gray-400",
        bg: "bg-gray-50 dark:bg-black/10 border-gray-200 dark:border-gray-500/20",
        text: "无效",
      };
    }
    if (expDate < now) {
      return {
        color: "text-red-600 dark:text-red-400",
        bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
        text: "已过期",
      };
    }
    const diffTime = expDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 7) {
      return {
        color: "text-red-600 dark:text-red-400",
        bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
        text: `${diffDays}天后过期`,
      };
    } else if (diffDays <= 30) {
      return {
        color: "text-orange-600 dark:text-orange-400",
        bg: "bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20",
        text: `${diffDays}天后过期`,
      };
    } else {
      return {
        color: "text-green-600 dark:text-green-400",
        bg: "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20",
        text: `${diffDays}天后过期`,
      };
    }
  };
  const calculateUserTotalUsedFlow = (): number => {
    // 后端已按计费类型处理流量，前端直接使用入站+出站总和
    return (userInfo.inFlow || 0) + (userInfo.outFlow || 0);
  };
  const calculateUsagePercentage = (type: "flow" | "forwards"): number => {
    if (type === "flow") {
      const totalUsed = calculateUserTotalUsedFlow();
      const totalLimit = (userInfo.flow || 0) * 1024 * 1024 * 1024;

      // 无限制时返回0%
      if (userInfo.flow === 99999) return 0;

      return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
    } else if (type === "forwards") {
      const totalUsed = forwardList.length;
      const totalLimit = userInfo.num || 0;

      // 无限制时返回0%
      if (userInfo.num === 99999) return 0;

      return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
    }

    return 0;
  };
  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-500 dark:bg-red-600";
    if (percentage >= 70) return "bg-orange-500 dark:bg-orange-600";

    return "bg-blue-500 dark:bg-blue-600";
  };
  const renderProgressBar = (
    percentage: number,
    size: "sm" | "md" = "md",
    isUnlimited: boolean = false,
  ) => {
    const height = size === "sm" ? "h-1.5" : "h-2";

    if (isUnlimited) {
      return (
        <div className="w-full">
          <div
            className={`w-full bg-gradient-to-r from-blue-200 to-purple-200 dark:from-blue-500/30 dark:to-purple-500/30 rounded-full ${height}`}
          >
            <div
              className={`${height} bg-gradient-to-r from-blue-500 to-purple-500 rounded-full w-full opacity-60`}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="w-full">
        <div
          className={`w-full bg-gray-200 dark:bg-gray-800 rounded-full ${height}`}
        >
          <div
            className={`${height} rounded-full transition-all duration-300 ${getUsageColor(percentage)}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      </div>
    );
  };
  const calculateTunnelUsedFlow = (tunnel: UserTunnel): number => {
    if (!tunnel) return 0;
    const inFlow = tunnel.inFlow || 0;
    const outFlow = tunnel.outFlow || 0;

    // 后端已按计费类型处理流量，前端直接使用入站+出站总和
    return inFlow + outFlow;
  };
  const calculateTunnelFlowPercentage = (tunnel: UserTunnel): number => {
    const totalUsed = calculateTunnelUsedFlow(tunnel);
    const totalLimit = (tunnel.flow || 0) * 1024 * 1024 * 1024;

    // 无限制时返回0%
    if (tunnel.flow === 99999) return 0;

    return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
  };
  const getTunnelUsedForwards = (tunnelId: number): number => {
    return forwardList.filter((forward) => forward.tunnelId === tunnelId)
      .length;
  };
  const calculateTunnelForwardPercentage = (tunnel: UserTunnel): number => {
    const totalUsed = getTunnelUsedForwards(tunnel.tunnelId);
    const totalLimit = tunnel.num || 0;

    // 无限制时返回0%
    if (tunnel.num === 99999) return 0;

    return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
  };
  const formatResetTime = (resetDay?: number): string => {
    if (resetDay === undefined || resetDay === null) return "";
    if (resetDay === 0) return "不归零";
    const now = new Date();
    const currentDay = now.getDate();
    let daysUntilReset: number;

    if (resetDay > currentDay) {
      daysUntilReset = resetDay - currentDay;
    } else {
      const nextMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        resetDay,
      );
      const diffTime = nextMonth.getTime() - now.getTime();

      daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    if (daysUntilReset === 0) {
      return "今日归零";
    } else if (daysUntilReset === 1) {
      return "明日归零";
    } else {
      return `${daysUntilReset}天后归零`;
    }
  };

  if (loading) {
    return (
      <div className="px-3 lg:px-6 flex-grow pt-2 lg:pt-4">
        <PageLoadingState message="正在加载数据..." />
      </div>
    );
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-2 lg:py-4">
      {announcement && <AnnouncementBanner announcement={announcement} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6 lg:mb-8">
        {/* 1. 总流量 */}
        <div className="order-3 lg:order-1 flex flex-col [&>*]:flex-1">
          <MetricCard
            icon={
              <svg
                aria-hidden="true"
                className="w-4 h-4 lg:w-5 lg:h-5 text-blue-600 dark:text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
            }
            iconClassName="bg-blue-100 dark:bg-blue-500/20"
            title="总流量"
            value={formatFlow(userInfo.flow, "gb")}
          />
        </div>
        {/* 2. 已用流量 */}
        <div className="order-1 lg:order-2 flex flex-col [&>*]:flex-1">
          <MetricCard
            bottomContent={
              <div className="mt-1">
                {renderProgressBar(
                  calculateUsagePercentage("flow"),
                  "sm",
                  userInfo.flow === 99999,
                )}
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-default-500 truncate">
                    {userInfo.flow === 99999
                      ? "无限制"
                      : `${calculateUsagePercentage("flow").toFixed(1)}%`}
                  </p>
                  {userInfo.flowResetTime !== undefined &&
                    userInfo.flowResetTime !== null && (
                      <div className="text-xs text-default-500 flex items-center gap-1">
                        <svg
                          aria-hidden="true"
                          className="w-3 h-3"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            clipRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                            fillRule="evenodd"
                          />
                        </svg>
                        <span className="truncate">
                          {formatResetTime(userInfo.flowResetTime)}
                        </span>
                      </div>
                    )}
                </div>
              </div>
            }
            icon={
              <svg
                aria-hidden="true"
                className="w-4 h-4 lg:w-5 lg:h-5 text-green-600 dark:text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  clipRule="evenodd"
                  d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z"
                  fillRule="evenodd"
                />
              </svg>
            }
            iconClassName="bg-green-100 dark:bg-green-500/20"
            title={
              <button
                className="inline-flex items-center cursor-pointer hover:text-primary transition-colors"
                title="流量历史记录"
                type="button"
                onClick={() => setQuotaHistoryModalOpen(true)}
              >
                <span>已用流量</span>
                <svg
                  className="ml-0.5 w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    clipRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    fillRule="evenodd"
                  />
                </svg>
              </button>
            }
            value={formatFlow(calculateUserTotalUsedFlow())}
          />
        </div>
        {/* 3. 规则配额 */}
        <div className="order-4 lg:order-3 flex flex-col [&>*]:flex-1">
          <MetricCard
            icon={
              <svg
                aria-hidden="true"
                className="w-4 h-4 lg:w-5 lg:h-5 text-purple-600 dark:text-purple-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  clipRule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                  fillRule="evenodd"
                />
              </svg>
            }
            iconClassName="bg-purple-100 dark:bg-purple-500/20"
            title="规则配额"
            value={formatNumber(userInfo.num || 0)}
          />
        </div>
        {/* 4. 已用规则 */}
        <div className="order-2 lg:order-4 flex flex-col [&>*]:flex-1">
          <MetricCard
            bottomContent={
              <div className="mt-1">
                {renderProgressBar(
                  calculateUsagePercentage("forwards"),
                  "sm",
                  userInfo.num === 99999,
                )}
                <p className="text-xs text-default-500 mt-1 truncate">
                  {userInfo.num === 99999
                    ? "无限制"
                    : `${calculateUsagePercentage("forwards").toFixed(1)}%`}
                </p>
              </div>
            }
            icon={
              <svg
                aria-hidden="true"
                className="w-4 h-4 lg:w-5 lg:h-5 text-orange-600 dark:text-orange-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  clipRule="evenodd"
                  d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                  fillRule="evenodd"
                />
              </svg>
            }
            iconClassName="bg-orange-100 dark:bg-orange-500/20"
            title="已用规则"
            value={forwardList.length}
          />
        </div>
        {!isAdmin && (
          <>
            {/* 5. 续费与余额 */}
            <div className="order-5 flex flex-col [&>*]:flex-1">
              <MetricCard
                bottomContent={
                  storeEnabled ? (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-success" />
                      <span
                        className="text-xs text-primary cursor-pointer hover:underline"
                        onClick={() => (window.location.href = "/shop")}
                      >
                        去充值
                      </span>
                    </div>
                  ) : null
                }
                icon={
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4 lg:w-5 lg:h-5 text-blue-600 dark:text-blue-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                    <path
                      clipRule="evenodd"
                      d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                      fillRule="evenodd"
                    />
                  </svg>
                }
                iconClassName="bg-blue-100 dark:bg-blue-500/20"
                title="可用余额"
                value={
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {((userInfo.balance ?? 0) / 100).toFixed(2)}元
                      </span>
                    </div>
                  </div>
                }
              />
            </div>
            {/* 6. 到期时间 */}
            <div className="order-7 flex flex-col [&>*]:flex-1">
              <MetricCard
                bottomContent={
                  userInfo.expTime &&
                  typeof userInfo.expTime === "number" &&
                  Number(userInfo.expTime) > 0 ? (
                    <div className="mt-1 flex items-center gap-1">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${(Number(userInfo.expTime) - Date.now()) / (1000 * 60 * 60 * 24) > 7 ? "bg-success" : "bg-warning"}`}
                      />
                      <span
                        className={`text-xs ${(Number(userInfo.expTime) - Date.now()) / (1000 * 60 * 60 * 24) > 7 ? "text-success" : "text-warning"}`}
                      >
                        {Math.ceil(
                          (Number(userInfo.expTime) - Date.now()) /
                            (1000 * 60 * 60 * 24),
                        )}{" "}
                        天后到期
                      </span>
                    </div>
                  ) : null
                }
                icon={
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4 lg:w-5 lg:h-5 text-purple-600 dark:text-purple-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                      fillRule="evenodd"
                    />
                  </svg>
                }
                iconClassName="bg-purple-100 dark:bg-purple-500/20"
                title="到期时间"
                value={
                  userInfo.expTime
                    ? new Date(userInfo.expTime)
                        .toLocaleDateString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        })
                        .replace(/\//g, "-")
                    : "永久"
                }
              />
            </div>
            {/* 7. 自动续费 */}
            <div className="order-8 flex flex-col [&>*]:flex-1">
              <MetricCard
                bottomContent={
                  (autoRenewOverride ?? userInfo.autoRenew) === 1 ? (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-success" />
                      <span className="text-xs text-success">
                        自动续费运行中
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-default-400" />
                      <span className="text-xs text-default-500">
                        到期后账户将停用
                      </span>
                    </div>
                  )
                }
                icon={
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4 lg:w-5 lg:h-5 text-cyan-600 dark:text-cyan-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                      fillRule="evenodd"
                    />
                  </svg>
                }
                iconClassName="bg-cyan-100 dark:bg-cyan-500/20"
                title={
                  <div className="flex items-center gap-2">
                    <span>自动续费</span>
                    <Switch
                      isDisabled={autoRenewSwitchLoading}
                      isSelected={
                        (autoRenewOverride ?? userInfo.autoRenew) === 1
                      }
                      size="sm"
                      onValueChange={handleToggleAutoRenew}
                    />
                  </div>
                }
                value={`${((userInfo.renewalAmount ?? 0) / 100).toFixed(2)}元/月`}
              />
            </div>
            {/* 8. 自动购买流量 */}
            <div className="order-9 flex flex-col [&>*]:flex-1">
              <MetricCard
                bottomContent={
                  storeEnabled ? (
                    (autoBuyOverride ?? userInfo.autoBuyTraffic) === 0 ? (
                      <div className="mt-1 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-default-400" />
                        <span className="text-xs text-default-500">
                          流量用完后将禁用账户
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-success" />
                          <span className="text-success">
                            {(() => {
                              const p = autoBuyPackages.find(
                                (pkg) =>
                                  pkg.id ===
                                  (autoBuyPackageIdOverride ??
                                    userInfo.autoBuyTrafficPackageId),
                              );

                              return p
                                ? `${p.trafficLimit}GB / ¥${(p.price / 100).toFixed(2)} · `
                                : "";
                            })()}
                            {autoBuyThresholdOverride ??
                              userInfo.autoBuyTrafficThreshold ??
                              10}
                            GB 触发
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => setAutoBuySettingsModalOpen(true)}
                        >
                          设置
                        </Button>
                      </div>
                    )
                  ) : userInfo.autoBuyTraffic === 1 ? (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-success" />
                      <span className="text-xs text-success">
                        管理员手动开启 自动购流运行中
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-default-400" />
                      <span className="text-xs text-default-500">
                        流量用完后将禁用账户
                      </span>
                    </div>
                  )
                }
                icon={
                  <svg
                    className="w-4 h-4 text-orange-600"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                  </svg>
                }
                iconClassName="bg-orange-100 dark:bg-orange-500/20"
                title={
                  storeEnabled ? (
                    <div className="flex items-center gap-2">
                      <span>自动购流</span>
                      <Switch
                        isDisabled={autoBuySwitchLoading}
                        isSelected={
                          (autoBuyOverride ?? userInfo.autoBuyTraffic) === 1
                        }
                        size="sm"
                        onValueChange={handleToggleAutoBuyTraffic}
                      />
                    </div>
                  ) : (
                    "自动购流"
                  )
                }
                value={
                  storeEnabled
                    ? (autoBuyOverride ?? userInfo.autoBuyTraffic) === 1
                      ? (autoBuyPackageIdOverride ??
                          userInfo.autoBuyTrafficPackageId ??
                          0) > 0
                        ? (autoBuyPackages.find(
                            (p) =>
                              p.id ===
                              (autoBuyPackageIdOverride ??
                                userInfo.autoBuyTrafficPackageId),
                          )?.name ?? "套餐自动购买")
                        : "点击设置相关内容"
                      : "禁用"
                    : userInfo.autoBuyTraffic === 1
                      ? (userInfo.autoBuyTrafficPackageId ?? 0) > 0
                        ? "套餐自动购买"
                        : `${userInfo.buyTrafficAmount ?? 0}G/${((userInfo.buyTrafficPrice ?? 0) / 100).toFixed(2)}元`
                      : "禁用"
                }
              />
            </div>
          </>
        )}
      </div>
      <FlowChartCard
        chartData={processFlowChartData()}
        formatFlow={formatFlow}
        statisticsFlowsCount={statisticsFlows.length}
      />
      {isAdmin && nodeExpiryReminders.length > 0 && (
        <Card className="mb-6 lg:mb-8 border border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-background to-orange-50/70 shadow-md dark:border-amber-500/20 dark:from-amber-950/10 dark:to-orange-950/10">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between w-full">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.981-1.742 2.981H4.42c-1.53 0-2.492-1.647-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-7a1 1 0 00-1 1v3a1 1 0 102 0V7a1 1 0 00-1-1z"
                      fillRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg lg:text-xl font-semibold text-foreground">
                    节点到期提醒
                  </h2>
                  <p className="text-sm text-default-500">
                    展示 7
                    天内需要续费或已经逾期的节点，基于月付/季付/年付周期自动推算
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit items-center rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200/80 dark:bg-white/5 dark:text-amber-300 dark:ring-amber-500/20">
                {nodeExpiryReminders.length} 个提醒
              </span>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {nodeExpiryReminders.slice(0, 6).map(renderNodeExpiryCard)}
            </div>
            {nodeExpiryReminders.length > 6 && (
              <p className="mt-4 text-xs text-default-500">
                还有 {nodeExpiryReminders.length - 6}{" "}
                个节点未展开显示，可前往节点页面继续处理。
              </p>
            )}
          </CardBody>
        </Card>
      )}
      {/* 隧道权限 - 管理员不显示 */}
      {!isAdmin && (
        <Card className="mb-6 lg:mb-8 border border-gray-200 dark:border-default-200 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <svg
                aria-hidden="true"
                className="w-5 h-5 text-primary"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  clipRule="evenodd"
                  d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                  fillRule="evenodd"
                />
              </svg>
              <h2 className="text-lg lg:text-xl font-semibold text-foreground">
                隧道权限
              </h2>
              <span className="px-2 py-1 bg-default-100 dark:bg-default-50 text-default-600 rounded-full text-xs">
                {userTunnels.length}
              </span>
            </div>
          </CardHeader>
          <CardBody className="pt-0">
            {userTunnels.length === 0 ? (
              <PageEmptyState className="h-48" message="暂无隧道权限" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {userTunnels.map((tunnel) => {
                  const tunnelExpStatus = getExpStatus(tunnel.expTime);

                  return (
                    <div
                      key={tunnel.id}
                      className="border border-gray-200 dark:border-default-100 rounded-lg p-3 lg:p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {tunnel.tunnelName} {/* 注释隧道 ID: {tunnel.id} */}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span
                              className={`px-2 py-1 rounded-md text-xs font-medium ${tunnel.tunnelFlow === 1 ? "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300" : "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300"}`}
                            >
                              {tunnel.tunnelFlow === 1
                                ? "单向计费"
                                : "双向计费"}
                            </span>
                            <span
                              className={`px-2 py-1 rounded-md text-xs font-medium border ${tunnelExpStatus.bg} ${tunnelExpStatus.color}`}
                            >
                              {tunnelExpStatus.text}
                            </span>
                            {tunnel.flowResetTime !== undefined &&
                              tunnel.flowResetTime !== null && (
                                <span className="text-xs text-default-500">
                                  {formatResetTime(tunnel.flowResetTime)}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                        <div>
                          <p className="text-sm text-default-600 mb-1">
                            流量配额
                          </p>
                          <p className="font-semibold text-foreground">
                            {formatFlow(tunnel.flow, "gb")}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-default-600 mb-1">
                            已用流量
                          </p>
                          <p className="font-semibold text-foreground">
                            {formatFlow(calculateTunnelUsedFlow(tunnel))}
                          </p>
                          <div className="mt-1">
                            {renderProgressBar(
                              calculateTunnelFlowPercentage(tunnel),
                              "sm",
                              tunnel.flow === 99999,
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-sm text-default-600 mb-1">
                            规则配额
                          </p>
                          <p className="font-semibold text-foreground">
                            {formatNumber(tunnel.num)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-default-600 mb-1">
                            已用规则
                          </p>
                          <p className="font-semibold text-foreground">
                            {getTunnelUsedForwards(tunnel.tunnelId)}
                          </p>
                          <div className="mt-1">
                            {renderProgressBar(
                              calculateTunnelForwardPercentage(tunnel),
                              "sm",
                              tunnel.num === 99999,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {/* 流量历史记录弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[500px] rounded-xl",
        }}
        isOpen={quotaHistoryModalOpen}
        placement="center"
        onOpenChange={setQuotaHistoryModalOpen}
      >
        <ModalContent>
          <ModalHeader className="flex items-center justify-between">
            <span className="text-base font-semibold">流量历史记录</span>
            <Button
              isIconOnly
              className="w-8 h-8 min-w-8"
              size="sm"
              variant="flat"
              onPress={() => setQuotaHistoryModalOpen(false)}
            >
              <svg
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </ModalHeader>
          <ModalBody className="py-6">
            {quotaHistory.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {quotaHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-default-50/50 dark:bg-default-100/20 rounded-lg"
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <span className="text-sm font-medium text-default-600">
                        {item.resetReason === "管理员手动归零" ||
                        item.resetReason === "管理员手动重置"
                          ? "admin"
                          : "系统自动"}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-default-500">
                          {new Date(item.resetTime)
                            .toLocaleString("zh-CN", { hour12: false })
                            .replace(/\//g, "-")}
                        </span>
                        <Button
                          isIconOnly
                          className="w-6 h-6 min-w-6 text-danger hover:bg-danger/10"
                          size="sm"
                          variant="flat"
                          onPress={() => {
                            setHistoryToDelete(item.id);
                            setDeleteConfirmOpen(true);
                          }}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              clipRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              fillRule="evenodd"
                            />
                          </svg>
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <div className="w-full">
                        <span className="text-default-500 text-sm block mb-1">
                          归零前流量
                        </span>
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <span className="text-primary-600 text-sm whitespace-nowrap dark:text-primary-400">
                            ↑
                            {(item.inFlowBefore / 1024 / 1024 / 1024).toFixed(
                              2,
                            )}{" "}
                            GB
                          </span>
                          <span className="text-success-600 text-sm whitespace-nowrap dark:text-success-400">
                            ↓
                            {(item.outFlowBefore / 1024 / 1024 / 1024).toFixed(
                              2,
                            )}{" "}
                            GB
                          </span>
                          <span className="text-default-600 text-sm whitespace-nowrap font-medium">
                            总{" "}
                            {(item.usedBytes / 1024 / 1024 / 1024).toFixed(2)}{" "}
                            GB
                          </span>
                        </div>
                      </div>
                      {item.resetReason && (
                        <div className="flex items-center justify-between w-full">
                          <span className="text-default-500 text-sm">
                            归零原因
                          </span>
                          <span className="text-red-500 text-sm">
                            {item.resetReason}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-default-400">
                <div className="text-sm">暂无记录</div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => setQuotaHistoryModalOpen(false)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除历史记录确认弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[400px] rounded-xl",
        }}
        isOpen={deleteConfirmOpen}
        placement="center"
        onOpenChange={setDeleteConfirmOpen}
      >
        <ModalContent>
          <ModalHeader className="text-base font-semibold">
            确认删除
          </ModalHeader>
          <ModalBody className="py-4">
            <p className="text-sm text-default-600">
              确定要删除这条流量历史记录吗？此操作不可恢复！
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDeleteConfirmOpen(false)}>
              取消
            </Button>
            <Button color="danger" onPress={handleDeleteHistory}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 自动购流设置弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[420px] rounded-xl",
        }}
        isOpen={autoBuySettingsModalOpen}
        placement="center"
        onOpenChange={setAutoBuySettingsModalOpen}
      >
        <ModalContent>
          <ModalHeader className="text-base font-semibold">
            自动购流设置
          </ModalHeader>
          <ModalBody className="py-4 space-y-4">
            <Input
              label="触发阈值 (GB)"
              min={1}
              size="sm"
              type="number"
              value={String(draftThreshold)}
              variant="bordered"
              onChange={(e) => {
                const n = parseInt(e.target.value);

                if (!isNaN(n) && n > 0) setDraftThreshold(n);
              }}
            />
            <Select
              label="选择套餐"
              selectedKeys={[String(draftPackageId)]}
              variant="bordered"
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0] as string;

                if (key && Number(key) > 0) setDraftPackageId(Number(key));
              }}
            >
              {autoBuyPackages.map((pkg) => (
                <SelectItem key={String(pkg.id)}>
                  {pkg.name} ({pkg.trafficLimit}GB / ¥
                  {(pkg.price / 100).toFixed(2)})
                </SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setAutoBuySettingsModalOpen(false)}
            >
              取消
            </Button>
            <Button
              color="primary"
              isDisabled={autoBuySwitchLoading || draftPackageId <= 0}
              onPress={handleAutoBuySettingsSave}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
