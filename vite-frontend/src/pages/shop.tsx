import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
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
import { getPaymentConfigs, getPackageList, createPackageOrder, payOrder } from "@/api";
import type { PaymentChannelItem, SubscriptionPackageApiItem } from "@/api/types";
import { PageLoadingState } from "@/components/page-state";

export default function ShopPage() {
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<SubscriptionPackageApiItem[]>([]);
  const [payChannels, setPayChannels] = useState<PaymentChannelItem[]>([]);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<SubscriptionPackageApiItem | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("BALANCE");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payRes, pkgRes] = await Promise.all([
        getPaymentConfigs(),
        getPackageList(),
      ]);
      if (payRes.code === 0) {
        setPayChannels(Array.isArray(payRes.data) ? payRes.data : []);
      }
      if (pkgRes.code === 0) {
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data.filter((p: SubscriptionPackageApiItem) => p.shopVisible === 1 && p.enabled === 1) : []);
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleBuyPackage = (pkg: SubscriptionPackageApiItem) => {
    setSelectedPackage(pkg);
    setSelectedCurrency("BALANCE");
    setBuyModalOpen(true);
  };

  const availableChannels = [
    { channel: "BALANCE", label: "余额支付", desc: "使用账户余额" },
    ...payChannels
      .filter((c) => c.enabled)
      .map((c) => ({
        channel: c.channel,
        label: c.channel === "USDT" ? "USDT (TRC-20)" : "易支付 (支付宝/微信)",
        desc: c.channel === "USDT" ? "加密货币支付" : "扫码支付",
      })),
  ];

  const handleConfirmBuy = async () => {
    if (!selectedPackage) return;
    if (selectedCurrency !== "BALANCE") {
      setSubmitting(true);
      try {
        const createRes = await createPackageOrder({ packageId: selectedPackage.id, payCurrency: selectedCurrency });
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
        const res = await createPackageOrder({ packageId: selectedPackage.id, payCurrency: "BALANCE" });
        if (res.code === 0) {
          toast.success("购买成功");
          setBuyModalOpen(false);
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {packages.map((pkg) => (
            <Card key={pkg.id} className="border border-divider shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{pkg.name}</h3>
                    {pkg.description && (
                      <p className="text-xs text-gray-400 mt-1">{pkg.description}</p>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold font-mono">&yen;{(pkg.price / 100).toFixed(2)}</span>
                  <span className="text-sm text-gray-400 ml-1">/{pkg.validityDays}天</span>
                </div>
              </CardHeader>
              <CardBody className="pt-0 space-y-2">
                <div className="flex flex-wrap gap-1">
                  <Chip size="sm" variant="flat">{formatTraffic(pkg.trafficLimit)}</Chip>
                  {/* <Chip size="sm" variant="flat">{pkg.portCount > 0 ? `${pkg.portCount} 端口` : "不限端口"}</Chip> */}
                  <Chip size="sm" variant="flat">{pkg.speedLimit > 0 ? `${pkg.speedLimit} Mbps` : "不限速"}</Chip>
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  <div>规则 {pkg.maxRules || "不限"} &middot; 连接 {pkg.maxConnections || "不限"}{/* &middot; 单IP {pkg.maxIPAccess || "不限"} */}</div>
                </div>
                <Button
                  color="primary"
                  className="w-full mt-2"
                  onPress={() => handleBuyPackage(pkg)}
                >
                  立即购买
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={buyModalOpen} placement="center"
        onOpenChange={(open) => { if (!open) { setBuyModalOpen(false); } }}>
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
                <span className="font-mono font-bold">&yen;{selectedPackage ? (selectedPackage.price / 100).toFixed(2) : "0"}</span>
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
                    <div className={`w-4 h-4 rounded-full border-2 ${
                      selectedCurrency === ch.channel ? "border-primary bg-primary" : "border-gray-300"
                    }`} />
                  </button>
                ))}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setBuyModalOpen(false); }}>取消</Button>
            <Button color="primary" isLoading={submitting} onPress={handleConfirmBuy}>
              {selectedCurrency === "BALANCE" ? "余额支付" : "去支付"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
