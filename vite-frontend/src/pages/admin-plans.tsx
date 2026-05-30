import type { UserApiItem } from "@/api/types";
import type {
  SubscriptionPackageApiItem,
  TunnelGroupApiItem,
} from "@/api/types";

import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
//import { Textarea } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  getPackageList,
  createPackage,
  updatePackage,
  deletePackage,
  getPackageDetail,
  getTunnelGroupList,
  getStoreStatus,
  setStoreStatus,
  assignPackageToUser,
  getAllUsers,
} from "@/api";
import { PageLoadingState } from "@/components/page-state";

const typeOptions = [
  { value: "subscription", label: "订阅套餐" },
  { value: "traffic", label: "流量快餐" },
  { value: "balance", label: "余额充值" },
];

const TAB_KEY = "admin-plans-active-tab";

type TabType = "subscription" | "traffic" | "balance";

function getInitialTab(): TabType {
  try {
    const saved = localStorage.getItem(TAB_KEY);

    if (saved && ["subscription", "traffic", "balance"].includes(saved)) {
      return saved as TabType;
    }
  } catch {
    /* ignore */
  }

  return "subscription";
}

interface PackageForm {
  id?: number;
  type: string;
  name: string;
  description: string;
  priceYuan: string;
  validityDays: number;
  trafficLimit: number;
  // portCount: number;
  speedLimit: number;
  maxRules: number;
  maxConnections: number;
  // maxIPAccess: number;
  autoRenew: boolean;
  enabled: boolean;
  shopVisible: boolean;
  autoBuyTrafficEnabled: boolean;
  sortOrder: number;
  stock: number;
  recommended: boolean;
  tunnelGroupIds: number[];
}

const defaultPackageForm: PackageForm = {
  type: "subscription",
  name: "",
  description: "",
  priceYuan: "0",
  validityDays: 30,
  trafficLimit: 0,
  // portCount: 0,
  speedLimit: 0,
  maxRules: 0,
  maxConnections: 0,
  // maxIPAccess: 0,
  autoRenew: false,
  enabled: true,
  shopVisible: true,
  autoBuyTrafficEnabled: false,
  sortOrder: 0,
  stock: -1,
  recommended: false,
  tunnelGroupIds: [],
};

const durationOptions = [
  { value: 7, label: "7 天" },
  { value: 30, label: "一个月" },
  { value: 90, label: "三个月" },
  { value: 180, label: "半年" },
  { value: 365, label: "一年" },
  { value: 730, label: "两年" },
];

export default function AdminPlansPage() {
  const [pkgList, setPkgList] = useState<SubscriptionPackageApiItem[]>([]);
  const [tunnelGroups, setTunnelGroups] = useState<TunnelGroupApiItem[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);

  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [pkgDeleteModalOpen, setPkgDeleteModalOpen] = useState(false);
  const [isPkgEdit, setIsPkgEdit] = useState(false);
  const [pkgForm, setPkgForm] = useState<PackageForm>({
    ...defaultPackageForm,
  });
  const [pkgToDelete, setPkgToDelete] =
    useState<SubscriptionPackageApiItem | null>(null);
  const [pkgSubmitLoading, setPkgSubmitLoading] = useState(false);
  const [pkgModalLoading, setPkgModalLoading] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignPkgId, setAssignPkgId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  const [storeEnabled, setStoreEnabled] = useState(true);

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);

  const filteredList = pkgList.filter((p) => p.type === activeTab);

  // ── Load data ──
  const loadPackages = useCallback(async () => {
    try {
      const [pkgRes, tgRes, storeRes] = await Promise.all([
        getPackageList(),
        getTunnelGroupList(),
        getStoreStatus(),
      ]);

      if (pkgRes.code === 0) {
        setPkgList(Array.isArray(pkgRes.data) ? pkgRes.data : []);
      }
      if (tgRes.code === 0) {
        setTunnelGroups(Array.isArray(tgRes.data) ? tgRes.data : []);
      }
      if (storeRes.code === 0) {
        setStoreEnabled(!!storeRes.data.enabled);
      }
    } catch {
      toast.error("加载失败");
    }
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  // ── Package CRUD handlers ──
  const handlePkgAdd = () => {
    setPkgForm({ ...defaultPackageForm, type: activeTab });
    setIsPkgEdit(false);
    setPkgModalOpen(true);
  };

  const handlePkgEdit = async (item: SubscriptionPackageApiItem) => {
    setIsPkgEdit(true);
    setPkgModalLoading(true);
    setPkgModalOpen(true);
    try {
      const res = await getPackageDetail(item.id);

      if (res.code === 0) {
        const p = res.data.package;

        setPkgForm({
          id: p.id,
          type: p.type || "subscription",
          name: p.name,
          description: p.description || "",
          priceYuan: (p.price / 100).toFixed(2),
          validityDays: p.validityDays,
          trafficLimit: p.trafficLimit,
          /* portCount: p.portCount, */ speedLimit: p.speedLimit,
          maxRules: p.maxRules,
          maxConnections: p.maxConnections /* maxIPAccess: p.maxIPAccess, */,
          autoRenew: p.autoRenew === 1,
          enabled: p.enabled === 1,
          shopVisible: p.shopVisible === 1,
          autoBuyTrafficEnabled: p.autoBuyTrafficEnabled === 1,
          sortOrder: p.sortOrder,
          stock: p.stock ?? -1,
          recommended: p.recommended === 1,
          tunnelGroupIds: res.data.tunnelGroupIds || [],
        });
      } else {
        toast.error(res.msg || "获取套餐详情失败");
        setPkgModalOpen(false);
      }
    } catch {
      toast.error("网络错误");
      setPkgModalOpen(false);
    } finally {
      setPkgModalLoading(false);
    }
  };

  const handlePkgSubmit = async () => {
    if (!pkgForm.name.trim()) {
      toast.error("套餐名称不能为空");

      return;
    }
    setPkgSubmitLoading(true);
    try {
      const data: Record<string, unknown> = {
        type: pkgForm.type,
        name: pkgForm.name,
        description: pkgForm.description,
        priceYuan: parseFloat(pkgForm.priceYuan || "0"),
        validityDays: pkgForm.validityDays,
        trafficLimit: pkgForm.trafficLimit,
        speedLimit: pkgForm.speedLimit,
        maxRules: pkgForm.maxRules,
        maxConnections: pkgForm.maxConnections,
        autoRenew: pkgForm.autoRenew ? 1 : 0,
        enabled: pkgForm.enabled ? 1 : 0,
        shopVisible: pkgForm.shopVisible ? 1 : 0,
        autoBuyTrafficEnabled: pkgForm.autoBuyTrafficEnabled ? 1 : 0,
        sortOrder: pkgForm.sortOrder,
        stock: pkgForm.stock,
        recommended: pkgForm.recommended ? 1 : 0,
        tunnelGroupIds: pkgForm.tunnelGroupIds,
      };

      if (isPkgEdit && pkgForm.id) data.id = pkgForm.id;
      const res = isPkgEdit
        ? await updatePackage(data)
        : await createPackage(data);

      if (res.code === 0) {
        toast.success(isPkgEdit ? "更新成功" : "创建成功");
        setPkgModalOpen(false);
        loadPackages();
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setPkgSubmitLoading(false);
    }
  };

  const handlePkgDelete = (item: SubscriptionPackageApiItem) => {
    setPkgToDelete(item);
    setPkgDeleteModalOpen(true);
  };

  const confirmPkgDelete = async () => {
    if (!pkgToDelete) return;
    try {
      const res = await deletePackage(pkgToDelete.id);

      if (res.code === 0) {
        toast.success("已删除");
        setPkgDeleteModalOpen(false);
        setPkgToDelete(null);
        loadPackages();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误");
    }
  };

  const toggleTunnelGroup = (id: number) => {
    setPkgForm((prev) => {
      const current = prev.tunnelGroupIds;

      if (current.includes(id))
        return { ...prev, tunnelGroupIds: current.filter((v) => v !== id) };

      return { ...prev, tunnelGroupIds: [...current, id] };
    });
  };

  // ── Assign ──
  const openAssign = async () => {
    setAssignUserId("");
    setAssignPkgId("");
    setAssignOpen(true);
    try {
      const res = await getAllUsers({ current: 1, size: 1000 });

      if (res.code === 0) {
        const list = Array.isArray(res.data) ? res.data : [];

        setUsers(
          list.map((u: UserApiItem) => ({ id: u.id, name: u.name || u.user })),
        );
      }
    } catch {
      setUsers([]);
    }
  };

  const confirmAssign = async () => {
    if (!assignUserId || !assignPkgId) {
      toast.error("请选择用户和套餐");

      return;
    }
    setAssignLoading(true);
    try {
      const res = await assignPackageToUser({
        userId: Number(assignUserId),
        packageId: Number(assignPkgId),
      });

      if (res.code === 0) {
        toast.success("分配成功");
        setAssignOpen(false);
      } else {
        toast.error(res.msg || "分配失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setAssignLoading(false);
    }
  };

  const activeCount = pkgList.filter((p) => p.enabled === 1).length;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-bold">套餐管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button color="secondary" variant="flat" onPress={openAssign}>
            手动分配
          </Button>
          <Button color="primary" variant="flat" onPress={handlePkgAdd}>
            新增套餐
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">商城状态</span>
              <div
                className={`p-1.5 rounded-lg ${storeEnabled ? "bg-green-100 dark:bg-green-500/20" : "bg-gray-100 dark:bg-gray-500/20"}`}
              >
                {storeEnabled ? (
                  <svg
                    className="w-4 h-4 text-green-600"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      fillRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      fillRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p
                className={`text-xl font-bold ${storeEnabled ? "text-green-600" : "text-gray-400"}`}
              >
                {storeEnabled ? "已开启" : "只能手动分配"}
              </p>
              <Switch
                isSelected={storeEnabled}
                size="sm"
                onValueChange={async (enabled: boolean) => {
                  try {
                    const res = await setStoreStatus({ enabled });

                    if (res.code === 0) {
                      setStoreEnabled(enabled);
                      toast.success(enabled ? "已开启" : "只能手动分配");
                      // 同步更新 payment_enabled 及相关状态
                      const localStorageKey = "vite_config_payment_enabled";
                      const localStorageValue = enabled ? "true" : "false";

                      try {
                        localStorage.setItem(
                          localStorageKey,
                          localStorageValue,
                        );
                      } catch {}
                      window.dispatchEvent(
                        new CustomEvent("paymentEnabledChanged", {
                          detail: { enabled },
                        }),
                      );
                      window.dispatchEvent(
                        new CustomEvent("storeEnabledChanged", {
                          detail: { enabled },
                        }),
                      );
                    } else {
                      toast.error(res.msg || "操作失败");
                    }
                  } catch (e: any) {
                    toast.error(e?.message || "网络错误");
                  }
                }}
              />
            </div>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">套餐总数</span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                <svg
                  className="w-4 h-4 text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">
              {pkgList.length}
            </p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">启用</span>
              <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                <svg
                  className="w-4 h-4 text-green-600"
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
            <p className="text-xl font-bold text-green-600">{activeCount}</p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">隧道分组</span>
              <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-500/20">
                <svg
                  className="w-4 h-4 text-purple-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">
              {tunnelGroups.length}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {typeOptions.map((tab) => (
          <Button
            key={tab.value}
            color={activeTab === tab.value ? "primary" : "default"}
            size="sm"
            variant={activeTab === tab.value ? "solid" : "flat"}
            onPress={() => {
              setActiveTab(tab.value as TabType);
              try {
                localStorage.setItem(TAB_KEY, tab.value);
              } catch {
                /* ignore */
              }
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* ── 订阅套餐表格 ── */}
      {activeTab === "subscription" && (
        <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
          <Table
            className="min-w-[640px]"
            classNames={{
              th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
              td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
            <TableHeader>
              <TableColumn className="whitespace-nowrap min-w-[120px]">
                名称
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[140px]">
                价格
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[140px]">
                有效期
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[100px]">
                隧道组
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[200px]">
                限制
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[70px]">
                启用状态
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[90px]">
                商店可见
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[100px]">
                自动续费
              </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[80px]">
                 库存
               </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[60px]">
                 商店推荐
               </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[80px]">
                 操作
               </TableColumn>
             </TableHeader>
             <TableBody>
               {filteredList.map((item) => (
                 <TableRow key={item.id}>
                   <TableCell>
                     <div className="font-medium text-sm">{item.name}</div>
                     {item.description && (
                       <div className="text-xs text-gray-400 truncate max-w-48">
                         {item.description}
                       </div>
                     )}
                   </TableCell>
                   <TableCell>
                     <div className="text-sm whitespace-nowrap">
                       ¥{(item.price / 100).toFixed(2)}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="text-sm">
                       {item.type === "traffic"
                         ? `${item.trafficLimit} GB`
                         : `${item.validityDays}天`}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-wrap gap-1">
                       {(item.tunnelGroupIds || []).length === 0 && (
                         <span className="text-xs text-gray-400">未关联</span>
                       )}
                       {(item.tunnelGroupIds || []).map((gid: number) => {
                         const tg = tunnelGroups.find((g) => g.id === gid);
                         return tg ? (
                           <span
                             key={gid}
                             className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300"
                           >
                             {tg.name}
                           </span>
                         ) : null;
                       })}
                     </div>
                   </TableCell>
                   <TableCell className="text-xs text-gray-500">
                     <div className="space-y-0.5">
                       <div>
                         规则 {item.maxRules > 0 ? item.maxRules : "不限"} · 流量{" "}
                         {item.trafficLimit > 0
                           ? `${item.trafficLimit} GB`
                           : "不限"}
                       </div>
                       <div>
                         连接{" "}
                         {item.maxConnections > 0 ? item.maxConnections : "不限"}{" "}
                         · 限速{" "}
                         {item.speedLimit > 0
                           ? `${item.speedLimit} Mbps`
                           : "不限"}
                       </div>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.enabled === 1 ? "bg-green-500" : "bg-gray-400"}`}
                       >
                         {item.enabled === 1 ? "启用" : "停用"}
                       </span>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.shopVisible === 1 ? "bg-blue-500" : "bg-gray-400"}`}
                       >
                         {item.shopVisible === 1 ? "商店可见" : "后台分配"}
                       </span>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.autoRenew === 1 ? "bg-purple-500" : "bg-gray-400"}`}
                       >
                         {item.autoRenew === 1 ? "自动续费" : "不续费"}
                       </span>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="text-sm">
                       {item.stock === -1 ? (
                         <span className="text-default-400">不限</span>
                       ) : item.stock === 0 ? (
                         <span className="text-red-500 font-medium">已售罄</span>
                       ) : (
                         <span>{item.stock}</span>
                       )}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.recommended === 1 ? "bg-amber-500" : "bg-gray-400"}`}
                       >
                         {item.recommended === 1 ? "推荐" : "不推荐"}
                       </span>
                     </div>
                   </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgEdit(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L18.732 3.732z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        color="danger"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgDelete(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredList.length === 0 && (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-gray-400"
                    colSpan={9}
                  >
                    暂无订阅套餐
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── 流量快餐表格 ── */}
      {activeTab === "traffic" && (
        <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
          <Table
            className="min-w-[640px]"
            classNames={{
              th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
              td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
            <TableHeader>
              <TableColumn className="whitespace-nowrap min-w-[120px]">
                名称
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[120px]">
                价格
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[100px]">
                流量
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[70px]">
                启用状态
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[90px]">
                商店可见
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[100px]">
                自动购流选择
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[80px]">
                库存
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[80px]">
                操作
              </TableColumn>
            </TableHeader>
            <TableBody>
              {filteredList.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{item.name}</div>
                    {item.description && (
                      <div className="text-xs text-gray-400 truncate max-w-48">
                        {item.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm whitespace-nowrap">
                      ¥{(item.price / 100).toFixed(2)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {item.trafficLimit > 0
                        ? `${item.trafficLimit} GB`
                        : "不限"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-row gap-1 shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.enabled === 1 ? "bg-green-500" : "bg-gray-400"}`}
                      >
                        {item.enabled === 1 ? "启用" : "停用"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-row gap-1 shrink-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.shopVisible === 1 ? "bg-blue-500" : "bg-gray-400"}`}
                      >
                        {item.shopVisible === 1 ? "商店可见" : "后台分配"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-row gap-1 shrink-0">
                      {item.autoBuyTrafficEnabled === 1 ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap bg-teal-500"
                          title="用户可选择此套餐作为自动购流来源"
                        >
                          可用
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap bg-gray-400">
                          不使用
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {item.stock === -1 ? (
                        <span className="text-default-400">不限</span>
                      ) : item.stock === 0 ? (
                        <span className="text-red-500 font-medium">已售罄</span>
                      ) : (
                        <span>{item.stock}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgEdit(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L18.732 3.732z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        color="danger"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgDelete(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredList.length === 0 && (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-gray-400"
                    colSpan={8}
                  >
                    暂无流量快餐
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── 余额充值表格 ── */}
      {activeTab === "balance" && (
        <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
          <Table
            className="min-w-[500px]"
            classNames={{
              th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
              td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
            <TableHeader>
              <TableColumn className="whitespace-nowrap min-w-[120px]">
                名称
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[140px]">
                充值金额
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[70px]">
                启用状态
              </TableColumn>
              <TableColumn className="whitespace-nowrap min-w-[90px]">
                商店可见
              </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[80px]">
                 库存
               </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[60px]">
                 推荐
               </TableColumn>
               <TableColumn className="whitespace-nowrap min-w-[80px]">
                 操作
               </TableColumn>
             </TableHeader>
             <TableBody>
               {filteredList.map((item) => (
                 <TableRow key={item.id}>
                   <TableCell>
                     <div className="font-medium text-sm">{item.name}</div>
                     {item.description && (
                       <div className="text-xs text-gray-400 truncate max-w-48">
                         {item.description}
                       </div>
                     )}
                   </TableCell>
                   <TableCell>
                     <div className="text-sm whitespace-nowrap">
                       ¥{(item.price / 100).toFixed(2)}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.enabled === 1 ? "bg-green-500" : "bg-gray-400"}`}
                       >
                         {item.enabled === 1 ? "启用" : "停用"}
                       </span>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.shopVisible === 1 ? "bg-blue-500" : "bg-gray-400"}`}
                       >
                         {item.shopVisible === 1 ? "商店可见" : "后台分配"}
                       </span>
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="text-sm">
                       {item.stock === -1 ? (
                         <span className="text-default-400">不限</span>
                       ) : item.stock === 0 ? (
                         <span className="text-red-500 font-medium">已售罄</span>
                       ) : (
                         <span>{item.stock}</span>
                       )}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-row gap-1 shrink-0">
                       <span
                         className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.recommended === 1 ? "bg-amber-500" : "bg-gray-400"}`}
                       >
                         {item.recommended === 1 ? "推荐" : "不推荐"}
                       </span>
                     </div>
                   </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgEdit(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L18.732 3.732z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                      <Button
                        isIconOnly
                        className="min-w-0 w-8 h-8"
                        color="danger"
                        size="sm"
                        variant="flat"
                        onPress={() => handlePkgDelete(item)}
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                          />
                        </svg>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredList.length === 0 && (
                <TableRow>
                  <TableCell
                    className="py-10 text-center text-gray-400"
                    colSpan={6}
                  >
                    暂无余额充值套餐
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Modal
        isOpen={pkgModalOpen}
        placement="center"
        scrollBehavior="inside"
        size="md"
        onOpenChange={(open) => {
          if (!open) setPkgModalOpen(false);
        }}
      >
        <ModalContent>
          <ModalHeader>{isPkgEdit ? "编辑套餐" : "新增套餐"}</ModalHeader>
          {pkgModalLoading ? (
            <ModalBody>
              <PageLoadingState message="加载套餐详情..." />
            </ModalBody>
          ) : (
            <ModalBody className="space-y-4">
              <Select
                label="类型"
                selectedKeys={[pkgForm.type]}
                variant="bordered"
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;

                  if (val) setPkgForm((p) => ({ ...p, type: val }));
                }}
              >
                {typeOptions.map((o) => (
                  <SelectItem key={o.value}>{o.label}</SelectItem>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={pkgForm.type === "balance" ? "套餐名称" : "套餐名称"}
                  value={pkgForm.name}
                  variant="bordered"
                  onChange={(e) =>
                    setPkgForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
                <Input
                  label={
                    pkgForm.type === "balance" ? "充值金额 (元)" : "价格 (元)"
                  }
                  min="0"
                  step="0.01"
                  type="number"
                  value={pkgForm.priceYuan}
                  variant="bordered"
                  onChange={(e) =>
                    setPkgForm((p) => ({ ...p, priceYuan: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="库存 (-1不限，0售罄)"
                  min="-1"
                  type="number"
                  value={String(pkgForm.stock)}
                  variant="bordered"
                  onChange={(e) =>
                    setPkgForm((p) => ({
                      ...p,
                      stock: parseInt(e.target.value) ?? -1,
                    }))
                  }
                />
                <Input
                  label="描述"
                  value={pkgForm.description}
                  variant="bordered"
                  onChange={(e) =>
                    setPkgForm((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </div>
              {pkgForm.type === "traffic" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="流量 (GB)"
                      min="0"
                      type="number"
                      value={String(pkgForm.trafficLimit)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          trafficLimit: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                    <Input
                      label="排序"
                      min="0"
                      type="number"
                      value={String(pkgForm.sortOrder)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          sortOrder: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Switch
                      isSelected={pkgForm.autoBuyTrafficEnabled}
                      onValueChange={(v) =>
                        setPkgForm((p) => ({ ...p, autoBuyTrafficEnabled: v }))
                      }
                    >
                      可用于自动购流
                    </Switch>
                    <span className="text-xs text-gray-400">
                      用户可在设置中选此套餐作为自动购买流量来源
                    </span>
                  </div>
                </>
              )}
              {pkgForm.type === "subscription" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label="有效期"
                      selectedKeys={[String(pkgForm.validityDays)]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const val = Array.from(keys)[0] as string;

                        if (val)
                          setPkgForm((p) => ({
                            ...p,
                            validityDays: parseInt(val) || 30,
                          }));
                      }}
                    >
                      {durationOptions.map((d) => (
                        <SelectItem key={String(d.value)}>{d.label}</SelectItem>
                      ))}
                    </Select>
                    <Input
                      label="排序"
                      min="0"
                      type="number"
                      value={String(pkgForm.sortOrder)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          sortOrder: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="总流量 (GB, 0=不限)"
                      min="0"
                      type="number"
                      value={String(pkgForm.trafficLimit)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          trafficLimit: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                    <Input
                      label="最大规则数 (0=不限)"
                      min="0"
                      type="number"
                      value={String(pkgForm.maxRules)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          maxRules: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="限速 (Mbps, 0=不限)"
                      min="0"
                      type="number"
                      value={String(pkgForm.speedLimit)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          speedLimit: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                    <Input
                      label="最大连接数 (0=不限)"
                      min="0"
                      type="number"
                      value={String(pkgForm.maxConnections)}
                      variant="bordered"
                      onChange={(e) =>
                        setPkgForm((p) => ({
                          ...p,
                          maxConnections: parseInt(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Switch
                      isSelected={pkgForm.autoRenew}
                      onValueChange={(v) =>
                        setPkgForm((p) => ({ ...p, autoRenew: v }))
                      }
                    >
                      自动续费
                    </Switch>
                    <span className="text-xs text-gray-400">自动续费</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-foreground">
                      关联隧道分组
                    </label>
                    <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto border border-divider rounded-lg p-3">
                      {tunnelGroups.length === 0 && (
                        <span className="text-xs text-gray-400 col-span-full">
                          暂无隧道分组
                        </span>
                      )}
                      {tunnelGroups.map((tg) => (
                        <Checkbox
                          key={tg.id}
                          isSelected={pkgForm.tunnelGroupIds.includes(tg.id)}
                          onValueChange={() => toggleTunnelGroup(tg.id)}
                        >
                          {tg.name}
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-6">
                <div className="flex flex-col gap-1">
                  <Switch
                    isSelected={pkgForm.enabled}
                    onValueChange={(v) =>
                      setPkgForm((p) => ({ ...p, enabled: v }))
                    }
                  >
                    启用套餐
                  </Switch>
                  <span className="text-xs text-gray-400">启用套餐</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Switch
                    isSelected={pkgForm.shopVisible}
                    onValueChange={(v) =>
                      setPkgForm((p) => ({ ...p, shopVisible: v }))
                    }
                  >
                    商店可见
                  </Switch>
                  <span className="text-xs text-gray-400">商店售卖</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Switch
                    isSelected={pkgForm.recommended}
                    onValueChange={(v) =>
                      setPkgForm((p) => ({ ...p, recommended: v }))
                    }
                  >
                    商店推荐
                  </Switch>
                  <span className="text-xs text-gray-400">商店推荐</span>
                </div>
              </div>
              {/* 隐藏套餐说明 */}
              {/* 
              <div className="space-y-1">
                <label className="text-sm text-foreground">说明</label>
                <Textarea
                  className="w-full min-h-10"
                  value={pkgForm.description}
                  variant="bordered"
                  onChange={(e) =>
                    setPkgForm((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </div> 
              */}
            </ModalBody>
          )}
          <ModalFooter>
            <Button variant="flat" onPress={() => setPkgModalOpen(false)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={pkgSubmitLoading}
              onPress={handlePkgSubmit}
            >
              确定
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={pkgDeleteModalOpen}
        placement="center"
        onOpenChange={(open) => {
          if (!open) {
            setPkgDeleteModalOpen(false);
            setPkgToDelete(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>确定要删除套餐"{pkgToDelete?.name}"吗？</ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setPkgDeleteModalOpen(false);
                setPkgToDelete(null);
              }}
            >
              取消
            </Button>
            <Button color="danger" onPress={confirmPkgDelete}>
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={assignOpen}
        placement="center"
        onOpenChange={(open) => {
          if (!open) setAssignOpen(false);
        }}
      >
        <ModalContent>
          <ModalHeader>手动分配套餐</ModalHeader>
          <ModalBody className="space-y-4">
            <Select
              label="选择用户"
              selectedKeys={assignUserId ? [assignUserId] : []}
              variant="bordered"
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;

                if (val) setAssignUserId(val);
              }}
            >
              {users.map((u) => (
                <SelectItem key={String(u.id)}>{u.name}</SelectItem>
              ))}
            </Select>
            <Select
              label="选择套餐"
              selectedKeys={assignPkgId ? [assignPkgId] : []}
              variant="bordered"
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string;

                if (val) setAssignPkgId(val);
              }}
            >
              {filteredList.map((p) => (
                <SelectItem key={String(p.id)}>{p.name}</SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setAssignOpen(false)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={assignLoading}
              onPress={confirmAssign}
            >
              分配
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
