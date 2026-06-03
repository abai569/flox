import type { OrderApiItem, UserPackageInfoApiData } from "@/api/types";

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
import { getOrderList, payOrder, cancelOrder, getUserPackageInfo } from "@/api";
import Network from "@/api/network";
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

export default function MyHomePage() {
  const navigate = useNavigate();
  const [pageLoading, setPageLoading] = useState(true);
  const [subData, setSubData] = useState<{
    subscription: {
      id: number;
      packageId: number;
      startAt: number;
      expireAt: number;
      autoRenew: number;
      status: number;
    } | null;
    package: {
      id: number;
      name: string;
      description: string;
      price: number;
      trafficLimit: number;
      /* portCount: number; */ speedLimit: number;
      maxRules: number;
      maxConnections: number /* maxIPAccess: number; */;
    } | null;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isFirstLoad = useRef(true);
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("-1");
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderApiItem | null>(null);
  const [payResult, setPayResult] = useState<{
    payUrl: string;
    payAddress: string;
    payAmount: string;
  } | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderApiItem | null>(null);
  const [userInfo, setUserInfo] = useState<{
    balance: number;
    flow: number;
    trafficFlow: number;
  }>({
    balance: 0,
    flow: 0,
    trafficFlow: 0,
  });

  const loadData = useCallback(async () => {
    if (!isFirstLoad.current) setRefreshing(true);
    try {
      const [orderRes, subRes, pkgInfoRes] = await Promise.all([
        getOrderList({ page, size: 10, status: parseInt(statusFilter) }),
        Network.post<{
          subscription: {
            id: number;
            packageId: number;
            startAt: number;
            expireAt: number;
            autoRenew: number;
            status: number;
          } | null;
          package: {
            id: number;
            name: string;
            description: string;
            trafficLimit: number;
            /* portCount: number; */ speedLimit: number;
            maxRules: number;
            maxConnections: number /* maxIPAccess: number; */;
          } | null;
        }>("/user/my-subscription"),
        getUserPackageInfo(),
      ]);

      if (orderRes.code === 0) {
        setOrders(orderRes.data.list || []);
        setTotal(orderRes.data.total || 0);
      } else {
        toast.error(orderRes.msg || "获取订单失败");
      }
      if (subRes.code === 0) {
        setSubData(subRes.data as any);
      }
      if (pkgInfoRes.code === 0) {
        const info = (pkgInfoRes.data as UserPackageInfoApiData)?.userInfo;

        setUserInfo({
          balance: typeof info?.balance === "number" ? info?.balance : 0,
          flow: typeof info?.flow === "number" ? info?.flow : 0,
          trafficFlow:
            typeof info?.trafficFlow === "number" ? info?.trafficFlow : 0,
        });
      }
    } catch {
      toast.error("获取数据失败");
    } finally {
      setPageLoading(false);
      setRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [page, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;

      return;
    }
    setRefreshing(true);
    (async () => {
      const [orderRes, subRes, pkgInfoRes] = await Promise.all([
        getOrderList({ page, size: 10, status: parseInt(statusFilter) }),
        Network.post<{
          subscription: {
            id: number;
            packageId: number;
            startAt: number;
            expireAt: number;
            autoRenew: number;
            status: number;
          } | null;
          package: {
            id: number;
            name: string;
            description: string;
            trafficLimit: number;
            /* portCount: number; */ speedLimit: number;
            maxRules: number;
            maxConnections: number /* maxIPAccess: number; */;
          } | null;
        }>("/user/my-subscription"),
        getUserPackageInfo(),
      ]);

      if (orderRes.code === 0) {
        setOrders(orderRes.data.list || []);
        setTotal(orderRes.data.total || 0);
      }
      if (subRes.code === 0) {
        setSubData(subRes.data as any);
      }
      if (pkgInfoRes.code === 0) {
        const info = (pkgInfoRes.data as UserPackageInfoApiData)?.userInfo;

        setUserInfo({
          balance: typeof info?.balance === "number" ? info?.balance : 0,
          flow: typeof info?.flow === "number" ? info?.flow : 0,
          trafficFlow:
            typeof info?.trafficFlow === "number" ? info?.trafficFlow : 0,
        });
      }
      setRefreshing(false);
    })();
  }, [statusFilter]);

  const handlePay = async (order: OrderApiItem) => {
    setCurrentOrder(order);
    setPayResult(null);
    setPayLoading(true);
    try {
      const res = await payOrder(order.id);

      if (res.code === 0) {
        setPayResult(res.data);
        setPayModalOpen(true);
      } else toast.error(res.msg || "获取支付信息失败");
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
      } else toast.error(res.msg || "取消失败");
    } catch {
      toast.error("网络错误");
    }
  };

  const formatFlow = (gb: number) => {
    if (gb === 0) return "0 GB";
    if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;

    return `${gb} GB`;
  };

  const formatBalance = (cents: number) => {
    return `¥${(cents / 100).toFixed(2)}`;
  };

  if (pageLoading) return <PageLoadingState message="加载中..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">我的</h1>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Card className="sm:col-span-2 border border-divider shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                  <svg
                    className="w-5 h-5 text-primary"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div>
                  <span className="font-semibold text-base">订阅套餐</span>
                  <p className="text-xs text-default-400 leading-tight">
                    {subData?.package?.name || "未订阅"}
                  </p>
                </div>
              </div>
              <Chip
                color={subData?.subscription ? "success" : "default"}
                size="sm"
                variant="flat"
              >
                {subData?.subscription ? "生效中" : "未订阅"}
              </Chip>
            </div>
          </CardHeader>
          <CardBody className="pt-2">
            {subData?.subscription ? (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    价格
                  </span>
                  <p className="font-bold text-green-500 mt-1 text-lg">
                    {(subData.package!.price / 100).toFixed(2)} 元
                  </p>
                </div>
                <div className="p-3 bg-warning-50 dark:bg-warning-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    规则
                  </span>
                  <p className="font-bold text-warning-500 mt-1 text-lg">
                    {subData.package!.maxRules > 0
                      ? subData.package!.maxRules
                      : ""}{" "}
                    个
                  </p>
                </div>
                <div className="p-3 bg-primary-50 dark:bg-primary-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    流量
                  </span>
                  <p className="font-bold text-primary-500 mt-1 text-lg">
                    {subData.package!.trafficLimit > 0
                      ? `${subData.package!.trafficLimit} GB`
                      : "不限"}
                  </p>
                </div>
                <div className="p-3 bg-success-50 dark:bg-success-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    限速
                  </span>
                  <p className="font-bold text-success-500 mt-1 text-lg">
                    {subData.package!.speedLimit > 0
                      ? `${subData.package!.speedLimit} Mbps`
                      : "不限"}
                  </p>
                </div>
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    剩余
                  </span>
                  <p className="font-bold text-yellow-500 mt-1 text-lg">
                    {subData.subscription.expireAt > 0
                      ? Math.max(
                          0,
                          Math.ceil(
                            (subData.subscription.expireAt - Date.now()) /
                              86400000,
                          ),
                        )
                      : "-"}
                    天
                  </p>
                </div>
                <div className="p-3 bg-rose-50 dark:bg-rose-900/10 rounded-lg">
                  <span className="text-sm font-semibold text-foreground">
                    有效期
                  </span>
                  <p className="font-bold text-rose-500 mt-1 text-lg">
                    {subData.subscription.expireAt > 0
                      ? new Date(
                          subData.subscription.expireAt,
                        ).toLocaleDateString()
                      : "-"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-default-500 mb-2">暂无有效套餐</p>
                <Button
                  color="primary"
                  size="sm"
                  variant="flat"
                  onPress={() => navigate("/shop")}
                >
                  前往商城购买
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="sm:col-span-1 border border-divider shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <svg
                  className="w-5 h-5 text-orange-500 dark:text-orange-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.977A4.5 4.5 0 1113.5 16h-8z" />
                </svg>
              </div>
              <span className="font-semibold">流量快餐</span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col items-center justify-center py-6 pt-2">
            <div className="p-3 bg-purple-50 dark:bg-purple-900/10 rounded-lg">
              <span className="text-sm font-semibold text-foreground">
                累计购买流量
              </span>
              <p className="font-bold text-purple-500 mt-1 text-lg">
                {formatFlow(userInfo.trafficFlow ?? 0)}
              </p>
            </div>
          </CardBody>
        </Card>
        <Card className="sm:col-span-1 border border-divider shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <svg
                  className="w-5 h-5 text-green-500 dark:text-green-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                  <path
                    clipRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.942a2.235 2.235 0 011.296-.577c.588-.266.705-.599.705-.767 0-.168-.117-.501-.705-.767a2.235 2.235 0 01-1.296-.577v-.093c.657-.197 1.165-.474 1.536-.812.617-.56 1.036-1.3 1.036-2.136 0-.836-.42-1.576-1.037-2.136A4.535 4.535 0 0011 5.092V5z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
              <span className="font-semibold">账户余额</span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col items-center justify-center py-6 pt-2">
            <div className="p-3 bg-pink-50 dark:bg-pink-900/10 rounded-lg">
              <span className="text-sm font-semibold text-foreground">
                可用余额
              </span>
              <p className="font-bold text-pink-500 mt-1 text-lg">
                {formatBalance(userInfo.balance)}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
      <h2 className="text-lg font-semibold mb-3">订单记录</h2>
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
                onPress={() => {
                  setStatusFilter(key);
                  setPage(1);
                }}
              >
                {labels[key]}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
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
        <div style={{ minWidth: 700 }}>
          <Table
            classNames={{
              th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
              td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
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
                <TableRow>
                  <TableCell
                    className="text-center text-default-400 py-8"
                    colSpan={7}
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
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {order.orderNo}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {order.productName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {(order.amount / 100).toFixed(2)} 元
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {currencyLabel[order.payCurrency] || order.payCurrency}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Chip className="rounded" color={st.color} size="sm">
                          {st.label}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400 whitespace-nowrap">
                        {order.createdAt
                          ? new Date(order.createdAt * 1000).toLocaleString()
                          : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() => {
                              setDetailOrder(order);
                              setDetailModalOpen(true);
                            }}
                          >
                            详情
                          </Button>
                          {order.status === 0 &&
                            order.payCurrency !== "BALANCE" && (
                              <>
                                <Button
                                  color="primary"
                                  isLoading={
                                    payLoading && currentOrder?.id === order.id
                                  }
                                  size="sm"
                                  variant="flat"
                                  onPress={() => handlePay(order)}
                                >
                                  去支付
                                </Button>
                                <Button
                                  color="danger"
                                  size="sm"
                                  variant="flat"
                                  onPress={() => handleCancel(order.id)}
                                >
                                  取消
                                </Button>
                              </>
                            )}
                          {order.status === 0 &&
                            order.payCurrency === "BALANCE" && (
                              <span className="text-xs text-gray-400">
                                处理中
                              </span>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
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
        isOpen={payModalOpen}
        placement="center"
        size="md"
        onOpenChange={(open) => {
          if (!open) {
            setPayModalOpen(false);
            setPayResult(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>去支付</ModalHeader>
          <ModalBody>
            {payResult?.payUrl ? (
              <div>
                <p className="mb-2">点击下方按钮跳转支付：</p>
                <Button
                  className="w-full"
                  color="primary"
                  onPress={() => window.open(payResult.payUrl, "_blank")}
                >
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
            <Button
              variant="flat"
              onPress={() => {
                setPayModalOpen(false);
                setPayResult(null);
                loadData();
              }}
            >
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
                    className="rounded"
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
    </AnimatedPage>
  );
}
