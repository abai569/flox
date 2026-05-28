import type { OrderApiItem, UserApiItem } from "@/api/types";

import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
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
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  getAdminOrderList,
  getAllUsers,
  getPaymentStats,
  deleteOrder,
  updateOrder,
} from "@/api";
import { PageLoadingState } from "@/components/page-state";

const statusMap: Record<
  number,
  { label: string; color: "warning" | "success" | "default" | "danger" }
> = {
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

function fmtMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function AdminOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(
    () => localStorage.getItem("adminOrderStatus") || "-1",
  );
  const [keyword, setKeyword] = useState("");
  const [userFilter, setUserFilter] = useState<string>(
    () => localStorage.getItem("adminOrderUserFilter") || "all",
  );
  const [users, setUsers] = useState<UserApiItem[]>([]);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderApiItem | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderApiItem | null>(null);
  const [editForm, setEditForm] = useState({
    status: "",
    amount: "",
    productName: "",
    payCurrency: "",
  });
  const [stats, setStats] = useState({
    paidAmount: 0,
    paidOrders: 0,
    pendingOrders: 0,
  });

  const loadData = useCallback(async () => {
    if (!isFirstLoad.current) setRefreshing(true);
    try {
      const [orderRes, statsRes] = await Promise.all([
        getAdminOrderList({
          page,
          size: 10,
          status: parseInt(statusFilter),
          keyword,
          userId: userFilter !== "all" ? Number(userFilter) : undefined,
        }),
        getPaymentStats(),
      ]);

      if (orderRes.code === 0) {
        setOrders(orderRes.data.list || []);
        setTotal(orderRes.data.total || 0);
      } else {
        toast.error(orderRes.msg || "获取订单列表失败");
      }
      if (statsRes.code === 0) {
        setStats({
          paidAmount: statsRes.data.paidAmount || 0,
          paidOrders: statsRes.data.paidOrders || 0,
          pendingOrders: statsRes.data.pendingOrders || 0,
        });
      }
    } catch {
      toast.error("获取订单列表失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [page, statusFilter, keyword]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    getAllUsers({ size: 1000 }).then((res) => {
      if (res.code === 0) setUsers(Array.isArray(res.data) ? res.data : []);
    });
  }, []);

  // Silent refresh on filter change
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;

      return;
    }
    setRefreshing(true);
    (async () => {
      const res = await getAdminOrderList({
        page,
        size: 10,
        status: parseInt(statusFilter),
        keyword,
        userId: userFilter !== "all" ? Number(userFilter) : undefined,
      });

      if (res.code === 0) {
        setOrders(res.data.list || []);
        setTotal(res.data.total || 0);
      }
      setRefreshing(false);
    })();
  }, [statusFilter, keyword, userFilter]);

  // Override status change to reset page
  const handleStatusChange = (val: string) => {
    if (val) {
      setStatusFilter(val);
      localStorage.setItem("adminOrderStatus", val);
      setPage(1);
    }
  };

  const handleSearch = (val: string) => {
    setKeyword(val);
    setPage(1);
  };

  const handleCloseSearch = () => {
    setIsSearchVisible(false);
    setKeyword("");
    setPage(1);
  };

  const handleViewDetail = (order: OrderApiItem) => {
    setDetailOrder(order);
    setDetailModalOpen(true);
  };

  const handleDeleteOrder = async (order: OrderApiItem) => {
    const force = order.status === 1;
    const msg = force
      ? `确定强制删除已完成订单 ${order.orderNo}？（不会退还余额）`
      : `确定删除订单 ${order.orderNo}？`;

    if (!confirm(msg)) return;
    const res = await deleteOrder(order.id, force);

    if (res.code === 0) {
      toast.success("删除成功");
      loadData();
    } else {
      toast.error(res.msg || "删除失败");
    }
  };

  const handleOpenEdit = (order: OrderApiItem) => {
    setEditOrder(order);
    setEditForm({
      status: String(order.status),
      amount: String(order.amount / 100),
      productName: order.productName,
      payCurrency: order.payCurrency,
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editOrder) return;
    const updates: Record<string, unknown> = { id: editOrder.id };
    const newStatus = parseInt(editForm.status);

    if (!isNaN(newStatus) && newStatus !== editOrder.status)
      updates.status = newStatus;
    const newAmount = Math.round(parseFloat(editForm.amount) * 100);

    if (!isNaN(newAmount) && newAmount !== editOrder.amount)
      updates.amount = newAmount;
    if (editForm.productName !== editOrder.productName)
      updates.productName = editForm.productName;
    if (editForm.payCurrency !== editOrder.payCurrency)
      updates.payCurrency = editForm.payCurrency;
    if (Object.keys(updates).length <= 1) {
      toast.error("无更改");

      return;
    }
    const res = await updateOrder(updates);

    if (res.code === 0) {
      toast.success("保存成功");
      setEditModalOpen(false);
      loadData();
    } else {
      toast.error(res.msg || "保存失败");
    }
  };

  if (loading) return <PageLoadingState message="加载订单中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">订单管理</h1>
        <SearchBar
          isVisible={isSearchVisible}
          placeholder="搜索订单号/用户..."
          value={keyword}
          onChange={handleSearch}
          onClose={handleCloseSearch}
          onOpen={() => setIsSearchVisible(true)}
        />
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">已收金额</span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                <svg
                  className="w-4 h-4 text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                  <path
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C11.398 6.234 16 2.991 10 18zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 000 0z"
                    fillRule="evenodd"
                  />
                  <path
                    clipRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-green-600">
              {fmtMoney(stats.paidAmount)} 元
            </p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">已支付订单</span>
              <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                <svg
                  className="w-4 h-4 text-emerald-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    clipRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-emerald-600">
              {stats.paidOrders}
            </p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">待支付订单</span>
              <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                <svg
                  className="w-4 h-4 text-orange-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    clipRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-orange-600">
              {stats.pendingOrders}
            </p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">总订单数</span>
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-500/20">
                <svg
                  className="w-4 h-4 text-purple-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path
                    clipRule="evenodd"
                    d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-purple-600">{total}</p>
          </CardBody>
        </Card>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {["-1", "0", "1", "2", "3"].map((key) => {
            const labels: Record<string, string> = {
              "-1": "全部",
              "0": "待支付",
              "1": "已完成",
              "2": "已取消",
              "3": "已退款",
            };

            return (
              <Button
                key={key}
                color={statusFilter === key ? "primary" : "default"}
                size="sm"
                variant={statusFilter === key ? "solid" : "flat"}
                onPress={() => handleStatusChange(key)}
              >
                {labels[key]}
              </Button>
            );
          })}
        </div>
        <div className="ml-auto">
          <Select
            className="w-36"
            size="sm"
            variant="bordered"
            selectedKeys={userFilter === "all" ? ["all"] : [userFilter]}
            //placeholder="全部用户"
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;

              setUserFilter(val || "all");
              localStorage.setItem("adminOrderUserFilter", val || "all");
              setPage(1);
            }}
          >
            <SelectItem key="all">全部用户</SelectItem>
            {users.map((u) => (
              <SelectItem key={String(u.id)}>
                {u.name || u.user || `#${u.id}`}
              </SelectItem>
            ))}
          </Select>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
        {refreshing && (
          <div className="absolute inset-0 bg-white/60 dark:bg-black/40 z-10 flex items-center justify-center">
            <svg
              className="animate-spin h-6 w-6 text-primary"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                fill="currentColor"
              />
            </svg>
          </div>
        )}
        <Table
          classNames={{
            th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
            td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
            tr: "hover:bg-default-50/50 transition-colors",
          }}
        >
          <TableHeader>
            <TableColumn className="whitespace-nowrap">订单号</TableColumn>
            <TableColumn className="whitespace-nowrap">用户</TableColumn>
            <TableColumn className="whitespace-nowrap">商品</TableColumn>
            <TableColumn className="whitespace-nowrap">金额</TableColumn>
            <TableColumn className="whitespace-nowrap">支付方式</TableColumn>
            <TableColumn className="whitespace-nowrap">状态</TableColumn>
            <TableColumn className="whitespace-nowrap">时间</TableColumn>
            <TableColumn className="whitespace-nowrap">操作</TableColumn>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell
                  className="text-center text-default-400 py-8"
                  colSpan={8}
                >
                  暂无订单
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const st = statusMap[order.status] || {
                  label: "未知",
                  color: "default",
                };

                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">
                      {order.orderNo}
                    </TableCell>
                    <TableCell>{order.userName}</TableCell>
                    <TableCell>{order.productName}</TableCell>
                    <TableCell>{(order.amount / 100).toFixed(2)} 元</TableCell>
                    <TableCell>
                      {currencyLabel[order.payCurrency] || order.payCurrency}
                    </TableCell>
                    <TableCell>
                      <Chip color={st.color} size="sm">
                        {st.label}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-xs text-gray-400">
                      {order.createdAt
                        ? new Date(order.createdAt * 1000).toLocaleString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => handleViewDetail(order)}
                        >
                          详情
                        </Button>
                        <Button
                          color="warning"
                          size="sm"
                          variant="flat"
                          onPress={() => handleOpenEdit(order)}
                        >
                          编辑
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPress={() => handleDeleteOrder(order)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > 10 && (
        <div className="flex justify-center gap-2 mt-4">
          <Button
            isDisabled={page <= 1}
            size="sm"
            variant="flat"
            onPress={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="flex items-center text-sm text-gray-400">
            {page} / {Math.ceil(total / 10)}
          </span>
          <Button
            isDisabled={page >= Math.ceil(total / 10)}
            size="sm"
            variant="flat"
            onPress={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      <Modal
        isOpen={detailModalOpen}
        placement="center"
        size="2xl"
        onOpenChange={(open) => {
          if (!open) {
            setDetailModalOpen(false);
            setDetailOrder(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>订单详情</ModalHeader>
          <ModalBody>
            {detailOrder && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">订单号</span>
                  <span className="font-mono">{detailOrder.orderNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">用户</span>
                  <span>{detailOrder.userName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">商品</span>
                  <span>{detailOrder.productName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">金额</span>
                  <span>{(detailOrder.amount / 100).toFixed(2)} 元</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">
                    支付方式
                  </span>
                  <span>
                    {currencyLabel[detailOrder.payCurrency] ||
                      detailOrder.payCurrency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">状态</span>
                  <Chip
                    color={statusMap[detailOrder.status]?.color || "default"}
                    size="sm"
                  >
                    {statusMap[detailOrder.status]?.label || "未知"}
                  </Chip>
                </div>
                {detailOrder.payTime > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-foreground">
                      支付时间
                    </span>
                    <span>
                      {new Date(detailOrder.payTime * 1000).toLocaleString()}
                    </span>
                  </div>
                )}
                {detailOrder.payAddress && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-foreground">
                      USDT 地址
                    </span>
                    <span className="font-mono text-xs max-w-[200px] break-all text-right">
                      {detailOrder.payAddress}
                    </span>
                  </div>
                )}
                {detailOrder.txHash && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 text-foreground">
                      交易哈希
                    </span>
                    <span className="font-mono text-xs max-w-[200px] break-all text-right">
                      {detailOrder.txHash}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400 text-foreground">
                    创建时间
                  </span>
                  <span>
                    {detailOrder.createdAt
                      ? new Date(detailOrder.createdAt * 1000).toLocaleString()
                      : "-"}
                  </span>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setDetailModalOpen(false);
                setDetailOrder(null);
              }}
            >
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={editModalOpen}
        placement="center"
        size="lg"
        onOpenChange={(open) => {
          if (!open) {
            setEditModalOpen(false);
            setEditOrder(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>编辑订单</ModalHeader>
          <ModalBody>
            {editOrder && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">
                  订单号: {editOrder.orderNo}
                </div>
                <Input
                  description="0=待支付 1=已完成 2=已取消 3=已退款"
                  label="状态"
                  size="sm"
                  value={editForm.status}
                  variant="bordered"
                  onValueChange={(v) =>
                    setEditForm((f) => ({ ...f, status: v }))
                  }
                />
                <Input
                  label="金额 (元)"
                  size="sm"
                  step="0.01"
                  type="number"
                  value={editForm.amount}
                  variant="bordered"
                  onValueChange={(v) =>
                    setEditForm((f) => ({ ...f, amount: v }))
                  }
                />
                <Input
                  label="商品名称"
                  size="sm"
                  value={editForm.productName}
                  variant="bordered"
                  onValueChange={(v) =>
                    setEditForm((f) => ({ ...f, productName: v }))
                  }
                />
                <Input
                  description="BALANCE / USDT / YIPAY"
                  label="支付方式"
                  size="sm"
                  value={editForm.payCurrency}
                  variant="bordered"
                  onValueChange={(v) =>
                    setEditForm((f) => ({ ...f, payCurrency: v }))
                  }
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setEditModalOpen(false);
                setEditOrder(null);
              }}
            >
              取消
            </Button>
            <Button color="primary" onPress={handleSaveEdit}>
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
