import type {
  MonitorNodeApiItem,
  MonitorServerGroupApiItem,
  MonitorServerGroupMemberApiItem,
} from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { List, TerminalSquare, Info } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import {
  getMonitorNodes,
  getMonitorServerGroups,
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
};

type MonitorTab = "servers" | "nodes" | "tunnels";

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatSpeed = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`;

const formatUptime = (seconds: number): string => {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  return days > 0 ? `${days} 天` : `${hours} 小时`;
};

type MonitorIPFamily = "v4" | "v6";

const extractMonitorHost = (value?: string): string => {
  const raw = String(value ?? "").trim().split(",")[0]?.trim().split(/\s+/)[0] ?? "";

  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");

    return end > 0 ? raw.slice(1, end).trim() : raw.replace(/[\[\]]/g, "").trim();
  }
  const colonCount = (raw.match(/:/g) ?? []).length;

  if (colonCount === 1) return raw.split(":")[0].trim();

  return raw.replace(/[\[\]]/g, "").trim();
};

const getMonitorAddressFamily = (value?: string): MonitorIPFamily | "domain" | null => {
  const host = extractMonitorHost(value);

  if (!host) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "v4";
  if (host.includes(":")) return "v6";

  return "domain";
};

const getMonitorRawIP = (member: MonitorServerGroupMemberApiItem, family: MonitorIPFamily): string => {
  const explicit = family === "v4" ? member.serverIpV4 : member.serverIpV6;

  if (explicit) return explicit;
  const serverFamily = getMonitorAddressFamily(member.serverIp);

  return serverFamily === family || serverFamily === "domain" ? (member.serverIp ?? "") : "";
};

const getMonitorDisplayIP = (member: MonitorServerGroupMemberApiItem, family: MonitorIPFamily): string => {
  const resolved = family === "v4" ? member.resolvedIpV4 : member.resolvedIpV6;

  return resolved || getMonitorRawIP(member, family) || "-";
};

const getMonitorPrimaryDisplayIP = (member: MonitorServerGroupMemberApiItem): string => {
  const v4 = getMonitorDisplayIP(member, "v4");

  return v4 !== "-" ? v4 : getMonitorDisplayIP(member, "v6");
};

const formatResolvedAt = (timestamp?: number): string => {
  if (!timestamp) return "";

  return new Date(timestamp).toLocaleString();
};

const getMonitorIPTitle = (member: MonitorServerGroupMemberApiItem, family: MonitorIPFamily): string => {
  const raw = getMonitorRawIP(member, family);
  const resolvedAt = formatResolvedAt(family === "v4" ? member.ipV4ResolvedAt : member.ipV6ResolvedAt);
  const parts = [raw ? `配置: ${raw}` : "", resolvedAt ? `解析时间: ${resolvedAt}` : "", member.ipResolveError ? `解析状态: ${member.ipResolveError}` : ""];

  return parts.filter(Boolean).join("\n");
};

function ServerGroupsView({
  groups,
  loading,
  onEditWeight,
}: {
  groups: MonitorServerGroupApiItem[];
  loading: boolean;
  onEditWeight: (member: MonitorServerGroupMemberApiItem) => void;
}) {
  if (loading && groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          正在加载服务器监控...
        </CardBody>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          暂无服务器负载数据
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.id} className="overflow-hidden border border-divider bg-content1">
          <CardHeader className="border-b border-divider bg-default-100/40 px-4 py-3">
            <div className="flex flex-col gap-2 w-full md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-foreground truncate">
                  {group.name} | ID: {group.id}
                </span>
                <span className="text-xs text-default-500">
                  {group.members.length} 台服务器
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
                    <th className="px-4 py-2 text-left">服务器</th>
                    <th className="px-4 py-2 text-left">v4 地区</th>
                    <th className="px-4 py-2 text-left">v6 地区</th>
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
                    <tr key={member.nodeId} className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${member.status === 1 ? "bg-success-500/15 text-success-600" : "bg-danger-500/15 text-danger-600"}`}>
                          ●
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {member.nodeName}
                      </td>
                      <td className="px-4 py-3 text-default-600 whitespace-nowrap" title={getMonitorIPTitle(member, "v4")}>
                        {getMonitorDisplayIP(member, "v4")}
                      </td>
                      <td className="px-4 py-3 text-default-600 whitespace-nowrap" title={getMonitorIPTitle(member, "v6")}>
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
                          <Button isIconOnly size="sm" variant="flat" onPress={() => onEditWeight(member)}>
                            <List className="h-4 w-4" />
                          </Button>
                          <Button isIconOnly isDisabled size="sm" variant="flat" onPress={() => toast("SSH 稍后实现") }>
                            <TerminalSquare className="h-4 w-4" />
                          </Button>
                          <Button isIconOnly isDisabled size="sm" variant="flat" onPress={() => toast("系统信息稍后实现") }>
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
  const [serverGroups, setServerGroups] = useState<MonitorServerGroupApiItem[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [serverGroupsLoading, setServerGroupsLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weightTarget, setWeightTarget] = useState<MonitorServerGroupMemberApiItem | null>(null);
  const [weightValue, setWeightValue] = useState("");
  const [weightSaving, setWeightSaving] = useState(false);
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

      if (saved === "servers" || saved === "nodes" || saved === "tunnels") return saved as MonitorTab;
    } catch {}

    return "servers";
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

  const loadServerGroups = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!silent) setServerGroupsLoading(true);
    try {
      const response = await getMonitorServerGroups();

      if (response.code === 0 && Array.isArray(response.data)) {
        setServerGroups(response.data);
        return;
      }
      if (!silent) toast.error(response.msg || "加载服务器负载失败");
    } catch {
      if (!silent) toast.error("加载服务器负载失败");
    } finally {
      if (!silent) setServerGroupsLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadNodes();
    void loadServerGroups();
  }, [loadNodes, loadServerGroups]);
  usePullToRefresh(activeTab === "servers" ? loadServerGroups : loadNodes);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadNodes({ silent: true });
      void loadServerGroups({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadNodes, loadServerGroups]);

  const openWeightModal = useCallback((member: MonitorServerGroupMemberApiItem) => {
    setWeightTarget(member);
    setWeightValue(String(member.weight ?? 1));
    setWeightModalOpen(true);
  }, []);

  const saveWeight = useCallback(async (overrideWeight?: number) => {
    if (!weightTarget) return;
    const nextWeight = overrideWeight ?? Number(weightValue);

    if (!Number.isFinite(nextWeight) || nextWeight < 0) {
      toast.error("权重不能小于 0");
      return;
    }
    setWeightSaving(true);
    try {
      const res = await updateNodeWeight(weightTarget.nodeId, Math.floor(nextWeight));

      if (res.code === 0) {
        toast.success("权重已更新，正在重新下发线路配置");
        setWeightModalOpen(false);
        setWeightTarget(null);
        await loadServerGroups({ silent: true });
        await loadNodes({ silent: true });
      } else {
        toast.error(res.msg || "更新权重失败");
      }
    } catch {
      toast.error("更新权重失败");
    } finally {
      setWeightSaving(false);
    }
  }, [loadNodes, loadServerGroups, weightTarget, weightValue]);

  const nodeMap = useMemo(() => {
    const list: MonitorNode[] = nodes
      .filter((n) => Number(n.id) > 0)
      .map((n) => ({
        id: Number(n.id),
        name: String(n.name ?? ""),
        connectionStatus: n.status === 1 ? "online" : "offline",
        version: n.version,
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
            onPress={() => setActiveTab("servers")}
          >
            服务器
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
            isLoading={activeTab === "servers" ? serverGroupsLoading : activeTab === "nodes" ? nodesLoading : tunnelsLoading}
            size="sm"
            variant="flat"
            onPress={() => {
              if (activeTab === "servers") {
                loadServerGroups();
              } else if (activeTab === "nodes") {
                loadNodes();
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
        <div className={activeTab === "servers" ? "block" : "hidden"}>
          <ServerGroupsView
            groups={serverGroups}
            loading={serverGroupsLoading}
            onEditWeight={openWeightModal}
          />
        </div>
        <div className={activeTab === "nodes" ? "block" : "hidden"}>
          <MonitorView nodeMap={nodeMap} viewMode={viewMode} />
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
              <div>IP: {weightTarget ? getMonitorPrimaryDisplayIP(weightTarget) : "-"}</div>
              <div>当前权重: {weightTarget?.weight ?? "-"}</div>
              <div className="text-default-500">权重 0 即不在隧道转发中使用此服务器。</div>
              <div className="text-default-500">建议：组内配置最低的机器设置为 1 权重，高配机器根据 CPU 核心数等适量增加权重。</div>
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
            <Button color="danger" isDisabled={weightSaving} onPress={() => saveWeight(0)}>
              清空权重
            </Button>
            <Button variant="flat" onPress={() => setWeightModalOpen(false)}>
              取消
            </Button>
            <Button color="success" isLoading={weightSaving} onPress={() => saveWeight()}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
