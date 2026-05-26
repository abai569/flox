import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { PageLoadingState } from "@/components/page-state";
import Network from "@/api/network";
import type { ProductApiItem } from "@/api/types";
import { createOrder } from "@/api";

interface YiPayForm {
  enabled: boolean;
  gateway_url: string;
  pid: string;
  key: string;
  notify_url: string;
  return_url: string;
}

interface UsdtForm {
  enabled: boolean;
  network: string;
  api_key: string;
  ipn_secret: string;
}

interface PaymentStats {
  paidAmount: number;
  paidOrders: number;
  pendingOrders: number;
}

interface PaymentConfig {
  id: number;
  channel: string;
  config: string;
  enabled: number;
}

const defaultYiPay: YiPayForm = {
  enabled: false,
  gateway_url: "",
  pid: "",
  key: "",
  notify_url: "",
  return_url: "",
};

const defaultUsdt: UsdtForm = {
  enabled: false,
  network: "polygon",
  api_key: "",
  ipn_secret: "",
};

function fmtMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function AdminPaymentPage() {
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<PaymentConfig[]>([]);
  const [stats, setStats] = useState<PaymentStats>({ paidAmount: 0, paidOrders: 0, pendingOrders: 0 });
  const [products, setProducts] = useState<ProductApiItem[]>([]);
  const [tabKey, setTabKey] = useState("basic");

  const [yipay, setYipay] = useState<YiPayForm>(defaultYiPay);
  const [usdt, setUsdt] = useState<UsdtForm>(defaultUsdt);

  const [testChannel, setTestChannel] = useState("YIPAY");
  const [testProductId, setTestProductId] = useState("");
  const [createdPayUrl, setCreatedPayUrl] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  const panelUrl = typeof window !== "undefined" ? window.location.origin : "";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, statsRes, productRes] = await Promise.all([
        Network.post<PaymentConfig[]>("/payment/config/admin/list"),
        Network.post<PaymentStats>("/payment/stats"),
        Network.post<ProductApiItem[]>("/product/list"),
      ]);
      if (configRes.code === 0) setConfigs(Array.isArray(configRes.data) ? configRes.data : []);
      if (statsRes.code === 0) setStats(statsRes.data);
      if (productRes.code === 0) setProducts(Array.isArray(productRes.data) ? productRes.data : []);
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const yipayConfig = useMemo(() => configs.find((c) => c.channel === "YIPAY"), [configs]);
  const usdtConfig = useMemo(() => configs.find((c) => c.channel === "USDT"), [configs]);

  useEffect(() => {
    if (yipayConfig) {
      try {
        const parsed = JSON.parse(yipayConfig.config);
        setYipay({ enabled: !!yipayConfig.enabled, ...parsed });
      } catch { setYipay((p) => ({ ...p, enabled: !!yipayConfig.enabled })); }
    }
  }, [yipayConfig]);

  useEffect(() => {
    if (usdtConfig) {
      try {
        const parsed = JSON.parse(usdtConfig.config);
        setUsdt({ enabled: !!usdtConfig.enabled, ...parsed });
      } catch { setUsdt((p) => ({ ...p, enabled: !!usdtConfig.enabled })); }
    }
  }, [usdtConfig]);

  const saveConfig = async (channel: string, enabled: boolean, cfg: Record<string, unknown>) => {
    const res = await Network.post("/payment/config/save", {
      channel,
      config: JSON.stringify(cfg),
      enabled: enabled ? 1 : 0,
    });
    if (res.code === 0) {
      toast.success("保存成功");
      loadAll();
    } else {
      toast.error(res.msg || "保存失败");
    }
  };

  const handleTestOrder = async () => {
    if (!testProductId) { toast.error("请选择商品"); return; }
    setTestLoading(true);
    try {
      const createRes = await createOrder({ productId: Number(testProductId), payCurrency: testChannel });
      if (createRes.code !== 0) {
        toast.error(createRes.msg || "创建订单失败");
        return;
      }
      const payRes = await Network.post<{ payUrl: string; payAddress: string }>("/payment/pay", {
        order_id: createRes.data.orderId,
      });
      if (payRes.code === 0) {
        setCreatedPayUrl(payRes.data.payUrl || payRes.data.payAddress || "");
        toast.success("测试订单已创�?);
        loadAll();
      } else {
        toast.error(payRes.msg || "获取支付链接失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) return <PageLoadingState message="加载支付配置..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">支付配置</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">支付状�?/span>
              <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <p className={`text-xl font-bold ${yipay.enabled || usdt.enabled ? "text-green-600" : "text-gray-400"}`}>
              {yipay.enabled || usdt.enabled ? "已启�? : "未启�?}
            </p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">已收金额</span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-green-600">{fmtMoney(stats.paidAmount)} �?/p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">已支付订�?/span>
              <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-emerald-600">{stats.paidOrders}</p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">待支付订�?/span>
              <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                <svg className="w-4 h-4 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-orange-600">{stats.pendingOrders}</p>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {["basic", "yipay", "usdt", "test"].map((key) => {
          const labels: Record<string, string> = { basic: "基础设置", yipay: "易支�?, usdt: "USDT", test: "测试下单" };
          return (
            <Button key={key} size="sm" variant={tabKey === key ? "solid" : "flat"} color={tabKey === key ? "primary" : "default"} onPress={() => setTabKey(key)}>
              {labels[key]}
            </Button>
          );
        })}
      </div>

      {tabKey === "basic" && (
        <Card className="border border-gray-200 dark:border-default-200 shadow-md">
          <CardHeader><h2 className="font-semibold text-foreground">基础设置</h2></CardHeader>
          <CardBody className="p-4 space-y-4">
            <p className="text-sm text-default-600">支付配置用于商店购买；订单支付成功后按商品类型自动发放权益�?/p>
            <div className="text-xs text-default-500">
              回调地址依赖面板公网地址。当前使�?<code className="bg-default-100 dark:bg-default-800 px-1 rounded">{panelUrl}</code>，请在系统设置中填写外部可访问地址�?
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "yipay" && (
        <Card className="border border-gray-200 dark:border-default-200 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h2 className="font-semibold text-foreground">易支�?/h2>
              <Switch size="lg" isSelected={yipay.enabled} onValueChange={(v) => setYipay((p) => ({ ...p, enabled: v }))} />
            </div>
          </CardHeader>
          <CardBody className="p-4 space-y-4">
              <Input label={<span className="text-sm text-gray-400 text-foreground">网关地址</span>} value={yipay.gateway_url} variant="bordered"
                onChange={(e) => setYipay((p) => ({ ...p, gateway_url: e.target.value }))} />
              <Input label={<span className="text-sm text-gray-400 text-foreground">商户 PID</span>} value={yipay.pid} variant="bordered"
                onChange={(e) => setYipay((p) => ({ ...p, pid: e.target.value }))} />
              <Input label={<span className="text-sm text-gray-400 text-foreground">商户密钥</span>} value={yipay.key} variant="bordered" type="password"
                onChange={(e) => setYipay((p) => ({ ...p, key: e.target.value }))} />
              </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400 text-foreground mb-1 block">异步通知地址</label>
                <div className="h-10 flex items-center justify-between px-3 border border-default-200 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
                  <span className="truncate text-xs text-gray-600 dark:text-gray-400 mr-2">{panelUrl}/api/v1/payment/callback/yipay</span>
                  <Button size="sm" variant="flat" className="shrink-0" onPress={() => { navigator.clipboard.writeText(panelUrl + "/api/v1/payment/callback/yipay"); toast.success("已复�?); }}>复制</Button>
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-400 text-foreground mb-1 block">同步跳转地址</label>
                <div className="h-10 flex items-center justify-between px-3 border border-default-200 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
                  <span className="truncate text-xs text-gray-600 dark:text-gray-400 mr-2">{panelUrl}/shop</span>
                  <Button size="sm" variant="flat" className="shrink-0" onPress={() => { navigator.clipboard.writeText(panelUrl + "/shop"); toast.success("已复�?); }}>复制</Button>
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button color="primary" onPress={() => { const { enabled, ...rest } = yipay; saveConfig("YIPAY", enabled, rest); }}>保存易支付配�?/Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "usdt" && (
        <Card className="border border-gray-200 dark:border-default-200 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h2 className="font-semibold text-foreground">USDT</h2>
              <Switch size="lg" isSelected={usdt.enabled} onValueChange={(v) => setUsdt((p) => ({ ...p, enabled: v }))} />
            </div>
          </CardHeader>
          <CardBody className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400 text-foreground mb-1 block">网络</label>
                <Select variant="bordered" selectedKeys={[usdt.network]}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setUsdt((p) => ({ ...p, network: v })); }}>
                  <SelectItem key="trc20">TRC-20</SelectItem>
                  <SelectItem key="polygon">Polygon</SelectItem>
                </Select>
              </div>
              <div>
                <label className="text-sm text-gray-400 text-foreground mb-1 block">IPN 回调地址</label>
                <div className="h-10 flex items-center justify-between px-3 border border-default-200 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
                  <span className="truncate text-xs text-gray-600 dark:text-gray-400 mr-2">{panelUrl}/api/v1/payment/callback/usdt</span>
                  <Button size="sm" variant="flat" className="shrink-0" onPress={() => { navigator.clipboard.writeText(panelUrl + "/api/v1/payment/callback/usdt"); toast.success("已复�?); }}>复制</Button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block text-foreground">API Key</label>
                <Input variant="bordered" type="password" value={usdt.api_key}
                  onChange={(e) => setUsdt((p) => ({ ...p, api_key: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm text-gray-400 text-foreground mb-1 block">IPN Secret</label>
                <Input variant="bordered" type="password" value={usdt.ipn_secret}
                  onChange={(e) => setUsdt((p) => ({ ...p, ipn_secret: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button color="primary" onPress={() => { const { enabled, ...rest } = usdt; saveConfig("USDT", enabled, rest); }}>保存 USDT 配置</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "test" && (
        <Card className="border border-gray-200 dark:border-default-200 shadow-md">
          <CardHeader><h2 className="font-semibold text-foreground">测试下单</h2></CardHeader>
          <CardBody className="p-4 space-y-4">
            <p className="text-sm text-gray-400">创建一笔真实支付订单，检查支付接口配置是否正常�?/p>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm text-gray-400 mb-1 block text-foreground">商品</label>
                <Select variant="bordered" selectedKeys={testProductId ? [testProductId] : []}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setTestProductId(v); }}>
                  {products.filter((p) => p.status === 1).map((p) => (
                    <SelectItem key={String(p.id)}>{(p.price / 100).toFixed(2)}�?{p.name}</SelectItem>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-sm text-gray-400 mb-1 block text-foreground">支付方式</label>
                <Select variant="bordered" selectedKeys={[testChannel]}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setTestChannel(v); }}>
                  <SelectItem key="YIPAY">易支�?/SelectItem>
                  <SelectItem key="USDT">USDT</SelectItem>
                </Select>
              </div>
              <Button color="primary" isLoading={testLoading} onPress={handleTestOrder}>创建订单</Button>
            </div>
            {createdPayUrl && (
              <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 p-3">
                <div className="text-xs text-gray-400 text-foreground mb-1">支付链接</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs">{createdPayUrl}</code>
                  <Button size="sm" variant="flat" onPress={() => window.open(createdPayUrl, "_blank")}>打开</Button>
                  <Button size="sm" variant="flat" onPress={() => { navigator.clipboard.writeText(createdPayUrl); toast.success("已复�?); }}>复制</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </AnimatedPage>
  );
}
