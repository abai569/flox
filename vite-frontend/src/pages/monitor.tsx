import type {
  MonitorNodeApiItem,
  MonitorNodeInstanceGroupApiItem,
  MonitorNodeInstanceGroupMemberApiItem,
  ServiceMonitorApiItem,
  ServiceMonitorResultApiItem,
} from "@/api/types";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import {
  getMonitorNodes,
  getMonitorNodeInstanceGroups,
  getServiceMonitorLatestResults,
  getServiceMonitorList,
  updateNodeWeight,
} from "@/api";
import { MonitorView } from "@/pages/node/monitor-view";
import { TunnelMonitorView } from "@/pages/node/tunnel-monitor-view";
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
  hostname?: string;
  publicIpV4?: string;
  publicIpV6?: string;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  uptime: number;
  periodRx: number;
  periodTx: number;
  onlineCount: number;
  tcpConns: number;
  udpConns: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
};

type ServiceSummary = {
  ok: number;
  fail: number;
};

const MONITOR_INSTANCE_TABLE_COLUMNS = [
  "4%",
  "9%",
  "9%",
  "10%",
  "8%",
  "7%",
  "8%",
  "10%",
  "10%",
  "10%",
  "5%",
  "10%",
] as const;

const isRealInstanceId = (instanceId?: string): boolean => {
  const value = instanceId?.trim() || "";

  return value !== "" && value.toLowerCase() !== "default";
};

const getInstanceMetricKey = (nodeId: number, instanceId?: string): string =>
  `${nodeId}:${instanceId?.trim() || ""}`;

const getInstanceConnectionTooltip = (
  tcpConns?: number,
  udpConns?: number,
): string => {
  const tcp = Number(tcpConns ?? 0);
  const udp = Number(udpConns ?? 0);

  return `TCP ${tcp}\nUDP ${udp}`;
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

    return `::${parts.slice(-3).join(":")}`;
  }
  if (value.includes(".")) {
    const parts = value.split(".");

    if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;

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

type MonitorFlagCode = "cn" | "jp";

const REGION_FLAG_CODE_BY_COUNTRY: Record<string, MonitorFlagCode> = {
  中国: "cn",
  香港: "cn",
  澳门: "cn",
  台湾: "cn",
  日本: "jp",
};

const getRegionFlagCode = (region?: string): MonitorFlagCode | "" => {
  const first = region?.trim().split(/\s+/)[0] || "";

  return REGION_FLAG_CODE_BY_COUNTRY[first] || "";
};

function MonitorFlagIcon({ code }: { code: MonitorFlagCode }) {
  if (code === "jp") {
    return (
      <svg
        aria-hidden="true"
        className="h-3 w-4 shrink-0 overflow-hidden rounded-[1px] ring-1 ring-default-300"
        viewBox="0 0 16 12"
      >
        <rect fill="#fff" height="12" width="16" />
        <circle cx="8" cy="6" fill="#bc002d" r="3.1" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-3 w-4 shrink-0 overflow-hidden rounded-[1px] ring-1 ring-default-300"
      viewBox="0 0 16 12"
    >
      <rect fill="#de2910" height="12" width="16" />
      <polygon
        fill="#ffde00"
        points="2.8,1.4 3.2,2.6 4.5,2.6 3.45,3.35 3.85,4.55 2.8,3.8 1.75,4.55 2.15,3.35 1.1,2.6 2.4,2.6"
      />
      <circle cx="6" cy="2" fill="#ffde00" r="0.45" />
      <circle cx="7.1" cy="3.2" fill="#ffde00" r="0.45" />
      <circle cx="7" cy="5" fill="#ffde00" r="0.45" />
      <circle cx="5.8" cy="6" fill="#ffde00" r="0.45" />
    </svg>
  );
}

function MonitorRegionCellValue({ region }: { region?: string }) {
  const value = region?.trim() || "";

  if (!value) return <span className="block h-5" />;

  const flagCode = getRegionFlagCode(value);

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary-500/10 px-2 py-0.5 text-secondary-700">
      {flagCode && <MonitorFlagIcon code={flagCode} />}
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
      <span className="inline-block max-w-full truncate px-1 leading-5 text-default-300">
        -
      </span>
    );
  }

  return (
    <button
      className="inline-block max-w-full truncate rounded bg-transparent px-1 text-center font-mono text-xs leading-5 text-default-600 transition-colors hover:bg-default-200/50 hover:text-primary"
      title={value}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        copyMonitorIP(value, label);
      }}
    >
      {formatMonitorIPForCell(value)}
    </button>
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
): MonitorNodeInstanceGroupMemberApiItem => {
  const metric =
    realtimeMetrics[getInstanceMetricKey(member.nodeId, member.instanceId)];

  if (!metric) return member;

  return {
    ...member,
    hostname: metric.hostname || member.hostname,
    publicIpV4: metric.publicIpV4 || member.publicIpV4,
    publicIpV6: metric.publicIpV6 || member.publicIpV6,
    status: 1,
    netInSpeed: metric.netInSpeed,
    netOutSpeed: metric.netOutSpeed,
    netInBytes: metric.netInBytes,
    netOutBytes: metric.netOutBytes,
    uptime: metric.uptime || member.uptime,
    periodRx: metric.periodRx,
    periodTx: metric.periodTx,
    onlineCount: metric.onlineCount,
    tcpConns: metric.tcpConns,
    udpConns: metric.udpConns,
    cpuUsage: metric.cpuUsage,
    memoryUsage: metric.memoryUsage,
    diskUsage: metric.diskUsage,
  };
};

function MonitorSummaryBar({
  wsConnected,
  wsConnecting,
  onlineNodeCount,
  nodeCount,
  onlineInstanceCount,
  instanceCount,
  serviceSummary,
}: {
  wsConnected: boolean;
  wsConnecting: boolean;
  onlineNodeCount: number;
  nodeCount: number;
  onlineInstanceCount: number;
  instanceCount: number;
  serviceSummary: ServiceSummary;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-2 text-default-600">
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
      <span className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
        节点 {onlineNodeCount}/{nodeCount}
      </span>
      <span className="rounded-md bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">
        实例 {onlineInstanceCount}/{instanceCount}
      </span>
      <span className="rounded-md bg-success px-2.5 py-1 font-semibold text-white">
        服务监控 成功 {serviceSummary.ok} / 失败 {serviceSummary.fail}
      </span>
    </div>
  );
}

function NodeInstanceGroupsView({
  groups,
  loading,
  realtimeMetrics,
  onEditWeight,
  onOpenDetail,
}: {
  groups: MonitorNodeInstanceGroupApiItem[];
  loading: boolean;
  realtimeMetrics: Record<string, RealtimeNodeInstanceMetric>;
  onEditWeight: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
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
          mergeRealtimeMetric(member, realtimeMetrics),
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
            <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-md border border-default-300 px-4 py-1.5 text-sm font-medium text-secondary truncate">
                  {group.name} | ID: {group.id}
                </span>
                <span className="text-xs text-default-500">
                  {members.length} 个实例
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm font-mono">
                <span
                  className="inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-secondary-500/15 px-3 py-2 text-secondary-700 tabular-nums"
                  title={groupConnectionTooltip}
                >
                  {formatSpeed(totalOutSpeed)}
                  <ArrowUp className="h-4 w-4" />
                </span>
                <span
                  className="inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500/15 px-3 py-2 text-primary-700 tabular-nums"
                  title={groupConnectionTooltip}
                >
                  {formatSpeed(totalInSpeed)}
                  <ArrowDown className="h-4 w-4" />
                </span>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="min-w-[1220px] w-full table-fixed text-sm">
                  <colgroup>
                    {MONITOR_INSTANCE_TABLE_COLUMNS.map((width, index) => (
                      <col key={index} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="border-b border-default-400/70 text-sm text-foreground">
                    <tr>
                      <th className="px-2 py-2 text-center">状态</th>
                      <th className="px-2 py-2 text-center">v4 地区</th>
                      <th className="px-2 py-2 text-center">v6 地区</th>
                      <th className="px-2 py-2 text-center">出口 IP</th>
                      <th className="px-2 py-2 text-center">速率</th>
                      <th className="px-2 py-2 text-center">开机时长</th>
                      <th className="px-2 py-2 text-center">流量</th>
                      <th className="px-2 py-2 text-center">CPU</th>
                      <th className="px-2 py-2 text-center">RAM</th>
                      <th className="px-2 py-2 text-center">存储</th>
                      <th className="px-2 py-2 text-center">权重</th>
                      <th className="px-2 py-2 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      return (
                        <tr
                          key={getInstanceMetricKey(
                            member.nodeId,
                            member.instanceId,
                          )}
                          className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50"
                        >
                          <td className="px-2 py-3 text-center align-middle">
                            <StatusDot
                              active={member.status === 1}
                              tone={member.status === 1 ? "success" : "danger"}
                            />
                          </td>
                          <td
                            className="px-2 py-3 text-center align-middle font-mono text-xs text-default-600"
                            title={getMonitorRegionIPTitle(member, "v4")}
                          >
                            <div className="truncate">
                              <MonitorRegionCellValue
                                region={member.publicIpV4Region}
                              />
                            </div>
                          </td>
                          <td
                            className="px-2 py-3 text-center align-middle font-mono text-xs text-default-600"
                            title={getMonitorRegionIPTitle(member, "v6")}
                          >
                            <div className="truncate">
                              <MonitorRegionCellValue
                                region={member.publicIpV6Region}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center align-middle font-mono text-xs text-default-600">
                            <MonitorIPCellValue
                              ip={member.publicIpV4}
                              label="IPv4"
                            />
                            <MonitorIPCellValue
                              ip={member.publicIpV6}
                              label="IPv6"
                            />
                          </td>
                          <td
                            className="px-2 py-3 text-center align-middle font-mono text-xs leading-5 tabular-nums"
                            title={getInstanceConnectionTooltip(
                              member.tcpConns,
                              member.udpConns,
                            )}
                          >
                            <div className="truncate">
                              {formatSpeed(member.netOutSpeed)}↑
                            </div>
                            <div className="truncate">
                              {formatSpeed(member.netInSpeed)}↓
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center align-middle">
                            <div className="truncate">
                              {formatUptime(member.uptime)}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center align-middle font-mono text-xs">
                            <div className="truncate">
                              {formatBytes(member.periodTx)}↑
                            </div>
                            <div className="truncate">
                              {formatBytes(member.periodRx)}↓
                            </div>
                          </td>
                          <td className="px-2 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter tone="cpu" value={member.cpuUsage} />
                            </div>
                          </td>
                          <td className="px-2 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter
                                tone="memory"
                                value={member.memoryUsage}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-3 align-middle">
                            <div className="flex min-w-0 justify-center">
                              <UsageMeter
                                tone="disk"
                                value={member.diskUsage}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center align-middle font-mono tabular-nums">
                            <div className="truncate">{member.weight}</div>
                          </td>
                          <td className="px-2 py-3 align-middle">
                            <div className="flex min-w-0 justify-center gap-2">
                              <Button
                                className="h-8 px-3 text-xs font-medium"
                                size="sm"
                                variant="flat"
                                onPress={() => onEditWeight(member)}
                              >
                                权重
                              </Button>
                              <MonitorTerminalButton
                                className="h-8 px-3 text-xs font-medium"
                                member={member}
                              />
                              <Button
                                className="h-8 px-3 text-xs font-medium"
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
  const offlineTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodeInstanceGroupsLoading, setNodeInstanceGroupsLoading] =
    useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weightTarget, setWeightTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);
  const [detailTarget, setDetailTarget] = useState<{
    nodeId: number;
    instanceId: string;
  } | null>(null);
  const detailNodeId = detailTarget?.nodeId ?? null;
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
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

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "list" ? "grid" : "list";

      try {
        localStorage.setItem("monitor-view-mode", next);
      } catch {
        /* ignore */
      }

      return next;
    });
  }, []);

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

  const loadNodes = useCallback(async (options?: { silent?: boolean }) => {
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
  }, []);

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

  const refreshActiveTab = useCallback(() => {
    if (activeTab === "nodes") {
      void loadNodeTab();

      return;
    }
    setTunnelRefreshTrigger((prev) => prev + 1);
  }, [activeTab, loadNodeTab]);

  useEffect(() => {
    void loadNodes();
    void loadNodeInstanceGroups();
    void loadServiceSummary();
  }, [loadNodes, loadNodeInstanceGroups, loadServiceSummary]);
  usePullToRefresh(refreshActiveTab);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadNodes({ silent: true });
      void loadNodeInstanceGroups({ silent: true });
      void loadServiceSummary({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadNodes, loadNodeInstanceGroups, loadServiceSummary]);

  const handleRealtimeMessage = useCallback((message: any) => {
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

    const tcpConns = Number(metric.tcpConns ?? metric.tcp_conns ?? 0);
    const udpConns = Number(metric.udpConns ?? metric.udp_conns ?? 0);

    setRealtimeInstanceMetrics((prev) => ({
      ...prev,
      [getInstanceMetricKey(nodeId, instanceId)]: {
        receivedAt: Date.now(),
        hostname: String(metric.hostname ?? ""),
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
        periodRx: Number(metric.periodRx ?? metric.period_bytes_received ?? 0),
        periodTx: Number(
          metric.periodTx ?? metric.period_bytes_transmitted ?? 0,
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
  }, []);

  const { wsConnected, wsConnecting } = useNodeRealtime({
    onMessage: handleRealtimeMessage,
    enabled: activeTab === "nodes" && detailNodeId == null,
  });

  useEffect(() => {
    return () => {
      offlineTimersRef.current.forEach((timer) => clearTimeout(timer));
      offlineTimersRef.current.clear();
    };
  }, []);

  const openWeightModal = useCallback(
    (member: MonitorNodeInstanceGroupMemberApiItem) => {
      setWeightTarget(member);
      setWeightValue(String(member.weight ?? 1));
      setWeightModalOpen(true);
    },
    [],
  );

  const saveWeight = useCallback(
    async (overrideWeight?: number) => {
      if (!weightTarget) return;
      const nextWeight = overrideWeight ?? Number(weightValue);

      if (!Number.isFinite(nextWeight) || nextWeight < 0) {
        toast.error("权重不能小于 0");

        return;
      }
      setWeightSaving(true);
      try {
        const res = await updateNodeWeight(
          weightTarget.nodeId,
          Math.floor(nextWeight),
          weightTarget.instanceId,
        );

        if (res.code === 0) {
          toast.success("权重已更新，正在重新下发线路配置");
          setWeightModalOpen(false);
          setWeightTarget(null);
          await loadNodeInstanceGroups({ silent: true });
          await loadNodes({ silent: true });
        } else {
          toast.error(res.msg || "更新权重失败");
        }
      } catch {
        toast.error("更新权重失败");
      } finally {
        setWeightSaving(false);
      }
    },
    [loadNodes, loadNodeInstanceGroups, weightTarget, weightValue],
  );

  const nodeMap = useMemo(() => {
    const instanceCounts = new Map<number, { total: number; online: number }>();

    nodeInstanceGroups.forEach((group) => {
      const members = group.members.map((member) =>
        mergeRealtimeMetric(member, realtimeInstanceMetrics),
      );

      instanceCounts.set(group.id, {
        total: members.length,
        online: members.filter((member) => member.status === 1).length,
      });
    });

    const list: MonitorNode[] = nodes
      .filter((n) => Number(n.id) > 0)
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
  }, [nodeInstanceGroups, nodes, realtimeInstanceMetrics, realtimeNodeStatus]);

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
          {/* 卡片/列表切换 - 黄色 */}
          <Button
            color="warning"
            size="sm"
            variant="flat"
            onPress={toggleViewMode}
          >
            {viewMode === "grid" ? "列表" : "卡片"}
          </Button>
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
        {/* 第二行：副标题 */}
        <div className="text-xs text-default-500 truncate">
          实时节点状态 + 隧道质量检测 + 历史指标图表 + 服务监控 (TCP/ICMP)
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
                <MonitorSummaryBar
                  instanceCount={nodeSummary.instances}
                  nodeCount={nodeSummary.total}
                  onlineInstanceCount={nodeSummary.onlineInstances}
                  onlineNodeCount={nodeSummary.online}
                  serviceSummary={serviceSummary}
                  wsConnected={wsConnected}
                  wsConnecting={wsConnecting}
                />
                <NodeInstanceGroupsView
                  groups={nodeInstanceGroups}
                  loading={nodeInstanceGroupsLoading}
                  realtimeMetrics={realtimeInstanceMetrics}
                  onEditWeight={openWeightModal}
                  onOpenDetail={(nodeId, instanceId) =>
                    setDetailTarget({ nodeId, instanceId })
                  }
                />
              </>
            ) : (
              <MonitorView
                hideList
                detailNodeId={detailNodeId}
                detailInstanceId={detailTarget?.instanceId ?? null}
                nodeMap={nodeMap}
                viewMode={viewMode}
                onDetailClose={() => setDetailTarget(null)}
              />
            )}
          </div>
        </div>
        <div className={activeTab === "tunnels" ? "block" : "hidden"}>
          <TunnelMonitorView
            refreshTrigger={tunnelRefreshTrigger}
            viewMode={viewMode}
            onLoadingChange={setTunnelsLoading}
          />
        </div>
      </>
      <Modal isOpen={weightModalOpen} onOpenChange={setWeightModalOpen}>
        <ModalContent>
          <ModalHeader>更改权重</ModalHeader>
          <ModalBody>
            <div className="space-y-3 text-sm">
              <div>
                IP:{" "}
                {weightTarget ? getMonitorPrimaryDisplayIP(weightTarget) : "-"}
              </div>
              <div>
                节点实例:{" "}
                {weightTarget?.hostname ||
                  weightTarget?.instanceId ||
                  weightTarget?.nodeName ||
                  "-"}
              </div>
              <div>当前权重: {weightTarget?.weight ?? "-"}</div>
              <div className="text-default-500">
                权重 0 即不在隧道转发中使用此节点实例。
              </div>
              <div className="text-default-500">
                建议：组内配置最低的机器设置为 1 权重，高配机器根据 CPU
                核心数等适量增加权重。
              </div>
              <Input
                label="权重"
                min={0}
                type="number"
                value={weightValue}
                onChange={(event) => setWeightValue(event.target.value)}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="danger"
              isDisabled={weightSaving}
              onPress={() => saveWeight(0)}
            >
              清空权重
            </Button>
            <Button variant="flat" onPress={() => setWeightModalOpen(false)}>
              取消
            </Button>
            <Button
              color="success"
              isLoading={weightSaving}
              onPress={() => saveWeight()}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      </AnimatedPage>
    </MonitorTerminalProvider>
  );
}
