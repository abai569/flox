import type { NodeRenewalCycle } from "./renewal";
import type { NodeSystemInfo } from "./system-info";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

import { getConnectionStatusMeta } from "./display";
import { getNodeRenewalSnapshot, formatNodeRenewalTime } from "./renewal";

import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
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
import {
  DistroIcon,
  parseDistroFromVersion,
  getDistroColor,
} from "@/components/distro-icon";
interface Node {
  id: number;
  inx?: number;
  name: string;
  remark?: string;
  expiryTime?: number;
  renewalCycle?: NodeRenewalCycle;
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil: number | null;
  ip: string;
  serverIp: string;
  intranetIp?: string;
  serverIpV4?: string;
  serverIpV6?: string;
  port: string;
  tcpListenAddr?: string;
  udpListenAddr?: string;
  extraIPs?: string;
  version?: string;
  http?: number;
  tls?: number;
  socks?: number;
  status: number;
  isRemote?: number;
  remoteUrl?: string;
  syncError?: string;
  connectionStatus: "online" | "offline";
  systemInfo?: NodeSystemInfo | null;
  copyLoading?: boolean;
  upgradeLoading?: boolean;
  rollbackLoading?: boolean;
  groupId?: number | null;
}
interface NodeListViewProps {
  displayNodes: Node[];
  realtimeNodeMetrics: Record<
    number,
    { uploadTraffic: number; downloadTraffic: number }
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
  handleDismissExpiryReminder?: (nodeId: number) => void;
  // 新增三种对接方式的处理函数
  handleCopyOverseasInstallCommand?: (node: Node) => void;
  handleCopyOfflineInstallCommand?: (node: Node) => void;
  handleCopyAutoInstallCommand?: (node: Node) => void;
  // 新增：点击流量图标查看流量记录
  handleViewNodeTrafficLogs?: (node: Node) => void;
  // 新增：归零节点流量
  handleResetNodeTraffic?: (node: Node) => void;
  nodeFilterMode?: any;
  setNodeFilterMode?: (mode: any) => void;
  nodeExpiryStats?: any;
}
function SortableTableRow({
  node,
  realtimeNodeMetrics,
  upgradeProgress,
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
  handleResetNodeTraffic,
}: any) {
  const [expiryPopoverOpen, setExpiryPopoverOpen] = useState(false);
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: node.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const rowBg = selectedIds.has(node.id)
    ? "bg-primary-50/70 dark:bg-primary-900/40"
    : "";
  const isRemoteNode = node.isRemote === 1;
  const connectionStatusMeta = getConnectionStatusMeta(node.connectionStatus);
  const expiryMeta = getNodeRenewalSnapshot(
    node.expiryTime,
    node.renewalCycle,
    7,
  );
  const hasExpiryInfo = Boolean(
    node.expiryTime &&
      node.expiryTime > 0 &&
      node.renewalCycle &&
      (node.expiryReminderDismissed !== 1 ||
        (node.expiryReminderDismissedUntil &&
          node.expiryReminderDismissedUntil * 1000 < Date.now())),
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

  return (
    <TableRow
      key={node.id}
      ref={setNodeRef}
      className="cursor-default"
      style={style}
    >
      <TableCell className={rowBg}>
        <div className="flex items-center justify-center h-full">
          <Checkbox
            isSelected={selectedIds.has(node.id)}
            onValueChange={() => toggleSelect(node.id)}
          />
        </div>
      </TableCell>
      <TableCell className={rowBg}>
        <div
          className="cursor-grab active:cursor-grabbing p-1 text-default-400 flex-shrink-0 hover:text-default-600 transition-colors"
          {...attributes}
          {...listeners}
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
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${connectionStatusMeta.color === "success" ? "bg-emerald-500" : "bg-rose-500"}`}
            title={connectionStatusMeta.text}
          />
          <span
            className="text-sm font-medium text-foreground truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
            title={node.name}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(node.name, "节点名称");
            }}
          >
            {node.name}
          </span>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        {node.groupId && node.groupId > 0 ? (
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
      <TableCell className={`whitespace-nowrap ${rowBg} align-middle`}>
        <div className="flex flex-col gap-1 min-w-[160px] py-1">
          <div className="flex justify-between items-center min-w-0 gap-3">
            <span className="text-default-500 text-[11px] flex-shrink-0">
              IPv4/域名
            </span>
            <span
              className="font-medium text-xs cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto text-right max-w-[130px]"
              title={
                node.serverIpV4?.trim() ||
                (node.serverIp?.trim() && !node.serverIp.includes(":")
                  ? node.serverIp.trim()
                  : undefined) ||
                "暂无"
              }
              onClick={(e) => {
                e.stopPropagation();
                const val =
                  node.serverIpV4?.trim() ||
                  (node.serverIp?.trim() && !node.serverIp.includes(":")
                    ? node.serverIp.trim()
                    : undefined);

                if (val) copyToClipboard(val, "IPv4/域名");
              }}
              >
                {(() => {
                  const val =
                    node.serverIpV4?.trim() ||
                    (node.serverIp?.trim() && !node.serverIp.includes(":")
                      ? node.serverIp.trim()
                      : undefined);
                  if (!val) return "暂无";
                  // 域名显示前两段
                  if (val.includes(".")) {
                    const parts = val.split(".");
                    if (parts.length >= 2) {
                      return `${parts[0]}.${parts[1]}.*`;
                    }
                    return parts[0].length > 12 ? parts[0].slice(0, 12) + "..." : parts[0];
                  }
                  // IP 地址只显示前两段
                  const ipParts = val.split(".");
                  if (ipParts.length === 4) {
                    return `${ipParts[0]}.${ipParts[1]}.*.*`;
                  }
                  return val.length > 15 ? val.slice(0, 15) + "..." : val;
                })()}
              </span>
          </div>
          <div className="flex justify-between items-center min-w-0 gap-3">
            <span className="text-default-500 text-[11px] flex-shrink-0">
              IPv6/域名
            </span>
            <span
              className={`font-medium text-xs cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto text-right max-w-[130px] ${!(node.serverIpV6?.trim() || (node.serverIp?.trim() && node.serverIp.includes(":") ? node.serverIp.trim() : undefined)) ? "text-default-300" : ""}`}
              title={
                node.serverIpV6?.trim() ||
                (node.serverIp?.trim() && node.serverIp.includes(":")
                  ? node.serverIp.trim()
                  : undefined) ||
                "暂无"
              }
              onClick={(e) => {
                e.stopPropagation();
                const v6Val =
                  node.serverIpV6?.trim() ||
                  (node.serverIp?.trim() && node.serverIp.includes(":")
                    ? node.serverIp.trim()
                    : undefined);

                if (v6Val) copyToClipboard(v6Val, "IPv6/域名");
              }}
            >
              {(() => {
                const v6Val =
                  node.serverIpV6?.trim() ||
                  (node.serverIp?.trim() && node.serverIp.includes(":")
                    ? node.serverIp.trim()
                    : undefined);
                if (!v6Val) return "暂无";
                // IPv6 地址只显示前缀
                if (v6Val.includes(":")) {
                  const parts = v6Val.split(":");
                  return parts.slice(0, 3).join(":") + "::";
                }
                // 域名显示前两段
                if (v6Val.includes(".")) {
                  const parts = v6Val.split(".");
                  if (parts.length >= 2) {
                    return `${parts[0]}.${parts[1]}.*`;
                  }
                  return parts[0].length > 12 ? parts[0].slice(0, 12) + "..." : parts[0];
                }
                return v6Val.length > 15 ? v6Val.slice(0, 15) + "..." : v6Val;
              })()}
            </span>
          </div>
          <div className="flex justify-between items-center min-w-0 gap-3">
            <span className="text-default-500 text-[11px] flex-shrink-0">
              内网IP/域名
            </span>
            <span
              className={`font-medium text-xs cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto text-right max-w-[130px] ${!node.intranetIp?.trim() ? "text-default-300" : ""}`}
              title={node.intranetIp?.trim() || "暂无"}
              onClick={(e) => {
                e.stopPropagation();
                if (node.intranetIp?.trim())
                  copyToClipboard(node.intranetIp.trim(), "内网IP/域名");
              }}
            >
              {(() => {
                const intranetVal = node.intranetIp?.trim();
                if (!intranetVal) return "暂无";
                // 域名显示前两段
                if (intranetVal.includes(".")) {
                  const parts = intranetVal.split(".");
                  if (parts.length >= 2) {
                    return `${parts[0]}.${parts[1]}.*`;
                  }
                  return parts[0].length > 12 ? parts[0].slice(0, 12) + "..." : parts[0];
                }
                // 内网 IP 只显示前两段
                const ipParts = intranetVal.split(".");
                if (ipParts.length === 4) {
                  return `${ipParts[0]}.${ipParts[1]}.*.*`;
                }
                return intranetVal.length > 15 ? intranetVal.slice(0, 15) + "..." : intranetVal;
              })()}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg} align-middle`}>
        {!isRemoteNode ? (
          <div className="flex flex-col gap-1 min-w-[100px] justify-center">
            {upgradeProgress?.[node.id]?.percent !== undefined &&
            upgradeProgress[node.id].percent < 100 ? (
              <>
                <Progress
                  aria-label="更新进度"
                  className="w-full"
                  color="warning"
                  size="sm"
                  value={upgradeProgress[node.id].percent}
                />
                <span className="text-[10px] text-warning-600 truncate">
                  {upgradeProgress[node.id].message}
                </span>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                {node.version && (
                  <DistroIcon
                    className="w-4 h-4 shrink-0"
                    distro={parseDistroFromVersion(node.version)}
                    style={{
                      color: getDistroColor(
                        parseDistroFromVersion(node.version),
                      ),
                    }}
                  />
                )}
                <span className="text-sm font-medium text-default-600">
                  {node.version ? node.version.split(" ")[0] : "未知"}
                </span>
              </div>
            )}
          </div>
        ) : (
          <Chip className="h-5 text-[10px] px-1" size="sm" variant="flat">
            远程
          </Chip>
        )}
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-sm text-danger-600 dark:text-danger-400">
            {node.connectionStatus === "online" &&
            realtimeNodeMetrics?.[node.id]
              ? formatTraffic(
                  (realtimeNodeMetrics?.[node.id]?.periodTraffic?.tx || 0) +
                    (realtimeNodeMetrics?.[node.id]?.periodTraffic?.rx || 0),
                )
              : "-"}
          </span>
          {handleViewNodeTrafficLogs && (
            <Button
              isIconOnly
              className="w-6 h-6"
              size="sm"
              variant="flat"
              onPress={() => handleViewNodeTrafficLogs(node)}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  clipRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  fillRule="evenodd"
                />
              </svg>
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        <div className="flex justify-end">
          <span className="text-sm text-success-700 dark:text-success-300">
            {node.connectionStatus === "online" &&
            realtimeNodeMetrics?.[node.id]
              ? formatTraffic(
                  realtimeNodeMetrics?.[node.id]?.periodTraffic?.tx || 0,
                )
              : "-"}
          </span>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        <div className="flex justify-end">
          <span className="text-sm text-primary-700 dark:text-primary-300">
            {node.connectionStatus === "online" &&
            realtimeNodeMetrics?.[node.id]
              ? formatTraffic(
                  realtimeNodeMetrics?.[node.id]?.periodTraffic?.rx || 0,
                )
              : "-"}
          </span>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        {node.remark?.trim() ? (
          <span
            className="text-sm max-w-[120px] cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit inline-block"
            title={node.remark.trim()}
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(node.remark!.trim(), "备注");
            }}
          >
            {node.remark.trim()}
          </span>
        ) : (
          <span className="text-sm text-default-400">-</span>
        )}
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        {hasExpiryInfo && expiryChipProps ? (
          <div className="relative">
            <button
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${expiryChipProps.className} ${expiryPopoverOpen ? "border-default-400 shadow-sm" : "border-transparent hover:border-default-300"}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpiryPopoverOpen(!expiryPopoverOpen);
              }}
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
              <span className="text-xs font-medium">
                {expiryChipProps.label}
              </span>
            </button>
            {expiryPopoverOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-divider/80 bg-background/98 p-3 shadow-xl backdrop-blur"
                onClick={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-medium text-default-500">
                      到期提醒
                    </div>
                    <button
                      className="text-[10px] text-default-400 hover:text-default-600 transition-colors"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        handleDismissExpiryReminder?.(node.id);
                        setExpiryPopoverOpen(false);
                      }}
                    >
                      更新周期
                    </button>
                  </div>
                  <div className="rounded-lg border border-divider/80 bg-default-50/80 px-3 py-2 text-xs leading-5 text-default-700">
                    {formatNodeRenewalTime(expiryMeta.nextDueTime)}{" "}
                    <span
                      className={`text-[10px] h-5 px-1.5 ml-1 inline-flex items-center justify-center rounded font-medium ${expiryChipProps.className}`}
                    >
                      {expiryChipProps.label}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="text-sm text-default-400">-</span>
        )}
      </TableCell>
      <TableCell className={`whitespace-nowrap ${rowBg}`}>
        <div className="flex justify-start gap-1">
          {!isRemoteNode && (
            <>
              <Dropdown>
                <DropdownTrigger>
                  <Button
                    className="min-h-7 px-2"
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
                className="min-h-7 px-2"
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
                className="min-h-7 px-2"
                color="primary"
                size="sm"
                variant="flat"
                onPress={() => handleEdit(node)}
              >
                编辑
              </Button>
              <Button
                className="min-h-7 px-2"
                color="success"
                size="sm"
                variant="flat"
                onPress={() => handleResetNodeTraffic(node)}
              >
                归零
              </Button>
            </>
          )}
          <Button
            className="min-h-7 px-2"
            color="danger"
            size="sm"
            variant="flat"
            onPress={() => handleDelete(node)}
          >
            删除
          </Button>
        </div>
      </TableCell>
    </TableRow>
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
  handleResetNodeTraffic,
}: NodeListViewProps) {
  const isAllSelected =
    displayNodes.length > 0 &&
    displayNodes.every((node) => selectedIds.has(node.id));

  return (
    <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
      <Table
        aria-label="节点列表"
        classNames={{
          th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
          td: "py-3 border-b border-divider/30 group-data-[last=true]:border-b-0 bg-white/80 backdrop-blur-sm dark:bg-content1/50",
          tr: "hover:bg-default-50/80 dark:hover:bg-default-100/30 transition-colors",
          wrapper: "p-0 shadow-none bg-transparent rounded-none",
        }}
      >
      <TableHeader>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[50px] text-center">
          <div className="flex items-center justify-center h-full">
            <Checkbox
              isSelected={isAllSelected}
              onValueChange={toggleSelectAll}
            />
          </div>
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[40px] text-center">
          排序
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[160px] text-left">
          节点名称
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
          <Select
            aria-label="按分组筛选"
            className="w-full min-w-[100px]"
            classNames={{
              trigger:
                "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1.5 hover:bg-default-100/50 transition-colors flex flex-row-reverse justify-end items-center",
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
                : filterGroupId === -1
                  ? ["none"]
                  : [String(filterGroupId)]
            }
            size="sm"
            variant="flat"
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0] as string | undefined;

              if (!selected || selected === "all") {
                setFilterGroupId(null);
              } else if (selected === "none") {
                setFilterGroupId(-1);
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
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
          地址
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[90px] text-left">
          版本
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[110px] text-right">
          周期流量
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[110px] text-right">
          上行流量
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[110px] text-right">
          下行流量
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[150px] text-left">
          备注
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
          <Select
            aria-label="按到期状态筛选"
            className="w-full min-w-[160px]"
            classNames={{
              trigger:
                "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1.5 hover:bg-default-100/50 transition-colors",
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
              7 天内续费 ({nodeExpiryStats?.expiringSoon || 0})
            </SelectItem>
            <SelectItem key="expired">
              已逾期 ({nodeExpiryStats?.expired || 0})
            </SelectItem>
            <SelectItem key="withExpiry">
              已启用续费提醒 ({nodeExpiryStats?.withExpiry || 0})
            </SelectItem>
          </Select>
        </TableColumn>
        <TableColumn className="whitespace-nowrap flex-shrink-0 w-[160px] text-left">
          操作
        </TableColumn>
      </TableHeader>
      <TableBody>
        {displayNodes.map((node) => (
          <SortableTableRow
            key={node.id}
            {...{
              node,
              realtimeNodeMetrics,
              upgradeProgress,
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
              handleResetNodeTraffic,
            }}
          />
        ))}
      </TableBody>
    </Table>
    </div>
  );
}
