import type {
  PaymentChannelItem,
  SubscriptionPackageApiItem,
  PackageGroupApiItem,
} from "@/api/types";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { AnimatedPage } from "@/components/animated-page";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Tabs, Tab } from "@/shadcn-bridge/heroui/tabs";
import {
  getPaymentConfigs,
  getPackageList,
  getPackageGroupList,
  createPackageOrder,
  payOrder,
  getMySubscription,
} from "@/api";
import { PageLoadingState } from "@/components/page-state";

export default function ShopPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<SubscriptionPackageApiItem[]>([]);
  const [payChannels, setPayChannels] = useState<PaymentChannelItem[]>([]);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] =
    useState<SubscriptionPackageApiItem | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("BALANCE");
  const [submitting, setSubmitting] = useState(false);
  const [activeSub, setActiveSub] = useState<any>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [pendingBuyPkg, setPendingBuyPkg] =
    useState<SubscriptionPackageApiItem | null>(null);
  const [pkgQuantity, setPkgQuantity] = useState(1);

  const [selectedTab, setSelectedTab] = useState(
    localStorage.getItem("shop-active-tab") || "subscription",
  );
  const [packageGroups, setPackageGroups] = useState<PackageGroupApiItem[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const subPkgs = packages.filter((p) => p.type === "subscription" || !p.type);
  const trafficPkgs = packages.filter((p) => p.type === "traffic");
  const balancePkgs = packages.filter((p) => p.type === "balance");

  const typeSections = [
    {
      type: "subscription" as const,
      icon: "📦",
      title: "订阅套餐",
      items: subPkgs,
    },
    {
      type: "traffic" as const,
      icon: "⚡",
      title: "流量快餐",
      items: trafficPkgs,
    },
    {
      type: "balance" as const,
      icon: "💰",
      title: "余额充值",
      items: balancePkgs,
    },
  ].filter((s) => s.items.length > 0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payRes, pkgRes, subRes, groupRes] = await Promise.all([
        getPaymentConfigs(),
        getPackageList(),
        getMySubscription(),
        getPackageGroupList(),
      ]);

      if (payRes.code === 0) {
        setPayChannels(Array.isArray(payRes.data) ? payRes.data : []);
      }
      if (pkgRes.code === 0) {
        setPackages(
          Array.isArray(pkgRes.data)
            ? pkgRes.data.filter(
                (p: SubscriptionPackageApiItem) =>
                  p.shopVisible === 1 && p.enabled === 1,
              )
            : [],
        );
      }
      if (subRes.code === 0 && subRes.data.subscription) {
        setActiveSub(subRes.data.subscription);
      } else {
        setActiveSub(null);
      }
      if (groupRes.code === 0) {
        setPackageGroups(Array.isArray(groupRes.data) ? groupRes.data : []);
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  usePullToRefresh(loadData);

  const handleBuyPackage = (pkg: SubscriptionPackageApiItem) => {
    if (pkg.stock === 0) return;
    if (pkg.type === "subscription" && activeSub) {
      setPendingBuyPkg(pkg);
      setConfirmReplaceOpen(true);

      return;
    }
    setSelectedPackage(pkg);
    setPkgQuantity(pkg.type === "balance" ? 1 : 1);
    setSelectedCurrency("BALANCE");
    setBuyModalOpen(true);
  };

  const handleConfirmReplace = () => {
    setConfirmReplaceOpen(false);
    if (pendingBuyPkg) {
      setSelectedPackage(pendingBuyPkg);
      setSelectedCurrency("BALANCE");
      setBuyModalOpen(true);
      setPendingBuyPkg(null);
    }
  };

  const networkLabelMap: Record<string, string> = {
    tron: "TRC-20",
    bsc: "BEP-20",
    ethereum: "ERC-20",
    polygon: "Polygon",
  };

  const availableChannels = (() => {
    const isBalanceType = selectedPackage?.type === "balance";
    const channels: { channel: string; label: string; desc: string }[] = [];

    if (!isBalanceType) {
      channels.push({
        channel: "BALANCE",
        label: "余额支付",
        desc: "使用账户余额",
      });
    }
    payChannels
      .filter((c) => c.enabled)
      .forEach((c) => {
        let network = "TRC-20";

        try {
          const cfg = JSON.parse(c.config);

          network = networkLabelMap[cfg.network] || "TRC-20";
        } catch {
          /* ignore */
        }
        channels.push({
          channel: c.channel,
          label:
            c.channel === "USDT" ? `USDT (${network})` : "易支付 (支付宝/微信)",
          desc: c.channel === "USDT" ? "加密货币支付" : "扫码支付",
        });
      });

    return channels;
  })();

  const handleConfirmBuy = async () => {
    if (!selectedPackage) return;
    if (selectedCurrency !== "BALANCE") {
      setSubmitting(true);
      try {
        const createRes = await createPackageOrder({
          package_id: selectedPackage.id,
          pay_currency: selectedCurrency,
          quantity: 1,
        });

        if (createRes.code !== 0) {
          toast.error(createRes.msg || "下单失败");
          setSubmitting(false);

          return;
        }
        const orderId = createRes.data.orderId;
        const payRes = await payOrder(orderId);

        if (payRes.code === 0) {
          toast.success("订单已创建，请完成支付");
          const payUrl = payRes.data.payUrl || payRes.data.payAddress || "";

          if (payUrl) window.open(payUrl, "_blank");
        } else {
          toast.error(payRes.msg || "获取支付链接失败");
        }
      } catch {
        toast.error("网络错误");
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        const res = await createPackageOrder({
          package_id: selectedPackage.id,
          pay_currency: "BALANCE",
          quantity: pkgQuantity,
        });

        if (res.code === 0) {
          toast.success("购买成功");
          setBuyModalOpen(false);
          navigate("/dashboard", { replace: true });
        } else {
          toast.error(res.msg || "购买失败");
        }
      } catch {
        toast.error("网络错误");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const formatTraffic = (gb: number) => {
    if (gb === 0) return "不限";
    if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;

    return `${gb} GB`;
  };

  const renderPackageCard = (pkg: SubscriptionPackageApiItem) => (
    <Card
      className="border border-divider shadow-sm hover:shadow-md transition-shadow relative overflow-visible"
    >
      {pkg.recommended === 1 && (
        <div className="absolute -top-2 -right-2 z-10">
          <span className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5 rounded-full font-semibold">
            推荐
          </span>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between w-full">
          <div>
            <h3 className="text-lg font-semibold">{pkg.name}</h3>
            {pkg.description && (
              <p className="text-xs text-red-400 text-foreground mt-1 whitespace-pre-wrap">
                {pkg.description}
              </p>
            )}
          </div>
          <div className="flex-shrink-0 ml-2">
            {pkg.stock === -1 ? (
              <span className="text-xs text-green-500 text-foreground">
                不限
              </span>
            ) : pkg.stock === 0 ? (
              <span className="text-xs text-red-500 font-medium">
                已售罄
              </span>
            ) : (
              <span className="text-xs text-blue-500 font-medium">
                库存: {pkg.stock}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2">
          <span className="text-2xl font-bold font-mono">
            &yen;{(pkg.price / 100).toFixed(2)}
          </span>
          {pkg.type === "subscription" && (
            <span className="text-sm text-gray-400 ml-1">
              /{pkg.validityDays}天
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="pt-0 space-y-2">
        {pkg.type === "traffic" ? (
          <>
            <div className="flex flex-wrap gap-1">
              <Chip
                className="rounded-none"
                color="primary"
                size="sm"
                variant="solid"
              >
                {formatTraffic(pkg.trafficLimit)}
              </Chip>
            </div>
            <p className="text-xs text-orange-500">
              有效期跟随账户到期时间
            </p>
          </>
        ) : pkg.type !== "balance" ? (
          <>
            <div className="flex flex-wrap gap-1 rounded-sm">
              <Chip
                className="rounded-xs"
                color="primary"
                size="sm"
                variant="solid"
              >
                {formatTraffic(pkg.trafficLimit)}
              </Chip>
              <Chip
                className="rounded-xs"
                color="success"
                size="sm"
                variant="solid"
              >
                {pkg.speedLimit > 0
                  ? `${pkg.speedLimit} Mbps`
                  : "不限速"}
              </Chip>
            </div>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div>
                规则 {pkg.maxRules || "不限"} &middot; 连接{" "}
                {pkg.maxConnections || "不限"}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-orange-500 mb-3">
            充值到账户余额 不退款
          </p>
        )}
        {pkg.type === "balance" && (
          <div className="flex items-center justify-between mt-2">
            <div className="inline-flex items-center gap-1 rounded-lg border border-divider bg-default-50 px-1 py-0.5">
              <Button
                isIconOnly
                className="h-6 w-6 rounded"
                isDisabled={pkgQuantity <= 1}
                size="sm"
                variant="light"
                onPress={() =>
                  setPkgQuantity((q) => Math.max(1, q - 1))
                }
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M20 12H4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </Button>
              <input
                className="w-12 text-center text-sm font-semibold outline-none bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                min="1"
                type="number"
                value={pkgQuantity}
                onChange={(e) => {
                  const v = parseInt(
                    e.target.value.replace(/\D/g, ""),
                  );
                  if (v >= 1) setPkgQuantity(v);
                }}
              />
              <Button
                isIconOnly
                className="h-6 w-6 rounded"
                size="sm"
                variant="light"
                onPress={() =>
                  setPkgQuantity((q) =>
                    Math.min(
                      pkg.stock > 0 ? pkg.stock : 100,
                      q + 1,
                    ),
                  )
                }
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 4v16m8-8H4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </Button>
            </div>
            <span className="text-base font-semibold">
              ¥{((pkg.price / 100) * pkgQuantity).toFixed(2)}
            </span>
          </div>
        )}
        {pkg.type === "subscription" && (
          <p className="text-xs text-orange-500">
            重复购买将替换现有套餐
          </p>
        )}
        <div className="mt-2">
          {pkg.stock === 0 ? (
            <Button isDisabled className="w-full" color="default">
              已售罄
            </Button>
          ) : (
            <Button
              className="w-full"
              color="primary"
              onPress={() => handleBuyPackage(pkg)}
            >
              {pkg.type === "balance" ? "立即充值" : "立即购买"}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );

  const renderGroupedCards = (items: SubscriptionPackageApiItem[]) => {
    const grouped = new Map<number, SubscriptionPackageApiItem[]>();
    const ungrouped: SubscriptionPackageApiItem[] = [];

    for (const item of items) {
      if (item.groupId != null && item.groupId > 0) {
        if (!grouped.has(item.groupId)) grouped.set(item.groupId, []);
        grouped.get(item.groupId)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    const sortedGroups = Array.from(grouped.entries()).sort((a, b) => {
      const ga = packageGroups.find((g) => g.id === a[0]);
      const gb = packageGroups.find((g) => g.id === b[0]);
      return (
        (ga?.inx || 0) - (gb?.inx || 0) ||
        (ga?.name || "").localeCompare(gb?.name || "")
      );
    });

    return (
      <div className="space-y-6">
        {sortedGroups.map(([groupId, pkgs]) => {
          const group = packageGroups.find((g) => g.id === groupId);
          const isCollapsed = collapsedGroups.has(String(groupId));
          return (
            <div key={groupId} className="space-y-3">
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => {
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(String(groupId))) next.delete(String(groupId));
                    else next.add(String(groupId));
                    return next;
                  });
                }}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: group?.color || "#9ca3af" }}
                />
                <span className="font-semibold text-base">
                  {group?.name || "未命名分组"}
                </span>
                <span className="text-xs text-gray-400">({pkgs.length})</span>
                <svg
                  className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${
                    isCollapsed ? "-rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {pkgs.map((pkg) => (
                    <div key={pkg.id}>{renderPackageCard(pkg)}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {ungrouped.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-gray-400 flex-shrink-0" />
              <span className="font-semibold text-base text-gray-500">
                未分组
              </span>
              <span className="text-xs text-gray-400">({ungrouped.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {ungrouped.map((pkg) => (
                <div key={pkg.id}>{renderPackageCard(pkg)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">商城</h1>
        <p className="text-sm text-gray-400 mt-1">选购套餐获取服务</p>
      </div>

      {loading ? (
        <PageLoadingState message="加载商城..." />
      ) : packages.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">暂无可用套餐</p>
          <p className="text-sm mt-1">请联系管理员</p>
        </div>
      ) : typeSections.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">暂无可用套餐</p>
          <p className="text-sm mt-1">请联系管理员</p>
        </div>
      ) : (
        <Tabs
          selectedKey={selectedTab}
          onSelectionChange={(key) => {
            setSelectedTab(String(key));
            localStorage.setItem("shop-active-tab", String(key));
          }}
        >
          {typeSections.map((s) => (
            <Tab
              key={s.type}
              title={
                <span className="flex items-center gap-1.5">
                  <span>{s.icon}</span>
                  <span>{s.title}</span>
                  <span className="text-xs text-gray-400">
                    ({s.items.length})
                  </span>
                </span>
              }
            >
              <div className="mt-6">
                {renderGroupedCards(s.items)}
              </div>
            </Tab>
          ))}
        </Tabs>
      )}

      <Modal
        isOpen={confirmReplaceOpen}
        placement="center"
        size="sm"
        onOpenChange={(open) => {
          if (!open) {
            setConfirmReplaceOpen(false);
            setPendingBuyPkg(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader className="text-warning flex items-center gap-1">
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            确认购买
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              当前已有有效订阅套餐，新购后将替换现有套餐，剩余流量和有效期将作废。确定继续？
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setConfirmReplaceOpen(false);
                setPendingBuyPkg(null);
              }}
            >
              取消
            </Button>
            <Button color="warning" onPress={handleConfirmReplace}>
              确定继续
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={buyModalOpen}
        placement="center"
        onOpenChange={(open) => {
          if (!open) {
            setBuyModalOpen(false);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>确认购买</ModalHeader>
          <ModalBody className="space-y-4">
            <div className="bg-default-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">套餐</span>
                <span className="font-medium">{selectedPackage?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">价格</span>
                <span className="font-mono font-bold">
                  &yen;
                  {selectedPackage
                    ? (selectedPackage.price / 100).toFixed(2)
                    : "0"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">支付方式</label>
              <div className="grid grid-cols-1 gap-2">
                {availableChannels.map((ch) => (
                  <button
                    key={ch.channel}
                    className={`flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                      selectedCurrency === ch.channel
                        ? "border-primary bg-primary/5"
                        : "border-divider hover:border-default-400"
                    }`}
                    onClick={() => setSelectedCurrency(ch.channel)}
                  >
                    <div>
                      <div className="font-medium text-sm">{ch.label}</div>
                      <div className="text-xs text-gray-400">{ch.desc}</div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 ${
                        selectedCurrency === ch.channel
                          ? "border-primary bg-primary"
                          : "border-gray-300"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setBuyModalOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              color="primary"
              isLoading={submitting}
              onPress={handleConfirmBuy}
            >
              {selectedCurrency === "BALANCE" ? "余额支付" : "去支付"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
