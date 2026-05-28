import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
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
import { Chip } from "@/shadcn-bridge/heroui/chip";
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
import type { UserApiItem } from "@/api/types";
import type {
  SubscriptionPackageApiItem,
  TunnelGroupApiItem,
} from "@/api/types";
import { PageLoadingState } from "@/components/page-state";

interface PackageForm {
  id?: number;
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
  sortOrder: number;
  tunnelGroupIds: number[];
}

const defaultPackageForm: PackageForm = {
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
  sortOrder: 0,
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

function durationLabel(days: number): string {
  return durationOptions.find((d) => d.value === days)?.label || `${days} 天`;
}

export default function AdminPlansPage() {
  const [pkgList, setPkgList] = useState<SubscriptionPackageApiItem[]>([]);
  const [tunnelGroups, setTunnelGroups] = useState<TunnelGroupApiItem[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);

  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [pkgDeleteModalOpen, setPkgDeleteModalOpen] = useState(false);
  const [isPkgEdit, setIsPkgEdit] = useState(false);
  const [pkgForm, setPkgForm] = useState<PackageForm>({ ...defaultPackageForm });
  const [pkgToDelete, setPkgToDelete] = useState<SubscriptionPackageApiItem | null>(null);
  const [pkgSubmitLoading, setPkgSubmitLoading] = useState(false);
  const [pkgModalLoading, setPkgModalLoading] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignPkgId, setAssignPkgId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  const [storeEnabled, setStoreEnabled] = useState(true);

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
    } catch { toast.error("加载失败"); }
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  // ── Package CRUD handlers ──
  const handlePkgAdd = () => {
    setPkgForm({ ...defaultPackageForm });
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
          id: p.id, name: p.name, description: p.description || "",
          priceYuan: (p.price / 100).toFixed(2), validityDays: p.validityDays,
          trafficLimit: p.trafficLimit, /* portCount: p.portCount, */ speedLimit: p.speedLimit,
          maxRules: p.maxRules, maxConnections: p.maxConnections, /* maxIPAccess: p.maxIPAccess, */
          autoRenew: p.autoRenew === 1, enabled: p.enabled === 1, shopVisible: p.shopVisible === 1,
          sortOrder: p.sortOrder, tunnelGroupIds: res.data.tunnelGroupIds || [],
        });
      } else { toast.error(res.msg || "获取套餐详情失败"); setPkgModalOpen(false); }
    } catch { toast.error("网络错误"); setPkgModalOpen(false); }
    finally { setPkgModalLoading(false); }
  };

  const handlePkgSubmit = async () => {
    if (!pkgForm.name.trim()) { toast.error("套餐名称不能为空"); return; }
    setPkgSubmitLoading(true);
    try {
      const data = {
        name: pkgForm.name, description: pkgForm.description, priceYuan: parseFloat(pkgForm.priceYuan || "0"),
        validityDays: pkgForm.validityDays, trafficLimit: pkgForm.trafficLimit,
        speedLimit: pkgForm.speedLimit, maxRules: pkgForm.maxRules, maxConnections: pkgForm.maxConnections,
        autoRenew: pkgForm.autoRenew ? 1 : 0, enabled: pkgForm.enabled ? 1 : 0,
        shopVisible: pkgForm.shopVisible ? 1 : 0, sortOrder: pkgForm.sortOrder, tunnelGroupIds: pkgForm.tunnelGroupIds,
      };
      const res = isPkgEdit ? await updatePackage(data) : await createPackage(data);
      if (res.code === 0) { toast.success(isPkgEdit ? "更新成功" : "创建成功"); setPkgModalOpen(false); loadPackages(); }
      else { toast.error(res.msg || "操作失败"); }
    } catch { toast.error("网络错误"); }
    finally { setPkgSubmitLoading(false); }
  };

  const handlePkgDelete = (item: SubscriptionPackageApiItem) => { setPkgToDelete(item); setPkgDeleteModalOpen(true); };

  const confirmPkgDelete = async () => {
    if (!pkgToDelete) return;
    try {
      const res = await deletePackage(pkgToDelete.id);
      if (res.code === 0) { toast.success("已删除"); setPkgDeleteModalOpen(false); setPkgToDelete(null); loadPackages(); }
      else { toast.error(res.msg || "删除失败"); }
    } catch { toast.error("网络错误"); }
  };

  const toggleTunnelGroup = (id: number) => {
    setPkgForm((prev) => {
      const current = prev.tunnelGroupIds;
      if (current.includes(id)) return { ...prev, tunnelGroupIds: current.filter((v) => v !== id) };
      return { ...prev, tunnelGroupIds: [...current, id] };
    });
  };

  // ── Assign ──
  const openAssign = async () => {
    setAssignUserId(""); setAssignPkgId(""); setAssignOpen(true);
    try {
      const res = await getAllUsers({ current: 1, size: 1000 });
      if (res.code === 0) {
        const list = Array.isArray(res.data) ? res.data : [];
        setUsers(list.map((u: UserApiItem) => ({ id: u.id, name: u.name || u.user })));
      }
    } catch { setUsers([]); }
  };

  const confirmAssign = async () => {
    if (!assignUserId || !assignPkgId) { toast.error("请选择用户和套餐"); return; }
    setAssignLoading(true);
    try {
      const res = await assignPackageToUser({ userId: Number(assignUserId), packageId: Number(assignPkgId) });
      if (res.code === 0) { toast.success("分配成功"); setAssignOpen(false); }
      else { toast.error(res.msg || "分配失败"); }
    } catch { toast.error("网络错误"); }
    finally { setAssignLoading(false); }
  };

  const activeCount = pkgList.filter((p) => p.enabled === 1).length;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-bold">套餐管理</h1>
        <div className="flex flex-wrap gap-2">
          <Button color="secondary" variant="flat" onPress={openAssign}>手动分配</Button>
          <Button color="primary" variant="flat" onPress={handlePkgAdd}>新增套餐</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">商城状态</span>
              <div className={`p-1.5 rounded-lg ${storeEnabled ? "bg-green-100 dark:bg-green-500/20" : "bg-gray-100 dark:bg-gray-500/20"}`}>
                {storeEnabled ? (
                  <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-xl font-bold ${storeEnabled ? "text-green-600" : "text-gray-400"}`}>{storeEnabled ? "已开启" : "已关闭"}</p>
              <Switch
                isSelected={storeEnabled}
                onValueChange={async (enabled: boolean) => {
                  try {
                    const res = await setStoreStatus({ enabled });
                    if (res.code === 0) {
                      setStoreEnabled(enabled);
                      toast.success(enabled ? "商城已开启" : "商城已关闭");
                    } else { toast.error(res.msg || "操作失败"); }
                  } catch { toast.error("网络错误"); }
                }}
                size="sm"
              />
            </div>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">套餐总数</span>
              <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">{pkgList.length}</p>
          </CardBody>
        </Card>
        <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
          <CardBody className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-default-500">启用</span>
              <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
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
                <svg className="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" /></svg>
              </div>
            </div>
            <p className="text-xl font-bold text-foreground">{tunnelGroups.length}</p>
          </CardBody>
        </Card>
      </div>

      <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
        <Table classNames={{ th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle", td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0", tr: "hover:bg-default-50/50 transition-colors" }}>
          <TableHeader>
            <TableColumn className="whitespace-nowrap">套餐</TableColumn>
            <TableColumn className="whitespace-nowrap">价格/有效期</TableColumn>
            <TableColumn className="whitespace-nowrap">资源</TableColumn>
            <TableColumn className="whitespace-nowrap">限制</TableColumn>
            <TableColumn className="whitespace-nowrap">状态</TableColumn>
            <TableColumn className="whitespace-nowrap">操作</TableColumn>
          </TableHeader>
          <TableBody>
            {pkgList.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.name}</div>
                  {item.description && <div className="text-xs text-gray-400 truncate max-w-40">{item.description}</div>}
                </TableCell>
                <TableCell>
                  <div className="font-mono">{(item.price / 100).toFixed(2)} 元</div>
                  <div className="text-xs text-gray-400">{durationLabel(item.validityDays)}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Chip size="sm" variant="flat">{item.trafficLimit > 0 ? `${item.trafficLimit} GB` : "不限流量"}</Chip>
                    {/* <Chip size="sm" variant="flat">{item.portCount > 0 ? `${item.portCount} 端口` : "不限端口"}</Chip> */}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-gray-500">
                  <div>规则 {item.maxRules || "不限"} · 连接 {item.maxConnections || "不限"}{/* · IP {item.maxIPAccess || "不限"} */}</div>
                  <div>{item.speedLimit > 0 ? `${item.speedLimit} Mbps` : "不限速"}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Chip color={item.enabled === 1 ? "success" : "default"} size="sm" variant="flat">{item.enabled === 1 ? "启用" : "停用"}</Chip>
                    <Chip color={item.shopVisible === 1 ? "primary" : "default"} size="sm" variant="flat">{item.shopVisible === 1 ? "商店可见" : "后台分配"}</Chip>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="flat" onPress={() => handlePkgEdit(item)}>编辑</Button>
                    <Button size="sm" color="danger" variant="flat" onPress={() => handlePkgDelete(item)}>删除</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {pkgList.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-gray-400">还没有套餐</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Modal isOpen={pkgModalOpen} placement="center" size="xl" scrollBehavior="inside" onOpenChange={(open) => { if (!open) setPkgModalOpen(false); }}>
        <ModalContent>
          <ModalHeader>{isPkgEdit ? "编辑套餐" : "新增套餐"}</ModalHeader>
          {pkgModalLoading ? <ModalBody><PageLoadingState message="加载套餐详情..." /></ModalBody> : (
            <ModalBody className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="套餐名称" value={pkgForm.name} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, name: e.target.value }))} />
                <Input label="价格 (元)" type="number" step="0.01" min="0" value={pkgForm.priceYuan} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, priceYuan: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-gray-400">说明</label>
                <Textarea value={pkgForm.description} variant="bordered" className="w-full min-h-20" onChange={(e) => setPkgForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select label="有效期" variant="bordered" selectedKeys={[String(pkgForm.validityDays)]} onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setPkgForm((p) => ({ ...p, validityDays: parseInt(val) || 30 })); }}>
                  {durationOptions.map((d) => <SelectItem key={String(d.value)}>{d.label}</SelectItem>)}
                </Select>
                <Input label="排序" type="number" min="0" value={String(pkgForm.sortOrder)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="总流量 (GB, 0=不限)" type="number" min="0" value={String(pkgForm.trafficLimit)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, trafficLimit: parseInt(e.target.value) || 0 }))} />
                <Input label="最大规则数 (0=不限)" type="number" min="0" value={String(pkgForm.maxRules)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, maxRules: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="限速 (Mbps, 0=不限)" type="number" min="0" value={String(pkgForm.speedLimit)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, speedLimit: parseInt(e.target.value) || 0 }))} />
                <Input label="最大连接数 (0=不限)" type="number" min="0" value={String(pkgForm.maxConnections)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, maxConnections: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* <Input label="连续端口数 (0=不限)" type="number" min="0" value={String(pkgForm.portCount)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, portCount: parseInt(e.target.value) || 0 }))} /> */}                
                {/* <Input label="单 IP 接入限制 (0=不限)" type="number" min="0" value={String(pkgForm.maxIPAccess)} variant="bordered" onChange={(e) => setPkgForm((p) => ({ ...p, maxIPAccess: parseInt(e.target.value) || 0 }))} /> */}
              </div>
              <div className="flex flex-wrap gap-6">
                <div className="flex flex-col gap-1">
                  <Switch isSelected={pkgForm.enabled} onValueChange={(v) => setPkgForm((p) => ({ ...p, enabled: v }))}>启用套餐</Switch>
                  <span className="text-xs text-gray-400">关闭后用户无法购买</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Switch isSelected={pkgForm.shopVisible} onValueChange={(v) => setPkgForm((p) => ({ ...p, shopVisible: v }))}>商店可见</Switch>
                  <span className="text-xs text-gray-400">关闭后只能后台分配</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Switch isSelected={pkgForm.autoRenew} onValueChange={(v) => setPkgForm((p) => ({ ...p, autoRenew: v }))}>自动续费</Switch>
                  <span className="text-xs text-gray-400">到期前自动扣费续期</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-gray-400">关联隧道分组</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-divider rounded-lg p-3">
                  {tunnelGroups.length === 0 && <span className="text-xs text-gray-400 col-span-full">暂无隧道分组</span>}
                  {tunnelGroups.map((tg) => (
                    <Checkbox key={tg.id} isSelected={pkgForm.tunnelGroupIds.includes(tg.id)} onValueChange={() => toggleTunnelGroup(tg.id)}>{tg.name}</Checkbox>
                  ))}
                </div>
              </div>
            </ModalBody>
          )}
          <ModalFooter>
            <Button variant="flat" onPress={() => setPkgModalOpen(false)}>取消</Button>
            <Button color="primary" isLoading={pkgSubmitLoading} onPress={handlePkgSubmit}>确定</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={pkgDeleteModalOpen} placement="center" onOpenChange={(open) => { if (!open) { setPkgDeleteModalOpen(false); setPkgToDelete(null); } }}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>确定要删除套餐"{pkgToDelete?.name}"吗？</ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setPkgDeleteModalOpen(false); setPkgToDelete(null); }}>取消</Button>
            <Button color="danger" onPress={confirmPkgDelete}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={assignOpen} placement="center" onOpenChange={(open) => { if (!open) setAssignOpen(false); }}>
        <ModalContent>
          <ModalHeader>手动分配套餐</ModalHeader>
          <ModalBody className="space-y-4">
            <Select label="选择用户" variant="bordered" selectedKeys={assignUserId ? [assignUserId] : []} onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setAssignUserId(val); }}>
              {users.map((u) => <SelectItem key={String(u.id)}>{u.name}</SelectItem>)}
            </Select>
            <Select label="选择套餐" variant="bordered" selectedKeys={assignPkgId ? [assignPkgId] : []} onSelectionChange={(keys) => { const val = Array.from(keys)[0] as string; if (val) setAssignPkgId(val); }}>
              {pkgList.map((p) => <SelectItem key={String(p.id)}>{p.name}</SelectItem>)}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setAssignOpen(false)}>取消</Button>
            <Button color="primary" isLoading={assignLoading} onPress={confirmAssign}>分配</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
