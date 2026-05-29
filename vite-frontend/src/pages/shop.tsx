import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

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
import { getPaymentConfigs, getPackageList, createPackageOrder, payOrder, getMySubscription } from "@/api";
import type { PaymentChannelItem, SubscriptionPackageApiItem } from "@/api/types";
import { PageLoadingState } from "@/components/page-state";

export default function ShopPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<SubscriptionPackageApiItem[]>([]);
  const [payChannels, setPayChannels] = useState<PaymentChannelItem[]>([]);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<SubscriptionPackageApiItem | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("BALANCE");
  const [submitting, setSubmitting] = useState(false);
  const [activeSub, setActiveSub] = useState<any>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [pendingBuyPkg, setPendingBuyPkg] = useState<SubscriptionPackageApiItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payRes, pkgRes, subRes] = await Promise.all([
        getPaymentConfigs(),
        getPackageList(),
        getMySubscription(),
      ]);
      if (payRes.code === 0) {
        setPayChannels(Array.isArray(payRes.data) ? payRes.data : []);
      }
      if (pkgRes.code === 0) {
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data.filter((p: SubscriptionPackageApiItem) => p.shopVisible === 1 && p.enabled === 1) : []);
      }
      if (subRes.code === 0 && subRes.data.subscription) {
        setActiveSub(subRes.data.subscription);
      } else {
        setActiveSub(null);
      }
    } catch {
      toast.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleBuyPackage = (pkg: SubscriptionPackageApiItem) => {
    if (pkg.type === "subscription" && activeSub) {
      setPendingBuyPkg(pkg);
      setConfirmReplaceOpen(true);
      return;
    }
    setSelectedPackage(pkg);
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
      channels.push({ channel: "BALANCE", label: "余额支付", desc: "使用账户余额" });
    }
    payChannels.filter((c) => c.enabled).forEach((c) => {
      let network = "TRC-20";
      try { const cfg = JSON.parse(c.config); network = networkLabelMap[cfg.network] || "TRC-20"; } catch { /* ignore */ }
      channels.push({
        channel: c.channel,
        label: c.channel === "USDT" ? `USDT (${network})` : "易支付 (支付宝/微信)",
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
        const createRes = await createPackageOrder({ package_id: selectedPackage.id, pay_currency: selectedCurrency });
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
        const res = await createPackageOrder({ package_id: selectedPackage.id, pay_currency: "BALANCE" });
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
        (() => {
          const subPkgs = packages.filter(p => p.type === "subscription" || !p.type);
          const trafficPkgs = packages.filter(p => p.type === "traffic");
          const balancePkgs = packages.filter(p => p.type === "balance");
          const sections: { title: string; items: SubscriptionPackageApiItem[] }[] = [];
          if (subPkgs.length) sections.push({ title: "订阅套餐", items: subPkgs });
          if (balancePkgs.length) sections.push({ title: "余额充值", items: balancePkgs });
          if (trafficPkgs.length) sections.push({ title: "流量包", items: trafficPkgs });
          return sections.map((section) => (
            <div key={section.title} className="mb-8">
              <h2 className="text-lg font-semibold mb-3">{section.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {section.items.map((pkg) => (
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
                        {pkg.type !== "balance" && <span className="text-sm text-gray-400 ml-1">/{pkg.validityDays}天</span>}
                      </div>
                    </CardHeader>
                    <CardBody className="pt-0 space-y-2">
                      {pkg.type !== "balance" ? (
                        <>
                          <div className="flex flex-wrap gap-1">
                            <Chip size="sm" variant="flat">{formatTraffic(pkg.trafficLimit)}</Chip>
                            <Chip size="sm" variant="flat">{pkg.speedLimit > 0 ? `${pkg.speedLimit} Mbps` : "不限速"}</Chip>
                          </div>
                          <div className="text-xs text-gray-400 space-y-0.5">
                            <div>规则 {pkg.maxRules || "不限"} &middot; 连接 {pkg.maxConnections || "不限"}</div>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">充值到账户余额</p>
                      )}
                      {pkg.type === "subscription" && (
                        <p className="text-xs text-orange-500">已有订阅套餐时新购将替换现有套餐</p>
                      )}
                      <Button
                        color="primary"
                        className="w-full mt-2"
                        onPress={() => handleBuyPackage(pkg)}
                      >
                        {pkg.type === "balance" ? "立即充值" : "立即购买"}
                      </Button>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          ));
        })()
      )}

      <Modal isOpen={confirmReplaceOpen} placement="center" size="sm"
        onOpenChange={(open) => { if (!open) { setConfirmReplaceOpen(false); setPendingBuyPkg(null); } }}>
        <ModalContent>
          <ModalHeader className="text-warning flex items-center gap-1">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            确认购买
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              当前已有有效订阅套餐，新购后将替换现有套餐，剩余流量和有效期将作废。确定继续？
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setConfirmReplaceOpen(false); setPendingBuyPkg(null); }}>取消</Button>
            <Button color="warning" onPress={handleConfirmReplace}>确定继续</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
