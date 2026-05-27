import type { MonitorNodeApiItem } from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Link } from "@/shadcn-bridge/heroui/link";
import { getMonitorNodesPublic } from "@/api";
import { MonitorView } from "@/pages/node/monitor-view";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

type MonitorNode = {
  id: number;
  name: string;
  connectionStatus: "online" | "offline";
  version?: string;
};

export default function TZPage() {
  const [nodes, setNodes] = useState<MonitorNodeApiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try {
      const saved = localStorage.getItem("public-monitor-view-mode");

      if (saved === "grid" || saved === "list") return saved;
    } catch {}

    return "list";
  });

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "list" ? "grid" : "list";

      try {
        localStorage.setItem("public-monitor-view-mode", next);
      } catch {}

      return next;
    });
  }, []);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMonitorNodesPublic();

      if (response.code === 0 && Array.isArray(response.data)) {
        setError(null);
        setNodes(response.data);
      } else {
        setNodes([]);
        setError(response.msg || "暂未开放公共监控");
      }
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);
  usePullToRefresh(loadNodes);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadNodes();
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
        <div className="flex items-center gap-1">
          <Button
            color="warning"
            size="sm"
            variant="flat"
            onPress={toggleViewMode}
          >
            {viewMode === "grid" ? "列表" : "卡片"}
          </Button>
          <Button
            color="secondary"
            isLoading={loading}
            size="sm"
            variant="flat"
            onPress={loadNodes}
          >
            刷新
          </Button>
          <Link className="ml-auto text-xs" color="foreground" href="/">
            返回登录
          </Link>
        </div>
        <div className="text-xs text-default-500">节点实时状态（公开监控）</div>
        {error ? (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">节点列表</h3>
            </CardHeader>
            <CardBody>
              <div className="text-sm text-default-600">{error}</div>
            </CardBody>
          </Card>
        ) : null}
      </div>
      <MonitorView nodeMap={nodeMap} viewMode={viewMode} />
    </AnimatedPage>
  );
}
