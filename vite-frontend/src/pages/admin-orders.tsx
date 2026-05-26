import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/shadcn-bridge/heroui/button";
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
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { getAdminOrderList } from "@/api";
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

export default function AdminOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("-1");
  const [keyword, setKeyword] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderApiItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminOrderList({
        page,
        size: 10,
        status: parseInt(statusFilter),
        keyword,
      });
      if (res.code === 0) {
        setOrders(res.data.list || []);
        setTotal(res.data.total || 0);
      } else {
        toast.error(res.msg || "获取订单列表失败");
      }
    } catch {
      toast.error("获取订单列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, keyword]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleViewDetail = (order: OrderApiItem) => {
    setDetailOrder(order);
    setDetailModalOpen(true);
  };

  if (loading) return <PageLoadingState message="加载订单中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">订单管理</h1>
        <div className="flex gap-2 items-center">
          <Select
            label="状态"
            variant="bordered"
            size="sm"
            selectedKeys={[statusFilter]}
            className="w-32"
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              if (val) { setStatusFilter(val); setPage(1); }
            }}
          >
            <SelectItem key="-1">全部</SelectItem>
            <SelectItem key="0">待支付</SelectItem>
            <SelectItem key="1">已完成</SelectItem>
            <SelectItem key="2">已取消</SelectItem>
          </Select>
          <SearchBar
            isVisible={isSearchVisible}
            placeholder="搜索订单号/用户..."
            value={keyword}
            onChange={setKeyword}
            onClose={() => { setIsSearchVisible(false); setKeyword(""); setPage(1); }}
            onOpen={() => setIsSearchVisible(true)}
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableColumn>订单号</TableColumn>
          <TableColumn>用户</TableColumn>
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
                <TableCell>{order.userName}</TableCell>
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
                  <Button size="sm" variant="flat" onPress={() => handleViewDetail(order)}>
                    详情
                  </Button>
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

      <Modal isOpen={detailModalOpen} placement="center" size="2xl"
        onOpenChange={(open) => { if (!open) { setDetailModalOpen(false); setDetailOrder(null); } }}>
        <ModalContent>
          <ModalHeader>订单详情</ModalHeader>
          <ModalBody>
            {detailOrder && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">订单号</span><span className="font-mono">{detailOrder.orderNo}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">用户</span><span>{detailOrder.userName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">商品</span><span>{detailOrder.productName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">金额</span><span>{(detailOrder.amount / 100).toFixed(2)} 元</span></div>
                <div className="flex justify-between"><span className="text-gray-400">支付方式</span><span>{currencyLabel[detailOrder.payCurrency] || detailOrder.payCurrency}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">状态</span><Chip color={statusMap[detailOrder.status]?.color || "default"} size="sm">{statusMap[detailOrder.status]?.label || "未知"}</Chip></div>
                {detailOrder.payTime > 0 && (
                  <div className="flex justify-between"><span className="text-gray-400">支付时间</span><span>{new Date(detailOrder.payTime * 1000).toLocaleString()}</span></div>
                )}
                {detailOrder.payAddress && (
                  <div className="flex justify-between"><span className="text-gray-400">USDT 地址</span><span className="font-mono text-xs max-w-[200px] break-all text-right">{detailOrder.payAddress}</span></div>
                )}
                {detailOrder.txHash && (
                  <div className="flex justify-between"><span className="text-gray-400">交易哈希</span><span className="font-mono text-xs max-w-[200px] break-all text-right">{detailOrder.txHash}</span></div>
                )}
                <div className="flex justify-between"><span className="text-gray-400">创建时间</span><span>{detailOrder.createdAt ? new Date(detailOrder.createdAt * 1000).toLocaleString() : "-"}</span></div>
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
