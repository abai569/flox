import { useState, useEffect, useCallback } from "react";
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
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderApiItem | null>(null);
  const [payResult, setPayResult] = useState<{ payUrl: string; payAddress: string; payAmount: string } | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrderList({ page, size: 10 });
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
    }
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

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

  if (loading) return <PageLoadingState message="加载订单中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">我的订单</h1>

      <Table>
        <TableHeader>
          <TableColumn>订单号</TableColumn>
          <TableColumn>商品</TableColumn>
          <TableColumn>金额</TableColumn>
          <TableColumn>支付方式</TableColumn>
          <TableColumn>状态</TableColumn>
          <TableColumn>时间</TableColumn>
          <TableColumn>操作</TableColumn>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
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
    </AnimatedPage>
  );
}
