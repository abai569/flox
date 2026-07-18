import type {
  MonitorNodeInstanceGroupMemberApiItem,
  PeerShareApiItem,
  PeerShareMutationPayload,
} from "@/api/types";
import type { Node } from "./types";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  createPeerShare,
  deletePeerShare,
  getConfigByName,
  getPeerShareList,
  resetPeerShareFlow,
  updatePeerShare,
  updatePeerShareStatus,
} from "@/api";
import { calendarDateToTimestamp, timestampToCalendarDate } from "@/utils/date";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
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
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";

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
  trafficRatio: number;
  instanceTrafficRatios: Record<string, number>;
  maxBandwidthGB: number;
  portRange: string;
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
  trafficRatio: 1,
  instanceTrafficRatios: {},
  maxBandwidthGB: 0,
  portRange: "10000-20000",
  expiryTime: 0,
  allowedDomains: "",
  allowedIps: "",
});

const parsePortRange = (value: string) => {
  const match = value.trim().match(/^(\d{1,5})\s*-\s*(\d{1,5})$/);

  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);

  if (start < 1 || end > 65535 || start > end) return null;

  return { start, end };
};

const formatAddressForCell = (address?: string): string => {
  const value = address?.trim() || "";

  if (!value) return "-";
  const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);

  if (ipv4WithPort) {
    const parts = ipv4WithPort[1].split(".");

    return `${parts[0]}.${parts[1]}.*`;
  }
  if (value.includes(":")) {
    const parts = value.split(":").filter(Boolean);

    if (parts.length <= 3) return value;

    return `*:${parts.slice(-3).join(":")}`;
  }
  if (value.includes(".")) {
    const parts = value.split(".");

    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      return `${parts[0]}.${parts[1]}.*`;
    }
    if (parts.length >= 2) return `${parts.slice(0, -1).join(".")}.*`;

    return parts[0].length > 12 ? `${parts[0].slice(0, 12)}...` : parts[0];
  }

  return value.length > 15 ? `${value.slice(0, 15)}...` : value;
};

const formatTokenForCell = (token?: string): string => {
  const value = token?.trim() || "";

  if (!value) return "-";

  return `${value.slice(0, 12)}.*`;
};

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
  const [deleteTarget, setDeleteTarget] = useState<PeerShareApiItem | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<PeerShareApiItem | null>(null);
  const [statusTarget, setStatusTarget] = useState<PeerShareApiItem | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [panelAddress, setPanelAddress] = useState("");
  const displayedPanelAddress = (panelAddress || window.location.origin)
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

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

  useEffect(() => {
    if (!isOpen) return;
    const fallbackAddress = window.location.origin;

    getConfigByName("panel_domain")
      .then((res) => {
        const configured = res.code === 0 ? res.data?.value?.trim() : "";

        if (!configured) {
          setPanelAddress(fallbackAddress);

          return;
        }
        setPanelAddress(
          /^https?:\/\//i.test(configured)
            ? configured.replace(/\/$/, "")
            : `https://${configured.replace(/\/$/, "")}`,
        );
      })
      .catch(() => setPanelAddress(fallbackAddress));
  }, [isOpen]);

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
      trafficRatio: share.trafficRatio || 1,
      instanceTrafficRatios: Object.fromEntries(
        (share.instances || []).map((instance) => [
          instance.instanceId,
          instance.trafficRatio || 0,
        ]),
      ),
      maxBandwidthGB:
        share.maxBandwidth > 0
          ? Number((share.maxBandwidth / 1024 ** 3).toFixed(2))
          : 0,
      portRange: `${share.portRangeStart}-${share.portRangeEnd}`,
      expiryTime: share.expiryTime,
      allowedDomains: share.allowedDomains || "",
      allowedIps: share.allowedIps || "",
    });
    setEditing(true);
  };

  const validate = () => {
    if (!form.name.trim()) return "请输入分享名称";
    const portRange = parsePortRange(form.portRange);

    if (!portRange) return "请输入有效的端口范围，例如 10000-20000";
    if (form.maxBandwidthGB < 0) return "流量上限不能为负数";
    if (
      !Number.isFinite(form.trafficRatio) ||
      form.trafficRatio <= 0 ||
      form.trafficRatio > 100
    )
      return "分享倍率必须大于 0 且不超过 100";
    if (
      Object.values(form.instanceTrafficRatios).some(
        (ratio) => !Number.isFinite(ratio) || ratio < 0 || ratio > 100,
      )
    )
      return "实例倍率必须为 0（继承）或大于 0 且不超过 100";
    if (form.minHealthyInstances < 1) return "最少健康实例数不能小于 1";
    if (form.scopeType === "selected" && form.instanceIds.length === 0)
      return "请至少选择一个实例";
    const scopedInstanceCount =
      form.scopeType === "selected"
        ? form.instanceIds.length
        : instances.length;

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
    const portRange = parsePortRange(form.portRange);

    if (!portRange) return;
    const payload: PeerShareMutationPayload = {
      name: form.name.trim(),
      nodeId: node.id,
      maxBandwidth: Math.round(form.maxBandwidthGB * 1024 ** 3),
      expiryTime: form.expiryTime,
      portRangeStart: portRange.start,
      portRangeEnd: portRange.end,
      allowedDomains: form.allowedDomains.trim(),
      allowedIps: form.allowedIps.trim(),
      scopeType: form.scopeType,
      instanceIds: form.scopeType === "selected" ? form.instanceIds : [],
      autoIncludeNewInstances: form.autoIncludeNewInstances,
      minHealthyInstances: form.minHealthyInstances,
      trafficRatio: form.trafficRatio,
      instanceTrafficRatios: Object.fromEntries(
        instances
          .filter((instance) =>
            form.scopeType === "all_enabled"
              ? true
              : form.instanceIds.includes(instance.instanceId || ""),
          )
          .map((instance) => {
            const instanceId = instance.instanceId || "";

            return [instanceId, form.instanceTrafficRatios[instanceId] || 0];
          })
          .filter(([instanceId]) => Boolean(instanceId)),
      ),
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
      setResetTarget(null);
      await loadShares();
    } catch {
      toast.error("归零流量失败");
    } finally {
      setResettingId(null);
    }
  };

  const updateStatus = async () => {
    if (!statusTarget) return;
    const nextStatus = statusTarget.isActive === 1 ? 0 : 1;

    setStatusLoading(true);
    try {
      const res = await updatePeerShareStatus(statusTarget.id, nextStatus);

      if (res.code !== 0) {
        toast.error(res.msg || (nextStatus === 1 ? "启用分享失败" : "暂停分享失败"));
        return;
      }
      toast.success(nextStatus === 1 ? "分享已启用" : "分享已暂停");
      setStatusTarget(null);
      await loadShares();
    } catch {
      toast.error(nextStatus === 1 ? "启用分享失败" : "暂停分享失败");
    } finally {
      setStatusLoading(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <>
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      scrollBehavior="inside"
      size="4xl"
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
                共 {shares.length} 个分享，总流量{" "}
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
              {shares.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-divider">
                <table className="w-full min-w-[1010px] table-fixed text-sm">
                  <thead className="bg-default-100/70 text-xs text-default-500">
                    <tr>
                      <th className="w-[130px] px-2 py-2.5 text-left font-medium">分享名称</th>
                      <th className="w-[75px] px-2 py-2.5 text-left font-medium">实例范围</th>
                      <th className="w-[125px] px-2 py-2.5 text-right font-medium">流量</th>
                      <th className="w-[55px] px-2 py-2.5 text-center font-medium">倍率</th>
                      <th className="w-[60px] px-2 py-2.5 text-center font-medium">使用中</th>
                      <th className="w-[100px] whitespace-nowrap px-2 py-2.5 text-center font-medium">端口</th>
                      <th className="w-[85px] px-2 py-2.5 text-center font-medium">到期</th>
                      <th className="w-[100px] px-2 py-2.5 text-left font-medium">远程面板地址</th>
                      <th className="w-[115px] px-2 py-2.5 text-left font-medium">分享 Token</th>
                      <th className="w-[210px] px-2 py-2.5 text-left font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                {shares.map((share) => {
                  const summaryInstances = share.instances || [];
                  const scopedInstanceCount = summaryInstances.filter(
                    (instance) => instance.inScope,
                  ).length;
                  const selectedInstanceCount = summaryInstances.filter(
                    (instance) => instance.selected,
                  ).length;
                  return (
                    <tr
                      key={share.id}
                      className="border-t border-divider align-middle"
                    >
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${share.isActive === 1 ? "bg-success" : "bg-default-400"}`}
                            title={share.isActive === 1 ? "启用" : "停用"}
                          />
                          <span className="truncate font-medium" title={share.name}>
                            {share.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-default-600">
                        <div>{share.scopeType === "selected" ? `指定 ${selectedInstanceCount}` : "全部启用"}</div>
                        <div className="mt-0.5 text-default-400">
                          实例 {scopedInstanceCount}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <span className="text-danger-600 dark:text-danger-400">{formatTraffic(share.currentFlow || 0)}</span>
                        <span className="text-default-400"> / {share.maxBandwidth > 0 ? formatTraffic(share.maxBandwidth) : "不限"}</span>
                      </td>
                      <td className="px-3 py-3 text-center font-mono">{share.trafficRatio || 1}x</td>
                      <td className="px-3 py-3 text-center font-mono">{share.activeRuntimeNum || 0}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-center font-mono text-xs">{share.portRangeStart}-{share.portRangeEnd}</td>
                      <td className="px-3 py-3 text-center text-xs">
                        {share.expiryTime > 0 ? new Date(share.expiryTime).toLocaleDateString() : "永久"}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          className="inline-block max-w-[150px] truncate text-left font-mono text-xs text-default-700 transition-colors hover:text-primary"
                          title={displayedPanelAddress}
                          type="button"
                          onClick={() => copyValue(displayedPanelAddress, "远程面板地址")}
                        >
                          {formatAddressForCell(displayedPanelAddress)}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          className="inline-block max-w-[150px] truncate text-left font-mono text-xs text-default-700 transition-colors hover:text-primary"
                          title={share.token}
                          type="button"
                          onClick={() => copyValue(share.token, "分享 Token")}
                        >
                          {formatTokenForCell(share.token)}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-start gap-1">
                        <Button
                          className="min-h-7 px-2"
                          color="success"
                          isLoading={resettingId === share.id}
                          size="sm"
                          title="归零流量"
                          variant="flat"
                          onPress={() => setResetTarget(share)}
                        >
                          归零
                        </Button>
                        <Button
                          className="min-h-7 px-2"
                          color="primary"
                          size="sm"
                          title="编辑分享"
                          variant="flat"
                          onPress={() => beginEdit(share)}
                        >
                          编辑
                        </Button>
                        <Button
                          className="min-h-7 px-2"
                          color={share.isActive === 1 ? "warning" : "success"}
                          size="sm"
                          title={share.isActive === 1 ? "暂停分享" : "启用分享"}
                          variant="flat"
                          onPress={() => setStatusTarget(share)}
                        >
                          {share.isActive === 1 ? "暂停" : "启用"}
                        </Button>
                        <Button
                          className="min-h-7 px-2"
                          color="danger"
                          size="sm"
                          title="删除分享"
                          variant="flat"
                          onPress={() => setDeleteTarget(share)}
                        >
                          删除
                        </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                  </tbody>
                </table>
              </div>
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
    <Modal
      isDismissable={!statusLoading}
      isOpen={Boolean(statusTarget)}
      size="sm"
      onClose={() => {
        if (!statusLoading) setStatusTarget(null);
      }}
    >
      <ModalContent>
        <ModalHeader>
          {statusTarget?.isActive === 1 ? "确认暂停分享" : "确认启用分享"}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            {statusTarget?.isActive === 1
              ? `暂停“${statusTarget?.name}”后，现有运行资源将被释放，消费方将无法继续使用该分享。`
              : `确认重新启用“${statusTarget?.name}”？消费方将恢复访问该分享。`}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={statusLoading} variant="flat" onPress={() => setStatusTarget(null)}>
            取消
          </Button>
          <Button
            color={statusTarget?.isActive === 1 ? "warning" : "success"}
            isLoading={statusLoading}
            onPress={updateStatus}
          >
            确认
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    <Modal
      isDismissable={!submitting}
      isOpen={editing}
      scrollBehavior="inside"
      size="lg"
      onClose={() => {
        if (submitting) return;
        setEditing(false);
        setForm(defaultForm(node));
      }}
    >
      <ModalContent>
        <ModalHeader>{form.id ? "编辑分享" : "创建分享"}</ModalHeader>
        <ModalBody>
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
        </ModalBody>
      </ModalContent>
    </Modal>
    <Modal
      isDismissable={resettingId === null}
      isOpen={Boolean(resetTarget)}
      size="sm"
      onClose={() => {
        if (resettingId === null) setResetTarget(null);
      }}
    >
      <ModalContent>
        <ModalHeader>确认归零流量</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            确认将“{resetTarget?.name}”的分享流量归零？此操作不可撤销。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={resettingId !== null} variant="flat" onPress={() => setResetTarget(null)}>
            取消
          </Button>
          <Button
            color="success"
            isLoading={resettingId !== null}
            onPress={() => resetTarget && resetFlow(resetTarget)}
          >
            确认
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    <Modal
      isDismissable={!deleteLoading}
      isOpen={Boolean(deleteTarget)}
      size="sm"
      onClose={() => {
        if (!deleteLoading) setDeleteTarget(null);
      }}
    >
      <ModalContent>
        <ModalHeader>确认删除分享</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-600">
            确认删除“{deleteTarget?.name}”？相关远程 Runtime 将停止，此操作不可撤销。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={deleteLoading} variant="flat" onPress={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button color="danger" isLoading={deleteLoading} onPress={handleDelete}>
            确认
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
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
  const scopedInstances = instances.filter((instance) =>
    form.scopeType === "all_enabled"
      ? true
      : form.instanceIds.includes(instance.instanceId || ""),
  );

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="text-sm font-medium text-default-700">基础设置</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="分享名称"
            value={form.name}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
          />
          <Input
            description="应用于这份分享中的所有实例"
            label="默认流量倍率"
            max="100"
            min="0.01"
            step="0.1"
            type="number"
            value={String(form.trafficRatio)}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                trafficRatio: Number(event.target.value),
              }))
            }
          />
          <Input
            description="格式：10000-20000"
            label="端口范围"
            placeholder="10000-20000"
            value={form.portRange}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, portRange: event.target.value }))
            }
          />
          <Input
            description="0 表示不限流量"
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
          <div className="sm:col-span-2">
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
          </div>
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
      </section>

      <section className="space-y-3 border-t border-divider pt-4">
        <div className="text-sm font-medium text-default-700">实例范围</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            description="可用实例少于此数量时，拒绝部署"
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
          <Select
            description="仅用于全部启用实例范围"
            isDisabled={form.scopeType !== "all_enabled"}
            label="自动包含新实例"
            selectedKeys={[form.autoIncludeNewInstances ? "yes" : "no"]}
            onSelectionChange={(keys) => {
              const key = String(Array.from(keys as Set<React.Key>)[0] || "no");

              setForm((prev) => ({
                ...prev,
                autoIncludeNewInstances: key === "yes",
              }));
            }}
          >
            <SelectItem key="yes">是</SelectItem>
            <SelectItem key="no">否</SelectItem>
          </Select>
        </div>
        <div>
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
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-divider p-3">
            {instances.length === 0 ? (
              <div className="text-sm text-default-500">暂无可选实例</div>
            ) : (
              instances.map((instance) => {
                const id = instance.instanceId || "";
                const name =
                  instance.displayName?.trim() ||
                  (instance.displayIndex != null && instance.displayIndex > 0
                    ? `实例 ${instance.displayIndex}`
                    : "未命名实例");

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
                      <span className="font-medium">{name}</span>
                      {id ? <span className="ml-1 font-mono text-xs text-default-500">({id})</span> : null}
                      <span className="ml-1">· {instance.status === 1 ? "在线" : "离线"} · 权重 {instance.weight ?? 0}</span>
                    </span>
                  </Checkbox>
                );
              })
            )}
          </div>
        )}
        {scopedInstances.length > 1 && (
          <div className="space-y-3 rounded-md border border-divider p-3">
            <div className="text-sm font-medium">实例倍率覆盖（可选）</div>
            <div className="text-xs text-default-500">
              仅填写需要单独计费的实例，0 表示使用默认流量倍率
            </div>
            <div className="space-y-2">
              {scopedInstances.map((instance) => {
                  const instanceId = instance.instanceId || "";
                  const instanceName =
                    instance.displayName?.trim() ||
                    (instance.displayIndex != null && instance.displayIndex > 0
                      ? `实例 ${instance.displayIndex}`
                      : "未命名实例");

                  return (
                    <Input
                      key={instanceId}
                      isDisabled={!instanceId}
                      label={instanceName}
                      description={instanceId || "实例 ID 缺失"}
                      max="100"
                      min="0"
                      step="0.1"
                      type="number"
                      value={String(
                        form.instanceTrafficRatios[instanceId] || 0,
                      )}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          instanceTrafficRatios: {
                            ...prev.instanceTrafficRatios,
                            [instanceId]: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  );
                })}
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2 border-t border-divider pt-4">
        <Button isDisabled={submitting} variant="flat" onPress={onCancel}>
          取消
        </Button>
        <Button color="primary" isLoading={submitting} onPress={onSubmit}>
          {form.id ? "保存" : "创建"}
        </Button>
      </div>
    </div>
  );
}
