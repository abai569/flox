import type { NodeGroupApiItem, OfflineDeployPayload } from "@/api/types";

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

import {
  DistroIcon,
  parseDistroFromVersion,
  getDistroColor,
} from "@/components/distro-icon";
import { SearchBar } from "@/components/search-bar";
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
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { DatePicker } from "@/shadcn-bridge/heroui/date-picker";
import { DatePresets } from "@/shadcn-bridge/heroui/date-presets";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownMenuSeparator,
} from "@/shadcn-bridge/heroui/dropdown";
import { NodeListView } from "@/pages/node/node-list-view";
import {
  createNode,
  getNodeList,
  bootstrapNodeSDWAN,
  issueNodeSDWANCert,
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
  getNodeReleases,
  refreshNodeExpiryReminder,
  getNodeGroupList,
  assignNodeToGroup,
  batchResetNodeTraffic,
  recordNodeOfflineLog,
  getNodeTrafficResetLogs,
  deleteNodeTrafficResetLog,
  getConfigByName,
  type ReleaseChannel,
} from "@/api";
import { compareVersions } from "@/utils/version-update";
import { PageLoadingState } from "@/components/page-state";
import { timestampToCalendarDate, calendarDateToTimestamp } from "@/utils/date";
import { getConnectionStatusMeta } from "@/pages/node/display";
import {
  getNodeRenewalSnapshot,
  formatNodeRenewalTime,
  type NodeRenewalCycle,
} from "@/pages/node/renewal";
import {
  buildNodeSystemInfo,
  type NodeSystemInfo,
} from "@/pages/node/system-info";
import { useNodeOfflineTimers } from "@/pages/node/use-node-offline-timers";
import { useNodeRealtime } from "@/pages/node/use-node-realtime";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { loadStoredOrder, saveOrder } from "@/utils/order-storage";
// TypeScript 全局类型扩展
declare global {
  interface Window {
    __pendingNodeRefresh?: Set<number>;
  }
}
const NODE_FALLBACK_REFRESH_INTERVAL_MS = 15000;

interface Node {
  id: number;
  inx?: number;
  name: string;
  remark?: string;
  expiryTime?: number;
  renewalCycle?: NodeRenewalCycle;
  flowResetTime?: number;
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
  remoteConfig?: string;
  version?: string;
  http?: number;
  tls?: number;
  socks?: number;
  status: number;
  connectionStatus: "online" | "offline";
  systemInfo?: NodeSystemInfo | null;
  copyLoading?: boolean;
  upgradeLoading?: boolean;
  rollbackLoading?: boolean;
  groupId?: number | null;
  secret?: string;
  periodTraffic?: {
    rx: number;
    tx: number;
    since: number;
    nextReset?: number;
    cycle?: string;
  };
}
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
  trafficLimit: number;
}
type NodeViewMode = "grid" | "list" | "grouped";
const EXPIRING_SOON_DAYS = 7;

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
  } as Node;
};
const SortableItem = ({
  id,
  children,
}: {
  id: number;
  children: (listeners: any, attributes?: any) => any;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
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

export default function NodePage() {
  const [nodeList, setNodeList] = useState<Node[]>([]);
  const [nodeOrder, setNodeOrder] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [realtimeNodeMetrics, setRealtimeNodeMetrics] = useState<
    Record<
      number,
      {
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
        periodTraffic?: {
          rx: number;
          tx: number;
          since: number;
          nextReset?: number;
          cycle?: string;
        };
      }
    >
  >({});
  const realtimeNodeMetricsRef = useRef(realtimeNodeMetrics);
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
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<Node | null>(null);
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
      port: "10000-65535",
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
      trafficLimit: 0,
      flowResetTime: 1,
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
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [upgradeTarget, setUpgradeTarget] = useState<"single" | "batch">(
    "single",
  );
  const [upgradeTargetNodeId, setUpgradeTargetNodeId] = useState<number | null>(
    null,
  );
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
  const [batchResetTrafficLoading, setBatchResetTrafficLoading] =
    useState(false);
  const [batchResetTrafficModalOpen, setBatchResetTrafficModalOpen] =
    useState(false);
  const [nodeTrafficLogModalOpen, setNodeTrafficLogModalOpen] = useState(false);
  const [nodeTrafficLogsLoading, setNodeTrafficLogsLoading] = useState(false);
  const [nodeTrafficLogs, setNodeTrafficLogs] = useState<any[]>([]);
  const [currentLogNode, setCurrentLogNode] = useState<Node | null>(null);
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
    if (!logToDelete) return;
    try {
      const res = await deleteNodeTrafficResetLog(logToDelete);

      if (res.code === 0) {
        toast.success("删除成功");
        setNodeTrafficLogs((prev) =>
          prev.filter((log) => log.id !== logToDelete),
        );
        setDeleteLogModalOpen(false);
        setLogToDelete(null);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  }, [logToDelete]);

  useEffect(() => {
    realtimeNodeMetricsRef.current = realtimeNodeMetrics;
  }, [realtimeNodeMetrics]);

  const handleNodeOffline = useCallback((nodeId: number) => {
    setNodeList((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        if (node.connectionStatus === "offline" && node.systemInfo === null) {
          return node;
        }

        const offlineMetrics = realtimeNodeMetricsRef.current[nodeId];
        const inFlow = offlineMetrics?.periodTraffic?.tx || 0;
        const outFlow = offlineMetrics?.periodTraffic?.rx || 0;

        if (inFlow > 0 || outFlow > 0) {
          recordNodeOfflineLog(nodeId, inFlow, outFlow, "节点离线").catch(
            () => {},
          );
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
  const loadNodes = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!silent) {
      setLoading(true);
    }
    try {
      const res: any = await getNodeList();

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
          syncError: node.syncError || undefined,
          systemInfo: null,
          copyLoading: false,
        }));

        // 用 REST API 返回的 periodTraffic 初始化离线节点的流量数据
        setRealtimeNodeMetrics((prev) => {
          const next = { ...prev };
          let changed = false;

          for (const node of nodesData) {
            if (node.periodTraffic && !next[node.id]) {
              next[node.id] = {
                ...next[node.id],
                uploadTraffic: node.periodTraffic.tx ?? 0,
                downloadTraffic: node.periodTraffic.rx ?? 0,
                periodTraffic: node.periodTraffic,
              };
              changed = true;
            }
          }

          return changed ? next : prev;
        });

        setNodeList((prev) => {
          const previousById = new Map(prev.map((node) => [node.id, node]));

          return nodesData.map((node) =>
            mergeNodeRealtimeState(node, previousById.get(node.id)),
          );
        });
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
      if (!silent) {
        toast.error("网络错误，请重试");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);
  const handleWebSocketMessage = (data: any) => {
    const { id, type, data: messageData } = data;
    const nodeId = Number(id);

    if (Number.isNaN(nodeId)) return;
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
              setTimeout(() => {
                loadNodes({ silent: true });
              }, delay);
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
    } else if (type === "metric") {
      clearOfflineTimer(nodeId);
      const metric =
        typeof messageData === "string" ? JSON.parse(messageData) : messageData;

      setRealtimeNodeMetrics((prev) => {
        return {
          ...prev,
          [nodeId]: {
            ...prev[nodeId],
            uploadTraffic: Number(
              metric.netOutBytes ??
                metric.bytes_transmitted ??
                prev[nodeId]?.uploadTraffic ??
                0,
            ),
            downloadTraffic: Number(
              metric.netInBytes ??
                metric.bytes_received ??
                prev[nodeId]?.downloadTraffic ??
                0,
            ),
            // 周期流量（新字段）
            periodTraffic:
              metric.period_bytes_received !== undefined ||
              metric.period_bytes_transmitted !== undefined
                ? {
                    rx: Number(metric.period_bytes_received ?? 0),
                    tx: Number(metric.period_bytes_transmitted ?? 0),
                    since: metric.baseline_recorded_at || 0,
                    nextReset: metric.next_reset_at || 0,
                    cycle: metric.renewal_cycle || "",
                  }
                : prev[nodeId]?.periodTraffic,
          },
        };
      });
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
  usePullToRefresh(loadNodes);
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
  const formatTraffic = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "K", "M", "G", "T"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };
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
      return { valid: false, error: "请输入端口" };
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
    if (
      (form.renewalCycle && !form.expiryTime) ||
      (!form.renewalCycle && form.expiryTime)
    ) {
      newErrors.expiryTime = "请同时设置续费周期和续费基准时间";
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
    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };
  const handleAdd = () => {
    setDialogTitle("新增节点");
    setIsEdit(false);
    setDialogVisible(true);
    setErrors({});
  };
  const handleEdit = (node: Node) => {
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
      port: node.port || "10000-65535",
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
      trafficLimit: (node as any).trafficLimit || 0,
      flowResetTime: node.flowResetTime || 1,
    });
    setDialogVisible(true);
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
  const handleDismissExpiryReminder = async (nodeId: number) => {
    try {
      const res = await refreshNodeExpiryReminder(nodeId);

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
  // 查看节点流量归零日志
  const handleViewNodeTrafficLogs = async (node: Node) => {
    setNodeTrafficLogsLoading(true);
    setCurrentLogNode(node);
    try {
      const res = await getNodeTrafficResetLogs(node.id, 30);

      if (res.code === 0) {
        setNodeTrafficLogs((res.data as any)?.logs || []);
        setNodeTrafficLogModalOpen(true);
      } else {
        toast.error(res.msg || "获取日志失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setNodeTrafficLogsLoading(false);
    }
  };
  // 归零节点流量
  const handleResetNodeTraffic = (node: Node) => {
    setNodeToReset(node);
    onResetTrafficModalOpen();
  };
  // 确认归零流量
  const handleConfirmResetTraffic = async () => {
    if (!nodeToReset) return;
    setResetTrafficLoading(true);
    try {
      // 从实时数据中获取最新流量
      const metrics = realtimeNodeMetrics[nodeToReset.id];
      const inFlowBefore = metrics?.periodTraffic?.tx || 0;
      const outFlowBefore = metrics?.periodTraffic?.rx || 0;
      const res = await batchResetNodeTraffic(
        [nodeToReset.id],
        "管理员手动归零",
        inFlowBefore,
        outFlowBefore,
      );

      if (res.code === 0) {
        toast.success("流量归零成功");
        onResetTrafficModalClose();
        // 静默刷新节点列表，保持当前滚动位置
        await loadNodes({ silent: true });
      } else {
        toast.error(res.msg || "归零失败");
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
          toast.success(`节点升级命令已发送，节点将自动重启`);
        } else {
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
      const selectedLocalIds = Array.from(selectedIds);

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
          toast.success(
            `批量升级命令已发送到 ${selectedLocalIds.length} 个节点`,
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
  const handleBatchResetTraffic = async () => {
    const selectedLocalIds = Array.from(selectedIds);

    if (selectedLocalIds.length === 0) {
      toast.error("请选择节点进行归零");
      setBatchResetTrafficModalOpen(false);

      return;
    }
    setBatchResetTrafficLoading(true);
    try {
      // 计算选中节点的总流量
      let totalInFlow = 0;
      let totalOutFlow = 0;

      selectedLocalIds.forEach((nodeId) => {
        const metrics = realtimeNodeMetrics[nodeId];

        if (metrics) {
          totalInFlow += metrics.periodTraffic?.tx || 0;
          totalOutFlow += metrics.periodTraffic?.rx || 0;
        }
      });

      const res = await batchResetNodeTraffic(
        selectedLocalIds,
        "管理员手动归零",
        totalInFlow,
        totalOutFlow,
      );

      if (res.code === 0) {
        const successCount =
          (res.data as any)?.filter((r: { success: boolean }) => r.success)
            .length || 0;

        toast.success(
          `已成功归零 ${successCount}/${selectedLocalIds.length} 个节点的流量统计`,
        );
        setBatchResetTrafficModalOpen(false);
        setSelectMode(false);
        setSelectedIds(new Set());
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
    if (selectedIds.size === 0) return;
    setBatchSDWANLoading(true);
    try {
      const ids = Array.from(selectedIds);
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
        ...rest
      } = form;
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
        expiryTime: form.expiryTime,
        renewalCycle: form.renewalCycle,
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
                    expiryTime: form.expiryTime,
                    renewalCycle: form.renewalCycle,
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
                    trafficLimit: form.trafficLimit,
                    flowResetTime: form.flowResetTime,
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
  const handleIssueSDWANCert = async () => {
    if (!form.id || form.id <= 0) {
      toast.error("请先保存节点后再签发 SDWAN 证书");

      return;
    }
    setSubmitLoading(true);
    try {
      const res = await issueNodeSDWANCert(form.id, form.sdwanNodeVPNIP);

      if (res.code === 0 && res.data) {
        toast.success("SDWAN 证书签发成功");
        setForm((prev) => ({
          ...prev,
          remoteConfig: res.data?.remoteConfig || prev.remoteConfig,
          sdwanNodeVPNIP: res.data?.vpnIp || prev.sdwanNodeVPNIP,
          sdwanCAPEM: res.data?.caPem || prev.sdwanCAPEM,
          sdwanCertPEM: res.data?.certPem || prev.sdwanCertPEM,
          sdwanKeyPEM: res.data?.keyPem || prev.sdwanKeyPEM,
          sdwanLighthouseVPNIP:
            res.data?.lighthouseVPNIP || prev.sdwanLighthouseVPNIP,
          sdwanLighthouseAddr:
            res.data?.lighthouseAddr || prev.sdwanLighthouseAddr,
        }));
        loadNodes();
      } else {
        toast.error(res.msg || "SDWAN 证书签发失败");
      }
    } catch {
      toast.error("SDWAN 证书签发失败");
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
      setSelectedIds(new Set(displayNodes.map((n) => n.id)));
      if (!selectMode) {
        setSelectMode(true);
      }
    } else {
      setSelectedIds(new Set());
      setSelectMode(false);
    }
  };
  const selectAll = () => {
    setSelectedIds(new Set(displayNodes.map((n) => n.id)));
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await batchDeleteNodes(Array.from(selectedIds));

      if (res.code === 0) {
        toast.success(`成功删除 ${selectedIds.size} 个节点`);
        setNodeList((prev) => prev.filter((n) => !selectedIds.has(n.id)));
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
            if (filterGroupId === -1) {
              return !node.groupId || node.groupId === 0;
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
    () => displayNodes.map((n) => n.id),
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
        node.groupId && node.groupId > 0 ? Number(node.groupId) : "none";

      if (groupsMap.has(groupId)) {
        groupsMap.get(groupId)!.nodes.push(node);
      } else {
        groupsMap.get("none")!.nodes.push(node);
      }
    });

    return Array.from(groupsMap.values()).filter((g) => g.nodes.length > 0);
  }, [displayNodes, nodeGroups]);
  const renderNodeCard = (node: Node, listeners: any) => {
    const expiryMeta = getNodeExpiryMeta(node.expiryTime, node.renewalCycle);
    const connectionStatusMeta = getConnectionStatusMeta(node.connectionStatus);
    const hasRemark = Boolean(node.remark?.trim());
    const hasExpiryInfo = Boolean(
      node.expiryTime &&
        node.expiryTime > 0 &&
        node.renewalCycle &&
        (node.expiryReminderDismissed !== 1 ||
          (node.expiryReminderDismissedUntil &&
            node.expiryReminderDismissedUntil * 1000 < Date.now())),
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
                <Checkbox
                  isSelected={selectedIds.has(node.id)}
                  onValueChange={() => toggleSelect(node.id)}
                />
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
              </div>
              {node.groupId && node.groupId > 0 ? (
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
                              handleDismissExpiryReminder?.(node.id);
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
              <span
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                  connectionStatusMeta.color === "success"
                    ? "bg-emerald-500"
                    : "bg-rose-500"
                }`}
                title={connectionStatusMeta.text}
              />
              {/* 这里加上 title 属性 */}
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
                  IPv4/域名
                </span>
                <span
                  className="font-medium text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto"
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

                      return parts[0].length > 12
                        ? parts[0].slice(0, 12) + "..."
                        : parts[0];
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
              <div className="flex justify-between items-center min-w-0">
                <span className="text-default-500 text-xs flex-shrink-0 mr-2">
                  IPv6/域名
                </span>
                <span
                  className={`font-medium text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto ${!(node.serverIpV6?.trim() || (node.serverIp?.trim() && node.serverIp.includes(":") ? node.serverIp.trim() : undefined)) ? "text-default-300" : ""}`}
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

                    if (v6Val) copyToClipboard(v6Val, "IPv6 地址");
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

                      return parts[0].length > 12
                        ? parts[0].slice(0, 12) + "..."
                        : parts[0];
                    }

                    return v6Val.length > 15
                      ? v6Val.slice(0, 15) + "..."
                      : v6Val;
                  })()}
                </span>
              </div>
              <div className="flex justify-between items-center min-w-0">
                <span className="text-default-500 text-xs flex-shrink-0 mr-2">
                  内网IP/域名
                </span>
                <span
                  className={`font-medium text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto ${!node.intranetIp?.trim() ? "text-default-300" : ""}`}
                  title={node.intranetIp?.trim() || "暂无"}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.intranetIp?.trim())
                      copyToClipboard(node.intranetIp.trim(), "内网 IP");
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

                      return parts[0].length > 12
                        ? parts[0].slice(0, 12) + "..."
                        : parts[0];
                    }
                    // 内网 IP 只显示前两段
                    const ipParts = intranetVal.split(".");

                    if (ipParts.length === 4) {
                      return `${ipParts[0]}.${ipParts[1]}.*.*`;
                    }

                    return intranetVal.length > 15
                      ? intranetVal.slice(0, 15) + "..."
                      : intranetVal;
                  })()}
                </span>
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
              <span className="text-default-600">周期流量</span>
              <span className="font-medium text-sm text-danger-600 dark:text-danger-400">
                {realtimeNodeMetrics[node.id]
                  ? formatTraffic(
                      (realtimeNodeMetrics[node.id]?.periodTraffic?.rx ?? 0) +
                        (realtimeNodeMetrics[node.id]?.periodTraffic?.tx ?? 0),
                    )
                  : "-"}
              </span>
            </div>
            {realtimeNodeMetrics[node.id]?.periodTraffic && (
              <div className="text-xs text-default-500 space-y-0.5 mt-1">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span>↑ 上行</span>
                    <span className="font-medium text-success-600 dark:text-success-400">
                      {formatTraffic(
                        realtimeNodeMetrics[node.id]?.periodTraffic?.rx ?? 0,
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>↓ 下行</span>
                    <span className="font-medium text-primary-600 dark:text-primary-400">
                      {formatTraffic(
                        realtimeNodeMetrics[node.id]?.periodTraffic?.tx ?? 0,
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
            <div className="grid gap-2 grid-cols-2">
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
            </div>
            <div className="grid gap-2 grid-cols-3">
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
                color="danger"
                size="sm"
                variant="flat"
                onPress={() => handleDelete(node)}
              >
                删除
              </Button>
            </div>
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
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="mb-6 space-y-3">
        <div className="flex flex-row items-center gap-3 overflow-x-auto pb-1">
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
          <div className="flex h-8 items-center gap-2 whitespace-nowrap shrink-0">
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
                                      handleViewNodeTrafficLogs={
                                        handleViewNodeTrafficLogs
                                      }
                                      nodeExpiryStats={nodeExpiryStats}
                                      nodeFilterMode={nodeFilterMode}
                                      nodeGroups={nodeGroups}
                                      openInstallSelector={openInstallSelector}
                                      openUpgradeModal={openUpgradeModal}
                                      realtimeNodeMetrics={realtimeNodeMetrics}
                                      selectedIds={selectedIds}
                                      setFilterGroupId={setFilterGroupId}
                                      setNodeFilterMode={setNodeFilterMode}
                                      toggleSelect={toggleSelect}
                                      toggleSelectAll={(
                                        isSelected: boolean,
                                      ) => {
                                        if (isSelected) {
                                          setSelectedIds(
                                            (prev) =>
                                              new Set([
                                                ...prev,
                                                ...nodes.map((n) => n.id),
                                              ]),
                                          );
                                          if (!selectMode) setSelectMode(true);
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
                  handleViewNodeTrafficLogs={handleViewNodeTrafficLogs}
                  nodeExpiryStats={nodeExpiryStats}
                  nodeFilterMode={nodeFilterMode}
                  nodeGroups={nodeGroups}
                  openInstallSelector={openInstallSelector}
                  openUpgradeModal={openUpgradeModal}
                  realtimeNodeMetrics={realtimeNodeMetrics}
                  selectedIds={selectedIds}
                  setFilterGroupId={setFilterGroupId}
                  setNodeFilterMode={setNodeFilterMode}
                  toggleSelect={toggleSelect}
                  toggleSelectAll={handleSelectAllToggle}
                  upgradeProgress={upgradeProgress}
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
        isOpen={dialogVisible}
        placement="center"
        scrollBehavior="outside"
        size="xl"
        onClose={() => setDialogVisible(false)}
      >
        <ModalContent>
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
                  placeholder="例如: 搬瓦工年付，2026-12 续费，日本中转"
                  rows={1}
                  value={form.remark}
                  variant="bordered"
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, remark: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  description="将节点分配到指定分组（可选）"
                  label="分组"
                  placeholder="选择分组"
                  selectedKeys={
                    form.groupId && form.groupId > 0
                      ? [String(form.groupId)]
                      : []
                  }
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string | undefined;

                    setForm((prev) => ({
                      ...prev,
                      groupId:
                        selected && selected !== "" ? parseInt(selected) : null,
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
                <FieldContainer
                  description="节点密钥，用于 Agent 加密通信"
                  label="密钥"
                >
                  <div className="flex items-center gap-2">
                    <BaseInput
                      className="flex-1"
                      placeholder="输入密钥或点击随机生成"
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  description="支持月、季、半年、年四种周期"
                  label="续费周期"
                  placeholder="选择续费周期"
                  selectedKeys={form.renewalCycle ? [form.renewalCycle] : []}
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as
                      | NodeRenewalCycle
                      | undefined;

                    setForm((prev) => ({
                      ...prev,
                      renewalCycle: selected || "",
                    }));
                  }}
                >
                  <SelectItem key="month" textValue="月">
                    月付
                  </SelectItem>
                  <SelectItem key="quarter" textValue="季">
                    季付
                  </SelectItem>
                  <SelectItem key="halfYear" textValue="半年">
                    半年付
                  </SelectItem>
                  <SelectItem key="year" textValue="年">
                    年付
                  </SelectItem>
                </Select>
                <DatePicker
                  showMonthAndYearPickers
                  description="系统会自动按周期同日推算下次续费时间"
                  errorMessage={errors.expiryTime}
                  isInvalid={!!errors.expiryTime}
                  label="续费基准时间"
                  permanentLabel="系统会自动按周期同日推算下次续费时间"
                  value={timestampToCalendarDate(
                    form.expiryTime > 0 ? form.expiryTime : null,
                  )}
                  onChange={(date) => {
                    const timestamp = calendarDateToTimestamp(date, false) || 0;

                    setForm((prev) => ({
                      ...prev,
                      expiryTime: timestamp,
                    }));
                  }}
                >
                  <DatePresets
                    onChange={(timestamp) => {
                      setForm((prev) => ({
                        ...prev,
                        expiryTime: timestamp,
                      }));
                    }}
                  />
                </DatePicker>
                <Select
                  description="每月几号自动归零周期流量"
                  label="流量归零日期"
                  placeholder="选择归零日期"
                  selectedKeys={
                    form.flowResetTime > 0
                      ? [String(form.flowResetTime)]
                      : ["0"]
                  }
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string | undefined;

                    setForm((prev) => ({
                      ...prev,
                      flowResetTime: selected ? parseInt(selected) : 1,
                    }));
                  }}
                >
                  <SelectItem key="0" textValue="不归零">
                    不归零
                  </SelectItem>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <SelectItem key={String(day)} textValue={`${day}号`}>
                      每月{day}号
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  description="该节点总流量配额，0表示不限制"
                  label="流量限额(GB)"
                  min={0}
                  placeholder="0 = 不限制"
                  type="number"
                  value={String(form.trafficLimit)}
                  variant="bordered"
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      trafficLimit: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  description="可选：建议填写公网IPv4或对应解析域名，可留空"
                  errorMessage={errors.serverIpV4}
                  isInvalid={!!errors.serverIpV4}
                  label="域名/公网IPv4地址"
                  placeholder="例如：test.example.com 8.8.8.8"
                  value={form.serverIpV4}
                  variant="bordered"
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, serverIpV4: e.target.value }))
                  }
                />
                <Input
                  classNames={{
                    input: "font-medium",
                  }}
                  description="支持单个端口(80)、多个端口(80,443)或端口范围(10000-65535)，多个范围可用逗号分隔"
                  errorMessage={errors.port}
                  isInvalid={!!errors.port}
                  label="可用端口"
                  placeholder="例如：80,443,10000-65535"
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
                    setForm((prev) => ({ ...prev, intranetIp: e.target.value }))
                  }
                />
                <Input
                  description="可选：建议填写公网IPv6或对应解析域名，可留空"
                  errorMessage={errors.serverIpV6}
                  isInvalid={!!errors.serverIpV6}
                  label="域名/公网IPv6地址"
                  placeholder="例如：2001:db8::10"
                  value={form.serverIpV6}
                  variant="bordered"
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, serverIpV6: e.target.value }))
                  }
                />
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
                        description="用于多IP服务器指定使用那个IP请求远程地址，不懂的默认为空就行"
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
                        description="多IP服务器可填写额外IP地址，逗号分隔"
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
                      <Input
                        description="SDWAN/Nebula 本机配置文件路径，留空走 agent 默认路径"
                        label="SDWAN 配置路径"
                        placeholder="例如: /etc/flox_agent/sdwan/config.yml"
                        value={form.sdwanConfigPath}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanConfigPath: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <Textarea
                      description="可直接粘贴该节点使用的 Nebula YAML；填写后优先于配置路径"
                      label="SDWAN 配置 YAML"
                      maxRows={8}
                      minRows={4}
                      placeholder="例如: pki:\n  ca: /etc/flox_agent/sdwan/ca.crt\n..."
                      value={form.sdwanConfigYAML}
                      variant="bordered"
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          sdwanConfigYAML: e.target.value,
                        }))
                      }
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        description="Nebula CA 证书路径"
                        label="SDWAN CA 路径"
                        placeholder="例如: /etc/flox_agent/sdwan/ca.crt"
                        value={form.sdwanCAPath}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanCAPath: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="Nebula 主机证书路径"
                        label="SDWAN Cert 路径"
                        placeholder="例如: /etc/flox_agent/sdwan/host.crt"
                        value={form.sdwanCertPath}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanCertPath: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="Nebula 主机私钥路径"
                        label="SDWAN Key 路径"
                        placeholder="例如: /etc/flox_agent/sdwan/host.key"
                        value={form.sdwanKeyPath}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanKeyPath: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="中心节点的 Nebula VPN IP"
                        label="SDWAN 中心节点 VPN IP"
                        placeholder="例如: 192.168.100.1"
                        value={form.sdwanLighthouseVPNIP}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanLighthouseVPNIP: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="当前节点在 SDWAN 中的 Nebula VPN IP；留空时签发证书会自动分配"
                        label="SDWAN 节点 VPN IP"
                        placeholder="例如: 192.168.100.10"
                        value={form.sdwanNodeVPNIP}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanNodeVPNIP: e.target.value,
                          }))
                        }
                      />
                    </div>
                    {isEdit && (
                      <div className="flex justify-end">
                        <Button
                          color="primary"
                          variant="flat"
                          onPress={handleIssueSDWANCert}
                        >
                          一键签发 SDWAN 证书
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Textarea
                        description="可直接粘贴 Nebula CA PEM，填写后优先于 CA 路径"
                        label="SDWAN CA PEM"
                        maxRows={6}
                        minRows={3}
                        value={form.sdwanCAPEM}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanCAPEM: e.target.value,
                          }))
                        }
                      />
                      <Textarea
                        description="可直接粘贴 Nebula 主机证书 PEM，填写后优先于 Cert 路径"
                        label="SDWAN Cert PEM"
                        maxRows={6}
                        minRows={3}
                        value={form.sdwanCertPEM}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanCertPEM: e.target.value,
                          }))
                        }
                      />
                      <Textarea
                        description="可直接粘贴 Nebula 主机私钥 PEM，填写后优先于 Key 路径"
                        label="SDWAN Key PEM"
                        maxRows={6}
                        minRows={3}
                        value={form.sdwanKeyPEM}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanKeyPEM: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="中心节点的公网地址:端口"
                        label="SDWAN 中心节点公网地址"
                        placeholder="例如: 1.2.3.4:4242"
                        value={form.sdwanLighthouseAddr}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanLighthouseAddr: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="Nebula UDP 监听地址，默认 0.0.0.0"
                        label="SDWAN 监听地址"
                        placeholder="例如: 0.0.0.0"
                        value={form.sdwanListenHost}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanListenHost: e.target.value,
                          }))
                        }
                      />
                      <Input
                        description="Nebula UDP 监听端口，默认 4242"
                        label="SDWAN 监听端口"
                        placeholder="例如: 4242"
                        value={form.sdwanListenPort}
                        variant="bordered"
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sdwanListenPort: e.target.value,
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
              <Alert
                className="mt-4"
                color="primary"
                description="节点ip地址是你要添加的入口/出口的ip地址，不是面板的ip地址。"
                variant="flat"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDialogVisible(false)}>
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
        scrollBehavior="outside"
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
                  此操作不可恢复，请谨慎操作。
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
        scrollBehavior="outside"
        size="2xl"
        onClose={() => setInstallCommandModal(false)}
      >
        <ModalContent>
          <ModalHeader>安装命令 - {currentNodeName}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <p className="text-sm text-default-600">
                请复制以下安装命令到服务器上执行：
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
                请复制以下安装命令到服务器上执行：
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
        scrollBehavior="outside"
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
                            (Array.from(keys)[0] as ReleaseChannel) || "stable";

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
                        selectedKeys={selectedVersion ? [selectedVersion] : []}
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
                                  ? new Date(r.publishedAt).toLocaleDateString()
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
        scrollBehavior="outside"
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
        scrollBehavior="outside"
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
        scrollBehavior="outside"
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
            <Button variant="flat" onPress={() => setDeleteLogModalOpen(false)}>
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
        scrollBehavior="outside"
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
                        7 天内续费 ({nodeExpiryStats.expiringSoon})
                      </SelectItem>
                      <SelectItem key="expired">
                        已逾期 ({nodeExpiryStats.expired})
                      </SelectItem>
                      <SelectItem key="withExpiry">
                        已启用续费提醒 ({nodeExpiryStats.withExpiry})
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
          <ModalHeader className="flex flex-col gap-1">ℹ️ 离线部署</ModalHeader>
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
    </AnimatedPage>
  );
}
