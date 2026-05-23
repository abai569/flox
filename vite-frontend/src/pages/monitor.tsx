import type { MonitorNodeApiItem } from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { getMonitorNodes } from "@/api";
import { MonitorView } from "@/pages/node/monitor-view";
import { TunnelMonitorView } from "@/pages/node/tunnel-monitor-view";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

type MonitorNode = {
  id: number;
  name: string;
  connectionStatus: "online" | "offline";
  version?: string;
};

type MonitorTab = "nodes" | "tunnels";

export default function MonitorPage() {
  const [nodes, setNodes] = useState<MonitorNodeApiItem[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
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
  }, [loadNodes]);
  usePullToRefresh(loadNodes);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadNodes({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadNodes]);

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
            isLoading={activeTab === "nodes" ? nodesLoading : tunnelsLoading}
            size="sm"
            variant="flat"
            onPress={() => {
              if (activeTab === "nodes") {
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
    </AnimatedPage>
  );
}
