import type { MonitorNodeMetricsApiItem } from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Link } from "@/shadcn-bridge/heroui/link";
import { Progress } from "@/shadcn-bridge/heroui/progress";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import { DistroIcon, parseDistroFromVersion, getDistroColor } from "@/components/distro-icon";
import { Activity, ArrowDown, ArrowUp, Clock } from "lucide-react";
import { getMonitorNodesPublicMetrics } from "@/api";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { usePublicNodeRealtime } from "@/hooks/use-public-node-realtime";

function formatBytesPerSecond(bps: number): string {
  if (!bps) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bps) / Math.log(k));
  return `${parseFloat((bps / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}Day ${hours}H`;
  return `${hours} 小时`;
}

function getColorByUsage(usage?: number): "default" | "primary" | "success" | "warning" | "danger" {
  if (usage === undefined || usage === null) return "default";
  if (usage >= 90) return "danger";
  if (usage >= 75) return "warning";
  if (usage >= 50) return "primary";
  return "success";
}

function norm(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface NodeMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  uptime: number;
  tcpConns: number;
  load1: number;
}

const emptyMetrics: NodeMetrics = {
  cpuUsage: 0,
  memoryUsage: 0,
  diskUsage: 0,
  netInSpeed: 0,
  netOutSpeed: 0,
  netInBytes: 0,
  netOutBytes: 0,
  uptime: 0,
  tcpConns: 0,
  load1: 0,
};

export default function TZPage() {
  const [nodes, setNodes] = useState<MonitorNodeMetricsApiItem[]>([]);
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
      try { localStorage.setItem("public-monitor-view-mode", next); } catch {}
      return next;
    });
  }, []);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMonitorNodesPublicMetrics();
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

  const handleRealtimeMessage = useCallback((parsed: { id?: string | number; type?: string; data?: unknown }) => {
    const nodeId = Number(parsed.id);
    if (!nodeId || nodeId <= 0) return;

    if (parsed.type === "status") {
      const isOnline = Number(parsed.data) === 1;
      setNodes((prev) => {
        const idx = prev.findIndex((n) => n.id === nodeId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: isOnline ? 1 : 0 };
        return updated;
      });
      return;
    }

    if (parsed.type === "metric") {
      const payload = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
      if (!payload || typeof payload !== "object") return;

      setNodes((prev) => {
        const idx = prev.findIndex((n) => n.id === nodeId);
        if (idx === -1) return prev;
        const node = prev[idx];
        const updated = [...prev];
        updated[idx] = {
          ...node,
          status: 1,
          cpuUsage: norm(payload.cpu_usage ?? payload.cpuUsage),
          memoryUsage: norm(payload.memory_usage ?? payload.memoryUsage),
          diskUsage: norm(payload.disk_usage ?? payload.diskUsage),
          netInSpeed: norm(payload.net_in_speed ?? payload.netInSpeed),
          netOutSpeed: norm(payload.net_out_speed ?? payload.netOutSpeed),
          netInBytes: norm(payload.bytes_received ?? payload.bytesReceived ?? payload.netInBytes),
          netOutBytes: norm(payload.bytes_transmitted ?? payload.bytesTransmitted ?? payload.netOutBytes),
          uptime: norm(payload.uptime),
          tcpConns: norm(payload.tcp_conns ?? payload.tcpConns),
          load1: norm(payload.load1),
        };
        return updated;
      });
    }
  }, []);

  const { wsConnected, wsConnecting } = usePublicNodeRealtime({
    onMessage: handleRealtimeMessage,
    enabled: true,
  });

  useEffect(() => {
    if (!wsConnected) return;
    void loadNodes();
  }, [wsConnected, loadNodes]);

  useEffect(() => { void loadNodes(); }, [loadNodes]);
  usePullToRefresh(loadNodes);

  const validNodes = useMemo(() => nodes.filter((n) => Number(n.id) > 0), [nodes]);
  const onlineCount = validNodes.filter((n) => n.status === 1).length;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-1">
          <Button color="warning" size="sm" variant="flat" onPress={toggleViewMode}>
            {viewMode === "grid" ? "列表" : "卡片"}
          </Button>
          <Button color="secondary" isLoading={loading} size="sm" variant="flat" onPress={loadNodes}>
            刷新
          </Button>
          <Link className="ml-auto text-xs" color="foreground" href="/">
            返回登录
          </Link>
        </div>

        {!error && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-default-500">
              {wsConnected ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
              ) : (
                <div className={`w-2 h-2 rounded-full ${wsConnecting ? "bg-warning" : "bg-default-300"}`} />
              )}
              <span>
                {wsConnected
                  ? "实时已连接"
                  : wsConnecting
                    ? "实时连接中"
                    : "实时未连接"}
              </span>
            </div>
            <Chip className="rounded-md" color="primary" size="sm" variant="flat">
              节点 {onlineCount}/{validNodes.length}
            </Chip>
          </div>
        )}

        <div className="text-xs text-default-500">节点实时状态（公开监控）</div>

        {error ? (
          <Card>
            <CardHeader><h3 className="text-sm font-semibold">节点列表</h3></CardHeader>
            <CardBody><div className="text-sm text-default-600">{error}</div></CardBody>
          </Card>
        ) : null}
      </div>

      {!error && validNodes.length === 0 && !loading && (
        <div className="text-sm text-default-400 text-center py-12">暂无节点</div>
      )}

      {viewMode === "grid" && validNodes.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
          <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">节点监控数量</span>
            <span className="text-xs text-default-500 whitespace-nowrap">{validNodes.length} 个监控</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {validNodes.map((node) => (
                <ServerCard key={node.id} node={node} />
              ))}
            </div>
          </div>
        </div>
      )}

      {viewMode === "list" && validNodes.length > 0 && (
        <Card className="w-full">
          <Table
            aria-label="节点列表"
            className="overflow-x-auto min-w-full"
            classNames={{
              th: "bg-default-100/50 text-default-600 font-semibold text-foreground text-sm border-b border-divider py-3 uppercase tracking-wider whitespace-nowrap",
              td: "border-b border-divider/50 group-data-[last=true]:border-b-0 align-middle",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
            <TableHeader>
              <TableColumn align="center" className="w-[60px] text-center">状态</TableColumn>
              <TableColumn>
                节点监控名称
                <span className="text-primary-600 font-bold text-[10px] ml-1">^{validNodes.length}个</span>
              </TableColumn>
              <TableColumn className="text-right">速率</TableColumn>
              <TableColumn className="text-right">流量</TableColumn>
              <TableColumn>开机时长</TableColumn>
              <TableColumn>CPU</TableColumn>
              <TableColumn>RAM</TableColumn>
              <TableColumn>存储</TableColumn>
            </TableHeader>
            <TableBody emptyContent="暂无节点">
              {validNodes.map((node) => {
                const isOnline = node.status === 1;
                const hasMetric = node.cpuUsage > 0 || node.memoryUsage > 0 || node.netInSpeed > 0;
                return (
                  <TableRow key={node.id}>
                    <TableCell>
                      <div className="flex justify-center w-full">
                        <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-success" : "bg-danger"}`} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <DistroIcon
                          className="w-4 h-4 flex-shrink-0"
                          distro={parseDistroFromVersion(node.version)}
                          style={{ color: isOnline ? getDistroColor(parseDistroFromVersion(node.version)) : undefined }}
                        />
                        <span className="font-semibold text-sm whitespace-nowrap">{node.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2 py-1 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono text-success-500">
                          <span className="w-[86px] text-right inline-block">{hasMetric ? formatBytesPerSecond(node.netOutSpeed) : "-"}</span>
                          <div className="flex items-center justify-center p-[3px] rounded-full bg-success-50 dark:bg-success-500/10 text-success-500">
                            <ArrowUp className="w-3 h-3" strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-primary-500">
                          <span className="w-[86px] text-right inline-block">{hasMetric ? formatBytesPerSecond(node.netInSpeed) : "-"}</span>
                          <div className="flex items-center justify-center p-[3px] rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-500">
                            <ArrowDown className="w-3 h-3" strokeWidth={2.5} />
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2 py-1 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-mono text-default-600">
                          <span className="w-[86px] text-right inline-block">{hasMetric ? formatBytes(node.netOutBytes) : "-"}</span>
                          <div className="flex items-center justify-center p-[3px] rounded-full bg-default-100 text-default-500 dark:bg-default-100/50">
                            <ArrowUp className="w-3 h-3" strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-default-600">
                          <span className="w-[86px] text-right inline-block">{hasMetric ? formatBytes(node.netInBytes) : "-"}</span>
                          <div className="flex items-center justify-center p-[3px] rounded-full bg-default-100 text-default-500 dark:bg-default-100/50">
                            <ArrowDown className="w-3 h-3" strokeWidth={2.5} />
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-default-500 whitespace-nowrap">{hasMetric ? formatUptime(node.uptime) : "-"}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {hasMetric ? (
                          <Progress className="w-[40px] md:w-[60px]" color={getColorByUsage(node.cpuUsage)} size="sm" value={node.cpuUsage} />
                        ) : (
                          <div className="w-[40px] md:w-[60px] h-2 rounded-full bg-default-100" />
                        )}
                        <span className="text-xs font-mono w-9 text-right text-default-500">{hasMetric ? `${node.cpuUsage.toFixed(1)}%` : "-"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {hasMetric ? (
                          <Progress className="w-[40px] md:w-[60px]" color={getColorByUsage(node.memoryUsage)} size="sm" value={node.memoryUsage} />
                        ) : (
                          <div className="w-[40px] md:w-[60px] h-2 rounded-full bg-default-100" />
                        )}
                        <span className="text-xs font-mono w-9 text-right text-default-500">{hasMetric ? `${node.memoryUsage.toFixed(1)}%` : "-"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {hasMetric ? (
                          <Progress className="w-[40px] md:w-[60px]" color={getColorByUsage(node.diskUsage)} size="sm" value={node.diskUsage} />
                        ) : (
                          <div className="w-[40px] md:w-[60px] h-2 rounded-full bg-default-100" />
                        )}
                        <span className="text-xs font-mono w-9 text-right text-default-500">{hasMetric ? `${node.diskUsage.toFixed(1)}%` : "-"}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </AnimatedPage>
  );
}

function ServerCard({ node }: { node: MonitorNodeMetricsApiItem }) {
  const isOnline = node.status === 1;
  const distro = parseDistroFromVersion(node.version);
  const distroColor = getDistroColor(distro);
  const hasMetric = node.cpuUsage > 0 || node.memoryUsage > 0 || node.netInSpeed > 0;
  const metric: NodeMetrics = hasMetric
    ? {
        cpuUsage: node.cpuUsage,
        memoryUsage: node.memoryUsage,
        diskUsage: node.diskUsage,
        netInSpeed: node.netInSpeed,
        netOutSpeed: node.netOutSpeed,
        netInBytes: node.netInBytes,
        netOutBytes: node.netOutBytes,
        uptime: node.uptime,
        tcpConns: node.tcpConns,
        load1: node.load1,
      }
    : emptyMetrics;

  return (
    <Card className="group h-full flex flex-col overflow-hidden border border-divider bg-content1 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="pb-3 md:pb-3">
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-start justify-between w-full gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-xl bg-default-100/70 dark:bg-default-50/10 flex items-center justify-center border border-divider">
                  <DistroIcon className="w-5 h-5" distro={distro} style={{ color: isOnline ? distroColor : undefined }} />
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${isOnline ? "bg-success" : "bg-danger"}`} />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <h3 className="font-semibold text-foreground text-sm truncate">{node.name}</h3>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${isOnline ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}>
                    {isOnline ? "在线" : "离线"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col pt-0 pb-3 md:pt-0 md:pb-3">
        <div className="space-y-2.5 flex-1 py-1">
          <div className="grid grid-cols-2 gap-3 w-full">
            <div className="space-y-1 min-w-0">
              <div className="flex justify-between items-center px-1 text-[11px] font-bold text-foreground uppercase tracking-wider">
                <span className="text-default-500">CPU</span>
                <span className="font-mono font-medium">{hasMetric ? `${metric.cpuUsage.toFixed(1)}%` : "-"}</span>
              </div>
              <div className="rounded-md bg-default-100/45 dark:bg-default-50/10 px-2 py-2">
                <Progress color={getColorByUsage(metric.cpuUsage)} size="sm" value={hasMetric ? metric.cpuUsage : 0} />
              </div>
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex justify-between items-center px-1 text-[11px] font-bold text-foreground uppercase tracking-wider">
                <span className="text-default-500">内存</span>
                <span className="font-mono font-medium">{hasMetric ? `${metric.memoryUsage.toFixed(1)}%` : "-"}</span>
              </div>
              <div className="rounded-md bg-default-100/45 dark:bg-default-50/10 px-2 py-2">
                <Progress color={getColorByUsage(metric.memoryUsage)} size="sm" value={hasMetric ? metric.memoryUsage : 0} />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex gap-1 px-1 text-[11px] font-bold text-foreground uppercase tracking-wider">
              <span className="flex-1 text-left">上传</span>
              <span className="flex-1 text-right">下载</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex-1 min-w-0 h-8 rounded-md bg-default-100/45 dark:bg-default-50/10 px-2 flex items-center">
                <span className="font-mono text-xs font-semibold truncate text-foreground">{hasMetric ? formatBytesPerSecond(metric.netOutSpeed) : "-"}</span>
              </div>
              <div className="flex-1 min-w-0 h-8 rounded-md bg-default-100/45 dark:bg-default-50/10 px-2 flex items-center justify-end">
                <span className="font-mono text-xs font-semibold truncate text-foreground">{hasMetric ? formatBytesPerSecond(metric.netInSpeed) : "-"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-divider gap-1 whitespace-nowrap">
          <div className="flex items-center gap-1 min-w-0">
            <span className="inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 min-w-0">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="font-mono truncate">{hasMetric ? formatUptime(metric.uptime) : "-"}</span>
            </span>
          </div>
          <div className="inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0 ml-2">
            <Activity className="w-3 h-3" />
            <span className="font-mono">{hasMetric ? `Load ${metric.load1.toFixed(2)}` : "Load -"}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
