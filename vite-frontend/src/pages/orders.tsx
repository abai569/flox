import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  getOrderList,
  cancelOrder,
  payOrder,
} from "@/api";
import type { OrderApiItem } from "@/api/types";
import { PageLoadingState } from "@/components/page-state";

const statusMap: Record<number, { label: string; color: "warning" | "success" | "default" | "danger" }> = {
  0: { label: "待支付", color: "warning" },
  1: { label: "已完成", color: "success" },
  2: { label: "已取消", color: "default" },
  3: { label: "已退款", color: "danger" },
};

const currencyLabel: Record<string, string> = {
  BALANCE: "余额",
  USDT: "USDT",
  YIPAY: "易支付",
};

export default function OrdersPage() {
  const [loading, setLoading] = useState(true);
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
      const res = await getOrderList({ page, size: 10, status: parseInt(statusFilter) });
      if (res.code === 0) {
        setOrders(res.data.list || []);
        setTotal(res.data.total || 0);
      } else {
        toast.error(res.msg || "获取订单失败");
      }
    } catch {
      toast.error("获取订单失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [page, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // Silent refresh on status change
  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setRefreshing(true);
    (async () => {
      const res = await getOrderList({ page, size: 10, status: parseInt(statusFilter) });
      if (res.code === 0) {
        setOrders(res.data.list || []);
        setTotal(res.data.total || 0);
      }
      setRefreshing(false);
    })();
  }, [statusFilter]);

  const handleStatusChange = (val: string) => {
    if (val) { setStatusFilter(val); setPage(1); }
  };

  const handlePay = async (order: OrderApiItem) => {
    setCurrentOrder(order);
    setPayResult(null);
    setPayLoading(true);
    try {
      const res = await payOrder(order.id);
      if (res.code === 0) {
        setPayResult(res.data);
        setPayModalOpen(true);
      } else {
        toast.error(res.msg || "获取支付信息失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setPayLoading(false);
    }
  };

  const handleCancel = async (id: number) => {
    try {
      const res = await cancelOrder(id);
      if (res.code === 0) {
        toast.success("已取消");
        loadData();
      } else {
        toast.error(res.msg || "取消失败");
      }
    } catch {
      toast.error("网络错误");
    }
  };

  const handleViewDetail = (order: OrderApiItem) => {
    setDetailOrder(order);
    setDetailModalOpen(true);
  };

  if (loading) return <PageLoadingState message="加载订单中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">我的订单</h1>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {["-1", "0", "1", "2", "3"].map((key) => {
            const labels: Record<string, string> = { "-1": "全部", "0": "待支付", "1": "已完成", "2": "已取消", "3": "已退款" };
            return (
              <Button key={key} size="sm" variant={statusFilter === key ? "solid" : "flat"}
                color={statusFilter === key ? "primary" : "default"}
                onPress={() => handleStatusChange(key)}>
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
                      <Button size="sm" variant="flat" onPress={() => handleViewDetail(order)}>
                        详情
                      </Button>
                      {order.status === 0 && order.payCurrency !== "BALANCE" && (
                        <>
                          <Button size="sm" color="primary" variant="flat"
                            isLoading={payLoading && currentOrder?.id === order.id}
                            onPress={() => handlePay(order)}>
                            去支付
                          </Button>
                          <Button size="sm" color="danger" variant="flat"
                            onPress={() => handleCancel(order.id)}>
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
          <Button size="sm" variant="flat" isDisabled={page <= 1}
            onPress={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <span className="flex items-center text-sm text-gray-400">
            {page} / {Math.ceil(total / 10)}
          </span>
          <Button size="sm" variant="flat"
            isDisabled={page >= Math.ceil(total / 10)}
            onPress={() => setPage((p) => p + 1)}>
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
                  <p className="mt-2 text-sm">
                    金额: <strong>{payResult.payAmount} USDT</strong>
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-gray-400 mt-2">
              支付完成后页面会自动更新状态
            </p>
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
