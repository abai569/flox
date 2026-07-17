import type {
  MonitorNodeInstanceGroupMemberApiItem,
  PeerShareApiItem,
  PeerShareMutationPayload,
} from "@/api/types";
import type { Node } from "./types";

import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  createPeerShare,
  deletePeerShare,
  getPeerShareList,
  resetPeerShareFlow,
  updatePeerShare,
} from "@/api";
import { calendarDateToTimestamp, timestampToCalendarDate } from "@/utils/date";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { DatePicker } from "@/shadcn-bridge/heroui/date-picker";
import { DatePresets } from "@/shadcn-bridge/heroui/date-presets";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Switch } from "@/shadcn-bridge/heroui/switch";

interface NodeSharingModalProps {
  node: Node | null;
  instances: MonitorNodeInstanceGroupMemberApiItem[];
  isOpen: boolean;
  onClose: () => void;
  onShareCountChange: (nodeId: number, count: number) => void;
  formatTraffic: (bytes: number) => string;
}

interface ShareForm {
  id?: number;
  name: string;
  scopeType: "all_enabled" | "selected";
  instanceIds: string[];
  autoIncludeNewInstances: boolean;
  minHealthyInstances: number;
  maxBandwidthGB: number;
  portRangeStart: number;
  portRangeEnd: number;
  expiryTime: number;
  allowedDomains: string;
  allowedIps: string;
}

const defaultForm = (node?: Node | null): ShareForm => ({
  name: node ? `${node.name} 分享` : "",
  scopeType: "all_enabled",
  instanceIds: [],
  autoIncludeNewInstances: true,
  minHealthyInstances: 1,
  maxBandwidthGB: 0,
  portRangeStart: 10000,
  portRangeEnd: 20000,
  expiryTime: 0,
  allowedDomains: "",
  allowedIps: "",
});

export function NodeSharingModal({
  node,
  instances,
  isOpen,
  onClose,
  onShareCountChange,
  formatTraffic,
}: NodeSharingModalProps) {
  const [shares, setShares] = useState<PeerShareApiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ShareForm>(() => defaultForm(node));
  const [editing, setEditing] = useState(false);
  const [visibleTokens, setVisibleTokens] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<PeerShareApiItem | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);

  const loadShares = useCallback(async () => {
    if (!node) return;
    setLoading(true);
    try {
      const res = await getPeerShareList();

      if (res.code !== 0) {
        toast.error(res.msg || "加载分享失败");

        return;
      }
      const filtered = (Array.isArray(res.data) ? res.data : []).filter(
        (share) => share.nodeId === node.id,
      );

      setShares(filtered);
      onShareCountChange(node.id, filtered.length);
    } catch {
      toast.error("加载分享失败");
    } finally {
      setLoading(false);
    }
  }, [node, onShareCountChange]);

  useEffect(() => {
    if (!isOpen || !node) return;
    setEditing(false);
    setForm(defaultForm(node));
    setDeleteTarget(null);
    void loadShares();
  }, [isOpen, node, loadShares]);

  const beginEdit = (share: PeerShareApiItem) => {
    setForm({
      id: share.id,
      name: share.name,
      scopeType: share.scopeType || "all_enabled",
      instanceIds: (share.instances || [])
        .filter((instance) => instance.selected)
        .map((instance) => instance.instanceId),
      autoIncludeNewInstances:
        share.autoIncludeNewInstances === undefined
          ? true
          : Number(share.autoIncludeNewInstances) === 1,
      minHealthyInstances: share.minHealthyInstances || 1,
      maxBandwidthGB:
        share.maxBandwidth > 0
          ? Number((share.maxBandwidth / 1024 ** 3).toFixed(2))
          : 0,
      portRangeStart: share.portRangeStart,
      portRangeEnd: share.portRangeEnd,
      expiryTime: share.expiryTime,
      allowedDomains: share.allowedDomains || "",
      allowedIps: share.allowedIps || "",
    });
    setEditing(true);
  };

  const validate = () => {
    if (!form.name.trim()) return "请输入分享名称";
    if (
      form.portRangeStart < 1 ||
      form.portRangeEnd > 65535 ||
      form.portRangeStart > form.portRangeEnd
    )
      return "请输入有效的端口范围";
    if (form.maxBandwidthGB < 0) return "流量上限不能为负数";
    if (form.minHealthyInstances < 1) return "最少健康实例数不能小于 1";
    if (form.scopeType === "selected" && form.instanceIds.length === 0)
      return "请至少选择一个实例";
    const scopedInstanceCount =
      form.scopeType === "selected" ? form.instanceIds.length : instances.length;
    if (
      scopedInstanceCount > 0 &&
      form.minHealthyInstances > scopedInstanceCount
    )
      return "最少健康实例数不能超过当前实例范围";

    return "";
  };

  const handleSubmit = async () => {
    if (!node) return;
    const error = validate();

    if (error) {
      toast.error(error);

      return;
    }
    const payload: PeerShareMutationPayload = {
      name: form.name.trim(),
      nodeId: node.id,
      maxBandwidth: Math.round(form.maxBandwidthGB * 1024 ** 3),
      expiryTime: form.expiryTime,
      portRangeStart: form.portRangeStart,
      portRangeEnd: form.portRangeEnd,
      allowedDomains: form.allowedDomains.trim(),
      allowedIps: form.allowedIps.trim(),
      scopeType: form.scopeType,
      instanceIds: form.scopeType === "selected" ? form.instanceIds : [],
      autoIncludeNewInstances: form.autoIncludeNewInstances,
      minHealthyInstances: form.minHealthyInstances,
    };

    setSubmitting(true);
    try {
      const res = form.id
        ? await updatePeerShare({ ...payload, id: form.id })
        : await createPeerShare(payload);

      if (res.code !== 0) {
        toast.error(res.msg || (form.id ? "保存分享失败" : "创建分享失败"));

        return;
      }
      toast.success(form.id ? "分享已更新" : "分享已创建");
      setEditing(false);
      setForm(defaultForm(node));
      await loadShares();
    } catch {
      toast.error(form.id ? "保存分享失败" : "创建分享失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !node) return;
    setDeleteLoading(true);
    try {
      const res = await deletePeerShare(deleteTarget.id);

      if (res.code !== 0) {
        toast.error(res.msg || "删除分享失败");

        return;
      }
      toast.success("分享已删除");
      setDeleteTarget(null);
      await loadShares();
    } catch {
      toast.error("删除分享失败");
    } finally {
      setDeleteLoading(false);
    }
  };

  const resetFlow = async (share: PeerShareApiItem) => {
    setResettingId(share.id);
    try {
      const res = await resetPeerShareFlow(share.id);

      if (res.code !== 0) {
        toast.error(res.msg || "归零流量失败");

        return;
      }
      toast.success("分享流量已归零");
      await loadShares();
    } catch {
      toast.error("归零流量失败");
    } finally {
      setResettingId(null);
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token 已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      scrollBehavior="inside"
      size="lg"
      onClose={onClose}
    >
      <ModalContent>
        <ModalHeader className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate">{node?.name || "节点"} 分享</span>
          {!editing && (
            <Button
              className="shrink-0"
              color="primary"
              size="sm"
              onPress={() => {
                setForm(defaultForm(node));
                setEditing(true);
              }}
            >
              创建分享
            </Button>
          )}
        </ModalHeader>
        <ModalBody className="space-y-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="text-sm text-default-500">
                共 {shares.length} 份分享，总流量{" "}
                {formatTraffic(
                  shares.reduce(
                    (sum, share) => sum + (share.currentFlow || 0),
                    0,
                  ),
                )}
              </div>

              {shares.length === 0 && !editing ? (
                <div className="rounded-md border border-dashed border-divider p-8 text-center text-sm text-default-500">
                  该节点暂无分享
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {shares.map((share) => {
                  const summaryInstances = share.instances || [];
                  const scopedInstanceCount = summaryInstances.filter(
                    (instance) => instance.inScope,
                  ).length;
                  const selectedInstanceCount = summaryInstances.filter(
                    (instance) => instance.selected,
                  ).length;
                  const runtimeInstances = share.usedPortDetails.flatMap(
                    (detail) => detail.instances || [],
                  );
                  const deployedInstances = new Set(
                    runtimeInstances
                      .filter((instance) => instance.applied === 1)
                      .map((instance) => instance.instanceId),
                  );

                  return (
                    <div
                      key={share.id}
                      className="min-w-0 rounded-md border border-divider p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">
                            {share.name}
                          </div>
                          <div className="mt-1 text-xs text-default-500">
                            {share.scopeType === "selected"
                              ? `指定 ${selectedInstanceCount} 个实例`
                              : "全部启用实例"}
                          </div>
                        </div>
                        <Chip
                          color={share.isActive === 1 ? "success" : "default"}
                          size="sm"
                          variant="flat"
                        >
                          {share.isActive === 1 ? "启用" : "停用"}
                        </Chip>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <Info
                          label="流量"
                          value={`${formatTraffic(share.currentFlow || 0)} / ${share.maxBandwidth > 0 ? formatTraffic(share.maxBandwidth) : "不限"}`}
                        />
                        <Info
                          label="Runtime"
                          value={String(share.activeRuntimeNum || 0)}
                        />
                        <Info
                          label="端口"
                          value={`${share.portRangeStart}-${share.portRangeEnd}`}
                        />
                        <Info
                          label="到期"
                          value={
                            share.expiryTime > 0
                              ? new Date(share.expiryTime).toLocaleDateString()
                              : "永久"
                          }
                        />
                      </div>
                      <div className="mt-3 flex min-w-0 items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-default-100 px-2 py-1.5 text-xs">
                          {visibleTokens.has(share.id)
                            ? share.token
                            : "•".repeat(24)}
                        </code>
                        <Button
                          isIconOnly
                          size="sm"
                          title={
                            visibleTokens.has(share.id)
                              ? "隐藏 Token"
                              : "显示 Token"
                          }
                          variant="flat"
                          onPress={() =>
                            setVisibleTokens((prev) => {
                              const next = new Set(prev);

                              next.has(share.id)
                                ? next.delete(share.id)
                                : next.add(share.id);

                              return next;
                            })
                          }
                        >
                          {visibleTokens.has(share.id) ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          isIconOnly
                          size="sm"
                          title="复制 Token"
                          variant="flat"
                          onPress={() => copyToken(share.token)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 rounded-md bg-default-100/50 p-2 text-xs text-default-600">
                        实例{" "}
                        {scopedInstanceCount}{" "}
                        · 已部署{" "}
                        {deployedInstances.size}{" "}
                        · Runtime{" "}
                        {share.activeRuntimeNum || 0}
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                          isIconOnly
                          isLoading={resettingId === share.id}
                          size="sm"
                          title="归零流量"
                          variant="flat"
                          onPress={() => resetFlow(share)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          className="min-h-8 px-3"
                          color="primary"
                          size="sm"
                          title="编辑分享"
                          variant="flat"
                          onPress={() => beginEdit(share)}
                        >
                          编辑
                        </Button>
                        <Button
                          isIconOnly
                          color="danger"
                          size="sm"
                          title="删除分享"
                          variant="flat"
                          onPress={() => setDeleteTarget(share)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {deleteTarget && (
                <div className="rounded-md border border-danger-300/60 bg-danger-50 p-4 dark:bg-danger-100/10">
                  <div className="font-medium text-danger">
                    确认删除“{deleteTarget.name}”？
                  </div>
                  <div className="mt-1 text-sm text-default-600">
                    相关远程 Runtime 将停止，此操作不可撤销。
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      isDisabled={deleteLoading}
                      size="sm"
                      variant="flat"
                      onPress={() => setDeleteTarget(null)}
                    >
                      取消
                    </Button>
                    <Button
                      color="danger"
                      isLoading={deleteLoading}
                      size="sm"
                      onPress={handleDelete}
                    >
                      确认删除
                    </Button>
                  </div>
                </div>
              )}

              {editing && (
                <ShareEditor
                  form={form}
                  instances={instances}
                  setForm={setForm}
                  submitting={submitting}
                  onCancel={() => {
                    setEditing(false);
                    setForm(defaultForm(node));
                  }}
                  onSubmit={handleSubmit}
                />
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            isDisabled={submitting || deleteLoading}
            variant="flat"
            onPress={onClose}
          >
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ShareEditor({
  form,
  instances,
  submitting,
  setForm,
  onCancel,
  onSubmit,
}: {
  form: ShareForm;
  instances: MonitorNodeInstanceGroupMemberApiItem[];
  submitting: boolean;
  setForm: React.Dispatch<React.SetStateAction<ShareForm>>;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const scopedInstanceCount =
    form.scopeType === "selected" ? form.instanceIds.length : instances.length;

  return (
    <section className="rounded-md border border-primary-300/50 p-4">
      <h3 className="mb-4 font-semibold">
        {form.id ? "编辑分享" : "创建分享"}
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label="分享名称"
          value={form.name}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, name: event.target.value }))
          }
        />
        <Input
          label="最少健康实例"
          max={scopedInstanceCount || undefined}
          min="1"
          type="number"
          value={String(form.minHealthyInstances)}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              minHealthyInstances: Math.min(
                Number(event.target.value) || 1,
                scopedInstanceCount || 1,
              ),
            }))
          }
        />
        <div className="md:col-span-2">
          <div className="mb-2 text-sm text-default-600">实例范围</div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              color={form.scopeType === "all_enabled" ? "primary" : "default"}
              variant="flat"
              onPress={() =>
                setForm((prev) => ({
                  ...prev,
                  scopeType: "all_enabled",
                  minHealthyInstances: Math.min(
                    prev.minHealthyInstances,
                    instances.length || 1,
                  ),
                }))
              }
            >
              全部启用实例
            </Button>
            <Button
              color={form.scopeType === "selected" ? "primary" : "default"}
              variant="flat"
              onPress={() =>
                setForm((prev) => ({
                  ...prev,
                  scopeType: "selected",
                  minHealthyInstances: Math.min(
                    prev.minHealthyInstances,
                    prev.instanceIds.length || 1,
                  ),
                }))
              }
            >
              指定实例
            </Button>
          </div>
        </div>
        {form.scopeType === "selected" && (
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-divider p-3 md:col-span-2">
            {instances.length === 0 ? (
              <div className="text-sm text-default-500">暂无可选实例</div>
            ) : (
              instances.map((instance) => {
                const id = instance.instanceId || "";

                return (
                  <Checkbox
                    key={id}
                    isDisabled={!id}
                    isSelected={form.instanceIds.includes(id)}
                    onValueChange={(selected) =>
                      setForm((prev) => ({
                        ...prev,
                        instanceIds: selected
                          ? [...prev.instanceIds, id]
                          : prev.instanceIds.filter((item) => item !== id),
                        minHealthyInstances: selected
                          ? prev.minHealthyInstances
                          : Math.min(
                              prev.minHealthyInstances,
                              Math.max(1, prev.instanceIds.length - 1),
                            ),
                      }))
                    }
                  >
                    <span className="break-all">
                      {instance.displayName ||
                        instance.instanceId ||
                        "未命名实例"}{" "}
                      · {instance.status === 1 ? "在线" : "离线"} · 权重{" "}
                      {instance.weight ?? 0}
                    </span>
                  </Checkbox>
                );
              })
            )}
          </div>
        )}
        <div className="flex items-center justify-between rounded-md border border-divider p-3 md:col-span-2">
          <div>
            <div className="text-sm font-medium">自动包含新实例</div>
            <div className="text-xs text-default-500">
              仅用于全部启用实例范围
            </div>
          </div>
          <Switch
            isDisabled={form.scopeType !== "all_enabled"}
            isSelected={form.autoIncludeNewInstances}
            onValueChange={(autoIncludeNewInstances) =>
              setForm((prev) => ({ ...prev, autoIncludeNewInstances }))
            }
          />
        </div>
        <Input
          label="流量上限 (GB)"
          min="0"
          type="number"
          value={String(form.maxBandwidthGB)}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              maxBandwidthGB: Number(event.target.value) || 0,
            }))
          }
        />
        <DatePicker
          showMonthAndYearPickers
          description="留空表示永久"
          label="到期时间"
          permanentLabel="永久"
          value={timestampToCalendarDate(form.expiryTime || null)}
          onChange={(date) =>
            setForm((prev) => ({
              ...prev,
              expiryTime: calendarDateToTimestamp(date) || 0,
            }))
          }
        >
          <DatePresets
            onChange={(expiryTime) =>
              setForm((prev) => ({ ...prev, expiryTime }))
            }
          />
        </DatePicker>
        <Input
          label="起始端口"
          max="65535"
          min="1"
          type="number"
          value={String(form.portRangeStart)}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              portRangeStart: Number(event.target.value) || 0,
            }))
          }
        />
        <Input
          label="结束端口"
          max="65535"
          min="1"
          type="number"
          value={String(form.portRangeEnd)}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              portRangeEnd: Number(event.target.value) || 0,
            }))
          }
        />
        <Input
          description="逗号分隔，留空不限制"
          label="来源域名白名单"
          value={form.allowedDomains}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, allowedDomains: event.target.value }))
          }
        />
        <Input
          description="支持 IPv4、IPv6 与 CIDR"
          label="API IP 白名单"
          value={form.allowedIps}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, allowedIps: event.target.value }))
          }
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button isDisabled={submitting} variant="flat" onPress={onCancel}>
          取消
        </Button>
        <Button color="primary" isLoading={submitting} onPress={onSubmit}>
          {form.id ? "保存" : "创建"}
        </Button>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-default-100/50 p-2">
      <div className="text-xs text-default-500">{label}</div>
      <div className="mt-0.5 truncate text-sm" title={value}>
        {value}
      </div>
    </div>
  );
}
