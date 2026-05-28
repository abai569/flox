import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { getOrderList, payOrder, cancelOrder } from "@/api";
import type { OrderApiItem } from "@/api/types";
import Network from "@/api/network";
import { PageLoadingState } from "@/components/page-state";

const statusMap: Record<number, { label: string; color: "warning" | "success" | "default" | "danger" }> = {
  0: { label: "待支付", color: "warning" },
  1: { label: "已完成", color: "success" },
  2: { label: "已取消", color: "default" },
  3: { label: "已退款", color: "danger" },
};

const currencyLabel: Record<string, string> = {
  BALANCE: "余额", USDT: "USDT", YIPAY: "易支付",
};

export default function MyHomePage() {
  const navigate = useNavigate();
  const [pageLoading, setPageLoading] = useState(true);
  const [subData, setSubData] = useState<{
    subscription: { id: number; packageId: number; startAt: number; expireAt: number; autoRenew: number; status: number } | null;
    package: { id: number; name: string; description: string; trafficLimit: number; /* portCount: number; */ speedLimit: number; maxRules: number; maxConnections: number; /* maxIPAccess: number; */ } | null;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("-1");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderApiItem | null>(null);
  const [payResult, setPayResult] = useState<{ payUrl: string; payAddress: string; payAmount: string } | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderApiItem | null>(null);

  const loadData = useCallback(async () => {
    if (!isFirstLoad.current) setRefreshing(true);
    try {
      const [orderRes, subRes] = await Promise.all([
        getOrderList({ page, size: 10, status: parseInt(statusFilter) }),
        Network.post<{
          subscription: { id: number; packageId: number; startAt: number; expireAt: number; autoRenew: number; status: number } | null;
          package: { id: number; name: string; description: string; trafficLimit: number; /* portCount: number; */ speedLimit: number; maxRules: number; maxConnections: number; /* maxIPAccess: number; */ } | null;
        }>("/user/my-subscription"),
      ]);
      if (orderRes.code === 0) {
        setOrders(orderRes.data.list || []);
        setTotal(orderRes.data.total || 0);
      } else {
        toast.error(orderRes.msg || "获取订单失败");
      }
      if (subRes.code === 0) {
        setSubData(subRes.data);
      }
    } catch {
      toast.error("获取数据失败");
    } finally {
      setPageLoading(false);
      setRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [page, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setRefreshing(true);
    (async () => {
      const [orderRes, subRes] = await Promise.all([
        getOrderList({ page, size: 10, status: parseInt(statusFilter) }),
        Network.post<{
          subscription: { id: number; packageId: number; startAt: number; expireAt: number; autoRenew: number; status: number } | null;
          package: { id: number; name: string; description: string; trafficLimit: number; /* portCount: number; */ speedLimit: number; maxRules: number; maxConnections: number; /* maxIPAccess: number; */ } | null;
        }>("/user/my-subscription"),
      ]);
      if (orderRes.code === 0) { setOrders(orderRes.data.list || []); setTotal(orderRes.data.total || 0); }
      if (subRes.code === 0) { setSubData(subRes.data); }
      setRefreshing(false);
    })();
  }, [statusFilter]);

  const handlePay = async (order: OrderApiItem) => {
    setCurrentOrder(order); setPayResult(null); setPayLoading(true);
    try {
      const res = await payOrder(order.id);
      if (res.code === 0) { setPayResult(res.data); setPayModalOpen(true); }
      else toast.error(res.msg || "获取支付信息失败");
    } catch { toast.error("网络错误"); }
    finally { setPayLoading(false); }
  };

  const handleCancel = async (id: number) => {
    try {
      const res = await cancelOrder(id);
      if (res.code === 0) { toast.success("已取消"); loadData(); }
      else toast.error(res.msg || "取消失败");
    } catch { toast.error("网络错误"); }
  };

  if (pageLoading) return <PageLoadingState message="加载中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">我的</h1>

      {subData?.subscription ? (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">套餐详情</h2>
          <Card>
          <CardHeader>
            <div className="flex justify-between items-center w-full">
              <span className="font-medium text-lg">{subData.package?.name || "未知套餐"}</span>
              <Chip color="success" size="sm" variant="flat">生效中</Chip>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-default-400">有效期</span>
                <p className="font-medium">
                  {subData.subscription.startAt > 0 ? new Date(subData.subscription.startAt).toLocaleDateString() : "-"}
                  {" ~ "}
                  {subData.subscription.expireAt > 0 ? new Date(subData.subscription.expireAt).toLocaleDateString() : "-"}
                </p>
              </div>
              <div>
                <span className="text-default-400">剩余</span>
                <p className="font-medium">
                  {subData.subscription.expireAt > 0
                    ? Math.max(0, Math.ceil((subData.subscription.expireAt - Date.now()) / 86400000)) : "-"} 天
                </p>
              </div>
              <div>
                <span className="text-default-400">流量</span>
                <p className="font-medium">{subData.package!.trafficLimit > 0 ? `${subData.package!.trafficLimit} GB` : "不限"}</p>
              </div>
              {/* <div>
                <span className="text-default-400">端口</span>
                <p className="font-medium">{subData.package!.portCount > 0 ? subData.package!.portCount : "不限"}</p>
              </div> */}
              <div>
                <span className="text-default-400">限速</span>
                <p className="font-medium">{subData.package!.speedLimit > 0 ? `${subData.package!.speedLimit} Mbps` : "不限"}</p>
              </div>
              <div>
                <span className="text-default-400">规则/连接</span>
                <p className="font-medium">
                  {subData.package!.maxRules > 0 ? subData.package!.maxRules : "∞"} /
                  {subData.package!.maxConnections > 0 ? subData.package!.maxConnections : "∞"}
                  {/* {subData.package!.maxIPAccess > 0 ? subData.package!.maxIPAccess : "∞"} */}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
        </section>
      ) : (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">套餐详情</h2>
          <Card>
          <CardBody className="text-center py-8">
            <p className="text-default-500 mb-3">暂无有效套餐</p>
            <Button color="primary" variant="flat" onPress={() => navigate("/shop")}>前往商城购买</Button>
          </CardBody>
        </Card>
        </section>
      )}

      <h2 className="text-lg font-semibold mb-3">订单记录</h2>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {["-1", "0", "1", "2", "3"].map((key) => {
            const labels: Record<string, string> = { "-1": "全部", "0": "待支付", "1": "已完成", "2": "已取消", "3": "已退款" };
            return (
              <Button key={key} size="sm" variant={statusFilter === key ? "solid" : "flat"}
                color={statusFilter === key ? "primary" : "default"}
                onPress={() => { setStatusFilter(key); setPage(1); }}>
                {labels[key]}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
        {refreshing && (
          <div className="absolute inset-0 bg-white/60 dark:bg-black/40 z-10 flex items-center justify-center">
            <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        <Table classNames={{ th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle", td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0", tr: "hover:bg-default-50/50 transition-colors" }}>
          <TableHeader>
            <TableColumn className="whitespace-nowrap">订单号</TableColumn>
            <TableColumn className="whitespace-nowrap">商品</TableColumn>
            <TableColumn className="whitespace-nowrap">金额</TableColumn>
            <TableColumn className="whitespace-nowrap">支付方式</TableColumn>
            <TableColumn className="whitespace-nowrap">状态</TableColumn>
            <TableColumn className="whitespace-nowrap">时间</TableColumn>
            <TableColumn className="whitespace-nowrap">操作</TableColumn>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-default-400 py-8">暂无订单</TableCell></TableRow>
            ) : orders.map((order) => {
              const st = statusMap[order.status] || { label: "未知", color: "default" };
              return (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.orderNo}</TableCell>
                  <TableCell>{order.productName}</TableCell>
                  <TableCell>{(order.amount / 100).toFixed(2)} 元</TableCell>
                  <TableCell>{currencyLabel[order.payCurrency] || order.payCurrency}</TableCell>
                  <TableCell>
                    <Chip color={st.color} size="sm">{st.label}</Chip>
                  </TableCell>
                  <TableCell className="text-xs text-gray-400">
                    {order.createdAt ? new Date(order.createdAt * 1000).toLocaleString() : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="flat" onPress={() => { setDetailOrder(order); setDetailModalOpen(true); }}>
                        详情
                      </Button>
                      {order.status === 0 && order.payCurrency !== "BALANCE" && (
                        <>
                          <Button size="sm" color="primary" variant="flat"
                            isLoading={payLoading && currentOrder?.id === order.id}
                            onPress={() => handlePay(order)}>
                            去支付
                          </Button>
                          <Button size="sm" color="danger" variant="flat" onPress={() => handleCancel(order.id)}>
                            取消
                          </Button>
                        </>
                      )}
                      {order.status === 0 && order.payCurrency === "BALANCE" && (
                        <span className="text-xs text-gray-400">处理中</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {total > 10 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button size="sm" variant="flat" isDisabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <span className="flex items-center text-sm text-gray-400">
            {page} / {Math.ceil(total / 10)}
          </span>
          <Button size="sm" variant="flat" isDisabled={page >= Math.ceil(total / 10)} onPress={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      )}

      <Modal isOpen={payModalOpen} placement="center" size="2xl"
        onOpenChange={(open) => { if (!open) { setPayModalOpen(false); setPayResult(null); } }}>
        <ModalContent>
          <ModalHeader>去支付</ModalHeader>
          <ModalBody>
            {payResult?.payUrl ? (
              <div>
                <p className="mb-2">点击下方按钮跳转支付：</p>
                <Button color="primary" className="w-full" onPress={() => window.open(payResult.payUrl, "_blank")}>
                  前去支付
                </Button>
              </div>
            ) : null}
            {payResult?.payAddress ? (
              <div>
                <p className="mb-2">请向以下地址转账 USDT (TRC-20)：</p>
                <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-sm break-all font-mono">
                  {payResult.payAddress}
                </div>
                {payResult.payAmount ? (
                  <p className="mt-2 text-sm">金额: <strong>{payResult.payAmount} USDT</strong></p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-gray-400 mt-2">支付完成后页面会自动更新状态</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setPayModalOpen(false); setPayResult(null); loadData(); }}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={detailModalOpen} placement="center" size="2xl"
        onOpenChange={(open) => { if (!open) { setDetailModalOpen(false); setDetailOrder(null); } }}>
        <ModalContent>
          <ModalHeader>订单详情</ModalHeader>
          <ModalBody>
            {detailOrder && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">订单号</span><span className="font-mono">{detailOrder.orderNo}</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">商品</span><span>{detailOrder.productName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">金额</span><span>{(detailOrder.amount / 100).toFixed(2)} 元</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">支付方式</span><span>{currencyLabel[detailOrder.payCurrency] || detailOrder.payCurrency}</span></div>
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">状态</span><Chip color={statusMap[detailOrder.status]?.color || "default"} size="sm">{statusMap[detailOrder.status]?.label || "未知"}</Chip></div>
                {detailOrder.payTime > 0 && (
                  <div className="flex justify-between"><span className="text-gray-400 text-foreground">支付时间</span><span>{new Date(detailOrder.payTime * 1000).toLocaleString()}</span></div>
                )}
                {detailOrder.payAddress && (
                  <div className="flex justify-between"><span className="text-gray-400 text-foreground">USDT 地址</span><span className="font-mono text-xs max-w-[200px] break-all text-right">{detailOrder.payAddress}</span></div>
                )}
                {detailOrder.txHash && (
                  <div className="flex justify-between"><span className="text-gray-400 text-foreground">交易哈希</span><span className="font-mono text-xs max-w-[200px] break-all text-right">{detailOrder.txHash}</span></div>
                )}
                <div className="flex justify-between"><span className="text-gray-400 text-foreground">创建时间</span><span>{detailOrder.createdAt ? new Date(detailOrder.createdAt * 1000).toLocaleString() : "-"}</span></div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setDetailModalOpen(false); setDetailOrder(null); }}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
