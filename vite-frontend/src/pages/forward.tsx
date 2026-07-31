import type {
  BatchOperationFailure,
  ForwardApiItem,
  NodeGroupApiItem,
  SpeedLimitApiItem,
} from "@/api/types";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { AnimatedPage } from "@/components/animated-page";
import { BatchActionResultModal } from "@/components/batch-action-result-modal";
import { SearchBar } from "@/components/search-bar";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { DatePicker } from "@/shadcn-bridge/heroui/date-picker";
import { DatePresets } from "@/shadcn-bridge/heroui/date-presets";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/shadcn-bridge/heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Alert } from "@/shadcn-bridge/heroui/alert";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  createForward,
  getForwardList,
  getLicenseInfo,
  getSpeedLimitList,
  updateForward,
  deleteForward,
  forceDeleteForward,
  deleteTunnel,
  userTunnel,
  getNodeList,
  getNodeGroupList,
  pauseForwardService,
  resumeForwardService,
  diagnoseForward,
  updateForwardOrder,
  getConfigByName,
  updateConfig,
  batchResetForward,
  getForwardTrafficResetLogs,
  deleteForwardTrafficResetLog,
  createTunnel,
  updateTunnel,
  getTunnelById,
  getUserPackageInfo,
  type LicenseInfo,
} from "@/api";
import {
  type ForwardAddressItem,
  formatAddressHost,
  formatInAddress,
  formatRemoteAddress,
  hasMultipleAddresses,
  resolveForwardAddressAction,
  splitAddressHostPort,
} from "@/pages/forward/address";
import { useNodeRealtime } from "@/pages/node/use-node-realtime";
import { formatRemoteDisplayText } from "@/utils/remoteDisplay";
import {
  buildForwardDiagnosisFallbackResult,
  getForwardDiagnosisQualityDisplay,
  type ForwardDiagnosisResult,
} from "@/pages/forward/diagnosis";
import { diagnoseForwardStream } from "@/api/diagnosis-stream";
import {
  executeForwardBatchChangeMode,
  executeForwardBatchChangeTunnel,
  executeForwardBatchDelete,
  executeForwardBatchRedeploy,
  executeForwardBatchToggleService,
} from "@/pages/forward/batch-actions";
import {
  convertNyItemToForwardInput,
  parseNyFormatData,
} from "@/pages/forward/import-format";
import {
  buildForwardOrder,
  compareForwardOrder,
  FORWARD_ORDER_KEY,
} from "@/pages/forward/order";
import { PageLoadingState } from "@/components/page-state";
import { SmartTooltip } from "@/components/smart-tooltip";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
// import { useMobileBreakpoint } from "@/hooks/useMobileBreakpoint";
import { saveOrder } from "@/utils/order-storage";
import { JwtUtil } from "@/utils/jwt";
import { timestampToCalendarDate, calendarDateToTimestamp } from "@/utils/date";
import { configCache } from "@/config/site";

const getForwardModeEnabledState = () => ({
  nft: configCache.get("forward_mode_nft_enabled") !== "false",
  flc: configCache.get("forward_mode_flc_enabled") !== "false",
  sdw: configCache.get("forward_mode_sdw_enabled") !== "false",
  wgm: configCache.get("forward_mode_mimic_enabled") !== "false",
});
const MANUAL_TUNNEL_SELECT_KEY = "__manual__";
const MANUAL_TUNNEL_REMARK = "自行组建隧道";
const LEGACY_MANUAL_TUNNEL_REMARK = "自行组建隧道";
const isNoLimitSpeedRule = (speedLimit: SpeedLimitApiItem): boolean => {
  const speeds = [
    speedLimit.speed,
    speedLimit.uploadSpeed,
    speedLimit.downloadSpeed,
  ].filter(
    (speed): speed is number =>
      typeof speed === "number" && Number.isFinite(speed),
  );

  return speeds.length > 0 && speeds.every((speed) => speed <= 0);
};

interface Forward {
  id: number;
  name: string;
  tunnelId: number;
  tunnelName: string;
  tunnelTrafficRatio?: number;
  isManualTunnel?: boolean;
  inIp: string;
  inPort: number;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
  status: number;
  inFlow: number;
  outFlow: number;
  serviceRunning: boolean;
  createdTime: string;
  userName?: string;
  userRemark?: string;
  userId?: number;
  inx?: number;
  speedId?: number | null;
  maxConnections?: number;
  currentConnections?: number;
  trafficLimit?: number;
  expiryTime?: number | null;
  speedLimitEnabled?: boolean;
  speedLimit?: number;
  inSpeed?: number; // 新增：实时上行速度 (bytes/s)
  outSpeed?: number; // 新增：实时下行速度 (bytes/s)
  mode?: "gost" | "nftables" | "floxcore" | "sdwan" | "mimic";
}
interface Tunnel {
  id: number;
  name: string;
  type?: number;
  inIp?: string;
  inNodeId?: ChainTunnel[];
  outNodeId?: ChainTunnel[];
  chainNodes?: ChainTunnel[][];
  inNodePortSta?: number;
  inNodePortEnd?: number;
  portRangeMin?: number;
  portRangeMax?: number;
  remark?: string;
  trafficRatio?: number;
  ceilingSpeed?: number | null;
  forwardSpeedLimit?: number | null;
}
interface ChainTunnel {
  nodeId: number;
  protocol?: string;
  strategy?: string;
  chainType?: number;
  inx?: number;
  port?: number;
  connectIpType?: string;
}

const mapForwardChainNodes = (items?: any[]): ChainTunnel[] =>
  (items || []).map((item) => ({
    ...item,
    connectIpType:
      item.connectIpType ||
      item.connect_ip_type ||
      item.allocatedIpType ||
      item.allocated_ip_type ||
      item.allocatedConnectIpType ||
      item.allocated_connect_ip_type ||
      item.ipType ||
      item.ip_type ||
      item.connectIp ||
      item.connect_ip ||
      "",
    port: item.port || item.allocatedPort || item.allocated_port || undefined,
  }));

const mapForwardTunnel = (tunnel: any): Tunnel => ({
  ...tunnel,
  inNodeId: mapForwardChainNodes(tunnel?.inNodeId || tunnel?.in_node_id),
  outNodeId: mapForwardChainNodes(tunnel?.outNodeId || tunnel?.out_node_id),
  chainNodes: (tunnel?.chainNodes || tunnel?.chain_nodes || []).map(
    (group: any[]) => mapForwardChainNodes(group),
  ),
  inIp: tunnel?.inIp || tunnel?.in_ip || "",
});

interface Node {
  id: number;
  name?: string;
  status?: number;
  isRemote?: number;
  groupId?: number | null;
  intranetIp?: string;
  serverIp?: string;
  serverIpV4?: string;
  serverIpV6?: string;
  extraIPs?: string;
  remark?: string;
  trafficRatio?: number;
}
const REMOTE_NODE_REFRESH_INTERVAL_MS = 20000;

interface ForwardForm {
  id?: number;
  userId?: number;
  name: string;
  tunnelId: number | null;
  inPort: number | null;
  inIp: string;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
  speedId: number | null;
  maxConnections: number;
  trafficLimit: number;
  expiryTime: number | null;
  speedLimitEnabled: boolean;
  speedLimit: number;
  mode: "gost" | "nftables" | "floxcore" | "sdwan" | "mimic";
}
const createForwardFormDefaults = (): ForwardForm => ({
  name: "",
  tunnelId: null,
  inPort: null,
  inIp: "",
  remoteAddr: "",
  interfaceName: "",
  strategy: "fifo",
  speedId: null,
  maxConnections: 0,
  trafficLimit: 0,
  expiryTime: null,
  speedLimitEnabled: false,
  speedLimit: 0,
  mode: "gost",
});

interface ForwardUserGroup {
  userId: number;
  userName: string;
  tunnels: ForwardTunnelGroup[];
}
interface ForwardTunnelGroup {
  tunnelKey: string;
  tunnelName: string;
  tunnelTrafficRatio?: number;
  isManualTunnel?: boolean;
  items: Forward[];
}
interface BatchProgressState {
  active: boolean;
  label: string;
  percent: number;
}
interface BatchResultModalState {
  failures: BatchOperationFailure[];
  open: boolean;
  skipped: BatchOperationFailure[];
  summary: string;
  title: string;
}
const EMPTY_BATCH_RESULT_MODAL_STATE: BatchResultModalState = {
  failures: [],
  open: false,
  skipped: [],
  summary: "",
  title: "",
};

type ForwardGroupOrderMap = Record<string, string[]>;
type ForwardGroupCollapsedMap = Record<string, boolean>;
const UNKNOWN_FORWARD_USER_NAME = "未知用户";
const UNCATEGORIZED_FORWARD_TUNNEL_NAME = "未分类";
const FORWARD_COMPACT_MODE_CONFIG_KEY = "forward_compact_mode";
const FORWARD_COMPACT_MODE_EVENT = "forwardCompactModeChanged";
const FORWARD_GROUP_ORDER_CONFIG_KEY = "forward_group_order_map";
const FORWARD_GROUP_COLLAPSED_CONFIG_KEY = "forward_group_collapsed_map";
const FORWARD_GROUP_ORDER_LOCAL_STORAGE_PREFIX = "forward-group-order";
const FORWARD_GROUP_COLLAPSED_LOCAL_STORAGE_PREFIX = "forward-group-collapsed";
const FORWARD_TUNNEL_GROUP_SORTABLE_PREFIX = "forward-tunnel-group";
const FORWARD_GROUPED_TABLE_MIN_WIDTH_CLASS = "";
const FORWARD_GROUPED_TABLE_COLUMN_CLASS = {
  select: "w-12",
  drag: "w-12 pl-1",
  totalFlow: "w-[110px]",
  realtimeSpeed: "w-[120px]",
} as const;
const normalizeForwardUserName = (userName?: string): string => {
  const normalized = (userName || UNKNOWN_FORWARD_USER_NAME).trim();

  return normalized || UNKNOWN_FORWARD_USER_NAME;
};
const compareForwardUserNameAsc = (a: string, b: string): number => {
  return a.localeCompare(b, "en", {
    sensitivity: "base",
    numeric: true,
  });
};
const normalizeForwardTunnelName = (tunnelName?: string): string => {
  const normalized = formatRemoteDisplayText(tunnelName).trim();

  return normalized || UNCATEGORIZED_FORWARD_TUNNEL_NAME;
};
const buildForwardTunnelGroupKey = (tunnelName?: string): string => {
  const normalized = normalizeForwardTunnelName(tunnelName);

  if (normalized === UNCATEGORIZED_FORWARD_TUNNEL_NAME) {
    return "__uncategorized__";
  }

  return normalized.toLocaleLowerCase();
};
const compareForwardTunnelNameAsc = (a: string, b: string): number => {
  return a.localeCompare(b, "en", {
    sensitivity: "base",
    numeric: true,
  });
};
const compareForwardTunnelGroupKeyAsc = (a: string, b: string): number => {
  const aIsUncategorized = a === "__uncategorized__";
  const bIsUncategorized = b === "__uncategorized__";

  if (aIsUncategorized !== bIsUncategorized) {
    return aIsUncategorized ? 1 : -1;
  }

  return compareForwardTunnelNameAsc(a, b);
};
const normalizeTunnelTrafficRatio = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 1;
};
const formatTunnelTrafficRatio = (value?: number): string => {
  const ratio = normalizeTunnelTrafficRatio(value);

  if (Number.isInteger(ratio)) {
    return `${ratio}x`;
  }

  return `${parseFloat(ratio.toFixed(2))}x`;
};
const ManualTunnelChip = ({ className = "" }: { className?: string }) => (
  <Chip
    className={`h-5 w-5 min-w-5 rounded-full px-0 py-0 text-[8px] font-bold leading-none inline-flex items-center justify-center bg-warning-100 text-warning-800 ${className}`}
    size="sm"
  >
    DIY
  </Chip>
);
const MODE_CONFIG: Record<
  string,
  { text: string; bg: string; textClr: string }
> = {
  gost: { text: "gos", bg: "bg-primary-100", textClr: "text-primary-800" },
  floxcore: { text: "flc", bg: "bg-cyan-100", textClr: "text-cyan-800" },
  nftables: { text: "nft", bg: "bg-green-100", textClr: "text-green-800" },
  mimic: { text: "wgm", bg: "bg-amber-100", textClr: "text-amber-800" },
  sdwan: { text: "sdw", bg: "bg-violet-100", textClr: "text-violet-800" },
};
const ForwardModeChip = ({
  mode,
  className = "",
}: {
  mode?: Forward["mode"];
  className?: string;
}) => {
  const config = mode ? MODE_CONFIG[mode] : null;

  if (!config) return null;

  return (
    <span
      className={`h-5 w-5 min-w-5 rounded-full px-0 py-0 text-[8px] font-bold leading-none inline-flex items-center justify-center ${config.bg} ${config.textClr} ${className}`}
    >
      {config.text}
    </span>
  );
};
const formatExpiryTime = (expiryTime: number | null | undefined): string => {
  if (!expiryTime || expiryTime <= 0) {
    return "永久";
  }
  const date = new Date(expiryTime);
  const now = new Date();
  const diffDays = Math.ceil(
    (expiryTime - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const dateStr = `${month}/${day}`;

  if (diffDays <= 0) {
    return `${dateStr} (已过期)`;
  }
  if (diffDays <= 7) {
    return `${dateStr} (剩余${diffDays}天)`;
  }

  return dateStr;
};
const isExpirySoon = (expiryTime: number): boolean => {
  const now = new Date().getTime();
  const diffDays = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));

  return diffDays <= 7;
};
const buildForwardGroupOrderLocalKey = (tokenUserId: number): string => {
  return `${FORWARD_GROUP_ORDER_LOCAL_STORAGE_PREFIX}:u:${tokenUserId}`;
};
const buildForwardGroupCollapsedLocalKey = (tokenUserId: number): string => {
  return `${FORWARD_GROUP_COLLAPSED_LOCAL_STORAGE_PREFIX}:u:${tokenUserId}`;
};
const parsePreferenceMap = <T,>(
  raw: string | null,
): Record<string, T> | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, T>;
  } catch {
    return null;
  }
};
const parseGroupOrderMap = (raw: string | null): ForwardGroupOrderMap => {
  const parsed = parsePreferenceMap<unknown>(raw);

  if (!parsed) {
    return {};
  }
  const result: ForwardGroupOrderMap = {};

  Object.entries(parsed).forEach(([userId, value]) => {
    if (!Array.isArray(value)) {
      return;
    }
    const keys = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item !== "");

    if (keys.length > 0) {
      result[userId] = Array.from(new Set(keys));
    }
  });

  return result;
};
const parseGroupCollapsedMap = (
  raw: string | null,
): ForwardGroupCollapsedMap => {
  const parsed = parsePreferenceMap<unknown>(raw);

  if (!parsed) {
    return {};
  }
  const result: ForwardGroupCollapsedMap = {};

  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof value === "boolean") {
      result[key] = value;
    }
  });

  return result;
};
const sanitizeGroupOrderMap = (
  source: ForwardGroupOrderMap,
  availableTunnelKeysByUser: Map<number, Set<string>>,
): ForwardGroupOrderMap => {
  const sanitized: ForwardGroupOrderMap = {};

  availableTunnelKeysByUser.forEach((availableKeys, userId) => {
    if (availableKeys.size === 0) {
      return;
    }
    const orderFromSource = source[userId.toString()] || [];
    const used = new Set<string>();
    const merged: string[] = [];

    orderFromSource.forEach((key) => {
      if (!availableKeys.has(key) || used.has(key)) {
        return;
      }
      used.add(key);
      merged.push(key);
    });
    Array.from(availableKeys)
      .sort(compareForwardTunnelGroupKeyAsc)
      .forEach((key) => {
        if (!used.has(key)) {
          used.add(key);
          merged.push(key);
        }
      });
    if (merged.length > 0) {
      sanitized[userId.toString()] = merged;
    }
  });

  return sanitized;
};
const sanitizeGroupCollapsedMap = (
  source: ForwardGroupCollapsedMap,
  availableCollapseKeys: Set<string>,
): ForwardGroupCollapsedMap => {
  const sanitized: ForwardGroupCollapsedMap = {};

  availableCollapseKeys.forEach((key) => {
    if (source[key] === true) {
      sanitized[key] = true;
    }
  });

  return sanitized;
};
const buildTunnelGroupCollapseKey = (
  userId: number,
  tunnelKey: string,
): string => {
  return `${userId}:${tunnelKey}`;
};
const buildTunnelGroupSortableId = (
  userId: number,
  tunnelKey: string,
): string => {
  return `${FORWARD_TUNNEL_GROUP_SORTABLE_PREFIX}:${userId}:${tunnelKey}`;
};
const parseTunnelGroupSortableId = (
  value: unknown,
): { userId: number; tunnelKey: string } | null => {
  if (typeof value !== "string") {
    return null;
  }
  if (!value.startsWith(`${FORWARD_TUNNEL_GROUP_SORTABLE_PREFIX}:`)) {
    return null;
  }
  const parts = value.split(":");

  if (parts.length < 3) {
    return null;
  }
  const userId = Number(parts[1]);
  const tunnelKey = parts.slice(2).join(":").trim();

  if (!Number.isFinite(userId) || tunnelKey === "") {
    return null;
  }

  return { userId, tunnelKey };
};
const buildAvailableGroupData = (
  forwards: Forward[],
): {
  availableTunnelKeysByUser: Map<number, Set<string>>;
  availableCollapseKeys: Set<string>;
} => {
  const availableTunnelKeysByUser = new Map<number, Set<string>>();
  const availableCollapseKeys = new Set<string>();

  forwards.forEach((forward) => {
    const userId = forward.userId ?? 0;
    const tunnelKey = buildForwardTunnelGroupKey(forward.tunnelName);
    let set = availableTunnelKeysByUser.get(userId);

    if (!set) {
      set = new Set<string>();
      availableTunnelKeysByUser.set(userId, set);
    }
    set.add(tunnelKey);
    availableCollapseKeys.add(buildTunnelGroupCollapseKey(userId, tunnelKey));
  });

  return { availableTunnelKeysByUser, availableCollapseKeys };
};
const isSameStringArray = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
};
const isSameGroupOrderMap = (
  a: ForwardGroupOrderMap,
  b: ForwardGroupOrderMap,
): boolean => {
  const aKeys = Object.keys(a).sort(compareForwardTunnelNameAsc);
  const bKeys = Object.keys(b).sort(compareForwardTunnelNameAsc);

  if (!isSameStringArray(aKeys, bKeys)) {
    return false;
  }
  for (const key of aKeys) {
    if (!isSameStringArray(a[key] || [], b[key] || [])) {
      return false;
    }
  }

  return true;
};
const isSameGroupCollapsedMap = (
  a: ForwardGroupCollapsedMap,
  b: ForwardGroupCollapsedMap,
): boolean => {
  const aKeys = Object.keys(a).sort(compareForwardTunnelNameAsc);
  const bKeys = Object.keys(b).sort(compareForwardTunnelNameAsc);

  if (!isSameStringArray(aKeys, bKeys)) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
};
const normalizeForwardItems = (items: Forward[]): Forward[] => {
  return items.map((forward) => ({
    ...forward,
    serviceRunning: forward.status === 1,
  }));
};
const mapForwardApiItems = (items: ForwardApiItem[]): Forward[] => {
  return (items || []).map((forward) => ({
    id: forward.id,
    name: forward.name,
    tunnelId: forward.tunnelId ?? 0,
    tunnelName: forward.tunnelName || "",
    tunnelTrafficRatio: normalizeTunnelTrafficRatio(forward.tunnelTrafficRatio),
    isManualTunnel: forward.isManualTunnel === true,
    inIp: forward.inIp || "",
    inPort: forward.inPort ?? 0,
    remoteAddr: forward.remoteAddr || "",
    strategy: typeof forward.strategy === "string" ? forward.strategy : "fifo",
    status: typeof forward.status === "number" ? forward.status : 0,
    inFlow: forward.inFlow ?? 0,
    outFlow: forward.outFlow ?? 0,
    createdTime:
      typeof forward.createdTime === "string" ? forward.createdTime : "",
    userName:
      typeof forward.userName === "string" ? forward.userName : undefined,
    userRemark:
      typeof (forward as any).userRemark === "string"
        ? (forward as any).userRemark
        : undefined,
    userId: typeof forward.userId === "number" ? forward.userId : undefined,
    inx: typeof forward.inx === "number" ? forward.inx : undefined,
    speedId:
      typeof forward.speedId === "number" || forward.speedId === null
        ? forward.speedId
        : undefined,
    serviceRunning: forward.status === 1,
    maxConnections: forward.maxConnections ?? 0,
    currentConnections: forward.currentConnections ?? 0,
    trafficLimit: forward.trafficLimit ?? 0,
    expiryTime: forward.expiryTime ?? null,
    speedLimitEnabled: forward.speedLimitEnabled ?? false,
    speedLimit: forward.speedLimit ?? 0,
    inSpeed: (forward as any).inSpeed ?? 0,
    outSpeed: (forward as any).outSpeed ?? 0,
    mode: (forward as any).mode || "gost",
  }));
};
const SortableTunnelGroupContainer = ({
  groupUserId,
  tunnel,
  collapsed,
  onToggleCollapsed,
  wrapperClassName,
  headerClassName,
  titleClassName,
  //countClassName,//注释隧道分组头部规则数量显示，保持界面简洁
  bodyClassName,
  children,
}: {
  groupUserId: number;
  tunnel: ForwardTunnelGroup;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  wrapperClassName: string;
  headerClassName: string;
  titleClassName: string;
  countClassName: string;
  bodyClassName: string;
  children: React.ReactNode;
}) => {
  const sortableId = buildTunnelGroupSortableId(groupUserId, tunnel.tunnelKey);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });
  const style: React.CSSProperties = {
    transform: transform
      ? CSS.Transform.toString({
          ...transform,
          x: Math.round(transform.x),
          y: Math.round(transform.y),
        })
      : undefined,
    transition: isDragging ? undefined : transition || undefined,
    opacity: isDragging ? 0.55 : 1,
    willChange: isDragging ? "transform" : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} className={wrapperClassName} style={style}>
      <div
        className={`${headerClassName} cursor-pointer select-none transition-colors`}
        onClick={onToggleCollapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Button
            isIconOnly
            aria-label={collapsed ? "展开分组" : "折叠分组"}
            className="h-7 w-7 min-w-7 pointer-events-none"
            size="sm"
            variant="flat"
          >
            <svg
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : "rotate-0"}`}
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
          {tunnel.isManualTunnel && <ManualTunnelChip />}
          <span className={titleClassName}>
            {formatRemoteDisplayText(tunnel.tunnelName)}
          </span>
          {/* 隧道倍率标识 - 统一 10px 字体 */}
          <span className="text-primary-600 font-bold text-[10px] mr-1.5">
            ^{formatTunnelTrafficRatio(tunnel.tunnelTrafficRatio)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 注释隧道分组头部规则数量显示，保持界面简洁
          <span className={countClassName}>{tunnel.items.length} 个规则</span> 
          */}
          <div
            className="cursor-grab active:cursor-grabbing p-1 text-default-400 flex-shrink-0 hover:text-default-600 transition-colors"
            title="拖拽分组排序"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
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
      </div>
      {!collapsed && <div className={bodyClassName}>{children}</div>}
    </div>
  );
};
// 可拖拽的规则卡片组件
const SortableForwardCard = ({ forward, renderCard }: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: forward.id });
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
    <div ref={setNodeRef} className="h-full" style={style} {...attributes}>
      {renderCard(forward, listeners)}
    </div>
  );
};

function extractAddressHost(address: string): string {
  return formatAddressHost(address);
}

function getIngressDisplayAddresses(inIp: string, fallbackPort: number) {
  const entries = (inIp || "")
    .replace(/\s/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return {
      hosts: "默认IP",
      endpoints: `默认IP:${fallbackPort}`,
    };
  }

  return {
    hosts: entries.map(formatAddressHost).join(","),
    endpoints: entries
      .map((entry) => {
        const parsed = splitAddressHostPort(entry);

        return parsed.port ? entry : formatInAddress(entry, fallbackPort);
      })
      .join(","),
  };
}

// 地址脱敏：IPv4/域名显示 a.b.*，IPv6 保留最后3段
function maskAddress(addr: string): string {
  if (!addr) return addr;
  const trimmed = extractAddressHost(addr);

  if (trimmed.includes(":")) {
    const parts = trimmed.split(":").filter(Boolean);

    if (parts.length > 3) return "*:" + parts.slice(-3).join(":");

    return trimmed;
  }
  // IPv4 和域名统一: a.b.*
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");

    if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;

    return parts[0].length > 12 ? parts[0].slice(0, 12) + "..." : parts[0];
  }

  return trimmed.length > 15 ? trimmed.slice(0, 15) + "..." : trimmed;
}

// 可拖拽的表格行组件
const SortableTableRow = ({
  copyToClipboard,
  forward,
  selectedIds,
  toggleSelect,
  handleServiceToggle,
  handleEdit,
  handleCopy,
  handleViewTrafficResetLogs,
  handleDelete,
  handleDiagnose,
  formatFlow,
  formatSpeed,
  isAdmin,
  togglingIds,
  showAddressModal,
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: forward.id });
  const style = {
    transform: transform
      ? CSS.Transform.toString({
          ...transform,
          x: Math.round(transform.x),
          y: Math.round(transform.y),
        })
      : undefined,
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
    willChange: isDragging ? "transform" : undefined,
    backgroundColor: isDragging ? "var(--nextui-default-100)" : undefined,
  };
  const rowBg = selectedIds.has(forward.id)
    ? "bg-primary-50/70 dark:bg-primary-900/40"
    : "";
  const { hosts: inAddrNoPorts, endpoints: inAddrWithPorts } =
    getIngressDisplayAddresses(forward.inIp, forward.inPort);
  const remoteAddrOnly = extractAddressHost(
    forward.remoteAddr.split(",")[0] || "",
  );
  const remotePortOnly =
    forward.remoteAddr.split(",")[0].match(/:(\d+)$/)?.[1] || "-";

  return (
    <TableRow key={forward.id} ref={setNodeRef} style={style as any}>
      <TableCell className={`w-12 px-1 ${rowBg}`}>
        <div className="flex items-center justify-center h-full">
          <Checkbox
            isSelected={selectedIds.has(forward.id)}
            onValueChange={() => toggleSelect(forward.id)}
          />
        </div>
      </TableCell>
      <TableCell className={`w-12 px-1 text-center ${rowBg}`}>
        <div
          className="mx-auto flex w-fit cursor-grab active:cursor-grabbing p-1 text-default-400 flex-shrink-0 hover:text-default-600 transition-colors"
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
      {/* 用户名单元格 */}
      {isAdmin && (
        <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
          <span className="text-sm text-foreground">
            {forward.userRemark && forward.userRemark.trim()
              ? forward.userRemark.trim()
              : forward.userName || "-"}
          </span>
        </TableCell>
      )}
      <TableCell className={`whitespace-nowrap px-1 text-foreground ${rowBg}`}>
        <span
          className="inline-flex items-center gap-1.5 cursor-pointer hover:text-primary transition-colors text-foreground text-sm"
          onClick={() => copyToClipboard(forward.name, "规则名称")}
        >
          <ForwardModeChip mode={forward.mode} />
          {forward.name}
        </span>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <svg
            className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(
                inAddrWithPorts.split(",").join("\n"),
                "完整入口",
              );
            }}
          >
            <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <span
            className="flex items-center gap-1 cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
            onClick={() =>
              copyToClipboard(inAddrNoPorts.split(",").join("\n"), "入口地址")
            }
          >
            <SmartTooltip content={inAddrNoPorts}>
              <span className="text-sm font-medium text-foreground truncate shrink min-w-0 max-w-[130px] inline-block">
                {maskAddress(
                  inAddrNoPorts.split(",").length > 1
                    ? inAddrNoPorts.split(",")[0].trim()
                    : inAddrNoPorts,
                )}
              </span>
            </SmartTooltip>
            {inAddrNoPorts.split(",").length > 1 && (
              <span
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium bg-default-200 text-default-600 rounded-full shrink-0 cursor-pointer hover:bg-default-300 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  showAddressModal(inAddrNoPorts, forward.inPort, "入口地址");
                }}
              >
                +{inAddrNoPorts.split(",").length - 1}
              </span>
            )}
          </span>
        </div>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <span
          className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
          onClick={() => copyToClipboard(forward.inPort.toString(), "入口端口")}
        >
          {forward.inPort}
        </span>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <svg
            className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(forward.remoteAddr.split(",")[0], "完整落地");
            }}
          >
            <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <SmartTooltip content={remoteAddrOnly}>
            <span
              className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 max-w-[130px] inline-block"
              onClick={() => copyToClipboard(remoteAddrOnly, "落地地址")}
            >
              {maskAddress(remoteAddrOnly)}
            </span>
          </SmartTooltip>
          {forward.remoteAddr.includes(",") && (
            <span className="text-primary-400 ml-0.5">...</span>
          )}
        </div>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <span
          className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
          onClick={() => copyToClipboard(remotePortOnly, "落地端口")}
        >
          {remotePortOnly}
        </span>
      </TableCell>
      <TableCell className={`w-[110px] whitespace-nowrap px-1 ${rowBg}`}>
        <div className="flex items-center gap-1">
          <Button
            isIconOnly
            className="w-6 h-6 min-w-6"
            size="sm"
            variant="flat"
            onPress={() => handleViewTrafficResetLogs(forward)}
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M19 9l-7 7-7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
          <span className="text-sm font-medium text-foreground">
            {formatFlow(getForwardDisplayFlow(forward))}
          </span>
        </div>
      </TableCell>
      <TableCell className={`w-[120px] whitespace-nowrap px-1 ${rowBg}`}>
        <div className="flex flex-col gap-1 w-full">
          <span
            className="block w-full min-w-[80px] min-h-[20px] px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400"
            title="上行带宽"
          >
            <span className="mr-1">↑</span>
            {formatSpeed(forward.inSpeed || 0)}
          </span>
          <span
            className="block w-full min-w-[80px] min-h-[20px] px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400"
            title="下行带宽"
          >
            <span className="mr-1">↓</span>
            {formatSpeed(forward.outSpeed || 0)}
          </span>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
        <div className="flex justify-center">
          <ConnectionCountCell
            current={forward.currentConnections ?? 0}
            max={forward.maxConnections ?? 0}
          />
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
        <span
          className={`text-sm font-medium ${forward.expiryTime && forward.expiryTime > 0 && isExpirySoon(forward.expiryTime) ? "text-danger-600 dark:text-danger-400 font-bold" : "text-foreground"}`}
        >
          {formatExpiryTime(forward.expiryTime)}
        </span>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <div className="flex items-center justify-center gap-2.5 whitespace-nowrap">
          <div
            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${forward.serviceRunning ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-warning-500/10 text-warning-600 dark:text-warning-400"}`}
          >
            {forward.serviceRunning ? "正常" : "暂停"}
          </div>
        </div>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex justify-start gap-1.5">
          <Button
            className="min-h-7 px-2"
            color={forward.serviceRunning ? "success" : "warning"}
            isLoading={togglingIds?.has(forward.id)}
            size="sm"
            title={forward.serviceRunning ? "暂停" : "启用"}
            variant="flat"
            onPress={() => handleServiceToggle(forward)}
          >
            {forward.serviceRunning ? "暂停" : "启用"}
          </Button>
          <Button
            className="min-h-7 px-2"
            color="primary"
            size="sm"
            title="编辑"
            variant="flat"
            onPress={() => handleEdit(forward)}
          >
            编辑
          </Button>
          <Button
            className="min-h-7 px-2"
            color="warning"
            size="sm"
            title="复制"
            variant="flat"
            onPress={() => handleCopy(forward)}
          >
            复制
          </Button>
          <Button
            className="min-h-7 px-2"
            color="secondary"
            size="sm"
            title="诊断"
            variant="flat"
            onPress={() => handleDiagnose(forward)}
          >
            诊断
          </Button>
          <Button
            className="min-h-7 px-2"
            color="danger"
            size="sm"
            title="删除"
            variant="flat"
            onPress={() => handleDelete(forward)}
          >
            删除
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};
const SortableCompactTableRow = ({
  copyToClipboard,
  forward,
  selectedIds,
  toggleSelect,
  handleServiceToggle,
  handleEdit,
  handleCopy,
  handleViewTrafficResetLogs,
  handleDelete,
  handleDiagnose,
  formatFlow,
  formatSpeed,
  isAdmin,
  togglingIds,
  showAddressModal,
}: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: forward.id });
  const style = {
    transform: transform
      ? CSS.Transform.toString({
          ...transform,
          x: Math.round(transform.x),
          y: Math.round(transform.y),
        })
      : undefined,
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
    willChange: isDragging ? "transform" : undefined,
    backgroundColor: isDragging ? "var(--nextui-default-100)" : undefined,
  };
  const rowBg = selectedIds.has(forward.id)
    ? "bg-primary-50/70 dark:bg-primary-900/40"
    : "";
  const { hosts: inAddrNoPorts, endpoints: inAddrWithPorts } =
    getIngressDisplayAddresses(forward.inIp, forward.inPort);
  const remoteAddrOnly = extractAddressHost(
    forward.remoteAddr.split(",")[0] || "",
  );
  const remotePortOnly =
    forward.remoteAddr.split(",")[0].match(/:(\d+)$/)?.[1] || "-";

  return (
    <TableRow key={forward.id} ref={setNodeRef} style={style as any}>
      <TableCell className={`w-12 px-1 ${rowBg}`}>
        <div className="flex items-center justify-center h-full">
          <Checkbox
            isSelected={selectedIds.has(forward.id)}
            onValueChange={() => toggleSelect(forward.id)}
          />
        </div>
      </TableCell>
      <TableCell className={`w-12 px-1 text-center ${rowBg}`}>
        <div
          className="mx-auto flex w-fit cursor-grab active:cursor-grabbing p-1 text-default-400 flex-shrink-0 hover:text-default-600 transition-colors"
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
      {/* 添加用户名单元格 */}
      {isAdmin && (
        <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
          <span className="text-sm text-foreground">
            {forward.userRemark && forward.userRemark.trim()
              ? forward.userRemark.trim()
              : forward.userName || "-"}
          </span>
        </TableCell>
      )}
      <TableCell className={`whitespace-nowrap px-1 text-foreground ${rowBg}`}>
        <span
          className="inline-flex items-center gap-1.5 cursor-pointer hover:text-primary transition-colors text-foreground text-sm"
          onClick={() => copyToClipboard(forward.name, "规则名称")}
        >
          <ForwardModeChip mode={forward.mode} />
          {forward.name}
        </span>
      </TableCell>
      <TableCell className={`whitespace-nowrap px-1 ${rowBg}`}>
        <div className="flex items-center">
          {forward.isManualTunnel && <ManualTunnelChip className="mr-1.5" />}
          <span className="font-medium text-foreground text-sm">
            {formatRemoteDisplayText(forward.tunnelName)}
          </span>
          {/* 隧道倍率标识 - 统一 10px 字体 */}
          <span className="text-primary-600 font-bold text-[10px] ml-1.5">
            ^{formatTunnelTrafficRatio(forward.tunnelTrafficRatio)}
          </span>
        </div>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <svg
            className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(
                inAddrWithPorts.split(",").join("\n"),
                "完整入口",
              );
            }}
          >
            <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <span
            className="flex items-center gap-1 cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
            onClick={() =>
              copyToClipboard(inAddrNoPorts.split(",").join("\n"), "入口地址")
            }
          >
            <SmartTooltip content={inAddrNoPorts}>
              <span className="text-sm font-medium text-foreground truncate shrink min-w-0 max-w-[130px] inline-block">
                {maskAddress(
                  inAddrNoPorts.split(",").length > 1
                    ? inAddrNoPorts.split(",")[0].trim()
                    : inAddrNoPorts,
                )}
              </span>
            </SmartTooltip>
            {inAddrNoPorts.split(",").length > 1 && (
              <span
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium bg-default-200 text-default-600 rounded-full shrink-0 cursor-pointer hover:bg-default-300 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  showAddressModal(inAddrNoPorts, forward.inPort, "入口地址");
                }}
              >
                +{inAddrNoPorts.split(",").length - 1}
              </span>
            )}
          </span>
        </div>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <span
          className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
          onClick={() => copyToClipboard(forward.inPort.toString(), "入口端口")}
        >
          {forward.inPort}
        </span>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <svg
            className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(forward.remoteAddr.split(",")[0], "完整落地");
            }}
          >
            <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          <SmartTooltip content={remoteAddrOnly}>
            <span
              className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 max-w-[130px] inline-block"
              onClick={() => copyToClipboard(remoteAddrOnly, "落地地址")}
            >
              {maskAddress(remoteAddrOnly)}
            </span>
          </SmartTooltip>
          {forward.remoteAddr.includes(",") && (
            <span className="text-primary-400 ml-0.5">...</span>
          )}
        </div>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <span
          className="text-sm font-medium text-foreground cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors"
          onClick={() => copyToClipboard(remotePortOnly, "落地端口")}
        >
          {remotePortOnly}
        </span>
      </TableCell>
      <TableCell className={`w-[110px] whitespace-nowrap px-1 ${rowBg}`}>
        <div className="flex items-center gap-1">
          <Button
            isIconOnly
            className="w-6 h-6 min-w-6"
            size="sm"
            variant="flat"
            onPress={() => handleViewTrafficResetLogs(forward)}
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M19 9l-7 7-7-7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
          <span className="text-sm font-medium text-foreground">
            {formatFlow(getForwardDisplayFlow(forward))}
          </span>
        </div>
      </TableCell>
      <TableCell className={`w-[120px] whitespace-nowrap px-1 ${rowBg}`}>
        <div className="flex flex-col gap-1 w-full">
          <span
            className="block w-full min-w-[80px] min-h-[20px] px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400"
            title="上行带宽"
          >
            <span className="mr-1">↑</span>
            {formatSpeed(forward.inSpeed || 0)}
          </span>
          <span
            className="block w-full min-w-[80px] min-h-[20px] px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400"
            title="下行带宽"
          >
            <span className="mr-1">↓</span>
            {formatSpeed(forward.outSpeed || 0)}
          </span>
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
        <div className="flex justify-center">
          <ConnectionCountCell
            current={forward.currentConnections ?? 0}
            max={forward.maxConnections ?? 0}
          />
        </div>
      </TableCell>
      <TableCell className={`whitespace-nowrap px-1 text-center ${rowBg}`}>
        <span
          className={`text-sm font-medium ${forward.expiryTime && forward.expiryTime > 0 && isExpirySoon(forward.expiryTime) ? "text-danger-600 dark:text-danger-400 font-bold" : "text-foreground"}`}
        >
          {formatExpiryTime(forward.expiryTime)}
        </span>
      </TableCell>
      <TableCell className={`px-1 text-center ${rowBg}`}>
        <div className="flex items-center justify-center gap-2.5 whitespace-nowrap">
          <div
            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${forward.serviceRunning ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-warning-500/10 text-warning-600 dark:text-warning-400"}`}
          >
            {forward.serviceRunning ? "正常" : "暂停"}
          </div>
        </div>
      </TableCell>
      <TableCell className={`px-1 ${rowBg}`}>
        <div className="flex justify-start gap-1.5">
          <Button
            className="min-h-7 px-2"
            color={forward.serviceRunning ? "success" : "warning"}
            isLoading={togglingIds?.has(forward.id)}
            size="sm"
            title={forward.serviceRunning ? "暂停" : "启用"}
            variant="flat"
            onPress={() => handleServiceToggle(forward)}
          >
            {forward.serviceRunning ? "暂停" : "启用"}
          </Button>
          <Button
            className="min-h-7 px-2"
            color="primary"
            size="sm"
            title="编辑"
            variant="flat"
            onPress={() => handleEdit(forward)}
          >
            编辑
          </Button>
          <Button
            className="min-h-7 px-2"
            color="warning"
            size="sm"
            title="复制"
            variant="flat"
            onPress={() => handleCopy(forward)}
          >
            复制
          </Button>
          <Button
            className="min-h-7 px-2"
            color="secondary"
            size="sm"
            title="诊断"
            variant="flat"
            onPress={() => handleDiagnose(forward)}
          >
            诊断
          </Button>
          <Button
            className="min-h-7 px-2"
            color="danger"
            size="sm"
            title="删除"
            variant="flat"
            onPress={() => handleDelete(forward)}
          >
            删除
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};
const getForwardDisplayFlow = (forward: Forward): number => {
  return (forward.inFlow || 0) + (forward.outFlow || 0);
};

export default function ForwardPage() {
  const tokenUserId = JwtUtil.getUserIdFromToken();
  const tokenRoleId = JwtUtil.getRoleIdFromToken();
  const isAdmin = tokenRoleId === 0;
  const [searchParams, setSearchParams] = useLocalStorageState(
    "forward-search-params",
    {
      name: "",
      userId: tokenUserId ? tokenUserId.toString() : "all",
      tunnelId: "all",
      speedLimitId: undefined as number | undefined,
      inPort: "",
      remoteAddr: "",
    },
  );
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  // 工具栏搜索框状态
  const [isSearchVisible, setIsSearchVisible] = useLocalStorageState(
    "forward-search-visible",
    false,
  );
  const [searchKeyword, setSearchKeyword] = useLocalStorageState(
    "forward-search-keyword",
    "",
  );
  const activeFilterCount =
    (searchParams.name ? 1 : 0) +
    (searchParams.userId !== "all" &&
    searchParams.userId !== (tokenUserId ? tokenUserId.toString() : "all")
      ? 1
      : 0) +
    (searchParams.tunnelId !== "all" ? 1 : 0) +
    (searchParams.speedLimitId !== undefined ? 1 : 0) +
    (searchParams.inPort ? 1 : 0) +
    (searchParams.remoteAddr ? 1 : 0) +
    (searchKeyword.trim() ? 1 : 0);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [forwards, setForwards] = useState<Forward[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [allTunnels, setAllTunnels] = useState<Tunnel[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodeGroups, setNodeGroups] = useState<NodeGroupApiItem[]>([]);
  const [speedLimits, setSpeedLimits] = useState<SpeedLimitApiItem[]>([]);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [userForwardSpeedLimit, setUserForwardSpeedLimit] = useState<number>(0);
  const [forwardPage, setForwardPage] = useState(1);
  const [forwardPageSize, setForwardPageSize] = useLocalStorageState(
    "forwardPageSize",
    10,
  );
  const [groupPage, setGroupPage] = useState(1);
  const [groupPageSize, setGroupPageSize] = useState(10);
  //   const isMobile = useMobileBreakpoint();
  // searchKeyword removed
  // isSearchVisible removed
  const [compactMode, setCompactMode] = useState(false);

  // 用户切换时归零筛选条件
  useEffect(() => {
    const currentUserId = tokenUserId ? tokenUserId.toString() : null;
    const prevUserId = localStorage.getItem("forward-last-user-id");

    // 只有用户真正切换时才归零（不是页面刷新）
    if (prevUserId !== null && prevUserId !== currentUserId) {
      setSearchParams({
        name: "",
        userId: currentUserId || "all",
        tunnelId: "all",
        speedLimitId: undefined,
        inPort: "",
        remoteAddr: "",
      });
    }
    // 保存当前用户 ID 到 localStorage
    localStorage.setItem("forward-last-user-id", currentUserId || "");
  }, [tokenUserId, setSearchParams]);
  // 显示模式状态 - 从localStorage读取，默认为平铺显示
  const [viewMode, setViewMode] = useState<"grouped" | "direct">(() => {
    try {
      const savedMode = localStorage.getItem("forward-view-mode");

      return (savedMode as "grouped" | "direct") || "direct";
    } catch {
      return "direct";
    }
  });
  // 筛选状态
  // filterUserId removed
  // filterTunnelId removed
  // 拖拽排序相关状态
  const [forwardOrder, setForwardOrder] = useState<number[]>([]);
  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  // isFilterModalOpen removed
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [isCopy, setIsCopy] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [forwardToDelete, setForwardToDelete] = useState<Forward | null>(null);
  const [currentDiagnosisForward, setCurrentDiagnosisForward] =
    useState<Forward | null>(null);
  const [diagnosisResult, setDiagnosisResult] =
    useState<ForwardDiagnosisResult | null>(null);
  const [diagnosisProgress, setDiagnosisProgress] = useState({
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    timedOut: false,
  });
  const diagnosisAbortRef = useRef<AbortController | null>(null);
  const isTogglingRef = useRef(false);
  const instanceStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const [addressModalTitle, setAddressModalTitle] = useState("");
  const [addressList, setAddressList] = useState<ForwardAddressItem[]>([]);
  // 导出相关状态
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportData, setExportData] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedTunnelForExport, setSelectedTunnelForExport] = useState<
    number | null
  >(null);

  // 导入相关状态
  type ImportFormat = "FLOX" | "ny";
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>("FLOX");
  const [selectedTunnelForImport, setSelectedTunnelForImport] = useState<
    number | null
  >(null);
  const [importResults, setImportResults] = useState<
    Array<{
      line: string;
      success: boolean;
      message: string;
      forwardName?: string;
    }>
  >([]);
  // 表单状态（持久化草稿）
  const [form, setForm, resetDraft] = useLocalStorageState<ForwardForm>(
    "forward-create-draft",
    createForwardFormDefaults(),
  );
  const [inIpTouched, setInIpTouched] = useState(false);
  // 表单验证错误
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [forwardModeEnabled, setForwardModeEnabled] = useState(
    getForwardModeEnabledState,
  );
  const [manualTunnelEnabled, setManualTunnelEnabled] = useState(isAdmin);
  // 批量操作相关状态
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchChangeTunnelModalOpen, setBatchChangeTunnelModalOpen] =
    useState(false);
  const [batchTargetTunnelId, setBatchTargetTunnelId] = useState<number | null>(
    null,
  );
  const isFreeTier = licenseInfo?.tier === "free";
  const nftEnabled = forwardModeEnabled.nft;
  const flcEnabled = forwardModeEnabled.flc;
  const sdwEnabled = forwardModeEnabled.sdw;
  const wgmEnabled = forwardModeEnabled.wgm;
  const canUseManualTunnel = isAdmin || manualTunnelEnabled;
  const [batchRedeployLoading, setBatchRedeployLoading] = useState(false);
  const [batchPauseLoading, setBatchPauseLoading] = useState(false);
  const [batchResumeLoading, setBatchResumeLoading] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [batchChangeTunnelLoading, setBatchChangeTunnelLoading] =
    useState(false);
  // 批量归零相关状态
  const [batchResetTrafficLoading, setBatchResetTrafficLoading] =
    useState(false);
  const [batchResetTrafficModalOpen, setBatchResetTrafficModalOpen] =
    useState(false);
  // 批量切换模式相关状态
  const [batchChangeModeModalOpen, setBatchChangeModeModalOpen] =
    useState(false);
  const [batchTargetMode, setBatchTargetMode] = useState<string>("gost");
  const [batchChangeModeLoading, setBatchChangeModeLoading] = useState(false);
  // 流量归零日志相关状态
  const [trafficResetLogModalOpen, setTrafficResetLogModalOpen] =
    useState(false);
  const [trafficResetLogsLoading, setTrafficResetLogsLoading] = useState(false);
  const [trafficResetLogs, setTrafficResetLogs] = useState<any[]>([]);
  const [currentLogForward, setCurrentLogForward] = useState<Forward | null>(
    null,
  );
  const trafficResetLogsGenerationRef = useRef(0);
  const [deleteLogModalOpen, setDeleteLogModalOpen] = useState(false);
  const [logToDelete, setLogToDelete] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgressState>({
    active: false,
    label: "",
    percent: 0,
  });
  const [batchResultModal, setBatchResultModal] =
    useState<BatchResultModalState>(EMPTY_BATCH_RESULT_MODAL_STATE);
  const openBatchResultModal = useCallback(
    (
      title: string,
      summary: string,
      failures: BatchOperationFailure[],
      skipped: BatchOperationFailure[] = [],
    ) => {
      setBatchResultModal({
        failures,
        open: true,
        skipped,
        summary,
        title,
      });
    },
    [],
  );
  const [groupOrderMap, setGroupOrderMap] = useState<ForwardGroupOrderMap>({});
  const [collapsedTunnelGroups, setCollapsedTunnelGroups] =
    useState<ForwardGroupCollapsedMap>({});
  const [groupPreferenceHydrated, setGroupPreferenceHydrated] = useState(false);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [tunnelSelectMode, setTunnelSelectMode] = useState<
    "existing" | "manual"
  >("existing");
  const refreshManualTunnelPermission = useCallback(async () => {
    if (isAdmin) {
      setManualTunnelEnabled(true);

      return;
    }
    try {
      const response = await getUserPackageInfo();
      const data = response.data as
        | { userInfo?: { canCreateManualTunnel?: boolean } }
        | undefined;
      const allowed = data?.userInfo?.canCreateManualTunnel === true;

      setManualTunnelEnabled(allowed);
      if (!allowed) {
        setTunnelSelectMode("existing");
        setNodes([]);
        setNodeGroups([]);
      }
    } catch {}
  }, [isAdmin]);
  const [editingOriginalManualTunnelId, setEditingOriginalManualTunnelId] =
    useState<number | null>(null);
  const [manualTunnelType, setManualTunnelType] = useState<1 | 2>(2);
  const [manualInNodeId, setManualInNodeId] = useState<ChainTunnel[]>([]);
  const [manualInIp, setManualInIp] = useState("");
  const [manualChainNodes, setManualChainNodes] = useState<ChainTunnel[][]>([]);
  const [manualOutNodeId, setManualOutNodeId] = useState<ChainTunnel[]>([]);
  const [manualFocusedInputs, setManualFocusedInputs] = useState<
    Record<string, string>
  >({});
  const parseNodeIPs = (node?: Node): string[] => {
    if (!node) {
      return [];
    }
    const ips: string[] = [];
    const add = (value?: string) => {
      const trimmed = (value || "").trim();

      if (trimmed) {
        ips.push(trimmed);
      }
    };

    add(node.serverIpV4);
    add(node.serverIpV6);
    add(node.serverIp);
    (node.extraIPs || "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v)
      .forEach((v) => ips.push(v));

    return Array.from(new Set(ips));
  };
  const tunnelInIpOptionMap = useMemo(() => {
    const map = new Map<number, string[]>();
    const nodeMap = new Map<number, Node>(nodes.map((n) => [n.id, n]));

    for (const tunnel of allTunnels) {
      const collected: string[] = [];
      const entryNodes = tunnel.inNodeId || [];

      for (const entry of entryNodes) {
        collected.push(...parseNodeIPs(nodeMap.get(entry.nodeId)));
      }
      if (collected.length === 0) {
        (tunnel.inIp || "")
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v)
          .forEach((v) => collected.push(v));
      }
      map.set(tunnel.id, Array.from(new Set(collected)));
    }

    return map;
  }, [allTunnels, nodes]);
  const currentTunnelIpOptions = useMemo(() => {
    if (!form.tunnelId) {
      return [];
    }

    return tunnelInIpOptionMap.get(form.tunnelId) || [];
  }, [form.tunnelId, tunnelInIpOptionMap]);
  const isCurrentTunnelMultiEntrance = useMemo(() => {
    if (!form.tunnelId) {
      return false;
    }
    const currentTunnel = allTunnels.find(
      (tunnel) => tunnel.id === form.tunnelId,
    );

    return (currentTunnel?.inNodeId?.length || 0) > 1;
  }, [allTunnels, form.tunnelId]);
  const currentTunnelPortRange = useMemo(() => {
    if (!form.tunnelId) {
      return null;
    }
    const currentTunnel = allTunnels.find(
      (tunnel) => tunnel.id === form.tunnelId,
    );

    if (
      currentTunnel?.portRangeMin &&
      currentTunnel?.portRangeMax &&
      currentTunnel.portRangeMin > 0 &&
      currentTunnel.portRangeMax > 0
    ) {
      return {
        min: currentTunnel.portRangeMin,
        max: currentTunnel.portRangeMax,
      };
    }

    return null;
  }, [allTunnels, form.tunnelId]);
  const currentEffectiveSpeedLimit = useMemo(() => {
    if (isAdmin || !form.tunnelId) return 0;

    const tunnelLimit = allTunnels.find(
      (tunnel) => tunnel.id === form.tunnelId,
    )?.forwardSpeedLimit;
    const t =
      typeof tunnelLimit === "number" && tunnelLimit > 0 ? tunnelLimit : 0;
    const u = userForwardSpeedLimit > 0 ? userForwardSpeedLimit : 0;

    if (t > 0 && u > 0) return Math.min(t, u);
    if (t > 0) return t;
    if (u > 0) return u;

    return 0;
  }, [allTunnels, form.tunnelId, isAdmin, userForwardSpeedLimit]);
  const currentTunnelCeilingSpeed = useMemo(() => {
    if (isAdmin || !form.tunnelId) return 0;
    const ceiling = allTunnels.find(
      (tunnel) => tunnel.id === form.tunnelId,
    )?.ceilingSpeed;

    return typeof ceiling === "number" && ceiling > 0 ? ceiling : 0;
  }, [allTunnels, form.tunnelId, isAdmin]);

  useEffect(() => {
    if (currentEffectiveSpeedLimit <= 0) return;

    setForm((prev) =>
      prev.speedLimit === currentEffectiveSpeedLimit && prev.speedLimitEnabled
        ? prev
        : {
            ...prev,
            speedLimit: currentEffectiveSpeedLimit,
            speedLimitEnabled: true,
          },
    );
  }, [currentEffectiveSpeedLimit]);
  const resetManualTunnelState = () => {
    setTunnelSelectMode("existing");
    setEditingOriginalManualTunnelId(null);
    setManualTunnelType(2);
    setManualInNodeId([]);
    setManualInIp("");
    setManualChainNodes([]);
    setManualOutNodeId([]);
    setManualFocusedInputs({});
  };
  const isManualTunnel = (tunnel?: Tunnel | null): boolean => {
    if (!tunnel) return false;

    const remark = tunnel.remark || "";
    const name = tunnel.name || "";

    return (
      remark.includes(MANUAL_TUNNEL_REMARK) ||
      remark.includes(LEGACY_MANUAL_TUNNEL_REMARK) ||
      name.startsWith(`${MANUAL_TUNNEL_REMARK}-`) ||
      name.startsWith(`${LEGACY_MANUAL_TUNNEL_REMARK}-`)
    );
  };
  const toSelectedNodeIds = (keys: Iterable<unknown>): number[] => {
    return Array.from(keys)
      .map((key) => Number.parseInt(String(key), 10))
      .filter((nodeId) => Number.isFinite(nodeId));
  };
  const mergeOrderedManualNodes = (
    previous: ChainTunnel[],
    selectedIds: number[],
    chainType: number,
  ): ChainTunnel[] => {
    const previousMap = new Map(previous.map((item) => [item.nodeId, item]));
    const currentProtocol =
      previous.find((item) => item.protocol)?.protocol || "tcp";
    const currentStrategy =
      previous.find((item) => item.strategy)?.strategy || "round";

    return selectedIds.slice(0, 1).map((nodeId, index) => ({
      ...(previousMap.get(nodeId) || {}),
      nodeId,
      chainType,
      inx: index + 1,
      protocol: previousMap.get(nodeId)?.protocol || currentProtocol,
      strategy: previousMap.get(nodeId)?.strategy || currentStrategy,
    }));
  };
  const parsePortsFromInput = (value: string): number[] => {
    if (!value || value.trim() === "") return [];

    return value
      .split(",")
      .map((p) => p.trim())
      .map((p) => {
        if (p === "") return 0;
        const port = parseInt(p, 10);

        return isNaN(port) ? 0 : port;
      });
  };
  const formatManualPortsToDisplay = (items: ChainTunnel[]): string => {
    if (!items || items.length === 0) return "";
    const ports = items.map((item) =>
      item.port && item.port > 0 ? item.port.toString() : "",
    );

    if (ports.every((port) => port === "")) return "";

    return ports.join(",");
  };
  const applyPortsToManualNodes = (
    items: ChainTunnel[],
    value: string,
  ): ChainTunnel[] => {
    const ports = parsePortsFromInput(value);

    return items.map((item, idx) => ({
      ...item,
      port: idx < ports.length && ports[idx] > 0 ? ports[idx] : undefined,
    }));
  };
  const formatConnectIpTypesToDisplay = (items: ChainTunnel[]): string => {
    if (!items || items.length === 0) return "";
    const types = items.map((item) => item.connectIpType || "");

    if (types.every((type) => type === "")) return "";

    return types.join(",");
  };
  const applyConnectIpTypesToManualNodes = (
    items: ChainTunnel[],
    value: string,
  ): ChainTunnel[] => {
    if (!value || value.split(",").every((item) => !item.trim())) {
      return items.map((item) => ({ ...item, connectIpType: "" }));
    }
    const types = value.split(",").map((item) => item.trim());

    return items.map((item, idx) => ({
      ...item,
      connectIpType: idx < types.length ? types[idx] : "",
    }));
  };
  const getManualSelectedNodeIds = (exclude?: {
    role: "entry" | "chain" | "exit";
    groupIndex?: number;
  }): number[] => {
    const ids: number[] = [];

    if (exclude?.role !== "entry") {
      ids.push(...manualInNodeId.map((item) => item.nodeId));
    }
    manualChainNodes.forEach((group, groupIndex) => {
      if (exclude?.role === "chain" && exclude.groupIndex === groupIndex) {
        return;
      }
      ids.push(...group.map((item) => item.nodeId));
    });
    if (exclude?.role !== "exit") {
      ids.push(...manualOutNodeId.map((item) => item.nodeId));
    }

    return ids;
  };
  const buildManualDisabledKeys = (exclude: {
    role: "entry" | "chain" | "exit";
    groupIndex?: number;
  }): string[] => {
    const used = new Set(getManualSelectedNodeIds(exclude));

    return nodes
      .filter((node) => node.status !== 1 || used.has(node.id))
      .map((node) => node.id.toString());
  };
  const renderNodeSelectHeader = () => (
    <div className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(56px,0.45fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-2 text-left">
      <span className="w-full text-left text-foreground font-semibold">
        节点名称
      </span>
      <span className="w-full text-center text-foreground font-semibold">
        倍率
      </span>
      <span className="w-full text-center text-foreground font-semibold">
        分组
      </span>
      <span className="w-full text-center text-foreground font-semibold">
        备注
      </span>
    </div>
  );
  const renderManualNodeItems = (exclude: {
    role: "entry" | "chain" | "exit";
    groupIndex?: number;
  }) => {
    const used = new Set(getManualSelectedNodeIds(exclude));

    return nodes.map((node) => {
      const group = nodeGroups.find((item) => item.id === node.groupId);
      const isRemote = Number(node.isRemote || 0) === 1;
      const groupName = isRemote ? "远程组" : group?.name || "未分组";
      const groupColor = isRemote
        ? "#a855f7"
        : ((group as any)?.color as string | undefined);
      const displayName = formatRemoteDisplayText(node.name);
      const hasRemoteSuffix = /\s\(Rem\)$/i.test(displayName);

      return (
        <SelectItem
          key={node.id}
          textValue={
            isRemote
              ? `${displayName}${hasRemoteSuffix ? "" : " (Rem)"}`
              : displayName
          }
        >
          <div className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(56px,0.45fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-2 items-center text-left text-sm">
            <span className="w-full min-w-0 truncate text-left">
              {displayName}
              {isRemote && !hasRemoteSuffix && (
                <span className="ml-1 text-[11px] text-purple-600 dark:text-purple-400">
                  (Rem)
                </span>
              )}
              {used.has(node.id) && (
                <span className="ml-1 text-[11px] text-primary-600">已选</span>
              )}
              {node.status !== 1 && (
                <span className="ml-1 text-[11px] text-default-500">离线</span>
              )}
            </span>
            <span className="w-full min-w-0 text-center text-default-600">
              {(node.trafficRatio || 1).toFixed(2).replace(/\.00$/, "")}x
            </span>
            <span className="w-full min-w-0 text-center">
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium"
                style={
                  groupColor
                    ? { backgroundColor: `${groupColor}1A`, color: groupColor }
                    : undefined
                }
              >
                {groupName}
              </span>
            </span>
            <span className="w-full min-w-0 truncate text-center text-default-500">
              {node.remark || "-"}
            </span>
          </div>
        </SelectItem>
      );
    });
  };
  const cleanManualNodes = (items: ChainTunnel[], chainType: number) =>
    items.slice(0, 1).map((item, index) => ({
      nodeId: item.nodeId,
      chainType,
      inx: index + 1,
      protocol: item.protocol || "tcp",
      strategy: item.strategy || "round",
      port: item.port,
      connectIpType: item.connectIpType || "",
      connect_ip_type: item.connectIpType || "",
    }));
  const normalizeManualNodes = (items?: ChainTunnel[]) =>
    (items || []).slice(0, 1);
  const normalizeManualChainNodes = (groups?: ChainTunnel[][]) =>
    (groups || []).map((group) => normalizeManualNodes(group));
  const validateManualTunnel = (newErrors: { [key: string]: string }) => {
    const selectedIds = [
      ...manualInNodeId.map((item) => item.nodeId),
      ...manualChainNodes.flatMap((group) => group.map((item) => item.nodeId)),
      ...manualOutNodeId.map((item) => item.nodeId),
    ];
    const selectedSet = new Set<number>();

    if (manualInNodeId.length === 0) {
      newErrors.manualInNodeId = "请选择一个入口节点";
    }
    if (manualTunnelType === 2) {
      manualChainNodes.forEach((group, index) => {
        if (group.length === 0) {
          newErrors[`manualChainNodes_${index}`] = `请选择第${index + 1}跳节点`;
        }
      });
      if (manualOutNodeId.length === 0) {
        newErrors.manualOutNodeId = "请选择一个出口节点";
      }
    }
    for (const nodeId of selectedIds) {
      if (selectedSet.has(nodeId)) {
        newErrors.manualTunnel = "入口、转发链、出口节点不能重复";
        break;
      }
      selectedSet.add(nodeId);
      const node = nodes.find((item) => item.id === nodeId);

      if (node && node.status !== 1) {
        newErrors.manualTunnel = "所有手动隧道节点必须在线";
        break;
      }
    }
    const validatePorts = (
      items: ChainTunnel[],
      key: string,
      label: string,
    ) => {
      const invalid = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.port !== undefined && item.port !== null)
        .filter(({ item }) => {
          const port = item.port as number;

          return !Number.isInteger(port) || port < 1 || port > 65535;
        });

      if (invalid.length > 0) {
        newErrors[key] = `${label}端口必须在 1-65535 范围内`;
      }
    };

    if (manualTunnelType === 2) {
      manualChainNodes.forEach((group, index) => {
        validatePorts(group, `manualChainPort_${index}`, `第${index + 1}跳`);
      });
      validatePorts(manualOutNodeId, "manualOutPort", "出口");
    }
  };

  useEffect(() => {
    return () => {
      diagnosisAbortRef.current?.abort();
      diagnosisAbortRef.current = null;
      if (instanceStatusTimerRef.current) {
        clearTimeout(instanceStatusTimerRef.current);
        instanceStatusTimerRef.current = null;
      }
    };
  }, []);
  const persistGroupOrderToLocal = (nextOrderMap: ForwardGroupOrderMap) => {
    if (tokenUserId === null) {
      return;
    }
    try {
      localStorage.setItem(
        buildForwardGroupOrderLocalKey(tokenUserId),
        JSON.stringify(nextOrderMap),
      );
    } catch {}
  };
  const persistGroupCollapsedToLocal = (
    nextCollapsedMap: ForwardGroupCollapsedMap,
  ) => {
    if (tokenUserId === null) {
      return;
    }
    try {
      localStorage.setItem(
        buildForwardGroupCollapsedLocalKey(tokenUserId),
        JSON.stringify(nextCollapsedMap),
      );
    } catch {}
  };
  const persistGroupOrderToGlobal = async (
    nextOrderMap: ForwardGroupOrderMap,
  ): Promise<void> => {
    if (!isAdmin || tokenUserId === null) {
      return;
    }
    try {
      const currentRes = await getConfigByName(FORWARD_GROUP_ORDER_CONFIG_KEY);
      const globalMap =
        parsePreferenceMap<ForwardGroupOrderMap>(
          currentRes.code === 0 && typeof currentRes.data?.value === "string"
            ? currentRes.data.value
            : null,
        ) || {};

      globalMap[tokenUserId.toString()] = nextOrderMap;
      const saveRes = await updateConfig(
        FORWARD_GROUP_ORDER_CONFIG_KEY,
        JSON.stringify(globalMap),
      );

      if (saveRes.code !== 0) {
        toast.error(saveRes.msg || "保存分组排序失败");
      }
    } catch {
      toast.error("保存分组排序失败");
    }
  };
  const persistGroupCollapsedToGlobal = async (
    nextCollapsedMap: ForwardGroupCollapsedMap,
  ): Promise<void> => {
    if (!isAdmin || tokenUserId === null) {
      return;
    }
    try {
      const currentRes = await getConfigByName(
        FORWARD_GROUP_COLLAPSED_CONFIG_KEY,
      );
      const globalMap =
        parsePreferenceMap<ForwardGroupCollapsedMap>(
          currentRes.code === 0 && typeof currentRes.data?.value === "string"
            ? currentRes.data.value
            : null,
        ) || {};

      globalMap[tokenUserId.toString()] = nextCollapsedMap;
      const saveRes = await updateConfig(
        FORWARD_GROUP_COLLAPSED_CONFIG_KEY,
        JSON.stringify(globalMap),
      );

      if (saveRes.code !== 0) {
        toast.error(saveRes.msg || "保存分组折叠状态失败");
      }
    } catch {
      toast.error("保存分组折叠状态失败");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadGroupPreferences = async () => {
      if (tokenUserId === null) {
        if (!cancelled) {
          setGroupOrderMap({});
          setCollapsedTunnelGroups({});
          setGroupPreferenceHydrated(true);
        }

        return;
      }
      let localOrderMap: ForwardGroupOrderMap = {};
      let localCollapsedMap: ForwardGroupCollapsedMap = {};

      try {
        localOrderMap = parseGroupOrderMap(
          localStorage.getItem(buildForwardGroupOrderLocalKey(tokenUserId)),
        );
      } catch {
        localOrderMap = {};
      }
      try {
        localCollapsedMap = parseGroupCollapsedMap(
          localStorage.getItem(buildForwardGroupCollapsedLocalKey(tokenUserId)),
        );
      } catch {
        localCollapsedMap = {};
      }
      if (isAdmin) {
        try {
          const [globalOrderRes, globalCollapsedRes] = await Promise.all([
            getConfigByName(FORWARD_GROUP_ORDER_CONFIG_KEY),
            getConfigByName(FORWARD_GROUP_COLLAPSED_CONFIG_KEY),
          ]);
          const globalOrderMap = parsePreferenceMap<ForwardGroupOrderMap>(
            globalOrderRes.code === 0 &&
              typeof globalOrderRes.data?.value === "string"
              ? globalOrderRes.data.value
              : null,
          );
          const globalCollapsedMap =
            parsePreferenceMap<ForwardGroupCollapsedMap>(
              globalCollapsedRes.code === 0 &&
                typeof globalCollapsedRes.data?.value === "string"
                ? globalCollapsedRes.data.value
                : null,
            );
          const globalOrderBucket = globalOrderMap?.[tokenUserId.toString()];
          const globalCollapsedBucket =
            globalCollapsedMap?.[tokenUserId.toString()];

          if (
            globalOrderBucket &&
            typeof globalOrderBucket === "object" &&
            !Array.isArray(globalOrderBucket)
          ) {
            localOrderMap = parseGroupOrderMap(
              JSON.stringify(globalOrderBucket),
            );
          }
          if (
            globalCollapsedBucket &&
            typeof globalCollapsedBucket === "object" &&
            !Array.isArray(globalCollapsedBucket)
          ) {
            localCollapsedMap = parseGroupCollapsedMap(
              JSON.stringify(globalCollapsedBucket),
            );
          }
        } catch {}
      }
      if (cancelled) {
        return;
      }
      setGroupOrderMap(localOrderMap);
      setCollapsedTunnelGroups(localCollapsedMap);
      persistGroupOrderToLocal(localOrderMap);
      persistGroupCollapsedToLocal(localCollapsedMap);
      setGroupPreferenceHydrated(true);
    };

    setGroupPreferenceHydrated(false);
    loadGroupPreferences();

    return () => {
      cancelled = true;
    };
  }, [tokenUserId, isAdmin]);
  useEffect(() => {
    const loadForwardCompactMode = async () => {
      try {
        const response = await getConfigByName(FORWARD_COMPACT_MODE_CONFIG_KEY);
        const enabled =
          response.code === 0 &&
          typeof response.data?.value === "string" &&
          response.data.value === "true";

        setCompactMode(enabled);
      } catch {
        setCompactMode(false);
      }
    };
    const handleCompactModeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;

      if (typeof customEvent.detail?.enabled === "boolean") {
        setCompactMode(customEvent.detail.enabled);
      }
    };

    loadForwardCompactMode();
    window.addEventListener(
      FORWARD_COMPACT_MODE_EVENT,
      handleCompactModeChanged,
    );

    return () => {
      window.removeEventListener(
        FORWARD_COMPACT_MODE_EVENT,
        handleCompactModeChanged,
      );
    };
  }, []);

  // 3形态模式切换（分组 -> 列表 -> 卡片）
  const handleModeCycle = async () => {
    let nextCompact = compactMode;
    let nextView = viewMode;

    if (!compactMode && viewMode === "grouped") {
      nextCompact = true; // 1. 分组 -> 列表
    } else if (compactMode && viewMode === "grouped") {
      nextView = "direct"; // 2. 列表 -> 卡片
    } else {
      nextCompact = false; // 3. 卡片 -> 分组
      nextView = "grouped";
    }

    // 保存列表/卡片状态
    setViewMode(nextView);
    try {
      localStorage.setItem("forward-view-mode", nextView);
    } catch {}

    // 保存精简/分组状态
    if (nextCompact !== compactMode) {
      setCompactMode(nextCompact);
      try {
        await updateConfig(
          FORWARD_COMPACT_MODE_CONFIG_KEY,
          nextCompact ? "true" : "false",
        );
        window.dispatchEvent(
          new CustomEvent(FORWARD_COMPACT_MODE_EVENT, {
            detail: { enabled: nextCompact },
          }),
        );
      } catch (e) {
        // 非管理员或网络错误忽略
      }
    }
  };

  // 根据当前状态推断按钮文本和颜色
  const getModeButtonConfig = () => {
    if (!compactMode && viewMode === "grouped")
      return { text: "分组", color: "primary" };
    if (compactMode && viewMode === "grouped")
      return { text: "列表", color: "success" };
    if (compactMode && viewMode === "direct")
      return { text: "卡片", color: "secondary" };

    return { text: "分组", color: "primary" };
  };
  const modeBtnConfig = getModeButtonConfig();
  // 切换精简模式
  const applyForwardList = useCallback(
    async (items: Forward[]) => {
      const normalized = normalizeForwardItems(items);
      const displayItems = normalized;

      setForwards(displayItems);
      const { order, fromDatabase } = buildForwardOrder(displayItems, null);

      setForwardOrder(order);
      if (fromDatabase) {
        saveOrder(FORWARD_ORDER_KEY, order);
      }
    },
    [],
  );
  const refreshForwardList = useCallback(
    async (lod = true) => {
      if (lod) setLoading(true);
      try {
        const params = {}; // 永远拉取全量数据，用于本地过滤和拖拽排序
        const forwardsRes = await getForwardList(params);

        if (forwardsRes.code === 0) {
          await applyForwardList(
            mapForwardApiItems(forwardsRes.data?.items ?? []),
          );
        } else {
          toast.error(forwardsRes.msg || "获取规则列表失败");
        }
      } catch {
        toast.error("获取规则列表失败");
      } finally {
        if (lod) setLoading(false);
      }
    },
    [applyForwardList],
  );
  // 加载所有数据
  const loadData = useCallback(
    async (lod = true) => {
      setLoading(lod);
      try {
        const params = {}; // 永远拉取全量数据
        const [
          tunnelsRes,
          forwardsRes,
          speedLimitsRes,
          licenseRes,
          packageRes,
        ] = await Promise.all([
          userTunnel(),
          getForwardList(params),
          getSpeedLimitList(),
          getLicenseInfo(),
          isAdmin ? Promise.resolve({ code: -1 }) : getUserPackageInfo(),
        ]);

        if (tunnelsRes.code === 0) {
          const visibleTunnels = (tunnelsRes.data || [])
            .map(mapForwardTunnel)
            .filter((tunnel) => !isManualTunnel(tunnel));

          setTunnels(visibleTunnels);
          setAllTunnels(visibleTunnels);
        }
        if (forwardsRes.code === 0) {
          await applyForwardList(
            mapForwardApiItems(forwardsRes.data?.items ?? []),
          );
        }
        if (speedLimitsRes.code === 0)
          setSpeedLimits(speedLimitsRes.data || []);
        if (licenseRes.code === 0) {
          setLicenseInfo(licenseRes.data || null);
        }
        if (
          packageRes?.code === 0 &&
          (packageRes as Record<string, unknown>).data
        ) {
          const pkgData = (packageRes as Record<string, unknown>)
            .data as Record<string, unknown>;
          const userInfo = pkgData.userInfo as
            | Record<string, unknown>
            | undefined;
          const ufwd = userInfo
            ? (pkgData.userInfo as Record<string, unknown>).forwardSpeedLimit
            : undefined;
          const limit = typeof ufwd === "number" && ufwd > 0 ? ufwd : 0;

          setUserForwardSpeedLimit(limit);
          setManualTunnelEnabled(
            isAdmin || userInfo?.canCreateManualTunnel === true,
          );
        }
        if (canUseManualTunnel) {
          const [nodesRes, nodeGroupsRes] = await Promise.all([
            getNodeList(),
            getNodeGroupList(),
          ]);

          if (nodesRes.code === 0) setNodes((nodesRes.data || []) as Node[]);
          if (nodeGroupsRes.code === 0) setNodeGroups(nodeGroupsRes.data || []);
        }
      } catch {
        toast.error("加载数据失败");
      } finally {
        setLoading(false);
      }
    },
    [applyForwardList, canUseManualTunnel, isAdmin],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    void refreshManualTunnelPermission();
    const refresh = () => {
      if (!document.hidden) void refreshManualTunnelPermission();
    };
    const interval = window.setInterval(refresh, 30_000);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshManualTunnelPermission]);

  const refreshNodes = useCallback(async () => {
    if (!canUseManualTunnel || document.hidden) return;
    try {
      const nodesRes = await getNodeList();

      if (nodesRes.code === 0) setNodes((nodesRes.data || []) as Node[]);
    } catch {}
  }, [canUseManualTunnel]);
  const nodesRef = useRef(nodes);
  const refreshNodesRef = useRef(refreshNodes);
  const refreshForwardListRef = useRef(refreshForwardList);
  nodesRef.current = nodes;
  refreshNodesRef.current = refreshNodes;
  refreshForwardListRef.current = refreshForwardList;
  const handleNodeRealtimeMessage = useCallback(
    (message: { id?: string | number; type?: string; data?: unknown }) => {
      const nodeId = Number(message.id);

      if (!Number.isFinite(nodeId)) return;
      if (message.type === "status") {
        const status = Number(message.data) === 1 ? 1 : 0;

        setNodes((prev) =>
          prev.map((node) => (node.id === nodeId ? { ...node, status } : node)),
        );
      } else if (message.type === "instance_status") {
        if (instanceStatusTimerRef.current) {
          clearTimeout(instanceStatusTimerRef.current);
        }
        instanceStatusTimerRef.current = setTimeout(() => {
          instanceStatusTimerRef.current = null;
          void refreshNodes();
        }, 500);
      }
    },
    [refreshNodes],
  );

  useNodeRealtime({
    onMessage: handleNodeRealtimeMessage,
    enabled: canUseManualTunnel,
  });

  useEffect(() => {
    if (
      !canUseManualTunnel ||
      !nodesRef.current.some((node) => node.isRemote === 1)
    )
      return;
    const interval = window.setInterval(
      () => void refreshNodesRef.current(),
      REMOTE_NODE_REFRESH_INTERVAL_MS,
    );

    return () => window.clearInterval(interval);
  }, [canUseManualTunnel]);

  useEffect(() => {
    const handleConfigUpdated = (event: Event) => {
      const changedKeys = (event as CustomEvent<{ changedKeys?: string[] }>)
        .detail?.changedKeys;

      if (
        changedKeys &&
        !changedKeys.some((key) => key.startsWith("forward_mode_"))
      ) {
        return;
      }
      setForwardModeEnabled(getForwardModeEnabledState());
    };

    window.addEventListener("configUpdated", handleConfigUpdated);

    return () => {
      window.removeEventListener("configUpdated", handleConfigUpdated);
    };
  }, []);

  useEffect(() => {
    if (isFreeTier) {
      if (form.mode !== "gost") {
        setForm((prev) => ({ ...prev, mode: "gost" }));
      }
      if (batchTargetMode !== "gost") {
        setBatchTargetMode("gost");
      }

      return;
    }
    if (form.mode === "nftables" && !nftEnabled) {
      setForm((prev) => ({ ...prev, mode: "gost" }));
    }
    if (form.mode === "floxcore" && !flcEnabled) {
      setForm((prev) => ({ ...prev, mode: "gost" }));
    }
    if (form.mode === "sdwan" && !sdwEnabled) {
      setForm((prev) => ({ ...prev, mode: "gost" }));
    }
    if (form.mode === "mimic" && !wgmEnabled) {
      setForm((prev) => ({ ...prev, mode: "gost" }));
    }
    if (batchTargetMode === "nftables" && !nftEnabled) {
      setBatchTargetMode("gost");
    }
    if (batchTargetMode === "floxcore" && !flcEnabled) {
      setBatchTargetMode("gost");
    }
    if (batchTargetMode === "sdwan" && !sdwEnabled) {
      setBatchTargetMode("gost");
    }
    if (batchTargetMode === "mimic" && !wgmEnabled) {
      setBatchTargetMode("gost");
    }
  }, [
    batchTargetMode,
    form.mode,
    isFreeTier,
    nftEnabled,
    flcEnabled,
    sdwEnabled,
    wgmEnabled,
    setForm,
  ]);

  usePullToRefresh(loadData);
  // 定时刷新连接数（每5秒）
  useEffect(() => {
    const interval = setInterval(() => {
      // 只在页面可见时刷新，且不在加载中
      if (!document.hidden && !loadingRef.current && !isTogglingRef.current) {
        refreshForwardListRef.current(false);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);
  // 表单验证
  const noLimitSpeedLimitIds = useMemo(() => {
    return new Set(
      speedLimits
        .filter(
          (speedLimit) =>
            speedLimit.status === undefined || speedLimit.status === 1,
        )
        .filter(isNoLimitSpeedRule)
        .map((speedLimit) => speedLimit.id),
    );
  }, [speedLimits]);
  const speedLimitIds = useMemo(() => {
    return new Set(speedLimits.map((speedLimit) => speedLimit.id));
  }, [speedLimits]);
  const normalizeSpeedId = (speedId?: number | null): number | null => {
    if (speedId === null || speedId === undefined) {
      return null;
    }
    if (noLimitSpeedLimitIds.has(speedId)) {
      return null;
    }
    if (speedLimits.length > 0 && !speedLimitIds.has(speedId)) {
      return null;
    }

    return speedId;
  };
  const isMissingSpeedLimit = (speedId?: number | null): boolean => {
    if (speedId === null || speedId === undefined) {
      return false;
    }
    if (speedLimits.length === 0 || noLimitSpeedLimitIds.has(speedId)) {
      return false;
    }

    return !speedLimitIds.has(speedId);
  };
  // const selectedSpeedId = normalizeSpeedId(form.speedId); // 已弃用
  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!form.name.trim()) {
      newErrors.name = "请输入规则名称";
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = "规则名称长度应在2-50个字符之间";
    }
    if (tunnelSelectMode === "manual") {
      validateManualTunnel(newErrors);
    } else if (!form.tunnelId) {
      newErrors.tunnelId = "请选择关联隧道";
    }
    if (
      form.inPort !== null &&
      form.inPort !== undefined &&
      form.inPort > 0 &&
      currentTunnelPortRange
    ) {
      if (
        form.inPort < currentTunnelPortRange.min ||
        form.inPort > currentTunnelPortRange.max
      ) {
        newErrors.inPort = `端口 ${currentTunnelPortRange.min}-${currentTunnelPortRange.max} 超出允许范围`;
      }
    }
    if (!form.remoteAddr.trim()) {
      newErrors.remoteAddr = "请输入落地地址";
    } else {
      // 验证地址格式
      const addresses = form.remoteAddr
        .split("\n")
        .map((addr) => addr.trim())
        .filter((addr) => addr);
      const ipv4Pattern =
        /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):\d+$/;
      const ipv6FullPattern =
        /^\[((([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:))|(([0-9a-fA-F]{1,4}:){6}(:[0-9a-fA-F]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){5}(((:[0-9a-fA-F]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){4}(((:[0-9a-fA-F]{1,4}){1,3})|((:[0-9a-fA-F]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){3}(((:[0-9a-fA-F]{1,4}){1,4})|((:[0-9a-fA-F]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){2}(((:[0-9a-fA-F]{1,4}){1,5})|((:[0-9a-fA-F]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){1}(((:[0-9a-fA-F]{1,4}){1,6})|((:[0-9a-fA-F]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-fA-F]{1,4}){1,7})|((:[0-9a-fA-F]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))\]:\d+$/;
      const domainPattern =
        /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*:\d+$/;

      for (let i = 0; i < addresses.length; i++) {
        const addr = addresses[i];

        if (
          !ipv4Pattern.test(addr) &&
          !ipv6FullPattern.test(addr) &&
          !domainPattern.test(addr)
        ) {
          newErrors.remoteAddr = `第${i + 1}行地址格式错误`;
          break;
        }
      }
    }
    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };
  // 新增规则
  const handleAdd = () => {
    setIsEdit(false);
    setIsCopy(false);
    setInIpTouched(false);
    resetDraft();
    resetManualTunnelState();
    setErrors({});
    setModalOpen(true);
  };
  // 编辑规则
  const handleEdit = async (forward: Forward) => {
    setIsEdit(true);
    setIsCopy(false);
    setInIpTouched(false);
    resetManualTunnelState();
    setForm({
      id: forward.id,
      userId: forward.userId,
      name: forward.name,
      tunnelId: forward.tunnelId,
      inPort: forward.inPort,
      inIp: forward.inIp || "",
      remoteAddr: forward.remoteAddr.split(",").join("\n"),
      interfaceName: forward.interfaceName || "",
      strategy: forward.strategy || "fifo",
      speedId: normalizeSpeedId(forward.speedId),
      maxConnections: forward.maxConnections ?? 0,
      trafficLimit: forward.trafficLimit ?? 0,
      expiryTime: forward.expiryTime ?? null,
      speedLimitEnabled: forward.speedLimitEnabled ?? false,
      speedLimit: forward.speedLimit ?? 0,
      mode: forward.mode || "gost",
    });
    const localTunnel = allTunnels.find(
      (tunnel) => tunnel.id === forward.tunnelId,
    );
    let targetTunnel = localTunnel;

    if (!targetTunnel || isManualTunnel(targetTunnel)) {
      try {
        const tunnelRes = await getTunnelById(forward.tunnelId);

        if (tunnelRes.code === 0 && tunnelRes.data) {
          targetTunnel = mapForwardTunnel(tunnelRes.data);
        }
      } catch {}
    }
    if (isManualTunnel(targetTunnel)) {
      setTunnelSelectMode("manual");
      setEditingOriginalManualTunnelId(targetTunnel?.id ?? forward.tunnelId);
      setManualTunnelType(targetTunnel?.type === 1 ? 1 : 2);
      setManualInNodeId(normalizeManualNodes(targetTunnel?.inNodeId));
      setManualInIp((targetTunnel?.inIp || "").split(",").join("\n"));
      setManualChainNodes(normalizeManualChainNodes(targetTunnel?.chainNodes));
      setManualOutNodeId(normalizeManualNodes(targetTunnel?.outNodeId));
    } else {
      setTunnelSelectMode("existing");
      setEditingOriginalManualTunnelId(null);
    }
    setErrors({});
    setModalOpen(true);
  };
  // 复制规则
  const handleCopy = (forward: Forward) => {
    setIsEdit(false);
    setIsCopy(true);
    setInIpTouched(false);
    resetManualTunnelState();
    setForm({
      userId: forward.userId,
      name: forward.name,
      tunnelId: forward.tunnelId,
      inPort: null,
      inIp: forward.inIp || "",
      remoteAddr: forward.remoteAddr.split(",").join("\n"),
      interfaceName: forward.interfaceName || "",
      strategy: forward.strategy || "fifo",
      speedId: normalizeSpeedId(forward.speedId),
      maxConnections: forward.maxConnections ?? 0,
      trafficLimit: forward.trafficLimit ?? 0,
      expiryTime: forward.expiryTime ?? null,
      speedLimitEnabled: forward.speedLimitEnabled ?? false,
      speedLimit: forward.speedLimit ?? 0,
      mode: forward.mode || "gost",
    });
    setErrors({});
    setModalOpen(true);
  };
  // 查看流量归零日志
  const handleViewTrafficResetLogs = async (forward: Forward) => {
    const generation = ++trafficResetLogsGenerationRef.current;

    setTrafficResetLogsLoading(true);
    setCurrentLogForward(forward);
    try {
      const res = await getForwardTrafficResetLogs(forward.id, 30);

      if (generation !== trafficResetLogsGenerationRef.current) return;
      if (res.code === 0) {
        setTrafficResetLogs(res.data?.logs || []);
        setTrafficResetLogModalOpen(true);
      } else {
        toast.error(res.msg || "获取日志失败");
      }
    } catch {
      if (generation === trafficResetLogsGenerationRef.current) {
        toast.error("网络错误，请重试");
      }
    } finally {
      if (generation === trafficResetLogsGenerationRef.current) {
        setTrafficResetLogsLoading(false);
      }
    }
  };
  // 删除流量归零日志
  const handleDeleteLog = async () => {
    if (!isAdmin || !logToDelete || !currentLogForward) return;
    const generation = trafficResetLogsGenerationRef.current;
    const forwardId = currentLogForward.id;

    try {
      const res = await deleteForwardTrafficResetLog(logToDelete);

      if (res.code === 0) {
        toast.success("删除成功");
        // 重新获取最新列表
        const refreshRes = await getForwardTrafficResetLogs(forwardId, 30);

        if (
          refreshRes.code === 0 &&
          generation === trafficResetLogsGenerationRef.current
        ) {
          setTrafficResetLogs(refreshRes.data?.logs || []);
        }
        setDeleteLogModalOpen(false);
        setLogToDelete(null);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };
  // 显示删除确认
  const handleDelete = (forward: Forward) => {
    setForwardToDelete(forward);
    setDeleteModalOpen(true);
  };
  // 确认删除规则
  const confirmDelete = async () => {
    if (!forwardToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await deleteForward(forwardToDelete.id);

      if (res.code === 0) {
        toast.success("删除成功");
        setDeleteModalOpen(false);
        setForwardToDelete(null);
        setForwards((prev) =>
          prev.filter((forward) => forward.id !== forwardToDelete.id),
        );
        setForwardOrder((prev) => {
          const next = prev.filter((id) => id !== forwardToDelete.id);

          saveOrder(FORWARD_ORDER_KEY, next);

          return next;
        });
        setSelectedIds((prev) => {
          const next = new Set(prev);

          next.delete(forwardToDelete.id);

          return next;
        });
      } else {
        // 删除失败，询问是否强制删除
        const confirmed = window.confirm(
          `常规删除失败：${res.msg || "删除失败"}\n\n是否需要强制删除？\n\n⚠️ 注意：强制删除不会去验证节点端是否已经删除对应的规则服务。`,
        );

        if (confirmed) {
          const forceRes = await forceDeleteForward(forwardToDelete.id);

          if (forceRes.code === 0) {
            toast.success("强制删除成功");
            setDeleteModalOpen(false);
            setForwardToDelete(null);
            setForwards((prev) =>
              prev.filter((forward) => forward.id !== forwardToDelete.id),
            );
            setForwardOrder((prev) => {
              const next = prev.filter((id) => id !== forwardToDelete.id);

              saveOrder(FORWARD_ORDER_KEY, next);

              return next;
            });
            setSelectedIds((prev) => {
              const next = new Set(prev);

              next.delete(forwardToDelete.id);

              return next;
            });
          } else {
            toast.error(forceRes.msg || "强制删除失败");
          }
        }
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleteLoading(false);
    }
  };
  // 处理隧道选择变化
  const handleTunnelChange = (tunnelId: string) => {
    if (tunnelId === MANUAL_TUNNEL_SELECT_KEY) {
      if (!canUseManualTunnel) {
        toast.error("自行组建隧道功能未开放");

        return;
      }
      setTunnelSelectMode("manual");
      setInIpTouched(false);
      setForm((prev) => ({ ...prev, tunnelId: null, inIp: "" }));

      return;
    }
    const nextTunnelId = parseInt(tunnelId);

    if (Number.isNaN(nextTunnelId)) {
      setForm((prev) => ({ ...prev, tunnelId: null, inIp: "" }));

      return;
    }
    const options = tunnelInIpOptionMap.get(nextTunnelId) || [];
    const selectedTunnel = allTunnels.find(
      (tunnel) => tunnel.id === nextTunnelId,
    );
    const tunnelLimit =
      !isAdmin &&
      selectedTunnel?.forwardSpeedLimit &&
      selectedTunnel.forwardSpeedLimit > 0
        ? selectedTunnel.forwardSpeedLimit
        : 0;
    const userLimit =
      !isAdmin && userForwardSpeedLimit > 0 ? userForwardSpeedLimit : 0;
    const inheritedSpeedLimit =
      tunnelLimit > 0 && userLimit > 0
        ? Math.min(tunnelLimit, userLimit)
        : tunnelLimit > 0
          ? tunnelLimit
          : userLimit;

    setTunnelSelectMode("existing");
    setInIpTouched(false);
    setForm((prev) => {
      const tunnelChanged = prev.tunnelId !== nextTunnelId;

      return {
        ...prev,
        tunnelId: nextTunnelId,
        inIp: tunnelChanged ? "" : options.includes(prev.inIp) ? prev.inIp : "",
        speedLimit:
          inheritedSpeedLimit || (tunnelChanged ? 0 : prev.speedLimit),
        speedLimitEnabled:
          inheritedSpeedLimit > 0 ||
          (tunnelChanged ? false : prev.speedLimitEnabled),
      };
    });
  };
  const buildManualTunnelName = () => {
    const nodeName = (nodeId: number) => {
      const node = nodes.find((item) => item.id === nodeId);

      return formatRemoteDisplayText(node?.name || `node${nodeId}`)
        .trim()
        .replace(/[\\/|:*?"<>\s]+/g, "-");
    };
    const ids = [
      ...manualInNodeId.map((item) => item.nodeId),
      ...manualChainNodes.flatMap((group) => group.map((item) => item.nodeId)),
      ...manualOutNodeId.map((item) => item.nodeId),
    ];
    const parts = ids.map(nodeName).filter(Boolean);

    return `DIY-${parts.length > 0 ? parts.join("-") : "nodes"}`.slice(0, 50);
  };
  const buildManualTunnelPayload = (tunnelId?: number | null) => {
    const cleanedChainNodes = manualChainNodes
      .map((group, groupIndex) =>
        cleanManualNodes(group, 2).map((item) => ({
          ...item,
          inx: groupIndex + 1,
        })),
      )
      .filter((group) => group.length > 0);
    const inIp = (manualInIp || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(",");

    return {
      ...(tunnelId ? { id: tunnelId } : {}),
      name: buildManualTunnelName(),
      type: manualTunnelType,
      status: 1,
      flow: 1,
      trafficRatio: 1,
      inIp,
      in_ip: inIp,
      inNodeId: cleanManualNodes(manualInNodeId, 1),
      outNodeId: cleanManualNodes(manualOutNodeId, 3),
      chainNodes: cleanedChainNodes,
      in_node_id: cleanManualNodes(manualInNodeId, 1),
      out_node_id: cleanManualNodes(manualOutNodeId, 3),
      chain_nodes: cleanedChainNodes,
      remark: `${MANUAL_TUNNEL_REMARK}：${form.name || "规则"}`,
      http: 0,
      tls: 0,
      socks: 0,
      blockOther: 0,
    };
  };
  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;

    // 检测 IPv6 地址：按行判断，避免多行域名误判
    const lines = form.remoteAddr
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const hasIPv6Target = lines.some(
      (line) => line.includes("[") || (line.match(/:/g) || []).length > 1,
    );

    if (form.mode === "nftables" && hasIPv6Target) {
      toast(
        "nftables 模式不支持 IPv4 客户端转发到 IPv6 落地机，请改用 gost 模式",
        {
          icon: "⚠️",
          duration: 5000,
        },
      );

      return;
    }

    let createdManualTunnelId: number | null = null;
    let createdManualTunnelReused = false;

    setSubmitLoading(true);
    try {
      const processedRemoteAddr = form.remoteAddr
        .split("\n")
        .map((addr) => addr.trim())
        .filter((addr) => addr)
        .join(",");
      const addressCount = processedRemoteAddr.split(",").length;
      let res: { code: number; msg: string };
      const normalizedSpeedId = normalizeSpeedId(form.speedId);
      const speedLimitAutoCleared = isMissingSpeedLimit(form.speedId);
      let submitTunnelId = form.tunnelId;

      if (tunnelSelectMode === "manual") {
        if (!canUseManualTunnel) {
          toast.error("自行组建隧道功能未开放");

          return;
        }
        const editableManualTunnelId = isEdit
          ? editingOriginalManualTunnelId
          : null;

        if (editableManualTunnelId) {
          const tunnelRes = await updateTunnel(
            buildManualTunnelPayload(editableManualTunnelId),
          );

          if (tunnelRes.code !== 0) {
            toast.error(tunnelRes.msg || "更新手动隧道失败");

            return;
          }
          submitTunnelId = editableManualTunnelId;
        } else {
          const tunnelRes = await createTunnel(buildManualTunnelPayload());

          if (tunnelRes.code !== 0 || !tunnelRes.data?.id) {
            toast.error(tunnelRes.msg || "创建手动隧道失败");

            return;
          }
          submitTunnelId = tunnelRes.data.id;
          createdManualTunnelId = tunnelRes.data.id;
          createdManualTunnelReused = Boolean((tunnelRes.data as any)?.reused);
        }
      }

      if (isEdit) {
        const updateData = {
          id: form.id,
          name: form.name,
          tunnelId: submitTunnelId,
          inPort: form.inPort,
          ...(inIpTouched ? { inIp: form.inIp || "" } : {}),
          remoteAddr: processedRemoteAddr,
          strategy: addressCount > 1 ? form.strategy : "fifo",
          speedId: normalizedSpeedId,
          maxConnections: form.maxConnections,
          trafficLimit: form.trafficLimit,
          expiryTime: form.expiryTime,
          speedLimitEnabled: form.speedLimit > 0,
          speedLimit: form.speedLimit > 0 ? form.speedLimit : 0,
          mode: form.mode,
        };

        res = await updateForward(updateData);
      } else {
        const createData: Record<string, unknown> = {
          name: form.name,
          tunnelId: submitTunnelId,
          inPort: form.inPort,
          inIp: form.inIp || undefined,
          remoteAddr: processedRemoteAddr,
          strategy: addressCount > 1 ? form.strategy : "fifo",
          speedId: normalizedSpeedId,
          maxConnections: form.maxConnections,
          trafficLimit: form.trafficLimit,
          expiryTime: form.expiryTime,
          speedLimitEnabled: form.speedLimit > 0,
          speedLimit: form.speedLimit > 0 ? form.speedLimit : 0,
          mode: form.mode,
        };

        if (isAdmin && form.userId) {
          createData.userId = form.userId;
        }

        res = await createForward(createData);
      }
      if (res.code === 0) {
        const warningItems = Array.isArray((res as any).data?.warnings)
          ? (res as any).data.warnings
              .map((item: unknown) =>
                typeof item === "string" ? item.trim() : "",
              )
              .filter((item: string) => item)
          : [];

        warningItems.forEach((warning: string) => {
          toast(warning, {
            icon: "⚠️",
            duration: 5000,
          });
        });
        if (speedLimitAutoCleared) {
          toast("所选限速规则不存在，已自动清除为不限速", {
            icon: "⚠️",
            duration: 5000,
          });
        }
        toast.success(isEdit ? "修改成功" : "创建成功");
        if (!isEdit && !isCopy) {
          resetDraft();
        }
        setModalOpen(false);
        await refreshForwardList(false);
      } else {
        toast.error(res.msg || "操作失败");
        if (createdManualTunnelId && !createdManualTunnelReused) {
          await deleteTunnel(createdManualTunnelId).catch(() => undefined);
        }
      }
    } catch {
      toast.error("操作失败");
      if (createdManualTunnelId && !createdManualTunnelReused) {
        await deleteTunnel(createdManualTunnelId).catch(() => undefined);
      }
    } finally {
      setSubmitLoading(false);
    }
  };
  // 处理服务开关
  const handleServiceToggle = async (forward: Forward) => {
    if (forward.status !== 1 && forward.status !== 0) {
      toast.error("规则状态异常，无法操作");

      return;
    }
    if (togglingIds.has(forward.id)) return; // 防止狂点

    const targetState = !forward.serviceRunning;

    isTogglingRef.current = true;
    setTogglingIds((prev) => new Set(prev).add(forward.id)); // 开启此行的 Loading

    try {
      let res: { code: number; msg: string };

      if (targetState) {
        res = await resumeForwardService(forward.id);
      } else {
        res = await pauseForwardService(forward.id);
      }

      if (res.code === 0) {
        toast.success(targetState ? "服务已启动" : "服务已暂停");
        setForwards((prev) =>
          prev.map((f) =>
            f.id === forward.id
              ? {
                  ...f,
                  serviceRunning: targetState,
                  status: targetState ? 1 : 0,
                }
              : f,
          ),
        );
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误，操作失败");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);

        next.delete(forward.id);

        return next;
      });
      isTogglingRef.current = false;
    }
  };
  // 诊断规则
  const handleDiagnose = async (forward: Forward) => {
    diagnosisAbortRef.current?.abort();
    const abortController = new AbortController();

    diagnosisAbortRef.current = abortController;
    setCurrentDiagnosisForward(forward);
    setDiagnosisModalOpen(true);
    setDiagnosisLoading(true);
    setDiagnosisProgress({
      total: 0,
      completed: 0,
      success: 0,
      failed: 0,
      timedOut: false,
    });
    setDiagnosisResult({
      forwardName: forward.name,
      timestamp: Date.now(),
      results: [],
    });
    try {
      let streamErrorMessage = "";
      const streamResult = await diagnoseForwardStream(
        forward.id,
        {
          onStart: (payload) => {
            const startForwardName =
              typeof payload.forwardName === "string" &&
              payload.forwardName.trim() !== ""
                ? payload.forwardName
                : forward.name;
            const startTotal = Number(payload.total);
            const startItems = Array.isArray(payload.items)
              ? (payload.items as ForwardDiagnosisResult["results"])
              : [];

            setDiagnosisResult((prev) => ({
              forwardName: startForwardName,
              timestamp: Date.now(),
              results: startItems.length > 0 ? startItems : prev?.results || [],
            }));
            if (Number.isFinite(startTotal) && startTotal >= 0) {
              setDiagnosisProgress((prev) => ({
                ...prev,
                total: startTotal,
              }));
            }
          },
          onItem: ({ index, result, progress }) => {
            setDiagnosisResult((prev) => {
              const base: ForwardDiagnosisResult = prev || {
                forwardName: forward.name,
                timestamp: Date.now(),
                results: [],
              };
              const nextResults = [...base.results];
              const existingIndex =
                Number.isInteger(index) &&
                index >= 0 &&
                index < nextResults.length
                  ? index
                  : nextResults.findIndex(
                      (item) =>
                        item.description === result.description &&
                        item.nodeId === result.nodeId &&
                        item.targetIp === result.targetIp &&
                        item.targetPort === result.targetPort &&
                        item.fromInstanceId === result.fromInstanceId &&
                        item.toInstanceId === result.toInstanceId,
                    );

              if (existingIndex >= 0) {
                nextResults[existingIndex] = {
                  ...result,
                  diagnosing: false,
                };
              } else {
                nextResults.push({
                  ...result,
                  diagnosing: false,
                });
              }

              return {
                ...base,
                timestamp: Date.now(),
                results: nextResults,
              };
            });
            setDiagnosisProgress({
              total: progress.total,
              completed: progress.completed,
              success: progress.success,
              failed: progress.failed,
              timedOut: Boolean(progress.timedOut),
            });
          },
          onDone: (progress) => {
            setDiagnosisProgress({
              total: progress.total,
              completed: progress.completed,
              success: progress.success,
              failed: progress.failed,
              timedOut: Boolean(progress.timedOut),
            });
          },
          onError: (message) => {
            streamErrorMessage = message;
          },
        },
        abortController.signal,
      );

      if (streamResult.fallback) {
        const response = await diagnoseForward(forward.id);

        if (response.code === 0) {
          const resultData = response.data as ForwardDiagnosisResult;
          const successCount = resultData.results.filter(
            (r) => r.success,
          ).length;
          const failedCount = resultData.results.length - successCount;

          setDiagnosisResult(resultData);
          setDiagnosisProgress({
            total: resultData.results.length,
            completed: resultData.results.length,
            success: successCount,
            failed: failedCount,
            timedOut: false,
          });
        } else {
          toast.error(response.msg || "诊断失败");
          setDiagnosisResult(
            buildForwardDiagnosisFallbackResult({
              forwardName: forward.name,
              remoteAddr: forward.remoteAddr,
              description: "诊断失败",
              message: response.msg || "诊断过程中发生错误",
            }),
          );
          setDiagnosisProgress({
            total: 1,
            completed: 1,
            success: 0,
            failed: 1,
            timedOut: false,
          });
        }

        return;
      }
      if (streamErrorMessage) {
        toast.error(streamErrorMessage);
      }
      if (streamResult.timedOut) {
        toast.error("诊断超时（单条30秒 / 整体2分钟），已返回当前结果");
      }
    } catch {
      if (abortController.signal.aborted) {
        return;
      }
      toast.error("网络错误，请重试");
      setDiagnosisResult(
        buildForwardDiagnosisFallbackResult({
          forwardName: forward.name,
          remoteAddr: forward.remoteAddr,
          description: "网络错误",
          message: "无法连接到服务器",
        }),
      );
      setDiagnosisProgress({
        total: 1,
        completed: 1,
        success: 0,
        failed: 1,
        timedOut: false,
      });
    } finally {
      if (diagnosisAbortRef.current === abortController) {
        diagnosisAbortRef.current = null;
      }
      setDiagnosisLoading(false);
    }
  };
  // 格式化流量
  const formatFlow = (value: number): string => {
    if (value === 0) return "0 B";
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(2) + " K";
    if (value < 1024 * 1024 * 1024)
      return (value / (1024 * 1024)).toFixed(2) + " M";
    if (value < 1024 * 1024 * 1024 * 1024)
      return (value / (1024 * 1024 * 1024)).toFixed(2) + " G";

    return (value / (1024 * 1024 * 1024 * 1024)).toFixed(2) + " T";
  };
  // 格式化带宽速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));

    return (
      parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    );
  };
  // 格式化日期时间
  const formatDateTime = (timestamp: number): string => {
    if (!timestamp) return "-";
    const date = new Date(timestamp);

    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  // 显示地址列表弹窗
  const showAddressModal = (
    addressString: string,
    port: number | null,
    title: string,
  ) => {
    const action = resolveForwardAddressAction(addressString, port, title);

    if (action.type === "none") {
      return;
    }
    if (action.type === "copy") {
      copyToClipboard(action.text, action.label);

      return;
    }
    setAddressList(action.items);
    setAddressModalTitle(action.title);
    setAddressModalOpen(true);
  };
  // 复制到剪贴板
  const copyToClipboard = (text: string, label: string = "内容") => {
    // 1. 安全环境 (HTTPS/localhost) 优先使用现代 API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast.success(`已复制${label}`))
        .catch(() => {
          window.prompt(`复制失败，请手动复制${label}：`, text);
        });

      return;
    }

    // 2. 非安全环境 (HTTP) 必须同步执行 execCommand，不能用 Promise 或 setTimeout，否则会丢失权限
    try {
      const ta = document.createElement("textarea");

      ta.value = text;
      // 完全隐藏
      ta.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0;";
      ta.setAttribute("readonly", "");

      // 🎯 核心破局点：将输入框挂载到当前获得焦点的元素（即被点击的按钮）内部！
      // 这样 textarea 就处在 Modal 内部，FocusTrap 就不会拦截它的焦点了
      const container =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body;

      container.appendChild(ta);

      ta.select();
      ta.setSelectionRange(0, 999999); // 兼容 iOS

      const ok = document.execCommand("copy");

      ta.remove();

      if (ok) {
        toast.success(`已复制${label}`);
      } else {
        window.prompt(`复制失败，请手动复制${label}：`, text);
      }
    } catch (err) {
      window.prompt(`复制失败，请手动复制${label}：`, text);
    }
  };
  const maskPublicIP = (ip: string): string => {
    if (!ip) return ip;
    if (ip.includes(":")) {
      const parts = ip.split(":").filter(Boolean);

      if (parts.length <= 3) return ip;

      return "*:" + parts.slice(-3).join(":");
    }
    const parts = ip.split(".");

    if (parts.length >= 3) return `${parts.slice(0, 2).join(".")}.*`;

    if (parts.length === 2) return `${parts[0]}.*`;

    return ip;
  };
  const getDiagnosisInstanceLine = (
    result: ForwardDiagnosisResult["results"][number],
  ): string => {
    const from =
      result.fromInstanceDisplayName ||
      (result.fromInstanceDisplayIndex
        ? `实例 ${result.fromInstanceDisplayIndex}`
        : result.fromInstanceId || "");
    const to =
      result.toInstanceDisplayName ||
      (result.toInstanceDisplayIndex
        ? `实例 ${result.toInstanceDisplayIndex}`
        : result.toInstanceId || "");
    const parts = [
      from ? `来源实例: ${from}` : "",
      to ? `目标实例: ${to}` : "",
      result.instanceRegion && result.instanceRegion !== "-"
        ? `地区: ${result.instanceRegion}`
        : "",
    ];

    return parts.filter(Boolean).join(" / ");
  };
  // 复制所有地址
  const copyAllAddresses = () => {
    if (addressList.length === 0) return;
    copyToClipboard(
      addressList.map((item) => item.address).join("\n"),
      "所有地址",
    );
  };
  // 导出规则数据
  const handleExport = () => {
    setSelectedTunnelForExport(null);
    setExportData("");
    setExportModalOpen(true);
  };
  // 执行导出
  const executeExport = () => {
    setExportLoading(true);
    try {
      // 获取要导出的规则列表：选择隧道则按隧道过滤，否则导出全部
      const forwardsToExport = selectedTunnelForExport
        ? sortedForwards.filter(
            (forward) => forward.tunnelId === selectedTunnelForExport,
          )
        : sortedForwards;

      if (forwardsToExport.length === 0) {
        toast.error(
          selectedTunnelForExport
            ? "所选隧道没有规则数据"
            : "没有可导出的规则数据",
        );
        setExportLoading(false);

        return;
      }
      // 格式化导出数据：remoteAddr|name|inPort
      const exportLines = forwardsToExport.map((forward) => {
        return `${forward.remoteAddr}|${forward.name}|${forward.inPort}`;
      });
      const exportText = exportLines.join("\n");

      setExportData(exportText);
    } catch {
      toast.error("导出失败");
    } finally {
      setExportLoading(false);
    }
  };
  // 复制导出数据
  const copyExportData = () => {
    copyToClipboard(exportData, "规则数据");
  };
  // 导入规则数据
  const handleImport = () => {
    setImportData("");
    setImportResults([]);
    setSelectedTunnelForImport(null);
    setImportModalOpen(true);
  };
  // 执行导入
  const executeImport = async () => {
    if (!importData.trim()) {
      toast.error("请输入要导入的数据");

      return;
    }
    if (!selectedTunnelForImport) {
      toast.error("请选择要导入的隧道");

      return;
    }
    setImportLoading(true);
    setImportResults([]);
    try {
      if (importFormat === "ny") {
        const parsedItems = parseNyFormatData(importData);

        if (parsedItems.length === 0) {
          toast.error("未解析到有效的ny格式数据");
          setImportLoading(false);

          return;
        }
        for (const item of parsedItems) {
          if (item.error) {
            setImportResults((prev) => [
              {
                line: item.line,
                success: false,
                message: item.error || "解析失败",
              },
              ...prev,
            ]);
            continue;
          }
          if (!item.parsed) {
            setImportResults((prev) => [
              {
                line: item.line,
                success: false,
                message: "解析失败",
              },
              ...prev,
            ]);
            continue;
          }
          const parsedNyItem = item.parsed;
          const nyForwardInput = convertNyItemToForwardInput(parsedNyItem);

          try {
            const response = await createForward({
              name: nyForwardInput.name,
              tunnelId: selectedTunnelForImport,
              inPort: nyForwardInput.inPort,
              remoteAddr: nyForwardInput.remoteAddr,
              strategy: nyForwardInput.strategy,
            });

            if (response.code === 0) {
              setImportResults((prev) => [
                {
                  line: item.line,
                  success: true,
                  message: `创建成功 (${parsedNyItem.dest.length}个目标)`,
                  forwardName: nyForwardInput.name,
                },
                ...prev,
              ]);
            } else {
              setImportResults((prev) => [
                {
                  line: item.line,
                  success: false,
                  message: response.msg || "创建失败",
                },
                ...prev,
              ]);
            }
          } catch {
            setImportResults((prev) => [
              {
                line: item.line,
                success: false,
                message: "网络错误，创建失败",
              },
              ...prev,
            ]);
          }
        }
      } else {
        const lines = importData
          .trim()
          .split("\n")
          .filter((line) => line.trim());

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const parts = line.split("|");

          if (parts.length < 2) {
            setImportResults((prev) => [
              {
                line,
                success: false,
                message: "格式错误：需要至少包含落地地址和规则名称",
              },
              ...prev,
            ]);
            continue;
          }
          const [remoteAddr, name, inPort] = parts;

          if (!remoteAddr.trim() || !name.trim()) {
            setImportResults((prev) => [
              {
                line,
                success: false,
                message: "落地地址和规则名称不能为空",
              },
              ...prev,
            ]);
            continue;
          }
          const addresses = remoteAddr.trim().split(",");
          const addressPattern = /^[^:]+:\d+$/;
          const isValidFormat = addresses.every((addr) =>
            addressPattern.test(addr.trim()),
          );

          if (!isValidFormat) {
            setImportResults((prev) => [
              {
                line,
                success: false,
                message:
                  "落地地址格式错误，应为 地址:端口 格式，多个地址用逗号分隔",
              },
              ...prev,
            ]);
            continue;
          }
          try {
            let portNumber: number | null = null;

            if (inPort && inPort.trim()) {
              const port = parseInt(inPort.trim());

              if (isNaN(port) || port < 1 || port > 65535) {
                setImportResults((prev) => [
                  {
                    line,
                    success: false,
                    message: "入口端口格式错误，应为1-65535之间的数字",
                  },
                  ...prev,
                ]);
                continue;
              }
              portNumber = port;
            }
            const response = await createForward({
              name: name.trim(),
              tunnelId: selectedTunnelForImport,
              inPort: portNumber,
              remoteAddr: remoteAddr.trim(),
              strategy: "fifo",
            });

            if (response.code === 0) {
              setImportResults((prev) => [
                {
                  line,
                  success: true,
                  message: "创建成功",
                  forwardName: name.trim(),
                },
                ...prev,
              ]);
            } else {
              setImportResults((prev) => [
                {
                  line,
                  success: false,
                  message: response.msg || "创建失败",
                },
                ...prev,
              ]);
            }
          } catch {
            setImportResults((prev) => [
              {
                line,
                success: false,
                message: "网络错误，创建失败",
              },
              ...prev,
            ]);
          }
        }
      }
      toast.success("导入执行完成");
      await refreshForwardList(false);
    } catch {
      toast.error("导入过程中发生错误");
    } finally {
      setImportLoading(false);
    }
  };
  // 获取状态显示
  const getStatusDisplay = (status: number) => {
    switch (status) {
      case 1:
        return { color: "success", text: "正常" };
      case 0:
        return { color: "warning", text: "暂停" };
      case -1:
        return { color: "danger", text: "异常" };
      default:
        return { color: "default", text: "未知" };
    }
  };
  // 获取策略显示
  const getStrategyDisplay = (strategy: string) => {
    switch (strategy) {
      case "fifo":
        return { color: "primary", text: "主备" };
      case "round":
        return { color: "success", text: "轮询" };
      case "rand":
        return { color: "warning", text: "随机" };
      case "hash":
        return { color: "default", text: "哈希" };
      default:
        return { color: "default", text: "未知" };
    }
  };
  // 获取地址数量
  const getAddressCount = (addressString: string): number => {
    if (!addressString) return 0;
    const addresses = addressString
      .split("\n")
      .map((addr) => addr.trim())
      .filter((addr) => addr);

    return addresses.length;
  };
  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!active || !over || active.id === over.id) return;
    const activeGroup = parseTunnelGroupSortableId(active.id);
    const overGroup = parseTunnelGroupSortableId(over.id);

    if (activeGroup && overGroup) {
      if (compactMode || !groupPreferenceHydrated) {
        return;
      }
      if (activeGroup.userId !== overGroup.userId) {
        return;
      }
      const userIdKey = activeGroup.userId.toString();
      const currentOrder = groupOrderMap[userIdKey] || [];
      const oldIndex = currentOrder.indexOf(activeGroup.tunnelKey);
      const newIndex = currentOrder.indexOf(overGroup.tunnelKey);

      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        return;
      }
      const moved = arrayMove(currentOrder, oldIndex, newIndex);
      const nextOrderMap: ForwardGroupOrderMap = {
        ...groupOrderMap,
        [userIdKey]: moved,
      };

      setGroupOrderMap(nextOrderMap);
      persistGroupOrderToLocal(nextOrderMap);
      void persistGroupOrderToGlobal(nextOrderMap);

      return;
    }
    // 确保 forwardOrder 存在且有效
    if (!forwardOrder || forwardOrder.length === 0) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);

    // 检查 ID 是否有效
    if (isNaN(activeId) || isNaN(overId)) return;
    const activeForward = forwards.find((forward) => forward.id === activeId);
    const overForward = forwards.find((forward) => forward.id === overId);
    const activeUserId = activeForward?.userId ?? 0;
    const overUserId = overForward?.userId ?? 0;
    const activeTunnelGroupKey = buildForwardTunnelGroupKey(
      activeForward?.tunnelName,
    );
    const overTunnelGroupKey = buildForwardTunnelGroupKey(
      overForward?.tunnelName,
    );

    // 非精简模式仅允许在同一用户+隧道分组内拖拽，避免混排
    if (!compactMode) {
      if (
        activeUserId !== overUserId ||
        activeTunnelGroupKey !== overTunnelGroupKey
      ) {
        return;
      }
    }
    let oldIndex: number;
    let newIndex: number;
    let currentOrder: number[];

    if (compactMode) {
      currentOrder = sortedForwards.map((f) => f.id);
      oldIndex = currentOrder.indexOf(activeId);
      newIndex = currentOrder.indexOf(overId);
    } else {
      currentOrder = forwardOrder;
      oldIndex = forwardOrder.indexOf(activeId);
      newIndex = forwardOrder.indexOf(overId);
    }
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);

      if (!compactMode) {
        setForwardOrder(newOrder);
        saveOrder(FORWARD_ORDER_KEY, newOrder);
      }
      // 持久化到数据库
      try {
        const forwardsToUpdate = newOrder.map((id, index) => ({
          id,
          inx: index + 1,
        }));
        const response = await updateForwardOrder({
          forwards: forwardsToUpdate,
        });

        if (response.code === 0) {
          // 更新本地数据中的 inx 字段
          setForwards((prev) =>
            prev.map((forward) => {
              const updatedForward = forwardsToUpdate.find(
                (f) => f.id === forward.id,
              );

              if (updatedForward) {
                return { ...forward, inx: updatedForward.inx };
              }

              return forward;
            }),
          );
        } else {
          toast.error("保存排序失败：" + (response.msg || "未知错误"));
        }
      } catch {
        toast.error("保存排序失败，请重试");
      }
    }
  };
  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);

    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
  };
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleteLoading(true);
    setBatchProgress({
      active: true,
      label: `正在删除 ${selectedIds.size} 项规则...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchDelete(Array.from(selectedIds));

      if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        if (outcome.closeDeleteModal) {
          setBatchDeleteModalOpen(false);
        }
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchDeleteLoading(false);
    }
  };
  const handleBatchResetTraffic = async () => {
    const selectedLocalIds = Array.from(selectedIds);

    if (selectedLocalIds.length === 0) {
      toast.error("请选择规则进行归零");
      setBatchResetTrafficModalOpen(false);

      return;
    }
    setBatchResetTrafficLoading(true);
    try {
      const res = await batchResetForward(selectedLocalIds);

      if (res.code === 0) {
        const successCount = res.data?.filter((r) => r.success).length || 0;

        toast.success(
          `已成功归零 ${successCount}/${selectedLocalIds.length} 个规则的流量统计`,
        );
        setBatchResetTrafficModalOpen(false);
        setSelectMode(false);
        setSelectedIds(new Set());
        await refreshForwardList(false);
      } else {
        toast.error(res.msg || "批量归零失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBatchResetTrafficLoading(false);
    }
  };
  const handleBatchPause = async () => {
    if (selectedIds.size === 0) return;
    setBatchPauseLoading(true);
    setBatchProgress({
      active: true,
      label: `正在停用 ${selectedIds.size} 项规则...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchToggleService(
        Array.from(selectedIds),
        false,
      );

      if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchPauseLoading(false);
    }
  };
  const handleBatchResume = async () => {
    if (selectedIds.size === 0) return;
    setBatchResumeLoading(true);
    setBatchProgress({
      active: true,
      label: `正在启用 ${selectedIds.size} 项规则...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchToggleService(
        Array.from(selectedIds),
        true,
      );

      if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchResumeLoading(false);
    }
  };
  const handleBatchRedeploy = async () => {
    if (selectedIds.size === 0) return;
    setBatchRedeployLoading(true);
    setBatchProgress({
      active: true,
      label: `正在重新下发 ${selectedIds.size} 项规则...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchRedeploy(
        Array.from(selectedIds),
      );

      if (outcome.failures && outcome.failures.length > 0) {
        openBatchResultModal(
          "批量下发结果",
          outcome.toastMessage,
          outcome.failures,
        );
      } else if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchRedeployLoading(false);
    }
  };
  const handleBatchChangeTunnel = async () => {
    if (selectedIds.size === 0 || !batchTargetTunnelId) return;
    setBatchChangeTunnelLoading(true);
    setBatchProgress({
      active: true,
      label: `正在为 ${selectedIds.size} 项规则切换隧道...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchChangeTunnel(
        Array.from(selectedIds),
        batchTargetTunnelId,
      );

      if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        if (outcome.closeChangeTunnelModal) {
          setBatchChangeTunnelModalOpen(false);
        }
        if (outcome.resetTargetTunnel) {
          setBatchTargetTunnelId(null);
        }
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchChangeTunnelLoading(false);
    }
  };
  const handleBatchChangeMode = async () => {
    if (selectedIds.size === 0 || !batchTargetMode) return;
    setBatchChangeModeLoading(true);
    setBatchProgress({
      active: true,
      label: `正在为 ${selectedIds.size} 项规则切换模式...`,
      percent: 30,
    });
    try {
      const outcome = await executeForwardBatchChangeMode(
        Array.from(selectedIds),
        batchTargetMode,
      );

      if (outcome.toastVariant === "success") {
        toast.success(outcome.toastMessage);
      } else {
        toast.error(outcome.toastMessage);
      }
      if (outcome.shouldRefresh) {
        setBatchProgress({
          active: true,
          label: outcome.progressLabel || "正在刷新规则列表...",
          percent: outcome.progressPercent ?? 75,
        });
        setSelectedIds(new Set());
        setSelectMode(false);
        if (outcome.closeChangeModeModal) {
          setBatchChangeModeModalOpen(false);
        }
        await refreshForwardList(false);
      }
    } finally {
      setBatchProgress({ active: false, label: "", percent: 0 });
      setBatchChangeModeLoading(false);
    }
  };
  // 传感器配置 - 使用默认配置避免错误
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
  // 根据排序顺序获取规则列表
  const orderedForwards = useMemo((): Forward[] => {
    // 确保 forwards 数组存在且有效
    if (!forwards || forwards.length === 0) {
      return [];
    }
    let filteredForwards = forwards;

    if (searchParams.userId !== "all") {
      const targetUserId = parseInt(searchParams.userId);

      if (!Number.isNaN(targetUserId)) {
        filteredForwards = filteredForwards.filter(
          (f) => f.userId === targetUserId || (targetUserId === 0 && !f.userId),
        );
      }
    }
    if (searchParams.tunnelId !== "all") {
      const targetTunnelId = parseInt(searchParams.tunnelId);

      if (!Number.isNaN(targetTunnelId)) {
        filteredForwards = filteredForwards.filter(
          (f) => f.tunnelId === targetTunnelId,
        );
      }
    }
    // 添加限速规则筛选
    if (searchParams.speedLimitId !== undefined) {
      if (searchParams.speedLimitId === -1) {
        // 不限速（speedId 为 null 或 undefined）
        filteredForwards = filteredForwards.filter(
          (f) => f.speedId === null || f.speedId === undefined,
        );
      } else {
        // 特定限速规则
        filteredForwards = filteredForwards.filter(
          (f) => f.speedId === searchParams.speedLimitId,
        );
      }
    }
    if (searchParams.name.trim()) {
      const lowerName = searchParams.name.toLowerCase();

      filteredForwards = filteredForwards.filter(
        (f) => f.name && f.name.toLowerCase().includes(lowerName),
      );
    }
    // 工具栏搜索框过滤（支持搜索规则名称、入口端口、落地地址、落地端口）
    if (searchKeyword.trim()) {
      const lowerKeyword = searchKeyword.toLowerCase();
      const keywordPort = parseInt(searchKeyword.trim());

      filteredForwards = filteredForwards.filter((f) => {
        // 规则名称模糊匹配
        const nameMatch = f.name && f.name.toLowerCase().includes(lowerKeyword);
        // 入口端口精确匹配
        const inPortMatch = !isNaN(keywordPort) && f.inPort === keywordPort;
        // 落地地址模糊匹配
        const remoteAddrMatch =
          f.remoteAddr && f.remoteAddr.toLowerCase().includes(lowerKeyword);
        // 落地端口精确匹配（从 remoteAddr 中提取端口）
        const remotePortMatch = (() => {
          if (isNaN(keywordPort) || !f.remoteAddr) return false;
          // 从 remoteAddr 中提取最后一个端口号（支持多个地址的情况）
          const remotePort = f.remoteAddr.split(",")[0].match(/:(\d+)$/)?.[1];

          return remotePort && parseInt(remotePort) === keywordPort;
        })();

        return nameMatch || inPortMatch || remoteAddrMatch || remotePortMatch;
      });
    }
    if (searchParams.inPort.trim()) {
      const targetPort = parseInt(searchParams.inPort.trim());

      if (!isNaN(targetPort)) {
        filteredForwards = filteredForwards.filter(
          (f) => f.inPort === targetPort,
        );
      }
    }
    if (searchParams.remoteAddr.trim()) {
      const lowerAddr = searchParams.remoteAddr.toLowerCase();

      filteredForwards = filteredForwards.filter(
        (f) => f.remoteAddr && f.remoteAddr.toLowerCase().includes(lowerAddr),
      );
    }
    // 确保过滤后的规则列表有效
    if (!filteredForwards || filteredForwards.length === 0) {
      return [];
    }
    // 优先使用数据库中的 inx 字段进行排序，inx=0 表示新/未排序
    const sortedByDb = [...filteredForwards].sort(compareForwardOrder);

    // 如果数据库中没有排序信息，则使用本地存储的顺序
    if (
      forwardOrder &&
      forwardOrder.length > 0 &&
      sortedByDb.every((f) => f.inx === undefined || f.inx === 0)
    ) {
      const forwardMap = new Map(filteredForwards.map((f) => [f.id, f]));
      const localSortedForwards: Forward[] = [];

      forwardOrder.forEach((id) => {
        const forward = forwardMap.get(id);

        if (forward) {
          localSortedForwards.push(forward);
        }
      });
      // 添加不在排序列表中的规则（新添加的），追加以避免刷新后突然插队
      filteredForwards.forEach((forward) => {
        if (!forwardOrder.includes(forward.id)) {
          localSortedForwards.push(forward);
        }
      });

      return localSortedForwards;
    }

    return sortedByDb;
  }, [forwards, forwardOrder, searchParams, searchKeyword]);
  const availableGroupData = useMemo(
    () => buildAvailableGroupData(forwards),
    [forwards],
  );
  const sanitizedGroupOrderMap = useMemo(
    () =>
      sanitizeGroupOrderMap(
        groupOrderMap,
        availableGroupData.availableTunnelKeysByUser,
      ),
    [groupOrderMap, availableGroupData],
  );
  const sanitizedCollapsedTunnelGroups = useMemo(
    () =>
      sanitizeGroupCollapsedMap(
        collapsedTunnelGroups,
        availableGroupData.availableCollapseKeys,
      ),
    [collapsedTunnelGroups, availableGroupData],
  );

  useEffect(() => {
    if (!groupPreferenceHydrated || tokenUserId === null) {
      return;
    }
    if (forwards.length === 0) {
      return;
    }
    if (!isSameGroupOrderMap(groupOrderMap, sanitizedGroupOrderMap)) {
      setGroupOrderMap(sanitizedGroupOrderMap);
      persistGroupOrderToLocal(sanitizedGroupOrderMap);
      void persistGroupOrderToGlobal(sanitizedGroupOrderMap);
    }
    if (
      !isSameGroupCollapsedMap(
        collapsedTunnelGroups,
        sanitizedCollapsedTunnelGroups,
      )
    ) {
      setCollapsedTunnelGroups(sanitizedCollapsedTunnelGroups);
      persistGroupCollapsedToLocal(sanitizedCollapsedTunnelGroups);
      void persistGroupCollapsedToGlobal(sanitizedCollapsedTunnelGroups);
    }
  }, [
    groupPreferenceHydrated,
    tokenUserId,
    forwards,
    groupOrderMap,
    sanitizedGroupOrderMap,
    collapsedTunnelGroups,
    sanitizedCollapsedTunnelGroups,
  ]);
  const groupedForwards = useMemo((): ForwardUserGroup[] => {
    if (orderedForwards.length === 0) {
      return [];
    }
    type MutableForwardUserGroup = {
      userId: number;
      userName: string;
      tunnelMap: Map<string, ForwardTunnelGroup>;
    };
    const userGroupMap = new Map<number, MutableForwardUserGroup>();

    orderedForwards.forEach((forward) => {
      const userId = forward.userId ?? 0;
      const rawUserName = normalizeForwardUserName(forward.userName);
      const userName =
        forward.userRemark && forward.userRemark.trim()
          ? forward.userRemark.trim()
          : rawUserName;
      const tunnelName = normalizeForwardTunnelName(forward.tunnelName);
      const tunnelKey = buildForwardTunnelGroupKey(forward.tunnelName);
      let existingGroup = userGroupMap.get(userId);

      if (!existingGroup) {
        existingGroup = {
          userId,
          userName,
          tunnelMap: new Map<string, ForwardTunnelGroup>(),
        };
        userGroupMap.set(userId, existingGroup);
      } else if (
        existingGroup.userName === UNKNOWN_FORWARD_USER_NAME &&
        userName !== UNKNOWN_FORWARD_USER_NAME
      ) {
        existingGroup.userName = userName;
      }
      const existingTunnelGroup = existingGroup.tunnelMap.get(tunnelKey);

      if (!existingTunnelGroup) {
        existingGroup.tunnelMap.set(tunnelKey, {
          tunnelKey,
          tunnelName,
          tunnelTrafficRatio: normalizeTunnelTrafficRatio(
            forward.tunnelTrafficRatio,
          ),
          isManualTunnel: forward.isManualTunnel === true,
          items: [forward],
        });

        return;
      }
      existingTunnelGroup.items.push(forward);
      if (
        existingTunnelGroup.tunnelName === UNCATEGORIZED_FORWARD_TUNNEL_NAME &&
        tunnelName !== UNCATEGORIZED_FORWARD_TUNNEL_NAME
      ) {
        existingTunnelGroup.tunnelName = tunnelName;
      }
      if (
        normalizeTunnelTrafficRatio(existingTunnelGroup.tunnelTrafficRatio) ===
          1 &&
        normalizeTunnelTrafficRatio(forward.tunnelTrafficRatio) !== 1
      ) {
        existingTunnelGroup.tunnelTrafficRatio = normalizeTunnelTrafficRatio(
          forward.tunnelTrafficRatio,
        );
      }
      if (forward.isManualTunnel) {
        existingTunnelGroup.isManualTunnel = true;
      }
    });
    const groups = Array.from(userGroupMap.values()).map((group) => {
      const tunnels = Array.from(group.tunnelMap.values());
      const tunnelOrder = sanitizedGroupOrderMap[group.userId.toString()] || [];
      const tunnelOrderIndex = new Map<string, number>();

      tunnelOrder.forEach((key, index) => {
        tunnelOrderIndex.set(key, index);
      });
      tunnels.sort((a, b) => {
        const aIndex = tunnelOrderIndex.get(a.tunnelKey);
        const bIndex = tunnelOrderIndex.get(b.tunnelKey);

        if (aIndex !== undefined || bIndex !== undefined) {
          if (aIndex === undefined) {
            return 1;
          }
          if (bIndex === undefined) {
            return -1;
          }

          return aIndex - bIndex;
        }
        const nameCompare = compareForwardTunnelNameAsc(
          a.tunnelName,
          b.tunnelName,
        );

        if (nameCompare !== 0) {
          return nameCompare;
        }

        return compareForwardTunnelNameAsc(a.tunnelKey, b.tunnelKey);
      });

      return {
        userId: group.userId,
        userName: group.userName,
        tunnels,
      };
    });

    groups.sort((a, b) => {
      if (isAdmin && tokenUserId !== null) {
        const aIsSelf = a.userId === tokenUserId;
        const bIsSelf = b.userId === tokenUserId;

        if (aIsSelf !== bIsSelf) {
          return aIsSelf ? -1 : 1;
        }
      }
      const nameCompare = compareForwardUserNameAsc(a.userName, b.userName);

      if (nameCompare !== 0) {
        return nameCompare;
      }

      return a.userId - b.userId;
    });

    return groups;
  }, [orderedForwards, isAdmin, tokenUserId, sanitizedGroupOrderMap]);

  const sortedForwards = useMemo(() => {
    if (compactMode) {
      return orderedForwards;
    }

    return groupedForwards.flatMap((group) =>
      group.tunnels.flatMap((tunnel) => tunnel.items),
    );
  }, [compactMode, orderedForwards, groupedForwards]);
  const forwardTotal = sortedForwards.length;
  const paginatedForwards = useMemo(() => {
    const start = (forwardPage - 1) * forwardPageSize;

    return sortedForwards.slice(start, start + forwardPageSize);
  }, [sortedForwards, forwardPage, forwardPageSize]);

  useEffect(() => {
    const maxPage = Math.ceil(forwardTotal / forwardPageSize);

    if (forwardPage > maxPage && maxPage > 0) setForwardPage(maxPage);
  }, [forwardTotal, forwardPageSize, forwardPage]);

  useEffect(() => {
    setForwardPage(1);
    setGroupPage(1);
  }, [compactMode, searchKeyword, searchParams, viewMode]);

  const paginationUI = (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4 mb-4">
      <Button
        className="min-w-8 px-2"
        isDisabled={forwardPage === 1}
        size="sm"
        variant="flat"
        onPress={() => setForwardPage((p) => Math.max(1, p - 1))}
      >
        {"<"}
      </Button>
      {(() => {
        const totalPages = Math.ceil(forwardTotal / forwardPageSize);
        const pages = [];

        if (totalPages <= 7) {
          for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
          pages.push(1);
          if (forwardPage > 3) pages.push("...");
          const start = Math.max(2, forwardPage - 1);
          const end = Math.min(totalPages - 1, forwardPage + 1);

          for (let i = start; i <= end; i++) pages.push(i);
          if (forwardPage < totalPages - 2) pages.push("...");
          pages.push(totalPages);
        }

        return pages.map((p, idx) =>
          typeof p === "string" ? (
            <span key={"e" + idx} className="text-default-400 text-sm px-1">
              {p}
            </span>
          ) : (
            <Button
              key={p}
              color={p === forwardPage ? "primary" : "default"}
              size="sm"
              variant={p === forwardPage ? "solid" : "flat"}
              onPress={() => setForwardPage(p)}
            >
              {p}
            </Button>
          ),
        );
      })()}
      <Button
        className="min-w-8 px-2"
        isDisabled={forwardPage >= Math.ceil(forwardTotal / forwardPageSize)}
        size="sm"
        variant="flat"
        onPress={() =>
          setForwardPage((p) =>
            Math.min(Math.ceil(forwardTotal / forwardPageSize), p + 1),
          )
        }
      >
        {">"}
      </Button>
      {/* <span className="text-default-400 text-sm ml-2">每页</span> */}
      <select
        className="text-sm border border-input rounded px-2 py-1 bg-background"
        value={forwardPageSize}
        onChange={(e) => {
          setForwardPageSize(Number(e.target.value));
          setForwardPage(1);
        }}
      >
        <option value={10}>10</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
      <span className="text-default-400 text-sm">条</span>
    </div>
  );

  // 分组视图分页
  const groupTotal = groupedForwards.length;
  const paginatedGroupedForwards = useMemo(() => {
    const start = (groupPage - 1) * groupPageSize;

    return groupedForwards.slice(start, start + groupPageSize);
  }, [groupedForwards, groupPage, groupPageSize]);

  useEffect(() => {
    const maxPage = Math.ceil(groupTotal / groupPageSize);

    if (groupPage > maxPage && maxPage > 0) setGroupPage(maxPage);
  }, [groupTotal, groupPageSize, groupPage]);

  const groupPaginationUI = (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4 mb-4">
      <Button
        className="min-w-8 px-2"
        isDisabled={groupPage === 1}
        size="sm"
        variant="flat"
        onPress={() => setGroupPage((p) => Math.max(1, p - 1))}
      >
        {"<"}
      </Button>
      {(() => {
        const totalPages = Math.ceil(groupTotal / groupPageSize);
        const pages = [];

        if (totalPages <= 7) {
          for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
          pages.push(1);
          if (groupPage > 3) pages.push("...");
          const start = Math.max(2, groupPage - 1);
          const end = Math.min(totalPages - 1, groupPage + 1);

          for (let i = start; i <= end; i++) pages.push(i);
          if (groupPage < totalPages - 2) pages.push("...");
          pages.push(totalPages);
        }

        return pages.map((p, idx) =>
          typeof p === "string" ? (
            <span key={"e" + idx} className="text-default-400 text-sm px-1">
              {p}
            </span>
          ) : (
            <Button
              key={p}
              color={p === groupPage ? "primary" : "default"}
              size="sm"
              variant={p === groupPage ? "solid" : "flat"}
              onPress={() => setGroupPage(p)}
            >
              {p}
            </Button>
          ),
        );
      })()}
      <Button
        className="min-w-8 px-2"
        isDisabled={groupPage >= Math.ceil(groupTotal / groupPageSize)}
        size="sm"
        variant="flat"
        onPress={() =>
          setGroupPage((p) =>
            Math.min(Math.ceil(groupTotal / groupPageSize), p + 1),
          )
        }
      >
        {">"}
      </Button>
      {/* <span className="text-default-400 text-sm ml-2">每页</span> */}
      <select
        className="text-sm border border-input rounded px-2 py-1 bg-background"
        value={groupPageSize}
        onChange={(e) => {
          setGroupPageSize(Number(e.target.value));
          setGroupPage(1);
        }}
      >
        <option value={5}>5</option>
        <option value={10}>10</option>
        <option value={20}>20</option>
      </select>
      <span className="text-default-400 text-sm">个分组</span>
    </div>
  );

  const sortableForwardIds = useMemo(
    () => paginatedForwards.map((f) => f.id).filter((id) => id > 0),
    [paginatedForwards],
  );
  const selectAll = () => {
    const allIds = sortedForwards.map((f) => f.id);

    setSelectedIds(new Set(allIds));
  };
  const isAllSelected = useMemo(() => {
    return (
      sortedForwards &&
      sortedForwards.length > 0 &&
      selectedIds.size === sortedForwards.length
    );
  }, [sortedForwards, selectedIds]);
  const handleSelectAllToggle = (isSelected: boolean) => {
    if (isSelected) {
      const allIds = sortedForwards.map((f) => f.id);

      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };
  const toggleTunnelGroupCollapsed = (userId: number, tunnelKey: string) => {
    const collapseKey = buildTunnelGroupCollapseKey(userId, tunnelKey);
    const nextCollapsedMap: ForwardGroupCollapsedMap = {
      ...sanitizedCollapsedTunnelGroups,
    };

    if (nextCollapsedMap[collapseKey] === true) {
      delete nextCollapsedMap[collapseKey];
    } else {
      nextCollapsedMap[collapseKey] = true;
    }
    setCollapsedTunnelGroups(nextCollapsedMap);
    persistGroupCollapsedToLocal(nextCollapsedMap);
    void persistGroupCollapsedToGlobal(nextCollapsedMap);
  };
  // 生成用作筛选项的用户和隧道列表
  const uniqueUsers = useMemo(() => {
    const userMap = new Map<number, { id: number; name: string }>();

    forwards.forEach((f) => {
      const uId = f.userId ?? 0;
      const userName = normalizeForwardUserName(f.userName);
      const userRemark = f.userRemark;
      const displayName =
        userRemark && userRemark.trim() ? userRemark.trim() : userName;

      const existingUser = userMap.get(uId);

      if (!existingUser) {
        userMap.set(uId, { id: uId, name: displayName });

        return;
      }
      if (
        !existingUser.name ||
        existingUser.name === UNKNOWN_FORWARD_USER_NAME
      ) {
        existingUser.name = displayName;
      }
    });
    const users = Array.from(userMap.values());

    users.sort((a, b) => {
      if (isAdmin && tokenUserId !== null) {
        const aIsSelf = a.id === tokenUserId;
        const bIsSelf = b.id === tokenUserId;

        if (aIsSelf !== bIsSelf) {
          return aIsSelf ? -1 : 1;
        }
      }
      const nameCompare = compareForwardUserNameAsc(a.name, b.name);

      if (nameCompare !== 0) {
        return nameCompare;
      }

      return a.id - b.id;
    });

    return users;
  }, [forwards, isAdmin, tokenUserId]);
  // 生成用作筛选项的隧道列表（先按用户过滤，再检查是否有规则）
  const availableTunnels = useMemo(() => {
    // 如果选中了特定用户，只返回该用户有规则的隧道
    if (searchParams.userId !== "all") {
      const targetUserId = parseInt(searchParams.userId);

      // 先找出该用户的所有规则
      const userForwards = forwards.filter(
        (f) => f.userId === targetUserId || (targetUserId === 0 && !f.userId),
      );

      // 提取这些规则涉及的隧道 ID
      const tunnelIdsWithForwards = new Set<number>();

      userForwards.forEach((f) => {
        if (f.tunnelId) {
          tunnelIdsWithForwards.add(f.tunnelId);
        }
      });

      // 只返回有规则的隧道
      return tunnels.filter((tunnel) => tunnelIdsWithForwards.has(tunnel.id));
    }

    // 如果是"全部用户"，返回所有有规则的隧道
    const tunnelIdsWithForwards = new Set<number>();

    forwards.forEach((f) => {
      if (f.tunnelId) {
        tunnelIdsWithForwards.add(f.tunnelId);
      }
    });

    return tunnels.filter((tunnel) => tunnelIdsWithForwards.has(tunnel.id));
  }, [tunnels, forwards, searchParams.userId]);
  // 渲染规则卡片
  const renderForwardCard = (forward: Forward, listeners?: any) => {
    const { hosts: inAddrNoPorts, endpoints: inAddrWithPorts } =
      getIngressDisplayAddresses(forward.inIp, forward.inPort);
    const statusDisplay = getStatusDisplay(forward.status);
    const strategyDisplay = getStrategyDisplay(forward.strategy);

    return (
      <Card
        key={forward.id}
        className="group h-full flex flex-col shadow-sm border border-divider hover:shadow-md transition-shadow duration-200 overflow-hidden"
      >
        <CardHeader className="pb-2 md:pb-2 flex-col items-start gap-1.5">
          {/* 第一行：复选框与开关 */}
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center -ml-1">
              <Checkbox
                isSelected={selectedIds.has(forward.id)}
                onValueChange={() => toggleSelect(forward.id)}
              />
            </div>

            <div className="flex items-center gap-1.5 -mr-1">
              {/* 隧道状态标识 */}
              <div
                className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${statusDisplay.color === "primary" ? "bg-primary-500/10 text-primary-600 dark:text-primary-400" : statusDisplay.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : statusDisplay.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : statusDisplay.color === "danger" ? "bg-danger-500/10 text-danger-600 dark:text-danger-400" : "bg-default-500/10 text-default-500"}`}
              >
                {statusDisplay.text}
              </div>
              {/* 暂停启用开关 */}
              <Switch
                isDisabled={
                  (forward.status !== 1 && forward.status !== 0) ||
                  togglingIds?.has(forward.id)
                }
                isSelected={forward.serviceRunning}
                size="sm"
                onValueChange={() => handleServiceToggle(forward)}
              />
              {/* 拖拽排序图标 */}
              {viewMode === "direct" && (
                <div
                  className="cursor-grab active:cursor-grabbing p-1 text-default-400 hover:text-default-600 transition-colors touch-manipulation flex-shrink-0"
                  {...listeners}
                  style={{ touchAction: "none" }}
                  title="拖拽排序"
                >
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M7 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 2zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 14zm6-8a2 2 0 1 1-.001-4.001A2 2 0 0 1 13 6zm0 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 14z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
          {/* 第二行：规则名与隧道信息 */}
          <div className="flex-1 min-w-0 w-full pl-0.5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <ForwardModeChip
                  className="flex-shrink-0"
                  mode={forward.mode}
                />
                <h3
                  className="text-foreground truncate text-sm cursor-pointer hover:text-primary transition-colors"
                  onClick={() => copyToClipboard(forward.name, "规则名称")}
                >
                  {forward.name}
                </h3>
              </div>
              <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 bg-danger-500/10 text-danger-600 dark:text-danger-400">
                {formatExpiryTime(forward.expiryTime)}
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 w-full pl-0.5">
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="text-xs text-foreground truncate flex items-center">
                {forward.isManualTunnel && (
                  <ManualTunnelChip className="mr-1" />
                )}
                <span className="truncate">
                  {normalizeForwardTunnelName(forward.tunnelName)}
                </span>
                <span className="text-primary-600 text-[10px] ml-1">
                  ^{formatTunnelTrafficRatio(forward.tunnelTrafficRatio)}
                </span>
              </span>
              {/* 隧道模式标识 */}
              <div
                className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${strategyDisplay.color === "primary" ? "bg-primary-500/10 text-primary-600 dark:text-primary-400" : strategyDisplay.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : strategyDisplay.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : strategyDisplay.color === "danger" ? "bg-danger-500/10 text-danger-600 dark:text-danger-400" : "bg-default-500/10 text-default-500"}`}
              >
                {strategyDisplay.text}
              </div>
            </div>
          </div>
        </CardHeader>
        {/* 卡片视图卡片布局显示 */}
        <CardBody className="flex flex-1 flex-col pt-0 pb-3 md:pt-0 md:pb-3">
          <div className="space-y-3 flex-1 py-1">
            {/* 入口信息区 */}
            <div className="space-y-1">
              <div className="flex gap-1 px-1 text-[11px] text-foreground uppercase tracking-wider">
                <span className="flex-1 text-left">入口地址</span>
                <span className="w-16 text-center">端口</span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1 min-w-0 h-8 bg-default-100/60 text-red-100/60 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-100/20 rounded-md px-2 flex items-center transition-colors">
                  <div className="flex items-center gap-1.5 w-full">
                    <svg
                      className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(
                          inAddrWithPorts.split(",").join("\n"),
                          "完整入口",
                        );
                      }}
                    >
                      <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    <span
                      className="flex items-center gap-1 flex-1 cursor-pointer"
                      onClick={() =>
                        copyToClipboard(
                          inAddrNoPorts.split(",").join("\n"),
                          "入口地址",
                        )
                      }
                    >
                      <code
                        className="text-xs font-medium text-foreground font-bold truncate shrink min-w-0 max-w-[130px]"
                        title={inAddrNoPorts}
                      >
                        {maskAddress(
                          inAddrNoPorts.split(",").length > 1
                            ? inAddrNoPorts.split(",")[0].trim()
                            : formatAddressHost(forward.inIp || "") || "默认IP",
                        )}
                      </code>
                      {inAddrNoPorts.split(",").length > 1 && (
                        <span
                          className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-medium bg-default-200 text-default-600 rounded-full shrink-0 cursor-pointer hover:bg-default-300 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            showAddressModal(
                              inAddrNoPorts,
                              forward.inPort,
                              "入口地址",
                            );
                          }}
                        >
                          +{inAddrNoPorts.split(",").length - 1}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className="w-16 h-8 bg-default-100/60 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-100/20 rounded-md px-2 flex items-center justify-center cursor-pointer transition-colors"
                  onClick={() =>
                    copyToClipboard(forward.inPort.toString(), "入口端口")
                  }
                >
                  <code className="text-xs font-medium text-foreground font-bold">
                    {forward.inPort}
                  </code>
                </div>
              </div>
            </div>
            {/* 落地信息区 */}
            <div className="space-y-1">
              <div className="flex gap-1 px-1 text-[11px] text-foreground uppercase tracking-wider">
                <span className="flex-1 text-left">落地地址</span>
                <span className="w-16 text-center">端口</span>
              </div>
              <div className="flex gap-1 items-center">
                <div className="flex-1 min-w-0 h-8 bg-default-100/60 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-100/20 rounded-md px-2 flex items-center transition-colors">
                  <div className="flex items-center gap-1.5 w-full">
                    <svg
                      className="w-3.5 h-3.5 text-primary hover:text-primary-600 cursor-pointer shrink-0 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(
                          `${forward.remoteAddr.split(",")[0]}`,
                          "完整落地",
                        );
                      }}
                    >
                      <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    <code
                      className="text-xs font-medium text-foreground font-bold truncate shrink min-w-0 max-w-[130px]"
                      title={extractAddressHost(
                        forward.remoteAddr.split(",")[0],
                      )}
                      onClick={() =>
                        copyToClipboard(
                          extractAddressHost(forward.remoteAddr.split(",")[0]),
                          "落地地址",
                        )
                      }
                    >
                      {maskAddress(
                        extractAddressHost(forward.remoteAddr.split(",")[0]),
                      )}
                    </code>
                  </div>
                </div>
                <div
                  className="w-16 h-8 bg-default-100/60 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-100/20 rounded-md px-2 flex items-center justify-center cursor-pointer transition-colors"
                  onClick={() =>
                    copyToClipboard(
                      forward.remoteAddr.split(",")[0].match(/:(\d+)$/)?.[1] ||
                        "",
                      "落地端口",
                    )
                  }
                >
                  <code className="text-xs font-medium text-foreground font-bold">
                    {forward.remoteAddr.split(",")[0].match(/:(\d+)$/)?.[1] ||
                      "-"}
                  </code>
                </div>
              </div>
            </div>
          </div>
          {/* 底部 Chip 区 */}
          <div className="flex items-center justify-between pt-2 border-t border-divider gap-1 whitespace-nowrap">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
                ↑{formatFlow(forward.inFlow || 0)}
              </span>
              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400">
                ↓{formatFlow(forward.outFlow || 0)}
              </span>
            </div>
            <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-danger-500/10 text-danger-600 dark:text-default-400">
              ⇅{formatFlow(getForwardDisplayFlow(forward))}
            </div>
          </div>
          <div className="flex gap-1.5 mt-3">
            <Button
              className="flex-1 min-h-8 flex-shrink-0"
              color="primary"
              size="sm"
              variant="flat"
              onPress={() => handleEdit(forward)}
            >
              编辑
            </Button>
            <Button
              className="flex-1 min-h-8 flex-shrink-0"
              color="warning"
              size="sm"
              variant="flat"
              onPress={() => handleCopy(forward)}
            >
              复制
            </Button>
            <Button
              className="flex-1 min-h-8 flex-shrink-0"
              color="warning"
              size="sm"
              variant="flat"
              onPress={() => handleDiagnose(forward)}
            >
              诊断
            </Button>
            <Button
              className="flex-1 min-h-8 flex-shrink-0"
              color="danger"
              size="sm"
              variant="flat"
              onPress={() => handleDelete(forward)}
            >
              删除
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  };

  if (loading || !groupPreferenceHydrated) {
    return (
      <AnimatedPage className="px-3 lg:px-6 py-8">
        <PageLoadingState message="正在加载..." />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      {/* 页面头部 */}
      <div className="flex items-center mb-6 gap-3">
        <div className="flex min-h-8 flex-wrap items-center gap-2">
          {selectedIds.size > 0 ? (
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
                color="warning"
                size="sm"
                variant="flat"
                onPress={deselectAll}
              >
                清空
              </Button>
              <Button
                color="danger"
                isLoading={batchPauseLoading}
                size="sm"
                variant="flat"
                onPress={handleBatchPause}
              >
                暂停
              </Button>
              <Button
                color="success"
                isLoading={batchResumeLoading}
                size="sm"
                variant="flat"
                onPress={handleBatchResume}
              >
                启用
              </Button>
              <Button
                color="primary"
                isLoading={batchRedeployLoading}
                size="sm"
                variant="flat"
                onPress={handleBatchRedeploy}
              >
                下发
              </Button>
              <Button
                color="success"
                isLoading={batchChangeTunnelLoading}
                size="sm"
                variant="flat"
                onPress={() => setBatchChangeTunnelModalOpen(true)}
              >
                隧道
              </Button>
              <Button
                color="warning"
                isLoading={batchChangeModeLoading}
                size="sm"
                variant="flat"
                onPress={() => setBatchChangeModeModalOpen(true)}
              >
                模式
              </Button>
              <Button
                color="primary"
                isDisabled={selectedIds.size === 0}
                isLoading={batchResetTrafficLoading}
                size="sm"
                variant="flat"
                onPress={() => setBatchResetTrafficModalOpen(true)}
              >
                归零
              </Button>
              <Button
                color="danger"
                isLoading={batchDeleteLoading}
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
              {/* 工具栏搜索框 */}
              <SearchBar
                isVisible={isSearchVisible}
                placeholder="规则名称IP端口"
                value={searchKeyword}
                onChange={setSearchKeyword}
                onClose={() => setIsSearchVisible(false)}
                onOpen={() => setIsSearchVisible(true)}
              />
              {/* 显示模式切换按钮 */}
              {/* 显示模式4形态切换按钮 */}
              <Button
                color={modeBtnConfig.color as any}
                size="sm"
                variant="flat"
                onPress={handleModeCycle}
              >
                {modeBtnConfig.text}
              </Button>
              {/* 导入按钮 */}
              <Button
                color="secondary"
                size="sm"
                variant="flat"
                onPress={handleImport}
              >
                导入
              </Button>
              {/* 导出按钮 */}
              <Button
                color="success"
                isLoading={exportLoading}
                size="sm"
                variant="flat"
                onPress={handleExport}
              >
                导出
              </Button>
              <Button
                color="primary"
                size="sm"
                variant="flat"
                onPress={handleAdd}
              >
                新增
              </Button>
              {/* 筛选按钮 */}
              {/* <Button
                className="whitespace-nowrap bg-red-100"
                color={activeFilterCount > 0 ? "secondary" : "danger"}
                size="sm"
                variant="flat"
                onPress={() => setIsSearchModalOpen(true)}
              >
                筛选{activeFilterCount > 0 && `(${activeFilterCount})`}
              </Button> */}
              {activeFilterCount > 0 && (
                <Button
                  color="warning"
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    setSearchParams({
                      name: "",
                      userId: tokenUserId ? tokenUserId.toString() : "all",
                      tunnelId: "all",
                      speedLimitId: undefined,
                      inPort: "",
                      remoteAddr: "",
                    });
                    setSearchKeyword("");
                  }}
                >
                  重置
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {batchProgress.active && (
        <div className="mb-4">
          <Alert
            color="primary"
            description={batchProgress.label}
            variant="flat"
          />
          <Progress
            aria-label={batchProgress.label}
            className="mt-3"
            color="primary"
            size="sm"
            value={batchProgress.percent}
          />
        </div>
      )}
      {/* 根据显示模式渲染不同内容 */}
      {compactMode ? (
        viewMode === "grouped" ? (
          sortedForwards.length > 0 ? (
            <>
              {/* 注释规则数量
              <div className="flex items-center justify-start px-1 mb-3">
                <span className="text-sm font-semibold text-foreground">
                  全部规则
                </span>
                <span className="text-xs text-default-600">
                  _{sortedForwards.length}条
                </span>
              </div> */}
              {paginationUI}
              <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
                <DndContext
                  collisionDetection={pointerWithin}
                  sensors={sensors}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={sortableForwardIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <Table
                      aria-label="全部规则列表"
                      className={FORWARD_GROUPED_TABLE_MIN_WIDTH_CLASS}
                      classNames={{
                        th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                        td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                        tr: "hover:bg-default-50/50 transition-colors",
                      }}
                    >
                      <TableHeader>
                        {true && (
                          <TableColumn className="w-12 whitespace-nowrap px-1 text-left">
                            {/* @ts-ignore */}
                            <div className="flex items-center justify-center h-full">
                              <Checkbox
                                aria-label="全选"
                                isSelected={isAllSelected}
                                onValueChange={handleSelectAllToggle}
                              />
                            </div>
                          </TableColumn>
                        )}
                        <TableColumn className="w-12 whitespace-nowrap px-1 py-2 text-center">
                          排序
                        </TableColumn>
                        {/* <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">用户名</TableColumn> */}
                        {isAdmin && (
                          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                            <Select
                              aria-label="按用户筛选"
                              className="w-full min-w-[80px]"
                              classNames={{
                                trigger: "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1.5 hover:bg-default-100/50 transition-colors flex flex-row items-center justify-start",
                                value: "text-sm text-default-600 font-semibold uppercase tracking-wider p-0 order-last",
                                selectorIcon: "text-default-400 w-3.5 h-3.5 static order-first m-0",
                                innerWrapper: "w-fit flex-none",
                                placeholder: "text-sm text-default-600 font-semibold uppercase tracking-wider",
                              }}
                              size="sm"
                              variant="flat"
                              onSelectionChange={(keys) => {
                                const key = Array.from(keys)[0] as string | undefined;
                                setSearchParams((prev: any) => ({
                                  ...prev,
                                  userId: key || "all",
                                }));
                              }}
                              placeholder="所属用户"
                              // 🎯 逻辑对齐：如果是 "all" 或者空，传 [] 让它显示 placeholder ("所属用户")
                              selectedKeys={(!searchParams?.userId || searchParams.userId === "all") ? [] : [String(searchParams.userId)]}
                            >
                              <SelectItem key="all" textValue="全部用户">
                                全部用户
                              </SelectItem>
                              {(uniqueUsers || []).map((user: any) => (
                                <SelectItem
                                  key={user.id.toString()}
                                  textValue={user.name}
                                >
                                  {user.name}
                                </SelectItem>
                              ))}
                            </Select>
                          </TableColumn>
                        )}
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                          规则名称
                          <span className="text-xs text-primary-500 font-normal">
                            ^{sortedForwards.length}个
                          </span>
                        </TableColumn>
                        {/* <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">隧道倍率</TableColumn> */}
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                          <Select
                            aria-label="按所属隧道筛选"
                            className="w-full"
                            classNames={{
                              trigger:
                                "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1 hover:bg-default-100/50 transition-colors",
                              value:
                                "text-sm text-default-600 font-semibold uppercase tracking-wider p-0",
                              selectorIcon:
                                "text-default-400 static w-3.5 h-3.5",
                            }}
                            placeholder="隧道名称"
                            selectedKeys={
                              searchParams.tunnelId &&
                              searchParams.tunnelId !== "all"
                                ? [searchParams.tunnelId]
                                : []
                            }
                            size="sm"
                            variant="flat"
                            onSelectionChange={(keys) => {
                              const key = Array.from(keys)[0] as
                                | string
                                | undefined;

                              setSearchParams((prev) => ({
                                ...prev,
                                tunnelId: key || "all",
                              }));
                            }}
                          >
                            <SelectItem key="all" textValue="全部隧道">
                              全部隧道
                            </SelectItem>
                            {availableTunnels.map((tunnel) => (
                              <SelectItem
                                key={tunnel.id.toString()}
                                textValue={
                                  tunnel.remark
                                    ? `${formatRemoteDisplayText(tunnel.name)} (${tunnel.remark})`
                                    : formatRemoteDisplayText(tunnel.name)
                                }
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">
                                    {formatRemoteDisplayText(tunnel.name)}
                                  </span>
                                  {tunnel.remark && (
                                    <span className="text-default-400 text-xs">
                                      ({tunnel.remark})
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </Select>
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                          入口地址
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                          端口
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                          落地地址
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                          端口
                        </TableColumn>
                        <TableColumn
                          className={`whitespace-nowrap px-1 py-2 text-left ${FORWARD_GROUPED_TABLE_COLUMN_CLASS.totalFlow}`}
                        >
                          用量
                        </TableColumn>
                        <TableColumn
                          className={`whitespace-nowrap px-1 py-2 text-left ${FORWARD_GROUPED_TABLE_COLUMN_CLASS.realtimeSpeed}`}
                        >
                          实时带宽
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 py-2 text-center">
                          连接数
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                          有效期
                        </TableColumn>
                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                          状态
                        </TableColumn>
                        <TableColumn
                          align="left"
                          className="whitespace-nowrap px-1 text-start"
                        >
                          操作
                        </TableColumn>
                      </TableHeader>
                      <TableBody
                        emptyContent="暂无规则配置"
                        items={paginatedForwards}
                      >
                        {(forward) => (
                          <SortableCompactTableRow
                            copyToClipboard={copyToClipboard}
                            formatFlow={formatFlow}
                            formatInAddress={formatInAddress}
                            formatRemoteAddress={formatRemoteAddress}
                            formatSpeed={formatSpeed}
                            forward={forward}
                            getStrategyDisplay={getStrategyDisplay}
                            handleCopy={handleCopy}
                            handleDelete={handleDelete}
                            handleDiagnose={handleDiagnose}
                            handleEdit={handleEdit}
                            handleServiceToggle={handleServiceToggle}
                            handleViewTrafficResetLogs={
                              handleViewTrafficResetLogs
                            }
                            hasMultipleAddresses={hasMultipleAddresses}
                            isAdmin={isAdmin}
                            selectMode={selectMode}
                            selectedIds={selectedIds}
                            showAddressModal={showAddressModal}
                            toggleSelect={toggleSelect}
                            togglingIds={togglingIds}
                          />
                        )}
                      </TableBody>
                    </Table>
                  </SortableContext>
                </DndContext>
              </div>
            </>
          ) : (
            <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
              <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
                <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
                  暂无规则配置
                </h3>
                <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
                  还没有任何规则配置，点击新增按钮开始创建
                </p>
              </CardBody>
            </Card>
          )
        ) : sortedForwards.length > 0 ? (
          <>
            {paginationUI}
            <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
              <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {paginatedForwards[0]?.userRemark?.trim() ||
                      paginatedForwards[0]?.userName ||
                      "全部规则"}
                  </span>
                </div>
                <span className="text-xs text-default-500">
                  {sortedForwards.length} 个规则
                </span>
              </div>
              <div className="p-4">
                <DndContext
                  collisionDetection={pointerWithin}
                  sensors={sensors}
                  onDragEnd={handleDragEnd}
                  onDragStart={() => {}}
                >
                  <SortableContext
                    items={sortableForwardIds}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                      {paginatedForwards.map((forward) =>
                        forward && forward.id ? (
                          <SortableForwardCard
                            key={forward.id}
                            forward={forward}
                            renderCard={renderForwardCard}
                          />
                        ) : null,
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          </>
        ) : (
          <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
            <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
              <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
                暂无规则配置
              </h3>
              <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
                还没有创建任何规则配置，点击上方按钮开始创建
              </p>
            </CardBody>
          </Card>
        )
      ) : paginatedGroupedForwards.length > 0 ? (
        <>
          {groupPaginationUI}
          <div className="space-y-4">
            {paginatedGroupedForwards.map((group) => {
              const groupForwardCount = group.tunnels.reduce(
                (total, tunnel) => total + tunnel.items.length,
                0,
              );

              return (
                <div
                  key={`grouped-table-${group.userId}-${group.userName}`}
                  className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md"
                >
                  <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {group.userName}
                      </span>
                    </div>
                    <span className="text-xs text-default-500">
                      {groupForwardCount} 个规则
                    </span>
                  </div>
                  <div className="space-y-4 p-4">
                    <DndContext
                      collisionDetection={pointerWithin}
                      sensors={sensors}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={group.tunnels.map((tunnel) =>
                          buildTunnelGroupSortableId(
                            group.userId,
                            tunnel.tunnelKey,
                          ),
                        )}
                        strategy={verticalListSortingStrategy}
                      >
                        {group.tunnels.map((tunnel) => {
                          const tunnelSortableForwardIds = tunnel.items
                            .map((item) => item.id)
                            .filter((id) => id > 0);
                          const collapsed =
                            sanitizedCollapsedTunnelGroups[
                              buildTunnelGroupCollapseKey(
                                group.userId,
                                tunnel.tunnelKey,
                              )
                            ] === true;

                          return (
                            <SortableTunnelGroupContainer
                              key={`grouped-table-${group.userId}-${tunnel.tunnelKey}`}
                              bodyClassName=""
                              collapsed={collapsed}
                              countClassName="text-xs text-default-600"
                              groupUserId={group.userId}
                              headerClassName="flex items-center justify-between border-b border-divider bg-default-100/50 hover:bg-default-200/50 px-4 py-2.5"
                              titleClassName="truncate text-sm font-semibold text-foreground"
                              tunnel={tunnel}
                              wrapperClassName="overflow-hidden rounded-lg border border-divider bg-content1"
                              onToggleCollapsed={() =>
                                toggleTunnelGroupCollapsed(
                                  group.userId,
                                  tunnel.tunnelKey,
                                )
                              }
                            >
                              <DndContext
                                collisionDetection={pointerWithin}
                                sensors={sensors}
                                onDragEnd={handleDragEnd}
                              >
                                {(() => {
                                  const groupIds = tunnel.items.map(
                                    (f) => f.id,
                                  );
                                  const isGroupSelected = groupIds.every((id) =>
                                    selectedIds.has(id),
                                  );
                                  const handleGroupToggle = (
                                    isSelected: boolean,
                                  ) => {
                                    const next = new Set(selectedIds);

                                    groupIds.forEach((id) =>
                                      isSelected
                                        ? next.add(id)
                                        : next.delete(id),
                                    );
                                    setSelectedIds(next);
                                  };

                                  return (
                                    <Table
                                      aria-label={`${group.userName}-${formatRemoteDisplayText(tunnel.tunnelName)}规则列表`}
                                      className={
                                        FORWARD_GROUPED_TABLE_MIN_WIDTH_CLASS
                                      }
                                      classNames={{
                                        th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                                        td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                                        tr: "hover:bg-default-50/50 transition-colors",
                                        wrapper: "bg-content1",
                                      }}
                                    >
                                      <TableHeader>
                                        <TableColumn
                                          className={`whitespace-nowrap px-1 py-2 ${FORWARD_GROUPED_TABLE_COLUMN_CLASS.select} text-left`}
                                        >
                                          <div className="flex items-center justify-center h-full">
                                            <Checkbox
                                              aria-label="本组全选"
                                              isSelected={isGroupSelected}
                                              onValueChange={handleGroupToggle}
                                            />
                                          </div>
                                        </TableColumn>
                                        <TableColumn className="w-12 whitespace-nowrap px-1 py-2 text-center">
                                          排序
                                        </TableColumn>
                                        {/* <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">用户名</TableColumn> */}
                                        {isAdmin && (
                                          <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                                            <Select
                                              aria-label="按用户筛选"
                                              className="w-full min-w-[80px]"
                                              classNames={{
                                                trigger:
                                                  "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1.5 hover:bg-default-100/50 transition-colors flex flex-row items-center justify-start",
                                                value:
                                                  "text-sm text-default-600 font-semibold uppercase tracking-wider p-0 order-last",
                                                selectorIcon:
                                                  "text-default-400 w-3.5 h-3.5 static order-first m-0",
                                                innerWrapper: "w-fit flex-none",
                                                placeholder:
                                                  "text-sm text-default-600 font-semibold uppercase tracking-wider",
                                              }}
                                              size="sm"
                                              variant="flat"
                                              onSelectionChange={(keys) => {
                                                const key = Array.from(
                                                  keys,
                                                )[0] as string | undefined;
                                                setSearchParams(
                                                  (prev: any) => ({
                                                    ...prev,
                                                    userId: key || "all",
                                                  }),
                                                );
                                              }}
                                              placeholder="所属用户"
                                              // 🎯 逻辑对齐：如果是 "all" 或者空，传 [] 让它显示 placeholder ("所属用户")
                                              selectedKeys={
                                                !searchParams?.userId ||
                                                  searchParams.userId === "all"
                                                  ? []
                                                  : [
                                                    String(
                                                      searchParams.userId,
                                                    ),
                                                  ]
                                              }
                                            >
                                              <SelectItem
                                                key="all"
                                                textValue="全部用户"
                                              >
                                                全部用户
                                              </SelectItem>
                                              {(uniqueUsers || []).map(
                                                (user: any) => (
                                                  <SelectItem
                                                    key={user.id.toString()}
                                                    textValue={user.name}
                                                  >
                                                    {user.name}
                                                  </SelectItem>
                                                ),
                                              )}
                                            </Select>
                                          </TableColumn>
                                        )}
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                                          规则名称
                                          <span className="text-xs text-primary-500 font-normal">
                                            ^{tunnel.items.length}个
                                          </span>
                                        </TableColumn>
                                        {/* {isAdmin && <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">速度限制</TableColumn>} */}
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                                          入口地址
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                                          端口
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-left">
                                          落地地址
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                                          端口
                                        </TableColumn>
                                        <TableColumn
                                          className={`whitespace-nowrap px-1 py-2 text-left ${FORWARD_GROUPED_TABLE_COLUMN_CLASS.totalFlow}`}
                                        >
                                          用量
                                        </TableColumn>
                                        <TableColumn
                                          className={`whitespace-nowrap px-1 py-2 text-left ${FORWARD_GROUPED_TABLE_COLUMN_CLASS.realtimeSpeed}`}
                                        >
                                          实时带宽
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                                          连接数
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                                          有效期
                                        </TableColumn>
                                        <TableColumn className="whitespace-nowrap px-1 py-2 text-center">
                                          状态
                                        </TableColumn>
                                        <TableColumn
                                          align="left"
                                          className="whitespace-nowrap px-1 py-2 text-start"
                                        >
                                          操作
                                        </TableColumn>
                                      </TableHeader>
                                      <TableBody
                                        emptyContent="暂无规则配置"
                                        items={tunnel.items}
                                      >
                                        {(forward) => (
                                          <SortableContext
                                            key={forward.id}
                                            items={tunnelSortableForwardIds}
                                            strategy={
                                              verticalListSortingStrategy
                                            }
                                          >
                                            <SortableTableRow
                                              copyToClipboard={copyToClipboard}
                                              formatFlow={formatFlow}
                                              formatSpeed={formatSpeed}
                                              forward={forward}
                                              getStrategyDisplay={
                                                getStrategyDisplay
                                              }
                                              handleCopy={handleCopy}
                                              handleDelete={handleDelete}
                                              handleDiagnose={handleDiagnose}
                                              handleEdit={handleEdit}
                                              handleServiceToggle={
                                                handleServiceToggle
                                              }
                                              handleViewTrafficResetLogs={
                                                handleViewTrafficResetLogs
                                              }
                                              isAdmin={isAdmin}
                                              selectedIds={selectedIds}
                                              showAddressModal={
                                                showAddressModal
                                              }
                                              toggleSelect={toggleSelect}
                                              togglingIds={togglingIds}
                                            />
                                          </SortableContext>
                                        )}
                                      </TableBody>
                                    </Table>
                                  );
                                })()}
                              </DndContext>
                            </SortableTunnelGroupContainer>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
          <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
              暂无规则配置
            </h3>
            <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
              还没有创建任何规则配置，点击上方按钮开始创建
            </p>
          </CardBody>
        </Card>
      )}
      {/* 新增/编辑弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isDismissable={false}
        isOpen={modalOpen}
        placement="center"
        scrollBehavior="inside"
        size="lg"
        onOpenChange={(open) => {
          if (!open && !isEdit) resetDraft();
          setModalOpen(open);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">
                  {isCopy ? "复制规则" : isEdit ? "编辑规则" : "新增规则"}
                </h2>
                <p className="text-small text-default-500">
                  {isEdit ? "修改现有规则配置" : "创建新的规则配置"}
                </p>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4 pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                    <Input
                      errorMessage={errors.name}
                      isInvalid={!!errors.name}
                      label="规则名称"
                      placeholder="请输入规则名称"
                      value={form.name}
                      variant="bordered"
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                    {/* 入口端口 */}
                    <Input
                      description={
                        currentTunnelPortRange
                          ? `指定入口端口，留空自动分配 (允许范围: ${currentTunnelPortRange.min}-${currentTunnelPortRange.max})`
                          : "指定入口端口，留空则从节点可用端口中自动分配"
                      }
                      errorMessage={errors.inPort}
                      isInvalid={!!errors.inPort}
                      label="入口端口"
                      placeholder="留空则自动分配可用端口"
                      type="number"
                      value={form.inPort !== null ? form.inPort.toString() : ""}
                      variant="bordered"
                      onChange={(e) => {
                        const value = e.target.value;

                        setForm((prev) => {
                          const parsed = value ? parseInt(value) : null;

                          return {
                            ...prev,
                            inPort:
                              parsed !== null && !Number.isNaN(parsed)
                                ? parsed
                                : null,
                          };
                        });
                      }}
                    />
                    {/* 暂时保留旧限速选择 - 后续可删除
                  {isAdmin && (
                    <Select
                      label="规则限速"
                      placeholder="不限速"
                      selectedKeys={
                        selectedSpeedId !== null
                          ? [selectedSpeedId.toString()]
                          : []
                      }
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const selectedKey = Array.from(keys)[0] as
                          | string
                          | undefined;

                        setForm((prev) => ({
                          ...prev,
                          speedId: selectedKey ? Number(selectedKey) : null,
                        }));
                      }}
                    >
                      {availableSpeedLimits.map((speedLimit) => (
                        <SelectItem
                          key={speedLimit.id.toString()}
                          textValue={
                            speedLimit.name || `限速${speedLimit.speed}`
                          }
                        >
                          {speedLimit.name || `限速${speedLimit.speed}`}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                  */}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                    {/* 选择隧道 */}
                    <Select
                      description={
                        isEdit
                          ? "更改隧道将释放原端口并在新隧道分配端口"
                          : "看括号内说明选择隧道"
                      }
                      errorMessage={errors.tunnelId}
                      isInvalid={!!errors.tunnelId}
                      label="选择隧道"
                      placeholder="请选择关联的隧道"
                      selectedKeys={
                        tunnelSelectMode === "manual"
                          ? [MANUAL_TUNNEL_SELECT_KEY]
                          : form.tunnelId
                            ? [form.tunnelId.toString()]
                            : []
                      }
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const selectedKey = Array.from(keys)[0] as string;

                        if (selectedKey) {
                          handleTunnelChange(selectedKey);
                        }
                      }}
                    >
                      {canUseManualTunnel && (
                        <SelectItem key={MANUAL_TUNNEL_SELECT_KEY}>
                          极客可以自行组建隧道
                        </SelectItem>
                      )}
                      {tunnels.map((tunnel) => {
                        // 从 allTunnels 中获取 trafficRatio
                        const allTunnel = allTunnels.find(
                          (t) => t.id === tunnel.id,
                        );
                        const trafficRatio = allTunnel?.trafficRatio;
                        // 调用统一个格式化函数，自带 x 后缀
                        const formattedRatio =
                          formatTunnelTrafficRatio(trafficRatio);

                        return (
                          <SelectItem
                            key={tunnel.id.toString()}
                            textValue={
                              tunnel.remark
                                ? `${formatRemoteDisplayText(tunnel.name)} ^${formattedRatio} (${tunnel.remark})`
                                : `${formatRemoteDisplayText(tunnel.name)} ^${formattedRatio}`
                            }
                          >
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-foreground">
                                {formatRemoteDisplayText(tunnel.name)}
                              </span>
                              {/* 倍率标识紧跟在隧道名后面 */}
                              <span className="text-primary-600 font-bold text-[10px]">
                                ^{formattedRatio}
                              </span>
                              {/* 备注放在最后面 */}
                              {tunnel.remark && (
                                <span className="text-default-400 text-xs ml-0.5">
                                  ({tunnel.remark})
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </Select>
                    {/* 转发模式选择 */}
                    <div className="flex flex-col gap-0.5">
                      <Select
                        label="转发模式"
                        selectedKeys={[form.mode]}
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const selectedKey = Array.from(keys)[0] as string;

                          setForm((prev) => ({
                            ...prev,
                            mode: selectedKey as
                              | "gost"
                              | "nftables"
                              | "floxcore"
                              | "sdwan"
                              | "mimic",
                          }));
                        }}
                      >
                        <SelectItem key="gost">Gost 模式</SelectItem>
                        {!isFreeTier && flcEnabled && (
                          <SelectItem key="floxcore">FloxCore 模式</SelectItem>
                        )}
                        {!isFreeTier && nftEnabled && (
                          <SelectItem key="nftables">NFtables 模式</SelectItem>
                        )}
                        {!isFreeTier && wgmEnabled && (
                          <SelectItem key="mimic">WGMimic 模式</SelectItem>
                        )}
                        {!isFreeTier && sdwEnabled && (
                          <SelectItem key="sdwan">SDWAN 模式</SelectItem>
                        )}
                      </Select>
                      {/* 根据转发模式显示不同提示 */}
                      {form.mode === "gost" && (
                        <span className="text-xs text-primary-60">
                          基础转发模式，稳定通用
                        </span>
                      )}
                      {form.mode === "floxcore" && (
                        <span className="text-xs text-success-600">
                          高性能自研内核转发协义
                        </span>
                      )}
                      {form.mode === "nftables" && (
                        <span className="text-xs text-warning-600">
                          NFtables模式协议阻断暂不可用，不会用勿选
                        </span>
                      )}
                      {form.mode === "mimic" && (
                        <span className="text-xs text-secondary-600">
                          把UDP伪装成tcp转发，节点页面批量安装WGM
                        </span>
                      )}
                      {form.mode === "sdwan" && (
                        <span className="text-xs text-green-600">
                          先到组网里新建分组，才能使用这个转发模式
                        </span>
                      )}
                    </div>
                  </div>
                  {tunnelSelectMode === "manual" && (
                    <div className="rounded-lg border border-divider bg-default-50/40 p-3 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-semibold text-foreground">
                            自行组建隧道
                          </div>
                          <div className="text-xs text-default-500">
                            NAT机不建议自行组建隧道
                          </div>
                          {errors.manualTunnel && (
                            <div className="text-xs text-danger-600">
                              {errors.manualTunnel}
                            </div>
                          )}
                        </div>

                        <Select
                          label="隧道类型"
                          selectedKeys={[manualTunnelType.toString()]}
                          variant="bordered"
                          onSelectionChange={(keys) => {
                            const selectedKey = Array.from(keys)[0] as string;

                            if (!selectedKey) return;
                            const type = Number(selectedKey) === 1 ? 1 : 2;

                            setManualTunnelType(type);
                            if (type === 1) {
                              setManualChainNodes([]);
                              setManualOutNodeId([]);
                              setManualFocusedInputs({});
                            }
                          }}
                        >
                          <SelectItem key="1">端口转发</SelectItem>
                          <SelectItem key="2">隧道转发</SelectItem>
                        </Select>
                        <Select
                          disabledKeys={buildManualDisabledKeys({
                            role: "entry",
                          })}
                          errorMessage={errors.manualInNodeId}
                          isInvalid={!!errors.manualInNodeId}
                          label={
                            manualInNodeId.length > 0
                              ? "入口（已选 1 个）"
                              : "入口"
                          }
                          listboxHeader={renderNodeSelectHeader()}
                          placeholder="选择入口节点"
                          selectedKeys={manualInNodeId.map((item) =>
                            item.nodeId.toString(),
                          )}
                          variant="bordered"
                          onSelectionChange={(keys) => {
                            const selectedIds = toSelectedNodeIds(keys);
                            const autoIps = selectedIds
                              .map((id) => {
                                const node = nodes.find(
                                  (item) => item.id === id,
                                );

                                return (
                                  node?.serverIpV4 ||
                                  node?.serverIpV6 ||
                                  node?.intranetIp ||
                                  node?.serverIp ||
                                  ""
                                ).trim();
                              })
                              .filter(Boolean);

                            setManualInIp(autoIps.join("\n"));
                            setManualInNodeId((prev) =>
                              mergeOrderedManualNodes(prev, selectedIds, 1),
                            );
                          }}
                        >
                          {renderManualNodeItems({ role: "entry" })}
                        </Select>
                        <Textarea
                          classNames={{
                            inputWrapper: "!min-h-[20px] py-1.5",
                            input: "!min-h-[20px]",
                          }}
                          label="入口地址"
                          placeholder="请输入入口域名或 IP，多个地址每行一个"
                          rows={1}
                          value={manualInIp}
                          variant="bordered"
                          onChange={(e) => setManualInIp(e.target.value)}
                        />
                      </div>
                      {manualTunnelType === 2 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-foreground">
                                转发链
                              </span>
                              <span className="text-xs text-default-500">
                                已添加{" "}
                                <span className="text-red-500">
                                  {manualChainNodes.length}
                                </span>{" "}
                                跳
                              </span>
                            </div>
                            {manualChainNodes.length === 0 && (
                              <Button
                                className="text-primary"
                                size="sm"
                                variant="flat"
                                onPress={() =>
                                  setManualChainNodes((prev) => [...prev, []])
                                }
                              >
                                添加一跳
                              </Button>
                            )}
                          </div>
                          {manualChainNodes.map((group, groupIndex) => (
                            <div
                              key={groupIndex}
                              className="rounded-lg border border-default-200 bg-content1 p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-default-600">
                                  第{groupIndex + 1}跳
                                </span>
                                <Button
                                  color="danger"
                                  size="sm"
                                  variant="flat"
                                  onPress={() =>
                                    setManualChainNodes((prev) =>
                                      prev.filter(
                                        (_, index) => index !== groupIndex,
                                      ),
                                    )
                                  }
                                >
                                  删除
                                </Button>
                              </div>

                              {/* --- 节点、协议、策略：4列网格同行布局 (50% - 25% - 25%) --- */}
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                <div className="md:col-span-2">
                                  <Select
                                    disabledKeys={buildManualDisabledKeys({
                                      role: "chain",
                                      groupIndex,
                                    })}
                                    errorMessage={
                                      errors[`manualChainNodes_${groupIndex}`]
                                    }
                                    isInvalid={
                                      !!errors[`manualChainNodes_${groupIndex}`]
                                    }
                                    label={
                                      group.length > 0
                                        ? "节点（已选 1 个）"
                                        : "节点"
                                    }
                                    listboxHeader={renderNodeSelectHeader()}
                                    placeholder="选择当前跳节点"
                                    selectedKeys={group.map((item) =>
                                      item.nodeId.toString(),
                                    )}
                                    size="sm"
                                    variant="bordered"
                                    onSelectionChange={(keys) => {
                                      const selectedIds =
                                        toSelectedNodeIds(keys);

                                      setManualChainNodes((prev) => {
                                        const next = [...prev];

                                        next[groupIndex] =
                                          mergeOrderedManualNodes(
                                            next[groupIndex] || [],
                                            selectedIds,
                                            2,
                                          );

                                        return next;
                                      });
                                    }}
                                  >
                                    {renderManualNodeItems({
                                      role: "chain",
                                      groupIndex,
                                    })}
                                  </Select>
                                </div>

                                <div className="md:col-span-1">
                                  <Select
                                    label="传输层协议"
                                    placeholder="选择传输层协议"
                                    selectedKeys={[group[0]?.protocol || "tcp"]}
                                    size="sm"
                                    variant="bordered"
                                    onSelectionChange={(keys) => {
                                      const selectedKey = Array.from(
                                        keys,
                                      )[0] as string;

                                      setManualChainNodes((prev) => {
                                        const next = [...prev];

                                        next[groupIndex] = (
                                          next[groupIndex] || []
                                        ).map((item) => ({
                                          ...item,
                                          protocol: selectedKey,
                                        }));

                                        return next;
                                      });
                                    }}
                                  >
                                    <SelectItem key="tcp">TCP</SelectItem>
                                    <SelectItem key="mtcp">MTCP</SelectItem>
                                    <SelectItem key="tls">TLS</SelectItem>
                                    <SelectItem key="mtls">MTLS</SelectItem>
                                    <SelectItem key="wss">WSS</SelectItem>
                                    <SelectItem key="mwss">MWSS</SelectItem>
                                  </Select>
                                </div>

                                <div className="md:col-span-1">
                                  <Select
                                    label="负载策略"
                                    placeholder="选择策略"
                                    selectedKeys={[
                                      group[0]?.strategy || "round",
                                    ]}
                                    size="sm"
                                    variant="bordered"
                                    onSelectionChange={(keys) => {
                                      const selectedKey = Array.from(
                                        keys,
                                      )[0] as string;

                                      setManualChainNodes((prev) => {
                                        const next = [...prev];

                                        next[groupIndex] = (
                                          next[groupIndex] || []
                                        ).map((item) => ({
                                          ...item,
                                          strategy: selectedKey,
                                        }));

                                        return next;
                                      });
                                    }}
                                  >
                                    <SelectItem key="fifo">主备</SelectItem>
                                    <SelectItem key="round">轮询</SelectItem>
                                    <SelectItem key="rand">随机</SelectItem>
                                    <SelectItem key="best">最优</SelectItem>
                                  </Select>
                                </div>
                              </div>
                              {/* --- /节点、协议、策略 布局结束 --- */}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <Input
                                  description="指定当前级被上一级连接的端口，留空按节点端口范围自动分配"
                                  errorMessage={
                                    errors[`manualChainPort_${groupIndex}`]
                                  }
                                  isInvalid={
                                    !!errors[`manualChainPort_${groupIndex}`]
                                  }
                                  label="连接端口"
                                  placeholder="例：11111"
                                  size="sm"
                                  type="text"
                                  value={
                                    manualFocusedInputs[
                                      `chain_port_${groupIndex}`
                                    ] ?? formatManualPortsToDisplay(group)
                                  }
                                  variant="bordered"
                                  onBlur={() => {
                                    const finalValue =
                                      manualFocusedInputs[
                                        `chain_port_${groupIndex}`
                                      ] ?? formatManualPortsToDisplay(group);

                                    setManualFocusedInputs((prev) => {
                                      const next = { ...prev };

                                      delete next[`chain_port_${groupIndex}`];

                                      return next;
                                    });
                                    setManualChainNodes((prev) => {
                                      const next = [...prev];

                                      next[groupIndex] =
                                        applyPortsToManualNodes(
                                          next[groupIndex] || [],
                                          finalValue,
                                        );

                                      return next;
                                    });
                                  }}
                                  onChange={(e) =>
                                    setManualFocusedInputs((prev) => ({
                                      ...prev,
                                      [`chain_port_${groupIndex}`]:
                                        e.target.value,
                                    }))
                                  }
                                />
                                <Input
                                  description="v4 对应公网 v4 地址，v6 对应公网 v6 地址，lan 对应内网地址，留空自动匹配"
                                  label="连接 IP 类型"
                                  placeholder="例：lan"
                                  size="sm"
                                  type="text"
                                  value={
                                    manualFocusedInputs[
                                      `chain_ipType_${groupIndex}`
                                    ] ?? formatConnectIpTypesToDisplay(group)
                                  }
                                  variant="bordered"
                                  onBlur={() => {
                                    const finalValue =
                                      manualFocusedInputs[
                                        `chain_ipType_${groupIndex}`
                                      ] ?? formatConnectIpTypesToDisplay(group);

                                    setManualFocusedInputs((prev) => {
                                      const next = { ...prev };

                                      delete next[`chain_ipType_${groupIndex}`];

                                      return next;
                                    });
                                    setManualChainNodes((prev) => {
                                      const next = [...prev];

                                      next[groupIndex] =
                                        applyConnectIpTypesToManualNodes(
                                          next[groupIndex] || [],
                                          finalValue,
                                        );

                                      return next;
                                    });
                                  }}
                                  onChange={(e) =>
                                    setManualFocusedInputs((prev) => ({
                                      ...prev,
                                      [`chain_ipType_${groupIndex}`]:
                                        e.target.value,
                                    }))
                                  }
                                />
                              </div>
                              {groupIndex === manualChainNodes.length - 1 && (
                                <div className="flex justify-end">
                                  <Button
                                    className="text-primary"
                                    size="sm"
                                    variant="flat"
                                    onPress={() =>
                                      setManualChainNodes((prev) => [
                                        ...prev,
                                        [],
                                      ])
                                    }
                                  >
                                    再加一跳
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* --- 出口节点：4列网格同行布局 (50% - 25% - 25%) --- */}
                      {manualTunnelType === 2 && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3">
                          <div className="md:col-span-2">
                            <Select
                              disabledKeys={buildManualDisabledKeys({
                                role: "exit",
                              })}
                              errorMessage={errors.manualOutNodeId}
                              isInvalid={!!errors.manualOutNodeId}
                              label={
                                manualOutNodeId.length > 0
                                  ? "出口（已选 1 个）"
                                  : "出口"
                              }
                              listboxHeader={renderNodeSelectHeader()}
                              placeholder="选择出口节点"
                              selectedKeys={manualOutNodeId.map((item) =>
                                item.nodeId.toString(),
                              )}
                              variant="bordered"
                              onSelectionChange={(keys) => {
                                const selectedIds = toSelectedNodeIds(keys);

                                setManualOutNodeId((prev) =>
                                  mergeOrderedManualNodes(prev, selectedIds, 3),
                                );
                              }}
                            >
                              {renderManualNodeItems({ role: "exit" })}
                            </Select>
                          </div>

                          <div className="md:col-span-1">
                            <Select
                              label="传输层协议"
                              placeholder="选择传输层协议"
                              selectedKeys={[
                                manualOutNodeId[0]?.protocol || "tcp",
                              ]}
                              variant="bordered"
                              onSelectionChange={(keys) => {
                                const selectedKey = Array.from(
                                  keys,
                                )[0] as string;

                                setManualOutNodeId((prev) =>
                                  prev.map((item) => ({
                                    ...item,
                                    protocol: selectedKey,
                                  })),
                                );
                              }}
                            >
                              <SelectItem key="tcp">TCP</SelectItem>
                              <SelectItem key="mtcp">MTCP</SelectItem>
                              <SelectItem key="tls">TLS</SelectItem>
                              <SelectItem key="mtls">MTLS</SelectItem>
                              <SelectItem key="wss">WSS</SelectItem>
                              <SelectItem key="mwss">MWSS</SelectItem>
                            </Select>
                          </div>

                          <div className="md:col-span-1">
                            <Select
                              label="负载策略"
                              placeholder="选择策略"
                              selectedKeys={[
                                manualOutNodeId[0]?.strategy || "round",
                              ]}
                              variant="bordered"
                              onSelectionChange={(keys) => {
                                const selectedKey = Array.from(
                                  keys,
                                )[0] as string;

                                setManualOutNodeId((prev) =>
                                  prev.map((item) => ({
                                    ...item,
                                    strategy: selectedKey,
                                  })),
                                );
                              }}
                            >
                              <SelectItem key="fifo">主备</SelectItem>
                              <SelectItem key="round">轮询</SelectItem>
                              <SelectItem key="rand">随机</SelectItem>
                              <SelectItem key="best">最优</SelectItem>
                            </Select>
                          </div>
                        </div>
                      )}
                      {/* --- /出口节点 布局结束 --- */}

                      {manualTunnelType === 2 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                          <Input
                            description="指定出口节点被上一级连接的端口，留空按节点端口范围自动分配"
                            errorMessage={errors.manualOutPort}
                            isInvalid={!!errors.manualOutPort}
                            label="出口连接端口"
                            placeholder="例：33333"
                            type="text"
                            value={
                              manualFocusedInputs.out_port ??
                              formatManualPortsToDisplay(manualOutNodeId)
                            }
                            variant="bordered"
                            onBlur={() => {
                              const finalValue =
                                manualFocusedInputs.out_port ??
                                formatManualPortsToDisplay(manualOutNodeId);

                              setManualFocusedInputs((prev) => {
                                const next = { ...prev };

                                delete next.out_port;

                                return next;
                              });
                              setManualOutNodeId((prev) =>
                                applyPortsToManualNodes(prev, finalValue),
                              );
                            }}
                            onChange={(e) =>
                              setManualFocusedInputs((prev) => ({
                                ...prev,
                                out_port: e.target.value,
                              }))
                            }
                          />
                          <Input
                            description="v4 对应公网 v4，v6 对应公网 v6，lan 对应内网，留空自动匹配"
                            label="连接 IP 类型"
                            placeholder="例：v4"
                            type="text"
                            value={
                              manualFocusedInputs.out_ipType ??
                              formatConnectIpTypesToDisplay(manualOutNodeId)
                            }
                            variant="bordered"
                            onBlur={() => {
                              const finalValue =
                                manualFocusedInputs.out_ipType ??
                                formatConnectIpTypesToDisplay(manualOutNodeId);

                              setManualFocusedInputs((prev) => {
                                const next = { ...prev };

                                delete next.out_ipType;

                                return next;
                              });
                              setManualOutNodeId((prev) =>
                                applyConnectIpTypesToManualNodes(
                                  prev,
                                  finalValue,
                                ),
                              );
                            }}
                            onChange={(e) =>
                              setManualFocusedInputs((prev) => ({
                                ...prev,
                                out_ipType: e.target.value,
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="space-y-4 pb-4">
                    <Textarea
                      description="格式: IP:端口 或 域名:端口，支持多个地址（每行一个）"
                      errorMessage={errors.remoteAddr}
                      isInvalid={!!errors.remoteAddr}
                      label="落地地址"
                      maxRows={8}
                      minRows={4}
                      placeholder="请输入落地地址，多个地址用换行分隔，例如:&#10;8.8.8.8:10000&#10;[2001:db8::10]:10086&#10;test.example.com:10010"
                      value={form.remoteAddr}
                      variant="bordered"
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          remoteAddr: e.target.value,
                        }))
                      }
                    />
                    {getAddressCount(form.remoteAddr) > 1 && (
                      <Select
                        description="多个落地地址的负载均衡策略"
                        label="负载策略"
                        placeholder="请选择负载均衡策略"
                        selectedKeys={[form.strategy]}
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const selectedKey = Array.from(keys)[0] as string;

                          setForm((prev) => ({
                            ...prev,
                            strategy: selectedKey,
                          }));
                        }}
                      >
                        <SelectItem key="fifo">主备模式 - 自上而下</SelectItem>
                        <SelectItem key="round">轮询模式 - 依次轮换</SelectItem>
                        <SelectItem key="rand">随机模式 - 随机选择</SelectItem>
                        <SelectItem key="hash">哈希模式 - IP 哈希</SelectItem>
                      </Select>
                    )}
                  </div>
                  {/* 高级功能折叠面板 - 移到最底部 */}
                  <div className="border border-divider rounded-lg overflow-hidden mt-4">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-default-100/50 hover:bg-default-100 transition-colors"
                      type="button"
                      onClick={() =>
                        setAdvancedOptionsOpen(!advancedOptionsOpen)
                      }
                    >
                      <span className="text-sm font-semibold text-foreground">
                        高级功能
                      </span>
                      <svg
                        className={`w-5 h-5 text-default-400 transition-transform ${advancedOptionsOpen ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M19 9l-7 7-7-7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      </svg>
                    </button>
                    {advancedOptionsOpen && (
                      <div className="p-4 space-y-4 bg-content1">
                        {/* 限速、连接数限制、流量控制 - 同一行 */}
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <SpeedLimitConfigField
                            maxSpeed={currentTunnelCeilingSpeed}
                            readOnly={currentEffectiveSpeedLimit > 0}
                            speedLimit={form.speedLimit}
                            onSpeedLimitChange={(val) =>
                              setForm((prev) => ({
                                ...prev,
                                speedLimit: val,
                                speedLimitEnabled: val > 0,
                              }))
                            }
                          />
                          <TrafficLimitField
                            value={form.trafficLimit}
                            onChange={(val) =>
                              setForm((prev) => ({
                                ...prev,
                                trafficLimit: val,
                              }))
                            }
                          />
                          <ConnectionLimitField
                            value={form.maxConnections}
                            onChange={(val) =>
                              setForm((prev) => ({
                                ...prev,
                                maxConnections: val,
                              }))
                            }
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {/* 监听ip */}
                          <Select
                            description={
                              isCurrentTunnelMultiEntrance
                                ? "多入口隧道不支持自定义监听IP，使用各节点默认IP"
                                : "从入口节点IP中选择，留空使用默认"
                            }
                            isDisabled={
                              !form.tunnelId ||
                              currentTunnelIpOptions.length === 0 ||
                              isCurrentTunnelMultiEntrance
                            }
                            label="监听IP"
                            placeholder={
                              isCurrentTunnelMultiEntrance
                                ? "多入口隧道使用节点默认IP"
                                : form.tunnelId
                                  ? currentTunnelIpOptions.length > 0
                                    ? "选择入口监听IP"
                                    : "当前隧道入口节点暂无可选IP"
                                  : "请先选择隧道"
                            }
                            selectedKeys={[form.inIp || "__default__"]}
                            variant="bordered"
                            onSelectionChange={(keys) => {
                              const selectedKey = Array.from(keys)[0] as string;

                              setInIpTouched(true);
                              setForm((prev) => ({
                                ...prev,
                                inIp:
                                  selectedKey === "__default__"
                                    ? ""
                                    : selectedKey,
                              }));
                            }}
                          >
                            <SelectItem key="__default__">
                              默认入口IP
                            </SelectItem>
                            {currentTunnelIpOptions.map((ip) => (
                              <SelectItem key={ip}>{ip}</SelectItem>
                            ))}
                          </Select>
                          {/* 有效期 */}
                          <ExpiryTimeField
                            value={form.expiryTime}
                            onChange={(val) =>
                              setForm((prev) => ({
                                ...prev,
                                expiryTime: val,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
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
                <h2 className="text-lg font-bold text-danger">确认</h2>
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600">
                  确定要删除规则{" "}
                  <span className="font-semibold text-foreground">
                    &quot;{forwardToDelete?.name}&quot;
                  </span>{" "}
                  吗？
                </p>
                <p className="text-small text-default-500 mt-2">
                  此操作无法撤销，删除后该规则将永久消失。
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
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 地址列表弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={addressModalOpen}
        scrollBehavior="inside"
        size="md"
        onClose={() => setAddressModalOpen(false)}
      >
        <ModalContent>
          <ModalHeader className="text-base">{addressModalTitle}</ModalHeader>
          <ModalBody className="pb-2">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {addressList.map((item) => {
                const { host, port } = splitAddressHostPort(item.address);

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-3 border border-default-200 dark:border-default-100 rounded-lg"
                  >
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span
                        className="text-sm text-foreground font-mono truncate cursor-pointer hover:text-primary transition-colors"
                        onClick={() => copyToClipboard(host, "地址")}
                      >
                        {host}
                      </span>
                      <span className="text-sm text-default-600 shrink-0">
                        :
                      </span>
                      <span
                        className="text-sm text-foreground font-mono cursor-pointer hover:text-primary transition-colors shrink-0"
                        onClick={() => copyToClipboard(port, "端口")}
                      >
                        {port}
                      </span>
                    </div>
                    <button
                      className="inline-flex items-center justify-center px-3 h-8 text-sm font-medium bg-default-100 hover:bg-default-200 dark:bg-default-50 dark:hover:bg-default-200 rounded-lg transition-colors shrink-0"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(item.address, "完整地址");
                      }}
                    >
                      复制
                    </button>
                  </div>
                );
              })}
            </div>
          </ModalBody>
          {/* 这里是全新的底部操作栏：flex justify-between 会让两个按钮分居左右 */}
          <ModalFooter className="flex justify-end w-full">
            <Button variant="flat" onPress={() => setAddressModalOpen(false)}>
              关闭
            </Button>
            <Button color="primary" onPress={copyAllAddresses}>
              复制全部
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 导出数据弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={exportModalOpen}
        placement="center"
        scrollBehavior="inside"
        size="md"
        onClose={() => {
          setExportModalOpen(false);
          setSelectedTunnelForExport(null);
          setExportData("");
        }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">导出规则数据</h2>
            <p className="text-small text-default-500">
              格式：落地地址|规则名称|入口端口
            </p>
          </ModalHeader>
          <ModalBody className="pb-6">
            <div className="space-y-4">
              {/* 隧道选择 */}
              <div>
                <Select
                  label="选择导出隧道（可选）"
                  placeholder="不选则导出全部隧道"
                  selectedKeys={
                    selectedTunnelForExport
                      ? [selectedTunnelForExport.toString()]
                      : []
                  }
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const selectedKey = Array.from(keys)[0] as string;

                    setSelectedTunnelForExport(
                      selectedKey
                        ? (() => {
                            const parsed = parseInt(selectedKey);

                            return Number.isNaN(parsed) ? null : parsed;
                          })()
                        : null,
                    );
                  }}
                >
                  {tunnels.map((tunnel) => (
                    <SelectItem
                      key={tunnel.id.toString()}
                      textValue={
                        tunnel.remark
                          ? `${formatRemoteDisplayText(tunnel.name)} (${tunnel.remark})`
                          : formatRemoteDisplayText(tunnel.name)
                      }
                    >
                      <span>
                        {formatRemoteDisplayText(tunnel.name)}
                        {tunnel.remark && (
                          <span className="text-xs text-default-400 ml-1">
                            ({tunnel.remark})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {/* 导出按钮和数据 */}
              {exportData && (
                <div className="flex justify-between items-center">
                  <Button
                    color="primary"
                    isLoading={exportLoading}
                    size="sm"
                    startContent={
                      <svg
                        aria-hidden="true"
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          clipRule="evenodd"
                          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                          fillRule="evenodd"
                        />
                      </svg>
                    }
                    onPress={executeExport}
                  >
                    重新生成
                  </Button>
                  <Button
                    color="secondary"
                    size="sm"
                    startContent={
                      <svg
                        aria-hidden="true"
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                      </svg>
                    }
                    onPress={copyExportData}
                  >
                    复制
                  </Button>
                </div>
              )}
              {/* 初始导出按钮 */}
              {!exportData && (
                <div className="text-right">
                  <Button
                    color="primary"
                    isLoading={exportLoading}
                    size="sm"
                    startContent={
                      <svg
                        aria-hidden="true"
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          clipRule="evenodd"
                          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
                          fillRule="evenodd"
                        />
                      </svg>
                    }
                    onPress={executeExport}
                  >
                    生成导出数据
                  </Button>
                </div>
              )}
              {/* 导出数据显示 */}
              {exportData && (
                <div className="relative">
                  <Textarea
                    readOnly
                    className="font-medium text-sm"
                    classNames={{
                      input: "font-medium text-sm",
                    }}
                    maxRows={20}
                    minRows={10}
                    placeholder="暂无数据"
                    value={exportData}
                    variant="bordered"
                  />
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setExportModalOpen(false)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 导入数据弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-2xl rounded-2xl overflow-hidden",
        }}
        isOpen={importModalOpen}
        placement="center"
        scrollBehavior="inside"
        size="lg"
        onClose={() => setImportModalOpen(false)}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">导入规则数据</h2>
            {importFormat === "FLOX" ? (
              <>
                <p className="text-small text-default-500">
                  格式：落地地址|规则名称|入口端口，每行一个，入口端口留空将自动分配可用端口
                </p>
                <p className="text-small text-default-400">
                  落地地址支持单个地址(如：example.com:8080)或多个地址用逗号分隔(如：3.3.3.3:3,4.4.4.4:4)
                </p>
              </>
            ) : (
              <>
                <p className="text-small text-default-500">
                  ny格式：JSON对象，支持多个落地地址（负载均衡），按所选隧道导入
                </p>
                <p className="text-small text-default-400">
                  格式：&#123;&quot;dest&quot;:[&quot;地址:端口&quot;],&quot;listen_port&quot;:端口,&quot;name&quot;:&quot;名称&quot;&#125;（listen_port可省略，自动分配端口）
                </p>
              </>
            )}
          </ModalHeader>
          <ModalBody className="pb-6 overflow-y-auto">
            <div className="space-y-4">
              {/* 格式选择 */}
              <Select
                isRequired
                label="导入格式"
                placeholder="请选择导入格式"
                selectedKeys={[importFormat]}
                variant="bordered"
                onSelectionChange={(keys) => {
                  const selectedKey = Array.from(keys)[0] as ImportFormat;

                  if (selectedKey) {
                    setImportFormat(selectedKey);
                    setSelectedTunnelForImport(null);
                    setImportData("");
                    setImportResults([]);
                  }
                }}
              >
                <SelectItem key="flox" textValue="flox格式">
                  Flox格式（管道分隔）
                </SelectItem>
                <SelectItem key="ny" textValue="ny格式">
                  ny格式（JSON）
                </SelectItem>
              </Select>
              {/* 隧道选择 - 两种格式都需要 */}
              <Select
                isRequired
                label="选择导入隧道"
                placeholder="请选择要导入的隧道"
                selectedKeys={
                  selectedTunnelForImport
                    ? [selectedTunnelForImport.toString()]
                    : []
                }
                variant="bordered"
                onSelectionChange={(keys) => {
                  const selectedKey = Array.from(keys)[0] as string;

                  setSelectedTunnelForImport(
                    selectedKey ? parseInt(selectedKey) : null,
                  );
                }}
              >
                {tunnels.map((tunnel) => (
                  <SelectItem
                    key={tunnel.id.toString()}
                    textValue={
                      tunnel.remark
                        ? `${formatRemoteDisplayText(tunnel.name)} (${tunnel.remark})`
                        : formatRemoteDisplayText(tunnel.name)
                    }
                  >
                    <span>
                      {formatRemoteDisplayText(tunnel.name)}
                      {tunnel.remark && (
                        <span className="text-xs text-default-400 ml-1">
                          ({tunnel.remark})
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </Select>
              {/* 输入区域 */}
              <Textarea
                classNames={{
                  input: "font-medium text-sm",
                }}
                label="导入数据"
                maxRows={12}
                minRows={8}
                placeholder={
                  importFormat === "FLOX"
                    ? "请输入要导入的规则数据，格式：落地地址|规则名称|入口端口"
                    : '请输入ny格式数据，每行一个JSON对象，如：{"dest":["1.2.3.4:80"],"listen_port":8080,"name":"规则1"}；listen_port可省略自动分配'
                }
                value={importData}
                variant="flat"
                onChange={(e) => setImportData(e.target.value)}
              />
              {/* 导入结果 */}
              {importResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-semibold">导入结果</h3>
                    <span className="text-xs text-default-500">
                      成功：{importResults.filter((r) => r.success).length} /
                      总计：{importResults.length}
                    </span>
                  </div>
                  <div
                    className="max-h-40 sm:max-h-60 overflow-y-auto space-y-1"
                    style={{
                      scrollbarWidth: "thin",
                      scrollbarColor: "rgb(156 163 175) transparent",
                    }}
                  >
                    {importResults.map((result, index) => (
                      <div
                        key={index}
                        className={`p-2 rounded border ${
                          result.success
                            ? "bg-success-50 dark:bg-success-100/10 border-success-200 dark:border-success-300/20"
                            : "bg-danger-50 dark:bg-danger-100/10 border-danger-200 dark:border-danger-300/20"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {result.success ? (
                            <svg
                              aria-hidden="true"
                              className="w-3 h-3 text-success-600 flex-shrink-0"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                clipRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                fillRule="evenodd"
                              />
                            </svg>
                          ) : (
                            <svg
                              aria-hidden="true"
                              className="w-3 h-3 text-danger-600 flex-shrink-0"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                clipRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                fillRule="evenodd"
                              />
                            </svg>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span
                                className={`text-xs font-medium ${
                                  result.success
                                    ? "text-success-700 dark:text-success-300"
                                    : "text-danger-700 dark:text-danger-300"
                                }`}
                              >
                                {result.success ? "成功" : "失败"}
                              </span>
                              <span className="text-xs text-default-500">
                                |
                              </span>
                              <code className="text-xs font-medium text-default-600 truncate">
                                {result.line}
                              </code>
                            </div>
                            <div
                              className={`text-xs ${
                                result.success
                                  ? "text-success-600 dark:text-success-400"
                                  : "text-danger-600 dark:text-danger-400"
                              }`}
                            >
                              {result.message}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setImportModalOpen(false)}>
              关闭
            </Button>
            <Button
              color="warning"
              isDisabled={!importData.trim() || !selectedTunnelForImport}
              isLoading={importLoading}
              onPress={executeImport}
            >
              开始导入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 诊断结果弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={diagnosisModalOpen}
        placement="center"
        scrollBehavior="inside"
        size="2xl"
        onOpenChange={(open) => {
          setDiagnosisModalOpen(open);
          if (!open) {
            diagnosisAbortRef.current?.abort();
            diagnosisAbortRef.current = null;
            setDiagnosisLoading(false);
          }
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1 bg-content1">
                <h2 className="text-xl font-bold">规则诊断结果</h2>
                {currentDiagnosisForward && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-small text-default-500 truncate flex-1 min-w-0">
                      {currentDiagnosisForward.name}
                    </span>
                    <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
                      规则服务
                    </div>
                  </div>
                )}
              </ModalHeader>
              <ModalBody className="bg-content1">
                {diagnosisResult ? (
                  <div className="space-y-4">
                    {diagnosisLoading && (
                      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <Spinner size="sm" />
                          <span>
                            正在诊断 {diagnosisProgress.completed}/
                            {diagnosisProgress.total > 0
                              ? diagnosisProgress.total
                              : "?"}
                          </span>
                        </div>
                        <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
                          流式更新中
                        </div>
                      </div>
                    )}
                    {diagnosisProgress.timedOut && (
                      <Alert
                        color="warning"
                        description="诊断超时（单条30秒 / 整体2分钟），以下为当前已完成结果。"
                        title="诊断超时"
                        variant="flat"
                      />
                    )}
                    {/* 统计摘要 */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 bg-default-100 dark:bg-gray-800 rounded-lg border border-divider">
                        <div className="text-2xl font-bold text-foreground">
                          {diagnosisProgress.total > 0
                            ? diagnosisProgress.total
                            : diagnosisResult.results.length}
                        </div>
                        <div className="text-xs text-default-500 mt-1">
                          总测试数
                        </div>
                      </div>
                      <div className="text-center p-3 bg-success-50 dark:bg-success-900/20 rounded-lg border border-success-200 dark:border-success-700">
                        <div className="text-2xl font-bold text-success-600 dark:text-success-400">
                          {diagnosisProgress.completed > 0 ||
                          diagnosisProgress.total > 0
                            ? diagnosisProgress.success
                            : diagnosisResult.results.filter((r) => r.success)
                                .length}
                        </div>
                        <div className="text-xs text-success-600 dark:text-success-400/80 mt-1">
                          成功
                        </div>
                      </div>
                      <div className="text-center p-3 bg-danger-50 dark:bg-danger-900/20 rounded-lg border border-danger-200 dark:border-danger-700">
                        <div className="text-2xl font-bold text-danger-600 dark:text-danger-400">
                          {diagnosisProgress.completed > 0 ||
                          diagnosisProgress.total > 0
                            ? diagnosisProgress.failed
                            : diagnosisResult.results.filter((r) => !r.success)
                                .length}
                        </div>
                        <div className="text-xs text-danger-600 dark:text-danger-400/80 mt-1">
                          失败
                        </div>
                      </div>
                    </div>
                    {/* 桌面端表格展示 */}
                    <div className="hidden md:block space-y-3">
                      {(() => {
                        // 使用后端返回的 chainType 和 inx 字段进行分组
                        const groupedResults = {
                          entryService: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1 && r.serviceCheck,
                          ),
                          entryConnectivity: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1 && r.entryConnectivity,
                          ),
                          entry: diagnosisResult.results.filter(
                            (r) =>
                              r.fromChainType === 1 &&
                              !r.serviceCheck &&
                              !r.entryConnectivity,
                          ),
                          chains: {} as Record<
                            number,
                            typeof diagnosisResult.results
                          >,
                          exit: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 3,
                          ),
                        };

                        // 按 inx 分组链路测试
                        diagnosisResult.results.forEach((r) => {
                          if (r.fromChainType === 2 && r.fromInx != null) {
                            if (!groupedResults.chains[r.fromInx]) {
                              groupedResults.chains[r.fromInx] = [];
                            }
                            groupedResults.chains[r.fromInx].push(r);
                          }
                        });
                        const renderTableSection = (
                          title: string,
                          results: typeof diagnosisResult.results,
                        ) => {
                          if (results.length === 0) return null;

                          return (
                            <div
                              key={title}
                              className="border border-divider rounded-lg overflow-hidden bg-white dark:bg-gray-800"
                            >
                              <div className="bg-primary/10 dark:bg-primary/20 px-3 py-2 border-b border-divider">
                                <h3 className="text-sm font-semibold text-primary">
                                  {title}
                                </h3>
                              </div>
                              <div className="overflow-x-auto min-w-0">
                              <table className="w-full text-sm table-fixed">
                                <thead className="bg-default-100 dark:bg-gray-700">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-xs">
                                      路径
                                    </th>
                                    <th className="px-3 py-2 text-center font-semibold text-xs w-20">
                                      状态
                                    </th>
                                    <th className="px-3 py-2 text-center font-semibold text-xs w-24">
                                      延迟(ms)
                                    </th>
                                    <th className="px-3 py-2 text-center font-semibold text-xs w-24">
                                      丢包率
                                    </th>
                                    <th className="px-3 py-2 text-center font-semibold text-xs w-20">
                                      质量
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-divider bg-white dark:bg-gray-800">
                                  {results.map((result, index) => {
                                    const isDiagnosing = Boolean(
                                      result.diagnosing,
                                    );
                                    const isSuccess = result.success === true;
                                    const isServiceCheck =
                                      result.serviceCheck === true;
                                    const instanceLine =
                                      getDiagnosisInstanceLine(result);
                                    const quality =
                                      getForwardDiagnosisQualityDisplay(
                                        result.averageTime,
                                        result.packetLoss,
                                      );

                                    return (
                                      <tr
                                        key={index}
                                        className={`hover:bg-default-50 dark:hover:bg-gray-700/50 ${
                                          isDiagnosing
                                            ? "bg-warning-50 dark:bg-warning-900/20"
                                            : isSuccess
                                              ? "bg-white dark:bg-gray-800"
                                              : "bg-danger-50 dark:bg-danger-900/30"
                                        }`}
                                      >
                                        <td className="px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            {isDiagnosing ? (
                                              <Spinner size="sm" />
                                            ) : (
                                              <span
                                                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                                                  isSuccess
                                                    ? "bg-success text-white"
                                                    : "bg-danger text-white"
                                                }`}
                                              >
                                                {isSuccess ? "✓" : "✗"}
                                              </span>
                                            )}
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium text-foreground truncate">
                                                {formatRemoteDisplayText(
                                                  result.description,
                                                )}
                                              </div>
                                              {instanceLine && (
                                                <div className="text-[11px] text-primary truncate">
                                                  {instanceLine}
                                                </div>
                                              )}
                                              <div className="text-xs text-default-500 truncate">
                                                <span className="truncate">
                                                  {maskPublicIP(
                                                    result.targetIp,
                                                  )}
                                                  :{result.targetPort}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          <div
                                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${isDiagnosing ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : isSuccess ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                          >
                                            {isDiagnosing
                                              ? "诊断中"
                                              : isSuccess
                                                ? "成功"
                                                : "失败"}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {isSuccess && !isServiceCheck ? (
                                            <span className="font-semibold text-primary">
                                              {result.averageTime?.toFixed(0)}
                                            </span>
                                          ) : (
                                            <span className="text-default-400">
                                              -
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {isSuccess && !isServiceCheck ? (
                                            <span
                                              className={`font-semibold ${
                                                (result.packetLoss || 0) > 0
                                                  ? "text-warning"
                                                  : "text-success"
                                              }`}
                                            >
                                              {result.packetLoss?.toFixed(1)}%
                                            </span>
                                          ) : (
                                            <span className="text-default-400">
                                              -
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {isSuccess &&
                                          !isServiceCheck &&
                                          quality ? (
                                            <div
                                              className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${quality.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : quality.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                            >
                                              {quality.text}
                                            </div>
                                          ) : (
                                            <span className="text-default-400">
                                              -
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              </div>
                            </div>
                          );
                        };

                        return (
                          <>
                            {renderTableSection(
                              "入口规则服务",
                              groupedResults.entryService,
                            )}
                            {renderTableSection(
                              "入口实例公网连通性",
                              groupedResults.entryConnectivity,
                            )}
                            {/* 入口链路测试 */}
                            {renderTableSection(
                              "入口链路测试",
                              groupedResults.entry,
                            )}
                            {/* 链路测试（按跳数排序） */}
                            {Object.keys(groupedResults.chains)
                              .map(Number)
                              .sort((a, b) => a - b)
                              .map((hop) =>
                                renderTableSection(
                                  `🔗 转发链 - 第${hop}跳`,
                                  groupedResults.chains[hop],
                                ),
                              )}
                            {/* 出口测试 */}
                            {renderTableSection(
                              "🚀 出口测试",
                              groupedResults.exit,
                            )}
                            {/* SDWAN Overlay 状态 */}
                            {(() => {
                              const sdwanItems = diagnosisResult.results
                                .filter(
                                  (r: any) => r.sdwanRunning !== undefined,
                                )
                                .sort(
                                  (a: any, b: any) =>
                                    (a.fromChainType || 0) -
                                    (b.fromChainType || 0),
                                );

                              if (sdwanItems.length === 0) return null;

                              return (
                                <div className="border border-divider rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                                  <div className="bg-violet-500/10 dark:bg-violet-500/20 px-3 py-2 border-b border-divider">
                                    <h3 className="text-sm font-semibold text-violet-600 dark:text-violet-400">
                                      🌐 SDWAN Overlay 状态
                                    </h3>
                                  </div>
                                  {sdwanItems.map(
                                    (item: any, index: number) => (
                                      <div
                                        key={index}
                                        className="p-3 border-b border-divider last:border-b-0"
                                      >
                                        <div className="flex items-center gap-2 mb-2">
                                          <span
                                            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${item.success ? "bg-success text-white" : "bg-danger text-white"}`}
                                          >
                                            {item.success ? "✓" : "✗"}
                                          </span>
                                          <span className="font-medium">
                                            {item.description}
                                          </span>
                                          <span
                                            className={`text-xs px-2 py-0.5 rounded ${item.sdwanRunning ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                          >
                                            {item.sdwanRunning
                                              ? "运行中"
                                              : "已停止"}
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-default-600">
                                          <div>
                                            VPN IP:{" "}
                                            <span className="font-mono font-medium">
                                              {item.sdwanVpnIP || "-"}
                                            </span>
                                          </div>
                                          <div>
                                            网络:{" "}
                                            <span className="font-mono font-medium">
                                              {item.sdwanNetwork || "-"}
                                            </span>
                                          </div>
                                          <div>
                                            证书掩码:{" "}
                                            <span className="font-medium">
                                              {item.sdwanCertMask != null
                                                ? `/${item.sdwanCertMask}`
                                                : "-"}
                                            </span>
                                          </div>
                                          <div>
                                            缓存实例:{" "}
                                            <span className="font-medium">
                                              {item.sdwanCacheCount ?? 0}
                                            </span>
                                          </div>
                                        </div>
                                        {item.message && (
                                          <div className="mt-1 text-xs text-default-500">
                                            {item.message}
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </div>
                    {/* 移动端卡片展示 */}
                    <div className="md:hidden space-y-3">
                      {(() => {
                        // 使用后端返回的 chainType 和 inx 字段进行分组
                        const groupedResults = {
                          entryService: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1 && r.serviceCheck,
                          ),
                          entryConnectivity: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1 && r.entryConnectivity,
                          ),
                          entry: diagnosisResult.results.filter(
                            (r) =>
                              r.fromChainType === 1 &&
                              !r.serviceCheck &&
                              !r.entryConnectivity,
                          ),
                          chains: {} as Record<
                            number,
                            typeof diagnosisResult.results
                          >,
                          exit: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 3,
                          ),
                        };

                        // 按 inx 分组链路测试
                        diagnosisResult.results.forEach((r) => {
                          if (r.fromChainType === 2 && r.fromInx != null) {
                            if (!groupedResults.chains[r.fromInx]) {
                              groupedResults.chains[r.fromInx] = [];
                            }
                            groupedResults.chains[r.fromInx].push(r);
                          }
                        });
                        const renderCardSection = (
                          title: string,
                          results: typeof diagnosisResult.results,
                        ) => {
                          if (results.length === 0) return null;

                          return (
                            <div key={title} className="space-y-2">
                              <div className="px-2 py-1.5 bg-primary/10 dark:bg-primary/20 rounded-lg border border-primary/30">
                                <h3 className="text-sm font-semibold text-primary">
                                  {title}
                                </h3>
                              </div>
                              {results.map((result, index) => {
                                const isDiagnosing = Boolean(result.diagnosing);
                                const isSuccess = result.success === true;
                                const isServiceCheck =
                                  result.serviceCheck === true;
                                const instanceLine =
                                  getDiagnosisInstanceLine(result);
                                const quality =
                                  getForwardDiagnosisQualityDisplay(
                                    result.averageTime,
                                    result.packetLoss,
                                  );

                                return (
                                  <div
                                    key={index}
                                    className={`border rounded-lg p-3 ${
                                      isDiagnosing
                                        ? "border-warning-200 dark:border-warning-300/30 bg-warning-50 dark:bg-warning-900/20"
                                        : isSuccess
                                          ? "border-divider bg-white dark:bg-gray-800"
                                          : "border-danger-200 dark:border-danger-300/30 bg-danger-50 dark:bg-danger-900/30"
                                    }`}
                                  >
                                    <div className="flex items-start gap-2 mb-2">
                                      {isDiagnosing ? (
                                        <Spinner size="sm" />
                                      ) : (
                                        <span
                                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                                            isSuccess
                                              ? "bg-success text-white"
                                              : "bg-danger text-white"
                                          }`}
                                        >
                                          {isSuccess ? "✓" : "✗"}
                                        </span>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-sm text-foreground break-words">
                                          {formatRemoteDisplayText(
                                            result.description,
                                          )}
                                        </div>
                                        {instanceLine && (
                                          <div className="text-[11px] text-primary mt-0.5 break-words">
                                            {instanceLine}
                                          </div>
                                        )}
                                        <div className="text-xs text-default-500 mt-0.5 truncate">
                                          <span className="truncate">
                                            {maskPublicIP(result.targetIp)}:
                                            {result.targetPort}
                                          </span>
                                        </div>
                                      </div>
                                      <div
                                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${isDiagnosing ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : isSuccess ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                      >
                                        {isDiagnosing
                                          ? "诊断中"
                                          : isSuccess
                                            ? "成功"
                                            : "失败"}
                                      </div>
                                    </div>
                                    {isSuccess && !isServiceCheck ? (
                                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-divider">
                                        <div className="text-center">
                                          <div className="text-lg font-bold text-primary">
                                            {result.averageTime?.toFixed(0)}
                                          </div>
                                          <div className="text-xs text-default-500">
                                            延迟(ms)
                                          </div>
                                        </div>
                                        <div className="text-center">
                                          <div
                                            className={`text-lg font-bold ${
                                              (result.packetLoss || 0) > 0
                                                ? "text-warning"
                                                : "text-success"
                                            }`}
                                          >
                                            {result.packetLoss?.toFixed(1)}%
                                          </div>
                                          <div className="text-xs text-default-500">
                                            丢包率
                                          </div>
                                        </div>
                                        <div className="text-center">
                                          {quality && (
                                            <>
                                              <div
                                                className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${quality.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : quality.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                              >
                                                {quality.text}
                                              </div>
                                              <div className="text-xs text-default-500 mt-0.5">
                                                质量
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    ) : isServiceCheck && isSuccess ? (
                                      <div className="mt-2 border-t border-divider pt-2 text-xs text-success">
                                        {result.message ||
                                          `入口服务状态正常 (${result.serviceState || "running"})`}
                                      </div>
                                    ) : (
                                      <div className="mt-2 pt-2 border-t border-divider">
                                        <div
                                          className={`text-xs ${
                                            isDiagnosing
                                              ? "text-warning"
                                              : "text-danger"
                                          }`}
                                        >
                                          {isDiagnosing
                                            ? result.message || "诊断中..."
                                            : result.message || "连接失败"}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        };

                        return (
                          <>
                            {renderCardSection(
                              "入口规则服务",
                              groupedResults.entryService,
                            )}
                            {renderCardSection(
                              "入口实例公网连通性",
                              groupedResults.entryConnectivity,
                            )}
                            {/* 入口链路测试 */}
                            {renderCardSection(
                              "入口链路测试",
                              groupedResults.entry,
                            )}
                            {/* 链路测试（按跳数排序） */}
                            {Object.keys(groupedResults.chains)
                              .map(Number)
                              .sort((a, b) => a - b)
                              .map((hop) =>
                                renderCardSection(
                                  `🔗 转发链 - 第${hop}跳`,
                                  groupedResults.chains[hop],
                                ),
                              )}
                            {/* 出口测试 */}
                            {renderCardSection(
                              "🚀 出口测试",
                              groupedResults.exit,
                            )}
                            {/* SDWAN Overlay 状态 */}
                            {(() => {
                              const sdwanItems = diagnosisResult.results
                                .filter(
                                  (r: any) => r.sdwanRunning !== undefined,
                                )
                                .sort(
                                  (a: any, b: any) =>
                                    (a.fromChainType || 0) -
                                    (b.fromChainType || 0),
                                );

                              if (sdwanItems.length === 0) return null;

                              return (
                                <div className="space-y-2">
                                  <div className="px-2 py-1.5 bg-violet-500/10 dark:bg-violet-500/20 rounded-lg border border-violet-500/30">
                                    <h3 className="text-sm font-semibold text-violet-600 dark:text-violet-400">
                                      🌐 SDWAN Overlay 状态
                                    </h3>
                                  </div>
                                  {sdwanItems.map(
                                    (item: any, index: number) => (
                                      <div
                                        key={index}
                                        className={`border rounded-lg p-3 ${item.success ? "border-divider bg-white dark:bg-gray-800" : "border-danger-200 dark:border-danger-300/30 bg-danger-50 dark:bg-danger-900/30"}`}
                                      >
                                        <div className="flex items-start gap-2 mb-2">
                                          <span
                                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${item.success ? "bg-success text-white" : "bg-danger text-white"}`}
                                          >
                                            {item.success ? "✓" : "✗"}
                                          </span>
                                          <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-sm text-foreground break-words">
                                              {item.description}
                                            </div>
                                          </div>
                                          <span
                                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${item.sdwanRunning ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                          >
                                            {item.sdwanRunning
                                              ? "运行中"
                                              : "已停止"}
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs text-default-600 mt-2 pt-2 border-t border-divider">
                                          <div>
                                            VPN IP:{" "}
                                            <span className="font-mono font-medium">
                                              {item.sdwanVpnIP || "-"}
                                            </span>
                                          </div>
                                          <div>
                                            网络:{" "}
                                            <span className="font-mono font-medium">
                                              {item.sdwanNetwork || "-"}
                                            </span>
                                          </div>
                                          <div>
                                            证书掩码:{" "}
                                            <span className="font-medium">
                                              {item.sdwanCertMask != null
                                                ? `/${item.sdwanCertMask}`
                                                : "-"}
                                            </span>
                                          </div>
                                          <div>
                                            缓存实例:{" "}
                                            <span className="font-medium">
                                              {item.sdwanCacheCount ?? 0}
                                            </span>
                                          </div>
                                        </div>
                                        {item.message && (
                                          <div
                                            className={`text-xs mt-2 ${item.success ? "text-default-500" : "text-danger"}`}
                                          >
                                            {item.message}
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </div>
                    {/* 失败详情（仅桌面端显示，移动端已在卡片中显示） */}
                    {diagnosisResult.results.some(
                      (r) => r.success === false && !r.diagnosing,
                    ) && (
                      <div className="space-y-2 hidden md:block">
                        <h4 className="text-sm font-semibold text-danger">
                          失败详情
                        </h4>
                        <div className="space-y-2">
                          {diagnosisResult.results
                            .filter((r) => r.success === false && !r.diagnosing)
                            .map((result, index) => (
                              <Alert
                                key={index}
                                className="text-xs"
                                color="danger"
                                description={result.message || "连接失败"}
                                title={result.description}
                                variant="flat"
                              />
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg
                        aria-hidden="true"
                        className="w-8 h-8 text-default-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                        />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">
                      暂无诊断数据
                    </h3>
                  </div>
                )}
              </ModalBody>
              <ModalFooter className="bg-content1">
                <Button variant="flat" onPress={onClose}>
                  关闭
                </Button>
                {currentDiagnosisForward && (
                  <Button
                    color="primary"
                    isLoading={diagnosisLoading}
                    onPress={() => handleDiagnose(currentDiagnosisForward)}
                  >
                    重新诊断
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 批量归零流量确认弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={batchResetTrafficModalOpen}
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
                  个规则的流量统计吗？
                </p>
                <p className="text-small text-default-500 mt-2">
                  归零后，当前周期流量将归档到历史，新周期从 0 开始统计。
                </p>
                <ul className="text-small text-default-500 mt-2 space-y-1">
                  {Array.from(selectedIds)
                    .slice(0, 5)
                    .map((id) => {
                      const forward = forwards.find((f) => f.id === id);

                      return forward ? (
                        <li key={id} className="truncate">
                          • {forward.name}
                        </li>
                      ) : null;
                    })}
                  {selectedIds.size > 5 && (
                    <li>... 还有 {selectedIds.size - 5} 个规则</li>
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
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 流量归零日志弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={trafficResetLogModalOpen}
        size="md"
        onOpenChange={setTrafficResetLogModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">
                  流量归零日志 - {currentLogForward?.name}
                </h2>
              </ModalHeader>
              <ModalBody>
                {trafficResetLogsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="md" />
                  </div>
                ) : trafficResetLogs.length === 0 ? (
                  <div className="text-center text-default-500 py-8">
                    暂无归零记录
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {trafficResetLogs.map((log) => (
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
                              {formatDateTime(log.createdTime)}
                            </span>
                            {isAdmin && (
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
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 w-full">
                          <div className="w-full">
                            <span className="text-default-500 text-sm block mb-1">
                              归零前流量
                            </span>
                            <div className="flex items-center justify-end gap-2 flex-wrap">
                              <span className="text-primary-600 text-sm whitespace-nowrap dark:text-primary-400">
                                ↑{formatFlow(log.inFlowBefore || 0)}
                              </span>
                              <span className="text-success-600 text-sm whitespace-nowrap dark:text-success-400">
                                ↓{formatFlow(log.outFlowBefore || 0)}
                              </span>
                              <span className="text-default-600 text-sm whitespace-nowrap font-medium">
                                总量{" "}
                                {formatFlow(
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
          <ModalHeader className="text-base font-semibold">确认</ModalHeader>
          <ModalBody className="py-4">
            <p className="text-sm text-default-600">
              确定要删除这条归零记录吗？此操作不可恢复。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDeleteLogModalOpen(false)}>
              取消
            </Button>
            {isAdmin && (
              <Button color="danger" onPress={handleDeleteLog}>
                删除
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 批量删除确认弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={batchDeleteModalOpen}
        onOpenChange={setBatchDeleteModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>确认删除</ModalHeader>
              <ModalBody>
                <p>
                  确定要删除选中的 {selectedIds.size} 项规则吗？此操作不可撤销。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="danger"
                  isLoading={batchDeleteLoading}
                  onPress={handleBatchDelete}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 批量换隧道弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={batchChangeTunnelModalOpen}
        onOpenChange={setBatchChangeTunnelModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>隧道</ModalHeader>
              <ModalBody>
                <p className="mb-4">
                  将选中的 {selectedIds.size} 项规则迁移到新隧道：
                </p>
                <Select
                  label="目标隧道"
                  placeholder="请选择目标隧道"
                  selectedKeys={
                    batchTargetTunnelId ? [String(batchTargetTunnelId)] : []
                  }
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];

                    setBatchTargetTunnelId(selected ? Number(selected) : null);
                  }}
                >
                  {tunnels.map((tunnel) => (
                    <SelectItem
                      key={tunnel.id.toString()}
                      textValue={
                        tunnel.remark
                          ? `${formatRemoteDisplayText(tunnel.name)} (${tunnel.remark})`
                          : formatRemoteDisplayText(tunnel.name)
                      }
                    >
                      <span>
                        {formatRemoteDisplayText(tunnel.name)}
                        {tunnel.remark && (
                          <span className="text-xs text-default-400 ml-1">
                            ({tunnel.remark})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </Select>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isDisabled={!batchTargetTunnelId}
                  isLoading={batchChangeTunnelLoading}
                  onPress={handleBatchChangeTunnel}
                >
                  确认换隧道
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 批量切换模式弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={batchChangeModeModalOpen}
        onOpenChange={setBatchChangeModeModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>切换转发模式</ModalHeader>
              <ModalBody>
                <p className="mb-4">
                  将选中的 {selectedIds.size} 项规则切换为目标模式：
                </p>
                <Select
                  label="目标模式"
                  placeholder="请选择目标模式"
                  selectedKeys={[batchTargetMode]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string;

                    setBatchTargetMode(selected || "gost");
                  }}
                >
                  <SelectItem key="gost">Gost 模式</SelectItem>
                  {!isFreeTier && flcEnabled && (
                    <SelectItem key="floxcore">FloxCore 模式</SelectItem>
                  )}
                  {!isFreeTier && nftEnabled && (
                    <SelectItem key="nftables">NFtables 模式</SelectItem>
                  )}
                  {!isFreeTier && wgmEnabled && (
                    <SelectItem key="mimic">WGMimic 模式</SelectItem>
                  )}
                  {!isFreeTier && sdwEnabled && (
                    <SelectItem key="sdwan">SDWAN 模式</SelectItem>
                  )}
                </Select>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isLoading={batchChangeModeLoading}
                  onPress={handleBatchChangeMode}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 搜索筛选弹窗 */}
      <Modal
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={isSearchModalOpen}
        placement="center"
        size="md"
        onOpenChange={setIsSearchModalOpen}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                搜索筛选规则
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4 py-2">
                  <Input
                    label="规则名称 (模糊)"
                    placeholder="请输入规则名称关键字"
                    value={searchParams.name}
                    variant="bordered"
                    onChange={(e) =>
                      setSearchParams((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="入口监听端口 (精确)"
                    placeholder="请输入具体端口号"
                    type="number"
                    value={searchParams.inPort}
                    variant="bordered"
                    onChange={(e) =>
                      setSearchParams((prev) => ({
                        ...prev,
                        inPort: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="落地地址或端口 (模糊)"
                    placeholder="请输入目标 IP、域名或端口"
                    value={searchParams.remoteAddr}
                    variant="bordered"
                    onChange={(e) =>
                      setSearchParams((prev) => ({
                        ...prev,
                        remoteAddr: e.target.value,
                      }))
                    }
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  color="primary"
                  variant="flat"
                  onPress={() => {
                    setSearchParams({
                      name: "",
                      userId: tokenUserId ? tokenUserId.toString() : "all",
                      tunnelId: "all",
                      speedLimitId: undefined,
                      inPort: "",
                      remoteAddr: "",
                    });
                  }}
                >
                  归零
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      <BatchActionResultModal
        failures={batchResultModal.failures}
        isOpen={batchResultModal.open}
        skipped={batchResultModal.skipped}
        summary={batchResultModal.summary}
        title={batchResultModal.title}
        onOpenChange={(open) => {
          if (open) {
            setBatchResultModal((prev) => ({ ...prev, open: true }));

            return;
          }
          setBatchResultModal(EMPTY_BATCH_RESULT_MODAL_STATE);
        }}
      />
    </AnimatedPage>
  );
}
// ─── Connection Count Cell (list display) ──────────────────────────────────
function ConnectionCountCell({
  current,
  max,
}: {
  current: number;
  max: number;
}) {
  // 都是 0 时显示 0/暂无
  if (current === 0 && max === 0) {
    return <span className="text-sm text-default-400">0/暂无</span>;
  }
  const maxText = max > 0 ? max.toString() : "不限";

  // 有连接或有限制时显示 current/max
  return (
    <span className="text-sm text-default-600">
      {current}/{maxText}
    </span>
  );
}
// ─── Connection Limit Field (form input) ───────────────────────────────────
function ConnectionLimitField({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();

    if (raw === "") {
      onChange(0);

      return;
    }
    const num = parseInt(raw, 10);

    if (isNaN(num) || num < 0) {
      onChange(0);
    } else if (num > 9999) {
      onChange(9999);
    } else {
      onChange(num);
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-foreground">连接数限制</span>
      <Input
        description="留空不限制"
        placeholder=""
        type="number"
        value={value > 0 ? value.toString() : ""}
        variant="bordered"
        onChange={handleChange}
      />
    </div>
  );
}
// ─── Speed Limit Config Field ──────────────────────────────────────────────
function SpeedLimitConfigField({
  speedLimit,
  maxSpeed = 0,
  readOnly = false,
  onSpeedLimitChange,
}: {
  speedLimit: number;
  maxSpeed?: number;
  readOnly?: boolean;
  onSpeedLimitChange: (val: number) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-foreground">
        速度限制(Mbps)
      </span>
      <Input
        description="留空不限速"
        max={maxSpeed > 0 ? maxSpeed : undefined}
        min="1"
        placeholder=""
        readOnly={readOnly}
        step="1"
        type="number"
        value={speedLimit > 0 ? speedLimit.toString() : ""}
        variant="bordered"
        onChange={(e) => {
          const raw = e.target.value.trim();

          if (raw === "") {
            onSpeedLimitChange(0);

            return;
          }
          const speed = Number(raw);

          if (Number.isInteger(speed) && speed > 0) {
            onSpeedLimitChange(
              maxSpeed > 0 ? Math.min(speed, maxSpeed) : speed,
            );
          }
        }}
      />
    </div>
  );
}
// ─── Traffic Limit Field (form input) ──────────────────────────────────────
function TrafficLimitField({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();

    if (raw === "") {
      onChange(0);

      return;
    }
    const num = parseFloat(raw);

    if (isNaN(num) || num < 0) {
      onChange(0);
    } else if (num > 1000000) {
      onChange(1000000);
    } else {
      onChange(num);
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-foreground">流量限制(GB)</span>
      <Input
        description="留空不限制"
        placeholder=""
        type="number"
        value={value > 0 ? value.toString() : ""}
        variant="bordered"
        onChange={handleChange}
      />
    </div>
  );
}
// ─── Expiry Time Field (form input) ────────────────────────────────────────
function ExpiryTimeField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (val: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <DatePicker
        showMonthAndYearPickers
        description="留空表示永久有效"
        label="有效期"
        value={timestampToCalendarDate(value)}
        onChange={(date) => {
          onChange(calendarDateToTimestamp(date));
        }}
      >
        <DatePresets
          onChange={(timestamp) => {
            onChange(timestamp === 0 ? null : timestamp);
          }}
        />
      </DatePicker>
    </div>
  );
}
