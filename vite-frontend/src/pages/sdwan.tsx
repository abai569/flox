import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  getSDWANGroupList,
  createSDWANGroup,
  updateSDWANGroup,
  deleteSDWANGroup,
  reissueSDWANGroupCerts,
  getNodeList,
} from "@/api";

interface GroupMember {
  id: number;
  name: string;
  status: number;
  vpnIp: string;
  intranetIp: string;
  role: string;
  hasCert: boolean;
  lighthouseAddr: string;
  overlayRunning: boolean;
}

interface SDWANGroup {
  id: string;
  name: string;
  networkCIDR: string;
  lighthouseNodeId: number;
  lighthouseName: string;
  listenPort: number;
  memberCount: number;
  members: GroupMember[];
}

interface NodeItem {
  id: number;
  name: string;
  status: number;
  remark?: string;
  serverIpV4?: string;
  serverIp?: string;
  intranetIp?: string;
}

const toSelectedNodeIds = (keys: Iterable<unknown>): number[] => {
  return Array.from(keys)
    .map((key) => Number.parseInt(String(key), 10))
    .filter((nodeId) => Number.isFinite(nodeId));
};

const maskIP = (val: string): string => {
  if (!val) return val;
  if (val.includes(".")) {
    const parts = val.split(".");
    if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;
    return parts[0].length > 12 ? parts[0].slice(0, 12) + "..." : parts[0];
  }
  if (val.includes(":")) {
    const parts = val.split(":");
    return parts.slice(0, 3).join(":") + "::";
  }
  return val.length > 15 ? val.slice(0, 15) + "..." : val;
};

// abbreviateIP shortens VPN IP: if all members share the same first two octets,
// show only the last two (e.g. 102.11), otherwise show full IP.
// If any abbreviated IP would be ambiguous, falls back to full IP for all.
const abbreviateIP = (fullIP: string, allVPNIPs: string[]): string => {
  const parts = fullIP.split(".");
  if (parts.length !== 4) return fullIP;

  // Check if all IPs share the same first two octets
  const allSamePrefix = allVPNIPs.every((ip) => {
    const p = ip.split(".");
    return p.length === 4 && p[0] === parts[0] && p[1] === parts[1];
  });
  if (!allSamePrefix) return fullIP;

  // Check for ambiguous abbreviated IPs
  const abbreviated = allVPNIPs.map((ip) => {
    const p = ip.split(".");
    return `${p[2]}.${p[3]}`;
  });
  const unique = new Set(abbreviated);
  if (unique.size !== abbreviated.length) return fullIP;

  return `${parts[2]}.${parts[3]}`;
};

const copyToClipboard = (text: string, label: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} 已复制到剪贴板`),
    () => toast.error("复制失败"),
  );
};

export default function SDWANPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<SDWANGroup[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SDWANGroup | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SDWANGroup | null>(null);

  const [createForm, setCreateForm] = useState({
    name: "",
    networkCIDR: "",
    lighthouseNodeId: 0,
    memberNodeIds: [] as number[],
    listenPort: 0,
  });

  const [editForm, setEditForm] = useState({
    name: "",
    lighthouseNodeId: 0,
    memberNodeIds: [] as number[],
    listenPort: 0,
  });

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [groupRes, nodeRes] = await Promise.all([
        getSDWANGroupList(),
        getNodeList(),
      ]);
      if (groupRes.code === 0 && groupRes.data) {
        setGroups(groupRes.data.groups || []);
      } else {
        toast.error(groupRes.msg || "加载分组失败");
      }
      if (nodeRes.code === 0 && nodeRes.data) {
        setNodes(nodeRes.data || []);
      }
    } catch {
      if (silent) {
        toast.error("自动刷新失败，请手动刷新");
      } else {
        toast.error("加载 SDWAN 状态失败");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  usePullToRefresh(() => loadData(false));

  const handleCreateGroup = async () => {
    if (!createForm.name.trim()) {
      toast.error("请输入分组名称");
      return;
    }
    if (createForm.lighthouseNodeId <= 0) {
      toast.error("请选择中心节点");
      return;
    }
    if (createForm.memberNodeIds.length === 0) {
      toast.error("请选择成员节点");
      return;
    }
    setActionLoading("create");
    try {
      const res = await createSDWANGroup(createForm);
      if (res.code === 0) {
        toast.success("分组创建成功");
        setCreateModalOpen(false);
        setCreateForm({ name: "", networkCIDR: "", lighthouseNodeId: 0, memberNodeIds: [], listenPort: 0 });
        await loadData();
      } else {
        toast.error(res.msg || "创建分组失败");
      }
    } catch {
      toast.error("创建分组失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditGroup = async () => {
    if (!editingGroup) return;
    if (!editForm.name.trim()) {
      toast.error("请输入分组名称");
      return;
    }
    if (editForm.lighthouseNodeId <= 0) {
      toast.error("请选择中心节点");
      return;
    }
    if (editForm.memberNodeIds.length === 0) {
      toast.error("请选择成员节点");
      return;
    }
    setActionLoading("edit");
    try {
      const res = await updateSDWANGroup({
        groupId: editingGroup.id,
        name: editForm.name,
        lighthouseNodeId: editForm.lighthouseNodeId,
        memberNodeIds: editForm.memberNodeIds,
        listenPort: editForm.listenPort || undefined,
      });
      if (res.code === 0) {
        toast.success("分组更新成功");
        setEditModalOpen(false);
        setEditingGroup(null);
        await loadData();
      } else {
        toast.error(res.msg || "更新分组失败");
      }
    } catch {
      toast.error("更新分组失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteGroup = (group: SDWANGroup) => {
    setDeleteTarget(group);
    setDeleteModalOpen(true);
  };

  const confirmDeleteGroup = async () => {
    if (!deleteTarget) return;
    setActionLoading(deleteTarget.id);
    try {
      const res = await deleteSDWANGroup(deleteTarget.id);
      if (res.code === 0) {
        toast.success("分组已删除");
        setDeleteModalOpen(false);
        setDeleteTarget(null);
        await loadData();
      } else {
        toast.error(res.msg || "删除分组失败");
      }
    } catch {
      toast.error("删除分组失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReissueCerts = async (group: SDWANGroup) => {
    setActionLoading("reissue_" + group.id);
    try {
      const res = await reissueSDWANGroupCerts(group.id);
      if (res.code === 0) {
        toast.success("证书已重新签发并推送");
        await loadData();
      } else {
        toast.error(res.msg || "重新签发证书失败");
      }
    } catch {
      toast.error("重新签发证书失败");
    } finally {
      setActionLoading(null);
    }
  };

  const openEditModal = (group: SDWANGroup) => {
    setEditingGroup(group);
    setEditForm({
      name: group.name,
      lighthouseNodeId: group.lighthouseNodeId,
      memberNodeIds: group.members.map((m) => m.id),
      listenPort: group.listenPort || 0,
    });
    setEditModalOpen(true);
  };

  const groupedNodeIds = useMemo(() => {
    const ids = new Set<number>();
    groups.forEach((g) => g.members.forEach((m) => ids.add(m.id)));
    return ids;
  }, [groups]);

  const ungroupedNodes = useMemo(() => {
    return nodes.filter((n) => !groupedNodeIds.has(n.id));
  }, [nodes, groupedNodeIds]);

  if (loading) {
    return (
      <AnimatedPage className="px-3 lg:px-6 py-8 flex items-center justify-center">
        <Spinner size="lg" />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8 space-y-6">
      {/* header */}
      <div>
        {/* 第一行：大标题（居左）和 按钮组（居右） */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">SDWAN 组网管理</h1>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={() => loadData()}>
              刷新
            </Button>
            <Button
              color="primary"
              size="sm"
              variant="flat"
              onPress={() => setCreateModalOpen(true)}
            >
              新增分组
            </Button>
          </div>
        </div>

        {/* 第二行：副标题单独占据一行 */}
        <p className="text-sm text-default-500 mt-1">
          分组组网，每个分组独立 CA 和网段，节点可加入多个分组
        </p>
      </div>

      {/* group cards */}
      {groups.length === 0 ? (
        <Card className="shadow-sm border border-divider">
          <CardBody className="min-h-[200px] flex items-center justify-center">
            <div className="text-default-500 text-sm">
              暂无 SDWAN 分组，点击"新增分组"开始组网
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {groups.map((group) => {
            const isLoading = actionLoading === group.id;
            const isReissuing = actionLoading === ("reissue_" + group.id);
            const onlineCount = group.members.filter((m) => m.status === 1).length;
            const lighthouseMember = group.members.find((m) => m.role === "lighthouse");
            const allVPNIPs = group.members.map((m) => m.vpnIp).filter(Boolean);

            return (
              <Card
                key={group.id}
                className="shadow-sm border border-divider hover:shadow-md transition-shadow duration-200"
              >
                <div className="px-6 pt-4 pb-2">
                  <span className="font-semibold truncate">{group.name}</span>
                </div>
                <CardBody>
                  <div className="space-y-1.5 border-b border-divider/50 pb-2 mb-2">
                    <div className="flex justify-between items-center">
                      <span className="text-default-500 text-xs">网段</span>
                      <span className="font-medium text-sm">{group.networkCIDR}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-default-500 text-xs">端口</span>
                      <span className="font-medium text-sm">{group.listenPort}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-default-500 text-xs">在线/成员数</span>
                      <span className="font-medium text-sm">
                        {onlineCount}/{group.memberCount}
                      </span>
                    </div>
                    {lighthouseMember && (
                      <div className="flex justify-between items-center">
                        <span className="text-default-500 text-xs">中心节点</span>
                        <span className="font-medium text-sm truncate ml-2">
                          {lighthouseMember.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-default-500 font-medium">成员列表</span>
                    {group.members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-2 rounded hover:bg-default-100"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusDot
                            active={member.status === 1}
                            tone={member.status === 1 ? "success" : "danger"}
                          />
                          <span className="text-sm font-medium truncate">{member.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          {member.vpnIp && (
                            <span className="text-xs text-default-500 font-mono">
                              ({abbreviateIP(member.vpnIp, allVPNIPs)})
                            </span>
                          )}
                          <span
                            className="flex items-center gap-1 text-xs"
                            title={member.overlayRunning ? "SDW 正常" : "SDW 异常"}
                          >
                            SDW
                            <StatusDot
                              active={member.overlayRunning}
                              className="h-2 w-2"
                              tone={member.overlayRunning ? "success" : "danger"}
                            />
                          </span>
                          <span
                            className="flex items-center gap-1 text-xs"
                            title={member.hasCert ? "证书有效" : "证书异常"}
                          >
                            证书
                            <StatusDot
                              active={member.hasCert}
                              className="h-2 w-2"
                              tone={member.hasCert ? "success" : "danger"}
                            />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-3">
                    <Button
                      className="flex-1"
                      size="sm"
                      color="primary"
                      variant="flat"
                      isLoading={isLoading}
                      onPress={() => openEditModal(group)}
                    >
                      编辑
                    </Button>
                    <Button
                      className="flex-1"
                      size="sm"
                      color="warning"
                      variant="flat"
                      isLoading={isReissuing}
                      onPress={() => handleReissueCerts(group)}
                    >
                      签发证书
                    </Button>
                    <Button
                      className="flex-1"
                      size="sm"
                      color="danger"
                      variant="flat"
                      isLoading={isLoading}
                      onPress={() => handleDeleteGroup(group)}
                    >
                      删除
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* ungrouped nodes */}
      {ungroupedNodes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">未分组节点</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {ungroupedNodes.map((node) => (
              <Card
                key={node.id}
                className="shadow-sm border border-divider hover:shadow-md transition-shadow duration-200 h-full flex flex-col"
              >
                <CardBody className="pt-4 pb-3 md:pt-4 space-y-1.5 w-full min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot
                      active={node.status === 1}
                      tone={node.status === 1 ? "success" : "danger"}
                    />
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
                  {(node.serverIpV4 || node.serverIp) && (
                    <div className="flex justify-between items-center min-w-0">
                      <span className="text-default-500 text-xs flex-shrink-0 mr-2">公网IP</span>
                      <span
                        className="font-medium text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto"
                        title={node.serverIpV4 || node.serverIp}
                        onClick={(e) => {
                          e.stopPropagation();
                          const val = node.serverIpV4 || node.serverIp;
                          if (val) copyToClipboard(val, "公网IP");
                        }}
                      >
                        {maskIP(node.serverIpV4 || node.serverIp || "")}
                      </span>
                    </div>
                  )}
                  {node.remark?.trim() && (
                    <div className="flex justify-between items-center min-w-0">
                      <span className="text-default-500 text-xs flex-shrink-0 mr-2">备注</span>
                      <span
                        className="font-medium text-sm cursor-pointer hover:bg-default-200/50 rounded px-1 transition-colors truncate shrink min-w-0 ml-auto"
                        title={node.remark.trim()}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(node.remark!.trim(), "备注");
                        }}
                      >
                        {maskIP(node.remark.trim())}
                      </span>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* create modal */}
      <Modal isOpen={createModalOpen} isDismissable={false} onClose={() => setCreateModalOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>新增 SDWAN 分组</ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label="分组名称"
              placeholder="例如：美国组"
              value={createForm.name}
              variant="bordered"
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
            <Input
              label="网段（留空自动分配）"
              placeholder="192.168.101.0/24"
              value={createForm.networkCIDR}
              variant="bordered"
              onChange={(e) => setCreateForm({ ...createForm, networkCIDR: e.target.value })}
            />
            <Input
              label="端口（留空自动分配）"
              placeholder="范围4000-5000"
              value={createForm.listenPort ? String(createForm.listenPort) : ""}
              variant="bordered"
              type="number"
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  listenPort: e.target.value ? Number(e.target.value) : 0,
                })
              }
            />
            <Select
              label="中心节点"
              placeholder="请选择中心节点"
              variant="bordered"
              selectedKeys={[String(createForm.lighthouseNodeId)]}
              onSelectionChange={(keys) => {
                const ids = toSelectedNodeIds(keys);
                setCreateForm({ ...createForm, lighthouseNodeId: ids.length > 0 ? ids[0] : 0 });
              }}
            >
              {nodes.map((node) => (
                <SelectItem key={String(node.id)} textValue={node.name}>
                  <div className="flex items-center justify-between">
                    <span>{node.name}</span>
                    <StatusDot
                      active={node.status === 1}
                      className="h-2 w-2"
                      tone={node.status === 1 ? "success" : "danger"}
                    />
                  </div>
                </SelectItem>
              ))}
            </Select>
            <Select
              label={`成员节点${createForm.memberNodeIds.length > 0 ? `（已选 ${createForm.memberNodeIds.length} 个）` : ""}`}
              placeholder="请选择成员节点（可多选）"
              selectionMode="multiple"
              variant="bordered"
              selectedKeys={createForm.memberNodeIds.map(String)}
              onSelectionChange={(keys) => {
                const ids = toSelectedNodeIds(keys);
                setCreateForm({ ...createForm, memberNodeIds: ids });
              }}
            >
              {nodes.map((node) => (
                <SelectItem key={String(node.id)} textValue={node.name}>
                  <div className="flex items-center justify-between">
                    <span>{node.name}</span>
                    <StatusDot
                      active={node.status === 1}
                      className="h-2 w-2"
                      tone={node.status === 1 ? "success" : "danger"}
                    />
                  </div>
                </SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setCreateModalOpen(false)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={actionLoading === "create"}
              onPress={handleCreateGroup}
            >
              创建
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* edit modal */}
      <Modal isOpen={editModalOpen} isDismissable={false} onClose={() => setEditModalOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>编辑分组</ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label="分组名称"
              value={editForm.name}
              variant="bordered"
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
            <Input
              label="端口（留空自动分配）"
              placeholder="范围4000-5000"
              value={editForm.listenPort ? String(editForm.listenPort) : ""}
              variant="bordered"
              type="number"
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  listenPort: e.target.value ? Number(e.target.value) : 0,
                })
              }
            />
            <Select
              label="中心节点"
              placeholder="请选择中心节点"
              variant="bordered"
              selectedKeys={[String(editForm.lighthouseNodeId)]}
              onSelectionChange={(keys) => {
                const ids = toSelectedNodeIds(keys);
                setEditForm({ ...editForm, lighthouseNodeId: ids.length > 0 ? ids[0] : 0 });
              }}
            >
              {nodes.map((node) => (
                <SelectItem key={String(node.id)} textValue={node.name}>
                  <div className="flex items-center justify-between">
                    <span>{node.name}</span>
                    <StatusDot
                      active={node.status === 1}
                      className="h-2 w-2"
                      tone={node.status === 1 ? "success" : "danger"}
                    />
                  </div>
                </SelectItem>
              ))}
            </Select>
            <Select
              label={`成员节点${editForm.memberNodeIds.length > 0 ? `（已选 ${editForm.memberNodeIds.length} 个）` : ""}`}
              placeholder="请选择成员节点（可多选）"
              selectionMode="multiple"
              variant="bordered"
              selectedKeys={editForm.memberNodeIds.map(String)}
              onSelectionChange={(keys) => {
                const ids = toSelectedNodeIds(keys);
                setEditForm({ ...editForm, memberNodeIds: ids });
              }}
            >
              {nodes.map((node) => (
                <SelectItem key={String(node.id)} textValue={node.name}>
                  <div className="flex items-center justify-between">
                    <span>{node.name}</span>
                    <StatusDot
                      active={node.status === 1}
                      className="h-2 w-2"
                      tone={node.status === 1 ? "success" : "danger"}
                    />
                  </div>
                </SelectItem>
              ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setEditModalOpen(false)}>
              取消
            </Button>
            <Button
              color="primary"
              isLoading={actionLoading === "edit"}
              onPress={handleEditGroup}
            >
              保存
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* delete confirmation modal */}
      <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} size="sm">
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              确定删除分组"<strong>{deleteTarget?.name}</strong>"？
            </p>
            <p className="text-xs text-danger-500 mt-2">
              此操作将清除所有成员的 SDWAN 配置并关闭 Nebula 进程。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDeleteModalOpen(false)}>
              取消
            </Button>
            <Button
              color="danger"
              isLoading={deleteTarget ? actionLoading === deleteTarget.id : false}
              onPress={confirmDeleteGroup}
            >
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
