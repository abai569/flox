import type {
  BatchOperationFailure,
  TunnelBatchDeletePreviewApiData,
  TunnelDeletePreviewApiData,
} from "@/api/types";
import type { TunnelGroupNewApiItem } from "@/api/types";

import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  DndContext,
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

import { TunnelGroupManager } from "./tunnel/tunnel-group-manager";

import { SearchBar } from "@/components/search-bar";
import { AnimatedPage } from "@/components/animated-page";
import { BatchActionResultModal } from "@/components/batch-action-result-modal";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input, Textarea } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Divider } from "@/shadcn-bridge/heroui/divider";
import { Alert } from "@/shadcn-bridge/heroui/alert";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import { Radio, RadioGroup } from "@/shadcn-bridge/heroui/radio";
import {
  getTunnelGroupNewList,
  createTunnel,
  batchDeleteTunnelsWithForwards,
  getTunnelList,
  updateTunnel,
  deleteTunnelWithForwards,
  getNodeList,
  diagnoseTunnel,
  updateTunnelOrder,
  batchRedeployTunnels,
  previewBatchTunnelDelete,
  previewTunnelDelete,
} from "@/api";
import { PageLoadingState } from "@/components/page-state";
import {
  buildDiagnosisFallbackResult,
  getDiagnosisQualityDisplay,
  type DiagnosisResult,
} from "@/pages/tunnel/diagnosis";
import { diagnoseTunnelStream } from "@/api/diagnosis-stream";
import {
  createTunnelFormDefaults,
  getTunnelFlowDisplay,
  getTunnelTypeDisplay,
  validateTunnelForm,
} from "@/pages/tunnel/form";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { loadStoredOrder, saveOrder } from "@/utils/order-storage";
import {
  buildBatchFailureMessage,
  extractBatchFailures,
  extractApiErrorMessage,
} from "@/api/error-message";
interface ChainTunnel {
  nodeId: number;
  protocol?: string;
  strategy?: string;
  chainType?: number;
  inx?: number;
  port?: number;
  connectIpType?: string;
}
interface BestExitStateItem {
  ownerNodeId: number;
  ownerNodeName: string;
  ownerRole: "entry" | "chain";
  exitNodeId?: number;
  exitNodeName: string;
  updatedAt?: number;
  reason?: string;
}
interface BestExitState {
  enabled: boolean;
  summary: string;
  status: "applied" | "waiting";
  updatedAt?: number;
  reason?: string;
  items: BestExitStateItem[];
}
interface Tunnel {
  id: number;
  inx?: number;
  name: string;
  type: number;
  inNodeId: ChainTunnel[];
  outNodeId?: ChainTunnel[];
  chainNodes?: ChainTunnel[][];
  inIp: string;
  outIp?: string;
  protocol?: string;
  flow: number;
  trafficRatio: number;
  ipPreference?: string;
  status: number;
  createdTime: string;
  tunnelGroupId?: number | null;
  remark?: string;
  bestExitState?: BestExitState | null;
}
interface Node {
  id: number;
  name: string;
  status: number; // 1: 在线, 0: 离线
  intranetIp?: string; // 内网 IP
  serverIp?: string;
  serverIpV4?: string;
  serverIpV6?: string;
  extraIPs?: string;
  remark?: string;
}
interface TunnelForm {
  id?: number;
  name: string;
  type: number;
  inNodeId: ChainTunnel[];
  outNodeId?: ChainTunnel[];
  chainNodes?: ChainTunnel[][];
  flow: number;
  trafficRatio: number;
  inIp: string;
  ipPreference: string;
  status: number;
  tunnelGroupId: number | null;
  remark: string;
}
interface BatchProgressState {
  active: boolean;
  label: string;
  percent: number;
}
interface BatchResultModalState {
  failures: BatchOperationFailure[];
  open: boolean;
  summary: string;
  title: string;
}
type TunnelDeleteAction = "replace" | "delete_forwards";
const EMPTY_BATCH_RESULT_MODAL_STATE: BatchResultModalState = {
  failures: [],
  open: false,
  summary: "",
  title: "",
};
const SortableListRowItem = ({
  id,
  children,
}: {
  id: number;
  children: (props: any) => any;
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
          x: 0,
          y: Math.round(transform.y),
        })
      : undefined,
    transition: isDragging ? undefined : transition || undefined,
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 50 : 1,
    position: isDragging ? "relative" : undefined,
    backgroundColor: isDragging ? "var(--heroui-content2)" : undefined,
    boxShadow: isDragging ? "0 10px 15px -3px rgba(0, 0, 0, 0.1)" : undefined,
  };

  return children({ setNodeRef, style, attributes, listeners });
};
const SortableItem = ({
  id,
  children,
}: {
  id: number;
  children: (listeners: any) => any;
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
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
  );
};
const DEFAULT_TUNNEL_DELETE_ACTION: TunnelDeleteAction = "replace";
const TUNNEL_ORDER_KEY = "tunnel-order";
const TUNNEL_VIEW_MODE_KEY = "tunnel_view_mode";
const mapChainNodes = (nodes: any[]) =>
  (nodes || []).map((n) => ({
    ...n,
    connectIpType:
      n.connectIpType ||
      n.connect_ip_type ||
      n.allocatedIpType ||
      n.allocated_ip_type ||
      n.allocatedConnectIpType ||
      n.allocated_connect_ip_type ||
      n.ipType ||
      n.ip_type ||
      n.connectIp ||
      n.connect_ip ||
      "",
    port: n.port || n.allocatedPort || n.allocated_port || 0,
  }));

const mapTunnelApiItems = (items: any[]): Tunnel[] => {
  return (items || []).map((tunnel) => ({
    ...tunnel,
    inx: tunnel.inx ?? 0,
    inNodeId: Array.isArray(tunnel.inNodeId)
      ? mapChainNodes(tunnel.inNodeId)
      : Array.isArray(tunnel.in_node_id)
        ? mapChainNodes(tunnel.in_node_id)
        : [],
    outNodeId: Array.isArray(tunnel.outNodeId)
      ? mapChainNodes(tunnel.outNodeId)
      : Array.isArray(tunnel.out_node_id)
        ? mapChainNodes(tunnel.out_node_id)
        : [],
    chainNodes: Array.isArray(tunnel.chainNodes)
      ? tunnel.chainNodes.map(mapChainNodes)
      : Array.isArray(tunnel.chain_nodes)
        ? tunnel.chain_nodes.map(mapChainNodes)
        : [],
    inIp: tunnel.inIp || tunnel.in_ip || "",
    flow: tunnel.flow ?? 1,
    trafficRatio: tunnel.trafficRatio ?? 1,
    status: typeof tunnel.status === "number" ? tunnel.status : 0,
    createdTime: tunnel.createdTime || "",
    tunnelGroupId: tunnel.tunnelGroupId ?? null,
    remark: tunnel.remark || "",
    bestExitState:
      tunnel.bestExitState && typeof tunnel.bestExitState === "object"
        ? {
            ...tunnel.bestExitState,
            items: Array.isArray(tunnel.bestExitState.items)
              ? tunnel.bestExitState.items
              : [],
          }
        : null,
  }));
};

const bestExitOwnerRoleText = (role: BestExitStateItem["ownerRole"]) => {
  return role === "chain" ? "中转" : "入口";
};

const bestExitDetailTitle = (state?: BestExitState | null) => {
  if (!state?.enabled || !state.items?.length) {
    return "";
  }

  return state.items
    .map((item) => {
      const ownerName =
        item.ownerNodeName ||
        `${bestExitOwnerRoleText(item.ownerRole)} ${item.ownerNodeId}`;
      const exitName = item.exitNodeName || "等待探测";

      return `${ownerName} -> ${exitName}`;
    })
    .join("\n");
};

const renderBestExitState = (state?: BestExitState | null) => {
  if (!state?.enabled) {
    return null;
  }
  const title = bestExitDetailTitle(state);
  const isWaiting = state.status === "waiting";

  return (
    <div
      className={`mt-1 text-[11px] leading-4 ${
        isWaiting
          ? "text-default-500"
          : "text-emerald-700 dark:text-emerald-300"
      }`}
      title={title || undefined}
    >
      最优出口：{state.summary || "等待探测"}
    </div>
  );
};

export default function TunnelPage() {
  const [loading, setLoading] = useState(true);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [tunnelOrder, setTunnelOrder] = useState<number[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [searchKeyword, setSearchKeyword] = useLocalStorageState(
    "tunnel-search-keyword",
    "",
  );
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [tunnelToDelete, setTunnelToDelete] = useState<Tunnel | null>(null);
  const [tunnelDeletePreview, setTunnelDeletePreview] =
    useState<TunnelDeletePreviewApiData | null>(null);
  const [deleteAction, setDeleteAction] = useState<TunnelDeleteAction>(
    DEFAULT_TUNNEL_DELETE_ACTION,
  );
  const [deleteTargetTunnelId, setDeleteTargetTunnelId] = useState<
    number | null
  >(null);
  const [currentDiagnosisTunnel, setCurrentDiagnosisTunnel] =
    useState<Tunnel | null>(null);
  const [diagnosisResult, setDiagnosisResult] =
    useState<DiagnosisResult | null>(null);
  const [diagnosisProgress, setDiagnosisProgress] = useState({
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    timedOut: false,
  });
  const diagnosisAbortRef = useRef<AbortController | null>(null);
  // 表单状态
  const [form, setForm] = useState<TunnelForm>(createTunnelFormDefaults());
  // 表单验证错误
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  // 👇 新增这行：用于暂存正在编辑中的文本框内容，防止逗号被吞
  const [focusedInputs, setFocusedInputs] = useState<Record<string, string>>(
    {},
  );
  // 批量操作相关状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchDeletePreviewLoading, setBatchDeletePreviewLoading] =
    useState(false);
  const [batchDeletePreview, setBatchDeletePreview] =
    useState<TunnelBatchDeletePreviewApiData | null>(null);
  const [batchDeleteAction, setBatchDeleteAction] =
    useState<TunnelDeleteAction>(DEFAULT_TUNNEL_DELETE_ACTION);
  const [batchDeleteTargetTunnelId, setBatchDeleteTargetTunnelId] = useState<
    number | null
  >(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgressState>({
    active: false,
    label: "",
    percent: 0,
  });
  const [batchResultModal, setBatchResultModal] =
    useState<BatchResultModalState>(EMPTY_BATCH_RESULT_MODAL_STATE);
  // 视图模式状态
  const [viewMode, setViewMode] = useState<"card" | "list">(() => {
    const stored = localStorage.getItem(TUNNEL_VIEW_MODE_KEY);

    return stored === "list" || stored === "card" ? stored : "card";
  });
  // 视图模式切换
  const handleViewModeToggle = useCallback(() => {
    const newMode = viewMode === "card" ? "list" : "card";

    setViewMode(newMode);
    localStorage.setItem(TUNNEL_VIEW_MODE_KEY, newMode);
  }, [viewMode, setViewMode]);
  // 隧道分组状态
  const [tunnelGroupsNew, setTunnelGroupsNew] = useState<
    TunnelGroupNewApiItem[]
  >([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  // 筛选状态
  const [tunnelFilterMode] = useLocalStorageState<
    "all" | "enabled" | "disabled"
  >("tunnel-filter-mode", "all");
  const [filterGroupId, setFilterGroupId] = useLocalStorageState<number | null>(
    "tunnel-filter-group-id",
    null,
  );
  const activeFilterCount =
    (filterGroupId !== null ? 1 : 0) + (searchKeyword.trim() ? 1 : 0);
  // 列表模式选中行
  const [selectedTunnelIds, setSelectedTunnelIds] = useState<Set<number>>(
    new Set(),
  );
  const selectAllTunnels = useCallback(() => {
    const allIds = tunnels.map((t) => t.id);

    setSelectedTunnelIds(new Set(allIds));
  }, [tunnels]);
  const deselectAllTunnels = useCallback(() => {
    setSelectedTunnelIds(new Set());
  }, []);
  const isAllTunnelsSelected = useMemo(() => {
    return tunnels.length > 0 && selectedTunnelIds.size === tunnels.length;
  }, [tunnels, selectedTunnelIds]);
  const handleSelectAllTunnelsToggle = useCallback(
    (isSelected: boolean) => {
      if (isSelected) {
        selectAllTunnels();
      } else {
        deselectAllTunnels();
      }
    },
    [selectAllTunnels, deselectAllTunnels],
  );

  useEffect(() => {
    return () => {
      diagnosisAbortRef.current?.abort();
      diagnosisAbortRef.current = null;
    };
  }, []);
  const applyTunnelList = useCallback((items: Tunnel[]) => {
    setTunnels(items);
    const hasDbOrdering = items.some(
      (tunnel) => tunnel.inx !== undefined && tunnel.inx !== 0,
    );

    if (hasDbOrdering) {
      const dbOrder = [...items]
        .sort((a, b) => (a.inx ?? 0) - (b.inx ?? 0))
        .map((tunnel) => tunnel.id);

      setTunnelOrder(dbOrder);

      return;
    }
    setTunnelOrder(
      loadStoredOrder(
        TUNNEL_ORDER_KEY,
        items.map((tunnel) => tunnel.id),
      ),
    );
  }, []);
  const refreshTunnelList = useCallback(
    async (withLoading = true) => {
      if (withLoading) {
        setLoading(true);
      }
      try {
        const tunnelsRes = await getTunnelList();

        if (tunnelsRes.code === 0) {
          applyTunnelList(mapTunnelApiItems(tunnelsRes.data || []));
        } else {
          toast.error(tunnelsRes.msg || "获取隧道列表失败");
        }
      } catch {
        toast.error("获取隧道列表失败");
      } finally {
        if (withLoading) {
          setLoading(false);
        }
      }
    },
    [applyTunnelList],
  );
  const refreshNodes = useCallback(async () => {
    try {
      const nodesRes = await getNodeList();

      if (nodesRes.code === 0) {
        setNodes(nodesRes.data || []);
      }
    } catch {}
  }, []);
  // 加载隧道分组
  const loadTunnelGroupsNew = useCallback(async () => {
    const res = await getTunnelGroupNewList();

    if (res.code === 0) {
      setTunnelGroupsNew(res.data);
    }
  }, []);
  // 加载所有数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        refreshTunnelList(false),
        refreshNodes(),
        loadTunnelGroupsNew(),
      ]);
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [refreshNodes, refreshTunnelList, loadTunnelGroupsNew]);

  useEffect(() => {
    loadData();
  }, [loadData]);
  const resetDeleteState = useCallback(() => {
    setDeleteLoading(false);
    setDeletePreviewLoading(false);
    setTunnelToDelete(null);
    setTunnelDeletePreview(null);
    setDeleteAction(DEFAULT_TUNNEL_DELETE_ACTION);
    setDeleteTargetTunnelId(null);
  }, []);
  const handleDeleteModalOpenChange = useCallback(
    (open: boolean) => {
      setDeleteModalOpen(open);
      if (!open) {
        resetDeleteState();
      }
    },
    [resetDeleteState],
  );
  const resetBatchDeleteState = useCallback(() => {
    setBatchDeletePreviewLoading(false);
    setBatchDeletePreview(null);
    setBatchDeleteAction(DEFAULT_TUNNEL_DELETE_ACTION);
    setBatchDeleteTargetTunnelId(null);
  }, []);
  const handleBatchDeleteModalOpenChange = useCallback(
    (open: boolean) => {
      setBatchDeleteModalOpen(open);
      if (!open) {
        resetBatchDeleteState();
      }
    },
    [resetBatchDeleteState],
  );
  // 🎯 智能检测1：计算当前选中节点“理应”对应的最新域名/IP
  const expectedInIps = useMemo(() => {
    const ips = form.inNodeId
      .map((ct) => {
        const n = nodes.find((item) => item.id === ct.nodeId);

        if (!n) return "";

        return (
          n.serverIpV4 ||
          n.serverIpV6 ||
          n.intranetIp ||
          n.serverIp ||
          ""
        ).trim();
      })
      .filter(Boolean);

    return ips.join("\n");
  }, [form.inNodeId, nodes]);
  // 🎯 智能检测2：判断隧道当前地址是否已经过期（与节点最新配置不符）
  const isInIpOutdated = useMemo(() => {
    if (!form.inIp || !expectedInIps) return false;
    const current = form.inIp
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");

    return current !== expectedInIps;
  }, [form.inIp, expectedInIps]);
  // 表单验证
  const validateForm = (): boolean => {
    const newErrors = validateTunnelForm(form, nodes);

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };
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
        const textArea = document.createElement("textarea");

        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "-9999px";
        textArea.style.opacity = "0";
        const modalElement = document.querySelector('[role="dialog"]');
        const targetContainer = modalElement || document.body;

        targetContainer.appendChild(textArea);
        textArea.focus();
        textArea.select();
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
  // 新增隧道
  const handleAdd = () => {
    setIsEdit(false);
    setForm(createTunnelFormDefaults());
    setErrors({});
    setModalOpen(true);
  };
  // 编辑隧道 - 只能修改部分字段
  const handleEdit = (tunnel: Tunnel) => {
    setIsEdit(true);
    setForm({
      id: tunnel.id,
      name: tunnel.name,
      type: tunnel.type,
      inNodeId: tunnel.inNodeId || [],
      outNodeId: tunnel.outNodeId || [],
      chainNodes: tunnel.chainNodes || [],
      flow: tunnel.flow,
      trafficRatio: tunnel.trafficRatio,
      inIp: tunnel.inIp
        ? tunnel.inIp
            .split(",")
            .map((ip: string) => ip.trim())
            .join("\n")
        : "",
      ipPreference: tunnel.ipPreference || "",
      status: tunnel.status,
      tunnelGroupId: tunnel.tunnelGroupId ?? null,
      remark: tunnel.remark || "",
    });
    setErrors({});
    setModalOpen(true);
  };
  // 删除隧道
  const handleDelete = async (tunnel: Tunnel) => {
    setTunnelToDelete(tunnel);
    setDeleteModalOpen(true);
    setDeletePreviewLoading(true);
    setTunnelDeletePreview(null);
    setDeleteAction(DEFAULT_TUNNEL_DELETE_ACTION);
    setDeleteTargetTunnelId(null);
    try {
      const response = await previewTunnelDelete(tunnel.id);

      if (response.code !== 0 || !response.data) {
        toast.error(response.msg || "获取删除依赖失败");
        setDeleteModalOpen(false);
        resetDeleteState();

        return;
      }
      setTunnelDeletePreview(response.data);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "获取删除依赖失败"));
      setDeleteModalOpen(false);
      resetDeleteState();
    } finally {
      setDeletePreviewLoading(false);
    }
  };
  const confirmDelete = async () => {
    if (!tunnelToDelete) return;
    const forwardCount = tunnelDeletePreview?.forwardCount ?? 0;
    const action: TunnelDeleteAction =
      forwardCount > 0 ? deleteAction : "delete_forwards";

    if (
      action === "replace" &&
      forwardCount > 0 &&
      (!deleteTargetTunnelId ||
        !deleteReplacementTunnels.some(
          (tunnel) => tunnel.id === deleteTargetTunnelId,
        ))
    ) {
      toast.error("请选择替换规则的目标隧道");

      return;
    }
    setDeleteLoading(true);
    try {
      const response = await deleteTunnelWithForwards({
        id: tunnelToDelete.id,
        action,
        targetTunnelId:
          action === "replace"
            ? (deleteTargetTunnelId ?? undefined)
            : undefined,
      });

      if (response.code === 0) {
        const deleteResult = (response.data || null) as {
          warnings?: string[];
        } | null;

        if ((deleteResult?.warnings?.length ?? 0) > 0) {
          toast.success(
            `删除成功，另有 ${deleteResult?.warnings?.length ?? 0} 条节点清理提示`,
          );
        } else {
          toast.success("删除成功");
        }
        setDeleteModalOpen(false);
        setTunnels((prev) =>
          prev.filter((tunnel) => tunnel.id !== tunnelToDelete.id),
        );
        setTunnelOrder((prev) => {
          const next = prev.filter((id) => id !== tunnelToDelete.id);

          saveOrder(TUNNEL_ORDER_KEY, next);

          return next;
        });
        setSelectedIds((prev) => {
          const next = new Set(prev);

          next.delete(tunnelToDelete.id);

          return next;
        });
        resetDeleteState();
      } else if (
        response.data &&
        typeof response.data === "object" &&
        Number((response.data as { failCount?: number }).failCount ?? 0) > 0
      ) {
        const result = response.data as {
          failCount?: number;
          successCount?: number;
        };
        const failures = extractBatchFailures(response.data);

        if (failures.length > 0) {
          setBatchResultModal({
            failures,
            open: true,
            summary: `成功 ${Number(result.successCount ?? 0)} 项，失败 ${Number(result.failCount ?? failures.length)} 项`,
            title: "规则处理失败",
          });
        }
        toast.error(response.msg || "删除失败");
      } else {
        toast.error(response.msg || "删除失败");
      }
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "删除失败"));
    } finally {
      setDeleteLoading(false);
    }
  };
  // 隧道类型改变时的处理
  const handleTypeChange = (type: number) => {
    setForm((prev) => ({
      ...prev,
      type,
      outNodeId: type === 1 ? [] : prev.outNodeId,
      chainNodes: type === 1 ? [] : prev.chainNodes,
    }));
  };
  // 删除转发链中的某一跳（删除整个分组）
  const removeChainNode = (groupIndex: number) => {
    setForm((prev) => ({
      ...prev,
      chainNodes: (prev.chainNodes || []).filter(
        (_, index) => index !== groupIndex,
      ),
    }));
  };
  const toSelectedNodeIds = (keys: Iterable<unknown>): number[] => {
    return Array.from(keys)
      .map((key) => Number.parseInt(String(key), 10))
      .filter((nodeId) => Number.isFinite(nodeId));
  };
  // 更新某一跳的所有节点的传输层协议
  const updateChainProtocol = (groupIndex: number, protocol: string) => {
    setForm((prev) => {
      const chainNodes = [...(prev.chainNodes || [])];

      chainNodes[groupIndex] = (chainNodes[groupIndex] || []).map((node) => ({
        ...node,
        protocol,
      }));

      return { ...prev, chainNodes };
    });
  };
  // 更新某一跳的所有节点的策略
  const updateChainStrategy = (groupIndex: number, strategy: string) => {
    setForm((prev) => {
      const chainNodes = [...(prev.chainNodes || [])];

      chainNodes[groupIndex] = (chainNodes[groupIndex] || []).map((node) => ({
        ...node,
        strategy,
      }));

      return { ...prev, chainNodes };
    });
  };
  // 🎯 多端口支持：解析逗号分隔的端口字符串
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
  // 🎯 多端口支持：格式化端口数组为显示文本
  // 出口连接端口输入框不再自动填充逗号，让用户手动输入
  const formatOutNodePortsToDisplay = (
    outNodes?: typeof form.outNodeId,
  ): string => {
    const nodes = outNodes || form.outNodeId || [];

    if (!nodes || nodes.length === 0) return "";
    const ports = nodes.map((n: any) => (n.port > 0 ? n.port.toString() : ""));

    if (ports.every((p) => p === "")) return "";

    const uniquePorts = ports
      .filter((p) => p !== "")
      .filter((p, i, arr) => arr.indexOf(p) === i);

    if (
      uniquePorts.length === 1 &&
      ports.filter((p) => p !== "").length === nodes.length
    ) {
      return uniquePorts[0];
    }

    return ports.join(",");
  };
  // 🎯 多端口支持：将端口应用到出口节点
  const applyPortsToOutNodes = (value: string) => {
    const ports = parsePortsFromInput(value);

    setForm((prev) => {
      const outNodes = prev.outNodeId || [];

      return {
        ...prev,
        outNodeId: outNodes.map((node, idx) => ({
          ...node,
          port: idx < ports.length && ports[idx] > 0 ? ports[idx] : undefined, // 留空让后端自动分配
        })),
      };
    });
  };
  // 🎯 多端口支持：格式化转发链端口为显示文本
  const formatChainPortsToDisplay = (chainGroup: ChainTunnel[]): string => {
    if (!chainGroup || chainGroup.length === 0) return "";
    const ports = chainGroup.map((n: any) =>
      n.port > 0 ? n.port.toString() : "",
    );

    if (ports.every((p) => p === "")) return "";

    const uniquePorts = ports
      .filter((p) => p !== "")
      .filter((p, i, arr) => arr.indexOf(p) === i);

    if (
      uniquePorts.length === 1 &&
      ports.filter((p) => p !== "").length === chainGroup.length
    ) {
      return uniquePorts[0];
    }

    // 只连接有值的端口，忽略尾随的空值
    return ports.join(",");
  };
  // 🎯 多端口支持：将端口应用到转发链节点
  const applyPortsToChainGroup = (groupIndex: number, value: string) => {
    const ports = parsePortsFromInput(value);

    setForm((prev) => {
      const chainNodes = [...(prev.chainNodes || [])];
      const currentGroup = chainNodes[groupIndex] || [];

      chainNodes[groupIndex] = currentGroup.map((node, idx) => ({
        ...node,
        port: idx < ports.length && ports[idx] > 0 ? ports[idx] : undefined,
      }));

      return { ...prev, chainNodes };
    });
  };
  // 连接 IP 类型格式化显示
  const formatConnectIpTypesToDisplay = (nodes: ChainTunnel[]): string => {
    if (!nodes || nodes.length === 0) return "";
    const types = nodes.map(
      (n: any) => n.connectIpType || n.connect_ip_type || "",
    );

    if (types.every((t) => t === "")) return "";

    return types.join(",");
  };
  const applyConnectIpTypesToChainGroup = (
    groupIndex: number,
    value: string,
  ) => {
    // 如果输入为空或只包含逗号/空格，清空该跳所有节点的 IP 类型
    if (!value || value.split(",").every((s) => !s.trim())) {
      setForm((prev) => {
        const chainNodes = [...(prev.chainNodes || [])];
        const currentGroup = chainNodes[groupIndex] || [];

        chainNodes[groupIndex] = currentGroup.map((node) => ({
          ...node,
          connectIpType: "",
        }));

        return { ...prev, chainNodes };
      });

      return;
    }

    const types = value.split(",").map((s) => s.trim());

    setForm((prev) => {
      const chainNodes = [...(prev.chainNodes || [])];
      const currentGroup = chainNodes[groupIndex] || [];

      chainNodes[groupIndex] = currentGroup.map((node, idx) => ({
        ...node,
        connectIpType: idx < types.length ? types[idx] : "",
      }));

      return { ...prev, chainNodes };
    });
  };
  const formatOutNodeConnectIpTypes = (): string => {
    const nodes = form.outNodeId || [];

    if (!nodes || nodes.length === 0) return "";
    const types = nodes.map(
      (n: any) => n.connectIpType || n.connect_ip_type || "",
    );

    if (types.every((t) => t === "")) return "";

    return types.join(",");
  };
  const applyOutNodeConnectIpTypes = (value: string) => {
    // 如果输入为空或只包含逗号/空格，清空所有节点的 IP 类型
    if (!value || value.split(",").every((s) => !s.trim())) {
      setForm((prev) => ({
        ...prev,
        outNodeId: (prev.outNodeId || []).map((node) => ({
          ...node,
          connectIpType: "",
        })),
      }));

      return;
    }

    const types = value.split(",").map((s) => s.trim());

    setForm((prev) => ({
      ...prev,
      outNodeId: (prev.outNodeId || []).map((node, idx) => ({
        ...node,
        connectIpType: idx < types.length ? types[idx] : "",
      })),
    }));
  };
  // 获取所有转发链中已选择的节点 ID 列表
  const getSelectedChainNodeIds = (): number[] => {
    return (form.chainNodes || []).flatMap((group) =>
      group.map((node) => node.nodeId),
    );
  };
  // 获取转发链分组（已经是二维数组）
  const getChainGroups = (): ChainTunnel[][] => {
    return form.chainNodes || [];
  };
  const mergeOrderedNodes = (
    currentNodes: ChainTunnel[],
    selectedNodeIds: number[],
    buildDefault: (nodeId: number) => ChainTunnel,
  ): ChainTunnel[] => {
    const selectedSet = new Set(selectedNodeIds);
    const kept = currentNodes.filter((node) => selectedSet.has(node.nodeId));
    const keptIds = new Set(kept.map((node) => node.nodeId));
    const added = selectedNodeIds
      .filter((nodeId) => !keptIds.has(nodeId))
      .map((nodeId) => buildDefault(nodeId));

    return [...kept, ...added];
  };
  const syncChainGroupNodes = (
    groupIndex: number,
    selectedNodeIds: number[],
  ) => {
    setForm((prev) => {
      const chainNodes = [...(prev.chainNodes || [])];
      const currentGroup = chainNodes[groupIndex] || [];
      const protocol = currentGroup[0]?.protocol || "tcp";
      const strategy = currentGroup[0]?.strategy || "round";
      const realNodes = currentGroup.filter((node) => node.nodeId !== -1);
      const mergedNodes = mergeOrderedNodes(
        realNodes,
        selectedNodeIds,
        (nodeId) => ({
          nodeId,
          chainType: 2,
          protocol,
          strategy,
        }),
      );

      chainNodes[groupIndex] =
        mergedNodes.length > 0
          ? mergedNodes
          : [{ nodeId: -1, chainType: 2, protocol, strategy }];

      return { ...prev, chainNodes };
    });
  };
  // 验证连接端口
  const validatePorts = (value: string, nodeCount: number): string | null => {
    if (!value || value.trim() === "") return null; // 允许全空（全自动分配）
    if (!/^[\d,\-]+$/.test(value))
      return "端口格式错误，只允许数字、逗号和连字符";
    const parts = value.split(",");

    if (parts.length !== nodeCount)
      return `节点数为 ${nodeCount}，需要输入 ${nodeCount} 个端口（用逗号分隔）`;
    for (const part of parts) {
      if (part && part.trim() !== "") {
        // 只验证非空值
        if (part.includes("-")) {
          const [start, end] = part.split("-").map(Number);

          if (start < 1 || end > 65535 || start > end)
            return "端口范围无效（1-65535）";
        } else {
          const port = Number(part);

          if (port < 1 || port > 65535) return "端口无效（1-65535）";
        }
      }
      // 空值表示由后端自动分配，允许
    }

    return null;
  };

  // 验证连接 IP 类型
  const validateIpTypes = (value: string, nodeCount: number): string | null => {
    if (!value || value.trim() === "") return null; // 允许全空（全自动分配）
    const parts = value.split(",").map((s) => s.trim());

    if (parts.length !== nodeCount)
      return `节点数为 ${nodeCount}，需要输入 ${nodeCount} 个 IP 类型（用逗号分隔）`;
    const validTypes = ["v4", "v6", "lan", "auto"];

    for (const type of parts) {
      if (type && type !== "") {
        // 只验证非空值
        if (!validTypes.includes(type.toLowerCase()))
          return `无效的 IP 类型 "${type}"，只允许：${validTypes.join(", ")}`;
      }
      // 空值表示由后端自动分配，允许
    }

    return null;
  };
  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;

    // 验证转发链
    for (let i = 0; i < (form.chainNodes || []).length; i++) {
      const group = (form.chainNodes || [])[i].filter(
        (node) => node.nodeId !== -1,
      );

      if (group.length === 0) continue;

      const portValue = formatChainPortsToDisplay(group);
      const portError = validatePorts(portValue, group.length);

      if (portError) {
        toast.error(`转发链第${i + 1}跳：${portError}`);

        return;
      }

      const ipTypeValue = formatConnectIpTypesToDisplay(group);
      const ipTypeError = validateIpTypes(ipTypeValue, group.length);

      if (ipTypeError) {
        toast.error(`转发链第${i + 1}跳：${ipTypeError}`);

        return;
      }
    }

    // 验证出口节点
    const outNodes = (form.outNodeId || []).filter(
      (node) => node.nodeId !== -1,
    );

    if (outNodes.length > 0) {
      const outPortValue = formatOutNodePortsToDisplay(outNodes);
      const outPortError = validatePorts(outPortValue, outNodes.length);

      if (outPortError) {
        toast.error(`出口节点：${outPortError}`);

        return;
      }

      const outIpTypeValue = formatOutNodeConnectIpTypes();
      const outIpTypeError = validateIpTypes(outIpTypeValue, outNodes.length);

      if (outIpTypeError) {
        toast.error(`出口节点：${outIpTypeError}`);

        return;
      }
    }

    setSubmitLoading(true);
    try {
      // 过滤掉占位节点（nodeId === -1 的节点）
      const cleanedChainNodes = (form.chainNodes || [])
        .map((group) =>
          group
            .filter((node) => node.nodeId !== -1)
            .map((n) => {
              const { port, allocatedPort, allocated_port, ...rest } = n as any;

              return {
                ...rest,
                port: n.port, // 保留用户设置的端口（undefined 或 0 表示自动分配）
                connectIpType: n.connectIpType || "",
                connect_ip_type: n.connectIpType || "",
              };
            }),
        )
        .filter((group) => group.length > 0); // 移除空组
      // 过滤掉出口节点中的占位节点
      const cleanedOutNodeId = (form.outNodeId || [])
        .filter((node) => node.nodeId !== -1)
        .map((n) => {
          const { port, allocatedPort, allocated_port, ...rest } = n as any;

          return {
            ...rest,
            port: n.port, // 保留用户设置的端口（undefined 或 0 表示自动分配）
            connectIpType: n.connectIpType || "",
            connect_ip_type: n.connectIpType || "",
          };
        });
      // 将换行符分隔的 IP 转换为逗号分隔
      let inIpString = form.inIp
        .split("\n")
        .map((ip) => ip.trim())
        .filter((ip) => ip)
        .join(",");

      // 🎯 前端强拦截：如果留空，自动提取域名
      if (!inIpString && form.inNodeId && form.inNodeId.length > 0) {
        const autoIps = form.inNodeId
          .map((ct) => {
            const n = nodes.find((item) => item.id === ct.nodeId);

            if (!n) return "";

            return (
              n.serverIpV4 ||
              n.serverIpV6 ||
              n.intranetIp ||
              n.serverIp ||
              ""
            ).trim();
          })
          .filter(Boolean);

        inIpString = autoIps.join(",");
      }
      // 🎯 终极杀招：同时发送驼峰和下划线字段，专治后端更新接口“挑食”！
      const data = {
        ...form,
        // 驼峰命名，给新增接口看
        inIp: inIpString,
        outNodeId: cleanedOutNodeId,
        chainNodes: cleanedChainNodes,
        tunnelGroupId: form.tunnelGroupId,
        // 下划线命名，给更新接口看 (强制绑定)
        in_ip: inIpString,
        in_node_id: (form.inNodeId || []).map((n) => ({
          ...n,
          connectIpType: n.connectIpType || "",
          connect_ip_type: n.connectIpType || "",
        })),
        out_node_id: cleanedOutNodeId,
        chain_nodes: cleanedChainNodes,
        tunnel_group_id: form.tunnelGroupId,
      };
      const response = isEdit
        ? await updateTunnel(data)
        : await createTunnel(data);

      if (response.code === 0) {
        toast.success(isEdit ? "更新成功" : "创建成功");
        setModalOpen(false);
        if (isEdit) {
          // 后端返回更新后的完整隧道数据，直接使用
          if (response.data) {
            const updatedTunnel = mapTunnelApiItems([response.data])[0];

            setTunnels((prev) =>
              prev.map((t) => (t.id === form.id ? updatedTunnel : t)),
            );
          } else {
            // 兜底：如果后端没有返回数据，刷新列表
            refreshTunnelList(false);
          }
        } else {
          // 新增时才需要刷新以获取新分配的 ID
          refreshTunnelList(false);
        }
      } else {
        toast.error(response.msg || (isEdit ? "更新失败" : "创建失败"));
      }
    } catch (error) {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitLoading(false);
    }
  };
  // 诊断隧道
  const handleDiagnose = async (tunnel: Tunnel) => {
    diagnosisAbortRef.current?.abort();
    const abortController = new AbortController();

    diagnosisAbortRef.current = abortController;
    setCurrentDiagnosisTunnel(tunnel);
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
      tunnelName: tunnel.name,
      tunnelType: tunnel.type === 1 ? "端口转发" : "隧道转发",
      timestamp: Date.now(),
      results: [],
    });
    try {
      let streamErrorMessage = "";
      const streamResult = await diagnoseTunnelStream(
        tunnel.id,
        {
          onStart: (payload) => {
            const startTunnelName =
              typeof payload.tunnelName === "string" &&
              payload.tunnelName.trim() !== ""
                ? payload.tunnelName
                : tunnel.name;
            const startTunnelType =
              typeof payload.tunnelType === "string" &&
              payload.tunnelType.trim() !== ""
                ? payload.tunnelType
                : tunnel.type === 1
                  ? "端口转发"
                  : "隧道转发";
            const startTotal = Number(payload.total);
            const startItems = Array.isArray(payload.items)
              ? (payload.items as DiagnosisResult["results"])
              : [];

            setDiagnosisResult((prev) => ({
              tunnelName: startTunnelName,
              tunnelType: startTunnelType,
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
          onItem: ({ result, progress }) => {
            setDiagnosisResult((prev) => {
              const base: DiagnosisResult = prev || {
                tunnelName: tunnel.name,
                tunnelType: tunnel.type === 1 ? "端口转发" : "隧道转发",
                timestamp: Date.now(),
                results: [],
              };
              const nextResults = [...base.results];
              const existingIndex = nextResults.findIndex(
                (item) =>
                  item.description === result.description &&
                  item.nodeId === result.nodeId &&
                  item.targetIp === result.targetIp &&
                  item.targetPort === result.targetPort,
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
        const response = await diagnoseTunnel(tunnel.id);

        if (response.code === 0) {
          const resultData = response.data as DiagnosisResult;
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
            buildDiagnosisFallbackResult({
              tunnelName: tunnel.name,
              tunnelType: tunnel.type,
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
        buildDiagnosisFallbackResult({
          tunnelName: tunnel.name,
          tunnelType: tunnel.type,
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
  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!active || !over || active.id === over.id) return;
    if (!tunnelOrder || tunnelOrder.length === 0) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);

    if (isNaN(activeId) || isNaN(overId)) return;
    const oldIndex = tunnelOrder.indexOf(activeId);
    const newIndex = tunnelOrder.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const newOrder = arrayMove(tunnelOrder, oldIndex, newIndex);

    setTunnelOrder(newOrder);
    saveOrder(TUNNEL_ORDER_KEY, newOrder);
    // 持久化到数据库
    try {
      const tunnelsToUpdate = newOrder.map((id, index) => ({ id, inx: index }));
      const response = await updateTunnelOrder({ tunnels: tunnelsToUpdate });

      if (response.code === 0) {
        setTunnels((prev) =>
          prev.map((tunnel) => {
            const updated = tunnelsToUpdate.find((t) => t.id === tunnel.id);

            return updated ? { ...tunnel, inx: updated.inx } : tunnel;
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
    const newSet = new Set(selectedIds);

    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };
  const selectAll = () => {
    const allIds = sortedTunnels.map((t) => t.id);

    setSelectedIds(new Set(allIds));
  };
  const deselectAll = () => {
    setSelectedIds(new Set());
  };
  const openBatchResultModal = useCallback(
    (title: string, summary: string, failures: BatchOperationFailure[]) => {
      setBatchResultModal({
        failures,
        open: true,
        summary,
        title,
      });
    },
    [],
  );
  const handleOpenBatchDeleteModal = async () => {
    if (selectedTunnelIdList.length === 0) return;
    setBatchDeleteModalOpen(true);
    setBatchDeletePreviewLoading(true);
    setBatchDeletePreview(null);
    setBatchDeleteAction(DEFAULT_TUNNEL_DELETE_ACTION);
    setBatchDeleteTargetTunnelId(null);
    try {
      const response = await previewBatchTunnelDelete(selectedTunnelIdList);

      if (response.code !== 0 || !response.data) {
        toast.error(response.msg || "获取批量删除依赖失败");
        setBatchDeleteModalOpen(false);
        resetBatchDeleteState();

        return;
      }
      setBatchDeletePreview(response.data);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "获取批量删除依赖失败"));
      setBatchDeleteModalOpen(false);
      resetBatchDeleteState();
    } finally {
      setBatchDeletePreviewLoading(false);
    }
  };
  const handleBatchDelete = async () => {
    if (selectedTunnelIdList.length === 0) return;
    if (
      batchDeleteHasForwardDependencies &&
      batchDeleteAction === "replace" &&
      (!batchDeleteTargetTunnelId || batchDeleteReplaceUnavailable)
    ) {
      toast.error("请选择替换规则的目标隧道");

      return;
    }
    setBatchLoading(true);
    setBatchProgress({
      active: true,
      label: `正在删除 ${selectedTunnelIdList.length} 条隧道...`,
      percent: 30,
    });
    try {
      const res = await batchDeleteTunnelsWithForwards({
        ids: selectedTunnelIdList,
        action: batchDeleteHasForwardDependencies
          ? batchDeleteAction
          : "delete_forwards",
        targetTunnelId:
          batchDeleteHasForwardDependencies && batchDeleteAction === "replace"
            ? (batchDeleteTargetTunnelId ?? undefined)
            : undefined,
      });

      if (res.code === 0) {
        const result = (res.data || {
          successCount: 0,
          failCount: 0,
          warnings: [],
        }) as {
          successCount: number;
          failCount: number;
          warnings?: string[];
        };
        const warningCount = result?.warnings?.length ?? 0;

        if (result.failCount === 0 && warningCount === 0) {
          toast.success(`成功删除 ${result.successCount} 项`);
        } else if (result.failCount > 0) {
          const failures = extractBatchFailures(result);

          if (failures.length > 0) {
            openBatchResultModal(
              "批量删除结果",
              `成功 ${result.successCount} 项，失败 ${result.failCount} 项`,
              failures,
            );
          } else {
            toast.error(
              buildBatchFailureMessage(
                result,
                `成功 ${result.successCount} 项，失败 ${result.failCount} 项`,
              ),
            );
          }
        } else {
          toast.success(
            `删除完成：成功 ${result.successCount} 项，${warningCount} 项有警告`,
          );
        }
        if (viewMode === "list") {
          setSelectedTunnelIds(new Set());
        } else {
          setSelectedIds(new Set());
        }
        setTunnels((prev) =>
          prev.filter((t) => !selectedTunnelIdList.includes(t.id)),
        );
        setBatchProgress({
          active: true,
          label: `删除完成：成功 ${result.successCount} 项`,
          percent: 100,
        });
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "删除失败"));
    } finally {
      setBatchLoading(false);
      setBatchProgress({ active: false, label: "", percent: 0 });
    }
  };
  const handleBatchRedeploy = async () => {
    const idsToRedeploy =
      viewMode === "list"
        ? Array.from(selectedTunnelIds)
        : Array.from(selectedIds);

    if (idsToRedeploy.length === 0) return;
    setBatchLoading(true);
    setBatchProgress({
      active: true,
      label: `正在重新下发 ${idsToRedeploy.length} 条隧道...`,
      percent: 30,
    });
    try {
      const res = await batchRedeployTunnels(idsToRedeploy);

      if (res.code === 0) {
        const result = res.data;

        if (result.failCount === 0) {
          toast.success(`成功重新下发 ${result.successCount} 项`);
        } else {
          const failures = extractBatchFailures(result);

          if (failures.length > 0) {
            openBatchResultModal(
              "批量下发结果",
              `成功 ${result.successCount} 项，失败 ${result.failCount} 项`,
              failures,
            );
          } else {
            toast.error(
              buildBatchFailureMessage(
                result,
                `成功 ${result.successCount} 项，失败 ${result.failCount} 项`,
              ),
            );
          }
        }
        if (viewMode === "list") {
          setSelectedTunnelIds(new Set());
        } else {
          setSelectedIds(new Set());
        }
        setBatchProgress({
          active: true,
          label: `重新下发完成：成功 ${result.successCount} 项`,
          percent: 100,
        });
      } else {
        toast.error(res.msg || "下发失败");
      }
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "下发失败"));
    } finally {
      setBatchLoading(false);
      setBatchProgress({ active: false, label: "", percent: 0 });
    }
  };
  // 传感器配置
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
  // 根据排序顺序获取隧道列表
  const sortedTunnels = useMemo((): Tunnel[] => {
    if (!tunnels || tunnels.length === 0) return [];
    let filteredTunnels = tunnels;

    // 按分组筛选
    if (filterGroupId !== null) {
      if (filterGroupId === -1) {
        // -1 表示未分组
        filteredTunnels = filteredTunnels.filter(
          (t) => !t.tunnelGroupId || t.tunnelGroupId === 0,
        );
      } else {
        filteredTunnels = filteredTunnels.filter(
          (t) => t.tunnelGroupId === filterGroupId,
        );
      }
    }
    // 按状态筛选
    if (tunnelFilterMode !== "all") {
      if (tunnelFilterMode === "enabled") {
        filteredTunnels = filteredTunnels.filter((t) => t.status === 1);
      } else if (tunnelFilterMode === "disabled") {
        filteredTunnels = filteredTunnels.filter((t) => t.status === 0);
      }
    }
    // 按关键词搜索
    if (searchKeyword.trim()) {
      const lowerKeyword = searchKeyword.toLowerCase();

      filteredTunnels = filteredTunnels.filter(
        (t) =>
          (t.name && t.name.toLowerCase().includes(lowerKeyword)) ||
          (t.inIp && t.inIp.toLowerCase().includes(lowerKeyword)) ||
          (t.remark && t.remark.toLowerCase().includes(lowerKeyword)),
      );
    }
    const sortedByDb = [...filteredTunnels].sort((a, b) => {
      const aInx = a.inx ?? 0;
      const bInx = b.inx ?? 0;

      return aInx - bInx;
    });

    // 如果数据库中没有排序信息，则使用本地存储的顺序
    if (
      tunnelOrder &&
      tunnelOrder.length > 0 &&
      sortedByDb.every((t) => t.inx === undefined || t.inx === 0)
    ) {
      const tunnelMap = new Map(filteredTunnels.map((t) => [t.id, t] as const));
      const localSorted: Tunnel[] = [];

      tunnelOrder.forEach((id) => {
        const tunnel = tunnelMap.get(id);

        if (tunnel) localSorted.push(tunnel);
      });
      filteredTunnels.forEach((tunnel) => {
        if (!tunnelOrder.includes(tunnel.id)) {
          localSorted.push(tunnel);
        }
      });

      return localSorted;
    }

    return sortedByDb;
  }, [tunnels, tunnelOrder, searchKeyword, tunnelFilterMode, filterGroupId]);
  const sortableTunnelIds = useMemo(
    () => sortedTunnels.map((t) => t.id),
    [sortedTunnels],
  );
  const deleteReplacementTunnels = useMemo(() => {
    if (!tunnelToDelete) {
      return [] as Tunnel[];
    }

    return tunnels
      .filter(
        (tunnel) => tunnel.id !== tunnelToDelete.id && tunnel.status === 1,
      )
      .sort((a, b) => {
        const aInx = a.inx ?? 0;
        const bInx = b.inx ?? 0;

        return aInx - bInx;
      });
  }, [tunnelToDelete, tunnels]);

  useEffect(() => {
    if (!deleteModalOpen) {
      return;
    }
    if ((tunnelDeletePreview?.forwardCount ?? 0) <= 0) {
      return;
    }
    if (deleteReplacementTunnels.length === 0) {
      setDeleteAction("delete_forwards");
      setDeleteTargetTunnelId(null);

      return;
    }
    if (deleteAction !== "replace") {
      return;
    }
    setDeleteTargetTunnelId((prev) => {
      if (
        prev &&
        deleteReplacementTunnels.some((tunnel) => tunnel.id === prev)
      ) {
        return prev;
      }

      return deleteReplacementTunnels[0]?.id ?? null;
    });
  }, [
    deleteAction,
    deleteModalOpen,
    deleteReplacementTunnels,
    tunnelDeletePreview?.forwardCount,
  ]);
  const deletePreviewForwardCount = tunnelDeletePreview?.forwardCount ?? 0;
  const deleteHasForwardDependencies = deletePreviewForwardCount > 0;
  const deleteReplaceUnavailable =
    deleteHasForwardDependencies && deleteReplacementTunnels.length === 0;
  const deleteConfirmLabel = deleteHasForwardDependencies
    ? deleteAction === "replace"
      ? "迁移后删除"
      : "直接删除"
    : "确认";
  const selectedTunnelIdList = useMemo(
    () =>
      viewMode === "list"
        ? Array.from(selectedTunnelIds)
        : Array.from(selectedIds),
    [viewMode, selectedTunnelIds, selectedIds],
  );
  const batchDeleteReplacementTunnels = useMemo(() => {
    if (selectedIds.size === 0) {
      return [] as Tunnel[];
    }

    return tunnels
      .filter((tunnel) => !selectedIds.has(tunnel.id) && tunnel.status === 1)
      .sort((a, b) => {
        const aInx = a.inx ?? 0;
        const bInx = b.inx ?? 0;

        return aInx - bInx;
      });
  }, [selectedIds, tunnels]);

  useEffect(() => {
    if (!batchDeleteModalOpen) {
      return;
    }
    if ((batchDeletePreview?.totalForwardCount ?? 0) <= 0) {
      return;
    }
    if (batchDeleteReplacementTunnels.length === 0) {
      setBatchDeleteAction("delete_forwards");
      setBatchDeleteTargetTunnelId(null);

      return;
    }
    if (batchDeleteAction !== "replace") {
      return;
    }
    setBatchDeleteTargetTunnelId((prev) => {
      if (
        prev &&
        batchDeleteReplacementTunnels.some((tunnel) => tunnel.id === prev)
      ) {
        return prev;
      }

      return batchDeleteReplacementTunnels[0]?.id ?? null;
    });
  }, [
    batchDeleteAction,
    batchDeleteModalOpen,
    batchDeletePreview?.totalForwardCount,
    batchDeleteReplacementTunnels,
  ]);
  const batchDeleteTotalForwardCount =
    batchDeletePreview?.totalForwardCount ?? 0;
  const batchDeleteHasForwardDependencies = batchDeleteTotalForwardCount > 0;
  const batchDeleteDependentTunnelCount =
    batchDeletePreview?.items?.filter((item) => item.forwardCount > 0).length ??
    0;
  const batchDeleteDirectDeleteTunnelCount = Math.max(
    selectedTunnelIdList.length - batchDeleteDependentTunnelCount,
    0,
  );
  const batchDeletePreviewItems = useMemo(() => {
    return [...(batchDeletePreview?.items ?? [])].sort((a, b) => {
      if (a.forwardCount > 0 === b.forwardCount > 0) {
        return a.tunnelName.localeCompare(b.tunnelName, "zh-CN");
      }

      return a.forwardCount > 0 ? -1 : 1;
    });
  }, [batchDeletePreview?.items]);
  const batchDeleteDependentItems = useMemo(
    () => batchDeletePreviewItems.filter((item) => item.forwardCount > 0),
    [batchDeletePreviewItems],
  );
  const batchDeleteReplaceUnavailable =
    batchDeleteHasForwardDependencies &&
    batchDeleteReplacementTunnels.length === 0;
  const batchDeleteConfirmLabel = batchDeleteHasForwardDependencies
    ? batchDeleteAction === "replace"
      ? `迁移规则后删除这 ${selectedTunnelIdList.length} 条隧道`
      : `删除规则并删除 ${selectedTunnelIdList.length} 条隧道`
    : `删除这 ${selectedTunnelIdList.length} 条隧道`;

  if (loading) {
    return <PageLoadingState message="正在加载..." />;
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex flex-row items-center mb-6 gap-3">
        <div className="flex items-center gap-2">
          <SearchBar
            isVisible={isSearchVisible}
            placeholder="隧道名称或IP"
            value={searchKeyword}
            onChange={setSearchKeyword}
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
        {(viewMode === "list" && selectedTunnelIds.size > 0) ||
        (viewMode === "card" && selectedIds.size > 0) ? (
          <>
            <Button
              color="primary"
              size="sm"
              variant="flat"
              onPress={viewMode === "list" ? selectAllTunnels : selectAll}
            >
              全选
            </Button>
            <Button
              color="warning"
              size="sm"
              variant="flat"
              onPress={viewMode === "list" ? deselectAllTunnels : deselectAll}
            >
              清空
            </Button>
            <Button
              color="secondary"
              isDisabled={
                viewMode === "list"
                  ? selectedTunnelIds.size === 0
                  : selectedIds.size === 0
              }
              isLoading={batchLoading}
              size="sm"
              variant="flat"
              onPress={handleBatchRedeploy}
            >
              下发
            </Button>
            <Button
              color="danger"
              isDisabled={
                viewMode === "list"
                  ? selectedTunnelIds.size === 0
                  : selectedIds.size === 0
              }
              size="sm"
              variant="flat"
              onPress={handleOpenBatchDeleteModal}
            >
              删除
            </Button>
            <span className="text-sm text-danger-400 shrink-0">
              已选{" "}
              {viewMode === "list" ? selectedTunnelIds.size : selectedIds.size}{" "}
              项
            </span>
          </>
        ) : (
          <>
            {/* 视图模式切换按钮 */}
            <Button
              color={viewMode === "card" ? "primary" : "warning"}
              size="sm"
              variant="flat"
              onPress={() => handleViewModeToggle()}
            >
              {viewMode === "card" ? "卡片" : "列表"}
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
            {activeFilterCount > 0 && (
              <Button
                color="warning"
                size="sm"
                variant="flat"
                onPress={() => {
                  setFilterGroupId(null);
                  setSearchKeyword("");
                }}
              >
                重置
              </Button>
            )}
          </>
        )}
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
      {/* 隧道列表 */}
      {tunnels.length > 0 ? (
        viewMode === "list" ? (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={sortableTunnelIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
                <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                  <thead className="bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4 w-[56px] text-center align-middle">
                        <div className="flex items-center justify-center h-full">
                          <Checkbox
                            aria-label="全选"
                            isSelected={isAllTunnelsSelected}
                            onValueChange={handleSelectAllTunnelsToggle}
                          />
                        </div>
                      </th>
                      <th className="py-3 px-4 w-[56px] text-center align-middle">
                        排序
                      </th>
                      <th className="py-3 px-4 w-[200px] align-middle">
                        隧道名称
                      </th>
                      {/* <th className="py-3 px-4 w-[120px] align-middle">分组名</th> */}
                      <th className="py-3 px-4 w-[140px] align-middle">
                        <Select
                          aria-label="按分组筛选"
                          className="w-full min-w-[100px]"
                          classNames={{
                            trigger:
                              "bg-transparent border-none shadow-none p-0 min-h-0 h-auto gap-1.5 hover:bg-default-100/50 transition-colors flex flex-row items-center justify-start",
                            value:
                              "text-sm text-default-600 font-semibold uppercase tracking-wider p-0 order-last",
                            selectorIcon:
                              "text-default-400 w-3.5 h-3.5 static order-first m-0",
                            innerWrapper: "w-fit flex-none",
                          }}
                          placeholder="隧道分组"
                          selectedKeys={
                            filterGroupId === null
                              ? []
                              : [
                                  filterGroupId === -1
                                    ? "-1"
                                    : String(filterGroupId),
                                ]
                          }
                          size="sm"
                          variant="flat"
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as
                              | string
                              | undefined;

                            if (!selected || selected === "all") {
                              setFilterGroupId(null);
                            } else if (selected === "-1") {
                              setFilterGroupId(-1);
                            } else {
                              setFilterGroupId(parseInt(selected));
                            }
                          }}
                        >
                          <SelectItem key="all" textValue="全部分组">
                            全部分组
                          </SelectItem>
                          <SelectItem key="-1" textValue="未分组">
                            未分组
                          </SelectItem>
                          {tunnelGroupsNew.map((group) => (
                            <SelectItem
                              key={String(group.id)}
                              textValue={group.name}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: group.color }}
                                />
                                <span>{group.name}</span>
                                <span className="text-default-400 text-xs ml-auto">
                                  {group.tunnelCount}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </Select>
                      </th>
                      <th className="py-3 px-4 w-[100px] align-middle">类型</th>
                      <th className="py-3 px-4 w-[100px] text-center align-middle">
                        入口
                      </th>
                      <th className="py-3 px-4 w-[80px] text-center align-middle">
                        跳数
                      </th>
                      <th className="py-3 px-4 w-[100px] text-center align-middle">
                        出口
                      </th>
                      <th className="py-3 px-4 w-[100px] text-center align-middle">
                        流量
                      </th>
                      <th className="py-3 px-4 w-[80px] text-center align-middle">
                        倍率
                      </th>
                      <th className="py-3 px-4 w-[80px] text-center align-middle">
                        偏好
                      </th>
                      <th className="py-3 px-4 w-[150px] align-middle">备注</th>
                      <th className="py-3 px-4 w-[280px] align-middle">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTunnels.length === 0 ? (
                      <tr>
                        <td className="py-16 text-center" colSpan={12}>
                          <div className="flex flex-col items-center justify-center">
                            <h3 className="text-base font-medium text-foreground mb-1">
                              未找到匹配的隧道
                            </h3>
                            <p className="text-default-500 text-sm mb-3">
                              没有符合条件的隧道配置，请调整筛选条件
                            </p>
                            <Button
                              color="warning"
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                setFilterGroupId(null);
                                setSearchKeyword("");
                              }}
                            >
                              归零筛选
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      sortedTunnels.map((tunnel) => {
                        const typeDisplay = getTunnelTypeDisplay(tunnel.type);
                        const inCount = tunnel.inNodeId?.length || 0;
                        const outCount = tunnel.outNodeId?.length || 0;
                        const chainCount = tunnel.chainNodes?.length || 0;

                        return (
                        <SortableListRowItem key={tunnel.id} id={tunnel.id}>
                          {({ setNodeRef, style, attributes, listeners }) => (
                            <tr
                              ref={setNodeRef}
                              className={`cursor-pointer transition-colors border-b border-divider/50 last:border-b-0 hover:bg-default-50/50 ${selectedTunnelIds.has(tunnel.id) ? "bg-primary-50 dark:bg-primary-900/30" : ""}`}
                              style={style}
                            >
                              <td className="py-3 px-4 text-center align-middle">
                                <div className="flex items-center justify-center h-full">
                                  <Checkbox
                                    aria-label="选择"
                                    isSelected={selectedTunnelIds.has(
                                      tunnel.id,
                                    )}
                                    onValueChange={(isSelected) => {
                                      if (isSelected) {
                                        setSelectedTunnelIds((prev) =>
                                          new Set(prev).add(tunnel.id),
                                        );
                                      } else {
                                        setSelectedTunnelIds((prev) => {
                                          const next = new Set(prev);

                                          next.delete(tunnel.id);

                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                </div>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <div
                                  {...attributes}
                                  {...listeners}
                                  className="cursor-grab active:cursor-grabbing inline-flex p-1 text-default-400 hover:text-default-600 transition-colors touch-manipulation"
                                  style={{ touchAction: "none" }}
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
                              </td>
                              <td className="py-3 px-4 align-middle">
                                <span
                                  className="font-medium text-foreground truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit"
                                  title={tunnel.name}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(tunnel.name, "隧道名称");
                                  }}
                                >
                                  {tunnel.name}
                                </span>
                              </td>
                              <td className="py-3 px-4 align-middle">
                                {tunnel.tunnelGroupId &&
                                tunnel.tunnelGroupId > 0 ? (
                                  (() => {
                                    const group = tunnelGroupsNew.find(
                                      (g) => g.id === tunnel.tunnelGroupId,
                                    );

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
                              </td>
                              <td className="py-3 px-4 align-middle">
                                <div
                                  className={
                                    typeDisplay.color === "primary"
                                      ? "inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400"
                                      : "inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-success-500/10 text-success-600 dark:text-success-400"
                                  }
                                >
                                  {typeDisplay.text}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {inCount}个
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {chainCount}跳
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {outCount}个
                                </span>
                                {renderBestExitState(tunnel.bestExitState)}
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {getTunnelFlowDisplay(tunnel.flow)}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {tunnel.trafficRatio}x
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center align-middle">
                                <span className="font-medium text-foreground">
                                  {tunnel.ipPreference === "v6"
                                    ? "IPv6"
                                    : "IPv4"}
                                </span>
                              </td>
                              <td className="py-3 px-4 align-middle">
                                {tunnel.remark ? (
                                  <div
                                    className="text-sm text-default-600 truncate max-w-[140px] cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit inline-block"
                                    title={tunnel.remark}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(tunnel.remark!, "备注");
                                    }}
                                  >
                                    {tunnel.remark}
                                  </div>
                                ) : (
                                  <span className="text-sm text-default-400">
                                    -
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 align-middle">
                                <div className="flex gap-1.5">
                                  <Button
                                    className="min-h-7 px-2"
                                    color="primary"
                                    size="sm"
                                    variant="flat"
                                    onPress={() => handleEdit(tunnel)}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    className="min-h-7 px-2"
                                    color="secondary"
                                    size="sm"
                                    variant="flat"
                                    onPress={() => handleDiagnose(tunnel)}
                                  >
                                    诊断
                                  </Button>
                                  <Button
                                    className="min-h-7 px-2"
                                    color="danger"
                                    size="sm"
                                    variant="flat"
                                    onPress={() => handleDelete(tunnel)}
                                  >
                                    删除
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </SortableListRowItem>
                      );
                    })
                    )}
                  </tbody>
                </table>
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={sortableTunnelIds}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {sortedTunnels.map((tunnel) => {
                  const typeDisplay = getTunnelTypeDisplay(tunnel.type);
                  const tunnelTypeChipClassName =
                    tunnel.type === 1
                      ? "inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400"
                      : "inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-success-500/10 text-success-600 dark:text-success-400";

                  return (
                    <SortableItem key={tunnel.id} id={tunnel.id}>
                      {(listeners) => (
                        <Card
                          key={tunnel.id}
                          className="group shadow-sm border border-divider hover:shadow-md transition-shadow duration-200 overflow-hidden h-full"
                        >
                          <CardHeader className="pb-0 md:pb-0">
                            {/* 顶部工具栏：选择框 + 拖拽 */}
                            <div className="flex justify-between items-center w-full mb-2">
                              <Checkbox
                                aria-label="选择"
                                isSelected={selectedIds.has(tunnel.id)}
                                onValueChange={() => toggleSelect(tunnel.id)}
                              />
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
                                  viewBox="0 0 20 20"
                                >
                                  <path d="M7 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 2zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 7 14zm6-8a2 2 0 1 1-.001-4.001A2 2 0 0 1 13 6zm0 2a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 8zm0 6a2 2 0 1 1 .001 4.001A2 2 0 0 1 13 14z" />
                                </svg>
                              </div>
                            </div>
                            {/* 隧道名称和类型 */}
                            <div className="flex-1 min-w-0">
                              <h3
                                className="font-semibold text-foreground truncate text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                                title={tunnel.name}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(tunnel.name, "隧道名称");
                                }}
                              >
                                {tunnel.name}
                              </h3>
                              <div className="flex items-center gap-1.5 mt-1">
                                <div className={tunnelTypeChipClassName}>
                                  {typeDisplay.text}
                                </div>
                                {tunnel.tunnelGroupId &&
                                tunnel.tunnelGroupId > 0
                                  ? (() => {
                                      const group = tunnelGroupsNew.find(
                                        (g) => g.id === tunnel.tunnelGroupId,
                                      );

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
                                      ) : null;
                                    })()
                                  : null}
                              </div>
                            </div>
                          </CardHeader>
                          <CardBody className="pt-0 pb-3 md:pt-0 md:pb-3">
                            <div className="space-y-3">
                              {/* 拓扑结构 */}
                              <div className="pt-2 border-t border-divider">
                                <div className="flex items-center justify-center gap-2 text-xs">
                                  {/* 入口节点 */}
                                  <div className="flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-100/20 rounded border border-primary-200 dark:border-primary-300/20">
                                    <svg
                                      aria-hidden="true"
                                      className="w-3 h-3 text-primary-600"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        clipRule="evenodd"
                                        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2v8h10V6H5z"
                                        fillRule="evenodd"
                                      />
                                    </svg>
                                    <span className="font-semibold text-primary-700 dark:text-primary-400">
                                      {tunnel.inNodeId?.length || 0}入口
                                    </span>
                                  </div>
                                  {/* 箭头 */}
                                  <svg
                                    aria-hidden="true"
                                    className="w-4 h-4 text-default-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      d="M9 5l7 7-7 7"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                    />
                                  </svg>
                                  {/* 转发链 */}
                                  <div className="flex items-center gap-1 px-2 py-1 bg-secondary-50 dark:bg-secondary-100/20 rounded border border-secondary-200 dark:border-secondary-300/20">
                                    <svg
                                      aria-hidden="true"
                                      className="w-3 h-3 text-secondary-600"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        clipRule="evenodd"
                                        d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                                        fillRule="evenodd"
                                      />
                                    </svg>
                                    <span className="font-semibold text-secondary-700 dark:text-secondary-400">
                                      {tunnel.type === 2
                                        ? tunnel.chainNodes?.length || 0
                                        : 0}
                                      跳
                                    </span>
                                  </div>
                                  {/* 箭头 */}
                                  <svg
                                    aria-hidden="true"
                                    className="w-4 h-4 text-default-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      d="M9 5l7 7-7 7"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                    />
                                  </svg>
                                  {/* 出口节点 */}
                                  <div className="flex items-center gap-1 px-2 py-1 bg-success-50 dark:bg-success-100/20 rounded border border-success-200 dark:border-success-300/20">
                                    <svg
                                      aria-hidden="true"
                                      className="w-3 h-3 text-success-600"
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path
                                        clipRule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
                                        fillRule="evenodd"
                                      />
                                    </svg>
                                    <span className="font-semibold text-success-700 dark:text-success-400">
                                      {tunnel.type === 2
                                        ? tunnel.outNodeId?.length || 0
                                        : tunnel.inNodeId?.length || 0}
                                      出口
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-center">
                                {renderBestExitState(tunnel.bestExitState)}
                              </div>
                              {/* 流量配置 */}
                              <div
                                className={`grid gap-2 ${tunnel.type === 2 && tunnel.ipPreference ? "grid-cols-3" : "grid-cols-2"}`}
                              >
                                <div className="text-center p-1.5 bg-default-50 dark:bg-default-100/30 rounded">
                                  <div className="text-xs text-default-500">
                                    流量计算
                                  </div>
                                  <div className="text-sm font-semibold text-foreground mt-0.5">
                                    {getTunnelFlowDisplay(tunnel.flow)}
                                  </div>
                                </div>
                                <div className="text-center p-1.5 bg-default-50 dark:bg-default-100/30 rounded">
                                  <div className="text-xs text-default-500">
                                    流量倍率
                                  </div>
                                  <div className="text-sm font-semibold text-foreground mt-0.5">
                                    {tunnel.trafficRatio}x
                                  </div>
                                </div>
                                {tunnel.type === 2 && tunnel.ipPreference && (
                                  <div className="text-center p-1.5 bg-default-50 dark:bg-default-100/30 rounded">
                                    <div className="text-xs text-default-500">
                                      连接偏好
                                    </div>
                                    <div className="text-sm font-semibold text-foreground mt-0.5">
                                      {tunnel.ipPreference === "v4"
                                        ? "IPv4"
                                        : "IPv6"}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5 mt-3">
                              <Button
                                className="flex-1 min-h-8"
                                color="primary"
                                size="sm"
                                variant="flat"
                                onPress={() => handleEdit(tunnel)}
                              >
                                编辑
                              </Button>
                              <Button
                                className="flex-1 min-h-8"
                                color="warning"
                                size="sm"
                                variant="flat"
                                onPress={() => handleDiagnose(tunnel)}
                              >
                                诊断
                              </Button>
                              <Button
                                className="flex-1 min-h-8"
                                color="danger"
                                size="sm"
                                variant="flat"
                                onPress={() => handleDelete(tunnel)}
                              >
                                删除
                              </Button>
                            </div>
                            {/* 备注 */}
                            {tunnel.remark && (
                              <div className="mt-2 pt-2 border-t border-divider">
                                <div className="flex items-center text-xs text-default-500">
                                  <span className="font-medium text-red-500 flex-shrink-0">
                                    备注：
                                  </span>
                                  <span
                                    className="truncate ml-1 cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit inline-block"
                                    title={tunnel.remark}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyToClipboard(tunnel.remark!, "备注");
                                    }}
                                  >
                                    {tunnel.remark}
                                  </span>
                                </div>
                              </div>
                            )}
                          </CardBody>
                        </Card>
                      )}
                    </SortableItem>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )
      ) : (
        <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
          <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
              暂无隧道配置
            </h3>
            <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
              还没有任何隧道配置，点击新增按钮开始创建
            </p>
          </CardBody>
        </Card>
      )}
      {/* 新增/编辑模态框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={modalOpen}
        placement="center"
        scrollBehavior="inside"
        size="xl"
        onOpenChange={setModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">
                  {isEdit ? "编辑隧道" : "新增隧道"}
                </h2>
                <p className="text-small text-default-500">
                  {
                    isEdit
                      ? "修改节点配置会中断现有连接，隧道类型不可修改"
                      : "" /* "创建新的隧道配置" */
                  }
                </p>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      errorMessage={errors.name}
                      isInvalid={!!errors.name}
                      label="隧道名称"
                      placeholder="请输入隧道名称"
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
                      placeholder="可备注隧道使用说明"
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
                      label="分组"
                      placeholder="选择分组"
                      selectedKeys={
                        form.tunnelGroupId ? [String(form.tunnelGroupId)] : []
                      }
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0] as string;

                        setForm((prev) => ({
                          ...prev,
                          tunnelGroupId: selected ? parseInt(selected) : null,
                        }));
                      }}
                    >
                      <SelectItem key="none">未分组</SelectItem>
                      {tunnelGroupsNew.map((group) => (
                        <SelectItem
                          key={String(group.id)}
                          textValue={group.name}
                        >
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
                    <Select
                      description={
                        isEdit ? "编辑时无法修改隧道类型" : undefined
                      }
                      errorMessage={errors.type}
                      isDisabled={isEdit}
                      isInvalid={!!errors.type}
                      label="隧道类型"
                      placeholder="请选择隧道类型"
                      selectedKeys={[form.type.toString()]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const selectedKey = Array.from(keys)[0] as string;

                        if (selectedKey) {
                          handleTypeChange(parseInt(selectedKey));
                        }
                      }}
                    >
                      <SelectItem key="1">端口转发</SelectItem>
                      <SelectItem key="2">隧道转发</SelectItem>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      errorMessage={errors.flow}
                      isInvalid={!!errors.flow}
                      label="流量计算"
                      placeholder="请选择流量计算方式"
                      selectedKeys={[form.flow.toString()]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const selectedKey = Array.from(keys)[0] as string;

                        if (selectedKey) {
                          setForm((prev) => ({
                            ...prev,
                            flow: parseInt(selectedKey),
                          }));
                        }
                      }}
                    >
                      <SelectItem key="1">单向计算（仅上传）</SelectItem>
                      <SelectItem key="2">双向计算（上传+下载）</SelectItem>
                    </Select>
                    <Input
                      errorMessage={errors.trafficRatio}
                      isInvalid={!!errors.trafficRatio}
                      label="流量倍率"
                      max={100}
                      min={0.01}
                      placeholder="例如：0.5 或 1 或 2"
                      step="any"
                      type="number"
                      value={form.trafficRatio.toString()}
                      variant="bordered"
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          trafficRatio: parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <Divider />
                  <h3 className="text-lg font-semibold">入口配置</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    {/* 节点选择 - 移动端100%，桌面端100% */}
                    <div className="col-span-1 md:col-span-4">
                      <Select
                        disabledKeys={
                          isEdit
                            ? (() => {
                                console.log(
                                  "编辑模式，disabledKeys 应该为空数组:",
                                  [],
                                );

                                return [];
                              })()
                            : [
                                // 新建时禁用离线节点
                                ...nodes
                                  .filter((node) => node.status !== 1)
                                  .map((node) => node.id.toString()),
                                ...(form.outNodeId || []).map((ct) =>
                                  ct.nodeId.toString(),
                                ),
                                ...getSelectedChainNodeIds().map((id) =>
                                  id.toString(),
                                ),
                              ]
                        }
                        dropdownPlacement="top"
                        errorMessage={errors.inNodeId}
                        isInvalid={!!errors.inNodeId}
                        label={`入口节点${form.inNodeId.length > 0 ? ` (已选 ${form.inNodeId.length} 个)` : ""}`}
                        placeholder="请选择入口节点（可多选）"
                        selectedKeys={form.inNodeId.map((ct) =>
                          ct.nodeId.toString(),
                        )}
                        selectionMode="multiple"
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const selectedIds = toSelectedNodeIds(keys);

                          setForm((prev) => {
                            let nextInIp = prev.inIp;

                            // 🎯 终极智能逻辑：如果是新增隧道，或者用户在编辑时把“入口地址”主动清空了，就触发自动抓取
                            if (!isEdit || !prev.inIp.trim()) {
                              const autoIps = selectedIds
                                .map((id) => {
                                  const n = nodes.find(
                                    (item) => item.id === id,
                                  );

                                  if (!n) return "";

                                  // 优先级：公网IPv4 → 公网IPv6 → 内网IP → 兼容IP
                                  return (
                                    n.serverIpV4 ||
                                    n.serverIpV6 ||
                                    n.intranetIp ||
                                    n.serverIp ||
                                    ""
                                  ).trim();
                                })
                                .filter(Boolean);

                              nextInIp = autoIps.join("\n");
                            }

                            return {
                              ...prev,
                              inIp: nextInIp, // 自动填入入口地址框
                              inNodeId: mergeOrderedNodes(
                                prev.inNodeId,
                                selectedIds,
                                (nodeId) => ({ nodeId, chainType: 1 }),
                              ),
                            };
                          });
                        }}
                      >
                        {nodes.map((node) => (
                          <SelectItem
                            key={node.id}
                            textValue={
                              node.remark
                                ? `${node.name} (${node.remark})`
                                : node.name
                            }
                          >
                            <div className="flex items-center justify-between">
                              <span>
                                {node.name}
                                {node.remark && (
                                  <span className="text-xs text-default-400 ml-1">
                                    ({node.remark})
                                  </span>
                                )}
                              </span>
                              <div className="flex items-center gap-2">
                                <div
                                  className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium ${node.status === 1 ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-default-500/10 text-default-500"}`}
                                >
                                  {node.status === 1 ? "在线" : "离线"}
                                </div>
                                {form.outNodeId &&
                                  form.outNodeId.some(
                                    (ct) => ct.nodeId === node.id,
                                  ) && (
                                    <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-danger-500/10 text-danger-600 dark:text-danger-400">
                                      已选为出口
                                    </div>
                                  )}
                                {getSelectedChainNodeIds().includes(
                                  node.id,
                                ) && (
                                  <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                    已选为转发链
                                  </div>
                                )}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Textarea
                      classNames={{
                        inputWrapper: "!min-h-[20px] py-1.5",
                        input: "!min-h-[20px]",
                      }}
                      description=""
                      errorMessage={errors.inIp}
                      isInvalid={!!errors.inIp}
                      label="入口地址"
                      placeholder="支持多个地址，每行一个地址，留空则自动获取入口节点地址"
                      rows={2}
                      value={form.inIp}
                      variant="bordered"
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, inIp: e.target.value }))
                      }
                    />
                    {/* 🎯 预警 UI：只要发现地址过期，立刻显示同步按钮 */}
                    {isEdit && isInIpOutdated && (
                      <div className="flex items-center justify-between bg-warning-50 dark:bg-warning-900/20 px-3 py-2 rounded-lg border border-warning-200 dark:border-warning-700/50 transition-all animate-appearance-in">
                        <span className="text-xs text-warning-600 dark:text-warning-400 font-medium flex items-center gap-1.5">
                          <svg
                            aria-hidden="true"
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                            />
                          </svg>
                          检测到隧道入口 域名/IP 有变动
                        </span>
                        <Button
                          className="h-6 min-h-0 text-xs px-2.5 rounded-md"
                          color="warning"
                          size="sm"
                          variant="flat"
                          onPress={() =>
                            setForm((prev) => ({
                              ...prev,
                              inIp: expectedInIps,
                            }))
                          }
                        >
                          一键同步
                        </Button>
                      </div>
                    )}
                  </div>
                  {/* 隧道转发时显示转发链配置 */}
                  {form.type === 2 && (
                    <>
                      <Divider />
                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <h3 className="text-base font-semibold">
                            转发链配置
                          </h3>
                          <span className="text-sm">
                            已配置{" "}
                            <span className="text-red-500 font-medium">
                              {getChainGroups().length}
                            </span>{" "}
                            跳
                          </span>
                        </div>
                        {getChainGroups().length > 0 ? (
                          getChainGroups().map((groupNodes, groupIndex) => {
                            const protocol =
                              groupNodes.length > 0
                                ? groupNodes[0].protocol || "tcp"
                                : "tcp";
                            const strategy =
                              groupNodes.length > 0
                                ? groupNodes[0].strategy || "round"
                                : "round";

                            return (
                              <div
                                key={groupIndex}
                                className="border border-default-200 rounded-lg p-3"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium text-default-600">
                                    第{groupIndex + 1}跳
                                  </span>
                                  <Button
                                    isIconOnly
                                    aria-label={`删除第${groupIndex + 1}跳`}
                                    color="danger"
                                    size="sm"
                                    variant="flat"
                                    onPress={() => removeChainNode(groupIndex)}
                                  >
                                    <svg
                                      aria-hidden="true"
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        d="M6 18L18 6M6 6l12 12"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                      />
                                    </svg>
                                  </Button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                                  {/* 节点选择 - 移动端 100%，桌面端 100% */}
                                  <div className="col-span-1 md:col-span-3">
                                    <Select
                                      classNames={{
                                        base: "w-full",
                                        label: "text-xs",
                                        value: "text-sm",
                                      }}
                                      disabledKeys={
                                        isEdit
                                          ? [
                                              ...form.inNodeId.map((ct) =>
                                                ct.nodeId.toString(),
                                              ),
                                              ...(form.outNodeId || []).map(
                                                (ct) => ct.nodeId.toString(),
                                              ),
                                              ...(form.chainNodes || [])
                                                .flatMap((group, idx) =>
                                                  idx !== groupIndex
                                                    ? group.map(
                                                        (ct) => ct.nodeId,
                                                      )
                                                    : [],
                                                )
                                                .filter((id) => id !== -1)
                                                .map((id) => id.toString()),
                                            ]
                                          : [
                                              ...nodes
                                                .filter(
                                                  (node) => node.status !== 1,
                                                )
                                                .map((node) =>
                                                  node.id.toString(),
                                                ),
                                              ...form.inNodeId.map((ct) =>
                                                ct.nodeId.toString(),
                                              ),
                                              ...(form.outNodeId || []).map(
                                                (ct) => ct.nodeId.toString(),
                                              ),
                                              ...(form.chainNodes || [])
                                                .flatMap((group, idx) =>
                                                  idx !== groupIndex
                                                    ? group.map(
                                                        (ct) => ct.nodeId,
                                                      )
                                                    : [],
                                                )
                                                .filter((id) => id !== -1)
                                                .map((id) => id.toString()),
                                            ]
                                      }
                                      dropdownPlacement="top"
                                      label={`节点选择${groupNodes.filter((ct) => ct.nodeId !== -1).length > 0 ? ` (已选 ${groupNodes.filter((ct) => ct.nodeId !== -1).length} 个)` : ""}`}
                                      placeholder="选择节点（可多选）"
                                      selectedKeys={groupNodes
                                        .filter((ct) => ct.nodeId !== -1)
                                        .map((ct) => ct.nodeId.toString())}
                                      selectionMode="multiple"
                                      size="sm"
                                      variant="bordered"
                                      onSelectionChange={(keys) => {
                                        syncChainGroupNodes(
                                          groupIndex,
                                          toSelectedNodeIds(keys),
                                        );
                                      }}
                                    >
                                      {nodes.map((node) => (
                                        <SelectItem
                                          key={node.id}
                                          textValue={
                                            node.remark
                                              ? `${node.name} (${node.remark})`
                                              : node.name
                                          }
                                        >
                                          <div className="flex items-center justify-between">
                                            <span className="text-sm">
                                              {node.name}
                                              {node.remark && (
                                                <span className="text-xs text-default-400 ml-1">
                                                  ({node.remark})
                                                </span>
                                              )}
                                            </span>
                                            <div className="flex items-center gap-2">
                                              <Chip
                                                color={
                                                  node.status === 1
                                                    ? "success"
                                                    : "default"
                                                }
                                                size="sm"
                                                variant="flat"
                                              >
                                                {node.status === 1
                                                  ? "在线"
                                                  : "离线"}
                                              </Chip>
                                              {form.inNodeId.some(
                                                (ct) => ct.nodeId === node.id,
                                              ) && (
                                                <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-warning-500/10 text-warning-600 dark:text-warning-400">
                                                  已选为入口
                                                </div>
                                              )}
                                              {form.outNodeId &&
                                                form.outNodeId.some(
                                                  (ct) => ct.nodeId === node.id,
                                                ) && (
                                                  <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-danger-500/10 text-danger-600 dark:text-danger-400">
                                                    已选为出口
                                                  </div>
                                                )}
                                              {(form.chainNodes || []).some(
                                                (group, idx) =>
                                                  idx !== groupIndex &&
                                                  group.some(
                                                    (ct) =>
                                                      ct.nodeId === node.id &&
                                                      ct.nodeId !== -1,
                                                  ),
                                              ) && (
                                                <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                                  已选为其他跳
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </Select>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                                  {/* 传输层协议选择 - 50% */}
                                  <Select
                                    classNames={{
                                      label: "text-xs",
                                      value: "text-sm",
                                    }}
                                    description="不懂的就默认，不要选！"
                                    label="传输层协议"
                                    placeholder="选择传输层协议"
                                    selectedKeys={[protocol]}
                                    size="sm"
                                    variant="bordered"
                                    onSelectionChange={(keys) => {
                                      const selectedKey = Array.from(
                                        keys,
                                      )[0] as string;

                                      if (selectedKey) {
                                        updateChainProtocol(
                                          groupIndex,
                                          selectedKey,
                                        );
                                      }
                                    }}
                                  >
                                    <SelectItem key="tcp">TCP</SelectItem>
                                    <SelectItem key="mtcp">MTCP</SelectItem>
                                    <SelectItem key="tls">TLS</SelectItem>
                                    <SelectItem key="mtls">MTLS</SelectItem>
                                    <SelectItem key="wss">WSS</SelectItem>
                                    <SelectItem key="mwss">MWSS</SelectItem>
                                  </Select>
                                  {/* 负载策略 - 50% */}
                                  <Select
                                    classNames={{
                                      label: "text-xs",
                                      value: "text-sm",
                                    }}
                                    label="负载策略"
                                    placeholder="选择策略"
                                    selectedKeys={[strategy]}
                                    size="sm"
                                    variant="bordered"
                                    onSelectionChange={(keys) => {
                                      const selectedKey = Array.from(
                                        keys,
                                      )[0] as string;

                                      if (selectedKey) {
                                        updateChainStrategy(
                                          groupIndex,
                                          selectedKey,
                                        );
                                      }
                                    }}
                                  >
                                    <SelectItem key="fifo">主备</SelectItem>
                                    <SelectItem key="best">最优</SelectItem>
                                    <SelectItem key="round">轮询</SelectItem>
                                    <SelectItem key="rand">随机</SelectItem>
                                  </Select>
                                </div>
                                {/* 连接 IP 和连接端口 - 转发链节点 */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                                  <Input
                                    description="指定当前级被上一级连接的端口，多节点可用逗号分隔，按选择节点顺序匹配，留空按节点端口范围自动分配"
                                    errorMessage={
                                      errors[`chainNodes_${groupIndex}_port`]
                                    }
                                    isInvalid={
                                      !!errors[`chainNodes_${groupIndex}_port`]
                                    }
                                    label="连接端口"
                                    placeholder="例：11111,22222"
                                    size="sm"
                                    type="text"
                                    value={
                                      focusedInputs[
                                        `chain_port_${groupIndex}`
                                      ] ?? formatChainPortsToDisplay(groupNodes)
                                    }
                                    variant="bordered"
                                    onBlur={() => {
                                      const finalValue =
                                        focusedInputs[
                                          `chain_port_${groupIndex}`
                                        ] ??
                                        formatChainPortsToDisplay(groupNodes);

                                      setFocusedInputs((prev) => {
                                        const next = { ...prev };

                                        delete next[`chain_port_${groupIndex}`];

                                        return next;
                                      });
                                      if (finalValue) {
                                        applyPortsToChainGroup(
                                          groupIndex,
                                          finalValue,
                                        );
                                      } else {
                                        applyPortsToChainGroup(groupIndex, "");
                                      }
                                    }}
                                    onChange={(e) => {
                                      setFocusedInputs((prev) => ({
                                        ...prev,
                                        [`chain_port_${groupIndex}`]:
                                          e.target.value,
                                      }));
                                    }}
                                    onFocus={() => {
                                      const displayValue =
                                        formatChainPortsToDisplay(groupNodes);

                                      if (displayValue) {
                                        setFocusedInputs((prev) => ({
                                          ...prev,
                                          [`chain_port_${groupIndex}`]:
                                            displayValue,
                                        }));
                                      }
                                    }}
                                  />
                                  <Input
                                    description="多节点可用逗号分隔，按选择节点顺序匹配，v4 对应公网 v4 地址，v6 对应公网 v6 地址，lan 对应内网地址，留空自动匹配"
                                    label="连接 IP 类型"
                                    placeholder="例：lan,v4,v6"
                                    size="sm"
                                    type="text"
                                    value={
                                      focusedInputs[
                                        `chain_ipType_${groupIndex}`
                                      ] ??
                                      formatConnectIpTypesToDisplay(groupNodes)
                                    }
                                    variant="bordered"
                                    onBlur={(e) => {
                                      setFocusedInputs((prev) => {
                                        const next = { ...prev };

                                        delete next[
                                          `chain_ipType_${groupIndex}`
                                        ];

                                        return next;
                                      });
                                      applyConnectIpTypesToChainGroup(
                                        groupIndex,
                                        e.target.value,
                                      );
                                    }}
                                    onChange={(e) => {
                                      setFocusedInputs((prev) => ({
                                        ...prev,
                                        [`chain_ipType_${groupIndex}`]:
                                          e.target.value,
                                      }));
                                      applyConnectIpTypesToChainGroup(
                                        groupIndex,
                                        e.target.value,
                                      );
                                    }}
                                    onFocus={() => {
                                      const displayValue =
                                        formatConnectIpTypesToDisplay(
                                          groupNodes,
                                        );

                                      if (displayValue) {
                                        setFocusedInputs((prev) => ({
                                          ...prev,
                                          [`chain_ipType_${groupIndex}`]:
                                            displayValue,
                                        }));
                                      }
                                    }}
                                  />
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <Button
                                    color="primary"
                                    size="sm"
                                    variant="flat"
                                    onPress={(e) => {
                                      e.stopPropagation();
                                      setForm((prev) => ({
                                        ...prev,
                                        chainNodes: [
                                          ...(prev.chainNodes || []),
                                          [
                                            {
                                              nodeId: -1,
                                              chainType: 2,
                                              protocol: "tcp",
                                              strategy: "round",
                                            },
                                          ],
                                        ],
                                      }));
                                    }}
                                  >
                                    再加一跳
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-center py-4 bg-default-50 dark:bg-default-100/50 rounded border border-dashed border-default-300">
                            <Button
                              color="primary"
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e.stopPropagation();
                                setForm((prev) => ({
                                  ...prev,
                                  chainNodes: [
                                    ...(prev.chainNodes || []),
                                    [
                                      {
                                        nodeId: -1,
                                        chainType: 2,
                                        protocol: "tcp",
                                        strategy: "round",
                                      },
                                    ],
                                  ],
                                }));
                              }}
                            >
                              添加一跳
                            </Button>
                            <p className="text-sm text-default-500 mt-4">
                              还没有转发链 点击按钮开始添加
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {/* 隧道转发时显示隧道连接地址偏好 */}
                  {form.type === 2 && (
                    <>
                      <Divider />
                      <h3 className="text-lg font-semibold">出口配置</h3>
                      {(() => {
                        return (
                          <>
                            {/* Row 1: Node selection + Load balancing strategy */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              {/* 节点选择 - 移动端 100%，桌面端 100% */}
                              <div className="col-span-1 md:col-span-3">
                                <Select
                                  classNames={{
                                    base: "w-full",
                                    label: "text-xs",
                                    value: "text-sm",
                                  }}
                                  disabledKeys={
                                    isEdit
                                      ? [
                                          // 编辑时【不禁用】离线节点，仅排除入口和转发链冲突节点
                                          ...form.inNodeId.map((ct) =>
                                            ct.nodeId.toString(),
                                          ),
                                          ...getSelectedChainNodeIds().map(
                                            (id) => id.toString(),
                                          ),
                                        ]
                                      : [
                                          // 新建时【禁用】离线节点，并排除冲突节点
                                          ...nodes
                                            .filter((node) => node.status !== 1)
                                            .map((node) => node.id.toString()),
                                          ...form.inNodeId.map((ct) =>
                                            ct.nodeId.toString(),
                                          ),
                                          ...getSelectedChainNodeIds().map(
                                            (id) => id.toString(),
                                          ),
                                        ]
                                  }
                                  dropdownPlacement="top"
                                  errorMessage={errors.outNodeId}
                                  isInvalid={!!errors.outNodeId}
                                  label={`出口节点${form.outNodeId && form.outNodeId.filter((ct) => ct.nodeId !== -1).length > 0 ? ` (已选 ${form.outNodeId.filter((ct) => ct.nodeId !== -1).length} 个)` : ""}`}
                                  placeholder="请选择出口节点（可多选）"
                                  selectedKeys={
                                    form.outNodeId
                                      ? form.outNodeId
                                          .filter((ct) => ct.nodeId !== -1)
                                          .map((ct) => ct.nodeId.toString())
                                      : []
                                  }
                                  selectionMode="multiple"
                                  variant="bordered"
                                  onSelectionChange={(keys) => {
                                    const selectedIds = toSelectedNodeIds(keys);

                                    setForm((prev) => {
                                      const currentOutNodes =
                                        prev.outNodeId || [];
                                      const protocol =
                                        currentOutNodes[0]?.protocol || "tcp";
                                      const strategy =
                                        currentOutNodes[0]?.strategy || "round";
                                      const realNodes = currentOutNodes.filter(
                                        (ct) => ct.nodeId !== -1,
                                      );

                                      return {
                                        ...prev,
                                        outNodeId: mergeOrderedNodes(
                                          realNodes,
                                          selectedIds,
                                          (nodeId) => ({
                                            nodeId,
                                            chainType: 3,
                                            protocol,
                                            strategy,
                                          }),
                                        ),
                                      };
                                    });
                                  }}
                                >
                                  {nodes.map((node) => (
                                    <SelectItem
                                      key={node.id}
                                      textValue={
                                        node.remark
                                          ? `${node.name} (${node.remark})`
                                          : node.name
                                      }
                                    >
                                      <div className="flex items-center justify-between">
                                        <span>
                                          {node.name}
                                          {node.remark && (
                                            <span className="text-xs text-default-400 ml-1">
                                              ({node.remark})
                                            </span>
                                          )}
                                        </span>
                                        <div className="flex items-center gap-2">
                                          <Chip
                                            color={
                                              node.status === 1
                                                ? "success"
                                                : "default"
                                            }
                                            size="sm"
                                            variant="flat"
                                          >
                                            {node.status === 1
                                              ? "在线"
                                              : "离线"}
                                          </Chip>
                                          {form.inNodeId.some(
                                            (ct) => ct.nodeId === node.id,
                                          ) && (
                                            <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-warning-500/10 text-warning-600 dark:text-warning-400">
                                              已选为入口
                                            </div>
                                          )}
                                          {getSelectedChainNodeIds().includes(
                                            node.id,
                                          ) && (
                                            <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                              已选为转发链
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </Select>
                              </div>
                            </div>
                            {/* Row 2: Protocol + Forward Protocol */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                              {/* 传输层协议选择 - 50% */}
                              <Select
                                classNames={{
                                  label: "text-xs",
                                  value: "text-sm",
                                }}
                                description="不懂的就默认，不要选！"
                                errorMessage={errors.protocol}
                                isInvalid={!!errors.protocol}
                                label="传输层协议"
                                placeholder="选择传输层协议"
                                selectedKeys={[
                                  (() => {
                                    if (
                                      !form.outNodeId ||
                                      form.outNodeId.length === 0
                                    )
                                      return "tcp";

                                    return form.outNodeId[0].protocol || "tcp";
                                  })(),
                                ]}
                                variant="bordered"
                                onSelectionChange={(keys) => {
                                  const selectedKey = Array.from(
                                    keys,
                                  )[0] as string;

                                  if (selectedKey) {
                                    setForm((prev) => {
                                      const currentOutNodes =
                                        prev.outNodeId || [];
                                      const currentStrategy =
                                        currentOutNodes.length > 0
                                          ? currentOutNodes[0].strategy ||
                                            "round"
                                          : "round";

                                      if (currentOutNodes.length === 0) {
                                        // 如果还没有出口节点，创建一个占位节点保存设置
                                        return {
                                          ...prev,
                                          outNodeId: [
                                            {
                                              nodeId: -1,
                                              chainType: 3,
                                              protocol: selectedKey,
                                              strategy: currentStrategy,
                                            },
                                          ],
                                        };
                                      }

                                      // 更新所有出口节点的传输层协议
                                      return {
                                        ...prev,
                                        outNodeId: currentOutNodes.map(
                                          (ct) => ({
                                            ...ct,
                                            protocol: selectedKey,
                                          }),
                                        ),
                                      };
                                    });
                                  }
                                }}
                              >
                                <SelectItem key="tcp">TCP</SelectItem>
                                <SelectItem key="mtcp">MTCP</SelectItem>
                                <SelectItem key="tls">TLS</SelectItem>
                                <SelectItem key="mtls">MTLS</SelectItem>
                                <SelectItem key="wss">WSS</SelectItem>
                                <SelectItem key="mwss">MWSS</SelectItem>
                              </Select>
                              {/* 负载策略 - 50% */}
                              <Select
                                classNames={{
                                  label: "text-xs",
                                  value: "text-sm",
                                }}
                                label="负载策略"
                                placeholder="选择策略"
                                selectedKeys={[
                                  (() => {
                                    if (
                                      !form.outNodeId ||
                                      form.outNodeId.length === 0
                                    )
                                      return "round";

                                    return (
                                      form.outNodeId[0].strategy || "round"
                                    );
                                  })(),
                                ]}
                                variant="bordered"
                                onSelectionChange={(keys) => {
                                  const selectedKey = Array.from(
                                    keys,
                                  )[0] as string;

                                  if (selectedKey) {
                                    setForm((prev) => {
                                      const currentOutNodes =
                                        prev.outNodeId || [];
                                      const currentProtocol =
                                        currentOutNodes.length > 0
                                          ? currentOutNodes[0].protocol || "tcp"
                                          : "tcp";

                                      if (currentOutNodes.length === 0) {
                                        return {
                                          ...prev,
                                          outNodeId: [
                                            {
                                              nodeId: -1,
                                              chainType: 3,
                                              protocol: currentProtocol,
                                              strategy: selectedKey,
                                            },
                                          ],
                                        };
                                      }

                                      return {
                                        ...prev,
                                        outNodeId: currentOutNodes.map(
                                          (ct) => ({
                                            ...ct,
                                            strategy: selectedKey,
                                          }),
                                        ),
                                      };
                                    });
                                  }
                                }}
                              >
                                <SelectItem key="fifo">主备</SelectItem>
                                <SelectItem key="best">最优</SelectItem>
                                <SelectItem key="round">轮询</SelectItem>
                                <SelectItem key="rand">随机</SelectItem>
                              </Select>
                            </div>
                            {/* 连接端口和连接 IP 类型 - 出口节点 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                              <Input
                                description="指定出口节点被上一级连接的端口，多节点可用逗号分隔，按选择节点顺序匹配，留空按节点端口范围自动分配"
                                label="连接端口"
                                placeholder="例：33333,55555"
                                size="sm"
                                type="text"
                                value={
                                  focusedInputs[`out_port`] ??
                                  formatOutNodePortsToDisplay()
                                }
                                variant="bordered"
                                onBlur={() => {
                                  const finalValue =
                                    focusedInputs[`out_port`] ??
                                    formatOutNodePortsToDisplay();

                                  setFocusedInputs((prev) => {
                                    const next = { ...prev };

                                    delete next[`out_port`];

                                    return next;
                                  });
                                  if (finalValue) {
                                    applyPortsToOutNodes(finalValue);
                                  } else {
                                    applyPortsToOutNodes("");
                                  }
                                }}
                                onChange={(e) => {
                                  setFocusedInputs((prev) => ({
                                    ...prev,
                                    [`out_port`]: e.target.value,
                                  }));
                                }}
                                onFocus={() => {
                                  const displayValue =
                                    formatOutNodePortsToDisplay();

                                  if (displayValue) {
                                    setFocusedInputs((prev) => ({
                                      ...prev,
                                      [`out_port`]: displayValue,
                                    }));
                                  }
                                }}
                              />
                              <Input
                                description="多节点可用逗号分隔，按选择节点顺序匹配，v4 对应公网 v4，v6 对应公网 v6，lan 对应内网，留空自动匹配"
                                label="连接 IP 类型"
                                placeholder="例：v4,v6,lan"
                                size="sm"
                                type="text"
                                value={
                                  focusedInputs[`out_ipType`] ??
                                  formatOutNodeConnectIpTypes()
                                }
                                variant="bordered"
                                onBlur={(e) => {
                                  setFocusedInputs((prev) => {
                                    const next = { ...prev };

                                    delete next[`out_ipType`];

                                    return next;
                                  });
                                  applyOutNodeConnectIpTypes(e.target.value);
                                }}
                                onChange={(e) => {
                                  setFocusedInputs((prev) => ({
                                    ...prev,
                                    [`out_ipType`]: e.target.value,
                                  }));
                                  applyOutNodeConnectIpTypes(e.target.value);
                                }}
                                onFocus={() => {
                                  const displayValue =
                                    formatOutNodeConnectIpTypes();

                                  if (displayValue) {
                                    setFocusedInputs((prev) => ({
                                      ...prev,
                                      [`out_ipType`]: displayValue,
                                    }));
                                  }
                                }}
                              />
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
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
                  {submitLoading
                    ? isEdit
                      ? "更新中..."
                      : "创建中..."
                    : isEdit
                      ? "保存"
                      : "创建"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 删除确认模态框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={deleteModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="xl"
        onOpenChange={handleDeleteModalOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-lg font-bold sm:text-xl">删除隧道</h2>
                <p className="text-xs font-normal leading-5 text-default-500 sm:text-sm">
                  {tunnelDeletePreview?.tunnelName || tunnelToDelete?.name
                    ? `即将删除“${tunnelDeletePreview?.tunnelName || tunnelToDelete?.name}”，删除前会先检查是否有关联规则。`
                    : "删除前会先检查是否有关联规则。"}
                </p>
              </ModalHeader>
              <ModalBody className="space-y-3 sm:space-y-4">
                {deletePreviewLoading ? (
                  <div className="flex items-center gap-3 rounded-xl border border-divider bg-content2/40 px-3 py-5 text-sm text-default-600 sm:px-4 sm:py-6">
                    <Spinner size="sm" />
                    正在检查是否有规则正在使用该隧道...
                  </div>
                ) : deleteHasForwardDependencies ? (
                  <>
                    <Alert
                      color="warning"
                      description={`隧道 \"${tunnelDeletePreview?.tunnelName || tunnelToDelete?.name || ""}\" 当前被 ${deletePreviewForwardCount} 条规则使用。删除前需要先处理这些规则。`}
                      title="发现关联规则"
                      variant="flat"
                    />
                    {(tunnelDeletePreview?.sampleForwards?.length ?? 0) > 0 ? (
                      <div className="space-y-3 rounded-xl border border-divider bg-content2/40 p-3 sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">
                            关联规则预览
                          </h3>
                          <span className="text-xs text-default-500">
                            前{" "}
                            {tunnelDeletePreview?.sampleForwards?.length ?? 0}{" "}
                            条
                          </span>
                        </div>
                        <div className="space-y-2">
                          {tunnelDeletePreview?.sampleForwards?.map(
                            (forward) => (
                              <div
                                key={forward.id}
                                className="rounded-lg border border-divider/70 bg-background/80 px-2.5 py-2 sm:px-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="truncate text-sm font-medium text-foreground">
                                    {forward.name}
                                  </span>
                                  <span className="shrink-0 font-mono text-xs text-default-500">
                                    :{forward.inPort || 0}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-default-500">
                                  用户：
                                  {forward.userName || `#${forward.userId}`}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                        {deletePreviewForwardCount >
                        (tunnelDeletePreview?.sampleForwards?.length ?? 0) ? (
                          <p className="text-xs text-default-500">
                            还有{" "}
                            {deletePreviewForwardCount -
                              (tunnelDeletePreview?.sampleForwards?.length ??
                                0)}{" "}
                            条规则未展开显示。
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <RadioGroup
                      label="处理方式"
                      value={deleteAction}
                      onValueChange={(value) => {
                        const nextAction = value as TunnelDeleteAction;

                        setDeleteAction(nextAction);
                        if (nextAction !== "replace") {
                          setDeleteTargetTunnelId(null);

                          return;
                        }
                        setDeleteTargetTunnelId(
                          deleteReplacementTunnels[0]?.id ?? null,
                        );
                      }}
                    >
                      <Radio value="replace">
                        保留规则，迁移到其他隧道
                        {deleteReplaceUnavailable
                          ? "（当前无可用目标）"
                          : "（推荐）"}
                      </Radio>
                      <Radio value="delete_forwards">
                        直接删除这些关联规则
                      </Radio>
                    </RadioGroup>
                    {deleteReplaceUnavailable ? (
                      <Alert
                        color="warning"
                        description="当前没有其他启用中的隧道可用于承接这些规则，只能删除关联规则后再删除该隧道。"
                        variant="flat"
                      />
                    ) : null}
                    {deleteAction === "replace" && !deleteReplaceUnavailable ? (
                      <div className="space-y-2">
                        <Select
                          label="目标隧道"
                          placeholder="请选择目标隧道"
                          selectedKeys={
                            deleteTargetTunnelId
                              ? [String(deleteTargetTunnelId)]
                              : []
                          }
                          variant="bordered"
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0];

                            setDeleteTargetTunnelId(
                              selected ? Number(selected) : null,
                            );
                          }}
                        >
                          {deleteReplacementTunnels.map((tunnel) => (
                            <SelectItem key={String(tunnel.id)}>
                              {tunnel.name}
                            </SelectItem>
                          ))}
                        </Select>
                        <p className="text-xs text-default-500">
                          关联规则会迁移到这里，当前要删除的隧道不会出现在可选项里。
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Alert
                    color="warning"
                    description={`当前未发现关联规则。确认后将直接删除“${tunnelToDelete?.name || "该隧道"}”，此操作不可撤销。`}
                    title="可以直接删除"
                    variant="flat"
                  />
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="danger"
                  isDisabled={
                    deletePreviewLoading ||
                    (deleteHasForwardDependencies &&
                      deleteAction === "replace" &&
                      (!deleteTargetTunnelId || deleteReplaceUnavailable))
                  }
                  isLoading={deleteLoading}
                  onPress={confirmDelete}
                >
                  {deleteLoading ? "删除中..." : deleteConfirmLabel}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 诊断结果模态框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={diagnosisModalOpen}
        placement="center"
        scrollBehavior="outside"
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
                <h2 className="text-xl font-bold">隧道诊断结果</h2>
                {currentDiagnosisTunnel && (
                  <div className="flex items-center gap-2">
                    <span className="text-small text-default-500">
                      {currentDiagnosisTunnel.name}
                    </span>
                    <Chip
                      color={
                        currentDiagnosisTunnel.type === 1
                          ? "primary"
                          : "secondary"
                      }
                      size="sm"
                      variant="flat"
                    >
                      {currentDiagnosisTunnel.type === 1
                        ? "端口转发"
                        : "隧道转发"}
                    </Chip>
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
                        <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary-500/10 text-primary-600 dark:text-primary-400">
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
                          entry: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1,
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
                              <table className="w-full text-sm">
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
                                    const quality = getDiagnosisQualityDisplay(
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
                                                {result.description}
                                              </div>
                                              <div className="text-xs text-default-500 truncate">
                                                {result.actualTarget ? `${result.actualTarget}:${result.targetPort}` : `${result.targetIp}:${result.targetPort}`}
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          <div
                                            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium ${isDiagnosing ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : isSuccess ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                          >
                                            {isDiagnosing
                                              ? "诊断中"
                                              : isSuccess
                                                ? "成功"
                                                : "失败"}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {isSuccess ? (
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
                                          {isSuccess ? (
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
                                          {isSuccess && quality ? (
                                            <div
                                              className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${quality.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : quality.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
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
                          );
                        };

                        return (
                          <>
                            {/* 入口测试 */}
                            {renderTableSection(
                              "🚪 入口测试",
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
                          </>
                        );
                      })()}
                    </div>
                    {/* 移动端卡片展示 */}
                    <div className="md:hidden space-y-3">
                      {(() => {
                        // 使用后端返回的 chainType 和 inx 字段进行分组
                        const groupedResults = {
                          entry: diagnosisResult.results.filter(
                            (r) => r.fromChainType === 1,
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
                                const quality = getDiagnosisQualityDisplay(
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
                                          {result.description}
                                        </div>
                                        <div className="text-xs text-default-500 mt-0.5 break-all">
                                          {result.actualTarget ? `${result.actualTarget}:${result.targetPort}` : `${result.targetIp}:${result.targetPort}`}
                                        </div>
                                      </div>
                                      <div
                                        className={`flex-shrink-0 inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium ${isDiagnosing ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : isSuccess ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                      >
                                        {isDiagnosing
                                          ? "诊断中"
                                          : isSuccess
                                            ? "成功"
                                            : "失败"}
                                      </div>
                                    </div>
                                    {isSuccess ? (
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
                                                className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${quality.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : quality.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
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
                            {/* 入口测试 */}
                            {renderCardSection(
                              "🚪 入口测试",
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
                {currentDiagnosisTunnel && (
                  <Button
                    color="primary"
                    isLoading={diagnosisLoading}
                    onPress={() => handleDiagnose(currentDiagnosisTunnel)}
                  >
                    重新诊断
                  </Button>
                )}
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
        isOpen={batchDeleteModalOpen}
        onOpenChange={handleBatchDeleteModalOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-lg font-bold sm:text-xl">批量删除隧道</h2>
                <p className="text-xs font-normal leading-5 text-default-500 sm:text-sm">
                  即将删除这 {selectedTunnelIdList.length}{" "}
                  条隧道，删除前会先检查是否有关联规则。
                </p>
              </ModalHeader>
              <ModalBody className="space-y-3 sm:space-y-4">
                {batchDeletePreviewLoading ? (
                  <div className="flex items-center gap-3 rounded-xl border border-divider bg-content2/40 px-3 py-5 text-sm text-default-600 sm:px-4 sm:py-6">
                    <Spinner size="sm" />
                    正在检查选中隧道是否有关联规则...
                  </div>
                ) : batchDeleteHasForwardDependencies ? (
                  <>
                    <Alert
                      color="warning"
                      description={`已选 ${selectedTunnelIdList.length} 条隧道，其中 ${batchDeleteDependentTunnelCount} 条仍被规则使用，共 ${batchDeleteTotalForwardCount} 条规则待处理。${batchDeleteDirectDeleteTunnelCount > 0 ? `其余 ${batchDeleteDirectDeleteTunnelCount} 条会直接删除。` : ""}`}
                      title="发现关联规则"
                      variant="flat"
                    />
                    <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-divider bg-content2/40 p-3 sm:max-h-72 sm:p-4">
                      {batchDeleteDependentItems.map((item) => (
                        <div
                          key={item.tunnelId}
                          className="rounded-lg border border-divider/70 bg-background/80 p-2.5 sm:p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {item.tunnelName}
                              </p>
                              <p className="mt-1 text-xs text-default-500">
                                {item.forwardCount} 条规则依赖
                              </p>
                            </div>
                            <div className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-warning-500/10 text-warning-600 dark:text-warning-400">
                              有关联
                            </div>
                          </div>
                          {item.sampleForwards.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {item.sampleForwards.map((forward) => (
                                <div
                                  key={forward.id}
                                  className="rounded-md bg-content1/70 px-2.5 py-2 sm:px-3"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="truncate text-xs font-medium text-foreground">
                                      {forward.name}
                                    </span>
                                    <span className="shrink-0 font-mono text-[11px] text-default-500">
                                      :{forward.inPort || 0}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-default-500">
                                    用户：
                                    {forward.userName || `#${forward.userId}`}
                                  </p>
                                </div>
                              ))}
                              {item.forwardCount >
                              item.sampleForwards.length ? (
                                <p className="text-[11px] text-default-500">
                                  还有{" "}
                                  {item.forwardCount -
                                    item.sampleForwards.length}{" "}
                                  条规则未展开显示。
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <RadioGroup
                      label="处理方式"
                      value={batchDeleteAction}
                      onValueChange={(value) => {
                        const nextAction = value as TunnelDeleteAction;

                        setBatchDeleteAction(nextAction);
                        if (nextAction !== "replace") {
                          setBatchDeleteTargetTunnelId(null);

                          return;
                        }
                        setBatchDeleteTargetTunnelId(
                          batchDeleteReplacementTunnels[0]?.id ?? null,
                        );
                      }}
                    >
                      <Radio value="replace">
                        保留规则，统一迁移到其他隧道
                        {batchDeleteReplaceUnavailable
                          ? "（当前无可用目标）"
                          : "（推荐）"}
                      </Radio>
                      <Radio value="delete_forwards">
                        直接删除这些关联规则
                      </Radio>
                    </RadioGroup>
                    {batchDeleteReplaceUnavailable ? (
                      <Alert
                        color="warning"
                        description="当前没有可承接这些规则的启用隧道，只能删除关联规则后再删除所选隧道。"
                        variant="flat"
                      />
                    ) : null}
                    {batchDeleteAction === "replace" &&
                    !batchDeleteReplaceUnavailable ? (
                      <div className="space-y-2">
                        <Select
                          label="目标隧道"
                          placeholder="请选择目标隧道"
                          selectedKeys={
                            batchDeleteTargetTunnelId
                              ? [String(batchDeleteTargetTunnelId)]
                              : []
                          }
                          variant="bordered"
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0];

                            setBatchDeleteTargetTunnelId(
                              selected ? Number(selected) : null,
                            );
                          }}
                        >
                          {batchDeleteReplacementTunnels.map((tunnel) => (
                            <SelectItem key={String(tunnel.id)}>
                              {tunnel.name}
                            </SelectItem>
                          ))}
                        </Select>
                        <p className="text-xs text-default-500">
                          所有关联规则都会迁移到这里，删除列表中的隧道不会出现在可选项里。
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Alert
                    color="warning"
                    description={`已选 ${selectedTunnelIdList.length} 条隧道，当前未发现关联规则。确认后将直接删除这些隧道，此操作不可撤销。`}
                    title="可以直接删除"
                    variant="flat"
                  />
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="danger"
                  isDisabled={
                    batchDeletePreviewLoading ||
                    (batchDeleteHasForwardDependencies &&
                      batchDeleteAction === "replace" &&
                      (!batchDeleteTargetTunnelId ||
                        batchDeleteReplaceUnavailable))
                  }
                  isLoading={batchLoading}
                  onPress={handleBatchDelete}
                >
                  {batchLoading ? "删除中..." : batchDeleteConfirmLabel}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      {/* 分组管理组件 */}
      <TunnelGroupManager
        isOpen={groupManagerOpen}
        onGroupChange={() => {
          // 分组变化时，同时刷新分组和隧道列表
          refreshTunnelList(false);
        }}
        onOpenChange={setGroupManagerOpen}
      />
      <BatchActionResultModal
        failures={batchResultModal.failures}
        isOpen={batchResultModal.open}
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
