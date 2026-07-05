import type {
  MonitorNodeApiItem,
  MonitorNodeInstanceGroupApiItem,
  MonitorNodeInstanceGroupMemberApiItem,
} from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { List, TerminalSquare, Info } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import {
  getMonitorNodes,
  getMonitorNodeInstanceGroups,
  updateNodeWeight,
} from "@/api";
import { MonitorView } from "@/pages/node/monitor-view";
import { TunnelMonitorView } from "@/pages/node/tunnel-monitor-view";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
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

const getMonitorDisplayIP = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  family: MonitorIPFamily,
): string => {
  const reported = family === "v4" ? member.publicIpV4 : member.publicIpV6;

  return reported || "-";
};

const getMonitorPrimaryDisplayIP = (
  member: MonitorNodeInstanceGroupMemberApiItem,
): string => {
  const v4 = getMonitorDisplayIP(member, "v4");

  return v4 !== "-" ? v4 : getMonitorDisplayIP(member, "v6");
};

const getMonitorIPTitle = (
  member: MonitorNodeInstanceGroupMemberApiItem,
  family: MonitorIPFamily,
): string => {
  const reported = getMonitorDisplayIP(member, family);
  const parts = [
    member.hostname ? `主机: ${member.hostname}` : "",
    member.instanceId ? `实例: ${member.instanceId}` : "",
    reported !== "-" ? `上报IP: ${reported}` : "",
  ];

  return parts.filter(Boolean).join("\n");
};

const formatInstanceId = (instanceId?: string): string => {
  const value = instanceId?.trim() || "";

  if (!value) return "默认实例";
  if (value.length <= 18) return value;

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const getInstanceName = (
  member: MonitorNodeInstanceGroupMemberApiItem,
): string => {
  const hostname = member.hostname?.trim();

  if (hostname) return hostname;

  return formatInstanceId(member.instanceId);
};

function NodeInstanceGroupsView({
  groups,
  loading,
  onEditWeight,
  onOpenDetail,
}: {
  groups: MonitorNodeInstanceGroupApiItem[];
  loading: boolean;
  onEditWeight: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
  onOpenDetail: (nodeId: number) => void;
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
    <div className="space-y-4">
      {groups.map((group) => (
        <Card
          key={group.id}
          className="overflow-hidden border border-divider bg-content1"
        >
          <CardHeader className="border-b border-divider bg-default-100/40 px-4 py-3">
            <div className="flex flex-col gap-2 w-full md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-foreground truncate">
                  {group.name} | ID: {group.id}
                </span>
                <span className="text-xs text-default-500">
                  {group.members.length} 个实例
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="rounded-md bg-secondary-500/10 px-3 py-1 text-secondary-600">
                  ↑ {formatSpeed(group.totalOutSpeed)}
                </span>
                <span className="rounded-md bg-primary-500/10 px-3 py-1 text-primary-600">
                  ↓ {formatSpeed(group.totalInSpeed)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-divider bg-default-50 text-xs text-default-500">
                  <tr>
                    <th className="px-4 py-2 text-left">状态</th>
                    <th className="px-4 py-2 text-left">节点实例</th>
                    <th className="px-4 py-2 text-left">IPv4</th>
                    <th className="px-4 py-2 text-left">IPv6</th>
                    <th className="px-4 py-2 text-right">速率</th>
                    <th className="px-4 py-2 text-right">开机时长</th>
                    <th className="px-4 py-2 text-right">流量</th>
                    <th className="px-4 py-2 text-right">在线数</th>
                    <th className="px-4 py-2 text-right">权重</th>
                    <th className="px-4 py-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((member) => (
                    <tr
                      key={`${member.nodeId}:${member.instanceId || "default"}`}
                      className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${member.status === 1 ? "bg-success-500/15 text-success-600" : "bg-danger-500/15 text-danger-600"}`}
                        >
                          ●
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        <div>{getInstanceName(member)}</div>
                        <div
                          className="text-xs font-normal text-default-400"
                          title={member.instanceId || "默认实例"}
                        >
                          实例 {formatInstanceId(member.instanceId)}
                        </div>
                      </td>
                      <td
                        className="px-4 py-3 text-default-600 whitespace-nowrap"
                        title={getMonitorIPTitle(member, "v4")}
                      >
                        {getMonitorDisplayIP(member, "v4")}
                      </td>
                      <td
                        className="px-4 py-3 text-default-600 whitespace-nowrap"
                        title={getMonitorIPTitle(member, "v6")}
                      >
                        {getMonitorDisplayIP(member, "v6")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        <div>{formatSpeed(member.netOutSpeed)}↑</div>
                        <div>{formatSpeed(member.netInSpeed)}↓</div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {formatUptime(member.uptime)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        <div>{formatBytes(member.periodTx)}↑</div>
                        <div>{formatBytes(member.periodRx)}↓</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {member.onlineCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {member.weight}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-2">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="flat"
                            onPress={() => onEditWeight(member)}
                          >
                            <List className="h-4 w-4" />
                          </Button>
                          <Button
                            isDisabled
                            isIconOnly
                            size="sm"
                            variant="flat"
                            onPress={() => toast("SSH 稍后实现")}
                          >
                            <TerminalSquare className="h-4 w-4" />
                          </Button>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="flat"
                            onPress={() => onOpenDetail(member.nodeId)}
                          >
                            <Info className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default function MonitorPage() {
  const [nodes, setNodes] = useState<MonitorNodeApiItem[]>([]);
  const [nodeInstanceGroups, setNodeInstanceGroups] = useState<
    MonitorNodeInstanceGroupApiItem[]
  >([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodeInstanceGroupsLoading, setNodeInstanceGroupsLoading] =
    useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weightTarget, setWeightTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);
  const [detailNodeId, setDetailNodeId] = useState<number | null>(null);
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
          setNodeInstanceGroups(response.data);

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

  const loadNodeTab = useCallback(
    async (options?: { silent?: boolean }) => {
      await Promise.all([loadNodes(options), loadNodeInstanceGroups(options)]);
    },
    [loadNodes, loadNodeInstanceGroups],
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
  }, [loadNodes, loadNodeInstanceGroups]);
  usePullToRefresh(refreshActiveTab);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadNodes({ silent: true });
      void loadNodeInstanceGroups({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadNodes, loadNodeInstanceGroups]);

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
    const list: MonitorNode[] = nodes
      .filter((n) => Number(n.id) > 0)
      .map((n) => ({
        id: Number(n.id),
        name: String(n.name ?? ""),
        connectionStatus: n.status === 1 ? "online" : "offline",
        version: n.version,
        instanceCount: Number(n.instanceCount ?? 0),
        onlineInstanceCount: Number(n.onlineInstanceCount ?? 0),
      }));

    return new Map<number, MonitorNode>(list.map((n) => [n.id, n]));
  }, [nodes]);

  return (
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
                loadNodes();
                loadNodeInstanceGroups();
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
              <NodeInstanceGroupsView
                groups={nodeInstanceGroups}
                loading={nodeInstanceGroupsLoading}
                onEditWeight={openWeightModal}
                onOpenDetail={setDetailNodeId}
              />
            ) : (
              <MonitorView
                hideList
                detailNodeId={detailNodeId}
                nodeMap={nodeMap}
                viewMode={viewMode}
                onDetailClose={() => setDetailNodeId(null)}
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
  );
}
