import type { UserQuotaHistoryItem, UserRenewalLogItem } from "@/api/types";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
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
import { Play, StopCircle } from "lucide-react";

import { timestampToCalendarDate, calendarDateToTimestamp } from "@/utils/date";
import { SearchBar } from "@/components/search-bar";
import {
  AnimatedPage,
  StaggerList,
  StaggerItem,
} from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@/shadcn-bridge/heroui/modal";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { RadioGroup, Radio } from "@/shadcn-bridge/heroui/radio";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { DatePicker } from "@/shadcn-bridge/heroui/date-picker";
import { DatePresets } from "@/shadcn-bridge/heroui/date-presets";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import { Alert } from "@/shadcn-bridge/heroui/alert";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  User,
  UserGroup,
  UserTunnel,
  TunnelAssignItem,
  Tunnel,
  SpeedLimit,
  Pagination as PaginationType,
} from "@/types";
import {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getTunnelList,
  batchAssignUserTunnel,
  getUserTunnelList,
  removeUserTunnel,
  updateUserTunnel,
  getSpeedLimitList,
  resetUserFlow,
  getUserGroupList,
  listAutoBuyTrafficPackages,
  getMonitorPermissionList,
  assignMonitorPermission,
  removeMonitorPermission,
  getUserGroups,
  batchDeleteUsers,
  batchResetUserFlow,
  updateUserOrder,
  getUserQuotaHistory,
  deleteUserQuotaHistory,
  getUserRenewalLogs,
  deleteUserRenewalLog,
  batchUpdateUserTunnelStatus,
  getConfigByName,
  updateConfig,
} from "@/api";
import { EditIcon, DeleteIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { PageLoadingState } from "@/components/page-state";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { removeItemsById, replaceItemById } from "@/utils/list-state";

// 扩展 User 类型，添加流量历史相关字段
type UserWithHistory = User & {
  quotaHistory?: UserQuotaHistoryItem[];
  showHistory?: boolean;
};
// 工具函数
const formatFlow = (value: number, unit: string = "bytes"): string => {
  if (unit === "gb") {
    return `${value} GB`;
  } else {
    if (value === 0) return "0 B";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
    if (value < 1024 * 1024 * 1024)
      return `${(value / (1024 * 1024)).toFixed(2)} MB`;

    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
};
const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};
const getExpireStatus = (expTime: number) => {
  const now = Date.now();

  if (expTime < now) {
    return { color: "danger" as const, text: "已过期" };
  }
  const diffDays = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) {
    return { color: "warning" as const, text: `${diffDays}天后过期` };
  }

  return { color: "success" as const, text: "启用" };
};
// 获取用户状态（根据status字段）
const getUserStatus = (user: User) => {
  if (user.status === 1) {
    return { color: "success" as const, text: "启用" };
  } else {
    return { color: "danger" as const, text: "禁用" };
  }
};
const calculateUserTotalUsedFlow = (user: User): number => {
  return (user.inFlow || 0) + (user.outFlow || 0);
};
const calculateTunnelUsedFlow = (tunnel: UserTunnel): number => {
  const inFlow = tunnel.inFlow || 0;
  const outFlow = tunnel.outFlow || 0;

  // 后端已按计费类型处理流量，前端直接使用入站+出站总和
  return inFlow + outFlow;
};
const USER_SEARCH_DEBOUNCE_MS = 250;
const USER_VIEW_MODE_KEY = "user_view_mode";
const normalizeUserItem = (item: Partial<User>): UserWithHistory => {
  return {
    id: Number(item.id ?? 0),
    name: item.name,
    user: String(item.user ?? ""),
    status: Number(item.status ?? 0),
    flow: Number(item.flow ?? 0),
    num: Number(item.num ?? 0),
    expTime: item.expTime,
    flowResetTime: item.flowResetTime ?? 0,
    createdTime: item.createdTime,
    inFlow: Number(item.inFlow ?? 0),
    outFlow: Number(item.outFlow ?? 0),
    dailyQuotaGB: Number(item.dailyQuotaGB ?? 0),
    monthlyQuotaGB: Number(item.monthlyQuotaGB ?? 0),
    dailyUsedBytes: Number(item.dailyUsedBytes ?? 0),
    monthlyUsedBytes: Number(item.monthlyUsedBytes ?? 0),
    disabledByQuota: Number(item.disabledByQuota ?? 0),
    quotaDisabledAt: Number(item.quotaDisabledAt ?? 0),
    renewalAmount: Number(((item.renewalAmount ?? 0) / 100).toFixed(2)),
    balance: Number(((item.balance ?? 0) / 100).toFixed(2)),
    autoRenew: Number(item.autoRenew ?? 0),
    autoBuyTraffic: Number(item.autoBuyTraffic ?? 0),
    buyTrafficAmount: Number(item.buyTrafficAmount ?? 0),
    buyTrafficPrice: Number(item.buyTrafficPrice ?? 0),
    autoBuyTrafficPackageId: Number(item.autoBuyTrafficPackageId ?? 0),
    autoBuyTrafficThreshold: Number(
      (item as any).autoBuyTrafficThreshold ?? 10,
    ),
    baseFlow: Number(item.baseFlow ?? 0),
    quotaHistory: [],
    showHistory: false,
  } as UserWithHistory;
};
const normalizeUserTunnelItem = (item: Partial<UserTunnel>): UserTunnel => {
  return {
    id: Number(item.id ?? 0),
    userId: Number(item.userId ?? 0),
    tunnelId: Number(item.tunnelId ?? 0),
    tunnelName: String(item.tunnelName ?? ""),
    status: Number(item.status ?? 0),
    flow: Number(item.flow ?? 0),
    num: Number(item.num ?? 0),
    expTime: Number(item.expTime ?? 0),
    flowResetTime: Number(item.flowResetTime ?? 0),
    speedId: item.speedId ?? null,
    speedLimitName: item.speedLimitName,
    inFlow: Number(item.inFlow ?? 0),
    outFlow: Number(item.outFlow ?? 0),
    tunnelFlow: item.tunnelFlow,
  };
};

export default function UserPage() {
  // 视图模式状态
  const [viewMode, setViewMode] = useState<"card" | "list">(() => {
    const stored = localStorage.getItem(USER_VIEW_MODE_KEY);

    return stored === "list" || stored === "card" ? stored : "card";
  });
  // 列表模式选中行
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  // 状态管理
  const [users, setUsers] = useState<UserWithHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useLocalStorageState(
    "user-search-keyword",
    "",
  );
  const activeFilterCount = searchKeyword.trim() ? 1 : 0;
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [pagination, setPagination] = useState<PaginationType>({
    current: 1,
    size: 10,
    total: 0,
  });
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用户表单相关状态
  const {
    isOpen: isUserModalOpen,
    onOpen: onUserModalOpen,
    onClose: onUserModalClose,
  } = useDisclosure();
  const [isEdit, setIsEdit] = useState(false);
  const [userForm, setUserForm] = useState<{
    id?: number;
    user: string;
    name: string;
    pwd: string;
    status: number;
    flow: number;
    dailyQuotaGB: number;
    monthlyQuotaGB: number;
    num: number;
    expTime: Date | null;
    flowResetTime: number;
    groupIds: number[];
    renewalAmount: number;
    balance: number;
    autoRenew: number;
    autoBuyTraffic: number;
    buyTrafficAmount: number;
    buyTrafficPrice: number;
    autoBuyTrafficPackageId: number;
    autoBuyTrafficThreshold: number;
    autoBuyTrafficPackageType: "package" | "custom";
  }>({
    user: "",
    name: "",
    pwd: "",
    status: 1,
    flow: 0,
    dailyQuotaGB: 0,
    monthlyQuotaGB: 0,
    num: 0,
    expTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    flowResetTime: 0,
    groupIds: [],
    renewalAmount: 0,
    balance: 0,
    autoRenew: 0,
    autoBuyTraffic: 0,
    buyTrafficAmount: 0,
    buyTrafficPrice: 0,
    autoBuyTrafficPackageId: 0,
    autoBuyTrafficThreshold: 10,
    autoBuyTrafficPackageType: "custom",
  });
  const [flowInput, setFlowInput] = useState("");
  const [numInput, setNumInput] = useState("");
  const [userFormLoading, setUserFormLoading] = useState(false);
  const [autoBuyPackages, setAutoBuyPackages] = useState<
    { id: number; name: string; trafficLimit: number; price: number }[]
  >([]);
  const loadAutoBuyPackages = useCallback(async () => {
    try {
      const res = await listAutoBuyTrafficPackages();

      if (res.code === 0 && Array.isArray(res.data)) {
        setAutoBuyPackages(
          res.data.map((p: any) => ({
            id: p.id,
            name: p.name,
            trafficLimit: p.trafficLimit,
            price: p.price,
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);
  const editingUser = useMemo(
    () =>
      userForm.id
        ? users.find((item) => item.id === userForm.id) || null
        : null,
    [userForm.id, users],
  );
  // 隧道权限管理相关状态
  const {
    isOpen: isTunnelModalOpen,
    onOpen: onTunnelModalOpen,
    onClose: onTunnelModalClose,
  } = useDisclosure();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // 监控权限弹窗状态
  const {
    isOpen: isMonitorModalOpen,
    onOpen: onMonitorModalOpen,
    onClose: onMonitorModalClose,
  } = useDisclosure();
  const [monitorModalUser, setMonitorModalUser] = useState<User | null>(null);
  const [monitorModalValue, setMonitorModalValue] = useState<string>("0");
  const [isRenewalLogModalOpen, setIsRenewalLogModalOpen] = useState(false);
  const [selectedRenewalLogUser, setSelectedRenewalLogUser] =
    useState<User | null>(null);
  const [renewalLogs, setRenewalLogs] = useState<UserRenewalLogItem[]>([]);
  const [renewalLogLoading, setRenewalLogLoading] = useState(false);
  const [renewalLogToDelete, setRenewalLogToDelete] = useState<number | null>(
    null,
  );
  const [regOpen, setRegOpen] = useState(true);
  const [regLoading, setRegLoading] = useState(false);
  // --- 监控权限相关状态 (来自 user 新) ---
  // Map<userId, fullAccess> where 0=scoped, 1=fullAccess; absent = no permission
  const [monitorPermissionLevelMap, setMonitorPermissionLevelMap] = useState<
    Map<number, number>
  >(new Map());
  const [, setMonitorPermissionLoading] = useState(false);
  const [monitorPermissionMutatingUserId, setMonitorPermissionMutatingUserId] =
    useState<number | null>(null);
  const loadMonitorPermissions = useCallback(async () => {
    setMonitorPermissionLoading(true);
    try {
      const response = await getMonitorPermissionList();

      if (response.code === 0) {
        const m = new Map<number, number>();

        if (Array.isArray(response.data)) {
          response.data.forEach((item: any) => {
            const id = Number(item?.userId ?? 0);
            const fa = Number(item?.fullAccess ?? 0);

            if (id > 0) m.set(id, fa === 1 ? 1 : 0);
          });
        }
        setMonitorPermissionLevelMap(m);
      }
    } catch {
    } finally {
      setMonitorPermissionLoading(false);
    }
  }, []);
  const setUserMonitorPermission = useCallback(
    async (userId: number, level: number) => {
      if (userId <= 0 || monitorPermissionMutatingUserId === userId) return;
      const prevLevel = monitorPermissionLevelMap.has(userId)
        ? monitorPermissionLevelMap.get(userId) === 1
          ? 2
          : 1
        : 0;

      if (prevLevel === level) return;
      setMonitorPermissionMutatingUserId(userId);
      setMonitorPermissionLevelMap((prev) => {
        const next = new Map(prev);

        if (level === 0) {
          next.delete(userId);
        } else {
          next.set(userId, level === 2 ? 1 : 0);
        }

        return next;
      });
      try {
        let response;

        if (level === 0) {
          response = await removeMonitorPermission(userId);
        } else {
          response = await assignMonitorPermission(
            userId,
            level === 2 ? 1 : undefined,
          );
        }
        if (response.code === 0) {
          toast.success(
            level === 0
              ? "已撤销监控"
              : level === 2
                ? "已授权全开监控"
                : "已授权监控（同步）",
          );
        } else {
          throw new Error();
        }
      } catch {
        setMonitorPermissionLevelMap((prev) => {
          const next = new Map(prev);

          if (prevLevel === 0) {
            next.delete(userId);
          } else {
            next.set(userId, prevLevel === 2 ? 1 : 0);
          }

          return next;
        });
        toast.error("操作失败");
      } finally {
        setMonitorPermissionMutatingUserId(null);
      }
    },
    [monitorPermissionMutatingUserId, monitorPermissionLevelMap],
  );
  const [userTunnels, setUserTunnels] = useState<UserTunnel[]>([]);
  const [tunnelListLoading, setTunnelListLoading] = useState(false);
  // 分配新隧道权限相关状态
  const [assignLoading, setAssignLoading] = useState(false);
  const [isTunnelListExpanded, setIsTunnelListExpanded] = useState(false);
  const [batchTunnelSelections, setBatchTunnelSelections] = useState<
    Map<number, number | null>
  >(new Map());
  // 编辑隧道权限相关状态
  const {
    isOpen: isEditTunnelModalOpen,
    onOpen: onEditTunnelModalOpen,
    onClose: onEditTunnelModalClose,
  } = useDisclosure();
  const [editTunnelForm, setEditTunnelForm] = useState<UserTunnel | null>(null);
  const [editTunnelLoading, setEditTunnelLoading] = useState(false);
  // 删除确认相关状态
  const {
    isOpen: isDeleteModalOpen,
    onOpen: onDeleteModalOpen,
    onClose: onDeleteModalClose,
  } = useDisclosure();
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  // 删除隧道权限确认相关状态
  const {
    isOpen: isDeleteTunnelModalOpen,
    onOpen: onDeleteTunnelModalOpen,
    onClose: onDeleteTunnelModalClose,
  } = useDisclosure();
  const [tunnelToDelete, setTunnelToDelete] = useState<UserTunnel | null>(null);
  // --- 批量删除已有隧道权限状态 ---
  const {
    isOpen: isBatchDeleteTunnelModalOpen,
    onOpen: onBatchDeleteTunnelModalOpen,
    onClose: onBatchDeleteTunnelModalClose,
  } = useDisclosure();
  const [selectedUserTunnelIds, setSelectedUserTunnelIds] = useState<
    Set<number>
  >(new Set());
  const [batchDeleteTunnelLoading, setBatchDeleteTunnelLoading] =
    useState(false);
  // 批量更新状态相关状态
  const [batchUpdateStatusLoading, setBatchUpdateStatusLoading] = useState({
    enable: false,
    disable: false,
  });
  // 归零流量确认相关状态
  const {
    isOpen: isResetFlowModalOpen,
    onOpen: onResetFlowModalOpen,
    onClose: onResetFlowModalClose,
  } = useDisclosure();
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [resetFlowLoading, setResetFlowLoading] = useState(false);
  // 归零隧道流量确认相关状态
  const {
    isOpen: isResetTunnelFlowModalOpen,
    onOpen: onResetTunnelFlowModalOpen,
    onClose: onResetTunnelFlowModalClose,
  } = useDisclosure();
  const [tunnelToReset, setTunnelToReset] = useState<UserTunnel | null>(null);
  const [resetTunnelFlowLoading, setResetTunnelFlowLoading] = useState(false);
  // 批量模式相关状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(
    new Set(),
  );
  const [batchOperationLoading, setBatchOperationLoading] = useState({
    delete: false,
    reset: false,
    monitor: false,
  });
  // 拖拽排序相关状态
  const [sortableUserIds, setSortableUserIds] = useState<number[]>([]);
  const [userOrder, setUserOrder] = useLocalStorageState<number[]>(
    "flox-user-order",
    [],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // 批量删除确认相关状态
  const {
    isOpen: isBatchDeleteModalOpen,
    onOpen: onBatchDeleteModalOpen,
    onClose: onBatchDeleteModalClose,
  } = useDisclosure();
  const [batchDeleteUserList, setBatchDeleteUserList] = useState<User[]>([]);
  // 批量归零确认相关状态
  const {
    isOpen: isBatchResetModalOpen,
    onOpen: onBatchResetModalOpen,
    onClose: onBatchResetModalClose,
  } = useDisclosure();
  const [batchResetUserList, setBatchResetUserList] = useState<User[]>([]);
  // 其他数据
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [speedLimits, setSpeedLimits] = useState<SpeedLimit[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const noLimitSpeedLimitIds = useMemo(() => {
    return new Set(
      speedLimits
        .filter((speedLimit) => speedLimit.name.trim() === "不限速")
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
  // 视图模式切换
  const handleViewModeToggle = useCallback((mode: "card" | "list") => {
    setViewMode(mode);
    localStorage.setItem(USER_VIEW_MODE_KEY, mode);
    setSelectedUserIds(new Set());
  }, []);
  const handleRegToggle = async (enabled: boolean) => {
    setRegLoading(true);
    try {
      const res = await updateConfig(
        "registration_enabled",
        enabled ? "true" : "false",
      );

      if (res.code === 0) {
        setRegOpen(enabled);
        try {
          localStorage.setItem(
            "vite_config_registration_enabled",
            enabled ? "true" : "false",
          );
        } catch { }
        window.dispatchEvent(new CustomEvent("configUpdated"));
        toast.success(enabled ? "注册已开启" : "注册已关闭");
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setRegLoading(false);
    }
  };
  // 复制到剪贴板
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
        textArea.select();
        textArea.setSelectionRange(0, 99999);

        try {
          document.execCommand("copy");
          toast.success(`${label}已复制到剪贴板`);
        } catch {
          toast.error("复制失败，请手动选择文本复制");
        }

        targetContainer.removeChild(textArea);
      }
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };
  // 全选/取消全选
  const handleSelectAll = useCallback(
    (isSelected: boolean) => {
      if (isSelected) {
        const newSelected = new Set(users.map((u) => u.id));

        setSelectedUserIds(newSelected);
        if (newSelected.size > 0 && !batchMode) {
          setBatchMode(true);
        }
      } else {
        setSelectedUserIds(new Set());
        if (batchMode) {
          setBatchMode(false);
        }
      }
    },
    [users, batchMode],
  );
  // 单个选择/取消选择
  const toggleUserSelection = useCallback(
    (userId: number) => {
      setSelectedUserIds((prev) => {
        const next = new Set(prev);

        if (next.has(userId)) {
          next.delete(userId);
        } else {
          next.add(userId);
        }
        if (next.size > 0 && !batchMode) {
          setBatchMode(true);
        }
        if (next.size === 0 && batchMode) {
          setBatchMode(false);
        }

        return next;
      });
    },
    [batchMode],
  );
  // 数据加载函数
  const loadUsers = useCallback(
    async (keywordOverride?: string, showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        const keyword = keywordOverride ?? searchKeyword;
        const response = await getAllUsers({
          current: pagination.current,
          size: pagination.size,
          keyword,
        });

        if (response.code === 0) {
          const nextUsers = Array.isArray(response.data)
            ? response.data.map((item) => normalizeUserItem(item))
            : [];

          setUsers(nextUsers);
          setPagination((prev) => ({ ...prev, total: nextUsers.length }));
        } else {
          toast.error(response.msg || "获取用户列表失败");
        }
      } catch {
        toast.error("获取用户列表失败");
      } finally {
        if (showLoading) setLoading(false); // 👈 3. 对应解除 loading
      }
    },
    [pagination.current, pagination.size],
  );

  // 初始化 sortableUserIds
  useEffect(() => {
    if (users.length > 0) {
      if (userOrder && userOrder.length > 0) {
        const orderedIds = users
          .map((u) => u.id)
          .filter((id) => userOrder.includes(id));
        const remainingIds = users
          .map((u) => u.id)
          .filter((id) => !userOrder.includes(id));

        // 新用户（未排序的）在前，已排序的用户在后
        setSortableUserIds([
          ...remainingIds,
          ...userOrder.filter((id) => orderedIds.includes(id)),
        ]);
      } else {
        setSortableUserIds(users.map((u) => u.id));
      }
    }
  }, [users, userOrder]);

  // 排序后的用户列表（用于渲染）
  const displayUsers = useMemo(() => {
    if (!sortableUserIds || sortableUserIds.length === 0) {
      return users;
    }
    const userMap = new Map(users.map((u) => [u.id, u]));

    return sortableUserIds
      .map((id) => userMap.get(id))
      .filter((u): u is User => u !== undefined);
  }, [users, sortableUserIds]);

  // 拖拽排序处理
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over) return;

      setSortableUserIds((prevOrder) => {
        const oldIndex = prevOrder.findIndex((id) => id === active.id);
        const newIndex = prevOrder.findIndex((id) => id === over.id);

        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          return prevOrder;
        }

        const newOrder = arrayMove(prevOrder, oldIndex, newIndex);

        // 保存到本地存储
        setUserOrder(newOrder);

        // 同步到后端
        updateUserOrder(
          newOrder.map((id, index) => ({ id, inx: index })),
        ).catch(() => {
          toast.error("保存排序失败");
          setSortableUserIds(prevOrder);
        });

        return newOrder;
      });
    },
    [setUserOrder],
  );

  const loadTunnels = useCallback(async () => {
    try {
      const response = await getTunnelList();

      if (response.code === 0) {
        setTunnels(Array.isArray(response.data) ? response.data : []);
      }
    } catch { }
  }, []);
  const loadSpeedLimits = useCallback(async () => {
    try {
      const response = await getSpeedLimitList();

      if (response.code === 0) {
        const speedLimitList = Array.isArray(response.data)
          ? response.data.map((item) => ({
            ...item,
            uploadSpeed: item.uploadSpeed ?? item.speed ?? 0,
            downloadSpeed: item.downloadSpeed ?? item.speed ?? 0,
          }))
          : [];

        setSpeedLimits(speedLimitList);
      }
    } catch { }
  }, []);
  const loadUserGroups = useCallback(async () => {
    try {
      const response = await getUserGroupList();

      if (response.code === 0) {
        setUserGroups(Array.isArray(response.data) ? response.data : []);
      }
    } catch { }
  }, []);
  const loadUserTunnels = useCallback(async (userId: number) => {
    setTunnelListLoading(true);
    try {
      const response = await getUserTunnelList({ userId });

      if (response.code === 0) {
        setUserTunnels(
          Array.isArray(response.data)
            ? response.data.map((item) => normalizeUserTunnelItem(item))
            : [],
        );
      } else {
        toast.error(response.msg || "获取隧道权限列表失败");
      }
    } catch {
      toast.error("获取隧道权限列表失败");
    } finally {
      setTunnelListLoading(false);
    }
  }, []);

  // 生命周期
  useEffect(() => {
    void loadTunnels();
    void loadSpeedLimits();
    void loadUserGroups();
    void loadMonitorPermissions();
  }, [loadSpeedLimits, loadTunnels, loadUserGroups]);
  useEffect(() => {
    void loadUsers();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "autoBuyConfigUpdated") void loadUsers();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") void loadUsers();
    };

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisible);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUsers(undefined, false);
    }, 10000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisible);
      window.clearInterval(interval);
    };
  }, [loadUsers]);
  useEffect(() => {
    const loadReg = () => {
      getConfigByName("registration_enabled")
        .then((res) => {
          if (res.code === 0 && res.data) {
            const v = res.data.value;

            setRegOpen(v === "1" || v === "true");
          }
        })
        .catch(() => { });
    };

    loadReg();
    window.addEventListener("configUpdated", loadReg);

    return () => window.removeEventListener("configUpdated", loadReg);
  }, []);
  usePullToRefresh(loadUsers);
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      setPagination((prev) => {
        if (prev.current === 1) {
          void loadUsers(searchKeyword);

          return prev;
        }

        return { ...prev, current: 1 };
      });
    }, USER_SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [loadUsers, searchKeyword]);
  // 用户管理操作
  const handleAdd = () => {
    setIsEdit(false);
    setFlowInput("");
    setNumInput("");
    setUserForm({
      name: "",
      user: "",
      pwd: "",
      status: 1,
      flow: 0,
      dailyQuotaGB: 0,
      monthlyQuotaGB: 0,
      num: 0,
      expTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      flowResetTime: 0,
      groupIds: [],
      renewalAmount: 0,
      balance: 0,
      autoRenew: 0,
      autoBuyTraffic: 0,
      buyTrafficAmount: 0,
      buyTrafficPrice: 0,
      autoBuyTrafficPackageId: 0,
      autoBuyTrafficThreshold: 10,
      autoBuyTrafficPackageType: "custom",
    });
    onUserModalOpen();
  };

  // 流量历史弹窗状态
  const {
    isOpen: isHistoryModalOpen,
    onOpen: onHistoryModalOpen,
    onClose: onHistoryModalClose,
  } = useDisclosure();
  const [historyModalUser, setHistoryModalUser] =
    useState<UserWithHistory | null>(null);

  // 删除历史记录确认弹窗状态
  const {
    isOpen: isDeleteConfirmOpen,
    onOpen: onDeleteConfirmOpen,
    onClose: onDeleteConfirmClose,
  } = useDisclosure();
  const [historyToDelete, setHistoryToDelete] = useState<number | null>(null);

  const handleDeleteHistory = useCallback(async () => {
    if (!historyToDelete || !historyModalUser) return;
    try {
      const res = await deleteUserQuotaHistory(historyToDelete);

      if (res.code === 0) {
        toast.success("删除成功");
        // 重新获取最新列表
        const refreshRes = await getUserQuotaHistory(historyModalUser.id, 50);

        if (refreshRes.code === 0) {
          const updatedHistory = refreshRes.data || [];

          setUsers((prev) =>
            prev.map((u) =>
              u.id === historyModalUser.id
                ? { ...u, quotaHistory: updatedHistory }
                : u,
            ),
          );
          setHistoryModalUser({
            ...historyModalUser,
            quotaHistory: updatedHistory,
          });
        }
        onDeleteConfirmClose();
        setHistoryToDelete(null);
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  }, [historyToDelete, historyModalUser, onDeleteConfirmClose]);

  const openHistoryModal = useCallback(
    async (user: UserWithHistory) => {
      // 如果没有历史数据，先加载
      if (!user.quotaHistory || user.quotaHistory.length === 0) {
        try {
          const res = await getUserQuotaHistory(user.id, 50);

          if (res.code === 0) {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === user.id ? { ...u, quotaHistory: res.data } : u,
              ),
            );
            setHistoryModalUser({ ...user, quotaHistory: res.data });
            onHistoryModalOpen();
          }
        } catch (error) {
          toast.error("加载流量历史失败");
        }
      } else {
        setHistoryModalUser(user);
        onHistoryModalOpen();
      }
    },
    [onHistoryModalOpen],
  );

  const handleEdit = async (user: User) => {
    setIsEdit(true);
    let currentGroupIds: number[] = [];

    try {
      const groupRes = await getUserGroups(user.id);

      if (groupRes.code === 0) {
        currentGroupIds = groupRes.data || [];
      }
    } catch { }
    setFlowInput(String(user.flow));
    setNumInput(String(user.num));
    setUserForm({
      id: user.id,
      name: user.name || "",
      user: user.user,
      pwd: "",
      status: user.status,
      flow: user.flow,
      dailyQuotaGB: user.dailyQuotaGB ?? 0,
      monthlyQuotaGB: user.monthlyQuotaGB ?? 0,
      num: user.num,
      expTime: user.expTime ? new Date(user.expTime) : null,
      flowResetTime: user.flowResetTime ?? 0,
      groupIds: currentGroupIds,
      renewalAmount: user.renewalAmount ?? 0,
      balance: user.balance ?? 0,
      autoRenew: user.autoRenew ?? 0,
      autoBuyTraffic: user.autoBuyTraffic ?? 0,
      buyTrafficAmount: Number((user as any).buyTrafficAmount ?? 0),
      buyTrafficPrice: Number((user as any).buyTrafficPrice ?? 0),
      autoBuyTrafficPackageId: Number(
        (user as any).autoBuyTrafficPackageId ?? 0,
      ),
      autoBuyTrafficThreshold: Number(
        (user as any).autoBuyTrafficThreshold ?? 10,
      ),
      autoBuyTrafficPackageType:
        ((user as any).autoBuyTrafficPackageId ?? 0) > 0 ? "package" : "custom",
    });
    if (((user as any).autoBuyTrafficPackageId ?? 0) > 0) {
      loadAutoBuyPackages();
    }
    onUserModalOpen();
  };
  const handleDelete = (user: User) => {
    setUserToDelete(user);
    onDeleteModalOpen();
  };
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    try {
      const response = await deleteUser(userToDelete.id);

      if (response.code === 0) {
        toast.success("删除成功");
        onDeleteModalClose();
        setUsers((prev) => removeItemsById(prev, [userToDelete.id]));
        setPagination((prev) => ({
          ...prev,
          total: Math.max(prev.total - 1, 0),
        }));
        setUserToDelete(null);
        if (currentUser?.id === userToDelete.id) {
          setCurrentUser(null);
          setUserTunnels([]);
        }
      } else {
        toast.error(response.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };
  const handleSubmitUser = async () => {
    if (!userForm.user || (!userForm.pwd && !isEdit)) {
      toast.error("请填写完整信息");

      return;
    }
    setUserFormLoading(true);
    try {
      const submitData: any = {
        ...userForm,
        balance: Math.round(userForm.balance * 100),
        renewalAmount: Math.round(userForm.renewalAmount * 100),
        expTime: userForm.expTime?.getTime() ?? 0,
        groupIds: userForm.groupIds ?? [],
      };

      if (isEdit && !submitData.pwd) {
        delete submitData.pwd;
      }
      const response = isEdit
        ? await updateUser(submitData)
        : await createUser(submitData);

      if (response.code === 0) {
        toast.success(isEdit ? "更新成功" : "创建成功");
        onUserModalClose();
        const responseUser = normalizeUserItem((response as any).data || {});

        if (
          isEdit &&
          responseUser.id > 0 &&
          pagination.current === 1 &&
          !searchKeyword.trim()
        ) {
          setUsers((prev) => replaceItemById(prev, responseUser));
        } else if (
          !isEdit &&
          responseUser.id > 0 &&
          pagination.current === 1 &&
          !searchKeyword.trim()
        ) {
          setUsers((prev) => [responseUser, ...prev]);
          setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
        } else {
          await loadUsers(undefined, false);
        }
      } else {
        toast.error(response.msg || (isEdit ? "更新失败" : "创建失败"));
      }
    } catch {
      toast.error(isEdit ? "更新失败" : "创建失败");
    } finally {
      setUserFormLoading(false);
    }
  };
  // 隧道权限管理操作
  const handleManageTunnels = (user: User) => {
    setCurrentUser(user);
    setBatchTunnelSelections(new Map());
    setSelectedUserTunnelIds(new Set());
    onTunnelModalOpen();
    loadUserTunnels(user.id);
  };
  // 打开监控权限弹窗
  const handleOpenMonitorModal = (user: User) => {
    setMonitorModalUser(user);
    const level = monitorPermissionLevelMap.has(user.id)
      ? monitorPermissionLevelMap.get(user.id) === 1
        ? "2"
        : "1"
      : "0";

    setMonitorModalValue(level);
    onMonitorModalOpen();
  };
  const handleSaveMonitorPermission = useCallback(async () => {
    if (!monitorModalUser) return;
    const prevLevel = monitorPermissionLevelMap.has(monitorModalUser.id)
      ? monitorPermissionLevelMap.get(monitorModalUser.id) === 1
        ? 2
        : 1
      : 0;
    const newLevel = Number(monitorModalValue);

    if (prevLevel === newLevel) {
      onMonitorModalClose();

      return;
    }
    await setUserMonitorPermission(monitorModalUser.id, newLevel);
    onMonitorModalClose();
  }, [
    monitorModalUser,
    monitorModalValue,
    monitorPermissionLevelMap,
    setUserMonitorPermission,
    onMonitorModalClose,
  ]);
  const handleOpenRenewalLogModal = async (user: User) => {
    setSelectedRenewalLogUser(user);
    setIsRenewalLogModalOpen(true);
    setRenewalLogLoading(true);
    setRenewalLogs([]);

    try {
      const res = await getUserRenewalLogs(user.id, 50);

      if (res.code === 0) {
        setRenewalLogs(res.data || []);
      }
    } catch (error) {
      console.error("获取续费日志失败:", error);
      toast.error("获取续费日志失败");
    } finally {
      setRenewalLogLoading(false);
    }
  };

  const handleDeleteRenewalLog = async (id: number) => {
    try {
      const res = await deleteUserRenewalLog(id);

      if (res.code === 0) {
        toast.success("删除成功");
        if (selectedRenewalLogUser) {
          try {
            const refreshRes = await getUserRenewalLogs(selectedRenewalLogUser.id, 50);

            if (refreshRes.code === 0) {
              setRenewalLogs(refreshRes.data || []);
            }
          } catch { }
        }
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };

  const handleBatchAssignTunnel = async () => {
    if (batchTunnelSelections.size === 0 || !currentUser) {
      toast.error("请选择至少一个隧道");

      return;
    }
    setAssignLoading(true);
    try {
      let speedLimitAutoCleared = false;
      const tunnelsToAssign: TunnelAssignItem[] = Array.from(
        batchTunnelSelections.entries(),
      ).map(([tunnelId, speedId]) => ({
        tunnelId,
        speedId: (() => {
          const cleared = normalizeSpeedId(speedId);

          if (isMissingSpeedLimit(speedId)) {
            speedLimitAutoCleared = true;
          }

          return cleared;
        })(),
      }));
      const response = await batchAssignUserTunnel({
        userId: currentUser.id,
        tunnels: tunnelsToAssign,
      });

      if (response.code === 0) {
        if (speedLimitAutoCleared) {
          toast("所选限速规则不存在，已自动清除为不限速", {
            icon: "⚠️",
            duration: 5000,
          });
        }
        toast.success(response.msg || "分配成功");
        setBatchTunnelSelections(new Map());
        setIsTunnelListExpanded(false);
        await loadUserTunnels(currentUser.id);
      } else {
        toast.error(response.msg || "分配失败");
      }
    } catch {
      toast.error("分配失败");
    } finally {
      setAssignLoading(false);
    }
  };
  const handleEditTunnel = (userTunnel: UserTunnel) => {
    setEditTunnelForm({
      ...userTunnel,
      speedId: normalizeSpeedId(userTunnel.speedId),
      expTime: userTunnel.expTime,
    });
    onEditTunnelModalOpen();
  };
  const handleUpdateTunnel = async () => {
    if (!editTunnelForm) return;
    setEditTunnelLoading(true);
    try {
      const speedLimitAutoCleared = isMissingSpeedLimit(editTunnelForm.speedId);
      const response = await updateUserTunnel({
        id: editTunnelForm.id,
        flow: editTunnelForm.flow,
        num: editTunnelForm.num,
        expTime: editTunnelForm.expTime,
        flowResetTime: editTunnelForm.flowResetTime,
        speedId: normalizeSpeedId(editTunnelForm.speedId),
        status: editTunnelForm.status,
      });

      if (response.code === 0) {
        if (speedLimitAutoCleared) {
          toast("所选限速规则不存在，已自动清除为不限速", {
            icon: "⚠️",
            duration: 5000,
          });
        }
        toast.success("更新成功");
        onEditTunnelModalClose();
        if (currentUser) {
          const nextTunnel = normalizeUserTunnelItem({
            ...editTunnelForm,
            speedId: normalizeSpeedId(editTunnelForm.speedId),
            speedLimitName:
              normalizeSpeedId(editTunnelForm.speedId) !== null
                ? speedLimits.find(
                  (speedLimit) =>
                    speedLimit.id ===
                    normalizeSpeedId(editTunnelForm.speedId),
                )?.name
                : undefined,
          });

          setUserTunnels((prev) => replaceItemById(prev, nextTunnel));
        }
      } else {
        toast.error(response.msg || "更新失败");
      }
    } catch {
      toast.error("更新失败");
    } finally {
      setEditTunnelLoading(false);
    }
  };
  const handleRemoveTunnel = (userTunnel: UserTunnel) => {
    setTunnelToDelete(userTunnel);
    onDeleteTunnelModalOpen();
  };
  const handleConfirmRemoveTunnel = async () => {
    if (!tunnelToDelete) return;
    try {
      const response = await removeUserTunnel({ id: tunnelToDelete.id });

      if (response.code === 0) {
        toast.success("删除成功");
        if (currentUser) {
          setUserTunnels((prev) => removeItemsById(prev, [tunnelToDelete.id]));
        }
        onDeleteTunnelModalClose();
        setTunnelToDelete(null);
      } else {
        toast.error(response.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };
  // 勾选/取消勾选单个权限
  const toggleUserTunnelSelection = (id: number) => {
    setSelectedUserTunnelIds((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };
  // 全选/取消全选
  const handleSelectAllUserTunnels = (isSelected: boolean) => {
    if (isSelected) {
      setSelectedUserTunnelIds(new Set(userTunnels.map((t) => t.id)));
    } else {
      setSelectedUserTunnelIds(new Set());
    }
  };
  // 确认批量删除
  const handleConfirmBatchRemoveTunnel = async () => {
    if (selectedUserTunnelIds.size === 0) return;
    setBatchDeleteTunnelLoading(true);
    try {
      // 组装并发删除请求
      const promises = Array.from(selectedUserTunnelIds).map((id) =>
        removeUserTunnel({ id }),
      );
      const results = await Promise.all(promises);
      const successCount = results.filter((res) => res.code === 0).length;
      const failedCount = results.length - successCount;

      if (successCount > 0) {
        toast.success(`成功删除 ${successCount} 个隧道权限`);
        if (currentUser) {
          setUserTunnels((prev) =>
            prev.filter((t) => !selectedUserTunnelIds.has(t.id)),
          );
        }
        setSelectedUserTunnelIds(new Set());
        onBatchDeleteTunnelModalClose();
      }
      if (failedCount > 0) {
        toast.error(`${failedCount} 个权限删除失败`);
      }
    } catch (error) {
      toast.error("批量删除发生异常");
    } finally {
      setBatchDeleteTunnelLoading(false);
    }
  };
  // 批量更新状态
  const handleBatchUpdateStatus = async (status: number) => {
    if (selectedUserTunnelIds.size === 0) return;

    setBatchUpdateStatusLoading(
      status === 1
        ? { enable: true, disable: false }
        : { enable: false, disable: true },
    );

    try {
      const ids = Array.from(selectedUserTunnelIds);
      const response = await batchUpdateUserTunnelStatus({ ids, status });

      if (response.code === 0) {
        const { successCount, failedCount } = response.data as {
          successCount: number;
          failedCount: number;
        };

        if (successCount > 0) {
          toast.success(
            `成功${status === 1 ? "启用" : "禁用"} ${successCount} 个隧道`,
          );
          // 更新本地状态
          setUserTunnels((prev) =>
            prev.map((t) =>
              selectedUserTunnelIds.has(t.id) ? { ...t, status } : t,
            ),
          );
        }
        if (failedCount > 0) {
          toast.error(`${failedCount} 个隧道操作失败`);
        }

        setSelectedUserTunnelIds(new Set());
      } else {
        toast.error(response.msg || "操作失败");
      }
    } catch (error) {
      toast.error("批量操作发生异常");
    } finally {
      setBatchUpdateStatusLoading({ enable: false, disable: false });
    }
  };
  // 归零流量相关函数
  const handleResetFlow = (user: User) => {
    setUserToReset(user);
    onResetFlowModalOpen();
  };
  const handleConfirmResetFlow = async () => {
    if (!userToReset) return;
    setResetFlowLoading(true);
    try {
      const response = await resetUserFlow({
        id: userToReset.id,
        type: 1, // 1表示归零用户流量
      });

      if (response.code === 0) {
        toast.success("流量归零成功");
        onResetFlowModalClose();
        const targetUserId = userToReset.id;

        setUsers((prev) =>
          prev.map((user) =>
            user.id === targetUserId
              ? { ...user, inFlow: 0, outFlow: 0 }
              : user,
          ),
        );

        try {
          const historyRes = await getUserQuotaHistory(targetUserId, 50);

          if (historyRes.code === 0) {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === targetUserId
                  ? { ...u, quotaHistory: historyRes.data }
                  : u,
              ),
            );
            if (historyModalUser && historyModalUser.id === targetUserId) {
              setHistoryModalUser({
                ...historyModalUser,
                quotaHistory: historyRes.data,
              });
            }
          }
        } catch { }

        setUserToReset(null);
      } else {
        toast.error(response.msg || "归零失败");
      }
    } catch {
      toast.error("归零失败");
    } finally {
      setResetFlowLoading(false);
    }
  };
  // 隧道流量归零相关函数
  const handleResetTunnelFlow = (userTunnel: UserTunnel) => {
    setTunnelToReset(userTunnel);
    onResetTunnelFlowModalOpen();
  };
  // 单个隧道状态切换
  const handleSingleToggleStatus = async (
    userTunnel: UserTunnel,
    status: number,
  ) => {
    try {
      const response = await updateUserTunnel({
        id: userTunnel.id,
        status: status,
      });

      if (response.code === 0) {
        toast.success(
          `已${status === 1 ? "启用" : "禁用"}隧道 "${userTunnel.tunnelName}"`,
        );
        setUserTunnels((prev) =>
          prev.map((t) => (t.id === userTunnel.id ? { ...t, status } : t)),
        );
      } else {
        toast.error(response.msg || "操作失败");
      }
    } catch (error) {
      toast.error("操作失败");
    }
  };
  const handleConfirmResetTunnelFlow = async () => {
    if (!tunnelToReset) return;
    setResetTunnelFlowLoading(true);
    try {
      const response = await resetUserFlow({
        id: tunnelToReset.id,
        type: 2, // 2 表示归零隧道流量
      });

      if (response.code === 0) {
        toast.success("隧道流量归零成功");
        onResetTunnelFlowModalClose();
        const targetTunnelId = tunnelToReset.id;
        const targetUserId = tunnelToReset.userId;

        setUserTunnels((prev) =>
          prev.map((userTunnel) =>
            userTunnel.id === targetTunnelId
              ? { ...userTunnel, inFlow: 0, outFlow: 0 }
              : userTunnel,
          ),
        );

        try {
          const historyRes = await getUserQuotaHistory(targetUserId, 50);

          if (historyRes.code === 0) {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === targetUserId
                  ? { ...u, quotaHistory: historyRes.data }
                  : u,
              ),
            );
            if (historyModalUser && historyModalUser.id === targetUserId) {
              setHistoryModalUser({
                ...historyModalUser,
                quotaHistory: historyRes.data,
              });
            }
          }
        } catch { }

        setTunnelToReset(null);
      } else {
        toast.error(response.msg || "归零失败");
      }
    } catch {
      toast.error("归零失败");
    } finally {
      setResetTunnelFlowLoading(false);
    }
  };
  // 批量操作函数

  const handleBatchResetFlow = () => {
    const usersToReset = users.filter((u) => selectedUserIds.has(u.id));

    setBatchResetUserList(usersToReset);
    onBatchResetModalOpen();
  };

  const handleConfirmBatchResetFlow = async () => {
    setBatchOperationLoading((prev) => ({ ...prev, reset: true }));
    try {
      const response = await batchResetUserFlow(Array.from(selectedUserIds));

      if (response.code === 0) {
        const successCount =
          (response.data as any)?.successCount || selectedUserIds.size;

        toast.success(`成功归零 ${successCount} 个用户流量`);
        await loadUsers(undefined, false);
        setSelectedUserIds(new Set());
        onBatchResetModalClose();
      } else {
        toast.error(response.msg || "归零失败");
      }
    } catch {
      toast.error("归零失败");
    } finally {
      setBatchOperationLoading((prev) => ({ ...prev, reset: false }));
    }
  };

  const handleBatchDelete = () => {
    const usersToDelete = users.filter((u) => selectedUserIds.has(u.id));

    setBatchDeleteUserList(usersToDelete);
    onBatchDeleteModalOpen();
  };

  const handleConfirmBatchDelete = async () => {
    setBatchOperationLoading((prev) => ({ ...prev, delete: true }));
    try {
      const response = await batchDeleteUsers(Array.from(selectedUserIds));

      if (response.code === 0) {
        const successCount =
          (response.data as any)?.successCount || selectedUserIds.size;
        const failCount = (response.data as any)?.failCount || 0;

        if (failCount === 0) {
          toast.success(`成功删除 ${successCount} 个用户`);
        } else {
          toast.success(
            `删除完成：成功 ${successCount} 个，失败 ${failCount} 个`,
          );
        }
        await loadUsers(undefined, false);
        onBatchDeleteModalClose();
        setSelectedUserIds(new Set());
      } else {
        toast.error(response.msg || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    } finally {
      setBatchOperationLoading((prev) => ({ ...prev, delete: false }));
    }
  };
  const editAvailableSpeedLimits = speedLimits.filter(
    (speedLimit) => !noLimitSpeedLimitIds.has(speedLimit.id),
  );
  const getSpeedLimitsForTunnel = (_tunnelId: number) => {
    return speedLimits.filter(
      (speedLimit) => !noLimitSpeedLimitIds.has(speedLimit.id),
    );
  };
  const editTunnelSelectedSpeedId = normalizeSpeedId(editTunnelForm?.speedId);
  const toggleTunnelSelection = (tunnelId: number) => {
    setBatchTunnelSelections((prev) => {
      const newMap = new Map(prev);

      if (newMap.has(tunnelId)) {
        newMap.delete(tunnelId);
      } else {
        newMap.set(tunnelId, null);
      }

      return newMap;
    });
  };
  const updateTunnelSpeedLimit = (tunnelId: number, speedId: number | null) => {
    setBatchTunnelSelections((prev) => {
      const newMap = new Map(prev);

      newMap.set(tunnelId, speedId);

      return newMap;
    });
  };
  const isTunnelAssigned = (tunnelId: number) => {
    return userTunnels.some((ut) => ut.tunnelId === tunnelId);
  };

  // 可排序的表格行组件
  const SortableTableRow = ({
    user,
    children,
  }: {
    user: User;
    children: React.ReactNode;
  }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: user.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <TableRow
        ref={setNodeRef}
        className={`cursor-default transition-colors ${selectedUserIds.has(user.id)
          ? "bg-primary-50 dark:bg-primary-900/30"
          : selectedUserId === user.id
            ? "bg-primary-50 dark:bg-primary-900/30"
            : "hover:bg-default-50/50"
          }`}
        style={style}
        onClick={() => {
          if (!batchMode) {
            setSelectedUserId(user.id);
          }
        }}
      >
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child) && child.type === TableCell) {
            const childAny = child as React.ReactElement<any>;

            // 第二个 TableCell 是拖拽列，添加 listeners
            if (childAny.props.children?.props?.title === "拖拽排序") {
              return React.cloneElement(child, {
                ...childAny.props,
                children: React.cloneElement(childAny.props.children, {
                  ...childAny.props.children.props,
                  ...listeners,
                  ...attributes,
                }),
              });
            }
          }

          return child;
        })}
      </TableRow>
    );
  };

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      {/* 页面头部 */}
      <div className="flex flex-row items-center mb-6 gap-3">
        <div className="flex items-center gap-2">
          <SearchBar
            isVisible={isSearchVisible}
            placeholder="用户名/备注"
            value={searchKeyword}
            onChange={setSearchKeyword}
            onClose={() => {
              setIsSearchVisible(false);
              setSearchKeyword("");
            }}
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
        <div className="flex flex-1 items-center gap-2">
          {batchMode ? (
            <>
              <Button
                color="primary"
                size="sm"
                variant="flat"
                onPress={() => handleSelectAll(true)}
              >
                全选
              </Button>
              <Button
                color="secondary"
                size="sm"
                variant="flat"
                onPress={() => handleSelectAll(false)}
              >
                清空
              </Button>
              <Button
                color="success"
                isDisabled={selectedUserIds.size === 0}
                isLoading={batchOperationLoading.reset}
                size="sm"
                variant="flat"
                onPress={handleBatchResetFlow}
              >
                归零
              </Button>
              <Button
                color="danger"
                isDisabled={selectedUserIds.size === 0}
                isLoading={batchOperationLoading.delete}
                size="sm"
                variant="flat"
                onPress={handleBatchDelete}
              >
                删除
              </Button>
              <span className="text-sm text-danger-400 shrink-0">
                已选 {selectedUserIds.size} 项
              </span>
            </>
          ) : (
            <>
              <Button
                color={viewMode === "card" ? "primary" : "warning"}
                size="sm"
                variant="flat"
                onPress={() =>
                  handleViewModeToggle(viewMode === "card" ? "list" : "card")
                }
              >
                {viewMode === "card" ? "卡片" : "列表"}
              </Button>
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
                  color="success"
                  size="sm"
                  variant="flat"
                  onPress={() => setSearchKeyword("")}
                >
                  归零
                </Button>
              )}
              <div className="ml-auto">
                <Switch
                  className="data-[state=unchecked]:bg-default-300"
                  isDisabled={regLoading}
                  isSelected={regOpen}
                  size="sm"
                  title="开启后允许用户自助注册账号"
                  onValueChange={handleRegToggle}
                >
                  开放注册
                </Switch>
              </div>
            </>
          )}
        </div>
      </div>
      {/* 用户列表 */}
      {loading ? (
        <PageLoadingState message="正在加载..." />
      ) : users.length === 0 ? (
        <Card className="shadow-sm border border-gray-200 dark:border-gray-700 bg-default-50/50">
          <CardBody className="text-center py-20 flex flex-col items-center justify-center min-h-[240px]">
            <h3 className="text-xl font-medium text-foreground tracking-tight mb-2">
              暂无用户数据
            </h3>
            <p className="text-default-500 text-sm max-w-xs mx-auto leading-relaxed">
              还没有任何用户使用，点击新增按钮开始创建
            </p>
          </CardBody>
        </Card>
      ) : viewMode === "list" ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={sortableUserIds}
            strategy={rectSortingStrategy}
          >
            <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
              <Table
                aria-label="用户列表"
                classNames={{
                  th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                  td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                  tr: "hover:bg-default-50/50 transition-colors",
                }}
              >
                <TableHeader>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[60px] text-left">
                    <Checkbox
                      isSelected={
                        users.length > 0 &&
                        selectedUserIds.size === users.length
                      }
                      onValueChange={(checked) => handleSelectAll(checked)}
                    />
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[60px] text-left">
                    排序
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                    用户名
                    <span className="text-xs text-primary-500 font-normal">
                      ^{displayUsers.length}个
                    </span>
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                    备注
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    流量限制
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[150px] text-left">
                    已用流量
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[80px] text-left">
                    规则数
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    归零日期
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                    到期时间
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    续费金额
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    可用余额
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    用户状态
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    自动续费
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    自动购流
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                    监控权限
                  </TableColumn>
                  <TableColumn className="whitespace-nowrap flex-shrink-0 w-[240px] text-left">
                    操作
                  </TableColumn>
                </TableHeader>
                <TableBody>
                  {displayUsers.map((user) => {
                    const userStatus = getUserStatus(user);
                    const expStatus = user.expTime
                      ? getExpireStatus(user.expTime)
                      : null;
                    const usedFlow = calculateUserTotalUsedFlow(user);

                    return (
                      <SortableTableRow key={user.id} user={user}>
                        <TableCell
                          className="whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            isSelected={selectedUserIds.has(user.id)}
                            onValueChange={() => toggleUserSelection(user.id)}
                          />
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className="cursor-grab active:cursor-grabbing p-1 text-default-400 hover:text-default-600 transition-colors inline-flex"
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
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col">
                            <span
                              className="font-medium text-foreground truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                              title={user.user}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(user.user, "用户名");
                              }}
                            >
                              @{user.user}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col">
                            <span
                              className="text-default-500 truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                              title={user.name || user.user}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(user.name || user.user, "备注");
                              }}
                            >
                              {user.name || user.user}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={`text-sm ${user.flow === 99999 ? "text-success font-medium" : "text-foreground"}`}
                          >
                            {user.flow === 99999
                              ? "不限"
                              : formatFlow(user.flow, "gb")}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Button
                              isIconOnly
                              className="w-6 h-6 min-w-6"
                              size="sm"
                              variant="flat"
                              onPress={() =>
                                openHistoryModal(user as UserWithHistory)
                              }
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
                            <span className="text-sm font-medium text-primary">
                              {formatFlow(usedFlow)}
                            </span>
                          </div>
                          {user.flow !== 99999 && (
                            <Progress
                              aria-label="已用流量比例"
                              className="w-24 mt-1"
                              color={
                                usedFlow / (user.flow * 1024 * 1024 * 1024) >
                                  0.8
                                  ? "danger"
                                  : "primary"
                              }
                              size="sm"
                              value={Math.min(
                                (usedFlow / (user.flow * 1024 * 1024 * 1024)) *
                                100,
                                100,
                              )}
                            />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-foreground">
                            {user.num}个
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-default-600">
                            {user.flowResetTime === 0
                              ? "不归零"
                              : `每月${user.flowResetTime}号`}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {user.expTime && user.expTime > 0 ? (
                            <div className="flex items-center gap-1">
                              {expStatus?.color === "success" ? (
                                <span className="text-sm text-primary">
                                  {new Date(user.expTime)
                                    .toLocaleDateString("zh-CN", {
                                      year: "numeric",
                                      month: "2-digit",
                                      day: "2-digit",
                                    })
                                    .replace(/\//g, "-")}
                                </span>
                              ) : (
                                <div
                                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${((expStatus?.color as string) || "") ===
                                    "success"
                                    ? "bg-success-500/10 text-success-600 dark:text-success-400"
                                    : expStatus?.color === "warning"
                                      ? "bg-warning-500/10 text-warning-600 dark:text-warning-400"
                                      : expStatus?.color === "danger"
                                        ? "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                                        : "bg-default-500/10 text-default-500"
                                    }`}
                                >
                                  {expStatus?.text || "未知"}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-default-600">
                              永久
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Button
                              isIconOnly
                              className="w-6 h-6 min-w-6"
                              size="sm"
                              variant="flat"
                              onPress={() => handleOpenRenewalLogModal(user)}
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
                            <span className="text-sm text-default-600">
                              {user.renewalAmount && user.renewalAmount > 0
                                ? `${user.renewalAmount}元`
                                : "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={`text-sm font-medium ${user.balance && user.balance > 0
                              ? "text-success"
                              : "text-default-400"
                              }`}
                          >
                            {user.balance != null ? `${user.balance}元` : "-"}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${userStatus.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                          >
                            {userStatus.text}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${user.autoRenew === 1
                              ? "bg-success-500/10 text-success-600 dark:text-success-400"
                              : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                              }`}
                          >
                            {user.autoRenew === 1 ? "启用" : "禁用"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${user.autoBuyTraffic === 1
                              ? "bg-success-500/10 text-success-600 dark:text-success-400"
                              : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                              }`}
                          >
                            {user.autoBuyTraffic === 1 ? "启用" : "禁用"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${monitorPermissionLevelMap.get(user.id) === 1
                              ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                              : monitorPermissionLevelMap.has(user.id)
                                ? "bg-success-500/10 text-success-600 dark:text-success-400"
                                : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                              }`}
                          >
                            {monitorPermissionLevelMap.has(user.id) ? (
                              <>
                                <EyeIcon className="w-3 h-3" />
                                {monitorPermissionLevelMap.get(user.id) === 1
                                  ? "全开"
                                  : "同步"}
                              </>
                            ) : (
                              <>
                                <EyeOffIcon className="w-3 h-3" />
                                禁用
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex gap-1.5">
                            <Button
                              className="min-h-7 px-2"
                              color="primary"
                              size="sm"
                              variant="flat"
                              onPress={() => handleEdit(user)}
                            >
                              编辑
                            </Button>
                            <Button
                              className="min-h-7 px-2"
                              color="secondary"
                              size="sm"
                              variant="flat"
                              onPress={() => handleManageTunnels(user)}
                            >
                              隧道
                            </Button>
                            <Button
                              className="min-h-7 px-2"
                              color={
                                monitorPermissionLevelMap.has(user.id)
                                  ? "success"
                                  : "default"
                              }
                              size="sm"
                              variant="flat"
                              onPress={() => handleOpenMonitorModal(user)}
                            >
                              监控
                            </Button>
                            <Button
                              className="min-h-7 px-2"
                              color="success"
                              size="sm"
                              variant="flat"
                              onPress={() => handleResetFlow(user)}
                            >
                              归零
                            </Button>
                            <Button
                              className="min-h-7 px-2"
                              color="danger"
                              size="sm"
                              variant="flat"
                              onPress={() => handleDelete(user)}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </SortableTableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
          <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">
              用户数量
            </span>
            <span className="text-xs text-default-500">
              {displayUsers.length} 个用户
            </span>
          </div>
          <div className="p-4">
            <StaggerList className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {displayUsers.map((user) => {
                const userStatus = getUserStatus(user);
                const expStatus = user.expTime
                  ? getExpireStatus(user.expTime)
                  : null;
                const usedFlow = calculateUserTotalUsedFlow(user);

                return (
                  <StaggerItem key={user.id}>
                    <div
                      className={`shadow-sm border border-divider hover:shadow-md transition-shadow duration-200 overflow-hidden h-full rounded-xl cursor-default ${selectedUserIds.has(user.id)
                        ? "bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700"
                        : ""
                        }`}
                    >
                      <Card className="shadow-none border-0">
                        <CardHeader className="pb-2 md:pb-2">
                          <div className="flex items-center justify-between w-full">
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                isSelected={selectedUserIds.has(user.id)}
                                onValueChange={() =>
                                  toggleUserSelection(user.id)
                                }
                              />
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <div
                                className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${userStatus.color === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                              >
                                {userStatus.text}
                              </div>
                              {user.disabledByQuota ? (
                                <div className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-danger-500/10 text-danger-600 dark:text-danger-400">
                                  配额超额
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex justify-between items-center w-full mt-1">
                            <span
                              className="font-medium text-sm text-foreground truncate cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit max-w-full"
                              title={user.user}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(user.user, "用户名");
                              }}
                            >
                              @{user.user}
                            </span>
                            <span
                              className="text-sm text-default-500 truncate ml-2 cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors w-fit"
                              title={user.name || user.user}
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(user.name || user.user, "备注");
                              }}
                            >
                              {user.name || user.user}
                            </span>
                          </div>
                        </CardHeader>
                        <CardBody className="pt-0 pb-3 md:pt-0 md:pb-3">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                已用流量
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-xs text-primary">
                                  {formatFlow(usedFlow)}
                                </span>
                                <Button
                                  isIconOnly
                                  className="w-5 h-5 min-w-5"
                                  size="sm"
                                  variant="flat"
                                  onPress={() => openHistoryModal(user)}
                                >
                                  <svg
                                    aria-hidden="true"
                                    className="w-3 h-3"
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
                              </div>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                到期时间
                              </span>
                              <div className="flex items-center gap-1">
                                {user.expTime && user.expTime > 0 ? (
                                  <>
                                    {expStatus &&
                                      expStatus.color === "success" ? (
                                      <span className="text-xs">
                                        {new Date(user.expTime)
                                          .toLocaleDateString("zh-CN", {
                                            year: "numeric",
                                            month: "2-digit",
                                            day: "2-digit",
                                          })
                                          .replace(/\//g, "-")}
                                      </span>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium ${((expStatus?.color as string) || "default") === "success" ? "bg-success-500/10 text-success-600 dark:text-success-400" : expStatus?.color === "warning" ? "bg-warning-500/10 text-warning-600 dark:text-warning-400" : expStatus?.color === "danger" ? "bg-danger-500/10 text-danger-600 dark:text-danger-400" : "bg-default-500/10 text-default-500"}`}
                                      >
                                        {expStatus?.text || "未知状态"}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-xs text-default-600">
                                    永久
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                续费金额
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-medium text-default-700">
                                  {user.renewalAmount && user.renewalAmount > 0
                                    ? `${user.renewalAmount}元`
                                    : "-"}
                                </span>
                                <Button
                                  isIconOnly
                                  className="w-5 h-5 min-w-5"
                                  size="sm"
                                  variant="flat"
                                  onPress={(e) => {
                                    e?.stopPropagation();
                                    handleOpenRenewalLogModal(user);
                                  }}
                                >
                                  <svg
                                    aria-hidden="true"
                                    className="w-3 h-3"
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
                              </div>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                流量限制
                              </span>
                              <span
                                className={`font-medium text-xs ${user.flow === 99999 ? "text-success" : ""}`}
                              >
                                {user.flow === 99999
                                  ? "不限"
                                  : formatFlow(user.flow, "gb")}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                规则数量
                              </span>
                              <span className="font-medium text-xs">
                                {user.num}个
                              </span>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                可用余额
                              </span>
                              <span
                                className={`text-xs font-medium ${user.balance && user.balance > 0
                                  ? "text-success"
                                  : "text-default-400"
                                  }`}
                              >
                                {user.balance != null
                                  ? `${user.balance}元`
                                  : "-"}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                自动续费
                              </span>
                              <div
                                className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium ${user.autoRenew === 1
                                  ? "bg-success-500/10 text-success-600 dark:text-success-400"
                                  : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                                  }`}
                              >
                                {user.autoRenew === 1 ? "启用" : "禁用"}
                              </div>
                            </div>
                            <div className="flex justify-between text-sm items-center">
                              <span className="text-default-600 text-xs">
                                自动购流
                              </span>
                              <div
                                className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-medium ${user.autoBuyTraffic === 1
                                  ? "bg-success-500/10 text-success-600 dark:text-success-400"
                                  : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                                  }`}
                              >
                                {user.autoBuyTraffic === 1 ? "启用" : "禁用"}
                              </div>
                            </div>
                            <div className="col-span-2 flex justify-between text-sm items-center pt-1.5 border-t border-divider">
                              <span className="text-default-600 text-xs">
                                监控权限
                              </span>
                              <div
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${monitorPermissionLevelMap.get(user.id) === 1
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                  : monitorPermissionLevelMap.has(user.id)
                                    ? "bg-success-500/10 text-success-600 dark:text-success-400"
                                    : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                                  }`}
                              >
                                {monitorPermissionLevelMap.has(user.id) ? (
                                  <>
                                    <EyeIcon className="w-3 h-3" />
                                    {monitorPermissionLevelMap.get(user.id) ===
                                      1
                                      ? "全开"
                                      : "同步"}
                                  </>
                                ) : (
                                  <>
                                    <EyeOffIcon className="w-3 h-3" />
                                    禁用
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1.5 mt-3">
                            <Button
                              className="flex-1 min-h-8"
                              color="primary"
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e?.stopPropagation();
                                handleEdit(user);
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              className="flex-1 min-h-8"
                              color="secondary"
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e?.stopPropagation();
                                handleManageTunnels(user);
                              }}
                            >
                              隧道
                            </Button>
                            <Button
                              className="flex-1 min-h-8"
                              color={
                                monitorPermissionLevelMap.has(user.id)
                                  ? "success"
                                  : "default"
                              }
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e?.stopPropagation();
                                handleOpenMonitorModal(user);
                              }}
                            >
                              监控
                            </Button>
                            <Button
                              className="flex-1 min-h-8"
                              color="success"
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e?.stopPropagation();
                                handleResetFlow(user);
                              }}
                            >
                              归零
                            </Button>
                            <Button
                              className="flex-1 min-h-8"
                              color="danger"
                              size="sm"
                              variant="flat"
                              onPress={(e) => {
                                e?.stopPropagation();
                                handleDelete(user);
                              }}
                            >
                              删除
                            </Button>
                          </div>
                        </CardBody>
                      </Card>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerList>
          </div>
        </div>
      )
      }
      {/* 用户表单弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isUserModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onUserModalClose}
      >
        <ModalContent>
          <ModalHeader>{isEdit ? "编辑用户" : "新增用户"}</ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-2 gap-4">
              <Input
                isRequired
                label="用户名"
                value={userForm.user}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, user: e.target.value }))
                }
              />
              <Input
                isRequired={!isEdit}
                label="密码"
                placeholder={isEdit ? "留空则不修改密码" : "请输入密码"}
                type="password"
                value={userForm.pwd}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, pwd: e.target.value }))
                }
              />
              {/* 👇 用户分组现在移到了这里，位于 grid 容器内 */}
              <Input
                description=" 例如：张三、朋友A"
                label="备注"
                placeholder="选填"
                value={userForm.name || ""}
                onChange={(e) =>
                  setUserForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
              <DatePicker
                showMonthAndYearPickers
                description="新户默认3天有效期"
                label="到期时间"
                value={timestampToCalendarDate(
                  userForm.expTime?.getTime() || null,
                )}
                onChange={(date) => {
                  const jsDate = calendarDateToTimestamp(date) || null;

                  setUserForm((prev) => ({
                    ...prev,
                    expTime: jsDate ? new Date(jsDate) : null,
                  }));
                }}
              >
                <DatePresets
                  onChange={(timestamp) => {
                    setUserForm((prev) => ({
                      ...prev,
                      expTime: timestamp ? new Date(timestamp) : null,
                    }));
                  }}
                />
              </DatePicker>
              <Input
                label="流量限制(GB)"
                max="99999"
                min="0"
                placeholder="选填"
                type="number"
                value={flowInput}
                onChange={(e) => {
                  const raw = e.target.value;

                  setFlowInput(raw);
                  const num =
                    raw === ""
                      ? 0
                      : Math.min(Math.max(Number(raw) || 0, 0), 99999);

                  setUserForm((prev) => ({ ...prev, flow: num }));
                }}
              />
              <Input
                label="规则数量"
                max="99999"
                min="0"
                placeholder="选填"
                type="number"
                value={numInput}
                onChange={(e) => {
                  const raw = e.target.value;

                  setNumInput(raw);
                  const num =
                    raw === ""
                      ? 0
                      : Math.min(Math.max(Number(raw) || 0, 0), 99999);

                  setUserForm((prev) => ({ ...prev, num: num }));
                }}
              />
              {userGroups.length > 0 && (
                <Select
                  label="用户组"
                  placeholder="选择要加入的分组"
                  selectedKeys={new Set((userForm.groupIds ?? []).map(String))}
                  selectionMode="multiple"
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys as Set<string>).map(
                      Number,
                    );

                    setUserForm((prev) => ({ ...prev, groupIds: selected }));
                  }}
                >
                  {userGroups.map((g) => (
                    <SelectItem key={g.id.toString()} textValue={g.name}>
                      {g.name}
                    </SelectItem>
                  ))}
                </Select>
              )}
              <Select
                label="归零日期"
                selectedKeys={[userForm.flowResetTime.toString()]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;

                  setUserForm((prev) => ({
                    ...prev,
                    flowResetTime: Number(value),
                  }));
                }}
              >
                <>
                  <SelectItem key="0" textValue="不归零">
                    不归零
                  </SelectItem>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <SelectItem
                      key={day.toString()}
                      textValue={`每月${day}号-0点`}
                    >
                      每月{day}号-0点
                    </SelectItem>
                  ))}
                </>
              </Select>
            </div>
            {/* 配额状态保持原样 */}
            {isEdit &&
              editingUser &&
              ((editingUser.dailyQuotaGB ?? 0) > 0 ||
                (editingUser.monthlyQuotaGB ?? 0) > 0 ||
                (editingUser.disabledByQuota ?? 0) > 0) && (
                <div className="space-y-3 rounded-xl border border-default-200 bg-default-50/60 p-4">
                  {/* ... 省略内部配额显示代码 ... */}
                </div>
              )}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="续费金额 (元)"
                  min="0"
                  placeholder="选填"
                  step="1"
                  type="number"
                  value={
                    userForm.renewalAmount > 0
                      ? userForm.renewalAmount.toString()
                      : ""
                  }
                  onChange={(e) => {
                    const value = Number(e.target.value);

                    setUserForm((prev) => ({
                      ...prev,
                      renewalAmount: Math.round(value),
                    }));
                  }}
                />
                <Input
                  label="可用余额 (元)"
                  min="0"
                  placeholder="选填"
                  step="1"
                  type="number"
                  value={
                    userForm.balance > 0 ? userForm.balance.toString() : ""
                  }
                  onChange={(e) => {
                    const value = Number(e.target.value);

                    setUserForm((prev) => ({
                      ...prev,
                      balance: Math.round(value),
                    }));
                  }}
                />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-3 mt-3 border-t border-divider">
                <div>
                  <RadioGroup
                    label="自动续费"
                    orientation="horizontal"
                    value={userForm.autoRenew.toString()}
                    onValueChange={(value: string) =>
                      setUserForm((prev) => ({
                        ...prev,
                        autoRenew: Number(value),
                      }))
                    }
                  >
                    <Radio value="1">启用</Radio>
                    <Radio value="0">禁用</Radio>
                  </RadioGroup>
                </div>
                <div>
                  <RadioGroup
                    label="自动购流"
                    orientation="horizontal"
                    value={userForm.autoBuyTraffic.toString()}
                    onValueChange={(value: string) =>
                      setUserForm((prev) => ({
                        ...prev,
                        autoBuyTraffic: Number(value),
                      }))
                    }
                  >
                    <Radio value="1">启用</Radio>
                    <Radio value="0">禁用</Radio>
                  </RadioGroup>
                </div>
                <div>
                  <RadioGroup
                    label="用户状态"
                    orientation="horizontal"
                    value={userForm.status.toString()}
                    onValueChange={(value: string) =>
                      setUserForm((prev) => ({
                        ...prev,
                        status: Number(value),
                      }))
                    }
                  >
                    <Radio value="1">启用</Radio>
                    <Radio value="0">禁用</Radio>
                  </RadioGroup>
                </div>
              </div>
              {userForm.autoBuyTraffic === 1 && (
                <div className="pt-3 mt-3 space-y-3">
                  <RadioGroup
                    label="购买方式"
                    orientation="horizontal"
                    value={userForm.autoBuyTrafficPackageType}
                    onValueChange={(value: string) => {
                      if (value === "package") {
                        loadAutoBuyPackages();
                        setUserForm((prev) => ({
                          ...prev,
                          autoBuyTrafficPackageType: "package",
                          autoBuyTrafficPackageId: 0,
                        }));
                      } else {
                        setUserForm((prev) => ({
                          ...prev,
                          autoBuyTrafficPackageType: "custom",
                          autoBuyTrafficPackageId: 0,
                          buyTrafficAmount: 0,
                          buyTrafficPrice: 0,
                        }));
                      }
                    }}
                  >
                    <Radio value="package">套餐选择</Radio>
                    <Radio value="custom">自定义</Radio>
                  </RadioGroup>
                  {userForm.autoBuyTrafficPackageType === "package" ? (
                    <Select
                      label="自动购流套餐"
                      selectedKeys={[String(userForm.autoBuyTrafficPackageId)]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const val = Array.from(keys)[0] as string;

                        if (val) {
                          setUserForm((prev) => ({
                            ...prev,
                            autoBuyTrafficPackageId: Number(val),
                          }));
                        }
                      }}
                    >
                      {autoBuyPackages.map((p) => (
                        <SelectItem key={String(p.id)}>
                          {p.name} ({p.trafficLimit}GB / ¥
                          {(p.price / 100).toFixed(2)})
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="每次购买量 (GB)"
                        min="0"
                        placeholder="选填"
                        step="1"
                        type="number"
                        value={
                          userForm.buyTrafficAmount > 0
                            ? userForm.buyTrafficAmount.toString()
                            : ""
                        }
                        onChange={(e) => {
                          const value = Number(e.target.value);

                          setUserForm((prev) => ({
                            ...prev,
                            buyTrafficAmount: Math.round(value),
                          }));
                        }}
                      />
                      <Input
                        label="每次购买价格 (元)"
                        min="0"
                        placeholder="选填"
                        step="1"
                        type="number"
                        value={
                          userForm.buyTrafficPrice > 0
                            ? userForm.buyTrafficPrice.toString()
                            : ""
                        }
                        onChange={(e) => {
                          const value = Number(e.target.value);

                          setUserForm((prev) => ({
                            ...prev,
                            buyTrafficPrice: Math.round(value),
                          }));
                        }}
                      />
                    </div>
                  )}
                  <Input
                    label="触发阈值 (GB)"
                    min="1"
                    placeholder="剩余流量低于此值时触发"
                    step="1"
                    type="number"
                    value={
                      userForm.autoBuyTrafficThreshold > 0
                        ? userForm.autoBuyTrafficThreshold.toString()
                        : ""
                    }
                    onChange={(e) => {
                      const value = Number(e.target.value);

                      setUserForm((prev) => ({
                        ...prev,
                        autoBuyTrafficThreshold: Math.max(0, value),
                      }));
                    }}
                  />
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button onPress={onUserModalClose}>取消</Button>
            <Button
              color="primary"
              isLoading={userFormLoading}
              onPress={handleSubmitUser}
            >
              {isEdit ? "保存" : "创建"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 续费记录日志弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full sm:max-w-5xl rounded-2xl",
        }}
        isOpen={isRenewalLogModalOpen}
        placement="center"
        scrollBehavior="inside"
        size="lg"
        onClose={() => setIsRenewalLogModalOpen(false)}
      >
        <ModalContent>
          <ModalHeader>
            用户 {selectedRenewalLogUser?.user} 的续费记录
          </ModalHeader>
          <ModalBody>
            {renewalLogLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : renewalLogs.length === 0 ? (
              <div className="text-center py-12 text-default-500">
                暂无续费记录
              </div>
            ) : (
              <div className="w-full overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
                <Table
                  aria-label="续费记录"
                  classNames={{
                    th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                    td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                    tr: "hover:bg-default-50/50 transition-colors",
                  }}
                >
                  <TableHeader>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[160px] text-left">
                      续费时间
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                      扣款金额
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                      续费前余额
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                      续费后余额
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[140px] text-left">
                      续费前到期
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[140px] text-left">
                      续费后到期
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                      原因
                    </TableColumn>
                    <TableColumn className="whitespace-nowrap flex-shrink-0 w-[80px] text-left">
                      操作
                    </TableColumn>
                  </TableHeader>
                  <TableBody>
                    {renewalLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">
                          {log.renewalTime
                            ? new Date(log.renewalTime)
                              .toLocaleString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                              .replace(/\//g, "-")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-success font-medium whitespace-nowrap">
                          {(log.renewalAmount / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {(log.balanceBefore / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {(log.balanceAfter / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {log.expTimeBefore
                            ? new Date(log.expTimeBefore)
                              .toLocaleDateString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })
                              .replace(/\//g, "-")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-primary font-medium whitespace-nowrap">
                          {log.expTimeAfter
                            ? new Date(log.expTimeAfter)
                              .toLocaleDateString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              })
                              .replace(/\//g, "-")
                            : "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${log.reason === "自动续费"
                              ? "bg-success-500/10 text-success-600"
                              : "bg-default-500/10 text-default-600"
                              }`}
                          >
                            {log.reason}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            isIconOnly
                            className="bg-danger-50 text-danger-600 hover:bg-danger-100 min-w-7 w-7 h-7"
                            size="sm"
                            variant="flat"
                            onPress={() => setRenewalLogToDelete(log.id)}
                          >
                            <DeleteIcon className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => setIsRenewalLogModalOpen(false)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 续费记录删除确认弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={!!renewalLogToDelete}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={() => setRenewalLogToDelete(null)}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认删除续费记录
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">确定要删除这条续费记录吗？</p>
                <p className="text-small text-default-500 mt-1">
                  此操作不可撤销。
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setRenewalLogToDelete(null)}>
              取消
            </Button>
            <Button
              color="danger"
              onPress={() => {
                if (renewalLogToDelete) {
                  handleDeleteRenewalLog(renewalLogToDelete);
                  setRenewalLogToDelete(null);
                }
              }}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 隧道权限管理弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full sm:max-w-4xl rounded-2xl",
        }}
        isDismissable={false}
        isOpen={isTunnelModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onTunnelModalClose}
      >
        <ModalContent>
          <ModalHeader>管理用户 {currentUser?.user} 的隧道权限</ModalHeader>
          {/* 👇 核心修复 1：ModalBody 必须加 overflow-x-hidden，防止内部表格强行撑大整个弹窗 */}
          <ModalBody className="py-4 overflow-x-hidden">
            <div className="space-y-6 w-full min-w-0">
              {/* 分配新权限部分 */}
              <div className="space-y-3 w-full">
                <h3 className="text-base font-semibold">分配权限</h3>
                <div className="relative w-full">
                  {/* 👇 核心修复 2：分配按钮必须和选择框放在同一行！用 flex-1 min-w-0 压制选择框宽度 */}
                  <div className="flex flex-row items-center gap-2 sm:gap-3 w-full">
                    <div
                      className={`group flex items-center px-3 sm:px-4 h-10 rounded-xl border-2 transition-all cursor-pointer shadow-sm overflow-hidden flex-1 min-w-0 ${isTunnelListExpanded
                        ? "border-primary bg-primary-50/20 ring-4 ring-primary/10"
                        : "border-default-200 bg-default-50 hover:border-primary-300"
                        }`}
                      onClick={() =>
                        setIsTunnelListExpanded(!isTunnelListExpanded)
                      }
                    >
                      <span
                        className={`text-xs sm:text-sm truncate flex-1 pr-1 sm:pr-2 ${batchTunnelSelections.size > 0 ? "text-primary-600 font-bold dark:text-primary-400" : "text-default-400"}`}
                      >
                        {batchTunnelSelections.size > 0
                          ? `已选 ${batchTunnelSelections.size} 项：` +
                          Array.from(batchTunnelSelections.keys())
                            .map(
                              (id) => tunnels.find((t) => t.id === id)?.name,
                            )
                            .filter(Boolean)
                            .join("、")
                          : "请选择隧道（勾选后配置）"}
                      </span>
                      <svg
                        className={`w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-default-400 transition-transform duration-300 ${isTunnelListExpanded ? "rotate-180 text-primary" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M19 9l-7 7-7-7" strokeWidth={2.5} />
                      </svg>
                    </div>
                    {/* 分配按钮归位 */}
                  </div>
                  {/* 列表悬浮层 */}
                  {isTunnelListExpanded && (
                    <div
                      className="absolute top-full left-0 w-full mt-2 overflow-hidden border border-divider rounded-xl sm:rounded-2xl bg-content1 shadow-2xl z-[999] animate-appearance-in"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="max-h-[50vh] sm:max-h-[350px] overflow-auto scrollbar-thin scrollbar-thumb-default-300">
                        <Table
                          aria-label="隧道列表"
                          classNames={{
                            th: "sticky top-0 z-20 bg-default-100/80 backdrop-blur-md text-default-600 font-semibold text-xs sm:text-sm border-b border-divider py-2 sm:py-3 whitespace-nowrap",
                            td: "py-2 sm:py-3 border-b border-divider/50 group-data-[last=true]:border-b-0 whitespace-nowrap",
                            tr: "hover:bg-default-50/50 transition-colors",
                            wrapper:
                              "shadow-none p-0 rounded-none min-w-[450px] sm:min-w-full",
                          }}
                        >
                          <TableHeader>
                            <TableColumn className="w-[40px] sm:w-[50px] text-center">
                              <Checkbox
                                color="primary"
                                isSelected={
                                  tunnels.filter((t) => !isTunnelAssigned(t.id))
                                    .length > 0 &&
                                  batchTunnelSelections.size ===
                                  tunnels.filter(
                                    (t) => !isTunnelAssigned(t.id),
                                  ).length
                                }
                                size="sm"
                                onValueChange={(isSelected) => {
                                  if (isSelected) {
                                    setBatchTunnelSelections((prev) => {
                                      const newMap = new Map(prev);

                                      tunnels.forEach((tunnel) => {
                                        if (!isTunnelAssigned(tunnel.id)) {
                                          newMap.set(
                                            tunnel.id,
                                            newMap.get(tunnel.id) ?? null,
                                          );
                                        }
                                      });

                                      return newMap;
                                    });
                                  } else {
                                    setBatchTunnelSelections(new Map());
                                  }
                                }}
                              />
                            </TableColumn>
                            <TableColumn className="w-[120px] sm:w-[150px]">
                              隧道名称
                            </TableColumn>
                            <TableColumn className="w-[120px] sm:w-[150px]">
                              限速
                            </TableColumn>
                          </TableHeader>
                          <TableBody>
                            {tunnels.map((tunnel) => {
                              const isAssigned = isTunnelAssigned(tunnel.id);
                              const isSelected = batchTunnelSelections.has(
                                tunnel.id,
                              );
                              const tunnelSpeedLimits = getSpeedLimitsForTunnel(
                                tunnel.id,
                              );
                              const currentSpeedId = batchTunnelSelections.get(
                                tunnel.id,
                              );

                              return (
                                <TableRow
                                  key={tunnel.id}
                                  className={`cursor-pointer transition-colors ${isSelected ? "bg-primary-50/60 dark:bg-primary-900/20" : ""} ${isAssigned ? "opacity-50 grayscale bg-default-100/50" : ""}`}
                                >
                                  <TableCell className="text-center">
                                    <Checkbox
                                      color="primary"
                                      isDisabled={isAssigned}
                                      isSelected={isSelected}
                                      size="sm"
                                      onClick={(e) => {
                                        if (isAssigned) return;
                                        e.stopPropagation();
                                        toggleTunnelSelection(tunnel.id);
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className={`text-xs sm:text-sm font-medium ${isSelected ? "text-primary-700 dark:text-primary-400" : "text-default-700"}`}
                                    >
                                      {tunnel.name}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    {isSelected && !isAssigned ? (
                                      <div onClick={(e) => e.stopPropagation()}>
                                        <Select
                                          aria-label="限速选择"
                                          className="w-[100px] sm:w-[120px]"
                                          placeholder="不限速"
                                          selectedKeys={
                                            currentSpeedId
                                              ? [currentSpeedId.toString()]
                                              : []
                                          }
                                          size="sm"
                                          variant="bordered"
                                          onSelectionChange={(keys) => {
                                            const selectedKey =
                                              Array.from(keys)[0];

                                            updateTunnelSpeedLimit(
                                              tunnel.id,
                                              selectedKey
                                                ? Number(selectedKey)
                                                : null,
                                            );
                                          }}
                                        >
                                          {tunnelSpeedLimits.map((sl) => (
                                            <SelectItem
                                              key={sl.id.toString()}
                                              textValue={sl.name}
                                            >
                                              <span className="text-xs sm:text-sm">
                                                {sl.name}
                                              </span>
                                            </SelectItem>
                                          ))}
                                        </Select>
                                      </div>
                                    ) : (
                                      <span className="text-xs sm:text-sm text-default-400">
                                        -
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* 已有权限部分 */}
              <div className="space-y-3 w-full">
                <div className="flex flex-row items-center justify-between gap-2 mt-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground whitespace-nowrap">
                      已有权限
                    </h3>
                    {selectedUserTunnelIds.size > 0 && (
                      <Chip color="primary" size="sm" variant="flat">
                        已选 {selectedUserTunnelIds.size} 个
                      </Chip>
                    )}
                  </div>
                  {selectedUserTunnelIds.size > 0 && (
                    <div className="flex items-center gap-2">
                      <Button
                        className="h-8 text-xs sm:text-sm px-2 sm:px-3"
                        color="success"
                        isLoading={batchUpdateStatusLoading.enable}
                        size="sm"
                        onPress={() => handleBatchUpdateStatus(1)}
                      >
                        启用
                      </Button>
                      <Button
                        className="h-8 text-xs sm:text-sm px-2 sm:px-3"
                        color="warning"
                        isLoading={batchUpdateStatusLoading.disable}
                        size="sm"
                        onPress={() => handleBatchUpdateStatus(2)}
                      >
                        禁用
                      </Button>
                      <Button
                        className="h-8 text-xs sm:text-sm px-2 sm:px-3"
                        color="danger"
                        size="sm"
                        variant="flat"
                        onPress={onBatchDeleteTunnelModalOpen}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </div>
                {/* 👇 核心修复 3：表格的外部父容器必须死死锁住 w-full min-w-0 */}
                <div className="w-full min-w-0 overflow-hidden rounded-xl border border-divider bg-content1 shadow-sm relative">
                  <div className="overflow-x-auto max-h-[350px] sm:max-h-none scrollbar-thin scrollbar-thumb-default-300 w-full">
                    <Table
                      aria-label="用户隧道权限列表"
                      classNames={{
                        th: "sticky top-0 z-20 bg-default-100/90 backdrop-blur text-default-600 font-semibold text-xs sm:text-sm border-b border-divider py-2 sm:py-3 whitespace-nowrap",
                        td: "py-2 sm:py-3 border-b border-divider/50 group-data-[last=true]:border-b-0 whitespace-nowrap",
                        tr: "hover:bg-default-50/50 transition-colors",
                        wrapper:
                          "shadow-none p-0 rounded-none min-w-[700px] sm:min-w-full",
                      }}
                    >
                      <TableHeader>
                        <TableColumn className="w-[40px] sm:w-[50px] text-center">
                          <Checkbox
                            color="primary"
                            isSelected={
                              userTunnels.length > 0 &&
                              selectedUserTunnelIds.size === userTunnels.length
                            }
                            size="sm"
                            onValueChange={handleSelectAllUserTunnels}
                          />
                        </TableColumn>
                        <TableColumn className="w-[120px] sm:w-[150px]">
                          隧道名称
                        </TableColumn>
                        <TableColumn className="w-[140px] sm:w-[160px]">
                          流量统计
                        </TableColumn>
                        <TableColumn className="w-[90px] sm:w-[100px]">
                          限速
                        </TableColumn>
                        <TableColumn className="w-[60px] sm:w-[80px]">
                          状态
                        </TableColumn>
                        <TableColumn className="w-[120px] sm:w-[140px]">
                          操作
                        </TableColumn>
                      </TableHeader>
                      <TableBody
                        emptyContent={
                          <div className="py-8 text-default-400 text-xs sm:text-sm">
                            暂无隧道权限
                          </div>
                        }
                        isLoading={tunnelListLoading}
                        items={userTunnels}
                        loadingContent={<Spinner color="primary" />}
                      >
                        {(userTunnel) => (
                          <TableRow
                            key={userTunnel.id}
                            className={`transition-colors ${selectedUserTunnelIds.has(userTunnel.id) ? "bg-danger-50/50 dark:bg-danger-900/20 hover:bg-danger-50/80" : ""}`}
                          >
                            <TableCell className="text-center">
                              <Checkbox
                                color="danger"
                                isSelected={selectedUserTunnelIds.has(
                                  userTunnel.id,
                                )}
                                size="sm"
                                onValueChange={() =>
                                  toggleUserTunnelSelection(userTunnel.id)
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <span className="font-semibold text-xs sm:text-sm text-default-800">
                                {userTunnel.tunnelName}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-baseline gap-1">
                                <span className="text-danger font-mono font-bold text-xs sm:text-sm">
                                  {formatFlow(
                                    calculateTunnelUsedFlow(userTunnel),
                                  )}
                                </span>
                                <span className="text-default-300 text-xs">
                                  /
                                </span>
                                <span className="text-default-500 font-mono text-xs sm:text-sm">
                                  {formatFlow(userTunnel.flow, "gb")}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs sm:text-sm text-default-600 bg-default-100 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded">
                                {userTunnel.speedLimitName
                                  ? userTunnel.speedLimitName.replace(
                                    /^限速\s*/,
                                    "",
                                  )
                                  : "不限速"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div
                                className={`inline-flex items-center justify-center px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded text-xs sm:text-xs font-medium ${userTunnel.status === 1 ? "bg-success-500/10 text-success-600" : "bg-danger-500/10 text-danger-600"}`}
                              >
                                {userTunnel.status === 1 ? "启用" : "禁用"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 sm:gap-2">
                                {/* 启用/禁用按钮 */}
                                {userTunnel.status === 1 ? (
                                  <Button
                                    isIconOnly
                                    className="bg-warning-50 text-warning-600 hover:bg-warning-100 min-w-7 w-7 h-7 sm:min-w-8 sm:w-8 sm:h-8"
                                    size="sm"
                                    title="禁用"
                                    variant="flat"
                                    onPress={() =>
                                      handleSingleToggleStatus(userTunnel, 2)
                                    }
                                  >
                                    <StopCircle className="w-3.5 h-3.5" />
                                  </Button>
                                ) : (
                                  <Button
                                    isIconOnly
                                    className="bg-success-50 text-success-600 hover:bg-success-100 min-w-7 w-7 h-7 sm:min-w-8 sm:w-8 sm:h-8"
                                    size="sm"
                                    title="启用"
                                    variant="flat"
                                    onPress={() =>
                                      handleSingleToggleStatus(userTunnel, 1)
                                    }
                                  >
                                    <Play className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {/* 编辑按钮 */}
                                <Button
                                  isIconOnly
                                  className="bg-blue-50 text-blue-600 hover:bg-blue-100 min-w-7 w-7 h-7 sm:min-w-8 sm:w-8 sm:h-8"
                                  size="sm"
                                  variant="flat"
                                  onPress={() => handleEditTunnel(userTunnel)}
                                >
                                  <EditIcon className="w-3.5 h-3.5" />
                                </Button>
                                {/* 同步按钮 */}
                                <Button
                                  isIconOnly
                                  className="bg-orange-50 text-orange-600 hover:bg-orange-100 min-w-7 w-7 h-7 sm:min-w-8 sm:w-8 sm:h-8"
                                  size="sm"
                                  variant="flat"
                                  onPress={() =>
                                    handleResetTunnelFlow(userTunnel)
                                  }
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      clipRule="evenodd"
                                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                                      fillRule="evenodd"
                                    />
                                  </svg>
                                </Button>
                                {/* 删除按钮 */}
                                <Button
                                  isIconOnly
                                  className="bg-danger-50 text-danger-600 hover:bg-danger-100 min-w-7 w-7 h-7 sm:min-w-8 sm:w-8 sm:h-8"
                                  size="sm"
                                  variant="flat"
                                  onPress={() => handleRemoveTunnel(userTunnel)}
                                >
                                  <DeleteIcon className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button variant="flat" onPress={onTunnelModalClose}>
              关闭
            </Button>
            <Button
              color="primary"
              isDisabled={batchTunnelSelections.size === 0}
              isLoading={assignLoading}
              onPress={handleBatchAssignTunnel}
            >
              分配
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 监控权限弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full sm:max-w-md rounded-2xl",
        }}
        isOpen={isMonitorModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="sm"
        onClose={onMonitorModalClose}
      >
        <ModalContent>
          <ModalHeader>
            管理用户 {monitorModalUser?.user} 的监控权限
          </ModalHeader>
          <ModalBody>
            <div className="py-4">
              <div className="text-sm font-medium text-foreground mb-3">
                允许访问监控功能
              </div>
              <div className="text-xs text-default-500 mb-4">
                <p className="mb-1">
                  <strong>同步</strong>：用户只能看到已授权隧道的监控数据。
                </p>
                <p>
                  <strong>全开</strong>
                  ：用户可以看到所有监控数据，不受隧道权限限制。
                </p>
              </div>
              <RadioGroup
                orientation="horizontal"
                value={monitorModalValue}
                onValueChange={(value: string) => setMonitorModalValue(value)}
              >
                <Radio value="0">禁用</Radio>
                <Radio value="1">同步</Radio>
                <Radio value="2">全开</Radio>
              </RadioGroup>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end gap-2">
            <Button variant="flat" onPress={onMonitorModalClose}>
              关闭
            </Button>
            <Button
              color="primary"
              isLoading={
                monitorPermissionMutatingUserId === monitorModalUser?.id
              }
              onPress={handleSaveMonitorPermission}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 编辑隧道权限弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isDismissable={false}
        isOpen={isEditTunnelModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onEditTunnelModalClose}
      >
        <ModalContent>
          <ModalHeader>编辑隧道权限 - {editTunnelForm?.tunnelName}</ModalHeader>
          <ModalBody>
            {editTunnelForm && (
              <>
                <Select
                  label="限速规则"
                  placeholder="不限速"
                  selectedKeys={
                    editTunnelSelectedSpeedId !== null
                      ? [editTunnelSelectedSpeedId.toString()]
                      : []
                  }
                  onSelectionChange={(keys) => {
                    const selectedKey = Array.from(keys)[0] as
                      | string
                      | undefined;

                    setEditTunnelForm((prev) =>
                      prev
                        ? {
                          ...prev,
                          speedId: selectedKey ? Number(selectedKey) : null,
                        }
                        : null,
                    );
                  }}
                >
                  {editAvailableSpeedLimits.map((speedLimit) => (
                    <SelectItem
                      key={speedLimit.id.toString()}
                      textValue={speedLimit.name}
                    >
                      {speedLimit.name}
                    </SelectItem>
                  ))}
                </Select>
                <RadioGroup
                  label="状态"
                  orientation="horizontal"
                  value={editTunnelForm.status.toString()}
                  onValueChange={(value: string) =>
                    setEditTunnelForm((prev) =>
                      prev ? { ...prev, status: Number(value) } : null,
                    )
                  }
                >
                  <Radio value="1">启用</Radio>
                  <Radio value="0">禁用</Radio>
                </RadioGroup>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onPress={onEditTunnelModalClose}>取消</Button>
            <Button
              color="primary"
              isLoading={editTunnelLoading}
              onPress={handleUpdateTunnel}
            >
              确定
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 删除确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isDeleteModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onDeleteModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认删除用户
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要删除用户{" "}
                  <span className="font-semibold text-danger">
                    &quot;{userToDelete?.user}&quot;
                  </span>{" "}
                  吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  此操作不可撤销，用户的所有数据将被永久删除。
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteModalClose}>
              取消
            </Button>
            <Button color="danger" onPress={handleConfirmDelete}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 删除隧道权限确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isDeleteTunnelModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onDeleteTunnelModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认删除隧道权限
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要删除用户{" "}
                  <span className="font-semibold">{currentUser?.user}</span>{" "}
                  对隧道{" "}
                  <span className="font-semibold text-danger">
                    &quot;{tunnelToDelete?.tunnelName}&quot;
                  </span>{" "}
                  的权限吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  删除后该用户将无法使用此隧道创建规则，此操作不可撤销。{" "}
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteTunnelModalClose}>
              取消
            </Button>
            <Button color="danger" onPress={handleConfirmRemoveTunnel}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 批量删除隧道权限确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isBatchDeleteTunnelModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onBatchDeleteTunnelModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认批量删除权限
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center shrink-0">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要删除选中的{" "}
                  <span className="font-semibold text-danger">
                    {selectedUserTunnelIds.size}
                  </span>{" "}
                  个隧道权限吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  删除后该用户将无法使用这些隧道创建规则，此操作不可撤销。
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onBatchDeleteTunnelModalClose}>
              取消
            </Button>
            <Button
              color="danger"
              isLoading={batchDeleteTunnelLoading}
              onPress={handleConfirmBatchRemoveTunnel}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 归零流量确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isResetFlowModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onResetFlowModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认归零流量
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-foreground">
                  确定要归零用户{" "}
                  <span className="font-semibold text-warning">
                    &quot;{userToReset?.user}&quot;
                  </span>{" "}
                  的流量吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  该操作只会归零账号流量不会归零隧道权限流量，归零后该用户的上下行流量将归零，此操作不可撤销。
                </p>
                <div className="mt-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-xs">
                  <div className="text-warning-700 dark:text-warning-300">
                    当前流量使用情况：
                  </div>
                  <div className="mt-1 space-y-1">
                    <div className="flex justify-between">
                      <span>上行流量：</span>
                      <span className="font-mono">
                        {userToReset
                          ? formatFlow(userToReset.inFlow || 0)
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>下行流量：</span>
                      <span className="font-mono">
                        {userToReset
                          ? formatFlow(userToReset.outFlow || 0)
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>总计：</span>
                      <span className="font-mono text-warning-700 dark:text-warning-300">
                        {userToReset
                          ? formatFlow(calculateUserTotalUsedFlow(userToReset))
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onResetFlowModalClose}>
              取消
            </Button>
            <Button
              color="success"
              isLoading={resetFlowLoading}
              onPress={handleConfirmResetFlow}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 归零隧道流量确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isResetTunnelFlowModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onResetTunnelFlowModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认归零隧道流量
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-warning-100 rounded-full flex items-center justify-center">
                <svg
                  aria-hidden="true"
                  className="w-6 h-6 text-warning"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    clipRule="evenodd"
                    d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要归零用户{" "}
                  <span className="font-semibold">{currentUser?.user}</span>{" "}
                  对隧道{" "}
                  <span className="font-semibold text-warning">
                    &quot;{tunnelToReset?.tunnelName}&quot;
                  </span>{" "}
                  的流量吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  该操作只会归零隧道权限流量不会归零账号流量，归零后该隧道权限的上下行流量将归零，此操作不可撤销。
                </p>
                <div className="mt-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-xs">
                  <div className="text-warning-700 dark:text-warning-300">
                    当前流量使用情况：
                  </div>
                  <div className="mt-1 space-y-1">
                    <div className="flex justify-between">
                      <span>上行流量：</span>
                      <span className="font-mono">
                        {tunnelToReset
                          ? formatFlow(tunnelToReset.inFlow || 0)
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>下行流量：</span>
                      <span className="font-mono">
                        {tunnelToReset
                          ? formatFlow(tunnelToReset.outFlow || 0)
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>总计：</span>
                      <span className="font-mono text-warning-700 dark:text-warning-300">
                        {tunnelToReset
                          ? formatFlow(calculateTunnelUsedFlow(tunnelToReset))
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onResetTunnelFlowModalClose}>
              取消
            </Button>
            <Button
              color="success"
              isLoading={resetTunnelFlowLoading}
              onPress={handleConfirmResetTunnelFlow}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 批量删除用户确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isBatchDeleteModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onBatchDeleteModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            批量删除用户
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600 mb-3">
              确认要删除以下 {batchDeleteUserList.length}{" "}
              个用户吗？此操作不可恢复。
            </p>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
              {batchDeleteUserList.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 bg-default-50 dark:bg-default-100/10 rounded-lg"
                >
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {user.name || user.user}
                    </span>
                    <span className="text-xs text-default-500 ml-2">
                      @{user.user}
                    </span>
                  </div>
                  <div
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${user.status === 1
                      ? "bg-success-500/10 text-success-600 dark:text-success-400"
                      : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                      }`}
                  >
                    {user.status === 1 ? "启用" : "禁用"}
                  </div>
                </div>
              ))}
            </div>
            <Alert
              className="mt-4"
              color="danger"
              description="删除后将同时删除该用户的所有隧道权限和相关配置"
              title="警告"
              variant="flat"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onBatchDeleteModalClose}>
              取消
            </Button>
            <Button
              color="danger"
              isLoading={batchOperationLoading.delete}
              onPress={handleConfirmBatchDelete}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 批量归零流量确认对话框 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl",
        }}
        isOpen={isBatchResetModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onClose={onBatchResetModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            批量归零流量
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600 mb-3">
              确认要归零以下 {batchResetUserList.length} 个用户的流量吗？
            </p>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
              {batchResetUserList.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 bg-default-50 dark:bg-default-100/10 rounded-lg"
                >
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {user.name || user.user}
                    </span>
                    <span className="text-xs text-default-500 ml-2">
                      @{user.user}
                    </span>
                  </div>
                  <div
                    className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${user.status === 1
                      ? "bg-success-500/10 text-success-600 dark:text-success-400"
                      : "bg-danger-500/10 text-danger-600 dark:text-danger-400"
                      }`}
                  >
                    {user.status === 1 ? "启用" : "禁用"}
                  </div>
                </div>
              ))}
            </div>
            <Alert
              className="mt-4"
              color="warning"
              description="归零后当前周期流量将清零，历史流量记录不受影响"
              title="提示"
              variant="flat"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onBatchResetModalClose}>
              取消
            </Button>
            <Button
              color="success"
              isLoading={batchOperationLoading.reset}
              onPress={handleConfirmBatchResetFlow}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* 流量归零日志弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[500px] rounded-xl",
        }}
        isOpen={isHistoryModalOpen}
        placement="center"
        onClose={onHistoryModalClose}
      >
        <ModalContent>
          <ModalHeader className="flex items-center justify-between">
            <span className="text-base font-semibold">
              流量归零日志 - {historyModalUser?.name || historyModalUser?.user}
            </span>
            <Button
              isIconOnly
              className="w-8 h-8 min-w-8"
              size="sm"
              variant="flat"
              onPress={onHistoryModalClose}
            >
              <svg
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </ModalHeader>
          <ModalBody className="py-6">
            {historyModalUser &&
              historyModalUser.quotaHistory &&
              historyModalUser.quotaHistory.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {historyModalUser.quotaHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-default-50/50 dark:bg-default-100/20 rounded-lg"
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <span className="text-sm font-medium text-default-600">
                        {item.resetReason === "管理员手动归零"
                          ? "admin"
                          : "系统自动"}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-default-500">
                          {formatDate(item.resetTime)}
                        </span>
                        <Button
                          isIconOnly
                          className="w-6 h-6 min-w-6 text-danger hover:bg-danger/10"
                          size="sm"
                          variant="flat"
                          onPress={() => {
                            setHistoryToDelete(item.id);
                            onDeleteConfirmOpen();
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
                            ↑{formatFlow(item.inFlowBefore)}
                          </span>
                          <span className="text-success-600 text-sm whitespace-nowrap dark:text-success-400">
                            ↓{formatFlow(item.outFlowBefore)}
                          </span>
                          <span className="text-default-600 text-sm whitespace-nowrap font-medium">
                            总 {formatFlow(item.usedBytes)}
                          </span>
                        </div>
                      </div>
                      {item.resetReason && (
                        <div className="flex items-center justify-between w-full">
                          <span className="text-default-500 text-sm">
                            归零原因
                          </span>
                          <span className="text-red-500 text-sm">
                            {item.resetReason}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-default-400">
                <div className="text-sm">暂无记录</div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onPress={onHistoryModalClose}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除历史记录确认弹窗 */}
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-[400px] rounded-xl",
        }}
        isOpen={isDeleteConfirmOpen}
        placement="center"
        onClose={onDeleteConfirmClose}
      >
        <ModalContent>
          <ModalHeader className="text-base font-semibold">
            确认删除
          </ModalHeader>
          <ModalBody className="py-4">
            <p className="text-sm text-default-600">
              确定要删除这条流量历史记录吗？此操作不可恢复！
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteConfirmClose}>
              取消
            </Button>
            <Button color="danger" onPress={handleDeleteHistory}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage >
  );
}
