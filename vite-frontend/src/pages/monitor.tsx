import type {
  MonitorNodeApiItem,
  MonitorNodeInstanceGroupApiItem,
  MonitorNodeInstanceGroupMemberApiItem,
  ServiceMonitorApiItem,
  ServiceMonitorResultApiItem,
} from "@/api/types";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { CountryFlag } from "@/components/country-flag";
import { MetricPill } from "@/components/metric-pill";
import { SmartTooltip } from "@/components/smart-tooltip";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  getMonitorNodes,
  getMonitorNodeInstanceGroups,
  getServiceMonitorLatestResults,
  getServiceMonitorList,
  updateNodeInstanceProfile,
} from "@/api";
import { MonitorView } from "@/pages/node/monitor-view";
import { TunnelMonitorView } from "@/pages/tunnel/tunnel-monitor-view";
import {
  MonitorTerminalButton,
  MonitorTerminalProvider,
} from "@/pages/monitor-terminal";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNodeRealtime } from "@/pages/node/use-node-realtime";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Input } from "@/shadcn-bridge/heroui/input";

type MonitorNode = {
  id: number;
  name: string;
  connectionStatus: "online" | "offline";
  version?: string;
  instanceCount?: number;
  onlineInstanceCount?: number;
};

type MonitorTab = "nodes" | "tunnels";

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatSpeed = (bytesPerSecond: number): string =>
  `${formatBytes(bytesPerSecond)}/s`;

const formatUptime = (seconds: number): string => {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  return days > 0 ? `${days} 天` : `${hours} 小时`;
};

type MonitorIPFamily = "v4" | "v6";

type RealtimeNodeInstanceMetric = {
  receivedAt: number;
  publicIpV4?: string;
  publicIpV6?: string;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  uptime: number;
  periodRx: number;
  periodTx: number;
  periodNetInBytes: number;
  periodNetOutBytes: number;
  onlineCount: number;
  tcpConns: number;
  udpConns: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
};

type RealtimeInstanceStatus = {
  status: number;
  receivedAt: number;
};

const REALTIME_INSTANCE_METRIC_STALE_MS = 90_000;
const INSTANCE_OFFLINE_GRACE_MS = 3_000;

type ServiceSummary = {
  ok: number;
  fail: number;
};

const MONITOR_INSTANCE_TABLE_COLUMNS = [
  "4%", // 状态
  "10%", // 实例名称
  "7.5%", // v4 地区
  "7.5%", // v6 地区
  "10%", // 出口 IP
  "8%", // 速率
  "6%", // 开机时长
  "8%", // 流量
  "8%", // CPU
  "8%", // RAM
  "8%", // 存储
  "5%", // 权重
  "10%", // 操作
] as const;

const isRealInstanceId = (instanceId?: string): boolean => {
  const value = instanceId?.trim() || "";

  return value !== "" && value.toLowerCase() !== "default";
};

const getInstanceMetricKey = (nodeId: number, instanceId?: string): string =>
  `${nodeId}:${instanceId?.trim() || ""}`;

const getDisplayInstanceLabel = (
  displayIndex?: number,
  fallbackIndex?: number,
): string => {
  const index = Number(displayIndex || 0);

  return `实例 ${index > 0 ? index : fallbackIndex || "-"}`;
};

const getDisplayInstanceName = (
  member?: Pick<
    MonitorNodeInstanceGroupMemberApiItem,
    "displayName" | "displayIndex"
  > | null,
  fallbackIndex?: number,
): string => {
  const displayName = member?.displayName?.trim();

  return (
    displayName || getDisplayInstanceLabel(member?.displayIndex, fallbackIndex)
  );
};

const getGroupConnectionTooltip = (
  tcpConns?: number,
  udpConns?: number,
): string => {
  const tcp = Number(tcpConns ?? 0);
  const udp = Number(udpConns ?? 0);

  return `TCP 总和 ${tcp}\nUDP 总和 ${udp}`;
};

const filterRealInstanceGroups = (
  groups: MonitorNodeInstanceGroupApiItem[],
): MonitorNodeInstanceGroupApiItem[] =>
  groups
    .map((group) => ({
      ...group,
      members: group.members.filter((member) =>
        isRealInstanceId(member.instanceId),
      ),
    }))
    .filter((group) => group.members.length > 0);

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 100) return 100;

  return value;
};

const getMonitorDisplayIP = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  family: MonitorIPFamily,
): string => {
  const reported = family === "v4" ? member.publicIpV4 : member.publicIpV6;

  return reported || "-";
};

const formatMonitorIPForCell = (ip?: string): string => {
  const value = ip?.trim() || "";

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

const getMonitorRegionIPTitle = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  family: MonitorIPFamily,
): string => {
  const reported = getMonitorDisplayIP(member, family);

  return reported === "-" ? "" : reported;
};

const formatMonitorCountryCity = (region?: string): string => {
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

function MonitorRegionCellValue({
  countryCode,
  region,
}: {
  countryCode?: string;
  region?: string;
}) {
  const value = formatMonitorCountryCity(region);

  if (!value) return <span className="block h-5" />;

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary-500/10 px-2 py-0.5 text-secondary-700">
      <CountryFlag code={countryCode} title={value} />
      <span className="truncate">{value}</span>
    </span>
  );
}

const copyMonitorIP = (ip: string | undefined, label: string): void => {
  const value = ip?.trim();

  if (!value) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      void navigator.clipboard
        .writeText(value)
        .then(() => toast.success(`${label}已复制到剪贴板`))
        .catch(() => toast.error("复制失败，请手动选择文本复制"));

      return;
    }

    const textArea = document.createElement("textarea");
    const modalElement = document.querySelector('[role="dialog"]');
    const targetContainer = modalElement || document.body;

    textArea.value = value;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "-9999px";
    textArea.style.opacity = "0";
    targetContainer.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999);

    const successful = document.execCommand("copy");

    targetContainer.removeChild(textArea);
    if (successful) {
      toast.success(`${label}已复制到剪贴板`);
    } else {
      toast.error("复制失败，请手动选择文本复制");
    }
  } catch {
    toast.error("复制失败，请手动选择文本复制");
  }
};

function MonitorIPCellValue({ ip, label }: { ip?: string; label: string }) {
  const value = ip?.trim();

  if (!value) {
    return (
      <span className="block w-full text-center leading-5">
        <span className="inline-block max-w-full truncate px-1 text-default-300">
          -
        </span>
      </span>
    );
  }

  return (
    <SmartTooltip content={value}>
      <button
        className="inline-block max-w-full truncate rounded bg-transparent px-1 text-center font-mono text-xs text-default-600 transition-colors hover:bg-default-200/50 hover:text-primary"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          copyMonitorIP(value, label);
        }}
      >
        {formatMonitorIPForCell(value)}
      </button>
    </SmartTooltip>
  );
}

const getMonitorPrimaryDisplayIP = (
  member: MonitorNodeInstanceGroupMemberApiItem,
): string => {
  const v4 = getMonitorDisplayIP(member, "v4");

  return v4 !== "-" ? v4 : getMonitorDisplayIP(member, "v6");
};

function UsageMeter({
  value,
  tone,
}: {
  value: number;
  tone: "cpu" | "memory" | "disk";
}) {
  const percent = clampPercent(value);
  const colorClass =
    tone === "cpu"
      ? "bg-pink-500"
      : tone === "memory"
        ? "bg-violet-600"
        : "bg-indigo-500";

  return (
    <div className="relative h-7 w-full min-w-0 overflow-hidden rounded-md border border-default-300 bg-default-200/80">
      <div
        className={`absolute inset-y-0 left-0 ${colorClass}`}
        style={{ width: `${percent}%` }}
      />
      <div className="relative z-10 flex h-full items-center px-2 text-xs font-bold text-white tabular-nums">
        {percent.toFixed(1)}%
      </div>
    </div>
  );
}

const mergeRealtimeMetric = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  realtimeMetrics: Record<string, RealtimeNodeInstanceMetric>,
  realtimeStatuses: Record<string, RealtimeInstanceStatus>,
): MonitorNodeInstanceGroupMemberApiItem => {
  const key = getInstanceMetricKey(member.nodeId, member.instanceId);
  const metric = realtimeMetrics[key];
  const realtimeStatus = realtimeStatuses[key];
  const status =
    realtimeStatus &&
    Date.now() - realtimeStatus.receivedAt <= REALTIME_INSTANCE_METRIC_STALE_MS
      ? realtimeStatus.status
      : member.status;

  if (
    !metric ||
    Date.now() - metric.receivedAt > REALTIME_INSTANCE_METRIC_STALE_MS
  )
    return status === member.status ? member : { ...member, status };

  return {
    ...member,
    status,
    publicIpV4: metric.publicIpV4 || member.publicIpV4,
    publicIpV6: metric.publicIpV6 || member.publicIpV6,
    netInSpeed: metric.netInSpeed,
    netOutSpeed: metric.netOutSpeed,
    netInBytes: metric.netInBytes,
    netOutBytes: metric.netOutBytes,
    uptime: metric.uptime || member.uptime,
    periodRx: metric.periodRx,
    periodTx: metric.periodTx,
    periodNetInBytes: metric.periodNetInBytes,
    periodNetOutBytes: metric.periodNetOutBytes,
    onlineCount: metric.onlineCount,
    tcpConns: metric.tcpConns,
    udpConns: metric.udpConns,
    cpuUsage: metric.cpuUsage,
    memoryUsage: metric.memoryUsage,
    diskUsage: metric.diskUsage,
  };
};

function MonitorRealtimeStatus({
  wsConnected,
  wsConnecting,
}: {
  wsConnected: boolean;
  wsConnecting: boolean;
}) {
  return (
    <div className="flex items-center overflow-x-auto overscroll-x-contain whitespace-nowrap text-xs">
      <span className="inline-flex shrink-0 items-center gap-2 text-default-600">
        <StatusDot
          active={wsConnected}
          className="h-2 w-2"
          tone={wsConnected ? "success" : wsConnecting ? "warning" : "default"}
        />
        {wsConnected
          ? "实时已连接"
          : wsConnecting
            ? "实时连接中"
            : "实时未连接"}
      </span>
    </div>
  );
}

function NodeInstanceGroupsView({
  groups,
  loading,
  realtimeMetrics,
  realtimeStatuses,
  onEditInstance,
  onOpenDetail,
}: {
  groups: MonitorNodeInstanceGroupApiItem[];
  loading: boolean;
  realtimeMetrics: Record<string, RealtimeNodeInstanceMetric>;
  realtimeStatuses: Record<string, RealtimeInstanceStatus>;
  onEditInstance: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onOpenDetail: (nodeId: number, instanceId: string) => void;
}) {
  if (loading && groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          正在加载节点实例监控...
        </CardBody>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          暂无节点实例负载数据
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const members = group.members.map((member) =>
          mergeRealtimeMetric(member, realtimeMetrics, realtimeStatuses),
        );
        const totalOutSpeed = members.reduce(
          (sum, member) => sum + member.netOutSpeed,
          0,
        );
        const totalInSpeed = members.reduce(
          (sum, member) => sum + member.netInSpeed,
          0,
        );
        const totalTCPConns = members.reduce(
          (sum, member) => sum + Number(member.tcpConns ?? 0),
          0,
        );
        const totalUDPConns = members.reduce(
          (sum, member) => sum + Number(member.udpConns ?? 0),
          0,
        );
        const groupConnectionTooltip = getGroupConnectionTooltip(
          totalTCPConns,
          totalUDPConns,
        );

        return (
          <section
            key={group.id}
            className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-sm"
          >
            <div className="flex w-full items-center gap-2 px-3 py-3 md:justify-start md:px-4 md:py-4">
              <div className="flex min-w-0 shrink items-center gap-2 md:flex-none">
                <span className="min-w-0 max-w-[120px] truncate rounded-md border border-default-300 px-2 py-1.5 text-xs font-medium text-secondary sm:max-w-[180px] md:max-w-none md:px-4 md:text-sm">
                  {group.name}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs md:flex-none md:gap-2 md:text-sm">
                <span
                  className="inline-flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-secondary-500/15 px-1 text-secondary-700 tabular-nums md:w-[176px] md:flex-none md:gap-2 md:px-3"
                  title={groupConnectionTooltip}
                >
                  {formatSpeed(totalOutSpeed)}
                  <ArrowUp className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </span>
                <span
                  className="inline-flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-primary-500/15 px-1 text-primary-700 tabular-nums md:w-[176px] md:flex-none md:gap-2 md:px-3"
                  title={groupConnectionTooltip}
                >
                  {formatSpeed(totalInSpeed)}
                  <ArrowDown className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </span>
              </div>
            </div>
            <div className="px-3 pb-4">
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[1200px] table-fixed text-sm">
                  <colgroup>
                    {MONITOR_INSTANCE_TABLE_COLUMNS.map((width, index) => (
                      <col key={index} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="border-b border-default-400/70 text-sm text-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        状态
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-start">
                        实例名称
                        <span className="text-xs text-primary-500 font-normal">
                          ^{members.length}个
                        </span>
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        v4 地区
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        v6 地区
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        出口 IP
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        速率
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        开机时长
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        流量
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        CPU
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        RAM
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        存储
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        权重
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-start">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member, memberIndex) => {
                      return (
                        <tr
                          key={getInstanceMetricKey(
                            member.nodeId,
                            member.instanceId,
                          )}
                          className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50"
                        >
                          <td className="px-1 py-3 text-center align-middle">
                            <StatusDot
                              active={member.weight > 0 && member.status === 1}
                              title={
                                member.weight <= 0
                                  ? "已禁用（权重为 0）"
                                  : member.status === 1
                                    ? "在线"
                                    : "离线"
                              }
                              tone={
                                member.weight <= 0
                                  ? "default"
                                  : member.status === 1
                                    ? "success"
                                    : "danger"
                              }
                            />
                          </td>
                          <td className="px-1 py-3 text-start align-middle font-medium whitespace-nowrap">
                            {getDisplayInstanceName(member, memberIndex + 1)}
                          </td>
                          <td className="group relative px-1 py-3 text-center align-middle font-mono text-xs text-default-600">
                            <div className="truncate">
                              <MonitorRegionCellValue
                                countryCode={member.publicIpV4CountryCode}
                                region={member.publicIpV4Region}
                              />
                            </div>
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                              {getMonitorRegionIPTitle(member, "v4")}
                            </div>
                          </td>
                          <td className="group relative px-1 py-3 text-center align-middle font-mono text-xs text-default-600">
                            <div className="truncate">
                              <MonitorRegionCellValue
                                countryCode={member.publicIpV6CountryCode}
                                region={member.publicIpV6Region}
                              />
                            </div>
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                              {getMonitorRegionIPTitle(member, "v6")}
                            </div>
                          </td>
                          <td className="px-1 py-3 text-center align-middle font-mono text-xs text-default-600">
                            <MonitorIPCellValue
                              ip={member.publicIpV4}
                              label="IPv4"
                            />
                            <MonitorIPCellValue
                              ip={member.publicIpV6}
                              label="IPv6"
                            />
                          </td>
                          <td className="group relative px-1 py-3 text-center align-middle font-mono text-xs leading-5 tabular-nums">
                            <div className="truncate">
                              {formatSpeed(member.netOutSpeed)}↑
                            </div>
                            <div className="truncate">
                              {formatSpeed(member.netInSpeed)}↓
                            </div>
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                              TCP: {member.tcpConns ?? 0} | UDP:{" "}
                              {member.udpConns ?? 0}
                            </div>
                          </td>
                          <td className="px-1 py-3 text-center align-middle">
                            <div className="truncate">
                              {formatUptime(member.uptime)}
                            </div>
                          </td>
                          <td className="group relative px-1 py-3 text-center align-middle font-mono text-xs">
                            <div className="truncate">
                              {formatBytes(member.periodNetOutBytes)}↑
                            </div>
                            <div className="truncate">
                              {formatBytes(member.periodNetInBytes)}↓
                            </div>
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                              总量:
                              {formatBytes(
                                member.periodNetOutBytes +
                                  member.periodNetInBytes,
                              )}
                            </div>
                          </td>
                          <td className="px-1 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter tone="cpu" value={member.cpuUsage} />
                            </div>
                          </td>
                          <td className="px-1 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter
                                tone="memory"
                                value={member.memoryUsage}
                              />
                            </div>
                          </td>
                          <td className="px-1 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter
                                tone="disk"
                                value={member.diskUsage}
                              />
                            </div>
                          </td>
                          <td className="px-1 py-3 text-center align-middle font-mono tabular-nums">
                            <div className="flex justify-center">
                              <Chip
                                className={`h-6 min-w-10 justify-center rounded-md px-2 font-mono tabular-nums ${
                                  member.weight <= 0
                                    ? "bg-default-200 text-default-600"
                                    : ""
                                }`}
                                color={
                                  member.weight > 0 ? "primary" : "default"
                                }
                                size="sm"
                                variant="flat"
                              >
                                {member.weight > 0 ? member.weight : "禁用"}
                              </Chip>
                            </div>
                          </td>
                          <td className="px-1 py-3 align-middle">
                            <div className="flex min-w-0 justify-start gap-1 whitespace-nowrap">
                              <Button
                                className="h-8 shrink-0 px-2 text-xs font-medium"
                                color="primary"
                                size="sm"
                                variant="flat"
                                onPress={() => onEditInstance(member)}
                              >
                                编辑
                              </Button>
                              <MonitorTerminalButton
                                className="h-8 shrink-0 px-2 text-xs font-medium"
                                member={member}
                              />
                              <Button
                                className="h-8 shrink-0 px-2 text-xs font-medium"
                                color="success"
                                size="sm"
                                variant="flat"
                                onPress={() =>
                                  onOpenDetail(
                                    member.nodeId,
                                    member.instanceId || "",
                                  )
                                }
                              >
                                详情
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function MonitorPage() {
  const [nodes, setNodes] = useState<MonitorNodeApiItem[]>([]);
  const [nodeInstanceGroups, setNodeInstanceGroups] = useState<
    MonitorNodeInstanceGroupApiItem[]
  >([]);
  const [serviceMonitors, setServiceMonitors] = useState<
    ServiceMonitorApiItem[]
  >([]);
  const [serviceMonitorResults, setServiceMonitorResults] = useState<
    ServiceMonitorResultApiItem[]
  >([]);
  const [realtimeNodeStatus, setRealtimeNodeStatus] = useState<
    Record<number, "online" | "offline">
  >({});
  const [realtimeInstanceMetrics, setRealtimeInstanceMetrics] = useState<
    Record<string, RealtimeNodeInstanceMetric>
  >({});
  const [realtimeInstanceStatuses, setRealtimeInstanceStatuses] = useState<
    Record<string, RealtimeInstanceStatus>
  >({});
  const offlineTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const instanceOfflineTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const instanceRefreshTimersRef = useRef<
    Map<number, ReturnType<typeof setTimeout>>
  >(new Map());
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodeInstanceGroupsLoading, setNodeInstanceGroupsLoading] =
    useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [instanceEditModalOpen, setInstanceEditModalOpen] = useState(false);
  const [instanceEditTarget, setInstanceEditTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [instanceEditSaving, setInstanceEditSaving] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    nodeId: number;
    instanceId: string;
  } | null>(null);
  const detailNodeId = detailTarget?.nodeId ?? null;
  const [viewMode] = useState<"list" | "grid">(() => {
    try {
      const saved = localStorage.getItem("monitor-view-mode");

      if (saved === "grid" || saved === "list") return saved;
    } catch {
      /* ignore */
    }

    return "list";
  });
  const [activeTab, setActiveTab] = useState<MonitorTab>(() => {
    try {
      const saved = localStorage.getItem("monitor-active-tab");

      if (saved === "nodes" || saved === "tunnels") return saved as MonitorTab;
    } catch {}

    return "nodes";
  });

  useEffect(() => {
    try {
      localStorage.setItem("monitor-active-tab", activeTab);
    } catch {}
  }, [activeTab]);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);
  const [tunnelRefreshTrigger, setTunnelRefreshTrigger] = useState(0);
  const tunnelRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const nodeDetailRefreshRef = useRef<(() => Promise<void>) | null>(null);

  const loadNodeInstanceGroups = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!silent) setNodeInstanceGroupsLoading(true);
      try {
        const response = await getMonitorNodeInstanceGroups();

        if (response.code === 0 && Array.isArray(response.data)) {
          setNodeInstanceGroups(filterRealInstanceGroups(response.data));

          return;
        }
        if (!silent) toast.error(response.msg || "加载节点实例负载失败");
      } catch {
        if (!silent) toast.error("加载节点实例负载失败");
      } finally {
        if (!silent) setNodeInstanceGroupsLoading(false);
      }
    },
    [],
  );
  const scheduleInstanceRefresh = useCallback(
    (nodeId: number) => {
      if (instanceRefreshTimersRef.current.has(nodeId)) return;
      const timer = setTimeout(async () => {
        try {
          await loadNodeInstanceGroups({ silent: true });
        } finally {
          instanceRefreshTimersRef.current.delete(nodeId);
        }
      }, 500);

      instanceRefreshTimersRef.current.set(nodeId, timer);
    },
    [],
  );

  const loadNodes = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!silent) setNodesLoading(true);
      try {
        const response = await getMonitorNodes();

        if (response.code === 0 && Array.isArray(response.data)) {
          setNodesError(null);
          setNodes(response.data);

          return;
        }
        if (response.code === 403) {
          setNodes([]);
          setNodesError(response.msg || "暂无监控权限，请联系管理员授权");

          return;
        }
        if (!silent) toast.error(response.msg || "加载节点失败");
      } catch {
        if (!silent) toast.error("加载节点失败");
      } finally {
        if (!silent) setNodesLoading(false);
      }
    },
    [loadNodeInstanceGroups],
  );

  const loadServiceSummary = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      try {
        const [monitorsResponse, resultsResponse] = await Promise.all([
          getServiceMonitorList(),
          getServiceMonitorLatestResults(),
        ]);

        if (
          monitorsResponse.code === 0 &&
          Array.isArray(monitorsResponse.data)
        ) {
          setServiceMonitors(monitorsResponse.data);
        }
        if (resultsResponse.code === 0 && Array.isArray(resultsResponse.data)) {
          setServiceMonitorResults(resultsResponse.data);
        }
      } catch {
        if (!silent) toast.error("加载服务监控统计失败");
      }
    },
    [],
  );

  const loadNodeTab = useCallback(
    async (options?: { silent?: boolean }) => {
      await Promise.all([
        loadNodes(options),
        loadNodeInstanceGroups(options),
        loadServiceSummary(options),
      ]);
    },
    [loadNodes, loadNodeInstanceGroups, loadServiceSummary],
  );

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === "nodes") {
      await Promise.all([
        loadNodeTab(),
        ...(nodeDetailRefreshRef.current
          ? [nodeDetailRefreshRef.current()]
          : []),
      ]);
      return;
    }
    if (tunnelRefreshRef.current) {
      await tunnelRefreshRef.current();
      return;
    }
    setTunnelRefreshTrigger((prev) => prev + 1);
  }, [activeTab, loadNodeTab]);
  const handleTunnelRefreshReady = useCallback(
    (refresh: (() => Promise<void>) | null) => {
      tunnelRefreshRef.current = refresh;
    },
    [],
  );
  const handleNodeDetailRefreshReady = useCallback(
    (refresh: (() => Promise<void>) | null) => {
      nodeDetailRefreshRef.current = refresh;
    },
    [],
  );

  useEffect(() => {
    void loadNodes();
    void loadNodeInstanceGroups();
    void loadServiceSummary();
  }, [loadNodes, loadNodeInstanceGroups, loadServiceSummary]);
  usePullToRefresh(refreshActiveTab);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();

      setRealtimeInstanceMetrics((prev) => {
        const next = Object.fromEntries(
          Object.entries(prev).filter(
            ([, metric]) =>
              now - metric.receivedAt <= REALTIME_INSTANCE_METRIC_STALE_MS,
          ),
        );

        return Object.keys(next).length === Object.keys(prev).length
          ? prev
          : next;
      });
      setRealtimeInstanceStatuses((prev) => {
        const next = Object.fromEntries(
          Object.entries(prev).filter(
            ([, status]) =>
              now - status.receivedAt <= REALTIME_INSTANCE_METRIC_STALE_MS,
          ),
        );

        return Object.keys(next).length === Object.keys(prev).length
          ? prev
          : next;
      });
      void loadNodes({ silent: true });
      void loadNodeInstanceGroups({ silent: true });
      void loadServiceSummary({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadNodes, loadNodeInstanceGroups, loadServiceSummary]);

  const handleRealtimeMessage = useCallback(
    (message: any) => {
      const nodeId = Number(message?.id ?? 0);

      if (!nodeId || Number.isNaN(nodeId)) return;

      const type = String(message?.type ?? "");
      const payload = message?.data;

      if (type === "status") {
        const status = Number(payload);

        if (status === 1) {
          const timer = offlineTimersRef.current.get(nodeId);

          if (timer) {
            clearTimeout(timer);
            offlineTimersRef.current.delete(nodeId);
          }
          setRealtimeNodeStatus((prev) => ({ ...prev, [nodeId]: "online" }));
        } else {
          const timer = offlineTimersRef.current.get(nodeId);

          if (timer) clearTimeout(timer);
          const nextTimer = setTimeout(() => {
            offlineTimersRef.current.delete(nodeId);
            setRealtimeNodeStatus((prev) => ({ ...prev, [nodeId]: "offline" }));
          }, 3000);

          offlineTimersRef.current.set(nodeId, nextTimer);
        }

        return;
      }

      if (type === "instance_status") {
        let raw = payload;

        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw);
          } catch {
            return;
          }
        }
        if (!raw || typeof raw !== "object") return;

        const statusData = raw as Record<string, unknown>;
        const instanceId = String(
          statusData.instanceId ?? statusData.instance_id ?? "",
        ).trim();
        const status = Number(statusData.status ?? 0) === 1 ? 1 : 0;

        if (!isRealInstanceId(instanceId)) return;
        const metricKey = getInstanceMetricKey(nodeId, instanceId);
        const pendingOffline = instanceOfflineTimersRef.current.get(metricKey);

        if (pendingOffline) {
          clearTimeout(pendingOffline);
          instanceOfflineTimersRef.current.delete(metricKey);
        }

        if (status === 0) {
          const timer = setTimeout(() => {
            instanceOfflineTimersRef.current.delete(metricKey);
            setNodeInstanceGroups((prev) =>
              prev.map((group) =>
                Number(group.id) !== nodeId
                  ? group
                  : {
                      ...group,
                      members: group.members.map((member) =>
                        (member.instanceId || "").trim() === instanceId
                          ? { ...member, status: 0 }
                          : member,
                      ),
                    },
              ),
            );
            setRealtimeInstanceMetrics((prev) => {
              if (!(metricKey in prev)) return prev;
              const next = { ...prev };

              delete next[metricKey];

              return next;
            });
            setRealtimeInstanceStatuses((prev) => ({
              ...prev,
              [metricKey]: { status: 0, receivedAt: Date.now() },
            }));
          }, INSTANCE_OFFLINE_GRACE_MS);

          instanceOfflineTimersRef.current.set(metricKey, timer);

          return;
        }
        setRealtimeInstanceStatuses((prev) => ({
          ...prev,
          [metricKey]: { status: 1, receivedAt: Date.now() },
        }));
        const knownInstance = nodeInstanceGroups.some(
          (group) =>
            Number(group.id) === nodeId &&
            group.members.some(
              (member) => (member.instanceId || "").trim() === instanceId,
            ),
        );

        if (!knownInstance) {
          scheduleInstanceRefresh(nodeId);
        }
        const nodeOfflineTimer = offlineTimersRef.current.get(nodeId);

        if (nodeOfflineTimer) {
          clearTimeout(nodeOfflineTimer);
          offlineTimersRef.current.delete(nodeId);
        }
        setRealtimeNodeStatus((prev) => ({ ...prev, [nodeId]: "online" }));

        return;
      }

      if (type !== "metric") return;

      let raw = payload;

      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return;
        }
      }
      if (!raw || typeof raw !== "object") return;

      const metric = raw as Record<string, unknown>;
      const instanceId = String(
        metric.instanceId ?? metric.instance_id ?? "",
      ).trim();

      if (!isRealInstanceId(instanceId)) return;
      const knownInstance = nodeInstanceGroups.some(
        (group) =>
          Number(group.id) === nodeId &&
          group.members.some(
            (member) => (member.instanceId || "").trim() === instanceId,
          ),
      );

      if (!knownInstance) {
        scheduleInstanceRefresh(nodeId);
      }

      const tcpConns = Number(metric.tcpConns ?? metric.tcp_conns ?? 0);
      const udpConns = Number(metric.udpConns ?? metric.udp_conns ?? 0);
      const metricKey = getInstanceMetricKey(nodeId, instanceId);
      const pendingOffline = instanceOfflineTimersRef.current.get(metricKey);

      if (pendingOffline) {
        clearTimeout(pendingOffline);
        instanceOfflineTimersRef.current.delete(metricKey);
      }
      const nodeOfflineTimer = offlineTimersRef.current.get(nodeId);

      if (nodeOfflineTimer) {
        clearTimeout(nodeOfflineTimer);
        offlineTimersRef.current.delete(nodeId);
      }
      setRealtimeInstanceStatuses((prev) => ({
        ...prev,
        [metricKey]: { status: 1, receivedAt: Date.now() },
      }));

      setRealtimeInstanceMetrics((prev) => ({
        ...prev,
        [metricKey]: {
          receivedAt: Date.now(),
          publicIpV4: String(metric.publicIpV4 ?? metric.public_ip_v4 ?? ""),
          publicIpV6: String(metric.publicIpV6 ?? metric.public_ip_v6 ?? ""),
          netInBytes: Number(metric.netInBytes ?? metric.bytes_received ?? 0),
          netOutBytes: Number(
            metric.netOutBytes ?? metric.bytes_transmitted ?? 0,
          ),
          netInSpeed: Number(metric.netInSpeed ?? metric.net_in_speed ?? 0),
          netOutSpeed: Number(metric.netOutSpeed ?? metric.net_out_speed ?? 0),
          uptime: Number(
            metric.uptime ??
              prev[getInstanceMetricKey(nodeId, instanceId)]?.uptime ??
              0,
          ),
          periodRx: Number(
            metric.periodRx ?? metric.period_bytes_received ?? 0,
          ),
          periodTx: Number(
            metric.periodTx ?? metric.period_bytes_transmitted ?? 0,
          ),
          periodNetInBytes: Number(
            metric.periodNetInBytes ?? metric.period_net_in_bytes ?? 0,
          ),
          periodNetOutBytes: Number(
            metric.periodNetOutBytes ?? metric.period_net_out_bytes ?? 0,
          ),
          onlineCount: tcpConns + udpConns,
          tcpConns,
          udpConns,
          cpuUsage: Number(metric.cpuUsage ?? metric.cpu_usage ?? 0),
          memoryUsage: Number(metric.memoryUsage ?? metric.memory_usage ?? 0),
          diskUsage: Number(metric.diskUsage ?? metric.disk_usage ?? 0),
        },
      }));
      setRealtimeNodeStatus((prev) => ({ ...prev, [nodeId]: "online" }));
    },
    [nodeInstanceGroups, scheduleInstanceRefresh],
  );

  const { wsConnected, wsConnecting } = useNodeRealtime({
    onMessage: handleRealtimeMessage,
    enabled: activeTab === "nodes" && detailNodeId == null,
  });

  useEffect(() => {
    return () => {
      offlineTimersRef.current.forEach((timer) => clearTimeout(timer));
      offlineTimersRef.current.clear();
      instanceOfflineTimersRef.current.forEach((timer) => clearTimeout(timer));
      instanceOfflineTimersRef.current.clear();
      instanceRefreshTimersRef.current.forEach((timer) => clearTimeout(timer));
      instanceRefreshTimersRef.current.clear();
    };
  }, []);

  const openInstanceEditModal = useCallback(
    (member: MonitorNodeInstanceGroupMemberApiItem) => {
      setInstanceEditTarget(member);
      setWeightValue(String(member.weight ?? 1));
      setInstanceEditModalOpen(true);
    },
    [],
  );

  const saveInstanceProfile = useCallback(
    async (overrideWeight?: number) => {
      if (!instanceEditTarget?.instanceId) return;
      const nextWeight = overrideWeight ?? Number(weightValue);

      if (!Number.isFinite(nextWeight) || nextWeight < 0 || nextWeight > 10) {
        toast.error("权重必须在 0-10 之间");

        return;
      }
      setInstanceEditSaving(true);
      try {
        const res = await updateNodeInstanceProfile({
          nodeId: instanceEditTarget.nodeId,
          instanceId: instanceEditTarget.instanceId,
          displayName: instanceEditTarget.displayName || "",
          remark: instanceEditTarget.remark || "",
          weight: Math.floor(nextWeight),
          portRange: instanceEditTarget.portRange || "",
          expiryTime: instanceEditTarget.expiryTime || null,
          renewalCycle: instanceEditTarget.renewalCycle || "",
          flowResetTime: instanceEditTarget.flowResetTime ?? 0,
          trafficLimit: instanceEditTarget.trafficLimit || 0,
        });

        if (res.code === 0) {
          toast.success("实例权重已更新，正在重新下发线路配置");
          setInstanceEditModalOpen(false);
          setInstanceEditTarget(null);
          await loadNodeInstanceGroups({ silent: true });
          await loadNodes({ silent: true });
        } else {
          toast.error(res.msg || "更新实例配置失败");
        }
      } catch {
        toast.error("更新实例配置失败");
      } finally {
        setInstanceEditSaving(false);
      }
    },
    [instanceEditTarget, loadNodes, loadNodeInstanceGroups, weightValue],
  );

  const nodeMap = useMemo(() => {
    const instanceCounts = new Map<number, { total: number; online: number }>();

    nodeInstanceGroups.forEach((group) => {
      const members = group.members.map((member) =>
        mergeRealtimeMetric(
          member,
          realtimeInstanceMetrics,
          realtimeInstanceStatuses,
        ),
      );

      instanceCounts.set(group.id, {
        total: members.length,
        online: members.filter((member) => member.status === 1).length,
      });
    });

    const list: MonitorNode[] = nodes
      .filter((n) => Number(n.id) > 0 && n.isRemote !== 1)
      .map((n) => {
        const id = Number(n.id);
        const counts = instanceCounts.get(id);
        const realtimeStatus = realtimeNodeStatus[id];

        return {
          id,
          name: String(n.name ?? ""),
          connectionStatus:
            realtimeStatus ?? (n.status === 1 ? "online" : "offline"),
          version: n.version,
          instanceCount: counts?.total ?? Number(n.instanceCount ?? 0),
          onlineInstanceCount:
            counts?.online ?? Number(n.onlineInstanceCount ?? 0),
        };
      });

    return new Map<number, MonitorNode>(list.map((n) => [n.id, n]));
  }, [
    nodeInstanceGroups,
    nodes,
    realtimeInstanceMetrics,
    realtimeInstanceStatuses,
    realtimeNodeStatus,
  ]);

  const monitorNodes = useMemo(() => Array.from(nodeMap.values()), [nodeMap]);
  const nodeSummary = useMemo(() => {
    return monitorNodes.reduce(
      (acc, node) => {
        acc.total += 1;
        if (node.connectionStatus === "online") acc.online += 1;
        acc.instances += Number(node.instanceCount ?? 0);
        acc.onlineInstances += Number(node.onlineInstanceCount ?? 0);

        return acc;
      },
      { total: 0, online: 0, instances: 0, onlineInstances: 0 },
    );
  }, [monitorNodes]);
  const serviceSummary = useMemo(() => {
    const resultByMonitorId = new Map<number, ServiceMonitorResultApiItem>();

    serviceMonitorResults.forEach((result) => {
      resultByMonitorId.set(Number(result.monitorId), result);
    });

    return serviceMonitors.reduce<ServiceSummary>(
      (acc, monitor) => {
        if (monitor.enabled !== 1) return acc;
        const result = resultByMonitorId.get(Number(monitor.id));

        if (!result) return acc;
        if (result.success === 1) acc.ok += 1;
        else acc.fail += 1;

        return acc;
      },
      { ok: 0, fail: 0 },
    );
  }, [serviceMonitorResults, serviceMonitors]);

  return (
    <MonitorTerminalProvider>
      <AnimatedPage className="px-3 lg:px-6 py-8">
        <div className="mb-4 space-y-3">
          {/* 第一行：左侧按钮组 */}
          <div className="flex items-center gap-1">
            {/* 卡片/列表切换 - 暂停使用 */}
            {/* <Button
            color="warning"
            size="sm"
            variant="flat"
            onPress={toggleViewMode}
          >
            {viewMode === "grid" ? "列表" : "卡片"}
          </Button> */}
            {/* 节点按钮 - 蓝色 */}
            <Button
              color="primary"
              size="sm"
              variant="flat"
              onPress={() => setActiveTab("nodes")}
            >
              节点
            </Button>
            {/* 隧道按钮 - 绿色 */}
            <Button
              color="success"
              size="sm"
              variant="flat"
              onPress={() => setActiveTab("tunnels")}
            >
              隧道
            </Button>
            {/* 刷新按钮 - 紫色 */}
            <Button
              color="secondary"
              isLoading={
                activeTab === "nodes"
                  ? nodesLoading || nodeInstanceGroupsLoading
                  : tunnelsLoading
              }
              size="sm"
              variant="flat"
              onPress={() => {
                if (activeTab === "nodes") {
                  void loadNodeTab();
                } else {
                  setTunnelRefreshTrigger((prev) => prev + 1);
                }
              }}
            >
              刷新
            </Button>
          </div>
          {activeTab === "nodes" && detailNodeId == null ? (
            <MonitorRealtimeStatus
              wsConnected={wsConnected}
              wsConnecting={wsConnecting}
            />
          ) : null}
          {/* 第二行：副标题 */}
          <div className="text-xs text-default-500 truncate">
            实时节点状态 + 隧道质量检测 + 历史指标图表 + 服务监控
          </div>
          {nodesError && activeTab === "nodes" ? (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold">节点列表</h3>
              </CardHeader>
              <CardBody>
                <div className="text-sm text-default-600">{nodesError}</div>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <>
          <div className={activeTab === "nodes" ? "block" : "hidden"}>
            <div className="space-y-4">
              {detailNodeId == null ? (
                <>
                  <div className="flex items-center gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap text-xs">
                    <MetricPill tone="primary">
                      节点 {nodeSummary.online}/{nodeSummary.total}
                    </MetricPill>
                    <MetricPill tone="secondary">
                      实例 {nodeSummary.onlineInstances}/{nodeSummary.instances}
                    </MetricPill>
                    <MetricPill tone="success">
                      服务监控 成功 {serviceSummary.ok} / 失败{" "}
                      {serviceSummary.fail}
                    </MetricPill>
                  </div>
                  <NodeInstanceGroupsView
                    groups={nodeInstanceGroups.filter((g) => nodeMap.has(g.id))}
                    loading={nodeInstanceGroupsLoading}
                    realtimeMetrics={realtimeInstanceMetrics}
                    realtimeStatuses={realtimeInstanceStatuses}
                    onEditInstance={openInstanceEditModal}
                    onOpenDetail={(nodeId, instanceId) =>
                      setDetailTarget({ nodeId, instanceId })
                    }
                  />
                </>
              ) : (
                <MonitorView
                  hideList
                  detailInstanceId={detailTarget?.instanceId ?? null}
                  detailNodeId={detailNodeId}
                  nodeMap={nodeMap}
                  viewMode={viewMode}
                  onDetailClose={() => setDetailTarget(null)}
                  onRefreshReady={handleNodeDetailRefreshReady}
                />
              )}
            </div>
          </div>
          <div className={activeTab === "tunnels" ? "block" : "hidden"}>
            <TunnelMonitorView
              refreshTrigger={tunnelRefreshTrigger}
              viewMode={viewMode}
              onLoadingChange={setTunnelsLoading}
              onRefreshReady={handleTunnelRefreshReady}
            />
          </div>
        </>
        <Modal
          isDismissable={false}
          isOpen={instanceEditModalOpen}
          onOpenChange={(open) => open && setInstanceEditModalOpen(true)}
        >
          <ModalContent>
            <ModalHeader>实例权重</ModalHeader>
            <ModalBody>
              <div className="space-y-3 text-sm">
                <div>
                  实例名称:{" "}
                  {getDisplayInstanceLabel(instanceEditTarget?.displayIndex)}
                </div>
                <div>
                  IP:{" "}
                  {instanceEditTarget
                    ? getMonitorPrimaryDisplayIP(instanceEditTarget)
                    : "-"}
                </div>
                <div className="text-default-500">
                  0 表示不作为入口承载实例，DNS
                  命中时会迁移到同节点启用实例；大于 0
                  表示参与入口承载、出口和转发链新连接选择。 权重范围为
                  0-10；数值越大，被负载策略选中的比例越高。
                </div>
                <Input
                  description="0 为禁用承载，1-10 为参与负载的权重等级。"
                  label="实例权重"
                  max={10}
                  min={0}
                  step={1}
                  type="number"
                  value={weightValue}
                  onChange={(event) => setWeightValue(event.target.value)}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={() => setInstanceEditModalOpen(false)}
              >
                取消
              </Button>
              <Button
                color="primary"
                isLoading={instanceEditSaving}
                onPress={() => saveInstanceProfile()}
              >
                保存
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </AnimatedPage>
    </MonitorTerminalProvider>
  );
}
