import type { MonitorNodeInstanceGroupMemberApiItem } from "@/api/types";
import type { Node, NodeExpiryInstance } from "./types";

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useRef, useEffect } from "react";
import { GripVertical } from "lucide-react";

import {
  deriveNodeVisualState,
  getRemoteDisplayMeta,
  getRemoteDisplayState,
  isInstanceTrafficLimitExceeded,
  type RemoteDisplayState,
} from "./display";
import { getNodeRenewalSnapshot, formatNodeRenewalTime } from "./renewal";

import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/shadcn-bridge/heroui/dropdown";
// 🎯 补全了 Select 相关的导入
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { StatusDot } from "@/components/status-dot";
import { CountryFlag } from "@/components/country-flag";
import { formatRemoteDisplayText } from "@/utils/remoteDisplay";
import {
  DistroIcon,
  parseDistroFromVersion,
  getDistroColor,
} from "@/components/distro-icon";
import { MonitorTerminalButton } from "@/pages/monitor-terminal";
import { SmartTooltip } from "@/components/smart-tooltip";
interface RealtimeInstanceMetric {
  uploadTraffic: number;
  downloadTraffic: number;
  tcpConns: number;
  udpConns: number;
  periodTraffic?: {
    rx: number;
    tx: number;
  };
}
interface NodeUpgradeProgress {
  stage: string;
  percent: number;
  message: string;
}
interface NodeListViewProps {
  displayNodes: Node[];
  realtimeNodeMetrics: Record<
    number,
    {
      uploadTraffic: number;
      downloadTraffic: number;
      periodTraffic?: {
        rx: number;
        tx: number;
        since: number;
        nextReset?: number;
        cycle?: string;
      };
    }
  >;
  upgradeProgress: Record<
    number,
    { stage: string; percent: number; message: string }
  >;
  selectedIds: Set<number>;
  toggleSelect: (nodeId: number) => void;
  toggleSelectAll: (isSelected: boolean) => void;
  copyToClipboard: (text: string, label: string) => void;
  openInstallSelector: (node: Node) => void;
  openUpgradeModal: (type: "single" | "batch", nodeId?: number) => void;
  handleEdit: (node: Node) => void;
  handleDelete: (node: Node) => void;
  formatTraffic: (bytes: number) => string;
  nodeGroups: any[];
  filterGroupId: number | null;
  setFilterGroupId: (id: number | null) => void;
  handleDismissExpiryReminder?: (nodeId: number, instanceId?: string) => void;
  // 新增三种对接方式的处理函数
  handleCopyOverseasInstallCommand?: (node: Node) => void;
  handleCopyOfflineInstallCommand?: (node: Node) => void;
  handleCopyAutoInstallCommand?: (node: Node) => void;
  // 新增：点击流量图标查看流量记录
  handleViewNodeTrafficLogs?: (node: Node) => void;
  // 新增：归零节点流量
  handleResetNodeTraffic?: (node: Node) => void;
  // 新增：暂停/启用节点
  handleTogglePause?: (node: Node) => void;
  nodeFilterMode?: any;
  setNodeFilterMode?: (mode: any) => void;
  nodeExpiryStats?: any;
  nodeInstanceMembers?: Record<number, MonitorNodeInstanceGroupMemberApiItem[]>;
  realtimeNodeInstanceMetrics?: Record<string, RealtimeInstanceMetric>;
  onConfigureInstance?: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onDeleteInstance?: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onResetInstanceTraffic?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onToggleInstancePause?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onCrossBorderRecheck: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onCrossBorderCorrect: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  crossBorderRecheckingKeys: Set<string>;
  onReorderInstances: (
    nodeId: number,
    activeInstanceId: string,
    overInstanceId: string,
  ) => void;
  onInstallMimicDeps?: (node: Node) => void;
  onShareNode: (node: Node) => void;
  onViewRemoteDetail: (node: Node) => void;
  shareCounts: Record<number, number>;
  remoteUsageByNode: Record<
    number,
    {
      usedPorts: number[];
      portRangeStart: number;
      portRangeEnd: number;
    }
  >;
}

const NODE_GROUP_NONE = -1;
const NODE_GROUP_REMOTE = -2;

const getRemoteExpiryChipProps = (timestamp?: number) => {
  if (timestamp == null) {
    return {
      label: "-",
      className: "text-default-400",
    };
  }
  if (timestamp <= 0) {
    return {
      label: "永久",
      className: "bg-success-500/10 text-success-600 dark:text-success-400",
    };
  }
  const expiry = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
  const days = Math.ceil((expiry - Date.now()) / 86400000);

  return {
    label: new Date(expiry).toLocaleDateString("zh-CN"),
    className:
      days <= 0
        ? "bg-danger-500/10 text-danger-600 dark:text-danger-400"
        : days <= 7
          ? "bg-warning-500/10 text-warning-600 dark:text-warning-400"
          : "bg-success-500/10 text-success-600 dark:text-success-400",
  };
};

const NODE_INSTANCE_EXPANDED_STORAGE_KEY = "node-instance-expanded-node-ids";

const readExpandedNodeIds = (): Set<number> => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(NODE_INSTANCE_EXPANDED_STORAGE_KEY) || "[]",
    );

    return new Set(
      Array.isArray(stored)
        ? stored.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [],
    );
  } catch {
    return new Set();
  }
};

const formatInstanceIPForCell = (ip?: string): string => {
  const rawValue = ip?.trim() || "";

  if (!rawValue) return "-";
  const value = rawValue
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/, 1)[0]
    .replace(/:\d+$/, "");

  if (!value) return "-";
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

const getInstanceLabel = (
  member?: MonitorNodeInstanceGroupMemberApiItem | null,
) => {
  if (!member) return "实例";
  const displayName = member.displayName?.trim();

  if (displayName) return displayName;

  return member.displayIndex
    ? `实例 ${member.displayIndex}`
    : member.instanceId || "实例";
};

type RemoteInstance = NonNullable<Node["remoteInstances"]>[number];

function NodeTableColGroup() {
  return (
    <colgroup>
      <col className="w-[50px]" />
      <col className="w-[50px]" />
      <col className="w-[64px]" />
      <col className="w-[70px]" />
      <col className="w-[90px]" />
      <col className="w-[50px]" />
      <col className="w-[100px]" />
      <col className="w-[130px]" />
      <col className="w-[70px]" />
      <col className="w-[120px]" />
      <col className="w-[110px]" />
      <col className="w-[110px]" />
      <col className="w-[100px]" />
      <col className="w-[110px]" />
      <col className="w-[130px]" />
      <col className="w-[270px]" />
    </colgroup>
  );
}

function RemoteNodeTableColGroup() {
  return (
    <colgroup>
      <col className="w-[50px]" />
      <col className="w-[50px]" />
      <col className="w-[64px]" />
      <col className="w-[70px]" />
      <col className="w-[90px]" />
      <col className="w-[50px]" />
      <col className="w-[100px]" />
      <col className="w-[130px]" />
      <col className="w-[70px]" />
      <col className="w-[120px]" />
      <col className="w-[110px]" />
      <col className="w-[110px]" />
      <col className="w-[100px]" />
      <col className="w-[110px]" />
      <col className="w-[130px]" />
      <col className="w-[270px]" />
    </colgroup>
  );
}

const getRemoteInstanceLabel = (instance: RemoteInstance) => {
  const displayName = instance.displayName?.trim();

  if (displayName) return displayName;
  if (instance.displayIndex != null) return `实例 ${instance.displayIndex}`;

  return "实例";
};

const formatCountryCity = (region?: string): string => {
  const parts = region?.trim().split(/\s+/).filter(Boolean) || [];

  if (parts.length <= 2) return parts.join(" ");
  const country = ["香港", "澳门", "台湾"].includes(parts[0])
    ? "中国"
    : parts[0];

  if (parts.includes("香港")) return "中国 香港";
  if (parts.includes("澳门")) return "中国 澳门";
  if (parts.includes("台湾")) {
    const cityParts = parts
      .slice(1)
      .filter((part) => !["中国", "台湾"].includes(part));
    const city = cityParts.length ? cityParts[cityParts.length - 1] : "";

    return city ? `中国 ${city}` : "中国 台湾";
  }
  if (country === "日本" && parts[1]) return `日本 ${parts[1]}`;
  const cityParts = parts.slice(1);
  const city = cityParts.length ? cityParts[cityParts.length - 1] : "";

  return city ? `${country} ${city}` : country;
};

type InstanceIPRegionMember = Pick<
  MonitorNodeInstanceGroupMemberApiItem,
  | "publicIpV4"
  | "publicIpV6"
  | "publicIpV4Region"
  | "publicIpV4CountryCode"
  | "publicIpV6Region"
  | "publicIpV6CountryCode"
  | "networkRegion"
  | "crossBorderStatus"
  | "crossBorderError"
  | "crossBorderCheckedAt"
  | "crossBorderObservationUntil"
>;

function instanceCrossBorderMeta(member: InstanceIPRegionMember) {
  switch (member.crossBorderStatus) {
    case "healthy":
      return { color: "bg-success", label: "跨境连通正常" };
    case "blocked":
      return { color: "bg-danger", label: "被墙，实例已隔离" };
    case "reverse_blocked":
      return { color: "bg-warning", label: "反向墙，实例已隔离" };
    case "restore_blocked":
      return {
        color: "bg-warning",
        label: "换 IP 检测通过，但实例仍受其他限制并保持隔离",
      };
    case "observing":
      return { color: "bg-primary", label: "观察期" };
    case "pending_failure":
      return { color: "bg-warning", label: "正在检测" };
    default:
      return { color: "bg-default-400", label: "跨境状态未知" };
  }
}

const formatCrossBorderTime = (timestamp?: number): string => {
  if (!timestamp || timestamp <= 0) return "-";
  const value = timestamp < 100000000000 ? timestamp * 1000 : timestamp;

  return new Date(value).toLocaleString("zh-CN");
};

const isActiveCrossBorderObservation = (
  member: Pick<
    InstanceIPRegionMember,
    "crossBorderStatus" | "crossBorderObservationUntil"
  >,
): boolean => {
  const observationUntil = member.crossBorderObservationUntil ?? 0;
  const observationUntilMs =
    observationUntil < 100000000000 ? observationUntil * 1000 : observationUntil;

  return member.crossBorderStatus === "observing" && observationUntilMs > Date.now();
};

function CrossBorderStatusPopover({
  member,
  onRecheck,
  onCorrect,
  isRechecking,
}: {
  member: InstanceIPRegionMember;
  onRecheck?: () => void;
  onCorrect?: () => void;
  isRechecking?: boolean;
}) {
  const meta = instanceCrossBorderMeta(member);
  const blocked = ["blocked", "reverse_blocked"].includes(
    member.crossBorderStatus || "",
  );
  const observing = isActiveCrossBorderObservation(member);
  const canRecheck = member.crossBorderStatus !== "healthy";

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          isIconOnly
          aria-label={`查看跨境检测详情：${meta.label}`}
          className="h-6 w-6 min-w-6 rounded-full bg-transparent p-0 hover:bg-default-200/70"
          size="sm"
          variant="light"
          onClick={(event) => event.stopPropagation()}
        >
          <span
            aria-hidden="true"
            className={`inline-block size-2.5 rounded-full ${meta.color}`}
          />
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="跨境检测详情">
        <DropdownMenuLabel className="w-72 space-y-2 p-3 font-normal">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className={`inline-block size-2.5 rounded-full ${meta.color}`} />
            <span>{meta.label}</span>
          </div>
          <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-xs text-default-600">
            <dt>错误</dt>
            <dd className="break-words text-foreground">
              {member.crossBorderError || "-"}
            </dd>
            <dt>检测时间</dt>
            <dd className="text-foreground">
              {formatCrossBorderTime(member.crossBorderCheckedAt)}
            </dd>
            {observing ? (
              <>
                <dt>观察截止</dt>
                <dd className="text-foreground">
                  {formatCrossBorderTime(member.crossBorderObservationUntil)}
                </dd>
              </>
            ) : null}
          </dl>
          {observing ? (
            <p className="text-xs leading-5 text-primary-600 dark:text-primary-300">
              观察期内仅告警不隔离
            </p>
          ) : null}
          {canRecheck && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                className="h-7 px-2 text-xs"
                color="primary"
                isDisabled={isRechecking}
                isLoading={isRechecking}
                size="sm"
                variant="flat"
                onPress={(event) => {
                  event.stopPropagation();
                  onRecheck?.();
                }}
              >
                重新检测
              </Button>
              {blocked ? (
                <Button
                  className="h-7 px-2 text-xs"
                  color="warning"
                  size="sm"
                  variant="flat"
                  onPress={(event) => {
                    event.stopPropagation();
                    onCorrect?.();
                  }}
                >
                  误判纠正
                </Button>
              ) : null}
            </div>
          )}
        </DropdownMenuLabel>
      </DropdownMenu>
    </Dropdown>
  );
}

function InstanceIPRegionCell({
  member,
  copyToClipboard,
  onCrossBorderRecheck,
  onCrossBorderCorrect,
  isCrossBorderRechecking,
}: {
  member: InstanceIPRegionMember;
  copyToClipboard: (text: string, label: string) => void;
  onCrossBorderRecheck?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onCrossBorderCorrect?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  isCrossBorderRechecking?: boolean;
}) {
  const probeAddressKey = member.publicIpV4?.trim() ? "v4" : "v6";
  const rows = [
    {
      key: "v4",
      ip: member.publicIpV4?.trim() || "",
      region: formatCountryCity(member.publicIpV4Region),
      countryCode: member.publicIpV4CountryCode,
      label: "IPv4",
    },
    {
      key: "v6",
      ip: member.publicIpV6?.trim() || "",
      region: formatCountryCity(member.publicIpV6Region),
      countryCode: member.publicIpV6CountryCode,
      label: "IPv6",
    },
  ].filter((item) => item.ip || item.region);

  return (
    <td className="px-1 py-2.5 text-left align-middle text-xs text-default-600">
      {rows.length === 0 ? (
        <span className="text-default-300">-</span>
      ) : (
        <div className="space-y-1">
          {rows.map((item) => (
            <div
              key={item.key}
              className="flex min-w-0 items-center justify-start gap-1.5 whitespace-nowrap"
            >
              {item.region ? (
                <CountryFlag code={item.countryCode} title={item.region} />
              ) : null}
              {item.ip ? (
                <SmartTooltip content={item.ip}>
                  <button
                    className="inline-block min-w-0 max-w-[108px] truncate rounded bg-transparent px-0.5 text-right font-mono text-xs leading-5 text-default-600 transition-colors hover:bg-default-200/50 hover:text-primary"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      copyToClipboard(item.ip, item.label);
                    }}
                  >
                    {formatInstanceIPForCell(item.ip)}
                  </button>
                </SmartTooltip>
              ) : null}
              {item.ip &&
              item.key === probeAddressKey &&
              member.networkRegion === "overseas" ? (
                <CrossBorderStatusPopover
                  isRechecking={isCrossBorderRechecking}
                  member={member}
                  onCorrect={
                    onCrossBorderCorrect
                      ? () =>
                          onCrossBorderCorrect(
                            member as MonitorNodeInstanceGroupMemberApiItem,
                          )
                      : undefined
                  }
                  onRecheck={
                    onCrossBorderRecheck
                      ? () =>
                          onCrossBorderRecheck(
                            member as MonitorNodeInstanceGroupMemberApiItem,
                          )
                      : undefined
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </td>
  );
}

function RemoteNodeInstanceRows({
  instances,
  parentOnline,
  parentState,
  parentTotalInFlow,
  parentTotalOutFlow,
  parentTrafficRatio,
  formatTraffic,
  copyToClipboard,
}: {
  instances: RemoteInstance[];
  parentOnline: boolean;
  parentState: RemoteDisplayState;
  parentTotalInFlow: number;
  parentTotalOutFlow: number;
  parentTrafficRatio: number;
  formatTraffic: (bytes: number) => string;
  copyToClipboard: (text: string, label: string) => void;
}) {
  const trafficRatio = parentTrafficRatio > 0 ? parentTrafficRatio : 1;
  const rawInFlow = Math.round(parentTotalInFlow / trafficRatio);
  const rawOutFlow = Math.round(parentTotalOutFlow / trafficRatio);
  const activeInstances = instances.filter(
    (instance) => instance.status === 1 && (instance.weight ?? 1) > 0,
  );
  const flowInstances =
    activeInstances.length > 0 ? activeInstances : instances;
  const flowIndexByID = new Map(
    flowInstances.map((instance, index) => [
      instance.instanceId?.trim() || `${index}`,
      index,
    ]),
  );
  const splitFlow = (flow: number, index: number, count: number) =>
    Math.floor(flow / count) + (index < flow % count ? 1 : 0);

  return (
    <div className="my-2 bg-default-100/70 shadow-[inset_2px_0_0_rgba(148,163,184,0.8)] dark:bg-default-100/10">
      <div className="w-full max-w-full overflow-x-auto pb-2">
        <table className="w-full min-w-[1654px] table-fixed text-[13px]">
          <RemoteNodeTableColGroup />
          <thead className="border-b border-default-300/70 bg-default-100/30 text-xs text-default-600">
            <tr>
              <th aria-label="选择" />
              <th aria-label="排序" />
              <th aria-label="展开" />
              <th className="px-1 py-2 text-center font-medium">状态</th>
              <th className="px-1 py-2 text-left font-medium">
                实例名称
                <span className="font-normal text-default-500">
                  ^{instances.length}个
                </span>
              </th>
              <th aria-label="倍率占位" />
              <th aria-label="节点分组" />
              <th className="px-1 py-2 text-left font-medium">实例地址</th>
              <th className="px-1 py-2 text-center font-medium">在线数</th>
              <th className="px-1 py-2 text-right font-medium">周期流量</th>
              <th className="px-1 py-2 text-right font-medium">上行流量</th>
              <th className="px-1 py-2 text-right font-medium">下行流量</th>
              <th className="px-1 py-2 text-center font-medium">共享范围</th>
              <th
                aria-label="到期提醒"
                className="w-[110px] min-w-[110px] max-w-[110px]"
              />
              <th aria-label="备注" className="" />
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {instances.map((instance, index) => {
              const label = getRemoteInstanceLabel(instance);
              const instanceId = instance.instanceId?.trim();
              const disabled = instance.weight != null && instance.weight <= 0;
              const online = parentOnline && instance.status === 1;
              const parentMeta = getRemoteDisplayMeta(parentState);
              const flowIndex = flowIndexByID.get(instanceId || `${index}`);
              const upFlow =
                flowIndex === undefined
                  ? 0
                  : splitFlow(rawOutFlow, flowIndex, flowInstances.length);
              const downFlow =
                flowIndex === undefined
                  ? 0
                  : splitFlow(rawInFlow, flowIndex, flowInstances.length);
              const periodFlow = upFlow + downFlow;

              return (
                <tr
                  key={
                    instanceId ||
                    `${instance.displayIndex ?? "instance"}-${index}`
                  }
                  className="text-xs text-default-500 border-b border-divider/60 last:border-b-0"
                >
                  <td />
                  <td />
                  <td />
                  <td className="px-1 py-2.5 text-center align-middle">
                    {instance.status == null ? (
                      <span className="text-default-400">-</span>
                    ) : (
                      <StatusDot
                        active={!disabled && parentState === "online" && online}
                        title={
                          !parentOnline
                            ? parentMeta.label
                            : !online
                              ? "离线"
                              : disabled
                                ? "已禁用"
                                : "在线"
                        }
                        tone={
						  !parentOnline
							? parentMeta.tone
							: !online
							  ? "danger"
							  : disabled
								? "warning"
								: "success"
                        }
                      />
                    )}
                  </td>
                  <td className="px-1 py-2.5 text-left align-middle">
                    <span className="block truncate font-medium text-foreground">
                      {label}
                    </span>
                  </td>
                  <td />
                  <td />
                  <InstanceIPRegionCell
                    copyToClipboard={copyToClipboard}
                    member={instance}
                  />
                  <td className="px-1 py-2.5 text-center font-mono text-default-700">
                    {instance.onlineCount ?? 0}
                  </td>
                  <td className="px-1 py-2.5 text-right text-danger-600 dark:text-danger-400">
                    {formatTraffic(periodFlow)}
                  </td>
                  <td className="px-1 py-2.5 text-right text-success-700 dark:text-success-300">
                    {formatTraffic(upFlow)}
                  </td>
                  <td className="px-1 py-2.5 text-right text-primary-700 dark:text-primary-300">
                    {formatTraffic(downFlow)}
                  </td>
                  <td className="px-1 py-2.5 text-center text-default-700">
                    {instance.selected
                      ? "指定共享"
                      : instance.inScope
                        ? "范围内"
                        : "-"}
                  </td>
                  <td className="w-[110px] min-w-[110px] max-w-[110px]" />
                  <td className="w-[130px] min-w-[130px] max-w-[130px]" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NodeInstanceRows({
  node,
  members,
  copyToClipboard,
  formatTraffic,
  realtimeInstanceMetrics,
  upgradeProgress,
  onDismissExpiryReminder,
  onViewTrafficLogs,
  onConfigureInstance,
  onDeleteInstance,
  onResetInstanceTraffic,
  onToggleInstancePause,
  onCrossBorderRecheck,
  onCrossBorderCorrect,
  crossBorderRecheckingKeys,
  onReorderInstances,
  onInstallMimicDeps,
}: {
  node: Node;
  members: MonitorNodeInstanceGroupMemberApiItem[];
  copyToClipboard: (text: string, label: string) => void;
  formatTraffic: (bytes: number) => string;
  realtimeInstanceMetrics: Record<string, RealtimeInstanceMetric>;
  upgradeProgress?: NodeUpgradeProgress;
  onDismissExpiryReminder?: (nodeId: number, instanceId?: string) => void;
  onViewTrafficLogs?: (node: Node) => void;
  onConfigureInstance?: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onDeleteInstance?: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onResetInstanceTraffic?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onToggleInstancePause?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onCrossBorderRecheck?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  onCrossBorderCorrect?: (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => void;
  crossBorderRecheckingKeys: Set<string>;
  onReorderInstances: (
    nodeId: number,
    activeInstanceId: string,
    overInstanceId: string,
  ) => void;
  onInstallMimicDeps?: (node: Node) => void;
}) {
  const [openExpiryInstanceId, setOpenExpiryInstanceId] = useState<
    string | null
  >(null);
  const instanceSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const sortableInstanceIds = members.map((member, index) =>
    getInstanceSortableId(member, index),
  );

  const handleInstanceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;
    const activeIndex = sortableInstanceIds.indexOf(String(active.id));
    const overIndex = sortableInstanceIds.indexOf(String(over.id));
    const activeInstanceId = members[activeIndex]?.instanceId?.trim();
    const overInstanceId = members[overIndex]?.instanceId?.trim();

    if (!activeInstanceId || !overInstanceId) return;
    onReorderInstances(node.id, activeInstanceId, overInstanceId);
  };

  useEffect(() => {
    const closeOtherInstanceExpiry = (event: Event) => {
      const customEvent = event as CustomEvent<{ instanceId?: string }>;

      if (customEvent.detail?.instanceId !== openExpiryInstanceId) {
        setOpenExpiryInstanceId(null);
      }
    };

    window.addEventListener(
      "closeOtherInstanceExpiryPopovers",
      closeOtherInstanceExpiry,
    );

    return () =>
      window.removeEventListener(
        "closeOtherInstanceExpiryPopovers",
        closeOtherInstanceExpiry,
      );
  }, [openExpiryInstanceId]);

  const getRealtimeMetric = (member: MonitorNodeInstanceGroupMemberApiItem) =>
    realtimeInstanceMetrics[
      `${member.nodeId}:${member.instanceId?.trim() || ""}`
    ];

  const getPeriodNetTraffic = (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => {
    const realtime = getRealtimeMetric(member)?.periodTraffic;

    return {
      rx: realtime?.rx ?? member.periodNetInBytes ?? 0,
      tx: realtime?.tx ?? member.periodNetOutBytes ?? 0,
    };
  };

  useEffect(() => {
    if (!openExpiryInstanceId) return;
    const closePopover = () => setOpenExpiryInstanceId(null);

    window.addEventListener("click", closePopover);
    window.addEventListener("scroll", closePopover, true);
    window.addEventListener("resize", closePopover);

    return () => {
      window.removeEventListener("click", closePopover);
      window.removeEventListener("scroll", closePopover, true);
      window.removeEventListener("resize", closePopover);
    };
  }, [openExpiryInstanceId]);

  return (
    <div
      className="my-2 overflow-visible bg-default-100/70 shadow-[inset_2px_0_0_rgba(148,163,184,0.8)] dark:bg-default-100/10"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-full overflow-x-auto pb-2">
        <DndContext
          collisionDetection={closestCenter}
          sensors={instanceSensors}
          onDragEnd={handleInstanceDragEnd}
        >
          <SortableContext
            items={sortableInstanceIds}
            strategy={verticalListSortingStrategy}
          >
            <table className="w-full min-w-[1654px] table-fixed text-[13px]">
              <NodeTableColGroup />
              <thead className="border-b border-default-300/70 bg-default-100/30 text-xs text-default-500">
                <tr>
                  <th aria-label="选择" />
                  <th
                    className="px-0 py-2 text-center font-medium"
                    title="拖拽排序"
                  >
                    排序
                  </th>
                  <th className="px-1 py-2 text-center font-medium">WGM</th>
                  <th className="px-1 py-2 text-center font-medium">状态</th>
                  <th className="px-1 py-2 text-left font-medium">
                    实例名称
                    <span className="font-normal text-primary-500">
                      ^{members.length}个
                    </span>
                  </th>
                  <th className="px-1 py-2 text-center font-medium">版本</th>
                  <th className="px-1 py-2 text-center font-medium">权重</th>
                  <th className="px-1 py-2 text-left font-medium">
                    地区 / 地址
                  </th>
                  <th className="px-1 py-2 text-center font-medium">在线数</th>
                  <th className="px-1 py-2 text-right font-medium">周期流量</th>
                  <th className="px-1 py-2 text-right font-medium">上行流量</th>
                  <th className="px-1 py-2 text-right font-medium">下行流量</th>
                  <th className="px-1 py-2 text-center font-medium">
                    流量限额
                  </th>
                  <th className="px-1 py-2 text-center font-medium">
                    到期提醒
                  </th>
                  <th className="px-1 py-2 text-left font-medium">备注</th>
                  <th className="px-1 py-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td
                      className="px-2 py-8 text-center text-default-500"
                      colSpan={16}
                    >
                      暂无实例上报
                    </td>
                  </tr>
                ) : (
                  members.map((member, memberIndex) => (
                    <SortableInstanceRow
                      key={
                        member.instanceId ||
                        `${member.nodeId}-${member.displayIndex || 0}`
                      }
                      id={getInstanceSortableId(member, memberIndex)}
                      isPopoverOpen={openExpiryInstanceId === member.instanceId}
                      sortableDisabled={!member.instanceId?.trim()}
                      wgmCell={
                        <td className="px-1 py-3 text-center">
                          {(node as any).mimicStatus === "ok" ||
                          (node as any).mimicStatus === "deps_ready" ? (
							<StatusDot tone="success" title="WGM 就绪" />
                          ) : (node as any).mimicStatus ? (
							<button
							  className="inline-flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onInstallMimicDeps?.(node);
                              }}
                            >
							  <StatusDot
								tone="danger"
								title={`${(node as any).mimicError || "WGM 未就绪"}，点击安装依赖`}
							  />
                            </button>
                          ) : (
                            <span className="text-default-400">-</span>
                          )}
                        </td>
                      }
                    >
                      <td className="px-2 py-2.5 text-center align-middle">
                        <StatusDot
						  active={member.status === 1 && member.weight > 0}
						  title={
							member.status !== 1
							  ? "离线"
							  : member.weight <= 0
							  ? isInstanceTrafficLimitExceeded(member)
								? "流量超限，已暂停"
								: "已禁用（权重为 0）"
								  : "在线"
                          }
						  tone={
							member.status !== 1
							  ? "danger"
							  : member.weight <= 0
							  ? isInstanceTrafficLimitExceeded(member)
								? "default"
								: "warning"
								  : "success"
                          }
                        />
                      </td>
                      <td className="px-1 py-3 text-left font-medium text-foreground">
                        <span className="block truncate">
                          {getInstanceLabel(member)}
                        </span>
                      </td>
                      <td className="overflow-visible px-2 py-3 text-center text-default-700">
                        {upgradeProgress && upgradeProgress.percent < 100 ? (
                          <div className="mx-auto w-[105px] space-y-1">
                            <Progress
                              aria-label="实例更新进度"
                              className="w-full"
                              color="warning"
                              size="sm"
                              value={upgradeProgress.percent}
                            />
                            <SmartTooltip content={upgradeProgress.message}>
                              <div className="truncate text-[10px] leading-tight text-warning-600">
                                {upgradeProgress.message ||
                                  `${upgradeProgress.percent}%`}
                              </div>
                            </SmartTooltip>
                          </div>
                        ) : node.version ? (
                          <div className="inline-flex items-center justify-center gap-1.5">
                            <DistroIcon
                              className="h-4 w-4 shrink-0"
                              distro={parseDistroFromVersion(node.version)}
                              style={{
                                color: getDistroColor(
                                  parseDistroFromVersion(node.version),
                                ),
                              }}
                            />
                            <span>{node.version.split(" ")[0]}</span>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-1 py-3 text-center text-default-700">
                        {member.weight ?? "-"}
                      </td>
                      <InstanceIPRegionCell
                        copyToClipboard={copyToClipboard}
                        isCrossBorderRechecking={crossBorderRecheckingKeys.has(
                          `${member.nodeId}:${member.instanceId?.trim() || ""}`,
                        )}
                        member={member}
                        onCrossBorderCorrect={onCrossBorderCorrect}
                        onCrossBorderRecheck={onCrossBorderRecheck}
                      />
                      <td className="px-1 py-3 text-center font-mono text-default-700">
                        {member.status === 1
                          ? (() => {
                              const realtime = getRealtimeMetric(member);

                              return realtime
                                ? realtime.tcpConns + realtime.udpConns
                                : (member.onlineCount ?? 0);
                            })()
                          : "-"}
                      </td>
                      <td className="px-1 py-3 text-right text-danger-600 dark:text-danger-400">
                        <div className="inline-flex items-center justify-end gap-1">
                          <span>
                            {(() => {
                              const { tx, rx } = getPeriodNetTraffic(member);

                              return formatTraffic(tx + rx);
                            })()}
                          </span>
                          {onViewTrafficLogs && (
                            <Button
                              isIconOnly
                              className="h-6 w-6 min-w-6"
                              size="sm"
                              variant="flat"
                              onPress={() => onViewTrafficLogs(node)}
                            >
                              <svg
                                className="h-4 w-4"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  clipRule="evenodd"
                                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                  fillRule="evenodd"
                                />
                              </svg>
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right text-success-700 dark:text-success-300">
                        {formatTraffic(getPeriodNetTraffic(member).tx)}
                      </td>
                      <td className="px-1 py-3 text-right text-primary-700 dark:text-primary-300">
                        {formatTraffic(getPeriodNetTraffic(member).rx)}
                      </td>
                      <td
                        className="px-1 py-3 text-center text-default-700"
                        style={{ width: "100px" }}
                      >
                        {(member.trafficLimit ?? 0) > 0
                          ? (() => {
                              const traffic = getPeriodNetTraffic(member);
                              const used = Math.max(
                                traffic.rx +
                                  traffic.tx +
                                  (member.manualTrafficInBytes ?? 0) +
                                  (member.manualTrafficOutBytes ?? 0),
                                0,
                              );
                              const limitBytes =
                                (member.trafficLimit ?? 0) * 1024 * 1024 * 1024;
                              const remaining = Math.max(limitBytes - used, 0);
                              const title = `已用：${formatTraffic(used)}\n剩余：${formatTraffic(remaining)}\n总量：${formatTraffic(limitBytes)}`;

                              return (
                                <SmartTooltip content={title}>
                                  <span className="cursor-help">
                                    {member.trafficLimit} G
                                  </span>
                                </SmartTooltip>
                              );
                            })()
                          : (() => {
                              const traffic = getPeriodNetTraffic(member);
                              const used = Math.max(
                                traffic.rx +
                                  traffic.tx +
                                  (member.manualTrafficInBytes ?? 0) +
                                  (member.manualTrafficOutBytes ?? 0),
                                0,
                              );
                              const title = `已用：${formatTraffic(used)}\n可用：不限\n总量：不限`;

                              return (
                                <SmartTooltip content={title}>
                                  <span className="cursor-help">不限</span>
                                </SmartTooltip>
                              );
                            })()}
                      </td>
                      <td className="px-2 py-3 text-center text-default-700">
                        {member.expiryTime && member.renewalCycle
                          ? (() => {
                              const meta = getNodeRenewalSnapshot(
                                member.expiryTime,
                                member.renewalCycle,
                                7,
                              );
                              const toneClass =
                                meta.state === "expired"
                                  ? "text-danger-600 dark:text-danger-400"
                                  : meta.state === "dueSoon"
                                    ? "text-warning-600 dark:text-warning-400"
                                    : "text-success-700 dark:text-success-300";

                              return (
                                <div className="relative inline-flex min-w-[72px] items-center justify-center leading-tight">
                                  <button
                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-default-200/60 ${toneClass}`}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      window.dispatchEvent(
                                        new CustomEvent(
                                          "closeOtherInstanceExpiryPopovers",
                                          {
                                            detail: {
                                              instanceId: member.instanceId,
                                            },
                                          },
                                        ),
                                      );
                                      setOpenExpiryInstanceId((current) =>
                                        current === member.instanceId
                                          ? null
                                          : member.instanceId || null,
                                      );
                                    }}
                                  >
                                    {meta.label}
                                    <svg
                                      aria-hidden="true"
                                      className={`h-3 w-3 transition-transform ${openExpiryInstanceId === member.instanceId ? "rotate-180" : ""}`}
                                      fill="none"
                                      stroke="currentColor"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="m6 9 6 6 6-6" />
                                    </svg>
                                  </button>
                                  {openExpiryInstanceId ===
                                    member.instanceId && (
                                    <div
                                      className={`absolute right-0 z-[100] w-[160px] rounded-lg border border-divider/80 bg-background/98 p-2 text-left shadow-xl backdrop-blur ${memberIndex === members.length - 1 ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="truncate text-xs font-medium text-default-700">
                                            {getInstanceLabel(member)}
                                          </div>
                                          <div className="text-[10px] text-default-500">
                                            {formatNodeRenewalTime(
                                              meta.nextDueTime,
                                            )}
                                          </div>
                                        </div>
                                        <button
                                          className="inline-flex shrink-0 items-center justify-center rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onDismissExpiryReminder?.(
                                              member.nodeId,
                                              member.instanceId,
                                            );
                                            setOpenExpiryInstanceId(null);
                                          }}
                                        >
                                          更新周期
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          : "-"}
                      </td>
                      <td className=" px-2 py-3 text-left align-middle truncate text-default-600 text-xs">
                        {member.remark?.trim() ? (
                          <SmartTooltip content={member.remark.trim()}>
                            <span className="truncate block">
                              {member.remark.trim()}
                            </span>
                          </SmartTooltip>
                        ) : (
                          <span className="text-default-400">-</span>
                        )}
                      </td>
                      <td className="px-1 py-3">
                        <div className="flex items-center justify-start gap-1 whitespace-nowrap">
                          <Button
                            className="h-7 shrink-0 px-2 text-xs font-medium"
                            color="primary"
                            size="sm"
                            variant="flat"
                            onPress={() => onConfigureInstance?.(member)}
                          >
                            编辑
                          </Button>
                          <MonitorTerminalButton
                            className="h-7 shrink-0 px-2 text-xs font-medium"
                            member={member}
                          />
                          <Button
                            className="h-7 shrink-0 px-2 text-xs font-medium"
                            color="success"
                            size="sm"
                            variant="flat"
                            onPress={() => onResetInstanceTraffic?.(member)}
                          >
                            归零
                          </Button>
                          <Button
                            className="h-7 shrink-0 px-2 text-xs font-medium"
                            color={member.weight > 0 ? "warning" : "success"}
                            size="sm"
                            variant="flat"
                            onPress={() => onToggleInstancePause?.(member)}
                          >
                            {member.weight > 0 ? "暂停" : "启用"}
                          </Button>
                          <Button
                            className="h-7 shrink-0 px-2 text-xs font-medium"
                            color="danger"
                            size="sm"
                            variant="flat"
                            onPress={() => onDeleteInstance?.(member)}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </SortableInstanceRow>
                  ))
                )}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

const getInstanceSortableId = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  index: number,
) => `${member.nodeId}:${member.instanceId?.trim() || `missing-${index}`}`;

function SortableInstanceRow({
  id,
  isPopoverOpen,
  sortableDisabled,
  wgmCell,
  children,
}: {
  id: string;
  isPopoverOpen: boolean;
  sortableDisabled: boolean;
  wgmCell: React.ReactNode;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: sortableDisabled });

  return (
    <tr
      ref={setNodeRef}
      className={`border-b border-divider/60 last:border-b-0 hover:bg-default-50/70 dark:hover:bg-default-100/10 ${isPopoverOpen ? "z-[9999]" : "z-[1]"} ${isDragging ? "bg-primary-100/80 shadow-lg dark:bg-primary-500/20" : ""}`}
      style={{
        position: "relative",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.75 : 1,
      }}
    >
      <td />
      <td className="px-0 py-2 text-center align-middle">
        <button
          {...attributes}
          {...listeners}
          aria-label="拖拽调整实例顺序"
          className="inline-flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded text-default-400 transition-colors hover:bg-default-200/70 hover:text-default-700 active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
          disabled={sortableDisabled}
          title="拖拽调整实例顺序"
          type="button"
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      {wgmCell}
      {children}
    </tr>
  );
}
function SortableTableRow({
  node,
  selectedIds,
  toggleSelect,
  copyToClipboard,
  openUpgradeModal,
  handleEdit,
  handleDelete,
  formatTraffic,
  nodeGroups,
  handleDismissExpiryReminder,
  handleCopyOverseasInstallCommand,
  handleCopyOfflineInstallCommand,
  handleCopyAutoInstallCommand,
  handleViewNodeTrafficLogs,
  handleTogglePause,
  instanceMembers = [],
  isExpanded,
  isHighlighted,
  onToggleHighlighted,
  onToggleExpanded,
  onConfigureInstance,
  onDeleteInstance,
  onResetInstanceTraffic,
  onToggleInstancePause,
  onCrossBorderRecheck,
  onCrossBorderCorrect,
  crossBorderRecheckingKeys,
  onReorderInstances,
  onInstallMimicDeps,
  realtimeInstanceMetrics,
  isLastNode,
  upgradeProgress,
  onShareNode,
  onViewRemoteDetail,
  shareCounts,
  remoteUsageByNode,
}: any) {
  const [expiryPopoverOpen, setExpiryPopoverOpen] = useState(false);
  const expiryButtonRef = useRef<HTMLButtonElement>(null);

  const handleTogglePopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextState = !expiryPopoverOpen;

    setExpiryPopoverOpen(nextState);
    if (nextState) {
      // 广播事件：告诉其他弹窗“我要打开了，你们都退下”
      window.dispatchEvent(
        new CustomEvent("closeOtherExpiryPopovers", {
          detail: { nodeId: node.id },
        }),
      );
    }
  };

  // 监听其他弹窗打开的广播
  useEffect(() => {
    const handleCloseOthers = (e: Event) => {
      const customEvent = e as CustomEvent;

      if (customEvent.detail && customEvent.detail.nodeId !== node.id) {
        setExpiryPopoverOpen(false);
      }
    };

    window.addEventListener("closeOtherExpiryPopovers", handleCloseOthers);

    return () =>
      window.removeEventListener("closeOtherExpiryPopovers", handleCloseOthers);
  }, [node.id]);

  // 点击空白处、滚动、缩放时自动关闭当前弹窗
  useEffect(() => {
    if (!expiryPopoverOpen) return;
    const closePopover = () => setExpiryPopoverOpen(false);

    window.addEventListener("click", closePopover);
    window.addEventListener("scroll", closePopover, true);
    window.addEventListener("resize", closePopover);

    return () => {
      window.removeEventListener("click", closePopover);
      window.removeEventListener("scroll", closePopover, true);
      window.removeEventListener("resize", closePopover);
    };
  }, [expiryPopoverOpen]);

  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: node.id });
  const style: any = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    // 核心魔法：当弹窗打开时，强行把这一整行提拔到最高层！
    zIndex: expiryPopoverOpen ? 9999 : isDragging ? 99 : 1,
    position: expiryPopoverOpen || isDragging ? "relative" : undefined,
  };
  const remoteVisualMembers = (node.remoteInstances || [])
    .filter((instance: RemoteInstance) => instance.inScope)
    .map((instance: RemoteInstance) => ({
      status: instance.status ?? 0,
      weight: instance.weight ?? 1,
    }));
  const remoteVisualMeta = remoteVisualMembers.length
    ? deriveNodeVisualState(remoteVisualMembers)
    : null;
  const remoteOnline = node.connectionStatus === "online" && !node.syncError;
  const remoteDisplayMeta = remoteOnline ? remoteVisualMeta : null;
  const remoteDisplayState = getRemoteDisplayState(node, remoteVisualMeta);
  const remoteStatusMeta = getRemoteDisplayMeta(remoteDisplayState);
  const instanceMemberById = new Map<
    string,
    MonitorNodeInstanceGroupMemberApiItem
  >(
    instanceMembers.map((member: MonitorNodeInstanceGroupMemberApiItem) => [
      (member.instanceId || "").trim(),
      member,
    ]),
  );
  const remoteInstances = (node.remoteInstances || [])
    .filter((instance: RemoteInstance) => instance.inScope)
    .map((instance: RemoteInstance) => {
      const member = instanceMemberById.get(instance.instanceId?.trim() || "");

      return member
        ? {
            ...instance,
            publicIpV4Region: member.publicIpV4Region,
            publicIpV4CountryCode: member.publicIpV4CountryCode,
            publicIpV6Region: member.publicIpV6Region,
            publicIpV6CountryCode: member.publicIpV6CountryCode,
          }
        : instance;
    });
  const remoteConnectionCount = remoteInstances.reduce(
    (total: number, instance: RemoteInstance) =>
      total + (instance.onlineCount ?? 0),
    0,
  );
  const trafficRatio =
    node.trafficRatio && node.trafficRatio > 0 ? node.trafficRatio : 1;
  const localPeriodNetTraffic = instanceMembers.reduce(
    (
      total: { rx: number; tx: number },
      member: MonitorNodeInstanceGroupMemberApiItem,
    ) => {
      const realtime =
        realtimeInstanceMetrics[
          `${member.nodeId}:${member.instanceId?.trim() || ""}`
        ]?.periodTraffic;

      total.rx += (realtime?.rx ?? member.periodNetInBytes ?? 0) * trafficRatio;
      total.tx +=
        (realtime?.tx ?? member.periodNetOutBytes ?? 0) * trafficRatio;

      return total;
    },
    { rx: 0, tx: 0 },
  );
  const remoteTrafficLimit = node.remoteMaxBandwidth ?? 0;
  const remoteTrafficUsed = node.remoteCurrentFlow ?? 0;
  const remoteTrafficTitle = `已用：${formatTraffic(remoteTrafficUsed)}\n剩余：${
    remoteTrafficLimit > 0
      ? formatTraffic(Math.max(remoteTrafficLimit - remoteTrafficUsed, 0))
      : "不限"
  }\n总量：${remoteTrafficLimit > 0 ? formatTraffic(remoteTrafficLimit) : "不限"}`;
  const isExpandable = node.isRemote !== 1 || remoteInstances.length > 0;
  const isActuallyExpanded = isExpandable && isExpanded;
  const rowBg = selectedIds.has(node.id)
    ? "bg-primary-50/70 dark:bg-default-900/40"
    : isActuallyExpanded
      ? "bg-primary-100/80 dark:bg-default-100/30"
      : isHighlighted
        ? "bg-default-100 dark:bg-default-100/20"
        : "";
  const visualMeta = deriveNodeVisualState(
	instanceMembers.map((member: MonitorNodeInstanceGroupMemberApiItem) => ({
	  ...member,
	  unavailable: isInstanceTrafficLimitExceeded(member),
	})),
	node.paused,
  );
  const expiryTarget =
    node.expiryInstances?.find(
      (item: NodeExpiryInstance) =>
        item.expiryTime === node.expiryTime &&
        item.renewalCycle === node.renewalCycle,
    ) ?? node.expiryInstances?.[0];
  const expiryMeta = getNodeRenewalSnapshot(
    expiryTarget?.expiryTime ?? node.expiryTime,
    expiryTarget?.renewalCycle ?? node.renewalCycle,
    7,
  );
  const hasExpiryInfo = Boolean(
    expiryTarget?.expiryTime &&
      expiryTarget.expiryTime > 0 &&
      expiryTarget.renewalCycle &&
      (expiryTarget.expiryReminderDismissed !== 1 ||
        (expiryTarget.expiryReminderDismissedUntil &&
          expiryTarget.expiryReminderDismissedUntil < Date.now())),
  );
  const getExpiryChipProps = () => {
    if (expiryMeta.state === "expired") {
      return {
        color: "danger" as const,
        className: "bg-danger-500/10 text-danger-600 dark:text-danger-400",
        label: expiryMeta.label,
      };
    }
    if (expiryMeta.state === "dueSoon") {
      return {
        color: "warning" as const,
        className: "bg-warning-500/10 text-warning-600 dark:text-warning-400",
        label: expiryMeta.label,
      };
    }
    if (expiryMeta.state === "scheduled") {
      return {
        color: "success" as const,
        className: "bg-success-500/10 text-success-600 dark:text-success-400",
        label: expiryMeta.label,
      };
    }

    return null;
  };
  const expiryChipProps = hasExpiryInfo ? getExpiryChipProps() : null;
  const remoteExpiryChipProps =
    node.isRemote === 1
      ? getRemoteExpiryChipProps(node.remoteExpiryTime)
      : null;

  return (
    <>
      <TableRow
        key={node.id}
        ref={setNodeRef}
        className={`cursor-pointer ${isActuallyExpanded ? "border-b border-primary-300/70 shadow-[inset_3px_0_0_rgba(59,130,246,0.65)]" : ""}`}
        style={style}
        onClick={() => onToggleHighlighted?.()}
      >
        <TableCell className={rowBg}>
          <div
            className="flex items-center justify-center h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {node.isRemote !== 1 && (
              <Checkbox
                isSelected={selectedIds.has(node.id)}
                onValueChange={() => toggleSelect(node.id)}
              />
            )}
          </div>
        </TableCell>
        <TableCell className={rowBg}>
          <div className="flex items-center justify-center">
            <div
              className="cursor-grab active:cursor-grabbing p-1 text-default-400 flex-shrink-0 hover:text-default-600 transition-colors"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M7 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 2zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 14zm6-8a2 2 0 1 1-.001-4.001A2 2 0 0 1 13 6zm0 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 14z" />
              </svg>
            </div>
          </div>
        </TableCell>
        <TableCell className={rowBg}>
          <div className="flex items-center justify-center">
            {isExpandable ? (
              <SmartTooltip
                content={isActuallyExpanded ? "收起实例" : "展开实例"}
              >
                <button
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-default-500 transition-colors hover:bg-default-200/70 hover:text-foreground"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpanded?.(node.id);
                  }}
                >
                  <svg
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${isActuallyExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </SmartTooltip>
            ) : (
              <span className="text-default-300">-</span>
            )}
          </div>
        </TableCell>
        <TableCell className={`px-1 text-center align-middle ${rowBg}`}>
          {node.isRemote === 1 ? (
            <SmartTooltip
              content={
                remoteDisplayState === "online" && remoteDisplayMeta
                  ? `在线${remoteDisplayMeta.onlineCount}/禁用${remoteDisplayMeta.disabledCount}/全部${remoteDisplayMeta.totalCount}`
                  : remoteStatusMeta.label
              }
            >
              <div className="flex items-center justify-center gap-0.5">
                <StatusDot
                  active={remoteDisplayState === "online"}
                  tone={remoteStatusMeta.tone}
                />
                <span className="text-xs font-mono tabular-nums text-default-600">
                  {remoteDisplayState === "online" && remoteDisplayMeta
                    ? `${remoteDisplayMeta.onlineCount}/${remoteDisplayMeta.disabledCount}/${remoteDisplayMeta.totalCount}`
                    : remoteStatusMeta.label}
                </span>
              </div>
            </SmartTooltip>
          ) : (
            <SmartTooltip
              content={`在线${visualMeta.onlineCount}/禁用${visualMeta.disabledCount}/全部${visualMeta.totalCount}`}
            >
              <div className="flex items-center justify-center gap-0.5">
                <StatusDot
                  active={visualMeta.state !== "offline"}
                  tone={visualMeta.color}
                />
                <span className="text-xs font-mono tabular-nums text-default-600">
                  {visualMeta.onlineCount}/{visualMeta.disabledCount}/
                  {visualMeta.totalCount}
                </span>
              </div>
            </SmartTooltip>
          )}
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
          <div className="flex items-center gap-2 min-w-0">
            <SmartTooltip content={node.name}>
              <span
                className="text-sm font-medium text-foreground truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(node.name, "节点名称");
                }}
              >
                {formatRemoteDisplayText(node.name)}
                {node.isRemote === 1 &&
                  !/\s\(Rem\)$/i.test(formatRemoteDisplayText(node.name)) && (
                    <span className="ml-1 text-[11px] text-purple-600 dark:text-purple-400">
                      (Rem)
                    </span>
                    )}
              </span>
            </SmartTooltip>
          </div>
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
          <span className="text-sm font-medium text-default-700">
            {(node.trafficRatio || 1).toFixed(2).replace(/\.00$/, "")}x
          </span>
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
          {node.isRemote === 1 ? (
            <div className="inline-flex items-center justify-center rounded bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
              远程组
            </div>
          ) : node.groupId && node.groupId > 0 ? (
            (() => {
              const group = nodeGroups.find((g: any) => g.id == node.groupId);

              return group ? (
                <div
                  className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: `${group.color}1A`,
                    color: group.color,
                  }}
                >
                  {group.name}
                </div>
              ) : (
                <div className="inline-flex items-center justify-center bg-default-500/10 text-default-500 px-2 py-0.5 rounded text-xs font-medium">
                  未分组
                </div>
              );
            })()
          ) : (
            <div className="inline-flex items-center justify-center bg-default-500/10 text-default-500 px-2 py-0.5 rounded text-xs font-medium">
              未分组
            </div>
          )}
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 align-middle ${rowBg}`}>
          {(() => {
            if (node.isRemote === 1) {
              const sourceInstance = (node.remoteInstances || []).find(
                (instance: RemoteInstance) => instance.inScope,
              );
              const configuredAddress = node.serverIp?.trim() || "";
              const address =
                (configuredAddress.toLowerCase() === "auto"
                  ? ""
                  : configuredAddress) ||
                sourceInstance?.publicIpV4?.trim() ||
                sourceInstance?.publicIpV6?.trim() ||
                "";
              const remoteUsage = remoteUsageByNode[node.id];
              const portRangeStart = remoteUsage?.portRangeStart || 0;
              const portRangeEnd = remoteUsage?.portRangeEnd || 0;
              const usedPorts = new Set(remoteUsage?.usedPorts || []).size;
              const totalPorts =
                portRangeStart > 0 && portRangeEnd >= portRangeStart
                  ? portRangeEnd - portRangeStart + 1
                  : 0;

              return (
                <div className="min-w-0 px-1 text-xs font-medium text-default-700">
                  {address ? (
                    <span className="block max-w-[150px] truncate">
                      {formatInstanceIPForCell(address)}
                    </span>
                  ) : (
                    <span className="block text-default-400">-</span>
                  )}
                  <span className="block text-[11px] font-mono text-default-500">
                    {totalPorts > 0 ? (
                      <>
                        {usedPorts}/{totalPorts}
                        <span className="mx-1 text-foreground font-medium">
                          &
                        </span>
                        {portRangeStart}-{portRangeEnd}
                      </>
                    ) : (
                      "-"
                    )}
                  </span>
                </div>
              );
            }
            const publicIPv4 = node.serverIpV4?.trim() || "";
            const intranetIPv4 = node.intranetIp?.trim() || "";
            const publicIPv6 =
              node.serverIpV6?.trim() ||
              (node.serverIp?.trim() && node.serverIp.includes(":")
                ? node.serverIp.trim()
                : "");
            const address = publicIPv4 || intranetIPv4 || publicIPv6;

            if (!address) {
              return <span className="text-sm text-default-300">-</span>;
            }

            return (
              <SmartTooltip content={address}>
                <button
                  className="inline-block max-w-[150px] truncate rounded px-1 text-xs font-medium text-default-700 transition-colors hover:bg-default-200/50 hover:text-primary"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    copyToClipboard(address, "节点地址");
                  }}
                >
                  {formatInstanceIPForCell(address)}
                </button>
              </SmartTooltip>
            );
          })()}
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
          <div className="flex justify-center">
            <span className="text-sm font-mono text-default-600 tabular-nums">
              {node.isRemote === 1
                ? remoteConnectionCount
                : node.connectionStatus === "online"
                  ? (node.onlineCount ?? 0)
                  : "-"}
            </span>
          </div>
        </TableCell>
        <TableCell
          className={`w-[120px] min-w-[120px] max-w-[120px] whitespace-nowrap ${rowBg}`}
        >
          <div className="flex w-[104px] items-center justify-end gap-1">
            <span className="min-w-0 truncate text-sm text-danger-600 dark:text-danger-400">
              {formatTraffic(
                node.isRemote === 1
                  ? (node.totalOutFlow ?? 0) + (node.totalInFlow ?? 0)
                  : localPeriodNetTraffic.tx + localPeriodNetTraffic.rx,
              )}
            </span>
          </div>
        </TableCell>
        <TableCell className={`whitespace-nowrap ${rowBg}`}>
          <div className="flex w-[96px] justify-end">
            <span className="truncate text-sm text-success-700 dark:text-success-300">
              {formatTraffic(
                node.isRemote === 1
                  ? (node.totalOutFlow ?? 0)
                  : localPeriodNetTraffic.tx,
              )}
            </span>
          </div>
        </TableCell>
        <TableCell className={`whitespace-nowrap ${rowBg}`}>
          <div className="flex w-[96px] justify-end">
            <span className="truncate text-sm text-primary-700 dark:text-primary-300">
              {formatTraffic(
                node.isRemote === 1
                  ? (node.totalInFlow ?? 0)
                  : localPeriodNetTraffic.rx,
              )}
            </span>
          </div>
        </TableCell>
        <TableCell
          aria-label="流量限额"
          className={`${rowBg}`}
          style={{ width: "110px" }}
        >
          <div className="flex w-full justify-center">
            {node.isRemote === 1 ? (
              <SmartTooltip content={remoteTrafficTitle}>
                <span className="whitespace-nowrap text-sm text-default-700 cursor-help">
                  {remoteTrafficLimit > 0
                    ? formatTraffic(remoteTrafficLimit)
                    : "不限"}
                </span>
              </SmartTooltip>
            ) : (
              <span className="whitespace-nowrap text-sm text-default-700">
                -
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className={`whitespace-nowrap text-center ${rowBg}`}>
          {remoteExpiryChipProps ? (
            <span
              className={`inline-flex rounded-lg border border-transparent px-2.5 py-1 text-xs font-medium ${remoteExpiryChipProps.className}`}
            >
              {remoteExpiryChipProps.label}
            </span>
          ) : hasExpiryInfo && expiryChipProps ? (
            <div className="relative inline-flex justify-center">
              <button
                ref={expiryButtonRef}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${expiryChipProps.className} ${expiryPopoverOpen ? "border-default-400 shadow-sm" : "border-transparent hover:border-default-300"}`}
                type="button"
                onClick={handleTogglePopover}
              >
                <span className="text-xs font-medium">
                  {expiryChipProps.label}
                </span>
                <svg
                  aria-hidden="true"
                  className={`h-3 w-3 transition-transform ${expiryPopoverOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {expiryPopoverOpen && (
                <div
                  className={`absolute right-0 z-[100] w-[160px] whitespace-nowrap rounded-lg border border-divider/80 bg-background/98 p-2 shadow-xl backdrop-blur ${isLastNode ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                  }}
                >
                  <div className="space-y-1">
                    {(node.expiryInstances?.length
                      ? node.expiryInstances
                      : expiryTarget
                        ? [expiryTarget]
                        : []
                    ).map((item: NodeExpiryInstance) => {
                      const meta = getNodeRenewalSnapshot(
                        item.expiryTime,
                        item.renewalCycle,
                        7,
                      );
                      const label =
                        item.displayName?.trim() ||
                        (item.displayIndex
                          ? `实例 ${item.displayIndex}`
                          : item.instanceId);

                      return (
                        <div
                          key={item.instanceId}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 text-left">
                            <div className="truncate text-xs font-medium text-default-700">
                              {label}
                            </div>
                            <div className="text-[10px] text-default-500">
                              {formatNodeRenewalTime(meta.nextDueTime)}
                            </div>
                          </div>
                          <button
                            className="inline-flex items-center justify-center rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-100 active:scale-95 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.nativeEvent.stopImmediatePropagation();
                              handleDismissExpiryReminder?.(
                                node.id,
                                item.instanceId,
                              );
                              setExpiryPopoverOpen(false);
                            }}
                          >
                            更新周期
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-sm text-default-400">-</span>
          )}
        </TableCell>
        <TableCell className={` whitespace-nowrap px-1 ${rowBg}`}>
          {node.remark?.trim() ? (
            <SmartTooltip content={node.remark.trim()}>
              <span
                className="inline-block max-w-full cursor-pointer rounded px-1 text-sm transition-colors hover:bg-default-200/50"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(node.remark!.trim(), "备注");
                }}
              >
                {node.remark.trim()}
              </span>
            </SmartTooltip>
          ) : (
            <span className="text-sm text-default-400">-</span>
          )}
        </TableCell>
        <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
          <div
            className="flex min-w-0 justify-start gap-1 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            {node.isRemote !== 1 && (
              <>
                <Dropdown>
                  <DropdownTrigger>
                    <Button
                      className="min-h-7 shrink-0 px-2"
                      color="success"
                      isLoading={node.copyLoading}
                      size="sm"
                      variant="flat"
                    >
                      对接
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="对接方式">
                    <DropdownItem
                      key="auto"
                      onPress={() => handleCopyAutoInstallCommand(node)}
                    >
                      🔘 自动探测线路
                    </DropdownItem>
                    <DropdownItem
                      key="overseas"
                      onPress={() => handleCopyOverseasInstallCommand(node)}
                    >
                      🌏 国外机主线路
                    </DropdownItem>
                    <DropdownMenuSeparator />
                    <DropdownItem
                      key="offline"
                      onPress={() => handleCopyOfflineInstallCommand(node)}
                    >
                      📦 离线部署
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
                <Button
                  className="min-h-7 shrink-0 px-2"
                  color="warning"
                  isDisabled={node.connectionStatus !== "online"}
                  isLoading={node.upgradeLoading}
                  size="sm"
                  variant="flat"
                  onPress={() => openUpgradeModal("single", node.id)}
                >
                  更新
                </Button>
                <Button
                  className="min-h-7 shrink-0 px-2"
                  color="primary"
                  size="sm"
                  variant="flat"
                  onPress={() => handleEdit(node)}
                >
                  编辑
                </Button>
                <Button
                  className="min-h-7 shrink-0 px-2"
                  color={node.paused ? "success" : "warning"}
                  size="sm"
                  variant="flat"
                  onPress={() => handleTogglePause(node)}
                >
                  {node.paused ? "启用" : "暂停"}
                </Button>
              </>
            )}
            {node.isRemote === 1 && (
              <Button
                className="min-h-7 shrink-0 px-2"
                color="secondary"
                size="sm"
                variant="flat"
                onPress={() => onViewRemoteDetail(node)}
              >
                详情
              </Button>
            )}
            <Button
              className="min-h-7 shrink-0 px-2"
              color="danger"
              size="sm"
              variant="flat"
              onPress={() => handleDelete(node)}
            >
              删除
            </Button>
            {node.isRemote !== 1 && (
              <Button
                className="min-h-7 shrink-0 px-2"
                color={shareCounts[node.id] ? "success" : "default"}
                size="sm"
                variant="flat"
                onPress={() => onShareNode(node)}
              >
                分享
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
      {node.isRemote !== 1 && isActuallyExpanded && (
        <TableRow
          key={`${node.id}-instances`}
          className="bg-default-50/30 dark:bg-default-100/5"
        >
          <TableCell className="w-0 max-w-0 overflow-visible p-0" colSpan={16}>
            <NodeInstanceRows
              copyToClipboard={copyToClipboard}
              formatTraffic={formatTraffic}
              members={instanceMembers}
              node={node}
              realtimeInstanceMetrics={realtimeInstanceMetrics}
              upgradeProgress={upgradeProgress?.[node.id]}
              onConfigureInstance={onConfigureInstance}
              onDeleteInstance={onDeleteInstance}
              onDismissExpiryReminder={handleDismissExpiryReminder}
              onInstallMimicDeps={onInstallMimicDeps}
              onReorderInstances={onReorderInstances}
              onResetInstanceTraffic={onResetInstanceTraffic}
              onToggleInstancePause={onToggleInstancePause}
              onCrossBorderCorrect={onCrossBorderCorrect}
              onCrossBorderRecheck={onCrossBorderRecheck}
              crossBorderRecheckingKeys={crossBorderRecheckingKeys}
              onViewTrafficLogs={handleViewNodeTrafficLogs}
            />
          </TableCell>
        </TableRow>
      )}
      {node.isRemote === 1 &&
        isActuallyExpanded &&
        remoteInstances.length > 0 && (
          <TableRow
            key={`${node.id}-remote-instances`}
            className="bg-default-50/30 dark:bg-default-100/5"
          >
            <TableCell
              className="w-0 max-w-0 overflow-visible p-0"
              colSpan={16}
            >
              <RemoteNodeInstanceRows
                copyToClipboard={copyToClipboard}
                formatTraffic={formatTraffic}
                instances={remoteInstances}
                parentOnline={remoteOnline}
                parentState={remoteDisplayState}
                parentTotalInFlow={node.totalInFlow ?? 0}
                parentTotalOutFlow={node.totalOutFlow ?? 0}
                parentTrafficRatio={node.trafficRatio ?? 1}
              />
            </TableCell>
          </TableRow>
        )}
    </>
  );
}
export function NodeListView({
  displayNodes,
  realtimeNodeMetrics,
  upgradeProgress,
  selectedIds,
  toggleSelect,
  toggleSelectAll,
  copyToClipboard,
  openUpgradeModal,
  handleEdit,
  handleDelete,
  formatTraffic,
  nodeGroups,
  filterGroupId,
  setFilterGroupId,
  handleDismissExpiryReminder,
  handleCopyOverseasInstallCommand,
  handleCopyOfflineInstallCommand,
  handleCopyAutoInstallCommand,
  nodeFilterMode,
  setNodeFilterMode,
  nodeExpiryStats,
  handleViewNodeTrafficLogs,
  handleTogglePause,
  nodeInstanceMembers = {},
  realtimeNodeInstanceMetrics = {},
  onConfigureInstance,
  onDeleteInstance,
  onResetInstanceTraffic,
  onToggleInstancePause,
  onCrossBorderRecheck,
  onCrossBorderCorrect,
  crossBorderRecheckingKeys,
  onReorderInstances,
  onInstallMimicDeps,
  onShareNode,
  onViewRemoteDetail,
  shareCounts,
  remoteUsageByNode,
}: NodeListViewProps) {
  const [expandedNodeIds, setExpandedNodeIds] =
    useState<Set<number>>(readExpandedNodeIds);
  const [highlightedNodeId, setHighlightedNodeId] = useState<number | null>(
    null,
  );
  const toggleHighlightedNode = (nodeId: number) => {
    setHighlightedNodeId((prev) => (prev === nodeId ? null : nodeId));
  };
  const localDisplayNodes = displayNodes.filter((node) => node.isRemote !== 1);
  const expandableDisplayNodes = displayNodes.filter((node) =>
    node.isRemote === 1
      ? (node.remoteInstances || []).some(
          (instance: RemoteInstance) => instance.inScope,
        )
      : true,
  );
  const isAllSelected =
    localDisplayNodes.length > 0 &&
    localDisplayNodes.every((node) => selectedIds.has(node.id));
  const isAllExpanded =
    expandableDisplayNodes.length > 0 &&
    expandableDisplayNodes.every((node) => expandedNodeIds.has(node.id));
  const expandedNodeCount = expandableDisplayNodes.filter((node) =>
    expandedNodeIds.has(node.id),
  ).length;
  const isPartiallyExpanded =
    expandedNodeCount > 0 && expandedNodeCount < expandableDisplayNodes.length;

  const toggleExpandedNode = (nodeId: number) => {
    setExpandedNodeIds(() => {
      const next = readExpandedNodeIds();

      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);

      localStorage.setItem(
        NODE_INSTANCE_EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(next)),
      );

      return next;
    });
  };

  const toggleAllExpandedNodes = () => {
    setExpandedNodeIds(() => {
      const next = readExpandedNodeIds();

      expandableDisplayNodes.forEach((node) => {
        if (isAllExpanded) next.delete(node.id);
        else next.add(node.id);
      });
      localStorage.setItem(
        NODE_INSTANCE_EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(next)),
      );

      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
      <Table
        aria-label="节点列表"
        className="min-w-[1654px] table-fixed"
        classNames={{
          th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
          td: "py-3 border-b border-divider/30 group-data-[last=true]:border-b-0 bg-white/80 backdrop-blur-sm dark:bg-content1/50",
          tr: "hover:bg-default-50/80 dark:hover:bg-default-100/30 transition-colors",
          wrapper: "p-0 shadow-none bg-transparent rounded-none",
        }}
      >
        <NodeTableColGroup />
        <TableHeader>
          <TableColumn className="whitespace-nowrap flex-shrink-0 w-[50px] text-center">
            <div className="flex items-center justify-center h-full">
              <Checkbox
                isSelected={isAllSelected}
                onValueChange={toggleSelectAll}
              />
            </div>
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            排序
          </TableColumn>
          <TableColumn className="w-[64px] whitespace-nowrap px-1 py-2 text-center">
            <SmartTooltip
              content={
                isAllExpanded
                  ? "闭合全部实例"
                  : isPartiallyExpanded
                    ? `已展开 ${expandedNodeCount}/${expandableDisplayNodes.length}，点击展开全部`
                    : "展开全部实例"
              }
            >
              <button
                className={`inline-flex items-center justify-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-default-200/70 disabled:cursor-default disabled:opacity-40 ${isPartiallyExpanded ? "text-primary" : ""}`}
                disabled={expandableDisplayNodes.length === 0}
                type="button"
                onClick={toggleAllExpandedNodes}
              >
                <span>展开</span>
                <svg
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform ${isAllExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </SmartTooltip>
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center w-[70px]">
            状态
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
            节点名称
            <span className="text-xs text-primary-500 font-normal">
              ^{displayNodes.length}个
            </span>
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            倍率
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            <Select
              aria-label="按分组筛选"
              className="!w-auto !min-w-0"
              classNames={{
                base: "!w-fit mx-auto",
                trigger:
                  "bg-transparent border-none shadow-none p-0 min-h-0 h-auto hover:bg-default-100/50 transition-colors text-center",
                value:
                  "text-sm text-default-600 font-semibold uppercase tracking-wider p-0",
                selectorIcon: "text-default-400 w-3.5 h-3.5 static m-0",
                innerWrapper: "w-fit flex-none",
                placeholder:
                  "text-sm text-default-600 font-semibold uppercase tracking-wider",
              }}
              placeholder="节点分组"
              selectedKeys={
                filterGroupId === null
                  ? []
                  : filterGroupId === NODE_GROUP_NONE
                    ? ["none"]
                    : filterGroupId === NODE_GROUP_REMOTE
                      ? ["remote"]
                      : [String(filterGroupId)]
              }
              size="sm"
              variant="flat"
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string | undefined;

                if (!selected || selected === "all") {
                  setFilterGroupId(null);
                } else if (selected === "none") {
                  setFilterGroupId(NODE_GROUP_NONE);
                } else if (selected === "remote") {
                  setFilterGroupId(NODE_GROUP_REMOTE);
                } else {
                  setFilterGroupId(parseInt(selected));
                }
              }}
            >
              <SelectItem key="all" textValue="全部分组">
                全部分组
              </SelectItem>
              <SelectItem key="none" textValue="未分组">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0" />
                  <span>未分组</span>
                </div>
              </SelectItem>
              <SelectItem key="remote" textValue="远程组">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 flex-shrink-0 rounded-full bg-purple-500" />
                  <span>远程组</span>
                </div>
              </SelectItem>
              {nodeGroups.map((group) => (
                <SelectItem key={group.id.toString()} textValue={group.name}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="truncate">{group.name}</span>
                    <span className="text-default-400 text-xs ml-auto">
                      {group.nodeCount}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
            节点地址
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            在线数
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-right">
            周期流量
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-right">
            上行流量
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-right">
            下行流量
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            流量限额
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
            <Select
              aria-label="按到期状态筛选"
              className="!w-auto !min-w-0"
              classNames={{
                base: "!w-fit mx-auto",
                trigger:
                  "bg-transparent border-none shadow-none p-0 min-h-0 h-auto hover:bg-default-100/50 transition-colors text-center",
                value:
                  "text-sm text-default-600 font-semibold uppercase tracking-wider p-0",
                selectorIcon: "text-default-400 w-3.5 h-3.5 static m-0",
                innerWrapper: "w-fit flex-none",
                placeholder:
                  "text-sm text-default-600 font-semibold uppercase tracking-wider",
              }}
              placeholder="到期提醒"
              selectedKeys={nodeFilterMode ? [nodeFilterMode] : []}
              size="sm"
              variant="flat"
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string | undefined;

                setNodeFilterMode?.(selected || "all");
              }}
            >
              <SelectItem key="expiringSoon">
                7 天内 ({nodeExpiryStats?.expiringSoon || 0})
              </SelectItem>
              <SelectItem key="expired">
                已逾期 ({nodeExpiryStats?.expired || 0})
              </SelectItem>
              <SelectItem key="withExpiry">
                已启用 ({nodeExpiryStats?.withExpiry || 0})
              </SelectItem>
            </Select>
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
            备注
          </TableColumn>
          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
            操作
          </TableColumn>
        </TableHeader>
        <TableBody>
          {displayNodes.length === 0 ? (
            <TableRow>
              <TableCell className="py-16 text-center" colSpan={16}>
                <div className="flex flex-col items-center justify-center">
                  <h3 className="text-base font-medium text-foreground mb-1">
                    未找到匹配的节点
                  </h3>
                  <p className="text-default-500 text-sm mb-3">
                    没有符合条件的节点配置，请调整筛选条件
                  </p>
                  <Button
                    color="warning"
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      setFilterGroupId(null);
                      setNodeFilterMode?.("all");
                    }}
                  >
                    归零筛选
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            displayNodes.map((node, nodeIndex) => (
              <SortableTableRow
                key={node.id}
                {...{
                  node,
                  realtimeNodeMetrics,
                  selectedIds,
                  toggleSelect,
                  copyToClipboard,
                  openUpgradeModal,
                  handleEdit,
                  handleDelete,
                  formatTraffic,
                  nodeGroups,
                  handleDismissExpiryReminder,
                  handleCopyOverseasInstallCommand,
                  handleCopyOfflineInstallCommand,
                  handleCopyAutoInstallCommand,
                  handleViewNodeTrafficLogs,
                  handleTogglePause,
                  instanceMembers: nodeInstanceMembers[node.id] || [],
                  realtimeInstanceMetrics: realtimeNodeInstanceMetrics,
                  upgradeProgress,
                  isLastNode: nodeIndex === displayNodes.length - 1,
                  isExpanded: expandedNodeIds.has(node.id),
                  isHighlighted: highlightedNodeId === node.id,
                  onToggleHighlighted: () => toggleHighlightedNode(node.id),
                  onToggleExpanded: toggleExpandedNode,
                  onConfigureInstance,
                  onDeleteInstance,
                  onResetInstanceTraffic,
                  onToggleInstancePause,
                  onCrossBorderRecheck,
                  onCrossBorderCorrect,
                  crossBorderRecheckingKeys,
                  onReorderInstances,
                  onInstallMimicDeps,
                  onShareNode,
                  onViewRemoteDetail,
                  shareCounts,
                  remoteUsageByNode,
                }}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
