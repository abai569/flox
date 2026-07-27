import type {
  MonitorNodeInstanceGroupMemberApiItem,
  NodeGroupApiItem,
  OfflineDeployPayload,
  PeerRemoteUsageNodeApiItem,
} from "@/api/types";
import type { Node } from "./node/types";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { NodeGroupManager } from "./node/node-group-manager";
import { NodeDNSFailoverModal } from "./node/dns-failover-modal";
import { NodeImportModal } from "./node/node-import-modal";
import { NodeSharingModal } from "./node/node-sharing-modal";
import { RemoteNodeDetailModal } from "./node/remote-node-detail-modal";

import {
  DistroIcon,
  parseDistroFromVersion,
  getDistroColor,
} from "@/components/distro-icon";
import { SearchBar } from "@/components/search-bar";
import { StatusDot } from "@/components/status-dot";
import { AnimatedPage } from "@/components/animated-page";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
import { Input as BaseInput } from "@/components/ui/input";
import { FieldContainer } from "@/shadcn-bridge/heroui/shared";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@/shadcn-bridge/heroui/modal";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Alert } from "@/shadcn-bridge/heroui/alert";
import { Link } from "@/shadcn-bridge/heroui/link";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import { Accordion, AccordionItem } from "@/shadcn-bridge/heroui/accordion";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { DatePicker } from "@/shadcn-bridge/heroui/date-picker";
import { DatePresets } from "@/shadcn-bridge/heroui/date-presets";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownMenuSeparator,
} from "@/shadcn-bridge/heroui/dropdown";
import { NodeListView } from "@/pages/node/node-list-view";
import { MonitorTerminalProvider } from "@/pages/monitor-terminal";
import {
  createNode,
  getNodeList,
  getPeerRemoteUsageList,
  bootstrapNodeSDWAN,
  updateNode,
  deleteNode,
  getNodeInstallCommand,
  getNodeInstallCommandDomestic,
  getNodeInstallCommandOverseas,
  getNodeInstallCommandOffline,
  updateNodeOrder,
  batchDeleteNodes,
  upgradeNode,
  batchUpgradeNodes,
  batchResetNodeInstanceTraffic,
  getNodeReleases,
  refreshNodeExpiryReminder,
  getNodeGroupList,
  assignNodeToGroup,
  batchResetNodeTraffic,
  recordNodeOfflineLog,
  getNodeTrafficResetLogs,
  deleteNodeTrafficResetLog,
  deleteNodeInstancePort,
  getMonitorNodeInstanceGroups,
  pauseNode,
  resumeNode,
  pauseInstance,
  resumeInstance,
  getConfigByName,
  installMimicDeps,
  updateNodeInstanceProfile,
  updateNodeInstanceOrder,
  getPeerShareList,
  listPeerShareNotifications,
  dismissPeerShareNotification,
  type ReleaseChannel,
} from "@/api";
import { compareVersions } from "@/utils/version-update";
import Network from "@/api/network";
import { PageLoadingState } from "@/components/page-state";
import {
  deriveNodeVisualState,
  getRemoteDisplayMeta,
  getRemoteDisplayState,
} from "@/pages/node/display";
import {
  getNodeRenewalSnapshot,
  formatNodeRenewalTime,
  type NodeRenewalCycle,
} from "@/pages/node/renewal";
import { buildNodeSystemInfo } from "@/pages/node/system-info";
import { useNodeOfflineTimers } from "@/pages/node/use-node-offline-timers";
import { useNodeRealtime } from "@/pages/node/use-node-realtime";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { loadStoredOrder, saveOrder } from "@/utils/order-storage";
import { timestampToCalendarDate, calendarDateToTimestamp } from "@/utils/date";
import { JwtUtil } from "@/utils/jwt";
// TypeScript 全局类型扩展
declare global {
  interface Window {
    __pendingNodeRefresh?: Set<number>;
  }
}
const NODE_FALLBACK_REFRESH_INTERVAL_MS = 20000;
const REMOTE_NODE_REFRESH_INTERVAL_MS = 20000;
const REALTIME_NODE_METRIC_STALE_MS = 90_000;

type NodePeriodTraffic = {
  rx: number;
  tx: number;
  since: number;
  nextReset?: number;
  cycle?: string;
};

type RealtimeNodeMetric = {
  uploadTraffic: number;
  downloadTraffic: number;
  uploadSpeed: number;
  downloadSpeed: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
  tcpConns: number;
  udpConns: number;
  periodTraffic?: NodePeriodTraffic;
};

type RealtimeNodeInstanceMetric = RealtimeNodeMetric & {
  nodeId: number;
  instanceId: string;
  receivedAt: number;
};

interface NodeForm {
  id: number | null;
  name: string;
  remark: string;
  expiryTime: number;
  renewalCycle: NodeRenewalCycle;
  flowResetTime: number;
  groupId: number | null;
  intranetIp: string;
  serverIpV4: string;
  serverIpV6: string;
  port: string;
  tcpListenAddr: string;
  udpListenAddr: string;
  interfaceName: string;
  extraIPs: string;
  remoteConfig: string;
  sdwanConfigPath: string;
  sdwanConfigYAML: string;
  sdwanCAPath: string;
  sdwanCAPEM: string;
  sdwanCertPath: string;
  sdwanCertPEM: string;
  sdwanKeyPath: string;
  sdwanKeyPEM: string;
  sdwanNodeVPNIP: string;
  sdwanLighthouseVPNIP: string;
  sdwanLighthouseAddr: string;
  sdwanListenHost: string;
  sdwanListenPort: string;
  http: number;
  tls: number;
  socks: number;
  secret: string;
  trafficRatio: number;
  trafficLimit: number;
  dnsEnabled: boolean;
  dnsProvider: "aliyun" | "cloudflare";
  dnsManageA: boolean;
  dnsManageAAAA: boolean;
}
type NodeViewMode = "grid" | "list" | "grouped";
type DNSProviderAvailability = { aliyun: boolean; cloudflare: boolean };
const EXPIRING_SOON_DAYS = 7;
const DEFAULT_INSTANCE_PORT_RANGE = "10000-65535";
const NODE_GROUP_NONE = -1;
const NODE_GROUP_REMOTE = -2;

const extractSDWANConfigPath = (raw?: string): string => {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }

    return typeof parsed.sdwanConfigPath === "string"
      ? parsed.sdwanConfigPath
      : "";
  } catch {
    return "";
  }
};

const extractSDWANField = (raw: string | undefined, key: string): string => {
  if (!raw) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }

    return typeof parsed[key] === "string" ? (parsed[key] as string) : "";
  } catch {
    return "";
  }
};

const extractSDWANConfigYAML = (raw?: string): string => {
  return extractSDWANField(raw, "sdwanConfigYAML");
};

const mergeSDWANConfig = (
  raw: string,
  path: string,
  yaml: string,
  fields: Record<string, string>,
): string => {
  let parsed: Record<string, unknown> = {};

  if (raw.trim()) {
    try {
      const next = JSON.parse(raw) as Record<string, unknown>;

      if (next && typeof next === "object" && !Array.isArray(next)) {
        parsed = next;
      }
    } catch {
      parsed = {};
    }
  }

  const trimmedPath = path.trim();

  if (trimmedPath) {
    parsed.sdwanConfigPath = trimmedPath;
  } else {
    delete parsed.sdwanConfigPath;
  }

  if (yaml.trim()) {
    parsed.sdwanConfigYAML = yaml;
  } else {
    delete parsed.sdwanConfigYAML;
  }

  Object.entries(fields).forEach(([key, value]) => {
    const trimmedValue = value.trim();

    if (trimmedValue) {
      parsed[key] = trimmedValue;
    } else {
      delete parsed[key];
    }
  });

  if (Object.keys(parsed).length > 0) {
    return JSON.stringify(parsed);
  }

  return raw.trim() ? raw : "";
};

type NodeExpiryState = "permanent" | "healthy" | "expiringSoon" | "expired";
type NodeFilterMode = "all" | "expiringSoon" | "expired" | "withExpiry";
const getNodeReminderEnabled = (node: Node): boolean => {
  return !!node.expiryTime && node.expiryTime > 0 && !!node.renewalCycle;
};
const formatDateInputValue = (timestamp?: number | null): string => {
  if (!timestamp || timestamp <= 0) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};
const parseDateInputValue = (value: string): number => {
  if (!value) return 0;
  const timestamp = new Date(`${value}T00:00:00`).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
};
const getNodeExpiryMeta = (timestamp?: number, cycle?: NodeRenewalCycle) => {
  const renewal = getNodeRenewalSnapshot(timestamp, cycle, EXPIRING_SOON_DAYS);

  if (renewal.state === "unset") {
    return {
      state: "permanent" as NodeExpiryState,
      label: "未设置续费周期",
      tone: "default" as const,
      accentClassName: "",
      bannerClassName: "",
      isHighlighted: false,
      sortWeight: 3,
      nextDueTime: undefined,
    };
  }
  if (renewal.state === "expired") {
    return {
      state: "expired" as NodeExpiryState,
      label: "已过期",
      tone: "danger" as const,
      accentClassName:
        "border-red-300/80 bg-red-50/70 shadow-red-100 dark:border-red-500/40 dark:bg-red-950/20",
      bannerClassName:
        "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300",
      isHighlighted: true,
      sortWeight: 0,
      nextDueTime: renewal.nextDueTime,
    };
  }
  if (renewal.state === "dueSoon") {
    return {
      state: "expiringSoon" as NodeExpiryState,
      label: renewal.label,
      tone: "warning" as const,
      accentClassName:
        "border-amber-300/80 bg-amber-50/80 shadow-amber-100 dark:border-amber-500/40 dark:bg-amber-950/20",
      bannerClassName:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
      isHighlighted: true,
      sortWeight: 1,
      nextDueTime: renewal.nextDueTime,
    };
  }

  return {
    state: "healthy" as NodeExpiryState,
    label: renewal.label,
    tone: "success" as const,
    accentClassName: "",
    bannerClassName: "",
    isHighlighted: false,
    sortWeight: 2,
    nextDueTime: renewal.nextDueTime,
  };
};
const mergeNodeRealtimeState = (
  incomingNode: Node,
  existingNode?: Node,
): Node => {
  return {
    ...incomingNode,
    systemInfo: existingNode?.systemInfo ?? incomingNode.systemInfo ?? null,
    copyLoading: existingNode?.copyLoading ?? incomingNode.copyLoading ?? false,
    upgradeLoading:
      existingNode?.upgradeLoading ?? incomingNode.upgradeLoading ?? false,
    rollbackLoading:
      existingNode?.rollbackLoading ?? incomingNode.rollbackLoading ?? false,
    expiryReminderDismissed:
      existingNode?.expiryReminderDismissed ??
      incomingNode.expiryReminderDismissed ??
      0,
    expiryReminderDismissedUntil:
      existingNode?.expiryReminderDismissedUntil ??
      incomingNode.expiryReminderDismissedUntil ??
      null,
    mimicStatus: existingNode?.mimicStatus ?? incomingNode.mimicStatus ?? "",
    mimicError: existingNode?.mimicError ?? incomingNode.mimicError ?? "",
  } as Node;
};

const isRealMetricInstanceId = (instanceId?: string): boolean => {
  const value = String(instanceId ?? "").trim();

  return value !== "" && value.toLowerCase() !== "default";
};

const getRealtimeInstanceKey = (nodeId: number, instanceId: string): string =>
  `${nodeId}:${instanceId}`;

const buildRealtimeNodeMetric = (
  metric: Record<string, unknown>,
  previous?: RealtimeNodeMetric,
): RealtimeNodeMetric => {
  const hasPeriodTraffic =
    metric.periodNetInBytes !== undefined ||
    metric.periodNetOutBytes !== undefined ||
    metric.period_net_in_bytes !== undefined ||
    metric.period_net_out_bytes !== undefined;

  return {
    uploadTraffic: Number(
      metric.netOutBytes ??
        metric.bytes_transmitted ??
        previous?.uploadTraffic ??
        0,
    ),
    downloadTraffic: Number(
      metric.netInBytes ??
        metric.bytes_received ??
        previous?.downloadTraffic ??
        0,
    ),
    uploadSpeed: Number(
      metric.netOutSpeed ?? metric.net_out_speed ?? previous?.uploadSpeed ?? 0,
    ),
    downloadSpeed: Number(
      metric.netInSpeed ?? metric.net_in_speed ?? previous?.downloadSpeed ?? 0,
    ),
    cpuUsage: Number(
      metric.cpuUsage ?? metric.cpu_usage ?? previous?.cpuUsage ?? 0,
    ),
    memoryUsage: Number(
      metric.memoryUsage ?? metric.memory_usage ?? previous?.memoryUsage ?? 0,
    ),
    diskUsage: Number(
      metric.diskUsage ?? metric.disk_usage ?? previous?.diskUsage ?? 0,
    ),
    uptime: Number(metric.uptime ?? previous?.uptime ?? 0),
    load1: Number(metric.load1 ?? previous?.load1 ?? 0),
    load5: Number(metric.load5 ?? previous?.load5 ?? 0),
    load15: Number(metric.load15 ?? previous?.load15 ?? 0),
    tcpConns: Number(
      metric.tcpConns ?? metric.tcp_conns ?? previous?.tcpConns ?? 0,
    ),
    udpConns: Number(
      metric.udpConns ?? metric.udp_conns ?? previous?.udpConns ?? 0,
    ),
    periodTraffic: hasPeriodTraffic
      ? {
          rx: Number(
            metric.periodNetInBytes ?? metric.period_net_in_bytes ?? 0,
          ),
          tx: Number(
            metric.periodNetOutBytes ?? metric.period_net_out_bytes ?? 0,
          ),
          since: Number(
            metric.baselineRecordedAt ?? metric.baseline_recorded_at ?? 0,
          ),
          nextReset: Number(metric.nextResetAt ?? metric.next_reset_at ?? 0),
          cycle: String(metric.renewalCycle ?? metric.renewal_cycle ?? ""),
        }
      : previous?.periodTraffic,
  };
};

const aggregateRealtimeNodeMetrics = (
  nodeId: number,
  instanceMetrics: Record<string, RealtimeNodeInstanceMetric>,
  fallback?: RealtimeNodeMetric,
): RealtimeNodeMetric | undefined => {
  const now = Date.now();
  const metrics = Object.values(instanceMetrics).filter(
    (item) =>
      item.nodeId === nodeId &&
      now - item.receivedAt <= REALTIME_NODE_METRIC_STALE_MS,
  );

  if (metrics.length === 0) {
    return fallback;
  }

  const usageCount = metrics.length;
  const total = metrics.reduce(
    (acc, item) => {
      acc.uploadTraffic += item.uploadTraffic;
      acc.downloadTraffic += item.downloadTraffic;
      acc.uploadSpeed += item.uploadSpeed;
      acc.downloadSpeed += item.downloadSpeed;
      acc.cpuUsage += item.cpuUsage;
      acc.memoryUsage += item.memoryUsage;
      acc.diskUsage += item.diskUsage;
      acc.load1 += item.load1;
      acc.load5 += item.load5;
      acc.load15 += item.load15;
      acc.tcpConns += item.tcpConns;
      acc.udpConns += item.udpConns;
      acc.uptime = Math.max(acc.uptime, item.uptime);
      if (item.periodTraffic) {
        acc.periodSeen = true;
        acc.periodRx += item.periodTraffic.rx;
        acc.periodTx += item.periodTraffic.tx;
        if (item.periodTraffic.since > 0) {
          acc.periodSince =
            acc.periodSince > 0
              ? Math.min(acc.periodSince, item.periodTraffic.since)
              : item.periodTraffic.since;
        }
        if ((item.periodTraffic.nextReset ?? 0) > acc.periodNextReset) {
          acc.periodNextReset = item.periodTraffic.nextReset ?? 0;
        }
        if (!acc.periodCycle && item.periodTraffic.cycle) {
          acc.periodCycle = item.periodTraffic.cycle;
        }
      }

      return acc;
    },
    {
      uploadTraffic: 0,
      downloadTraffic: 0,
      uploadSpeed: 0,
      downloadSpeed: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      diskUsage: 0,
      uptime: 0,
      load1: 0,
      load5: 0,
      load15: 0,
      tcpConns: 0,
      udpConns: 0,
      periodSeen: false,
      periodRx: 0,
      periodTx: 0,
      periodSince: 0,
      periodNextReset: 0,
      periodCycle: "",
    },
  );

  return {
    uploadTraffic: total.uploadTraffic,
    downloadTraffic: total.downloadTraffic,
    uploadSpeed: total.uploadSpeed,
    downloadSpeed: total.downloadSpeed,
    cpuUsage: usageCount > 0 ? total.cpuUsage / usageCount : 0,
    memoryUsage: usageCount > 0 ? total.memoryUsage / usageCount : 0,
    diskUsage: usageCount > 0 ? total.diskUsage / usageCount : 0,
    uptime: total.uptime,
    load1: usageCount > 0 ? total.load1 / usageCount : 0,
    load5: usageCount > 0 ? total.load5 / usageCount : 0,
    load15: usageCount > 0 ? total.load15 / usageCount : 0,
    tcpConns: total.tcpConns,
    udpConns: total.udpConns,
    periodTraffic: total.periodSeen
      ? {
          rx: total.periodRx,
          tx: total.periodTx,
          since: total.periodSince,
          nextReset: total.periodNextReset,
          cycle: total.periodCycle,
        }
      : fallback?.periodTraffic,
  };
};

const resetRealtimeNodeInstanceMetrics = (
  instanceMetrics: Record<string, RealtimeNodeInstanceMetric>,
  nodeIDs: Set<number>,
) => {
  const next = { ...instanceMetrics };

  for (const [key, metric] of Object.entries(next)) {
    if (!nodeIDs.has(metric.nodeId)) continue;
    next[key] = {
      ...metric,
      periodTraffic: {
        ...(metric.periodTraffic ?? { since: 0 }),
        tx: 0,
        rx: 0,
      },
    };
  }

  return next;
};
const SortableItem = ({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled?: boolean;
  children: (listeners: any, attributes?: any) => any;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: transform
      ? CSS.Transform.toString({
          ...transform,
          x: Math.round(transform.x),
          y: Math.round(transform.y),
        })
      : undefined,
    transition: isDragging ? undefined : transition || undefined,
    opacity: isDragging ? 0.5 : 1,
    willChange: isDragging ? "transform" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      className="h-full z-10 hover:z-50 focus-within:z-50"
      style={style}
      {...attributes}
    >
      {children(listeners)}
    </div>
  );
};
// 格式化日期时间戳
const formatDate = (timestamp: number): string => {
  if (!timestamp) return "-";

  return new Date(timestamp).toLocaleString();
};

const formatNodeAddressForCell = (address: string): string => {
  if (address.includes(":")) {
    const parts = address.split(":").filter(Boolean);

    return parts.length <= 3 ? address : `*:${parts.slice(-3).join(":")}`;
  }
  if (address.includes(".")) {
    const parts = address.split(".");

    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
      return `${parts[0]}.${parts[1]}.*`;
    }

    return parts.length >= 2 ? `${parts.slice(0, -1).join(".")}.*` : address;
  }

  return address.length > 15 ? `${address.slice(0, 15)}...` : address;
};

export default function NodePage() {
  const isAdmin = JwtUtil.getRoleIdFromToken() === 0;
  const [nodeList, setNodeList] = useState<Node[]>([]);
  const [nodeOrder, setNodeOrder] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [realtimeNodeMetrics, setRealtimeNodeMetrics] = useState<
    Record<number, RealtimeNodeMetric>
  >({});
  const [realtimeNodeInstanceMetrics, setRealtimeNodeInstanceMetrics] =
    useState<Record<string, RealtimeNodeInstanceMetric>>({});
  const realtimeNodeMetricsRef = useRef(realtimeNodeMetrics);
  const realtimeNodeInstanceMetricsRef = useRef(realtimeNodeInstanceMetrics);
  const loadNodesGenerationRef = useRef(0);
  const loadingGenerationRef = useRef(0);
  const remoteUsageGenerationRef = useRef(0);
  const remoteUsageInFlightRef = useRef(false);
  const remoteUsageEventTimerRef = useRef<number | null>(null);
  const sharingOpenGenerationRef = useRef(0);
  const pageActiveRef = useRef(true);
  const upgradeRefreshTimersRef = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      upgradeRefreshTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      upgradeRefreshTimersRef.current = [];
    };
  }, []);
  const [localSearchKeyword, setLocalSearchKeyword] = useLocalStorageState(
    "node-search-keyword-local",
    "",
  );
  const [nodeFilterMode, setNodeFilterMode, resetNodeFilterMode] =
    useLocalStorageState<NodeFilterMode>("node-expiry-filter-mode", "all");
  const [filterGroupId, setFilterGroupId] = useLocalStorageState<number | null>(
    "node-filter-group-id",
    null,
  );
  const [isSearchVisible, setIsSearchVisible] = useLocalStorageState(
    "node-search-visible",
    false,
  );
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [dnsSyncLoading, setDNSSyncLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<Node | null>(null);
  const [shareCounts, setShareCounts] = useState<Record<number, number>>({});
  const [remoteUsageByNode, setRemoteUsageByNode] = useState<
    Record<
      number,
      {
        usedPorts: number[];
        portRangeStart: number;
        portRangeEnd: number;
        runtimeInstances?: PeerRemoteUsageNodeApiItem["runtimeInstances"];
      }
    >
  >({});
  const [sharingNode, setSharingNode] = useState<Node | null>(null);
  const [importNodeOpen, setImportNodeOpen] = useState(false);
  const [peerShareNotifications, setPeerShareNotifications] = useState<
    {
      id: number;
      token: string;
      providerUrl: string;
      providerToken: string;
      providerNodeName: string;
      maxBandwidth: number;
    }[]
  >([]);

  // 轮询分享通知
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await listPeerShareNotifications();

        if (res.code === 0 && Array.isArray(res.data)) {
          setPeerShareNotifications(res.data);
        }
      } catch {
        /* ignore poll errors */
      }
    };

    poll();
    const timer = setInterval(poll, 10000);

    // 多标签页同步
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("flox-peer-share-notifications");
      channel.onmessage = () => {
        void poll();
      };
    } catch {
      /* BroadcastChannel not supported */
    }

    return () => {
      clearInterval(timer);
      channel?.close();
    };
  }, []);

  const [importPrefillUrl, setImportPrefillUrl] = useState("");
  const [importPrefillToken, setImportPrefillToken] = useState("");
  const [remoteDetailNode, setRemoteDetailNode] = useState<Node | null>(null);
  const [form, setForm, resetDraft] = useLocalStorageState<NodeForm>(
    "node-create-draft",
    {
      id: null,
      name: "",
      remark: "",
      expiryTime: 0,
      renewalCycle: "",
      groupId: null,
      intranetIp: "",
      serverIpV4: "",
      serverIpV6: "",
      port: "",
      tcpListenAddr: "[::]",
      udpListenAddr: "[::]",
      interfaceName: "",
      extraIPs: "",
      remoteConfig: "",
      sdwanConfigPath: "",
      sdwanConfigYAML: "",
      sdwanCAPath: "",
      sdwanCAPEM: "",
      sdwanCertPath: "",
      sdwanCertPEM: "",
      sdwanKeyPath: "",
      sdwanKeyPEM: "",
      sdwanNodeVPNIP: "",
      sdwanLighthouseVPNIP: "",
      sdwanLighthouseAddr: "",
      sdwanListenHost: "",
      sdwanListenPort: "",
      secret: "",
      http: 0,
      tls: 0,
      socks: 0,
      trafficRatio: 1,
      trafficLimit: 0,
      flowResetTime: 1,
      dnsEnabled: false,
      dnsProvider: "aliyun",
      dnsManageA: true,
      dnsManageAAAA: false,
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchSDWANLoading, setBatchSDWANLoading] = useState(false);
  const [viewMode, setViewMode] = useLocalStorageState<NodeViewMode>(
    "node-view-mode",
    "grid",
  );
  const [collapsedGroups, setCollapsedGroups] = useLocalStorageState<
    Record<string, boolean>
  >("node-group-collapsed-state", {});
  const [infoPopoverOpenId, setInfoPopoverOpenId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const handleClickOutside = () => {
      if (infoPopoverOpenId !== null) {
        setInfoPopoverOpenId(null);
      }
    };

    document.addEventListener("click", handleClickOutside);

    return () => document.removeEventListener("click", handleClickOutside);
  }, [infoPopoverOpenId]);
  const [installCommandModal, setInstallCommandModal] = useState(false);
  const [installCommand, setInstallCommand] = useState("");
  const [installServiceName, setInstallServiceName] = useState("flox_agent");
  const [currentNodeName, setCurrentNodeName] = useState("");
  const [installSelectorOpen, setInstallSelectorOpen] = useState(false);
  const [installTargetNode, setInstallTargetNode] = useState<Node | null>(null);
  const [installChannel, setInstallChannel] = useState<ReleaseChannel>("dev");
  // 国外机主线路版本选择相关状态
  const [overseasModalOpen, setOverseasModalOpen] = useState(false);
  const [overseasChannel, setOverseasChannel] =
    useState<ReleaseChannel>("stable");
  const [overseasVersion, setOverseasVersion] = useState("");
  const [overseasServiceName, setOverseasServiceName] = useState("flox_agent");
  const [overseasCommand, setOverseasCommand] = useState("");
  const [overseasNodeName, setOverseasNodeName] = useState("");
  const [overseasNodeId, setOverseasNodeId] = useState(0);
  // 离线部署相关状态
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [offlineCommand, setOfflineCommand] = useState("");
  const [offlineDeployData, setOfflineDeployData] =
    useState<OfflineDeployPayload | null>(null);
  // 归零流量相关状态
  const {
    isOpen: isResetTrafficModalOpen,
    onOpen: onResetTrafficModalOpen,
    onClose: onResetTrafficModalClose,
  } = useDisclosure();
  const [nodeToReset, setNodeToReset] = useState<Node | null>(null);
  const [resetTrafficLoading, setResetTrafficLoading] = useState(false);
  const [nodeInstanceMembers, setNodeInstanceMembers] = useState<
    Record<number, MonitorNodeInstanceGroupMemberApiItem[]>
  >({});
  const [instanceConfigSaving, setInstanceConfigSaving] = useState(false);
  const [instanceConfigTarget, setInstanceConfigTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [usedTrafficDirty, setUsedTrafficDirty] = useState(false);
  const [instanceConfigForm, setInstanceConfigForm] = useState({
    displayName: "",
    remark: "",
    portRange: "",
    renewalCycle: "",
    expiryDate: "",
    flowResetTime: "",
    trafficLimit: "0",
    trafficLimitMode: 1,
    usedTraffic: "0",
    weight: "1",
  });
  const [instanceDeleteTarget, setInstanceDeleteTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [instanceDeleteSaving, setInstanceDeleteSaving] = useState(false);
  const [instanceResetTarget, setInstanceResetTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [instanceResetSaving, setInstanceResetSaving] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState<"single" | "batch">(
    "single",
  );
  const [upgradeTargetNodeId, setUpgradeTargetNodeId] = useState<number | null>(
    null,
  );
  const [dnsFailoverModalOpen, setDNSFailoverModalOpen] = useState(false);
  const [dnsFailoverNode, setDNSFailoverNode] = useState<Node | null>(null);
  const [dnsProviderAvailability, setDNSProviderAvailability] =
    useState<DNSProviderAvailability>({ aliyun: false, cloudflare: false });
  const [dnsFailoverSelectedNodeIds, setDNSFailoverSelectedNodeIds] =
    useLocalStorageState<number[]>("dns-failover-selected-nodes", []);
  const [ghfastURL, setGhfastURL] = useState<string>("https://ghfast.top");
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releases, setReleases] = useState<
    Array<{
      version: string;
      name: string;
      publishedAt: string;
      prerelease: boolean;
      channel: ReleaseChannel;
    }>
  >([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releaseChannel, setReleaseChannel] = useState<ReleaseChannel>("dev");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [batchUpgradeLoading, setBatchUpgradeLoading] = useState(false);
  const [batchMimicLoading, setBatchMimicLoading] = useState(false);
  const [mimicResultModalOpen, setMimicResultModalOpen] = useState(false);
  const [mimicConfirmNodes, setMimicConfirmNodes] = useState<Node[]>([]);
  const [mimicResults, setMimicResults] = useState<
    Array<{
      nodeId: number;
      nodeName: string;
      success: boolean;
      message: string;
    }>
  >([]);
  const [batchResetTrafficLoading, setBatchResetTrafficLoading] =
    useState(false);
  const [batchResetTrafficModalOpen, setBatchResetTrafficModalOpen] =
    useState(false);
  const [nodeTrafficLogModalOpen, setNodeTrafficLogModalOpen] = useState(false);
  const [nodeTrafficLogsLoading, setNodeTrafficLogsLoading] = useState(false);
  const [nodeTrafficLogs, setNodeTrafficLogs] = useState<any[]>([]);
  const [currentLogNode, setCurrentLogNode] = useState<Node | null>(null);
  const nodeTrafficLogsGenerationRef = useRef(0);
  const [deleteLogModalOpen, setDeleteLogModalOpen] = useState(false);
  const [logToDelete, setLogToDelete] = useState<number | null>(null);
  const [upgradeProgress, setUpgradeProgress] = useState<
    Record<number, { stage: string; percent: number; message: string }>
  >({});
  const [infoPopoverPlacement, setInfoPopoverPlacement] = useState<
    Record<number, "left" | "bottom">
  >({});
  const [nodeGroups, setNodeGroups] = useState<NodeGroupApiItem[]>([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [groupSelectorNode, setGroupSelectorNode] = useState<number | null>(
    null,
  );
  const updateInfoPopoverPlacement = useCallback(
    (nodeId: number, triggerElement: HTMLElement | null) => {
      if (!triggerElement) {
        return;
      }
      const rect = triggerElement.getBoundingClientRect();
      const cardElement = triggerElement.closest("[data-node-card='true']");
      const cardRect =
        cardElement instanceof HTMLElement
          ? cardElement.getBoundingClientRect()
          : null;
      const estimatedPanelWidth = 288;
      const containerPadding = 16;
      const availableLeftSpace = cardRect
        ? rect.left - cardRect.left
        : rect.left;
      const nextPlacement: "left" | "bottom" =
        availableLeftSpace >= estimatedPanelWidth + containerPadding
          ? "left"
          : "bottom";

      setInfoPopoverPlacement((prev) =>
        prev[nodeId] === nextPlacement
          ? prev
          : { ...prev, [nodeId]: nextPlacement },
      );
    },
    [],
  );
  const handleDeleteLog = useCallback(async () => {
    if (!isAdmin || !logToDelete) return;
    const generation = nodeTrafficLogsGenerationRef.current;

    try {
      const res = await deleteNodeTrafficResetLog(logToDelete);

      if (res.code === 0) {
        toast.success("删除成功");
        if (generation === nodeTrafficLogsGenerationRef.current) {
          setNodeTrafficLogs((prev) =>
            prev.filter((log) => log.id !== logToDelete),
          );
        }
        setDeleteLogModalOpen(false);
        setLogToDelete(null);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  }, [isAdmin, logToDelete]);

  useEffect(() => {
    pageActiveRef.current = true;

    return () => {
      pageActiveRef.current = false;
      ++loadNodesGenerationRef.current;
      ++remoteUsageGenerationRef.current;
      if (remoteUsageEventTimerRef.current !== null) {
        window.clearTimeout(remoteUsageEventTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    realtimeNodeMetricsRef.current = realtimeNodeMetrics;
  }, [realtimeNodeMetrics]);

  useEffect(() => {
    realtimeNodeInstanceMetricsRef.current = realtimeNodeInstanceMetrics;
  }, [realtimeNodeInstanceMetrics]);

  const handleNodeOffline = useCallback((nodeId: number) => {
    setNodeList((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        if (node.connectionStatus === "offline" && node.systemInfo === null) {
          return node;
        }

        const offlineMetrics = realtimeNodeMetricsRef.current[nodeId];

        if (
          (offlineMetrics?.periodTraffic?.tx || 0) > 0 ||
          (offlineMetrics?.periodTraffic?.rx || 0) > 0
        ) {
          recordNodeOfflineLog(nodeId, "节点离线").catch(() => {});
        }

        return {
          ...node,
          connectionStatus: "offline" as const,
          systemInfo: null,
          expiryReminderDismissed: node.expiryReminderDismissed ?? 0,
          expiryReminderDismissedUntil:
            node.expiryReminderDismissedUntil ?? null,
        } as Node;
      }),
    );
  }, []);
  const { clearOfflineTimer, scheduleNodeOffline } = useNodeOfflineTimers({
    delayMs: 3000,
    onNodeOffline: handleNodeOffline,
  });
  const loadNodeGroups = useCallback(async () => {
    try {
      const res: any = await getNodeGroupList();
      const data = res?.data !== undefined ? res.data : res;
      const groups = Array.isArray(data)
        ? data
        : data?.list || data?.items || [];

      setNodeGroups(groups.map((g: any) => ({ ...g, id: Number(g.id) })));
    } catch (error) {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    loadNodeGroups();
  }, [loadNodeGroups]);
  const loadShareCounts = useCallback(async () => {
    try {
      const res = await getPeerShareList();

      if (res.code !== 0 || !Array.isArray(res.data)) return;
      const counts = res.data.reduce<Record<number, number>>((acc, share) => {
        acc[share.nodeId] = (acc[share.nodeId] || 0) + 1;

        return acc;
      }, {});

      setShareCounts(counts);
    } catch {
      // 分享计数是辅助信息，失败时不阻塞节点列表。
    }
  }, []);
  const loadNodes = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const generation = ++loadNodesGenerationRef.current;
    const loadingGeneration = silent ? 0 : ++loadingGenerationRef.current;

    if (!silent) {
      setLoading(true);
    }
    try {
      const res: any = await getNodeList();

      if (
        !pageActiveRef.current ||
        loadNodesGenerationRef.current !== generation
      )
        return;
      if (res.code === 0 || res.code === 200 || !res.code) {
        const data = res.data !== undefined ? res.data : res;
        const nodesArray = Array.isArray(data)
          ? data
          : data.list || data.items || [];
        const nodesData: Node[] = nodesArray.map((node: any) => ({
          ...node,
          groupId: node.groupId != null ? Number(node.groupId) : null,
          inx: node.inx ?? 0,
          expiryReminderDismissed: node.expiryReminderDismissed ?? 0,
          expiryReminderDismissedUntil:
            node.expiryReminderDismissedUntil ?? null,
          connectionStatus: node.syncError
            ? "offline"
            : node.status === 1
              ? "online"
              : "offline",
          mimicStatus: node.mimic_status || "",
          mimicError: node.mimic_error || "",
          syncError: node.syncError || undefined,
          systemInfo: null,
          copyLoading: false,
        }));

        setNodeList((prev) => {
          const previousById = new Map(prev.map((node) => [node.id, node]));

          return nodesData.map((node) =>
            mergeNodeRealtimeState(node, previousById.get(node.id)),
          );
        });
        if (
          nodesData.some((node) => node.isRemote === 1) &&
          !remoteUsageInFlightRef.current
        ) {
          const usageGeneration = ++remoteUsageGenerationRef.current;

          remoteUsageInFlightRef.current = true;
          getPeerRemoteUsageList()
            .then((usageRes) => {
              if (
                !pageActiveRef.current ||
                remoteUsageGenerationRef.current !== usageGeneration
              )
                return;
              if (usageRes.code !== 0 || !Array.isArray(usageRes.data)) return;
              const usageByNode = usageRes.data.reduce<
                Record<number, PeerRemoteUsageNodeApiItem>
              >((acc, item) => {
                acc[item.nodeId] = item;

                return acc;
              }, {});

              setRemoteUsageByNode(
                usageRes.data.reduce<
                  Record<
                    number,
                    {
                      usedPorts: number[];
                      portRangeStart: number;
                      portRangeEnd: number;
                      runtimeInstances?: PeerRemoteUsageNodeApiItem["runtimeInstances"];
                    }
                  >
                >((acc, item) => {
                  acc[item.nodeId] = {
                    usedPorts: item.usedPorts || [],
                    portRangeStart: item.portRangeStart || 0,
                    portRangeEnd: item.portRangeEnd || 0,
                    runtimeInstances: item.runtimeInstances || [],
                  };

                  return acc;
                }, {}),
              );
              setNodeList((prev) =>
                prev.map((node) => {
                  const usage = usageByNode[node.id];

                  if (!usage || node.isRemote !== 1) return node;

                  const existingInstances = new Map(
                    (node.remoteInstances || []).map((instance) => [
                      instance.instanceId.trim(),
                      instance,
                    ]),
                  );
                  const instances = (
                    usage.instances ||
                    node.remoteInstances ||
                    []
                  ).map((instance) => {
                    const existing = existingInstances.get(
                      instance.instanceId.trim(),
                    );

                    return {
                      ...existing,
                      ...instance,
                      periodRx: existing?.periodRx,
                      periodTx: existing?.periodTx,
                      totalInFlow:
                        instance.totalInFlow !== undefined
                          ? instance.totalInFlow
                          : existing?.totalInFlow,
                      totalOutFlow:
                        instance.totalOutFlow !== undefined
                          ? instance.totalOutFlow
                          : existing?.totalOutFlow,
                    };
                  });
                  const healthyInstances = instances.filter(
                    (instance) =>
                      instance.inScope &&
                      instance.status === 1 &&
                      (instance.weight == null || instance.weight > 0),
                  ).length;
                  const nextStatus = usage.syncError
                    ? 0
                    : instances.length === 0 || healthyInstances > 0
                      ? 1
                      : 0;

                  return {
                    ...node,
                    status: nextStatus,
                    connectionStatus: usage.syncError
                      ? "offline"
                      : nextStatus === 1
                        ? "online"
                        : "offline",
                    syncError: usage.syncError || undefined,
                    trafficRatio:
                      usage.trafficRatio && usage.trafficRatio > 0
                        ? usage.trafficRatio
                        : node.trafficRatio,
                    remoteCurrentFlow:
                      usage.remoteCurrentFlow ??
                      usage.currentFlow ??
                      node.remoteCurrentFlow,
                    remoteMaxBandwidth:
                      usage.maxBandwidth ?? node.remoteMaxBandwidth,
                    remoteExpiryTime: usage.expiryTime ?? node.remoteExpiryTime,
                    remoteInstances: instances,
                  };
                }),
              );
            })
            .catch(() => undefined)
            .finally(() => {
              remoteUsageInFlightRef.current = false;
            });
        } else if (!nodesData.some((node) => node.isRemote === 1)) {
          ++remoteUsageGenerationRef.current;
          setRemoteUsageByNode({});
        }
        const hasDbOrdering = nodesData.some(
          (n) => n.inx !== undefined && n.inx !== 0,
        );

        if (hasDbOrdering) {
          const dbOrder = [...nodesData]
            .sort((a, b) => (a.inx ?? 0) - (b.inx ?? 0))
            .map((n) => n.id);

          setNodeOrder(dbOrder);
        } else {
          setNodeOrder(
            loadStoredOrder(
              "node-order",
              nodesData.map((n) => n.id),
            ),
          );
        }
      } else {
        if (!silent) {
          toast.error(res.msg || "加载节点列表失败");
        }
      }
    } catch {
      if (
        !silent &&
        pageActiveRef.current &&
        loadNodesGenerationRef.current === generation
      ) {
        toast.error("网络错误，请重试");
      }
    } finally {
      if (
        !silent &&
        pageActiveRef.current &&
        loadingGenerationRef.current === loadingGeneration
      ) {
        setLoading(false);
      }
    }
  }, []);
  const loadNodeInstances = useCallback(async (): Promise<boolean> => {
    try {
      const res = await getMonitorNodeInstanceGroups();

      if (res.code !== 0) return false;
      const next: Record<number, MonitorNodeInstanceGroupMemberApiItem[]> = {};

      for (const group of res.data || []) {
        next[Number(group.id)] = group.members || [];
      }
      setNodeInstanceMembers(next);
      setRealtimeNodeInstanceMetrics((prev) => {
        const metrics = { ...prev };
        const receivedAt = Date.now();

        for (const members of Object.values(next)) {
          for (const member of members) {
            const instanceId = member.instanceId?.trim();

            if (!instanceId) continue;
            const key = getRealtimeInstanceKey(member.nodeId, instanceId);

            metrics[key] = {
              ...buildRealtimeNodeMetric({
                periodNetInBytes: member.periodNetInBytes ?? 0,
                periodNetOutBytes: member.periodNetOutBytes ?? 0,
                netInSpeed: member.netInSpeed ?? 0,
                netOutSpeed: member.netOutSpeed ?? 0,
                uptime: member.uptime ?? 0,
                tcpConns: member.tcpConns ?? 0,
                udpConns: member.udpConns ?? 0,
              }),
              nodeId: member.nodeId,
              instanceId,
              receivedAt,
            };
          }
        }

        return metrics;
      });
      setRealtimeNodeMetrics((prev) => {
        const metrics = { ...prev };

        for (const [nodeIdText, members] of Object.entries(next)) {
          const nodeId = Number(nodeIdText);
          const rx = members.reduce(
            (sum, m) => sum + (m.periodNetInBytes ?? 0),
            0,
          );
          const tx = members.reduce(
            (sum, m) => sum + (m.periodNetOutBytes ?? 0),
            0,
          );

          metrics[nodeId] = {
            ...buildRealtimeNodeMetric({
              periodNetInBytes: rx,
              periodNetOutBytes: tx,
            }),
            ...metrics[nodeId],
          };
        }

        return metrics;
      });

      return true;
    } catch {
      // 实例配置是辅助信息，失败时不阻塞节点列表。
      return false;
    }
  }, []);
  const openNodeSharing = useCallback(
    async (node: Node) => {
      const generation = ++sharingOpenGenerationRef.current;
      const loaded = await loadNodeInstances();

      if (!loaded) {
        toast.error("刷新节点实例失败，请重试");

        return;
      }
      if (sharingOpenGenerationRef.current === generation) {
        setSharingNode(node);
      }
    },
    [loadNodeInstances],
  );

  useEffect(() => {
    void loadNodeInstances();
  }, [loadNodeInstances]);
  const syncNodeInstanceStatus = (
    nodeId: number,
    instanceId: string,
    status: number,
  ) => {
    const normalizedInstanceId = instanceId.trim();

    if (!normalizedInstanceId) return;
    let found = false;

    setNodeInstanceMembers((prev) => {
      const members = prev[nodeId] || [];

      if (members.length === 0) return prev;
      const nextMembers = members.map((member) => {
        if ((member.instanceId || "").trim() !== normalizedInstanceId)
          return member;
        found = true;

        return { ...member, status };
      });

      return found ? { ...prev, [nodeId]: nextMembers } : prev;
    });
    if (!found && status === 1) {
      window.setTimeout(() => void loadNodeInstances(), 500);
    }
  };
  const handleWebSocketMessage = (data: any) => {
    const { id, type, data: messageData } = data;
    const nodeId = Number(id);

    if (Number.isNaN(nodeId)) return;
    if (type === "remote_usage_changed") {
      window.dispatchEvent(
        new CustomEvent("remote_usage_changed", { detail: { nodeId } }),
      );
      if (remoteUsageEventTimerRef.current !== null) {
        window.clearTimeout(remoteUsageEventTimerRef.current);
      }
      const refresh = () => {
        if (remoteUsageInFlightRef.current) {
          remoteUsageEventTimerRef.current = window.setTimeout(refresh, 250);

          return;
        }
        remoteUsageEventTimerRef.current = null;
        void loadNodes({ silent: true });
      };

      remoteUsageEventTimerRef.current = window.setTimeout(refresh, 100);

      return;
    }
    if (type === "status") {
      if (messageData === 1) {
        if (window.__pendingNodeRefresh?.has(nodeId)) {
          window.__pendingNodeRefresh.delete(nodeId);
          setNodeList((prev) =>
            prev.map((n) =>
              n.id === nodeId
                ? { ...n, rollbackLoading: false, upgradeLoading: false }
                : n,
            ),
          );
          setTimeout(() => loadNodes({ silent: true }), 500);
        }
        clearOfflineTimer(nodeId);
        setNodeList((prev) =>
          prev.map((node) => {
            if (node.id !== nodeId) return node;
            if (node.connectionStatus === "online") return node;

            return {
              ...node,
              connectionStatus: "online" as const,
              expiryReminderDismissed: node.expiryReminderDismissed ?? 0,
              expiryReminderDismissedUntil:
                node.expiryReminderDismissedUntil ?? null,
            } as Node;
          }),
        );
        // 触发一次节点列表刷新，获取最新 version
        setTimeout(() => loadNodes({ silent: true }), 500);
      } else {
        scheduleNodeOffline(nodeId);
      }
    } else if (type === "info") {
      if (window.__pendingNodeRefresh?.has(nodeId)) {
        window.__pendingNodeRefresh.delete(nodeId);
        setNodeList((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? { ...n, rollbackLoading: false, upgradeLoading: false }
              : n,
          ),
        );
        setTimeout(() => loadNodes({ silent: true }), 500);
      }
      clearOfflineTimer(nodeId);
      setNodeList((prev) =>
        prev.map((node) => {
          if (node.id === nodeId) {
            const systemInfo = buildNodeSystemInfo(
              messageData,
              node.systemInfo,
            );

            if (!systemInfo) {
              return node;
            }

            return {
              ...node,
              connectionStatus: "online" as const,
              systemInfo,
              expiryReminderDismissed: node.expiryReminderDismissed ?? 0,
              expiryReminderDismissedUntil:
                node.expiryReminderDismissedUntil ?? null,
            } as Node;
          }

          return node;
        }),
      );
    } else if (type === "upgrade_progress") {
      try {
        const progressData =
          typeof messageData === "string"
            ? JSON.parse(messageData)
            : messageData;

        if (progressData?.data) {
          setUpgradeProgress((prev) => ({
            ...prev,
            [nodeId]: {
              stage: progressData.data.stage || "",
              percent: progressData.data.percent || 0,
              message: progressData.message || "",
            },
          }));
          if (progressData.data.percent >= 100) {
            setNodeList((prev) =>
              prev.map((n) =>
                n.id === nodeId
                  ? { ...n, upgradeLoading: false, rollbackLoading: false }
                  : n,
              ),
            );
            setTimeout(() => {
              setUpgradeProgress((prev) => {
                const next = { ...prev };

                delete next[nodeId];

                return next;
              });
            }, 1500);
            [2000, 5000, 10000].forEach((delay) => {
              const timer = window.setTimeout(() => {
                loadNodes({ silent: true });
              }, delay);
              upgradeRefreshTimersRef.current.push(timer);
            });
          }
        }
      } catch {}
    } else if (type === "panel_upgrade_progress") {
      try {
        const progressData =
          typeof messageData === "string"
            ? JSON.parse(messageData)
            : messageData;

        if (progressData?.data) {
          window.dispatchEvent(
            new CustomEvent("panel_upgrade_progress", {
              detail: {
                stage: progressData.data.stage || "",
                percent: progressData.data.percent || 0,
                message: progressData.message || "",
                error: progressData.data.error || false,
              },
            }),
          );
        }
      } catch {}
    } else if (type === "mimic_status") {
      try {
        const statusData =
          typeof messageData === "string"
            ? JSON.parse(messageData)
            : messageData;

        if (statusData?.data) {
          setNodeList((prev) =>
            prev.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    mimicStatus: statusData.data.status || "",
                    mimicError: statusData.data.error || "",
                  }
                : n,
            ),
          );
        }
      } catch {}
    } else if (type === "instance_status") {
      let payload = messageData;

      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;
      const instanceId = String(
        payload?.instanceId ?? payload?.instance_id ?? "",
      ).trim();
      const status = Number(payload?.status ?? 0) === 1 ? 1 : 0;

      syncNodeInstanceStatus(nodeId, instanceId, status);
    } else if (type === "metric") {
      clearOfflineTimer(nodeId);
      const metric =
        typeof messageData === "string" ? JSON.parse(messageData) : messageData;

      if (!metric || typeof metric !== "object") return;
      const metricData = metric as Record<string, unknown>;
      const instanceId = String(
        metricData.instanceId ?? metricData.instance_id ?? "",
      ).trim();

      if (isRealMetricInstanceId(instanceId)) {
        const previousInstance =
          realtimeNodeInstanceMetricsRef.current[
            getRealtimeInstanceKey(nodeId, instanceId)
          ];
        const nextInstanceMetric: RealtimeNodeInstanceMetric = {
          ...buildRealtimeNodeMetric(metricData, previousInstance),
          nodeId,
          instanceId,
          receivedAt: Date.now(),
        };
        const nextInstanceMetrics = {
          ...realtimeNodeInstanceMetricsRef.current,
          [getRealtimeInstanceKey(nodeId, instanceId)]: nextInstanceMetric,
        };

        realtimeNodeInstanceMetricsRef.current = nextInstanceMetrics;
        setRealtimeNodeInstanceMetrics(nextInstanceMetrics);
        syncNodeInstanceStatus(nodeId, instanceId, 1);
        setRealtimeNodeMetrics((prev) => ({
          ...prev,
          [nodeId]:
            aggregateRealtimeNodeMetrics(
              nodeId,
              nextInstanceMetrics,
              prev[nodeId],
            ) ?? nextInstanceMetric,
        }));
      } else {
        setRealtimeNodeMetrics((prev) => ({
          ...prev,
          [nodeId]: buildRealtimeNodeMetric(metricData, prev[nodeId]),
        }));
      }
      setNodeList((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId) return node;

          return {
            ...node,
            connectionStatus: "online",
          };
        }),
      );
    }
  };
  const { wsConnected, wsConnecting, usingPollingFallback } = useNodeRealtime({
    onMessage: handleWebSocketMessage,
  });

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);
  useEffect(() => {
    void loadShareCounts();
  }, [loadShareCounts]);
  usePullToRefresh(async () => {
    await Promise.all([loadNodes(), loadShareCounts()]);
  });
  const hasRemoteNodes = nodeList.some((node) => node.isRemote === 1);

  useEffect(() => {
    if (!usingPollingFallback) {
      return;
    }
    void loadNodes({ silent: true });
    const interval = window.setInterval(() => {
      void loadNodes({ silent: true });
    }, NODE_FALLBACK_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadNodes, usingPollingFallback]);
  useEffect(() => {
    if (usingPollingFallback || !hasRemoteNodes) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadNodes({ silent: true });
    }, REMOTE_NODE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [hasRemoteNodes, loadNodes, usingPollingFallback]);
  const formatTraffic = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "K", "M", "G", "T"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };
  const handleShareCountChange = useCallback(
    (nodeId: number, count: number) => {
      setShareCounts((prev) => ({ ...prev, [nodeId]: count }));
    },
    [],
  );
  const getSelectedLocalIds = () =>
    Array.from(selectedIds).filter(
      (id) => nodeList.find((node) => node.id === id)?.isRemote !== 1,
    );
  const ipv4Regex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  const validateIpv4Literal = (ip: string): boolean =>
    ipv4Regex.test(ip.trim());
  const validateIpv6Literal = (ip: string): boolean =>
    ipv6Regex.test(ip.trim());
  const hostnameRegex =
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
  const validateHostname = (host: string): boolean => {
    const v = host.trim();

    if (!v) return false;
    if (v === "localhost") return true;

    return hostnameRegex.test(v);
  };
  const validatePort = (
    portStr: string,
  ): { valid: boolean; error?: string } => {
    if (!portStr || !portStr.trim()) {
      return { valid: true };
    }
    const trimmed = portStr.trim();

    // 1. 拦截易错的范围连接符（波浪号、下划线等）
    if (
      trimmed.includes("#") ||
      trimmed.includes("~") ||
      trimmed.includes("&") ||
      trimmed.includes("+") ||
      trimmed.includes("*") ||
      trimmed.includes("^") ||
      trimmed.includes("—") ||
      trimmed.includes("_")
    ) {
      return {
        valid: false,
        error: "端口范围请使用短横线 '-' 连接，例如 10000-65535",
      };
    }

    const parts = trimmed
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p);

    if (parts.length === 0) {
      return { valid: false, error: "请输入有效的端口" };
    }
    for (const part of parts) {
      if (part.includes("-")) {
        const range = part.split("-").map((p) => p.trim());

        if (range.length !== 2) {
          return { valid: false, error: `端口范围格式错误` };
        }

        // 2. 严格检查是否全为数字，防止含有其他非法字符
        if (!/^\d+$/.test(range[0]) || !/^\d+$/.test(range[1])) {
          return { valid: false, error: `端口范围必须是纯数字` };
        }

        const start = parseInt(range[0], 10);
        const end = parseInt(range[1], 10);

        if (start < 1 || start > 65535 || end < 1 || end > 65535) {
          return {
            valid: false,
            error: `端口范围必须在 1-65535 之间`,
          };
        }
        if (start >= end) {
          return { valid: false, error: `起始端口必须小于结束端口` };
        }
      } else {
        // 3. 修复 parseInt("10501~10515") = 10501 的致命 bug，强制要求纯数字
        if (!/^\d+$/.test(part)) {
          return { valid: false, error: `端口格式有误，必须是纯数字` };
        }

        const port = parseInt(part, 10);

        if (port < 1 || port > 65535) {
          return { valid: false, error: `端口必须在 1-65535 之间` };
        }
      }
    }

    return { valid: true };
  };
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      newErrors.name = "请输入节点名称";
    } else if (form.name.trim().length < 2) {
      newErrors.name = "节点名称长度至少2位";
    } else if (form.name.trim().length > 50) {
      newErrors.name = "节点名称长度不能超过50位";
    }
    const v4 = form.serverIpV4.trim();
    const v6 = form.serverIpV6.trim();
    const intranet = form.intranetIp.trim();

    if (v4 && !validateIpv4Literal(v4) && !validateHostname(v4)) {
      newErrors.serverIpV4 = "请输入有效的 IPv4 地址或域名";
    }
    if (v6 && !validateIpv6Literal(v6) && !validateHostname(v6)) {
      newErrors.serverIpV6 = "请输入有效的 IPv6 地址或域名";
    }
    if (
      intranet &&
      !validateIpv4Literal(intranet) &&
      !validateHostname(intranet)
    ) {
      newErrors.intranetIp = "请输入有效的内网 IPv4 地址或域名";
    }
    const portValidation = validatePort(form.port);

    if (!portValidation.valid) {
      newErrors.port = portValidation.error || "端口格式错误";
    }
    if (!Number.isFinite(form.trafficRatio) || form.trafficRatio <= 0) {
      newErrors.trafficRatio = "节点倍率必须大于 0";
    }
    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };
  const handleAdd = () => {
    void loadDNSProviderAvailability();
    setDialogTitle("新增节点");
    setIsEdit(false);
    resetDraft();
    setDialogVisible(true);
    setErrors({});
  };
  const handleEdit = (node: Node) => {
    void loadDNSProviderAvailability();
    setDialogTitle("编辑节点");
    setIsEdit(true);
    setForm({
      id: node.id,
      name: node.name,
      remark: node.remark || "",
      expiryTime: node.expiryTime || 0,
      renewalCycle: node.renewalCycle || "",
      groupId: node.groupId || null,
      intranetIp: node.intranetIp || "",
      serverIpV4: node.serverIpV4 || "",
      serverIpV6: node.serverIpV6 || "",
      port: node.port || "",
      tcpListenAddr: node.tcpListenAddr || "[::]",
      udpListenAddr: node.udpListenAddr || "[::]",
      interfaceName: (node as any).interfaceName || "",
      extraIPs: node.extraIPs || "",
      remoteConfig: node.remoteConfig || "",
      sdwanConfigPath: extractSDWANConfigPath(node.remoteConfig),
      sdwanConfigYAML: extractSDWANConfigYAML(node.remoteConfig),
      sdwanCAPath: extractSDWANField(node.remoteConfig, "sdwanCAPath"),
      sdwanCAPEM: extractSDWANField(node.remoteConfig, "sdwanCAPEM"),
      sdwanCertPath: extractSDWANField(node.remoteConfig, "sdwanCertPath"),
      sdwanCertPEM: extractSDWANField(node.remoteConfig, "sdwanCertPEM"),
      sdwanKeyPath: extractSDWANField(node.remoteConfig, "sdwanKeyPath"),
      sdwanKeyPEM: extractSDWANField(node.remoteConfig, "sdwanKeyPEM"),
      sdwanNodeVPNIP: extractSDWANField(node.remoteConfig, "sdwanNodeVPNIP"),
      sdwanLighthouseVPNIP: extractSDWANField(
        node.remoteConfig,
        "sdwanLighthouseVPNIP",
      ),
      sdwanLighthouseAddr: extractSDWANField(
        node.remoteConfig,
        "sdwanLighthouseAddr",
      ),
      sdwanListenHost: extractSDWANField(node.remoteConfig, "sdwanListenHost"),
      sdwanListenPort: extractSDWANField(node.remoteConfig, "sdwanListenPort"),
      secret: node.secret || "",
      http: typeof node.http === "number" ? node.http : 1,
      tls: typeof node.tls === "number" ? node.tls : 1,
      socks: typeof node.socks === "number" ? node.socks : 1,
      trafficRatio: node.trafficRatio || 1,
      trafficLimit: (node as any).trafficLimit || 0,
      flowResetTime: node.flowResetTime ?? 1,
      dnsEnabled: false,
      dnsProvider: "aliyun",
      dnsManageA: true,
      dnsManageAAAA: false,
    });
    getNodeDNSConfig(node.id)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setForm((prev) => ({
            ...prev,
            dnsEnabled: !!res.data.enabled,
            dnsProvider:
              res.data.provider === "cloudflare" ? "cloudflare" : "aliyun",
            dnsManageA: res.data.manageA !== false,
            dnsManageAAAA:
              res.data.enabled === true && res.data.manageAAAA === true,
          }));
        }
      })
      .catch(() => {});
    setDialogVisible(true);
  };
  const openDNSFailoverPicker = (node?: Node) => {
    setDNSFailoverNode(node ?? null);
    setDNSFailoverModalOpen(true);
  };

  const getNodeDNSConfig = (nodeId: number) =>
    Network.post<any>("/node/dns-failover/get", { nodeId });

  const loadDNSProviderAvailability = () =>
    Network.post<
      Array<{ provider: string; providerConfig?: Record<string, string> }>
    >("/dns-failover/global/get", {})
      .then((res) => {
        if (res.code !== 0 || !res.data) return;
        const aliyun =
          res.data.find((item) => item.provider === "aliyun")?.providerConfig ||
          {};
        const cloudflare =
          res.data.find((item) => item.provider === "cloudflare")
            ?.providerConfig || {};

        setDNSProviderAvailability({
          aliyun: Boolean(
            aliyun.accessKeyId && aliyun.accessKeySecretSet === "true",
          ),
          cloudflare:
            cloudflare.authMode === "global_key"
              ? Boolean(
                  cloudflare.email && cloudflare.globalApiKeySet === "true",
                )
              : cloudflare.apiTokenSet === "true",
        });
      })
      .catch(() => {});

  const saveNodeDNSConfig = (data: Record<string, unknown>) =>
    Network.post<any>("/node/dns-failover/save", data);

  const syncNodeDNSConfig = (nodeId: number) =>
    Network.post<any>("/node/dns-failover/sync", { nodeId });

  const handleManualDNSSync = async (event?: {
    stopPropagation?: () => void;
  }) => {
    event?.stopPropagation?.();
    const nodeId = Number(form.id || 0);
    const dnsAddress = form.serverIpV4.trim();

    if (!nodeId) {
      toast.error("请先保存节点后再同步 DNS 容灾");

      return;
    }
    if (!form.dnsEnabled) {
      toast.error("请先启用 DNS 容灾");

      return;
    }
    if (!dnsAddress || validateIpv4Literal(dnsAddress)) {
      toast.error("启用 DNS 容灾时，请填写域名而不是 IP 地址");

      return;
    }
    if (!dnsProviderAvailability[form.dnsProvider]) {
      toast.error(
        `${form.dnsProvider === "aliyun" ? "阿里云" : "Cloudflare"} DNS 尚未配置`,
      );

      return;
    }

    setDNSSyncLoading(true);
    try {
      const saveRes = await saveNodeDNSConfig({
        nodeId,
        enabled: form.dnsEnabled,
        provider: form.dnsProvider,
        domain: dnsAddress,
        manageA: form.dnsManageA,
        manageAAAA: form.dnsManageAAAA,
        providerConfig: {},
      });

      if (saveRes.code !== 0) {
        toast.error(saveRes.msg || "DNS 配置保存失败");

        return;
      }
      const syncRes = await syncNodeDNSConfig(nodeId);

      if (syncRes.code === 0) {
        toast.success("DNS 容灾同步完成");
      } else {
        toast.error(syncRes.msg || "DNS 容灾同步失败");
      }
    } catch {
      toast.error("DNS 容灾同步失败");
    } finally {
      setDNSSyncLoading(false);
    }
  };

  const handleRegenerateSecret = () => {
    const bytes = new Uint8Array(16);

    crypto.getRandomValues(bytes);
    const newSecret = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");

    setForm((prev) => ({ ...prev, secret: newSecret }));
  };
  const handleDelete = (node: Node) => {
    setNodeToDelete(node);
    setDeleteModalOpen(true);
  };
  const confirmDelete = async () => {
    if (!nodeToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await deleteNode(nodeToDelete.id);

      if (res.code === 0) {
        toast.success("删除成功");
        setNodeList((prev) => prev.filter((n) => n.id !== nodeToDelete.id));
        setDeleteModalOpen(false);
        setNodeToDelete(null);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };
  const handleDismissExpiryReminder = async (
    nodeId: number,
    instanceId?: string,
  ) => {
    try {
      const res = await refreshNodeExpiryReminder(nodeId, instanceId);

      if (res.code === 0) {
        await loadNodes({ silent: true });
        setInfoPopoverOpenId(null);
        toast.success("已更新提醒周期");
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch (err) {
      toast.error("网络错误，请重试");
    }
  };
  const handleAssignNodeToGroup = async (
    nodeId: number,
    groupId: number | null,
  ) => {
    try {
      await assignNodeToGroup(nodeId, groupId);
      setNodeList((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, groupId } : n)),
      );
      toast.success(groupId ? "分组已更新" : "已移除分组");
      setGroupSelectorNode(null);
    } catch (error) {
      toast.error("操作失败");
    }
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
  const getDefaultInstanceLabel = (
    member?: MonitorNodeInstanceGroupMemberApiItem | null,
  ) => {
    if (!member) return "实例";

    return member.displayIndex
      ? `实例 ${member.displayIndex}`
      : member.instanceId || "实例";
  };
  const reorderNodeInstances = useCallback(
    async (
      nodeId: number,
      activeInstanceId: string,
      overInstanceId: string,
    ) => {
      const previousMembers = nodeInstanceMembers[nodeId];

      if (!previousMembers) return;
      const oldIndex = previousMembers.findIndex(
        (member) => member.instanceId?.trim() === activeInstanceId,
      );
      const newIndex = previousMembers.findIndex(
        (member) => member.instanceId?.trim() === overInstanceId,
      );

      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const reorderedMembers = arrayMove(
        previousMembers,
        oldIndex,
        newIndex,
      ).map((member, index) => ({ ...member, displayIndex: index + 1 }));
      const instanceIds = reorderedMembers.map(
        (member) => member.instanceId?.trim() || "",
      );

      if (instanceIds.some((instanceId) => !instanceId)) {
        toast.error("实例标识无效，无法保存排序");

        return;
      }

      setNodeInstanceMembers((current) => ({
        ...current,
        [nodeId]: reorderedMembers,
      }));
      try {
        const res = await updateNodeInstanceOrder({ nodeId, instanceIds });

        if (res.code !== 0) throw new Error(res.msg || "保存实例排序失败");
      } catch (error) {
        setNodeInstanceMembers((current) => ({
          ...current,
          [nodeId]: previousMembers,
        }));
        toast.error(
          error instanceof Error ? error.message : "保存实例排序失败",
        );
      }
    },
    [nodeInstanceMembers],
  );
  const openInstanceConfigEditor = (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => {
    const renewalCycle = String(member.renewalCycle || "");
    const usedTraffic =
      ((member.totalInFlow ?? 0) + (member.totalOutFlow ?? 0)) /
      (1024 * 1024 * 1024);

    setInstanceConfigSaving(false);
    setUsedTrafficDirty(false);
    setInstanceConfigTarget(member);
    setInstanceConfigForm({
      displayName: member.displayName?.trim() || "",
      remark: member.remark?.trim() || "",
      portRange: member.portRange?.trim() || "",
      renewalCycle:
        renewalCycle === "halfyear"
          ? "halfYear"
          : (renewalCycle as NodeRenewalCycle),
      expiryDate: formatDateInputValue(member.expiryTime),
      flowResetTime:
        member.flowResetTime === undefined || member.flowResetTime === null
          ? ""
          : String(member.flowResetTime),
      trafficLimit: String(member.trafficLimit || 0),
      trafficLimitMode: member.trafficLimitMode ?? 1,
      usedTraffic: usedTraffic.toFixed(2),
      weight: String(member.weight ?? 1),
    });
  };
  const saveInstanceConfig = async () => {
    if (!instanceConfigTarget?.instanceId) return;
    const expiryTime = parseDateInputValue(instanceConfigForm.expiryDate);
    const renewalCycle = instanceConfigForm.renewalCycle.trim();
    const flowResetTime = Number(
      instanceConfigForm.flowResetTime === ""
        ? 0
        : instanceConfigForm.flowResetTime,
    );
    const trafficLimit = Number(instanceConfigForm.trafficLimit || 0);
    const usedTrafficGB = Number(instanceConfigForm.usedTraffic || 0);
    const displayName = instanceConfigForm.displayName.trim();
    const remark = instanceConfigForm.remark.trim();
    const portRange =
      instanceConfigForm.portRange.trim() || DEFAULT_INSTANCE_PORT_RANGE;

    if (displayName.length > 100) {
      toast.error("实例名称不能超过 100 个字符");

      return;
    }
    if (remark.length > 200) {
      toast.error("实例备注不能超过 200 个字符");

      return;
    }
    if (
      (expiryTime > 0 && !renewalCycle) ||
      (expiryTime <= 0 && renewalCycle)
    ) {
      toast.error("请同时设置续费周期和到期时间");

      return;
    }
    if (
      !Number.isFinite(flowResetTime) ||
      flowResetTime < 0 ||
      flowResetTime > 31
    ) {
      toast.error("流量归零日必须在 0-31 之间，0 表示不归零");

      return;
    }
    if (!Number.isFinite(trafficLimit) || trafficLimit < 0) {
      toast.error("流量限额不能小于 0");

      return;
    }
    if (!Number.isFinite(usedTrafficGB) || usedTrafficGB < 0) {
      toast.error("已用流量不能小于 0");

      return;
    }
    const trafficLimitMode = instanceConfigForm.trafficLimitMode ?? 1;

    // 计算已用流量差值（GB -> bytes）
    const currentUsedBytes =
      (instanceConfigTarget.totalInFlow ?? 0) +
      (instanceConfigTarget.totalOutFlow ?? 0);
    const targetUsedBytes = Math.round(usedTrafficGB * 1024 * 1024 * 1024);
    const diffBytes = usedTrafficDirty ? targetUsedBytes - currentUsedBytes : 0;

    // 按比例分配到上行/下行
    let inFlowAdjust = 0;
    let outFlowAdjust = 0;

    if (Math.abs(diffBytes) > 0) {
      const currentIn = instanceConfigTarget.totalInFlow ?? 0;
      const currentOut = instanceConfigTarget.totalOutFlow ?? 0;
      const total = currentIn + currentOut;

      if (total > 0) {
        // 按当前比例分配
        inFlowAdjust = Math.round(diffBytes * (currentIn / total));
        outFlowAdjust = diffBytes - inFlowAdjust;
      } else {
        // 新实例，全部加到下行
        outFlowAdjust = diffBytes;
      }
    }

    setInstanceConfigSaving(true);
    try {
      const payload: Parameters<typeof updateNodeInstanceProfile>[0] = {
        nodeId: instanceConfigTarget.nodeId,
        instanceId: instanceConfigTarget.instanceId,
        displayName,
        remark,
        weight:
          instanceConfigForm.weight.trim() === ""
            ? 1
            : Number(instanceConfigForm.weight),
        portRange,
        flowResetTime: Math.floor(flowResetTime),
        trafficLimit: Math.floor(trafficLimit),
        trafficLimitMode,
        inFlowAdjust: Math.round(inFlowAdjust),
        outFlowAdjust: Math.round(outFlowAdjust),
      };

      if (expiryTime > 0 && renewalCycle) {
        payload.expiryTime = expiryTime;
        payload.renewalCycle = renewalCycle;
      }
      const res = await updateNodeInstanceProfile(payload);

      if (res.code === 0) {
        toast.success("实例配置已保存");
        setInstanceConfigSaving(false);
        setUsedTrafficDirty(false);
        setInstanceConfigTarget(null);
        await loadNodeInstances();
        await loadNodes({ silent: true });
      } else {
        toast.error(res.msg || "保存实例配置失败");
      }
    } catch {
      toast.error("保存实例配置失败");
    } finally {
      setInstanceConfigSaving(false);
    }
  };
  const deleteInstanceConfig = async () => {
    if (!instanceDeleteTarget?.instanceId) return;
    setInstanceDeleteSaving(true);
    try {
      const res = await deleteNodeInstancePort(
        instanceDeleteTarget.nodeId,
        instanceDeleteTarget.instanceId,
      );

      if (res.code === 0) {
        toast.success("实例已删除");
        const warning = (res.data as { uninstallWarning?: string } | undefined)
          ?.uninstallWarning;

        if (warning) {
          toast(String(warning));
        }
        setInstanceDeleteTarget(null);
        await loadNodeInstances();
        await loadNodes({ silent: true });
      } else {
        toast.error(res.msg || "删除实例失败");
      }
    } catch {
      toast.error("删除实例失败");
    } finally {
      setInstanceDeleteSaving(false);
    }
  };
  const resetInstanceTraffic = async () => {
    const member = instanceResetTarget;

    if (!member?.instanceId) return;
    setInstanceResetSaving(true);
    try {
      const res = await batchResetNodeInstanceTraffic({
        instances: [{ nodeId: member.nodeId, instanceId: member.instanceId }],
        reason: "管理员手动归零",
      });
      const result = res.data?.[0];

      if (res.code === 0 && result?.success) {
        toast.success("实例流量归零成功");
        setInstanceResetTarget(null);
        setRealtimeNodeInstanceMetrics((prev) => {
          const key = `${member.nodeId}:${member.instanceId}`;
          const metric = prev[key];

          if (!metric) return prev;

          return {
            ...prev,
            [key]: {
              ...metric,
              periodTraffic: {
                ...(metric.periodTraffic ?? { since: 0 }),
                tx: 0,
                rx: 0,
              },
            },
          };
        });
        await loadNodeInstances();
        await loadNodes({ silent: true });
      } else {
        toast.error(result?.error || res.msg || "归零失败");
      }
    } catch {
      toast.error("归零失败");
    } finally {
      setInstanceResetSaving(false);
    }
  };
  // 查看节点流量归零日志
  const handleViewNodeTrafficLogs = async (node: Node) => {
    const generation = ++nodeTrafficLogsGenerationRef.current;

    setNodeTrafficLogsLoading(true);
    setCurrentLogNode(node);
    try {
      const res = await getNodeTrafficResetLogs(node.id, 30);

      if (generation !== nodeTrafficLogsGenerationRef.current) return;
      if (res.code === 0) {
        setNodeTrafficLogs(res.data?.logs || []);
        setNodeTrafficLogModalOpen(true);
      } else {
        toast.error(res.msg || "获取日志失败");
      }
    } catch {
      if (generation === nodeTrafficLogsGenerationRef.current) {
        toast.error("网络错误，请重试");
      }
    } finally {
      if (generation === nodeTrafficLogsGenerationRef.current) {
        setNodeTrafficLogsLoading(false);
      }
    }
  };
  // 归零节点流量
  const handleResetNodeTraffic = (node: Node) => {
    setNodeToReset(node);
    onResetTrafficModalOpen();
  };
  // 暂停/启用节点
  const handleTogglePause = async (node: Node) => {
    const isPaused = node.paused === 1;

    try {
      const res = isPaused
        ? await resumeNode(node.id)
        : await pauseNode(node.id);

      if (res.code === 0) {
        toast.success(isPaused ? "节点已启用" : "节点已暂停");
        setNodeList((prev) =>
          prev.map((n) =>
            n.id === node.id ? { ...n, paused: isPaused ? 0 : 1 } : n,
          ),
        );
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误，操作失败");
    }
  };
  // 暂停/启用实例
  const handleToggleInstancePause = async (
    member: MonitorNodeInstanceGroupMemberApiItem,
  ) => {
    const isPaused = member.weight <= 0;

    try {
      const res = isPaused
        ? await resumeInstance(member.nodeId, member.instanceId || "")
        : await pauseInstance(member.nodeId, member.instanceId || "");

      if (res.code === 0) {
        toast.success(isPaused ? "实例已启用" : "实例已暂停");
        setNodeInstanceMembers((prev) => {
          const next = { ...prev };
          const key = member.nodeId;

          if (next[key]) {
            next[key] = next[key].map((m) =>
              m.instanceId === member.instanceId
                ? { ...m, weight: isPaused ? 1 : 0 }
                : m,
            );
          }

          return next;
        });
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误，操作失败");
    }
  };
  // 确认归零流量
  const handleConfirmResetTraffic = async () => {
    if (!nodeToReset) return;
    setResetTrafficLoading(true);
    try {
      const res = await batchResetNodeTraffic(
        [nodeToReset.id],
        "管理员手动归零",
      );

      const result = res.data?.[0];

      if (res.code === 0 && result?.success) {
        toast.success("流量归零成功");
        onResetTrafficModalClose();
        setRealtimeNodeMetrics((prev) => {
          const metric = prev[nodeToReset.id];

          if (!metric) return prev;

          return {
            ...prev,
            [nodeToReset.id]: {
              ...metric,
              periodTraffic: {
                ...(metric.periodTraffic ?? { since: 0 }),
                tx: 0,
                rx: 0,
              },
            },
          };
        });
        setRealtimeNodeInstanceMetrics((prev) => {
          const next = resetRealtimeNodeInstanceMetrics(
            prev,
            new Set([nodeToReset.id]),
          );

          realtimeNodeInstanceMetricsRef.current = next;

          return next;
        });
        // 静默刷新节点列表，保持当前滚动位置
        await loadNodes({ silent: true });
      } else {
        toast.error(result?.error || res.msg || "归零失败");
      }
    } catch {
      toast.error("归零失败");
    } finally {
      setResetTrafficLoading(false);
    }
  };
  const openInstallSelector = (node: Node) => {
    setInstallTargetNode(node);
    setInstallChannel("dev");
    setInstallSelectorOpen(true);
  };
  const handleCopyInstallCommand = async (
    node: Node,
    channel: ReleaseChannel,
  ) => {
    try {
      const res = await getNodeInstallCommand(node.id, channel);

      if (res.code === 0 && res.data) {
        setInstallServiceName(installServiceName);
        setInstallCommand(res.data);
        setCurrentNodeName(node.name);
        setInstallCommandModal(true);
      } else {
        toast.error(res.msg || "获取安装命令失败");
      }
    } catch {
      toast.error("获取安装命令失败");
    }
  };
  const handleCopyDomesticInstallCommand = async (node: Node) => {
    try {
      const res = await getNodeInstallCommandDomestic(node.id);

      if (res.code === 0 && res.data) {
        setInstallServiceName(installServiceName);
        setInstallCommand(res.data);
        setCurrentNodeName(node.name);
        setInstallCommandModal(true);
      } else {
        toast.error(res.msg || "获取命令失败");
      }
    } catch {
      toast.error("获取命令失败");
    }
  };
  const handleCopyOverseasInstallCommand = (node: Node) => {
    setOverseasNodeId(node.id);
    setOverseasNodeName(node.name);
    setOverseasChannel("stable");
    setOverseasVersion("");
    setOverseasServiceName("flox_agent");
    setOverseasCommand("");
    setOverseasModalOpen(true);
    void loadReleasesByChannel("stable");
  };
  const handleCopyAutoInstallCommand = async (node: Node) => {
    try {
      const res = await getNodeInstallCommandDomestic(node.id);

      if (res.code === 0 && res.data) {
        setInstallServiceName(installServiceName);
        let command = res.data as string;

        // 移除 GLOBAL_DOWNLOAD_URL 前缀
        command = command.replace(/^GLOBAL_DOWNLOAD_URL="[^"]*"\s*/, "");
        command = command.replace("/install.sh", "/install-auto.sh");
        setInstallCommand(command);
        setCurrentNodeName(node.name);
        setInstallCommandModal(true);
      } else {
        toast.error(res.msg || "获取命令失败");
      }
    } catch {
      toast.error("获取命令失败");
    }
  };
  const handleCopyOfflineInstallCommand = async (node: Node) => {
    try {
      const res = await getNodeInstallCommandOffline(node.id);

      if (res.code === 0 && res.data) {
        const data = res.data as OfflineDeployPayload;
        const command = `unzip -d /tmp/flox_agent -o offline.zip && bash /tmp/flox_agent/offline.sh -a ${data.panelAddr} -s ${data.secret}`;

        setOfflineCommand(command);
        setOfflineDeployData(data);
        setCurrentNodeName(data.nodeName || node.name);
        setOfflineModalOpen(true);
      } else {
        toast.error(res.msg || "获取命令失败");
      }
    } catch {
      toast.error("获取命令失败");
    }
  };

  // 国外机主线路：自动生成命令（通道/版本变化时触发）
  useEffect(() => {
    if (!overseasModalOpen || !overseasNodeId) return;
    setOverseasCommand("");
    getNodeInstallCommandOverseas(
      overseasNodeId,
      overseasChannel,
      overseasVersion || undefined,
    )
      .then((res) => {
        if (res.code === 0 && res.data) {
          setOverseasCommand(res.data);
        }
      })
      .catch(() => {});
  }, [overseasModalOpen, overseasNodeId, overseasChannel, overseasVersion]);
  const copyToClipboard = (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            toast.success(`${label}已复制到剪贴板`);
          })
          .catch(() => {
            toast.error("复制失败，请手动选择文本复制");
          });
      } else {
        // HTTP 环境下的经典降级复制方案
        const textArea = document.createElement("textarea");

        textArea.value = text;
        // 确保它完全不可见且不影响页面滚动
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "-9999px";
        textArea.style.opacity = "0";

        // 👇 核心修复：寻找当前是否打开了弹窗
        // 如果有弹窗，就把文本框挂载到弹窗内部；如果没有，才挂载到 body。
        // 这样就能完美绕过 HeroUI 的 Modal 焦点陷阱！
        const modalElement = document.querySelector('[role="dialog"]');
        const targetContainer = modalElement || document.body;

        targetContainer.appendChild(textArea);

        // 选中并复制
        textArea.focus();
        textArea.select();
        // 增加更兼容移动端的选中方式
        textArea.setSelectionRange(0, 99999);

        const successful = document.execCommand("copy");

        if (successful) {
          toast.success(`${label}已复制到剪贴板`);
        } else {
          toast.error("复制失败，请手动选择文本复制");
        }

        targetContainer.removeChild(textArea);
      }
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };
  const handleConfirmInstallCommand = async () => {
    if (!installTargetNode) return;
    setInstallSelectorOpen(false);
    await handleCopyInstallCommand(installTargetNode, installChannel);
  };
  const loadReleasesByChannel = useCallback(async (channel: ReleaseChannel) => {
    setReleasesLoading(true);
    try {
      const res = await getNodeReleases(channel);

      if (res.code === 0 && Array.isArray(res.data)) {
        setReleases(res.data);
        // 获取最新版本号（第一个）
        if (res.data.length > 0) {
          setLatestVersion(res.data[0].version);
        }
      } else {
        toast.error(res.msg || "获取版本列表失败");
      }
    } catch {
      toast.error("获取版本列表失败");
    } finally {
      setReleasesLoading(false);
    }
  }, []);
  const openUpgradeModal = async (
    target: "single" | "batch",
    nodeId?: number,
  ) => {
    // 获取 ghfast_url 配置
    const configRes = await getConfigByName("global_download_url");

    if (configRes.code === 0 && configRes.data?.value) {
      setGhfastURL(configRes.data.value);
    } else {
      setGhfastURL("https://ghfast.top");
    }
    const defaultChannel: ReleaseChannel = "stable";

    setUpgradeTarget(target);
    setUpgradeTargetNodeId(nodeId || null);
    setReleaseChannel(defaultChannel);
    setSelectedVersion("");
    setLatestVersion("");
    setUpgradeModalOpen(true);
    await loadReleasesByChannel(defaultChannel);
  };
  // 构建完整更新地址
  const buildFullUpdateURL = (): string => {
    const version = selectedVersion || latestVersion;
    const releaseType = version || "latest";

    // 检测是否为 GitHub 代理（不包含 github.com 的都需要拼接完整 GitHub URL）
    if (!ghfastURL.includes("github.com")) {
      return `${ghfastURL}/https://github.com/abai569/flox/releases/download/${releaseType}/gost-{ARCH}`;
    }

    // 直连 GitHub（如 https://github.com）
    return `${ghfastURL}/abai569/flox/releases/download/${releaseType}/gost-{ARCH}`;
  };
  // 获取地址前缀文本（升级地址/回退地址）
  const getAddressPrefix = (): string => {
    if (!selectedVersion) return "升级地址";
    if (upgradeTarget === "single" && upgradeTargetNodeId) {
      const node = nodeList.find((n) => n.id === upgradeTargetNodeId);

      if (node?.version) {
        const currentVersion = node.version
          .split(" ")[0]
          .replace(/^gost\s*/i, "");

        return compareVersions(selectedVersion, currentVersion) > 0
          ? "升级地址"
          : "回退地址";
      }
    }

    return "升级地址";
  };
  // 获取当前操作类型文本（升级/回退/更新）
  const getCurrentActionText = (): string => {
    // 未选择版本时，显示"更新"
    if (!selectedVersion) return "更新";
    // 单个节点升级时，对比版本
    if (upgradeTarget === "single" && upgradeTargetNodeId) {
      const node = nodeList.find((n) => n.id === upgradeTargetNodeId);

      if (node?.version) {
        const currentVersion = node.version.split(" ")[0]; // 提取版本号部分，如 "gost 2.2.5-beta37" → "gost"
        const versionOnly = currentVersion.replace(/^gost\s*/i, ""); // 提取纯版本号 "2.2.5-beta37"

        return compareVersions(selectedVersion, versionOnly) > 0
          ? "升级"
          : "回退";
      }
    }

    // 批量升级时默认显示"更新"（中性词）
    return "更新";
  };
  const handleConfirmUpgrade = async () => {
    const version = selectedVersion || undefined;
    const isNodeNotOnlineMessage = (value: unknown) =>
      String(value || "").includes("节点不在线");
    const markUpgradeNodesOffline = (nodeIds: number[]) => {
      const offlineIds = new Set(nodeIds);

      setNodeList((prev) =>
        prev.map((node) =>
          offlineIds.has(node.id)
            ? {
                ...node,
                connectionStatus: "offline" as const,
                systemInfo: null,
              }
            : node,
        ),
      );
      setTimeout(() => loadNodes({ silent: true }), 500);
    };

    if (upgradeTarget === "single" && upgradeTargetNodeId) {
      setUpgradeModalOpen(false);
      const node = nodeList.find((n) => n.id === upgradeTargetNodeId);

      if (!node) return;
      setNodeList((prev) =>
        prev.map((n) =>
          n.id === upgradeTargetNodeId ? { ...n, upgradeLoading: true } : n,
        ),
      );
      try {
        const res = await upgradeNode(
          upgradeTargetNodeId,
          version,
          releaseChannel,
        );

        if (res.code === 0) {
          toast.success("已向该节点所有在线实例发送更新命令");
        } else {
          if (isNodeNotOnlineMessage(res.msg)) {
            markUpgradeNodesOffline([upgradeTargetNodeId]);
          }
          toast.error(res.msg || "升级失败");
        }
      } catch {
        toast.error("网络错误，请重试");
      } finally {
        setNodeList((prev) =>
          prev.map((n) =>
            n.id === upgradeTargetNodeId ? { ...n, upgradeLoading: false } : n,
          ),
        );
      }
    } else if (upgradeTarget === "batch") {
      const selectedLocalIds = getSelectedLocalIds();

      if (selectedLocalIds.length === 0) {
        toast.error("请选择节点进行升级");
        setUpgradeModalOpen(false);

        return;
      }
      setBatchUpgradeLoading(true);
      setUpgradeModalOpen(false);
      try {
        const res = await batchUpgradeNodes(
          selectedLocalIds,
          version,
          releaseChannel,
        );

        if (res.code === 0) {
          const responseData = res.data as { results?: unknown } | undefined;
          const results = Array.isArray(responseData?.results)
            ? responseData.results
            : [];
          const offlineNodeIds = results
            .filter(
              (item: any) =>
                item &&
                item.success === false &&
                isNodeNotOnlineMessage(item.message),
            )
            .map((item: any) => Number(item.id))
            .filter((id: number) => Number.isFinite(id));

          if (offlineNodeIds.length > 0) {
            markUpgradeNodesOffline(offlineNodeIds);
          }
          toast.success(
            `已向 ${selectedLocalIds.length} 个节点的所有在线实例发送更新命令`,
          );
          setSelectedIds(new Set());
          setSelectMode(false);
        } else {
          toast.error(res.msg || "批量升级失败");
        }
      } catch {
        toast.error("网络错误，请重试");
      } finally {
        setBatchUpgradeLoading(false);
      }
    }
  };

  function getMimicFixCommand(errMsg: string): string {
    if (errMsg.includes("404") || errMsg.includes("Failed to fetch"))
      return "apt-get update";
    if (errMsg.includes("已安装")) return "reboot";
    if (
      errMsg.includes("linux-headers") ||
      errMsg.includes("头文件") ||
      errMsg.includes("已不存在")
    )
      return "apt-get install -y linux-image-amd64 linux-headers-amd64 && reboot";
    if (
      errMsg.includes("BUILD_EXCLUSIVE") ||
      errMsg.includes("DKMS") ||
      errMsg.includes("被 DKMS 拒绝")
    )
      return "apt-get install -y linux-image-cloud-amd64 linux-headers-cloud-amd64 && reboot";
    if (errMsg.includes("不支持的包管理器"))
      return "请手动安装：bubblewrap pahole clang-16 bpftool libbpf-dev libffi-dev";

    return "apt-get install -f -y && systemctl restart flox_agent1";
  }
  const handleBatchMimicDeps = async (targetIds?: number[]) => {
    const selectedLocalIds = targetIds ?? getSelectedLocalIds();

    if (selectedLocalIds.length === 0) {
      toast.error("请选择节点");

      return;
    }

    // 存下名字，万一 API 失败也能在弹窗里显示
    const nameMap = new Map<number, string>();

    selectedLocalIds.forEach((id) => {
      const node = nodeList.find((n) => n.id === id);

      if (node) nameMap.set(id, node.name);
    });

    setBatchMimicLoading(true);
    try {
      const res = await installMimicDeps(selectedLocalIds);

      if (res.code === 0) {
        setMimicResults((res.data as any[]) || []);
      } else {
        setMimicResults(
          selectedLocalIds.map((id) => ({
            nodeId: id,
            nodeName: nameMap.get(id) || "",
            success: false,
            message: res.msg || "请求失败",
          })),
        );
      }
      setMimicResultModalOpen(true);
    } catch {
      setMimicResults(
        selectedLocalIds.map((id) => ({
          nodeId: id,
          nodeName: nameMap.get(id) || "",
          success: false,
          message: "请求超时",
        })),
      );
      setMimicResultModalOpen(true);
    } finally {
      setBatchMimicLoading(false);
    }
  };
  const requestMimicDepsInstall = (nodes: Node[]) => {
    if (nodes.length === 0) {
      toast.error("请选择节点");

      return;
    }
    setMimicConfirmNodes(nodes);
  };
  const handleBatchResetTraffic = async () => {
    const selectedLocalIds = getSelectedLocalIds();

    if (selectedLocalIds.length === 0) {
      toast.error("请选择节点进行归零");
      setBatchResetTrafficModalOpen(false);

      return;
    }
    setBatchResetTrafficLoading(true);
    try {
      const res = await batchResetNodeTraffic(
        selectedLocalIds,
        "管理员手动归零",
      );

      if (res.code === 0) {
        const successCount = res.data?.filter((r) => r.success).length || 0;
        const successfulIds = new Set<number>();

        for (const result of res.data || []) {
          if (result.success && result.nodeId !== undefined) {
            successfulIds.add(result.nodeId);
          }
        }

        toast.success(
          `已成功归零 ${successCount}/${selectedLocalIds.length} 个节点的流量统计`,
        );
        setBatchResetTrafficModalOpen(false);
        setSelectMode(false);
        setSelectedIds(new Set());
        setRealtimeNodeMetrics((prev) => {
          const next = { ...prev };

          for (const nodeId of successfulIds) {
            if (nodeId === undefined || !next[nodeId]) continue;
            next[nodeId] = {
              ...next[nodeId],
              periodTraffic: {
                ...(next[nodeId].periodTraffic ?? { since: 0 }),
                tx: 0,
                rx: 0,
              },
            };
          }

          return next;
        });
        setRealtimeNodeInstanceMetrics((prev) => {
          const next = resetRealtimeNodeInstanceMetrics(prev, successfulIds);

          realtimeNodeInstanceMetricsRef.current = next;

          return next;
        });
        await loadNodes({ silent: true });
      } else {
        toast.error(res.msg || "批量归零失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBatchResetTrafficLoading(false);
    }
  };
  const handleBatchBootstrapSDWAN = async () => {
    const ids = getSelectedLocalIds();

    if (ids.length === 0) return;
    setBatchSDWANLoading(true);
    try {
      const res = await bootstrapNodeSDWAN(ids, ids[0]);

      if (res.code === 0) {
        toast.success(
          `SDWAN 组网完成：${res.data?.updatedCount || 0} 个节点，中心节点 ID ${res.data?.lighthouseNodeId || ids[0]}`,
        );
        loadNodes();
      } else {
        toast.error(res.msg || "SDWAN 组网失败");
      }
    } catch {
      toast.error("SDWAN 组网失败");
    } finally {
      setBatchSDWANLoading(false);
    }
  };
  const handleSubmit = async () => {
    if (!validateForm()) return;
    const dnsAddress = form.serverIpV4.trim();

    if (form.dnsEnabled && (!dnsAddress || validateIpv4Literal(dnsAddress))) {
      setErrors((prev) => ({
        ...prev,
        serverIpV4: "启用 DNS 容灾时必须填写域名，不能填写 IP 地址",
      }));
      toast.error("启用 DNS 容灾时，请填写域名而不是 IP 地址");

      return;
    }
    if (form.dnsEnabled && !dnsProviderAvailability[form.dnsProvider]) {
      toast.error(
        `${form.dnsProvider === "aliyun" ? "阿里云" : "Cloudflare"} DNS 尚未配置`,
      );

      return;
    }
    setSubmitLoading(true);
    try {
      const apiCall = isEdit ? updateNode : createNode;
      const {
        intranetIp,
        serverIpV4,
        serverIpV6,
        secret,
        remoteConfig,
        sdwanConfigPath,
        sdwanConfigYAML,
        sdwanCAPath,
        sdwanCAPEM,
        sdwanCertPath,
        sdwanCertPEM,
        sdwanKeyPath,
        sdwanKeyPEM,
        sdwanNodeVPNIP,
        sdwanLighthouseVPNIP,
        sdwanLighthouseAddr,
        sdwanListenHost,
        sdwanListenPort,
        dnsEnabled: _dnsEnabled,
        dnsProvider: _dnsProvider,
        dnsManageA: _dnsManageA,
        dnsManageAAAA: _dnsManageAAAA,
        ...rest
      } = form;

      void _dnsEnabled;
      void _dnsProvider;
      void _dnsManageA;
      void _dnsManageAAAA;
      const nextRemoteConfig = mergeSDWANConfig(
        remoteConfig,
        sdwanConfigPath,
        sdwanConfigYAML,
        {
          sdwanCAPath,
          sdwanCAPEM,
          sdwanCertPath,
          sdwanCertPEM,
          sdwanKeyPath,
          sdwanKeyPEM,
          sdwanNodeVPNIP,
          sdwanLighthouseVPNIP,
          sdwanLighthouseAddr,
          sdwanListenHost,
          sdwanListenPort,
        },
      );
      const data = {
        ...rest,
        ...(secret && secret.trim() !== "" ? { secret: secret.trim() } : {}),
        remark: form.remark.trim(),
        groupId: form.groupId,
        extraIPs: form.extraIPs,
        remoteConfig: nextRemoteConfig,
        // 分别传递三个字段给后端
        intranetIp: intranetIp?.trim(),
        serverIpV4: serverIpV4?.trim(),
        serverIpV6: serverIpV6?.trim(),
      };
      const res = await apiCall(data);

      if (res.code === 0) {
        const savedNodeId =
          form.id || Number((res.data as { id?: number })?.id || 0);

        if (savedNodeId > 0) {
          const dnsRes = await saveNodeDNSConfig({
            nodeId: savedNodeId,
            enabled: form.dnsEnabled,
            provider: form.dnsProvider,
            domain: form.serverIpV4.trim(),
            manageA: form.dnsManageA,
            manageAAAA: form.dnsManageAAAA,
            providerConfig: {},
          });

          if (dnsRes.code !== 0) {
            toast.error(dnsRes.msg || "DNS 配置保存失败");

            return;
          }
        }
        toast.success(isEdit ? "更新成功" : "创建成功");
        if (!isEdit) {
          resetDraft();
        }
        setDialogVisible(false);
        if (isEdit) {
          setNodeList((prev) =>
            prev.map((n) =>
              n.id === form.id
                ? ({
                    ...n,
                    name: form.name,
                    remark: form.remark.trim(),
                    groupId: form.groupId,
                    intranetIp: form.intranetIp?.trim(),
                    serverIpV4: form.serverIpV4,
                    serverIpV6: form.serverIpV6,
                    port: form.port,
                    tcpListenAddr: form.tcpListenAddr,
                    udpListenAddr: form.udpListenAddr,
                    interfaceName: form.interfaceName,
                    remoteConfig: nextRemoteConfig,
                    secret: form.secret || n.secret,
                    http: form.http,
                    tls: form.tls,
                    socks: form.socks,
                    trafficRatio: form.trafficRatio,
                    expiryReminderDismissed: n.expiryReminderDismissed ?? 0,
                    expiryReminderDismissedUntil:
                      n.expiryReminderDismissedUntil ?? null,
                  } as Node)
                : n,
            ),
          );
        } else {
          loadNodes();
        }
      } else {
        toast.error(res.msg || (isEdit ? "更新失败" : "创建失败"));
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitLoading(false);
    }
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!active || !over || active.id === over.id) return;
    if (!nodeOrder || nodeOrder.length === 0) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);

    if (isNaN(activeId) || isNaN(overId)) return;
    const displayNodeIds = displayNodes.map((node) => node.id);
    const oldIndex = displayNodeIds.indexOf(activeId);
    const newIndex = displayNodeIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const reorderedDisplayIds = arrayMove(displayNodeIds, oldIndex, newIndex);
    const displayIdSet = new Set(displayNodeIds);
    let reorderedDisplayIndex = 0;
    const newOrder = nodeOrder.map((id) => {
      if (!displayIdSet.has(id)) {
        return id;
      }
      const nextId = reorderedDisplayIds[reorderedDisplayIndex];

      reorderedDisplayIndex += 1;

      return nextId;
    });

    setNodeOrder(newOrder);
    saveOrder("node-order", newOrder);
    try {
      const nodesToUpdate = newOrder.map((id, index) => ({ id, inx: index }));
      const response = await updateNodeOrder({ nodes: nodesToUpdate });

      if (response.code === 0) {
        setNodeList((prev) =>
          prev.map((node) => {
            const updated = nodesToUpdate.find((n) => n.id === node.id);

            return updated ? { ...node, inx: updated.inx } : node;
          }),
        );
      } else {
        toast.error("保存排序失败：" + (response.msg || "未知错误"));
      }
    } catch {
      toast.error("保存排序失败，请重试");
    }
  };
  const toggleSelect = (id: number) => {
    if (nodeList.find((node) => node.id === id)?.isRemote === 1) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size > 0 && !selectMode) {
        setSelectMode(true);
      }
      if (next.size === 0 && selectMode) {
        setSelectMode(false);
      }

      return next;
    });
  };
  const handleSelectAllToggle = (isSelected: boolean) => {
    if (isSelected) {
      setSelectedIds(
        new Set(
          displayNodes
            .filter((node) => node.isRemote !== 1)
            .map((node) => node.id),
        ),
      );
      if (!selectMode) {
        setSelectMode(true);
      }
    } else {
      setSelectedIds(new Set());
      setSelectMode(false);
    }
  };
  const selectAll = () => {
    setSelectedIds(
      new Set(
        displayNodes
          .filter((node) => node.isRemote !== 1)
          .map((node) => node.id),
      ),
    );
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };
  const handleBatchDelete = async () => {
    const selectedLocalIds = getSelectedLocalIds();

    if (selectedLocalIds.length === 0) return;
    setBatchLoading(true);
    try {
      const res = await batchDeleteNodes(selectedLocalIds);

      if (res.code === 0) {
        toast.success(`成功删除 ${selectedLocalIds.length} 个节点`);
        const deletedIds = new Set(selectedLocalIds);

        setNodeList((prev) => prev.filter((node) => !deletedIds.has(node.id)));
        setSelectedIds(new Set());
        setBatchDeleteModalOpen(false);
        setSelectMode(false);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBatchLoading(false);
    }
  };
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const sortedNodes = useMemo((): Node[] => {
    if (!nodeList || nodeList.length === 0) return [];
    const sortedByDb = [...nodeList].sort((a, b) => {
      const aInx = a.inx ?? 0;
      const bInx = b.inx ?? 0;

      return aInx - bInx;
    });

    if (
      nodeOrder &&
      nodeOrder.length > 0 &&
      sortedByDb.every((n) => n.inx === undefined || n.inx === 0)
    ) {
      const nodeMap = new Map(nodeList.map((n) => [n.id, n] as const));
      const localSorted: Node[] = [];

      nodeOrder.forEach((id) => {
        const node = nodeMap.get(id);

        if (node) localSorted.push(node);
      });
      nodeList.forEach((node) => {
        if (!nodeOrder.includes(node.id)) {
          localSorted.push(node);
        }
      });

      return localSorted;
    }

    return sortedByDb;
  }, [nodeList, nodeOrder]);
  const filterNodesByKeyword = useCallback((nodes: Node[], keyword: string) => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return nodes;
    }

    return nodes.filter(
      (node) =>
        (node.name && node.name.toLowerCase().includes(normalizedKeyword)) ||
        (node.remark &&
          node.remark.toLowerCase().includes(normalizedKeyword)) ||
        (node.serverIp &&
          node.serverIp.toLowerCase().includes(normalizedKeyword)) ||
        (node.serverIpV4 &&
          node.serverIpV4.toLowerCase().includes(normalizedKeyword)) ||
        (node.serverIpV6 &&
          node.serverIpV6.toLowerCase().includes(normalizedKeyword)),
    );
  }, []);
  const filteredNodes = useMemo(() => {
    const keywordFiltered = filterNodesByKeyword(
      sortedNodes,
      localSearchKeyword,
    );
    const groupFiltered =
      filterGroupId !== null
        ? keywordFiltered.filter((node) => {
            if (filterGroupId === NODE_GROUP_REMOTE) {
              return node.isRemote === 1;
            }
            if (filterGroupId === NODE_GROUP_NONE) {
              return (
                node.isRemote !== 1 && (!node.groupId || node.groupId === 0)
              );
            }

            return node.groupId === filterGroupId;
          })
        : keywordFiltered;

    if (nodeFilterMode === "all") {
      return groupFiltered;
    }

    return groupFiltered.filter((node) => {
      const expiryMeta = getNodeExpiryMeta(node.expiryTime, node.renewalCycle);

      switch (nodeFilterMode) {
        case "expiringSoon":
          return expiryMeta.state === "expiringSoon";
        case "expired":
          return expiryMeta.state === "expired";
        case "withExpiry":
          return getNodeReminderEnabled(node);
        default:
          return true;
      }
    });
  }, [
    filterNodesByKeyword,
    sortedNodes,
    localSearchKeyword,
    nodeFilterMode,
    filterGroupId,
  ]);
  const displayNodes = filteredNodes;
  const nodeExpiryStats = useMemo(() => {
    return displayNodes.reduce(
      (acc, node) => {
        const meta = getNodeExpiryMeta(node.expiryTime, node.renewalCycle);

        if (meta.state === "expired") acc.expired += 1;
        if (meta.state === "expiringSoon") acc.expiringSoon += 1;
        if (getNodeReminderEnabled(node)) {
          acc.withExpiry += 1;
        }

        return acc;
      },
      { expired: 0, expiringSoon: 0, withExpiry: 0 },
    );
  }, [displayNodes]);
  const sortableNodeIds = useMemo(
    () => displayNodes.map((node) => node.id),
    [displayNodes],
  );
  const groupedNodes = useMemo(() => {
    const groupsMap = new Map<
      number | string,
      { group: NodeGroupApiItem | null; nodes: Node[] }
    >();

    nodeGroups.forEach((g) => {
      groupsMap.set(Number(g.id), { group: g, nodes: [] });
    });
    groupsMap.set("none", { group: null, nodes: [] });
    displayNodes.forEach((node) => {
      const groupId =
        node.isRemote === 1
          ? NODE_GROUP_REMOTE
          : node.groupId && node.groupId > 0
            ? Number(node.groupId)
            : "none";

      if (groupId === NODE_GROUP_REMOTE && !groupsMap.has(NODE_GROUP_REMOTE)) {
        groupsMap.set(NODE_GROUP_REMOTE, {
          group: {
            id: NODE_GROUP_REMOTE,
            name: "远程组",
            color: "#8b5cf6",
            inx: -1,
          } as NodeGroupApiItem,
          nodes: [],
        });
      }

      if (groupsMap.has(groupId)) {
        groupsMap.get(groupId)!.nodes.push(node);
      } else {
        groupsMap.get("none")!.nodes.push(node);
      }
    });

    return Array.from(groupsMap.values()).filter((g) => g.nodes.length > 0);
  }, [displayNodes, nodeGroups]);
  const renderNodeCard = (node: Node, listeners: any) => {
    const expiryTarget =
      node.expiryInstances?.find(
        (item) =>
          item.expiryTime === node.expiryTime &&
          item.renewalCycle === node.renewalCycle,
      ) ?? node.expiryInstances?.[0];
    const expiryMeta = getNodeExpiryMeta(
      expiryTarget?.expiryTime ?? node.expiryTime,
      expiryTarget?.renewalCycle ?? node.renewalCycle,
    );
    const visualMeta = deriveNodeVisualState(
      nodeInstanceMembers[node.id],
      node.paused,
    );
    const remoteVisualMembers = (node.remoteInstances || [])
      .filter((instance) => instance.inScope)
      .map((instance) => ({
        status: instance.status ?? 0,
        weight: instance.weight ?? 1,
      }));
    const remoteVisualMeta = remoteVisualMembers.length
      ? deriveNodeVisualState(remoteVisualMembers)
      : null;
    const remoteTotalInFlow = node.totalInFlow ?? 0;
    const remoteTotalOutFlow = node.totalOutFlow ?? 0;
    const remoteTotalFlow = remoteTotalInFlow + remoteTotalOutFlow;
    const remoteOnline = node.connectionStatus === "online" && !node.syncError;
    const remoteDisplayMeta = remoteOnline ? remoteVisualMeta : null;
    const remoteDisplayState = getRemoteDisplayState(node, remoteVisualMeta);
    const remoteStatusMeta = getRemoteDisplayMeta(remoteDisplayState);
    const remoteExpiryTime =
      node.remoteExpiryTime && node.remoteExpiryTime > 0
        ? node.remoteExpiryTime < 100000000000
          ? node.remoteExpiryTime * 1000
          : node.remoteExpiryTime
        : 0;
    const remoteExpiryDays = remoteExpiryTime
      ? Math.ceil((remoteExpiryTime - Date.now()) / 86400000)
      : null;
    const remoteExpiryLabel = remoteExpiryTime
      ? new Date(remoteExpiryTime).toLocaleDateString("zh-CN")
      : "永久";
    const remoteExpiryClass =
      remoteExpiryDays === null || remoteExpiryDays > 7
        ? "bg-success-500/10 text-success-600 dark:text-success-400"
        : remoteExpiryDays <= 0
          ? "bg-danger-500/10 text-danger-600 dark:text-danger-400"
          : "bg-warning-500/10 text-warning-600 dark:text-warning-400";
    const hasRemark = Boolean(node.remark?.trim());
    const hasExpiryInfo = Boolean(
      node.isRemote !== 1 &&
        expiryTarget?.expiryTime &&
        expiryTarget.expiryTime > 0 &&
        expiryTarget.renewalCycle &&
        (expiryTarget.expiryReminderDismissed !== 1 ||
          (expiryTarget.expiryReminderDismissedUntil &&
            expiryTarget.expiryReminderDismissedUntil < Date.now())),
    );
    const hasInfoTrigger = hasRemark || hasExpiryInfo;
    const infoPlacement = infoPopoverPlacement[node.id] ?? "left";

    return (
      <Card
        key={node.id}
        className={`group relative overflow-visible shadow-sm border border-divider hover:shadow-md transition-shadow duration-200 h-full flex flex-col ${
          node.expiryReminderDismissed ? "" : expiryMeta.accentClassName
        }`}
        data-node-card="true"
      >
        <CardHeader className="pb-3 md:pb-3">
          <div className="flex flex-col gap-2 w-full">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {node.isRemote !== 1 && (
                  <Checkbox
                    isSelected={selectedIds.has(node.id)}
                    onValueChange={() => toggleSelect(node.id)}
                  />
                )}
                <div
                  className="cursor-grab active:cursor-grabbing p-1 text-default-400 hover:text-default-600 transition-colors"
                  {...listeners}
                  style={{ touchAction: "none" }}
                  title="拖拽排序"
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
                {/* WGM 状态 */}
                {node.mimicStatus === "ok" ||
                node.mimicStatus === "deps_ready" ? (
                  <span className="text-green-500 text-sm" title="WGM 就绪">
                    ✅
                  </span>
                ) : node.mimicStatus ? (
                  <span
                    className="text-red-500 text-sm cursor-help"
                    title={node.mimicError || "WGM 未就绪"}
                  >
                    ❌
                  </span>
                ) : null}
              </div>
              {node.isRemote === 1 ? (
                <div className="flex-shrink-0 inline-flex items-center justify-center rounded bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
                  远程组
                </div>
              ) : node.groupId && node.groupId > 0 ? (
                (() => {
                  const group = (nodeGroups || []).find(
                    (g: any) => Number(g.id) === Number(node.groupId),
                  );

                  return group ? (
                    <div
                      className="flex-shrink-0 inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${group.color}1A`,
                        color: group.color,
                      }}
                    >
                      {group.name}
                    </div>
                  ) : (
                    <div className="flex-shrink-0 inline-flex items-center justify-center bg-default-500/10 text-default-500 px-2 py-0.5 rounded text-xs font-medium">
                      未分组
                    </div>
                  );
                })()
              ) : (
                <div className="flex-shrink-0 inline-flex items-center justify-center bg-default-500/10 text-default-500 px-2 py-0.5 rounded text-xs font-medium">
                  未分组
                </div>
              )}
              <div className="flex-shrink-0">
                {hasInfoTrigger && (
                  <div className="relative">
                    <button
                      aria-label="查看节点信息"
                      className={`relative flex h-7 w-7 items-center justify-center rounded-full border border-divider/80 bg-background/95 text-default-500 shadow-sm transition hover:border-default-300 hover:text-foreground focus-visible:border-default-300 focus-visible:text-foreground focus-visible:outline-none ${infoPopoverOpenId === node.id ? "border-default-300 text-foreground" : ""}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateInfoPopoverPlacement(node.id, null);
                        setInfoPopoverOpenId(
                          infoPopoverOpenId === node.id ? null : node.id,
                        );
                      }}
                      onFocus={(event) =>
                        updateInfoPopoverPlacement(node.id, event.currentTarget)
                      }
                      onMouseEnter={(event) =>
                        updateInfoPopoverPlacement(node.id, event.currentTarget)
                      }
                    >
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                        />
                      </svg>
                      {hasRemark && (
                        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5 rounded-full border border-background bg-red-300 shadow-sm dark:bg-default-500" />
                      )}
                    </button>

                    {/* 👇 核心魔法：直接让【有内容的窄胶囊】当外壳，彻底消灭那个【没内容的宽空壳】！ */}
                    <div
                      className={`absolute z-[60] w-auto whitespace-nowrap flex items-center gap-4 rounded-xl border border-divider/80 bg-background/98 p-2 pl-3 shadow-xl backdrop-blur transition-all duration-150 ${infoPopoverOpenId === node.id ? "visible opacity-100 pointer-events-auto" : "invisible opacity-0 pointer-events-none"} ${infoPlacement === "bottom" ? "right-0 top-[calc(100%+0.75rem)] translate-y-1" : "right-[calc(100%+0.75rem)] top-1/2 -translate-y-1/2 translate-x-1"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                      }}
                    >
                      {hasExpiryInfo && (
                        <>
                          <span className="text-xs font-medium text-default-700 tracking-wide">
                            {formatNodeRenewalTime(expiryMeta.nextDueTime)}
                          </span>
                          <button
                            className="inline-flex items-center justify-center text-[12px] font-medium px-3 py-1.5 rounded-md bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition-colors active:scale-95"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.nativeEvent.stopImmediatePropagation();
                              handleDismissExpiryReminder?.(
                                node.id,
                                expiryTarget?.instanceId,
                              );
                              setInfoPopoverOpenId(null);
                            }}
                          >
                            更新周期
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {node.isRemote === 1 ? (
                <div
                  className="flex items-center gap-0.5"
                  title={
                    remoteDisplayState === "online" && remoteDisplayMeta
                      ? `在线${remoteDisplayMeta.onlineCount}/禁用${remoteDisplayMeta.disabledCount}/全部${remoteDisplayMeta.totalCount}`
                      : remoteStatusMeta.label
                  }
                >
                  <StatusDot
                    active={remoteDisplayState === "online"}
                    tone={remoteStatusMeta.tone}
                  />
                  <span className="text-xs font-mono tabular-nums text-default-500">
                    {remoteDisplayState === "online" && remoteDisplayMeta
                      ? `${remoteDisplayMeta.onlineCount}/${remoteDisplayMeta.disabledCount}/${remoteDisplayMeta.totalCount}`
                      : remoteStatusMeta.label}
                  </span>
                </div>
              ) : (
                <div
                  className="flex items-center gap-0.5"
                  title={`在线${visualMeta.onlineCount}/禁用${visualMeta.disabledCount}/全部${visualMeta.totalCount}`}
                >
                  <StatusDot
                    active={visualMeta.state !== "offline"}
                    tone={visualMeta.color}
                  />
                  <span className="text-xs font-mono tabular-nums text-default-500">
                    {visualMeta.onlineCount}/{visualMeta.disabledCount}/
                    {visualMeta.totalCount}
                  </span>
                </div>
              )}
              <h3
                className="font-semibold text-foreground truncate text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                title={node.name}
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(node.name, "节点名称");
                }}
              >
                {node.name}
              </h3>
            </div>
          </div>
        </CardHeader>
        <CardBody className="pt-0 pb-3 md:pt-0 md:pb-3">
          <div className="space-y-2 mb-4">
            {node.expiryTime && node.expiryTime > 0 && node.renewalCycle && (
              <div className="hidden" />
            )}
            <div className="space-y-1.5 border-b border-divider/50 pb-2 mb-2">
              <div className="flex justify-between items-center min-w-0">
                <span className="text-default-500 text-xs flex-shrink-0 mr-2">
                  地址
                </span>
                {(() => {
                  const address =
                    node.serverIpV4?.trim() ||
                    node.intranetIp?.trim() ||
                    node.serverIpV6?.trim() ||
                    (node.serverIp?.trim() && node.serverIp.includes(":")
                      ? node.serverIp.trim()
                      : "");

                  return address ? (
                    <button
                      className="min-w-0 max-w-[180px] truncate rounded px-1 text-right text-sm font-medium transition-colors hover:bg-default-200/50 hover:text-primary"
                      title={address}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        copyToClipboard(address, "节点地址");
                      }}
                    >
                      {formatNodeAddressForCell(address)}
                    </button>
                  ) : (
                    <span className="text-sm text-default-300">暂无</span>
                  );
                })()}
              </div>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-default-600">版本</span>
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
                <span className="font-medium text-sm text-default-600">
                  {node.version ? node.version.split(" ")[0] : "未知"}
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-default-600">节点倍率</span>
              <span className="font-medium text-sm text-default-700">
                {(node.trafficRatio || 1).toFixed(2).replace(/\.00$/, "")}x
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-default-600">周期流量</span>
              <span className="font-medium text-sm text-danger-600 dark:text-danger-400">
                {node.isRemote === 1
                  ? formatTraffic(remoteTotalFlow)
                  : realtimeNodeMetrics[node.id]
                    ? formatTraffic(
                        (realtimeNodeMetrics[node.id]?.periodTraffic?.rx ?? 0) +
                          (realtimeNodeMetrics[node.id]?.periodTraffic?.tx ??
                            0),
                      )
                    : "-"}
              </span>
            </div>
            {node.isRemote === 1 ? (
              <div className="text-xs text-default-500 space-y-0.5 mt-1">
                <div className="flex justify-between items-center">
                  <span>↑ 上行</span>
                  <span className="font-medium text-success-600 dark:text-success-400">
                    {formatTraffic(remoteTotalOutFlow)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>↓ 下行</span>
                  <span className="font-medium text-primary-600 dark:text-primary-400">
                    {formatTraffic(remoteTotalInFlow)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>流量限额</span>
                  <span className="font-medium">
                    {node.remoteMaxBandwidth && node.remoteMaxBandwidth > 0
                      ? formatTraffic(node.remoteMaxBandwidth)
                      : "不限"}
                  </span>
                </div>
                <div
                  className={`mt-1 inline-flex rounded-lg px-2.5 py-1 ${remoteExpiryClass}`}
                >
                  {remoteExpiryLabel}
                </div>
              </div>
            ) : (
              realtimeNodeMetrics[node.id]?.periodTraffic && (
                <div className="text-xs text-default-500 space-y-0.5 mt-1">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span>↑ 上行</span>
                      <span className="font-medium text-success-600 dark:text-success-400">
                        {formatTraffic(
                          realtimeNodeMetrics[node.id]?.periodTraffic?.tx ?? 0,
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>↓ 下行</span>
                      <span className="font-medium text-primary-600 dark:text-primary-400">
                        {formatTraffic(
                          realtimeNodeMetrics[node.id]?.periodTraffic?.rx ?? 0,
                        )}
                      </span>
                    </div>
                  </div>
                  {(() => {
                    const pt = realtimeNodeMetrics[node.id]?.periodTraffic;

                    if (!pt) return null;

                    // 智能解析后端时间
                    const parseBackendTime = (ts: any) => {
                      if (!ts) return 0;
                      let num = Number(ts);

                      if (isNaN(num)) return 0;
                      if (Math.abs(num) < 100000000000) num *= 1000;

                      return num > 0 && new Date(num).getFullYear() > 1970
                        ? num
                        : 0;
                    };

                    const backendSince = parseBackendTime(pt.since);
                    const backendNext = parseBackendTime(pt.nextReset);
                    const displayNext =
                      backendNext > 0 ? backendNext : expiryMeta?.nextDueTime;

                    // 核心修改：精准干掉时分秒，只保留年月日 (YYYY/M/D)
                    const formatDateOnly = (ts: any) => {
                      if (!ts) return "-";
                      const d = new Date(ts);

                      return (
                        d.getFullYear() +
                        "/" +
                        (d.getMonth() + 1) +
                        "/" +
                        d.getDate()
                      );
                    };

                    if (!backendSince && !displayNext) return null;

                    return (
                      <div className="flex justify-between items-center mt-1">
                        {backendSince > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span>周期始于</span>
                            <span className="font-medium text-foreground">
                              {formatDateOnly(backendSince)}
                            </span>
                          </div>
                        ) : (
                          <div />
                        )}
                        {displayNext && displayNext > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span>下次归零</span>
                            <span className="font-medium text-primary">
                              {formatDateOnly(displayNext)}
                            </span>
                          </div>
                        ) : (
                          <div />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )
            )}
            {upgradeProgress[node.id] &&
              upgradeProgress[node.id].percent < 100 && (
                <div className="mt-1">
                  <Progress
                    showValueLabel
                    aria-label="升级进度"
                    color="warning"
                    label={upgradeProgress[node.id].message}
                    size="sm"
                    value={upgradeProgress[node.id].percent}
                  />
                </div>
              )}
          </div>
          <div className="space-y-3">
            {node.isRemote === 1 ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  color="secondary"
                  size="sm"
                  variant="flat"
                  onPress={() => setRemoteDetailNode(node)}
                >
                  详情
                </Button>
                <Button
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={() => handleDelete(node)}
                >
                  删除
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-2 grid-cols-3">
                  <div className="w-full">
                    <Dropdown>
                      <DropdownTrigger>
                        <Button
                          className="min-h-8 w-full"
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
                  </div>
                  <Button
                    className="min-h-8 w-full"
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
                    className="min-h-8 w-full"
                    color={shareCounts[node.id] ? "success" : "default"}
                    size="sm"
                    variant="flat"
                    onPress={() => void openNodeSharing(node)}
                  >
                    分享
                  </Button>
                </div>
                <div className="grid gap-2 grid-cols-4">
                  <Button
                    className="min-h-8 w-full"
                    color="primary"
                    size="sm"
                    variant="flat"
                    onPress={() => handleEdit(node)}
                  >
                    编辑
                  </Button>
                  <Button
                    className="min-h-8 w-full"
                    color="success"
                    size="sm"
                    variant="flat"
                    onPress={() => handleResetNodeTraffic(node)}
                  >
                    归零
                  </Button>
                  <Button
                    className="min-h-8 w-full"
                    color={node.paused ? "success" : "warning"}
                    size="sm"
                    variant="flat"
                    onPress={() => handleTogglePause(node)}
                  >
                    {node.paused ? "启用" : "暂停"}
                  </Button>
                  <Button
                    className="min-h-8 w-full"
                    color="danger"
                    size="sm"
                    variant="flat"
                    onPress={() => handleDelete(node)}
                  >
                    删除
                  </Button>
                </div>
              </>
            )}
          </div>
          {/* 备注和到期提醒 */}
          {(node.remark?.trim() || hasExpiryInfo) && (
            <div className="mt-2 pt-2 border-t border-divider flex items-center min-w-0">
              {node.remark?.trim() && (
                <div className="flex items-center text-xs text-default-500 min-w-0 mr-2">
                  <span className="font-medium text-red-500 flex-shrink-0">
                    备注：
                  </span>
                  <span
                    className="truncate ml-1 text-xs cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
                    title={node.remark.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(node.remark!.trim(), "备注");
                    }}
                  >
                    {node.remark.trim()}
                  </span>
                </div>
              )}

              {hasExpiryInfo && (
                <div className="flex items-center text-xs ml-auto flex-shrink-0">
                  <span
                    className={`text-[10px] py-0.5 px-1.5 rounded font-medium ${
                      expiryMeta.tone === "danger"
                        ? "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                        : expiryMeta.tone === "warning"
                          ? "bg-warning-500/10 text-warning-600 dark:text-warning-400"
                          : expiryMeta.tone === "success"
                            ? "bg-success-500/10 text-success-600 dark:text-success-400"
                            : "bg-default-500/10 text-default-500"
                    }`}
                  >
                    {expiryMeta.label}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    );
  };

  return (
    <MonitorTerminalProvider>
      <AnimatedPage className="px-3 lg:px-6 py-8">
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap items-center gap-3 pb-1">
            <div className="flex items-center gap-2">
              <SearchBar
                isVisible={isSearchVisible}
                placeholder="节点名称或 IP"
                value={localSearchKeyword}
                onChange={setLocalSearchKeyword}
                onClose={() => setIsSearchVisible(false)}
                onOpen={() => {
                  setIsSearchVisible(true);
                  setTimeout(() => {
                    const searchInput = document.querySelector(
                      'input[placeholder*="搜索"]',
                    );

                    if (searchInput) (searchInput as HTMLElement).focus();
                  }, 150);
                }}
              />
            </div>
            <div className="flex min-h-8 flex-wrap items-center gap-2">
              {selectMode ? (
                <>
                  <Button
                    color="primary"
                    size="sm"
                    variant="flat"
                    onPress={selectAll}
                  >
                    全选
                  </Button>
                  <Button
                    color="secondary"
                    size="sm"
                    variant="flat"
                    onPress={deselectAll}
                  >
                    清空
                  </Button>
                  <Button
                    className="bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:hover:bg-violet-900/45"
                    isDisabled={selectedIds.size === 0}
                    isLoading={batchSDWANLoading}
                    size="sm"
                    variant="flat"
                    onPress={handleBatchBootstrapSDWAN}
                  >
                    组网
                  </Button>
                  <Button
                    className="bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/45"
                    isDisabled={selectedIds.size === 0}
                    isLoading={batchMimicLoading}
                    size="sm"
                    variant="flat"
                    onPress={() =>
                      requestMimicDepsInstall(
                        nodeList.filter(
                          (node) =>
                            selectedIds.has(node.id) && node.isRemote !== 1,
                        ),
                      )
                    }
                  >
                    WGM
                  </Button>
                  <Button
                    color="warning"
                    isDisabled={selectedIds.size === 0}
                    isLoading={batchUpgradeLoading}
                    size="sm"
                    variant="flat"
                    onPress={() => openUpgradeModal("batch")}
                  >
                    更新
                  </Button>
                  <Button
                    color="success"
                    isDisabled={selectedIds.size === 0}
                    size="sm"
                    variant="flat"
                    onPress={() => setBatchResetTrafficModalOpen(true)}
                  >
                    归零
                  </Button>
                  <Button
                    color="danger"
                    isDisabled={selectedIds.size === 0}
                    size="sm"
                    variant="flat"
                    onPress={() => setBatchDeleteModalOpen(true)}
                  >
                    删除
                  </Button>
                  <span className="text-sm text-danger-400 shrink-0">
                    已选 {selectedIds.size} 项
                  </span>
                </>
              ) : (
                <>
                  {/* 卡片视图切换按钮 */}
                  <Button
                    color={
                      viewMode === "grid"
                        ? "primary"
                        : viewMode === "list"
                          ? "warning"
                          : "secondary"
                    }
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      // 当前是分组 (grouped) -> 切换到列表 (list)
                      // 当前是列表 (list) -> 切换到卡片 (grid)
                      // 当前是卡片 (grid) -> 切换到分组 (grouped)
                      if (viewMode === "grouped") setViewMode("list");
                      else if (viewMode === "list") setViewMode("grid");
                      else setViewMode("grouped");
                    }}
                  >
                    {/* 按钮显示的是"下一个要切换到的视图"的名称 */}
                    {viewMode === "grouped"
                      ? "分组"
                      : viewMode === "list"
                        ? "列表"
                        : "卡片"}
                  </Button>
                  {/* 分组管理按钮 */}
                  <Button
                    className="bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/45"
                    size="sm"
                    variant="flat"
                    onPress={() => setGroupManagerOpen(true)}
                  >
                    分组
                  </Button>
                  {/* 新增按钮 */}
                  <Button
                    color="success"
                    size="sm"
                    variant="flat"
                    onPress={() => openDNSFailoverPicker()}
                  >
                    DNS
                  </Button>
                  {/* 新增按钮 */}
                  <Button
                    color="secondary"
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      setImportPrefillUrl("");
                      setImportPrefillToken("");
                      setImportNodeOpen(true);
                    }}
                  >
                    远程
                    {peerShareNotifications.length > 0 && (
                      <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                        {peerShareNotifications.length}
                      </span>
                    )}
                  </Button>
                  <Button
                    color="primary"
                    size="sm"
                    variant="flat"
                    onPress={handleAdd}
                  >
                    新增
                  </Button>
                  {(nodeFilterMode !== "all" ||
                    filterGroupId !== null ||
                    localSearchKeyword.trim()) && (
                    <Button
                      color="warning"
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        resetNodeFilterMode();
                        setFilterGroupId(null);
                        setLocalSearchKeyword("");
                      }}
                    >
                      重置
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <NodeGroupManager
          isOpen={groupManagerOpen}
          onGroupChange={() => {
            loadNodeGroups();
            loadNodes({ silent: true });
          }}
          onOpenChange={setGroupManagerOpen}
        />
        {!wsConnected && (
          <Alert
            className="mb-4"
            color="warning"
            description={
              wsConnecting
                ? "监控连接中..."
                : usingPollingFallback
                  ? "监控连接已断开，已切换为列表自动刷新兜底模式。"
                  : "监控连接已断开，正在重连..."
            }
            variant="flat"
          />
        )}
        {loading ? (
          <PageLoadingState message="正在加载..." />
        ) : nodeList.length === 0 ? (
          <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
            <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
              <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
                暂无节点配置
              </h3>
              <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
                还没有任何节点配置，点击新增按钮开始创建
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            {viewMode === "grid" &&
              (displayNodes.length === 0 ? (
                <Card className="shadow-sm border border-divider bg-content1">
                  <CardBody className="py-16 flex flex-col items-center justify-center min-h-[200px]">
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
                        setNodeFilterMode("all");
                        setLocalSearchKeyword("");
                      }}
                    >
                      归零筛选
                    </Button>
                  </CardBody>
                </Card>
              ) : (
                <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
                  <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
                    <span className="text-sm font-semibold text-foreground">
                      节点数量
                    </span>
                    <span className="text-xs text-default-500">
                      {displayNodes.length} 个节点
                    </span>
                  </div>
                  <div className="p-4">
                    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                      <SortableContext
                        items={sortableNodeIds}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                          {displayNodes.map((node) => (
                            <SortableItem key={node.id} id={node.id}>
                              {(listeners) => renderNodeCard(node, listeners)}
                            </SortableItem>
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                </div>
              ))}
            {viewMode === "grouped" &&
              (groupedNodes.length === 0 ? (
                <Card className="shadow-sm border border-divider bg-content1">
                  <CardBody className="py-16 flex flex-col items-center justify-center min-h-[200px]">
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
                        setNodeFilterMode("all");
                        setLocalSearchKeyword("");
                      }}
                    >
                      归零筛选
                    </Button>
                  </CardBody>
                </Card>
              ) : (
                <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
                  <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
                    <span className="text-sm font-semibold text-foreground">
                      节点数量
                    </span>
                    <span className="text-xs text-default-500">
                      {displayNodes.length} 个节点
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="space-y-4">
                      {groupedNodes.map(({ group, nodes }) => {
                        const groupSortableIds = nodes.map((n) => n.id);
                        const groupIdStr = String(group ? group.id : "none");
                        const isCollapsed = collapsedGroups[groupIdStr];

                        return (
                          <div
                            key={groupIdStr}
                            className="overflow-hidden rounded-xl border border-divider/60 bg-content1/80 backdrop-blur shadow-sm hover:shadow-md transition-shadow duration-200"
                          >
                            <div
                              className="flex items-center justify-between border-b border-divider bg-default-100/50 hover:bg-default-200/30 px-4 py-2.5 cursor-pointer select-none transition-colors"
                              onClick={() => {
                                setCollapsedGroups((prev) => ({
                                  ...prev,
                                  [groupIdStr]: !prev[groupIdStr],
                                }));
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Button
                                  isIconOnly
                                  className="h-7 w-7 min-w-7 pointer-events-none -ml-1"
                                  size="sm"
                                  variant="flat"
                                >
                                  <svg
                                    aria-hidden="true"
                                    className={`h-4 w-4 transition-transform ${isCollapsed ? "-rotate-90" : "rotate-0"}`}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="m6 9 6 6 6-6" />
                                  </svg>
                                </Button>
                                {group ? (
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-3 h-3 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: group.color }}
                                    />
                                    <span className="truncate text-sm font-semibold text-foreground">
                                      {group.name}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 ml-1">
                                    <div className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0" />
                                    <span className="truncate text-sm font-semibold text-foreground">
                                      未分组
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-default-600">
                                  {nodes.length} 个节点
                                </span>
                              </div>
                            </div>
                            {!isCollapsed && (
                              <div className="">
                                <DndContext
                                  collisionDetection={pointerWithin}
                                  sensors={sensors}
                                  onDragEnd={handleDragEnd}
                                >
                                  <SortableContext
                                    items={groupSortableIds}
                                    strategy={rectSortingStrategy}
                                  >
                                    <div className="overflow-x-auto">
                                      <NodeListView
                                        copyToClipboard={copyToClipboard}
                                        displayNodes={nodes}
                                        filterGroupId={filterGroupId}
                                        formatTraffic={formatTraffic}
                                        handleCopyAutoInstallCommand={
                                          handleCopyDomesticInstallCommand
                                        }
                                        handleCopyOfflineInstallCommand={
                                          handleCopyOfflineInstallCommand
                                        }
                                        handleCopyOverseasInstallCommand={
                                          handleCopyOverseasInstallCommand
                                        }
                                        handleDelete={handleDelete}
                                        handleDismissExpiryReminder={
                                          handleDismissExpiryReminder
                                        }
                                        handleEdit={handleEdit}
                                        handleResetNodeTraffic={
                                          handleResetNodeTraffic
                                        }
                                        handleTogglePause={handleTogglePause}
                                        handleViewNodeTrafficLogs={
                                          handleViewNodeTrafficLogs
                                        }
                                        nodeExpiryStats={nodeExpiryStats}
                                        nodeFilterMode={nodeFilterMode}
                                        nodeGroups={nodeGroups}
                                        nodeInstanceMembers={
                                          nodeInstanceMembers
                                        }
                                        openInstallSelector={
                                          openInstallSelector
                                        }
                                        openUpgradeModal={openUpgradeModal}
                                        realtimeNodeInstanceMetrics={
                                          realtimeNodeInstanceMetrics
                                        }
                                        realtimeNodeMetrics={
                                          realtimeNodeMetrics
                                        }
                                        remoteUsageByNode={remoteUsageByNode}
                                        selectedIds={selectedIds}
                                        setFilterGroupId={setFilterGroupId}
                                        setNodeFilterMode={setNodeFilterMode}
                                        shareCounts={shareCounts}
                                        toggleSelect={toggleSelect}
                                        toggleSelectAll={(
                                          isSelected: boolean,
                                        ) => {
                                          if (isSelected) {
                                            setSelectedIds(
                                              (prev) =>
                                                new Set([
                                                  ...prev,
                                                  ...nodes
                                                    .filter(
                                                      (n) => n.isRemote !== 1,
                                                    )
                                                    .map((n) => n.id),
                                                ]),
                                            );
                                            if (!selectMode)
                                              setSelectMode(true);
                                          } else {
                                            setSelectedIds((prev) => {
                                              const next = new Set(prev);

                                              nodes.forEach((n) =>
                                                next.delete(n.id),
                                              );
                                              if (next.size === 0)
                                                setSelectMode(false);

                                              return next;
                                            });
                                          }
                                        }}
                                        upgradeProgress={upgradeProgress}
                                        onConfigureInstance={
                                          openInstanceConfigEditor
                                        }
                                        onDeleteInstance={
                                          setInstanceDeleteTarget
                                        }
                                        onInstallMimicDeps={(node) =>
                                          requestMimicDepsInstall([node])
                                        }
                                        onReorderInstances={
                                          reorderNodeInstances
                                        }
                                        onResetInstanceTraffic={
                                          setInstanceResetTarget
                                        }
                                        onShareNode={(node) =>
                                          void openNodeSharing(node)
                                        }
                                        onToggleInstancePause={
                                          handleToggleInstancePause
                                        }
                                        onViewRemoteDetail={setRemoteDetailNode}
                                      />
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            {viewMode === "list" && (
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={sortableNodeIds}
                  strategy={rectSortingStrategy}
                >
                  <NodeListView
                    copyToClipboard={copyToClipboard}
                    displayNodes={displayNodes}
                    filterGroupId={filterGroupId}
                    formatTraffic={formatTraffic}
                    handleCopyAutoInstallCommand={
                      handleCopyDomesticInstallCommand
                    }
                    handleCopyOfflineInstallCommand={
                      handleCopyOfflineInstallCommand
                    }
                    handleCopyOverseasInstallCommand={
                      handleCopyOverseasInstallCommand
                    }
                    handleDelete={handleDelete}
                    handleDismissExpiryReminder={handleDismissExpiryReminder}
                    handleEdit={handleEdit}
                    handleResetNodeTraffic={handleResetNodeTraffic}
                    handleTogglePause={handleTogglePause}
                    handleViewNodeTrafficLogs={handleViewNodeTrafficLogs}
                    nodeExpiryStats={nodeExpiryStats}
                    nodeFilterMode={nodeFilterMode}
                    nodeGroups={nodeGroups}
                    nodeInstanceMembers={nodeInstanceMembers}
                    openInstallSelector={openInstallSelector}
                    openUpgradeModal={openUpgradeModal}
                    realtimeNodeInstanceMetrics={realtimeNodeInstanceMetrics}
                    realtimeNodeMetrics={realtimeNodeMetrics}
                    remoteUsageByNode={remoteUsageByNode}
                    selectedIds={selectedIds}
                    setFilterGroupId={setFilterGroupId}
                    setNodeFilterMode={setNodeFilterMode}
                    shareCounts={shareCounts}
                    toggleSelect={toggleSelect}
                    toggleSelectAll={handleSelectAllToggle}
                    upgradeProgress={upgradeProgress}
                    onConfigureInstance={openInstanceConfigEditor}
                    onDeleteInstance={setInstanceDeleteTarget}
                    onInstallMimicDeps={(node) =>
                      requestMimicDepsInstall([node])
                    }
                    onReorderInstances={reorderNodeInstances}
                    onResetInstanceTraffic={setInstanceResetTarget}
                    onShareNode={(node) => void openNodeSharing(node)}
                    onToggleInstancePause={handleToggleInstancePause}
                    onViewRemoteDetail={setRemoteDetailNode}
                  />
                </SortableContext>
              </DndContext>
            )}
          </>
        )}
        {/* 新增/编辑节点对话框 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isDismissable={false}
          isOpen={dialogVisible}
          placement="center"
          scrollBehavior="inside"
          size="lg"
          onOpenChange={(open) => {
            if (!open && !isEdit) resetDraft();
            setDialogVisible(open);
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>{dialogTitle}</ModalHeader>
                <ModalBody>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        description=""
                        errorMessage={errors.name}
                        isInvalid={!!errors.name}
                        label="节点名称"
                        placeholder="请输入节点名称"
                        value={form.name}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                      <Textarea
                        classNames={{
                          inputWrapper: "!min-h-[20px] py-1.5",
                          input: "!min-h-[20px]",
                        }}
                        description=""
                        label="备注"
                        placeholder="例如: 搬瓦工年付，日本中转"
                        rows={1}
                        value={form.remark}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            remark: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div className="md:col-span-1">
                        <Select
                          description=""
                          label="分组"
                          placeholder="选择分组"
                          selectedKeys={
                            form.groupId && form.groupId > 0
                              ? [String(form.groupId)]
                              : []
                          }
                          variant="bordered"
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as
                              | string
                              | undefined;

                            setForm((prev) => ({
                              ...prev,
                              groupId:
                                selected && selected !== ""
                                  ? parseInt(selected)
                                  : null,
                            }));
                          }}
                        >
                          <SelectItem key="" textValue="未分组">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full bg-gray-300" />
                              <span>未分组</span>
                            </div>
                          </SelectItem>
                          {nodeGroups.map((group) => (
                            <SelectItem key={group.id} textValue={group.name}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: group.color }}
                                />
                                <span>{group.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </Select>
                      </div>
                      <div className="md:col-span-1">
                        <Input
                          description=""
                          errorMessage={errors.trafficRatio}
                          isInvalid={!!errors.trafficRatio}
                          label="节点倍率"
                          min={0.01}
                          placeholder="1"
                          step="0.01"
                          type="number"
                          value={String(form.trafficRatio)}
                          variant="bordered"
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              trafficRatio: parseFloat(e.target.value) || 0,
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-2">
                        <FieldContainer description="" label="密钥">
                          <div className="flex items-center gap-2">
                            <BaseInput
                              className="flex-1"
                              placeholder="留空自动生成或输入密钥"
                              value={form.secret}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  secret: e.target.value,
                                }))
                              }
                            />
                            <Button
                              color="primary"
                              size="sm"
                              variant="flat"
                              onClick={handleRegenerateSecret}
                            >
                              随机生成
                            </Button>
                          </div>
                        </FieldContainer>
                      </div>
                    </div>
                    <Accordion variant="bordered">
                      <AccordionItem
                        key="dns-failover"
                        aria-label="DNS 容灾设置"
                        title={
                          <div className="flex w-full items-center justify-between gap-3">
                            <span>DNS 容灾设置</span>
                            <span
                              aria-disabled={
                                !form.id || !form.dnsEnabled || dnsSyncLoading
                              }
                              className={`rounded-md px-2.5 py-1 text-xs font-medium ${!form.id || !form.dnsEnabled || dnsSyncLoading ? "cursor-not-allowed text-default-400" : "cursor-pointer text-primary hover:bg-primary-100/70"}`}
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (
                                  !form.id ||
                                  !form.dnsEnabled ||
                                  dnsSyncLoading
                                )
                                  return;
                                void handleManualDNSSync(event);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ")
                                  return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (
                                  !form.id ||
                                  !form.dnsEnabled ||
                                  dnsSyncLoading
                                )
                                  return;
                                void handleManualDNSSync(event);
                              }}
                            >
                              {dnsSyncLoading ? "同步中" : "手动同步"}
                            </span>
                          </div>
                        }
                      >
                        <div className="space-y-3 px-[12px] pb-2">
                          {/* 移动端 2 列 (grid-cols-2)，中等及以上屏幕 4 列 (md:grid-cols-4) */}
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                            <Checkbox
                              isDisabled={!dnsProviderAvailability.aliyun}
                              isSelected={form.dnsProvider === "aliyun"}
                              onValueChange={(selected) => {
                                if (selected)
                                  setForm((prev) => ({
                                    ...prev,
                                    dnsProvider: "aliyun",
                                  }));
                              }}
                            >
                              {/* 核心护盾：绝对不许换行 */}
                              <span className="whitespace-nowrap">阿里云</span>
                            </Checkbox>

                            <Checkbox
                              isDisabled={!dnsProviderAvailability.cloudflare}
                              isSelected={form.dnsProvider === "cloudflare"}
                              onValueChange={(selected) => {
                                if (selected)
                                  setForm((prev) => ({
                                    ...prev,
                                    dnsProvider: "cloudflare",
                                  }));
                              }}
                            >
                              <span className="whitespace-nowrap">
                                Cloudflare
                              </span>
                            </Checkbox>

                            <Checkbox
                              isSelected={form.dnsManageA}
                              onValueChange={(dnsManageA) =>
                                setForm((prev) => ({ ...prev, dnsManageA }))
                              }
                            >
                              <span className="whitespace-nowrap">管理V4</span>
                            </Checkbox>

                            <Checkbox
                              isSelected={form.dnsManageAAAA}
                              onValueChange={(dnsManageAAAA) =>
                                setForm((prev) => ({ ...prev, dnsManageAAAA }))
                              }
                            >
                              <span className="whitespace-nowrap">管理V6</span>
                            </Checkbox>
                          </div>
                          <div className="text-sm text-default-700">
                            启用/关闭 DNS 容灾
                          </div>
                          <Checkbox
                            isSelected={form.dnsEnabled}
                            onValueChange={(dnsEnabled) =>
                              setForm((prev) => ({ ...prev, dnsEnabled }))
                            }
                          >
                            DNS容灾
                          </Checkbox>
                          <div className="text-xs text-warning-800">
                            DNS 记录名默认使用“域名/公网 IPv4 地址”，启用 DNS
                            容灾时必须填写域名，不能填写 IP 地址
                          </div>
                        </div>
                      </AccordionItem>
                    </Accordion>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        description="可选：可留空，实例公网 IP 由 agent 自动上报"
                        errorMessage={errors.serverIpV4}
                        isInvalid={!!errors.serverIpV4}
                        label="域名/公网IPv4地址"
                        placeholder="例如：test.example.com 8.8.8.8"
                        value={form.serverIpV4}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            serverIpV4: e.target.value,
                          }))
                        }
                      />
                      <Input
                        classNames={{
                          input: "font-medium",
                        }}
                        description="可选：单端口、多端口、端口范围，留空用默认值"
                        errorMessage={errors.port}
                        isInvalid={!!errors.port}
                        label="可用端口"
                        placeholder="多端口逗号分隔，默认值10000-65535"
                        value={form.port}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, port: e.target.value }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        description="可选：建议填写内网IPv4或对应解析域名，可留空"
                        errorMessage={errors.intranetIp}
                        isInvalid={!!errors.intranetIp}
                        label="域名/内网IPv4地址"
                        placeholder="例如：10.0.0.1 192.168.1.1"
                        value={form.intranetIp}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            intranetIp: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="可选：可留空，实例公网 IP 由 agent 自动上报"
                        errorMessage={errors.serverIpV6}
                        isInvalid={!!errors.serverIpV6}
                        label="域名/公网IPv6地址"
                        placeholder="例如：2001:db8::10"
                        value={form.serverIpV6}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            serverIpV6: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                      <span className="text-xs text-warning-800">
                        多实例出口节点可以不填 IP，监控和权重使用各个 agent
                        自动上报的实例公网 IP 地址
                      </span>
                    </div>
                    <Accordion variant="bordered">
                      <AccordionItem
                        key="advanced"
                        aria-label="高级配置"
                        title="高级配置"
                      >
                        <div className="space-y-4 pb-2 px-[12px]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                              description="用于多IP主机指定使用哪个 IP 请求远程地址，不懂的默认为空就行"
                              errorMessage={errors.interfaceName}
                              isInvalid={!!errors.interfaceName}
                              label="出口网卡名或IP"
                              placeholder="请输入出口网卡名或IP"
                              value={form.interfaceName}
                              variant="bordered"
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  interfaceName: e.target.value,
                                }))
                              }
                            />
                            <Input
                              description="多IP主机可填写额外IP地址，逗号分隔"
                              label="额外IP地址"
                              placeholder="例如: 192.168.1.100, 10.0.0.5"
                              value={form.extraIPs}
                              variant="bordered"
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  extraIPs: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                              errorMessage={errors.tcpListenAddr}
                              isInvalid={!!errors.tcpListenAddr}
                              label="TCP监听地址"
                              placeholder="请输入TCP监听地址"
                              startContent={
                                <div className="pointer-events-none flex items-center">
                                  <span className="text-default-400 text-small">
                                    TCP
                                  </span>
                                </div>
                              }
                              value={form.tcpListenAddr}
                              variant="bordered"
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  tcpListenAddr: e.target.value,
                                }))
                              }
                            />
                            <Input
                              errorMessage={errors.udpListenAddr}
                              isInvalid={!!errors.udpListenAddr}
                              label="UDP监听地址"
                              placeholder="请输入UDP监听地址"
                              startContent={
                                <div className="pointer-events-none flex items-center">
                                  <span className="text-default-400 text-small">
                                    UDP
                                  </span>
                                </div>
                              }
                              value={form.udpListenAddr}
                              variant="bordered"
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  udpListenAddr: e.target.value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      </AccordionItem>
                    </Accordion>
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    color="primary"
                    isLoading={submitLoading}
                    onPress={handleSubmit}
                  >
                    {isEdit ? "保存" : "创建"}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        <NodeDNSFailoverModal
          isOpen={dnsFailoverModalOpen}
          node={dnsFailoverNode}
          nodes={nodeList}
          selectedNodeIds={dnsFailoverSelectedNodeIds}
          onOpenChange={setDNSFailoverModalOpen}
          onSaved={loadDNSProviderAvailability}
          onSelectedNodeIdsChange={setDNSFailoverSelectedNodeIds}
        />
        {/* 删除确认弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={deleteModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={setDeleteModalOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p>
                    确定要删除节点{" "}
                    <strong>&quot;{nodeToDelete?.name}&quot;</strong> 吗？
                  </p>
                  <p className="text-small text-default-500">
                    同时删除该节点关联的转发端口、隧道链路和实例配置，此操作不可恢复。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    color="danger"
                    isLoading={deleteLoading}
                    onPress={confirmDelete}
                  >
                    {deleteLoading ? "删除中..." : "确认"}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={installSelectorOpen}
          placement="center"
          size="md"
          onOpenChange={setInstallSelectorOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">
                    选择安装通道
                    {installTargetNode ? ` - ${installTargetNode.name}` : ""}
                  </h2>
                </ModalHeader>
                <ModalBody>
                  <div className="space-y-4">
                    <Select
                      label="版本通道"
                      selectedKeys={[installChannel]}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0] as ReleaseChannel;

                        setInstallChannel(selected || "dev");
                      }}
                    >
                      <SelectItem key="dev" textValue="测试版">
                        测试版
                      </SelectItem>
                      <SelectItem key="stable" textValue="稳定版">
                        稳定版
                      </SelectItem>
                    </Select>
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button color="primary" onPress={handleConfirmInstallCommand}>
                    生成命令
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        {/* 安装命令弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={installCommandModal}
          placement="center"
          scrollBehavior="inside"
          size="2xl"
          onClose={() => setInstallCommandModal(false)}
        >
          <ModalContent>
            <ModalHeader>安装命令 - {currentNodeName}</ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-default-600">
                  请复制以下安装命令到目标机器上执行：
                </p>

                {/* 服务名输入框 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium whitespace-nowrap">
                      服务名：
                    </label>
                    <Input
                      className="flex-1"
                      placeholder="flox_agent"
                      size="sm"
                      value={installServiceName}
                      variant="bordered"
                      onChange={(e) =>
                        setInstallServiceName(
                          e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""),
                        )
                      }
                    />
                  </div>
                  <p className="text-xs text-default-500">
                    💡 提示：同一台节点机可以对接多个面板，使用不同的服务名区分
                  </p>
                </div>

                <div className="relative">
                  <Textarea
                    readOnly
                    className="font-medium text-sm"
                    classNames={{
                      input: "font-medium text-sm",
                    }}
                    maxRows={10}
                    minRows={6}
                    value={`${installCommand} -n ${installServiceName}`}
                    variant="bordered"
                  />
                  <Button
                    className="absolute bottom-2 right-2"
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      // 👇 直接调用你已经封装好的兼容函数，HTTP 下也能完美复制！
                      copyToClipboard(
                        `${installCommand} -n ${installServiceName}`,
                        "命令",
                      );
                      // 👇 加上这行，复制完立马关闭弹窗
                      setInstallCommandModal(false);
                    }}
                  >
                    复制
                  </Button>
                </div>
                <div className="text-xs text-default-500">
                  💡
                  提示：如果自动复制失败请3击或拖拽鼠标选择上方完整文本进行手动复制
                </div>
              </div>
            </ModalBody>
            {/* <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setInstallCommandModal(false)}
            >
              关闭
            </Button>
          </ModalFooter> */}
          </ModalContent>
        </Modal>
        {/* 国外机主线路版本选择弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={overseasModalOpen}
          placement="center"
          size="2xl"
          onOpenChange={setOverseasModalOpen}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold">
                国外机主线路{overseasNodeName ? ` - ${overseasNodeName}` : ""}
              </h2>
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-default-600">
                  请复制以下安装命令到目标机器上执行：
                </p>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <Select
                      label="版本通道"
                      selectedKeys={[overseasChannel]}
                      size="md"
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0] as ReleaseChannel;

                        setOverseasChannel(selected || "stable");
                        setOverseasVersion("");
                        void loadReleasesByChannel(selected);
                      }}
                    >
                      <SelectItem key="dev" textValue="测试版">
                        测试版
                      </SelectItem>
                      <SelectItem key="stable" textValue="稳定版">
                        稳定版
                      </SelectItem>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Select
                      label="选择版本"
                      placeholder="留空自动使用最新版本"
                      selectedKeys={overseasVersion ? [overseasVersion] : []}
                      size="md"
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0] as string;

                        setOverseasVersion(selected || "");
                      }}
                    >
                      {releases
                        .filter((r) => r.channel === overseasChannel)
                        .map((r) => (
                          <SelectItem key={r.version} textValue={r.version}>
                            <div className="flex justify-between items-center">
                              <span>{r.version}</span>
                              <span className="text-xs text-default-400">
                                {r.publishedAt
                                  ? new Date(r.publishedAt).toLocaleDateString()
                                  : ""}
                                {r.channel === "dev" && (
                                  <Chip
                                    className="ml-1 shrink-0 whitespace-nowrap"
                                    color="warning"
                                    size="sm"
                                    variant="flat"
                                  >
                                    测试
                                  </Chip>
                                )}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Input
                      label="服务名"
                      placeholder="留空使用默认"
                      size="md"
                      value={overseasServiceName}
                      variant="bordered"
                      onChange={(e) =>
                        setOverseasServiceName(
                          e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""),
                        )
                      }
                    />
                  </div>
                </div>

                <p className="text-xs text-default-500 -mt-2">
                  提示：同一台节点机可以对接多个面板，使用不同的服务名区分
                </p>

                {overseasCommand ? (
                  <div className="relative">
                    <Textarea
                      readOnly
                      className="font-medium text-sm"
                      classNames={{ input: "font-medium text-sm" }}
                      maxRows={10}
                      minRows={6}
                      value={`${overseasCommand} -n ${overseasServiceName}`}
                      variant="bordered"
                    />
                    <Button
                      className="absolute bottom-2 right-2"
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        copyToClipboard(
                          `${overseasCommand} -n ${overseasServiceName}`,
                          "命令",
                        );
                        setOverseasModalOpen(false);
                      }}
                    >
                      复制
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="lg" />
                  </div>
                )}
                <div className="text-xs text-default-500">
                  💡
                  提示：如果自动复制失败请3击或拖拽鼠标选择上方完整文本进行手动复制
                </div>
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>
        {/* 批量更新弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={upgradeModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={setUpgradeModalOpen}
        >
          <ModalContent>
            {(onClose) => {
              const actionText = getCurrentActionText();

              return (
                <>
                  <ModalHeader className="flex flex-col gap-1">
                    <h2 className="text-xl font-bold">
                      {upgradeTarget === "batch"
                        ? `批量${actionText} (${selectedIds.size} 个节点)`
                        : `${actionText}节点`}
                    </h2>
                  </ModalHeader>
                  <ModalBody>
                    {releasesLoading ? (
                      <div className="flex justify-center py-8">
                        <Spinner size="lg" />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Select
                          label="版本通道"
                          selectedKeys={[releaseChannel]}
                          onSelectionChange={(keys) => {
                            const selected =
                              (Array.from(keys)[0] as ReleaseChannel) ||
                              "stable";

                            setReleaseChannel(selected);
                            setSelectedVersion("");
                            void loadReleasesByChannel(selected);
                          }}
                        >
                          <SelectItem key="dev" textValue="测试版">
                            测试版
                          </SelectItem>
                          <SelectItem key="stable" textValue="稳定版">
                            稳定版
                          </SelectItem>
                        </Select>
                        <Select
                          label="选择版本"
                          placeholder="留空使用最新版本"
                          selectedKeys={
                            selectedVersion ? [selectedVersion] : []
                          }
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as string;

                            setSelectedVersion(selected || "");
                          }}
                        >
                          {releases.map((r) => (
                            <SelectItem key={r.version} textValue={r.version}>
                              <div className="flex justify-between items-center">
                                <span>{r.version}</span>
                                <span className="text-xs text-default-400">
                                  {r.publishedAt
                                    ? new Date(
                                        r.publishedAt,
                                      ).toLocaleDateString()
                                    : ""}
                                  {r.channel === "dev" && (
                                    <div className="ml-1 shrink-0 whitespace-nowrap inline-flex items-center justify-center bg-warning-500/10 text-warning-600 dark:text-warning-400 px-1.5 py-0.5 rounded text-[11px] font-medium">
                                      测试
                                    </div>
                                  )}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </Select>
                        <div className="space-y-1">
                          <p className="text-sm text-default-500">
                            {selectedVersion ? (
                              <span>更新到版本 {selectedVersion}</span>
                            ) : (
                              <span>
                                将自动升级最新
                                {releaseChannel === "stable"
                                  ? "稳定版"
                                  : "测试版"}
                                {latestVersion && ` ${latestVersion}`}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-default-400 font-mono break-all">
                            {getAddressPrefix()}：{buildFullUpdateURL()}
                          </p>
                        </div>
                      </div>
                    )}
                  </ModalBody>
                  <ModalFooter>
                    <Button variant="flat" onPress={onClose}>
                      取消
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={releasesLoading}
                      onPress={handleConfirmUpgrade}
                    >
                      {!selectedVersion ? "确认" : `确认${actionText}`}
                    </Button>
                  </ModalFooter>
                </>
              );
            }}
          </ModalContent>
        </Modal>
        {/* 批量归零流量确认弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={batchResetTrafficModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={setBatchResetTrafficModalOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">确认批量归零流量</h2>
                </ModalHeader>
                <ModalBody>
                  <p>
                    确定要归零以下{" "}
                    <strong>{Array.from(selectedIds).length}</strong>{" "}
                    个节点的流量统计吗？
                  </p>
                  <p className="text-small text-default-500 mt-2">
                    归零后，当前周期流量将归档到历史，新周期从 0 开始统计。
                  </p>
                  <ul className="text-small text-default-500 mt-2 space-y-1">
                    {Array.from(selectedIds)
                      .slice(0, 5)
                      .map((id) => {
                        const node = nodeList.find((n) => n.id === id);

                        return node ? (
                          <li key={id} className="truncate">
                            • {node.name}
                          </li>
                        ) : null;
                      })}
                    {selectedIds.size > 5 && (
                      <li>... 还有 {selectedIds.size - 5} 个节点</li>
                    )}
                  </ul>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    color="primary"
                    isLoading={batchResetTrafficLoading}
                    onPress={handleBatchResetTraffic}
                  >
                    确认归零
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        {/* 节点流量归零日志弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={nodeTrafficLogModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={setNodeTrafficLogModalOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">
                    流量归零日志 - {currentLogNode?.name}
                  </h2>
                </ModalHeader>
                <ModalBody>
                  {nodeTrafficLogsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Spinner size="md" />
                    </div>
                  ) : nodeTrafficLogs.length === 0 ? (
                    <div className="text-center text-default-500 py-8">
                      暂无归零记录
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {nodeTrafficLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-3 rounded-lg border border-divider bg-default-50/50"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-foreground">
                              {log.operatorName}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-default-500">
                                {formatDate(log.createdTime)}
                              </span>
                              <Button
                                isIconOnly
                                className="w-6 h-6 min-w-6 text-danger hover:bg-danger/10"
                                size="sm"
                                variant="flat"
                                onPress={() => {
                                  setLogToDelete(log.id);
                                  setDeleteLogModalOpen(true);
                                }}
                              >
                                <svg
                                  className="w-3.5 h-3.5"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    clipRule="evenodd"
                                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                    fillRule="evenodd"
                                  />
                                </svg>
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 w-full">
                            <div className="flex items-center justify-between w-full">
                              <span className="text-default-500 text-sm">
                                归零范围
                              </span>
                              <span className="text-default-700 text-sm font-medium dark:text-default-300">
                                {log.instanceName ||
                                  log.instanceId ||
                                  (String(log.nodeName || "").includes(" / ")
                                    ? String(log.nodeName || "")
                                        .split(" / ")
                                        .slice(1)
                                        .join(" / ")
                                    : "全部实例")}
                              </span>
                            </div>
                            <div className="w-full">
                              <span className="text-default-500 text-sm block mb-1">
                                归零前流量
                              </span>
                              <div className="flex items-center justify-end gap-2 flex-wrap">
                                <span className="text-primary-600 text-sm whitespace-nowrap dark:text-primary-400">
                                  ↑{formatTraffic(log.inFlowBefore || 0)}
                                </span>
                                <span className="text-success-600 text-sm whitespace-nowrap dark:text-success-400">
                                  ↓{formatTraffic(log.outFlowBefore || 0)}
                                </span>
                                <span className="text-default-600 text-sm whitespace-nowrap font-medium">
                                  总{" "}
                                  {formatTraffic(
                                    (log.inFlowBefore || 0) +
                                      (log.outFlowBefore || 0),
                                  )}
                                </span>
                              </div>
                            </div>
                            {log.reason && (
                              <div className="flex items-center justify-between w-full">
                                <span className="text-default-500 text-sm">
                                  归零原因
                                </span>
                                <span className="text-red-500 text-sm">
                                  {log.reason}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    关闭
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        {/* 归零流量确认弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={isResetTrafficModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={(open) => {
            if (!open) {
              setNodeToReset(null);
            }
            onResetTrafficModalClose();
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">
                    归零节点流量 - {nodeToReset?.name}
                  </h2>
                </ModalHeader>
                <ModalBody>
                  <p className="text-sm text-default-600">
                    确定要归零该节点的周期流量统计吗？此操作不会影响历史归零记录。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    color="success"
                    isLoading={resetTrafficLoading}
                    onPress={handleConfirmResetTraffic}
                  >
                    归零
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        <Modal
          isDismissable={false}
          isOpen={!!instanceConfigTarget}
          placement="center"
          onOpenChange={(open) =>
            open && setInstanceConfigTarget(instanceConfigTarget)
          }
        >
          <ModalContent>
            <ModalHeader>
              编辑 {getInstanceLabel(instanceConfigTarget)}
            </ModalHeader>
            <ModalBody>
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    description={
                      instanceConfigTarget
                        ? `留空继承 ${getDefaultInstanceLabel(instanceConfigTarget)}`
                        : "留空继承默认实例名称"
                    }
                    label="实例名称"
                    placeholder={
                      instanceConfigTarget
                        ? getDefaultInstanceLabel(instanceConfigTarget)
                        : "实例 1"
                    }
                    value={instanceConfigForm.displayName}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        displayName: e.target.value,
                      }))
                    }
                  />
                  <Input
                    description="仅用于实例的备注展示"
                    label="备注"
                    placeholder="填写实例备注"
                    value={instanceConfigForm.remark}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        remark: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select
                    label="续费周期"
                    selectedKeys={
                      instanceConfigForm.renewalCycle
                        ? [instanceConfigForm.renewalCycle]
                        : []
                    }
                    variant="bordered"
                    onSelectionChange={(keys) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        renewalCycle: String(Array.from(keys)[0] || ""),
                      }))
                    }
                  >
                    <SelectItem key="month">月付</SelectItem>
                    <SelectItem key="quarter">季付</SelectItem>
                    <SelectItem key="halfYear">半年付</SelectItem>
                    <SelectItem key="year">年付</SelectItem>
                  </Select>
                  <Input
                    description={`留空使用 ${DEFAULT_INSTANCE_PORT_RANGE}`}
                    label="端口范围"
                    placeholder={DEFAULT_INSTANCE_PORT_RANGE}
                    value={instanceConfigForm.portRange}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        portRange: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    description="0=不归零，1-31=日期"
                    label="流量归零日"
                    max={31}
                    min={0}
                    type="number"
                    value={instanceConfigForm.flowResetTime}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        flowResetTime: e.target.value,
                      }))
                    }
                  />
                  <DatePicker
                    showMonthAndYearPickers
                    label="续费基准时间"
                    value={timestampToCalendarDate(
                      parseDateInputValue(instanceConfigForm.expiryDate) ||
                        null,
                    )}
                    onChange={(date) => {
                      const timestamp =
                        calendarDateToTimestamp(date, false) || 0;

                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        expiryDate: formatDateInputValue(timestamp),
                      }));
                    }}
                  >
                    <DatePresets
                      onChange={(timestamp) => {
                        setInstanceConfigForm((prev) => ({
                          ...prev,
                          expiryDate: formatDateInputValue(timestamp),
                        }));
                      }}
                    />
                  </DatePicker>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    description="流量用完前有电报提醒"
                    label="流量限额 (GB)"
                    min={0}
                    type="number"
                    value={instanceConfigForm.trafficLimit}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        trafficLimit: e.target.value,
                      }))
                    }
                  />
                  <Input
                    description="输入目标值自动按比例分配上下行"
                    label="已用流量(GB)"
                    min={0}
                    step="0.01"
                    type="number"
                    value={instanceConfigForm.usedTraffic}
                    variant="bordered"
                    onChange={(e) => {
                      setUsedTrafficDirty(true);
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        usedTraffic: e.target.value,
                      }));
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select
                    description="首次设置流量限额后不可更改"
                    isDisabled={(instanceConfigTarget?.trafficLimit ?? 0) > 0}
                    label="流量累计模式"
                    selectedKeys={[String(instanceConfigForm.trafficLimitMode)]}
                    variant="bordered"
                    onSelectionChange={(keys) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        trafficLimitMode: Number(Array.from(keys)[0] || 0),
                      }))
                    }
                  >
                    <SelectItem
                      key="1"
                      description="每月归零日自动重置累计流量"
                    >
                      按月累计
                    </SelectItem>
                    <SelectItem
                      key="0"
                      description="流量一直累加，达到限额后暂停"
                    >
                      终身累计
                    </SelectItem>
                  </Select>
                  <Input
                    description="权重为 0 时暂停转发"
                    label="权重"
                    min={0}
                    type="number"
                    value={instanceConfigForm.weight}
                    variant="bordered"
                    onChange={(e) =>
                      setInstanceConfigForm((prev) => ({
                        ...prev,
                        weight: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={() => {
                  setUsedTrafficDirty(false);
                  setInstanceConfigTarget(null);
                }}
              >
                取消
              </Button>
              <Button
                color="primary"
                isLoading={instanceConfigSaving}
                onPress={saveInstanceConfig}
              >
                保存
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal
          isDismissable={!instanceResetSaving}
          isOpen={!!instanceResetTarget}
          placement="center"
          onOpenChange={(open) =>
            !open && !instanceResetSaving && setInstanceResetTarget(null)
          }
        >
          <ModalContent>
            <ModalHeader>
              确认 {getInstanceLabel(instanceResetTarget)} 流量归零
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                确认将 {getInstanceLabel(instanceResetTarget)}{" "}
                的周期流量归零？此操作不会修改实例配置。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                isDisabled={instanceResetSaving}
                variant="flat"
                onPress={() => setInstanceResetTarget(null)}
              >
                取消
              </Button>
              <Button
                color="danger"
                isLoading={instanceResetSaving}
                onPress={resetInstanceTraffic}
              >
                确认
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal
          isOpen={!!instanceDeleteTarget}
          placement="center"
          onOpenChange={(open) => !open && setInstanceDeleteTarget(null)}
        >
          <ModalContent>
            <ModalHeader>
              删除实例 {getInstanceLabel(instanceDeleteTarget)}
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                删除 {getInstanceLabel(instanceDeleteTarget)}系统会尝试卸载远程
                Agent，并永久移除当前实例 ID；旧实例继续上报也不会重新出现。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={() => setInstanceDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                color="danger"
                isLoading={instanceDeleteSaving}
                onPress={deleteInstanceConfig}
              >
                确认
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 删除日志确认弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[400px] rounded-xl",
          }}
          isOpen={deleteLogModalOpen}
          placement="center"
          onClose={() => setDeleteLogModalOpen(false)}
        >
          <ModalContent>
            <ModalHeader className="text-base font-semibold">
              确认删除
            </ModalHeader>
            <ModalBody className="py-4">
              <p className="text-sm text-default-600">
                确定要删除这条归零记录吗？此操作不可恢复。
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={() => setDeleteLogModalOpen(false)}
              >
                取消
              </Button>
              <Button color="danger" onPress={handleDeleteLog}>
                确认
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 批量删除确认弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={batchDeleteModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={setBatchDeleteModalOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p>
                    确定要删除选中的 <strong>{selectedIds.size}</strong>{" "}
                    个节点吗？
                  </p>
                  <p className="text-small text-default-500">
                    此操作不可恢复，请谨慎操作。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button variant="flat" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    color="danger"
                    isLoading={batchLoading}
                    onPress={handleBatchDelete}
                  >
                    {batchLoading ? "删除中..." : "确认"}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        <Modal
          isOpen={mimicConfirmNodes.length > 0}
          placement="center"
          onOpenChange={(open) => {
            if (!open) setMimicConfirmNodes([]);
          }}
        >
          <ModalContent>
            <ModalHeader>确认安装 WGM 依赖</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-600">
                将为 {mimicConfirmNodes.length} 个节点安装 WGM
                依赖，节点下所有在线实例都会执行安装。是否继续？
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={() => setMimicConfirmNodes([])}>
                取消
              </Button>
              <Button
                color="primary"
                isLoading={batchMimicLoading}
                onPress={() => {
                  const ids = mimicConfirmNodes.map((node) => node.id);

                  setMimicConfirmNodes([]);
                  void handleBatchMimicDeps(ids);
                }}
              >
                确认
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
        {/* WGM 依赖安装结果弹窗 */}
        <Modal
          backdrop="blur"
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isDismissable={false}
          isOpen={mimicResultModalOpen}
          placement="center"
          scrollBehavior="inside"
          size="md"
          onOpenChange={(open) => {
            if (!open) setMimicResultModalOpen(false);
          }}
        >
          <ModalContent>
            {(onClose) => {
              const successResults = mimicResults.filter((r) => r.success);
              const failResults = mimicResults.filter((r) => !r.success);

              return (
                <>
                  <ModalHeader className="flex flex-col gap-1">
                    <h2 className="text-xl font-bold">WGM 依赖安装结果</h2>
                    <p className="text-small text-default-500">
                      {successResults.length} 成功
                      {mimicResults.length > 0
                        ? `，${failResults.length} 失败`
                        : ""}
                    </p>
                  </ModalHeader>
                  <ModalBody>
                    {mimicResults.length === 0 ? (
                      <p className="text-danger">请求失败，请检查网络后重试</p>
                    ) : (
                      <div className="flex flex-col gap-2 max-h-64 overflow-auto">
                        {mimicResults.map((r) => (
                          <div
                            key={r.nodeId}
                            className={`flex items-start gap-2 p-2 rounded ${
                              r.success
                                ? "bg-success-50 dark:bg-success-900/20"
                                : "bg-danger-50 dark:bg-danger-900/20"
                            }`}
                          >
                            <span className="text-lg">
                              {r.success ? "✅" : "❌"}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">
                                {r.nodeName || `节点 ${r.nodeId}`}
                              </div>
                              <div className="text-xs text-default-500 break-all">
                                {r.message ||
                                  (r.success ? "安装成功" : "安装失败")}
                              </div>
                              {!r.success && (
                                <div className="mt-1 flex items-center gap-1">
                                  <code className="text-[11px] bg-default-100 px-1.5 py-0.5 rounded break-all">
                                    📋 {getMimicFixCommand(r.message)}
                                  </code>
                                  <Button
                                    className="h-6 w-6 min-w-0 p-0"
                                    size="sm"
                                    variant="light"
                                    onPress={() =>
                                      copyToClipboard(
                                        getMimicFixCommand(r.message),
                                        "修复命令",
                                      )
                                    }
                                  >
                                    <svg
                                      aria-hidden="true"
                                      className="w-3 h-3"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ModalBody>
                  <ModalFooter>
                    <Button color="primary" variant="flat" onPress={onClose}>
                      关闭
                    </Button>
                  </ModalFooter>
                </>
              );
            }}
          </ModalContent>
        </Modal>
        <Modal
          classNames={{
            base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
          }}
          isOpen={isFilterModalOpen}
          placement="center"
          size="md"
          onOpenChange={setIsFilterModalOpen}
        >
          <ModalContent>
            {() => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  筛选条件
                </ModalHeader>
                <ModalBody>
                  <div className="flex flex-col gap-4 py-2">
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium">按到期状态筛选</p>
                      <Select
                        aria-label="按到期状态筛选"
                        className="w-full"
                        selectedKeys={[nodeFilterMode]}
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys)[0] as
                            | NodeFilterMode
                            | undefined;

                          setNodeFilterMode(selected || "all");
                        }}
                      >
                        <SelectItem key="all">全部节点</SelectItem>
                        <SelectItem key="expiringSoon">
                          7 天内 ({nodeExpiryStats.expiringSoon})
                        </SelectItem>
                        <SelectItem key="expired">
                          已逾期 ({nodeExpiryStats.expired})
                        </SelectItem>
                        <SelectItem key="withExpiry">
                          已启用 ({nodeExpiryStats.withExpiry})
                        </SelectItem>
                      </Select>
                    </div>
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button
                    color="default"
                    variant="flat"
                    onPress={() => {
                      resetNodeFilterMode();
                      setFilterGroupId(null);
                    }}
                  >
                    归零
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
        {/* 离线部署弹窗 */}
        <Modal
          isOpen={offlineModalOpen}
          size="lg"
          onOpenChange={setOfflineModalOpen}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              ℹ️ 离线部署
            </ModalHeader>
            <ModalBody>
              {/* 1. 下载链接 */}
              <Alert
                color="warning"
                description={
                  // 👇 修改了这里的 className：换成 flex 水平排列，并加了 flex-wrap 防止手机端太挤换行，gap-4 控制左右间距
                  <div className="flex flex-wrap items-center gap-4 mt-2">
                    <Link
                      className="text-primary hover:underline flex items-center gap-2"
                      href={offlineDeployData?.amd64Download}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      offline-amd64.zip
                    </Link>
                    <Link
                      className="text-primary hover:underline flex items-center gap-2"
                      href={offlineDeployData?.arm64Download}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      offline-arm64.zip
                    </Link>
                  </div>
                }
                title="请按机器的架构下载合适的离线包："
              />
              {/* 2. 命令区域 */}
              <p className="text-sm">
                <span className="font-bold">
                  {offlineDeployData?.nodeName || currentNodeName}
                </span>
                <span className="font-medium"> 的离线对接命令：</span>
              </p>
              <div className="relative mt-2">
                <Textarea
                  readOnly
                  className="font-mono text-sm"
                  rows={2}
                  value={offlineCommand}
                />
                <Button
                  className="absolute bottom-2 right-2"
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    copyToClipboard(offlineCommand, "命令");
                    // 👇 加上这行，复制完立马关闭弹窗
                    setOfflineModalOpen(false);
                  }}
                >
                  复制
                </Button>
              </div>
              {/* 3. 使用说明 */}
              <Alert
                color="primary"
                description={
                  <span className="list-decimal list-inside space-y-1 text-sm mt-2">
                    使用方法：上传离线包到【无法在线对接的机器】并重命名为
                    offline.zip。然后 cd 切换到【离线包所在目录】运行以上命令。
                  </span>
                }
                title=""
              />
              {/* 4. 依赖提示 */}
              <Alert
                color="warning"
                description={
                  <span className="mt-2 block">
                    提示：离线安装依赖 unzip 命令，请自行安装。
                  </span>
                }
                title=""
              />
            </ModalBody>
            {/* <ModalFooter>
            <Button onPress={() => setOfflineModalOpen(false)}>知道了</Button>
          </ModalFooter> */}
          </ModalContent>
        </Modal>
        <Modal
          isOpen={groupSelectorNode !== null}
          size="sm"
          onOpenChange={() => setGroupSelectorNode(null)}
        >
          <ModalContent>
            <ModalHeader>选择分组</ModalHeader>
            <ModalBody>
              <div className="flex flex-wrap gap-2 pb-4">
                <Chip
                  key="none"
                  className="cursor-pointer hover:opacity-80"
                  size="sm"
                  variant="flat"
                  onClick={() =>
                    handleAssignNodeToGroup(groupSelectorNode!, null)
                  }
                >
                  未分组
                </Chip>
                {nodeGroups.map((group) => (
                  <Chip
                    key={group.id}
                    className="cursor-pointer hover:opacity-80"
                    size="sm"
                    style={{
                      backgroundColor: `${group.color}20`,
                      color: group.color,
                    }}
                    variant="flat"
                    onClick={() =>
                      handleAssignNodeToGroup(groupSelectorNode!, group.id)
                    }
                  >
                    {group.name}
                  </Chip>
                ))}
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>
        <NodeSharingModal
          formatTraffic={formatTraffic}
          instances={
            sharingNode ? nodeInstanceMembers[sharingNode.id] || [] : []
          }
          isOpen={sharingNode !== null}
          node={sharingNode}
          onClose={() => setSharingNode(null)}
          onShareCountChange={handleShareCountChange}
        />
        <NodeImportModal
          isOpen={importNodeOpen}
          notifications={peerShareNotifications}
          prefillToken={importPrefillToken}
          prefillUrl={importPrefillUrl}
          onClose={() => {
            setImportNodeOpen(false);
            setImportPrefillUrl("");
            setImportPrefillToken("");
          }}
          onDismissNotification={async (id: number) => {
            await dismissPeerShareNotification(id);
            setPeerShareNotifications((prev) =>
              prev.filter((n) => n.id !== id),
            );
            try {
              const channel = new BroadcastChannel("flox-peer-share-notifications");
              channel.postMessage({ type: "dismissed", id });
              channel.close();
            } catch {
              /* BroadcastChannel not supported */
            }
          }}
          onImported={() => void loadNodes({ silent: true })}
        />
        <RemoteNodeDetailModal
          formatTraffic={formatTraffic}
          isOpen={remoteDetailNode !== null}
          node={remoteDetailNode}
          onClose={() => setRemoteDetailNode(null)}
        />
      </AnimatedPage>
    </MonitorTerminalProvider>
  );
}
