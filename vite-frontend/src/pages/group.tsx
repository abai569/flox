import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ChevronDown } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
} from "@/shadcn-bridge/heroui/modal";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/shadcn-bridge/heroui/table";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import {
  assignGroupPermission,
  assignTunnelsToGroup,
  assignUsersToGroup,
  createTunnelGroup,
  createUserGroup,
  deleteTunnelGroup,
  deleteUserGroup,
  getAllUsers,
  getGroupPermissionList,
  getTunnelGroupList,
  getTunnelList,
  getUserGroupList,
  removeGroupPermission,
  updateTunnelGroup,
  updateUserGroup,
} from "@/api";
import { getAdminFlag } from "@/utils/session";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
interface TunnelItem {
  id: number;
  name: string;
}
interface UserItem {
  id: number;
  user: string;
}
interface TunnelGroup {
  id: number;
  name: string;
  status: number;
  tunnelIds: number[];
  tunnelNames: string[];
  createdTime: number;
}
interface UserGroup {
  id: number;
  name: string;
  status: number;
  userIds: number[];
  userNames: string[];
  createdTime: number;
}
interface GroupPermission {
  id: number;
  userGroupId: number;
  userGroupName: string;
  tunnelGroupId: number;
  tunnelGroupName: string;
  createdTime: number;
}
const formatDate = (timestamp?: number): string => {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleString();
};

export default function GroupPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin] = useState(getAdminFlag());
  const [tunnelGroups, setTunnelGroups] = useState<TunnelGroup[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [permissions, setPermissions] = useState<GroupPermission[]>([]);
  const [tunnels, setTunnels] = useState<TunnelItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selectedUserGroupId, setSelectedUserGroupId] = useState<number | null>(
    null,
  );
  const [selectedTunnelGroupId, setSelectedTunnelGroupId] = useState<
    number | null
  >(null);
  const [savingPermission, setSavingPermission] = useState(false);
  const {
    isOpen: tunnelGroupModalOpen,
    onOpen: onTunnelGroupModalOpen,
    onClose: onTunnelGroupModalClose,
    onOpenChange: onTunnelGroupModalChange,
  } = useDisclosure();
  const {
    isOpen: userGroupModalOpen,
    onOpen: onUserGroupModalOpen,
    onClose: onUserGroupModalClose,
    onOpenChange: onUserGroupModalChange,
  } = useDisclosure();
  const {
    isOpen: tunnelAssignModalOpen,
    onOpen: onTunnelAssignModalOpen,
    onClose: onTunnelAssignModalClose,
    onOpenChange: onTunnelAssignModalChange,
  } = useDisclosure();
  const {
    isOpen: userAssignModalOpen,
    onOpen: onUserAssignModalOpen,
    onClose: onUserAssignModalClose,
    onOpenChange: onUserAssignModalChange,
  } = useDisclosure();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    content: string;
    action: () => Promise<void>;
  } | null>(null);
  const [editingTunnelGroup, setEditingTunnelGroup] =
    useState<TunnelGroup | null>(null);
  const [editingUserGroup, setEditingUserGroup] = useState<UserGroup | null>(
    null,
  );
  const [groupForm, setGroupForm, resetGroupDraft] = useLocalStorageState(
    "group-create-draft",
    { name: "", status: "1" },
  );
  const [savingGroup, setSavingGroup] = useState(false);
  const [assignTunnelGroup, setAssignTunnelGroup] =
    useState<TunnelGroup | null>(null);
  const [assignUserGroup, setAssignUserGroup] = useState<UserGroup | null>(
    null,
  );
  const [selectedTunnelKeys, setSelectedTunnelKeys] = useState<Set<string>>(
    new Set(),
  );
  const [selectedUserKeys, setSelectedUserKeys] = useState<Set<string>>(
    new Set(),
  );
  const [savingAssign, setSavingAssign] = useState(false);
  const [expandedTunnelGroups, setExpandedTunnelGroups] = useState<Set<number>>(
    new Set(),
  );
  const [expandedUserGroups, setExpandedUserGroups] = useState<Set<number>>(
    new Set(),
  );
  const tunnelNameMap = useMemo(() => {
    const map = new Map<number, string>();

    tunnels.forEach((item) => {
      map.set(item.id, item.name);
    });

    return map;
  }, [tunnels]);
  const userNameMap = useMemo(() => {
    const map = new Map<number, string>();

    users.forEach((item) => {
      map.set(item.id, item.user);
    });

    return map;
  }, [users]);
  const selectedTunnelSummary = useMemo(() => {
    const value = Array.from(selectedTunnelKeys)
      .map((id) => tunnelNameMap.get(Number(id)) || id)
      .join("、");

    return value || "无";
  }, [selectedTunnelKeys, tunnelNameMap]);
  const selectedUserSummary = useMemo(() => {
    const value = Array.from(selectedUserKeys)
      .map((id) => userNameMap.get(Number(id)) || id)
      .join("、");

    return value || "无";
  }, [selectedUserKeys, userNameMap]);
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tunnelGroupRes, userGroupRes, permissionRes, tunnelRes, userRes] =
        await Promise.all([
          getTunnelGroupList(),
          getUserGroupList(),
          getGroupPermissionList(),
          getTunnelList(),
          getAllUsers(),
        ]);

      if (tunnelGroupRes.code === 0) {
        setTunnelGroups(
          Array.isArray(tunnelGroupRes.data) ? tunnelGroupRes.data : [],
        );
      }
      if (userGroupRes.code === 0) {
        setUserGroups(
          Array.isArray(userGroupRes.data) ? userGroupRes.data : [],
        );
      }
      if (permissionRes.code === 0) {
        setPermissions(
          Array.isArray(permissionRes.data) ? permissionRes.data : [],
        );
      }
      if (tunnelRes.code === 0) {
        setTunnels(Array.isArray(tunnelRes.data) ? tunnelRes.data : []);
      }
      if (userRes.code === 0) {
        setUsers(Array.isArray(userRes.data) ? userRes.data : []);
      }
      if (
        tunnelGroupRes.code !== 0 ||
        userGroupRes.code !== 0 ||
        permissionRes.code !== 0
      ) {
        toast.error("部分分组数据加载失败");
      }
    } catch {
      toast.error("分组数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);
  usePullToRefresh(loadData);
  const openCreateTunnelGroup = () => {
    setEditingTunnelGroup(null);
    onTunnelGroupModalOpen();
  };
  const openEditTunnelGroup = (group: TunnelGroup) => {
    setEditingTunnelGroup(group);
    setGroupForm({ name: group.name, status: String(group.status) });
    onTunnelGroupModalOpen();
  };
  const openCreateUserGroup = () => {
    setEditingUserGroup(null);
    onUserGroupModalOpen();
  };
  const openEditUserGroup = (group: UserGroup) => {
    setEditingUserGroup(group);
    setGroupForm({ name: group.name, status: String(group.status) });
    onUserGroupModalOpen();
  };
  const saveTunnelGroup = async () => {
    if (!groupForm.name.trim()) {
      toast.error("请输入分组名称");

      return;
    }
    setSavingGroup(true);
    try {
      const payload = { name: groupForm.name.trim(), status: Number(groupForm.status) };
      const res = editingTunnelGroup
        ? await updateTunnelGroup({ id: editingTunnelGroup.id, ...payload })
        : await createTunnelGroup(payload);

      if (res.code === 0) {
        toast.success(editingTunnelGroup ? "更新成功" : "创建成功");
        if (!editingTunnelGroup) {
          resetGroupDraft();
        }
        onTunnelGroupModalClose();
        loadData();
      } else {
        toast.error(res.msg || "保存失败");
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingGroup(false);
    }
  };
  const saveUserGroup = async () => {
    if (!groupForm.name.trim()) {
      toast.error("请输入分组名称");

      return;
    }
    setSavingGroup(true);
    try {
      const payload = { name: groupForm.name.trim(), status: Number(groupForm.status) };
      const res = editingUserGroup
        ? await updateUserGroup({ id: editingUserGroup.id, ...payload })
        : await createUserGroup(payload);

      if (res.code === 0) {
        toast.success(editingUserGroup ? "更新成功" : "创建成功");
        if (!editingUserGroup) {
          resetGroupDraft();
        }
        onUserGroupModalClose();
        loadData();
      } else {
        toast.error(res.msg || "保存失败");
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingGroup(false);
    }
  };
  const handleDeleteTunnelGroup = (item: TunnelGroup) => {
    setConfirmConfig({
      title: "确认删除隧道分组",
      content: `确定要删除隧道分组 "${item.name}" 吗？此操作不可撤销。`,
      action: async () => {
        const res = await deleteTunnelGroup(item.id);

        if (res.code === 0) {
          toast.success("删除成功");
          loadData();
        } else {
          toast.error(res.msg || "删除失败");
        }
      },
    });
    setIsConfirmOpen(true);
  };
  const handleDeleteUserGroup = (item: UserGroup) => {
    setConfirmConfig({
      title: "确认删除用户分组",
      content: `确定要删除用户分组 "${item.name}" 吗？此操作不可撤销。`,
      action: async () => {
        const res = await deleteUserGroup(item.id);

        if (res.code === 0) {
          toast.success("删除成功");
          loadData();
        } else {
          toast.error(res.msg || "删除失败");
        }
      },
    });
    setIsConfirmOpen(true);
  };
  const openAssignTunnels = (group: TunnelGroup) => {
    setAssignTunnelGroup(group);
    setSelectedTunnelKeys(new Set(group.tunnelIds.map((id) => String(id))));
    onTunnelAssignModalOpen();
  };
  const openAssignUsers = (group: UserGroup) => {
    setAssignUserGroup(group);
    setSelectedUserKeys(new Set(group.userIds.map((id) => String(id))));
    onUserAssignModalOpen();
  };
  const saveAssignTunnels = async () => {
    if (!assignTunnelGroup) return;
    setSavingAssign(true);
    try {
      const tunnelIds = Array.from(selectedTunnelKeys).map((id) => Number(id));
      const res = await assignTunnelsToGroup({
        groupId: assignTunnelGroup.id,
        tunnelIds,
      });

      if (res.code === 0) {
        toast.success("分配成功");
        onTunnelAssignModalClose();
        loadData();
      } else {
        toast.error(res.msg || "分配失败");
      }
    } catch {
      toast.error("分配失败");
    } finally {
      setSavingAssign(false);
    }
  };
  const saveAssignUsers = async () => {
    if (!assignUserGroup) return;
    setSavingAssign(true);
    try {
      const userIds = Array.from(selectedUserKeys).map((id) => Number(id));
      const res = await assignUsersToGroup({
        groupId: assignUserGroup.id,
        userIds,
      });

      if (res.code === 0) {
        toast.success("分配成功");
        onUserAssignModalClose();
        loadData();
      } else {
        toast.error(res.msg || "分配失败");
      }
    } catch {
      toast.error("分配失败");
    } finally {
      setSavingAssign(false);
    }
  };
  const handleAssignPermission = async () => {
    if (!selectedUserGroupId || !selectedTunnelGroupId) {
      toast.error("请选择用户分组和隧道分组");

      return;
    }
    setSavingPermission(true);
    try {
      const res = await assignGroupPermission({
        userGroupId: selectedUserGroupId,
        tunnelGroupId: selectedTunnelGroupId,
      });

      if (res.code === 0) {
        toast.success(res.msg || "权限分配成功");
        loadData();
      } else {
        toast.error(res.msg || "权限分配失败");
      }
    } catch {
      toast.error("权限分配失败");
    } finally {
      setSavingPermission(false);
    }
  };
  const handleRemovePermission = (item: GroupPermission) => {
    setConfirmConfig({
      title: "确认回收权限",
      content: `确定要回收该关联权限吗？`,
      action: async () => {
        const res = await removeGroupPermission(item.id);

        if (res.code === 0) {
          toast.success("权限回收成功");
          loadData();
        } else {
          toast.error(res.msg || "回收失败");
        }
      },
    });
    setIsConfirmOpen(true);
  };
  const toggleTunnelGroupExpand = (groupId: number) => {
    setExpandedTunnelGroups((prev) => {
      const next = new Set(prev);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  };
  const toggleUserGroupExpand = (groupId: number) => {
    setExpandedUserGroups((prev) => {
      const next = new Set(prev);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  };

  if (!isAdmin) {
    return (
      <div className="px-3 lg:px-6 py-8">
        <Card>
          <CardBody>
            <p className="text-danger">
              权限不足，只有管理员可以访问分组管理页面。
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-3 lg:px-6 py-8 space-y-6">
      {loading && (
        <div className="flex justify-center py-10">
          <Spinner size="lg" />
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <h3 className="text-lg font-semibold">隧道分组</h3>
          <Button
            className="h-9 px-4 text-xs font-medium min-w-0 shadow-sm"
            color="primary"
            size="md"
            onPress={openCreateTunnelGroup}
          >
            新建
          </Button>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto w-full touch-pan-x pb-2">
            <Table
              aria-label="隧道分组列表"
              className="min-w-[800px]"
              classNames={{
                th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  名称
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[300px] text-left">
                  隧道
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                  状态
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                  创建时间
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[280px] text-left">
                  操作
                </TableColumn>
              </TableHeader>
              <TableBody>
                {tunnelGroups.length === 0
                  ? null
                  : tunnelGroups.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-medium text-foreground truncate">
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.tunnelNames.length > 0 ? (
                            <div
                              className="flex flex-nowrap gap-1 items-center"
                              title={item.tunnelNames.join("、")}
                            >
                              {item.tunnelNames.length > 2 &&
                              !expandedTunnelGroups.has(item.id) ? (
                                <>
                                  <Button
                                    className="min-h-5 min-w-5 h-5 w-5 p-0 flex-shrink-0"
                                    size="sm"
                                    variant="flat"
                                    onPress={() =>
                                      toggleTunnelGroupExpand(item.id)
                                    }
                                  >
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200" />
                                    <span className="sr-only">展开</span>
                                  </Button>
                                  {item.tunnelNames
                                    .slice(0, 2)
                                    .map((name: string, idx: number) => (
                                      <div
                                        key={idx}
                                        className="max-w-[120px] truncate whitespace-nowrap inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-default-500/10 text-default-500"
                                      >
                                        {name}
                                      </div>
                                    ))}
                                </>
                              ) : (
                                <div className="flex flex-nowrap gap-1 items-center overflow-x-auto max-w-[400px]">
                                  <Button
                                    className="min-h-5 min-w-5 h-5 w-5 p-0 flex-shrink-0"
                                    size="sm"
                                    variant="flat"
                                    onPress={() =>
                                      toggleTunnelGroupExpand(item.id)
                                    }
                                  >
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200 rotate-180" />
                                    <span className="sr-only">收起</span>
                                  </Button>
                                  {item.tunnelNames.map(
                                    (name: string, idx: number) => (
                                      <div
                                        key={idx}
                                        className="max-w-[120px] truncate whitespace-nowrap flex-shrink-0 inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-default-500/10 text-default-500"
                                      >
                                        {name}
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${item.status === 1 ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                          >
                            {item.status === 1 ? "启用" : "停用"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-default-600">
                            {formatDate(item.createdTime)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex gap-1.5">
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="primary"
                              size="sm"
                              variant="flat"
                              onPress={() => openAssignTunnels(item)}
                            >
                              分配隧道
                            </Button>
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="default"
                              size="sm"
                              variant="flat"
                              onPress={() => openEditTunnelGroup(item)}
                            >
                              编辑
                            </Button>
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="danger"
                              size="sm"
                              variant="flat"
                              onPress={() => handleDeleteTunnelGroup(item)}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <h3 className="text-lg font-semibold">用户分组</h3>
          <Button
            className="h-9 px-4 text-xs font-medium min-w-0 shadow-sm"
            color="primary"
            size="md"
            onPress={openCreateUserGroup}
          >
            新建
          </Button>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto w-full touch-pan-x pb-2">
            <Table
              aria-label="用户分组列表"
              className="min-w-[800px]"
              classNames={{
                th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  名称
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[300px] text-left">
                  用户
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[100px] text-left">
                  状态
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                  创建时间
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[280px] text-left">
                  操作
                </TableColumn>
              </TableHeader>
              <TableBody>
                {userGroups.length === 0
                  ? null
                  : userGroups.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-medium text-foreground truncate">
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.userNames.length > 0 ? (
                            <div
                              className="flex flex-nowrap gap-1 items-center"
                              title={item.userNames.join("、")}
                            >
                              {item.userNames.length > 2 &&
                              !expandedUserGroups.has(item.id) ? (
                                <>
                                  <Button
                                    className="min-h-5 min-w-5 h-5 w-5 p-0 flex-shrink-0"
                                    size="sm"
                                    variant="flat"
                                    onPress={() =>
                                      toggleUserGroupExpand(item.id)
                                    }
                                  >
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200" />
                                    <span className="sr-only">展开</span>
                                  </Button>
                                  {item.userNames
                                    .slice(0, 2)
                                    .map((name: string, idx: number) => (
                                      <div
                                        key={idx}
                                        className="max-w-[120px] truncate whitespace-nowrap inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-default-500/10 text-default-500"
                                      >
                                        {name}
                                      </div>
                                    ))}
                                </>
                              ) : (
                                <div className="flex flex-nowrap gap-1 items-center overflow-x-auto max-w-[400px]">
                                  <Button
                                    className="min-h-5 min-w-5 h-5 w-5 p-0 flex-shrink-0"
                                    size="sm"
                                    variant="flat"
                                    onPress={() =>
                                      toggleUserGroupExpand(item.id)
                                    }
                                  >
                                    <ChevronDown className="h-4 w-4 transition-transform duration-200 rotate-180" />
                                    <span className="sr-only">收起</span>
                                  </Button>
                                  {item.userNames.map(
                                    (name: string, idx: number) => (
                                      <div
                                        key={idx}
                                        className="max-w-[120px] truncate whitespace-nowrap flex-shrink-0 inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium bg-default-500/10 text-default-500"
                                      >
                                        {name}
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${item.status === 1 ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                          >
                            {item.status === 1 ? "启用" : "停用"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-default-600">
                            {formatDate(item.createdTime)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex gap-1.5">
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="primary"
                              size="sm"
                              variant="flat"
                              onPress={() => openAssignUsers(item)}
                            >
                              分配用户
                            </Button>
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="default"
                              size="sm"
                              variant="flat"
                              onPress={() => openEditUserGroup(item)}
                            >
                              编辑
                            </Button>
                            <Button
                              className="min-h-7 min-w-[64px]"
                              color="danger"
                              size="sm"
                              variant="flat"
                              onPress={() => handleDeleteUserGroup(item)}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">权限分配</h3>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-row items-end gap-2 w-full">
            <Select
              className="flex-1 min-w-0"
              items={userGroups}
              label="用户分组"
              selectedKeys={
                selectedUserGroupId ? [String(selectedUserGroupId)] : []
              }
              size="md"
              onSelectionChange={(keys) => {
                const key = Array.from(keys as Set<React.Key>)[0];

                setSelectedUserGroupId(key ? Number(key) : null);
              }}
            >
              {(item) => <SelectItem key={item.id}>{item.name}</SelectItem>}
            </Select>
            <Select
              className="flex-1 min-w-0"
              items={tunnelGroups}
              label="隧道分组"
              selectedKeys={
                selectedTunnelGroupId ? [String(selectedTunnelGroupId)] : []
              }
              size="md"
              onSelectionChange={(keys) => {
                const key = Array.from(keys as Set<React.Key>)[0];

                setSelectedTunnelGroupId(key ? Number(key) : null);
              }}
            >
              {(item) => <SelectItem key={item.id}>{item.name}</SelectItem>}
            </Select>
            <Button
              className="flex-none whitespace-nowrap px-4 min-w-0 h-9 text-xs font-medium shadow-sm"
              color="primary"
              isLoading={savingPermission}
              size="md"
              onPress={handleAssignPermission}
            >
              分配
            </Button>
          </div>
          <div className="overflow-x-auto w-full touch-pan-x pb-2">
            <Table
              aria-label="分组权限列表"
              className="min-w-[800px]"
              classNames={{
                th: "bg-default-100/50 text-default-600 font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[80px] text-left">
                  ID
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  用户分组
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[200px] text-left">
                  隧道分组
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[180px] text-left">
                  创建时间
                </TableColumn>
                <TableColumn className="whitespace-nowrap flex-shrink-0 w-[120px] text-left">
                  操作
                </TableColumn>
              </TableHeader>
              <TableBody>
                {permissions.length === 0
                  ? null
                  : permissions.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-default-600">
                            {item.id}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-foreground">
                            {item.userGroupName || item.userGroupId}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-foreground">
                            {item.tunnelGroupName || item.tunnelGroupId}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="text-sm text-default-600">
                            {formatDate(item.createdTime)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            className="min-h-7 min-w-[64px]"
                            color="danger"
                            size="sm"
                            variant="flat"
                            onPress={() => handleRemovePermission(item)}
                          >
                            回收
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>
        </CardBody>
      </Card>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={tunnelGroupModalOpen}
        onOpenChange={onTunnelGroupModalChange}
      >
        <ModalContent>
          <ModalHeader>
            {editingTunnelGroup ? "编辑隧道分组" : "新建隧道分组"}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <Input
              label="分组名称"
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
            <Select
              label="状态"
              selectedKeys={[groupForm.status]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys as Set<React.Key>)[0];

                if (key) {
                  setGroupForm({ ...groupForm, status: String(key) });
                }
              }}
            >
              <SelectItem key="1">启用</SelectItem>
              <SelectItem key="0">停用</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onTunnelGroupModalClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingGroup}
              onPress={saveTunnelGroup}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={userGroupModalOpen}
        onOpenChange={onUserGroupModalChange}
      >
        <ModalContent>
          <ModalHeader>
            {editingUserGroup ? "编辑用户分组" : "新建用户分组"}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <Input
              label="分组名称"
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
            <Select
              label="状态"
              selectedKeys={[groupForm.status]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys as Set<React.Key>)[0];

                if (key) {
                  setGroupForm({ ...groupForm, status: String(key) });
                }
              }}
            >
              <SelectItem key="1">启用</SelectItem>
              <SelectItem key="0">停用</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onUserGroupModalClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingGroup}
              onPress={saveUserGroup}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={tunnelAssignModalOpen}
        onOpenChange={onTunnelAssignModalChange}
      >
        <ModalContent className="min-h-[420px] max-h-[80vh]">
          <ModalHeader>分配隧道 - {assignTunnelGroup?.name}</ModalHeader>
          <ModalBody className="min-w-0">
            <Select
              className="min-w-0"
              classNames={{ trigger: "max-w-full" }}
              items={tunnels.filter((t: any) => t.status === 1)}
              label="选择隧道"
              selectedKeys={selectedTunnelKeys}
              selectionMode="multiple"
              onSelectionChange={(keys) => {
                setSelectedTunnelKeys(
                  new Set(Array.from(keys as Set<React.Key>).map(String)),
                );
              }}
            >
              {(item) => <SelectItem key={item.id}>{item.name}</SelectItem>}
            </Select>
            <p
              className="w-full min-w-0 max-w-full text-xs text-default-500 truncate"
              title={`当前已选：${selectedTunnelSummary}`}
            >
              当前已选择 {selectedTunnelKeys.size} 个隧道
            </p>
            <p className="text-xs text-default-500">
              不选择任何隧道并保存将清空该分组隧道
            </p>
          </ModalBody>
          <ModalFooter className="mt-auto">
            <Button variant="flat" onPress={onTunnelAssignModalClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingAssign}
              onPress={saveAssignTunnels}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={userAssignModalOpen}
        onOpenChange={onUserAssignModalChange}
      >
        <ModalContent className="min-h-[420px] max-h-[80vh]">
          <ModalHeader>分配用户 - {assignUserGroup?.name}</ModalHeader>
          <ModalBody className="min-w-0">
            <Select
              className="min-w-0"
              classNames={{ trigger: "max-w-full" }}
              items={users}
              label="选择用户"
              selectedKeys={selectedUserKeys}
              selectionMode="multiple"
              onSelectionChange={(keys) => {
                setSelectedUserKeys(
                  new Set(Array.from(keys as Set<React.Key>).map(String)),
                );
              }}
            >
              {(item) => <SelectItem key={item.id}>{item.user}</SelectItem>}
            </Select>
            <p
              className="w-full min-w-0 max-w-full text-xs text-default-500 truncate"
              title={`当前已选：${selectedUserSummary}`}
            >
              当前已选择 {selectedUserKeys.size} 个用户
            </p>
            <p className="text-xs text-default-500">
              不选择任何用户并保存将清空该分组用户
            </p>
          </ModalBody>
          <ModalFooter className="mt-auto">
            <Button variant="flat" onPress={onUserAssignModalClose}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={savingAssign}
              onPress={saveAssignUsers}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={isConfirmOpen}
        size="md"
        onOpenChange={setIsConfirmOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-danger">
                {confirmConfig?.title}
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600">{confirmConfig?.content}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="danger"
                  onPress={async () => {
                    if (confirmConfig?.action) {
                      await confirmConfig.action();
                      onClose();
                    }
                  }}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
