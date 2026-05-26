import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { PageLoadingState } from "@/components/page-state";
import Network from "@/api/network";
import type { OrderApiItem, ProductApiItem } from "@/api/types";
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
  api_key: "",
  ipn_secret: "",
};

function fmtMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatDate(ts: number) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

const statusMap: Record<number, { label: string; color: "warning" | "success" | "default" | "danger" }> = {
  0: { label: "待支付", color: "warning" },
  1: { label: "已支付", color: "success" },
  2: { label: "已取消", color: "default" },
  3: { label: "已退款", color: "danger" },
};

export default function AdminPaymentPage() {
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<PaymentConfig[]>([]);
  const [stats, setStats] = useState<PaymentStats>({ paidAmount: 0, paidOrders: 0, pendingOrders: 0 });
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
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
      const [configRes, statsRes, ordersRes, productRes] = await Promise.all([
        Network.post<PaymentConfig[]>("/payment/config/admin/list"),
        Network.post<PaymentStats>("/payment/stats"),
        Network.post<{ list: OrderApiItem[]; total: number }>("/order/admin/list", { page: 1, size: 100 }),
        Network.post<ProductApiItem[]>("/product/list"),
      ]);
      if (configRes.code === 0) setConfigs(Array.isArray(configRes.data) ? configRes.data : []);
      if (statsRes.code === 0) setStats(statsRes.data);
      if (ordersRes.code === 0) setOrders(ordersRes.data?.list || []);
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
        toast.success("测试订单已创建");
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">支付状态</div>
            <div className="text-2xl font-semibold">
              {yipay.enabled || usdt.enabled ? "已启用" : "未启用"}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">已收金额</div>
            <div className="text-2xl font-semibold text-green-600">{fmtMoney(stats.paidAmount)} 元</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">已支付订单</div>
            <div className="text-2xl font-semibold">{stats.paidOrders}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">待支付订单</div>
            <div className="text-2xl font-semibold text-yellow-600">{stats.pendingOrders}</div>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {["basic", "yipay", "usdt", "test", "orders"].map((key) => {
          const labels: Record<string, string> = { basic: "基础设置", yipay: "易支付", usdt: "USDT", test: "测试下单", orders: "订单记录" };
          return (
            <Button key={key} size="sm" variant={tabKey === key ? "solid" : "flat"} color={tabKey === key ? "primary" : "default"} onPress={() => setTabKey(key)}>
              {labels[key]}
            </Button>
          );
        })}
      </div>

      {tabKey === "basic" && (
        <Card>
          <CardHeader><h2 className="font-medium">基础设置</h2></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-gray-400">支付配置用于商店购买；订单支付成功后按商品类型自动发放权益。</p>
            <div className="text-xs text-gray-400 mb-2">
              回调地址需先面板公网地址。当前使用 <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{panelUrl}</code>
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "yipay" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h2 className="font-medium">易支付</h2>
              <Switch isSelected={yipay.enabled} onValueChange={(v) => setYipay((p) => ({ ...p, enabled: v }))} />
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input label="网关地址" value={yipay.gateway_url} variant="bordered"
              onChange={(e) => setYipay((p) => ({ ...p, gateway_url: e.target.value }))} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="商户 PID" value={yipay.pid} variant="bordered"
                onChange={(e) => setYipay((p) => ({ ...p, pid: e.target.value }))} />
              <Input label="商户密钥" value={yipay.key} variant="bordered" type="password"
                onChange={(e) => setYipay((p) => ({ ...p, key: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 px-3 py-2">
                <div className="text-xs text-gray-400 mb-1">异步通知地址</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs">{panelUrl}/api/v1/payment/callback/yipay</code>
                  <Button size="sm" variant="flat" onPress={() => { navigator.clipboard.writeText(panelUrl + "/api/v1/payment/callback/yipay"); toast.success("已复制"); }}>复制</Button>
                </div>
              </div>
              <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 px-3 py-2">
                <div className="text-xs text-gray-400 mb-1">同步跳转地址</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs">{panelUrl}/shop</code>
                  <Button size="sm" variant="flat" onPress={() => { navigator.clipboard.writeText(panelUrl + "/shop"); toast.success("已复制"); }}>复制</Button>
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button color="primary" onPress={() => { const { enabled, ...rest } = yipay; saveConfig("YIPAY", enabled, rest); }}>保存易支付配置</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "usdt" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h2 className="font-medium">USDT (TRC-20)</h2>
              <Switch isSelected={usdt.enabled} onValueChange={(v) => setUsdt((p) => ({ ...p, enabled: v }))} />
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input label="API Key" value={usdt.api_key} variant="bordered" type="password"
              onChange={(e) => setUsdt((p) => ({ ...p, api_key: e.target.value }))} />
            <Input label="IPN Secret" value={usdt.ipn_secret} variant="bordered" type="password"
              onChange={(e) => setUsdt((p) => ({ ...p, ipn_secret: e.target.value }))} />
            <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 px-3 py-2">
              <div className="text-xs text-gray-400 mb-1">IPN 回调地址</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate text-xs">{panelUrl}/api/v1/payment/callback/usdt</code>
                <Button size="sm" variant="flat" onPress={() => { navigator.clipboard.writeText(panelUrl + "/api/v1/payment/callback/usdt"); toast.success("已复制"); }}>复制</Button>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button color="primary" onPress={() => { const { enabled, ...rest } = usdt; saveConfig("USDT", enabled, rest); }}>保存 USDT 配置</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {tabKey === "test" && (
        <Card>
          <CardHeader><h2 className="font-medium">测试下单</h2></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-gray-400">创建一笔真实支付订单，检查支付接口配置是否正常。</p>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm text-gray-400 mb-1 block">商品</label>
                <Select variant="bordered" selectedKeys={testProductId ? [testProductId] : []}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setTestProductId(v); }}>
                  {products.filter((p) => p.status === 1).map((p) => (
                    <SelectItem key={String(p.id)}>{(p.price / 100).toFixed(2)}元 {p.name}</SelectItem>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-sm text-gray-400 mb-1 block">支付方式</label>
                <Select variant="bordered" selectedKeys={[testChannel]}
                  onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string; if (v) setTestChannel(v); }}>
                  <SelectItem key="YIPAY">易支付</SelectItem>
                  <SelectItem key="USDT">USDT</SelectItem>
                </Select>
              </div>
              <Button color="primary" isLoading={testLoading} onPress={handleTestOrder}>创建订单</Button>
            </div>
            {createdPayUrl && (
              <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 p-3">
                <div className="text-xs text-gray-400 mb-1">支付链接</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs">{createdPayUrl}</code>
                  <Button size="sm" variant="flat" onPress={() => window.open(createdPayUrl, "_blank")}>打开</Button>
                  <Button size="sm" variant="flat" onPress={() => { navigator.clipboard.writeText(createdPayUrl); toast.success("已复制"); }}>复制</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tabKey === "orders" && (
        <Card>
          <CardHeader><h2 className="font-medium">订单记录</h2></CardHeader>
          <CardBody>
            <Table>
              <TableHeader>
                <TableColumn>订单号</TableColumn>
                <TableColumn>用户</TableColumn>
                <TableColumn>商品</TableColumn>
                <TableColumn>金额</TableColumn>
                <TableColumn>支付方式</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn>时间</TableColumn>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-400 py-8">暂无订单</TableCell>
                  </TableRow>
                ) : orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                    <TableCell>{o.userName}</TableCell>
                    <TableCell>{o.productName || "-"}</TableCell>
                    <TableCell className="font-mono">{fmtMoney(o.amount)} 元</TableCell>
                    <TableCell>{o.payCurrency}</TableCell>
                    <TableCell>
                      <Chip color={statusMap[o.status]?.color || "default"} size="sm">
                        {statusMap[o.status]?.label || o.status}
                      </Chip>
                    </TableCell>
                    <TableCell>{formatDate(o.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </AnimatedPage>
  );
}
