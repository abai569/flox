import type {
  MonitorTunnelApiItem,
  TunnelMetricApiItem,
  TunnelQualityApiItem,
} from "@/api/types";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  RefreshCw,
  ArrowLeft,
  Activity,
  Zap,
  Globe,
  ArrowRightLeft,
  Wifi,
  WifiOff,
  Eye,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  getMonitorTunnels,
  getTunnelMetrics,
  getMonitorTunnelQuality,
  getMonitorTunnelQualityHistory,
} from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";

interface TunnelMonitorViewProps {
  viewMode?: "list" | "grid";
  refreshTrigger?: number;
  onLoadingChange?: (loading: boolean) => void;
}

const QUALITY_POLL_INTERVAL = 10_000; // 1 second

const formatTimestamp = (ts: number, rangeMs?: number): string => {
  const date = new Date(ts);
  const includeDate = (rangeMs ?? 0) >= 24 * 60 * 60 * 1000;

  if (includeDate) {
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/** Render a colored latency value with appropriate visual cue */
function LatencyDisplay({
  value,
  loading,
}: {
  value?: number;
  loading?: boolean;
}) {
  if (loading) {
    return <RefreshCw className="w-3 h-3 animate-spin inline text-primary" />;
  }
  if (value === undefined || value < 0) {
    return <span className="text-default-400">-</span>;
  }
  const ms = value.toFixed(0);
  let colorClass = "text-success";

  if (value > 200) colorClass = "text-danger";
  else if (value > 100) colorClass = "text-warning";
  else if (value > 50) colorClass = "text-primary";

  return (
    <span className={`font-mono text-xs font-semibold ${colorClass}`}>
      {ms}ms
    </span>
  );
}

/** Animated pulse dot for live status */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
    </span>
  );
}

const UPTIME_KUMA_BARS_COUNT = 30;

function UptimeHistoryBar({
  history = [],
  type,
  latestValue,
}: {
  history: TunnelQualityApiItem[];
  type: "entryToExit" | "exitToBing";
  latestValue?: number;
}) {
  const bars = [...Array(UPTIME_KUMA_BARS_COUNT)].map((_, i) => {
    const historyIndex = history.length - UPTIME_KUMA_BARS_COUNT + i;

    if (historyIndex >= 0 && historyIndex < history.length) {
      return history[historyIndex];
    }

    return null;
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-[3px]">
        {bars.map((q, idx) => {
          if (!q) {
            return (
              <div
                key={idx}
                className="w-1.5 h-4 rounded-full bg-default-200 dark:bg-default-100/50"
                title="暂无数据"
              />
            );
          }
          const isEntry = type === "entryToExit";
          const latency = isEntry ? q.entryToExitLatency : q.exitToBingLatency;
          const loss = isEntry ? q.entryToExitLoss : q.exitToBingLoss;
          const timeStr = new Date(q.timestamp).toLocaleTimeString("zh-CN");

          let colorClass = "bg-success";
          let statusText = "优秀";

          if (q.errorMessage || (loss !== undefined && loss > 0)) {
            colorClass = "bg-danger";
            statusText = q.errorMessage ? "错误" : `丢包 ${loss?.toFixed(1)}%`;
          } else if (latency < 0) {
            colorClass = "bg-danger";
            statusText = "探测失败";
          } else if (latency > 200) {
            colorClass = "bg-danger";
            statusText = "极差";
          } else if (latency > 100) {
            colorClass = "bg-warning";
            statusText = "较差";
          }

          const displayLatency = latency >= 0 ? `${latency.toFixed(0)}ms` : "-";
          const tooltip = `${timeStr} | ${displayLatency} | ${statusText}`;

          return (
            <div
              key={q.timestamp || idx}
              className={`w-1.5 h-4 rounded-full transition-colors cursor-help hover:opacity-80 ${colorClass}`}
              title={tooltip}
            />
          );
        })}
      </div>
      <div>
        <LatencyDisplay value={latestValue} />
      </div>
    </div>
  );
}

/* ─── Module-level constants & memoized sub-components ────────────── */

const TIME_RANGE_OPTIONS = [
  { key: String(15 * 60 * 1000), label: "15分钟" },
  { key: String(60 * 60 * 1000), label: "1小时" },
  { key: String(6 * 60 * 60 * 1000), label: "6小时" },
  { key: String(24 * 60 * 60 * 1000), label: "24小时" },
];

function TimeRangeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Select
      className="w-22 sm:w-30"
      selectedKeys={[String(value)]}
      size="sm"
      onSelectionChange={(keys) => {
        const v = Number(Array.from(keys)[0]);

        if (v > 0) onChange(v);
      }}
    >
      {TIME_RANGE_OPTIONS.map((opt) => (
        <SelectItem key={opt.key}>{opt.label}</SelectItem>
      ))}
    </Select>
  );
}

interface QualityChartCardProps {
  rangeMs: number;
  onRangeChange: (v: number) => void;
  loading: boolean;
  error: string | null;
  data: Array<{
    time: string;
    entryToExit: number | null;
    exitToBing: number | null;
  }>;
  tunnelId: number;
  onRefresh: (id: number) => void;
}

const QualityChartCard = React.memo(function QualityChartCard({
  rangeMs,
  onRangeChange,
  loading,
  error,
  data,
  tunnelId,
  onRefresh,
}: QualityChartCardProps) {
  return (
    <Card className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <h3 className="text-lg font-semibold">质量趋势</h3>
        <div className="flex items-center gap-2">
          <TimeRangeSelect value={rangeMs} onChange={onRangeChange} />
          <Button
            isLoading={loading}
            size="sm"
            variant="flat"
            onPress={() => onRefresh(tunnelId)}
          >
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-danger text-sm">{error}</div>
        ) : data.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={data}>
                <CartesianGrid opacity={0.3} strokeDasharray="3 3" />
                <XAxis dataKey="time" fontSize={11} tick={{ fill: "#888" }} />
                <YAxis
                  fontSize={11}
                  label={{
                    value: "延迟 (ms)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11, fill: "#888" },
                  }}
                  tick={{ fill: "#888" }}
                  tickFormatter={(v: any) => `${Number(v).toFixed(0)}ms`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(0,0,0,0.85)",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  formatter={(value: unknown, name: string) => {
                    const n = Number(value);

                    if (!Number.isFinite(n)) return "-";
                    const label =
                      name === "entryToExit"
                        ? "入口→出口"
                        : name === "exitToBing"
                          ? "出口→Bing"
                          : name;

                    return [`${n.toFixed(1)}ms`, label];
                  }}
                  labelStyle={{ color: "#fff" }}
                />
                <Line
                  connectNulls
                  dataKey="entryToExit"
                  dot={false}
                  name="entryToExit"
                  stroke="#10b981"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  connectNulls
                  dataKey="exitToBing"
                  dot={false}
                  name="exitToBing"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-8 text-default-500">
            暂无质量历史数据
          </div>
        )}
      </CardBody>
    </Card>
  );
});

interface TrafficChartCardProps {
  rangeMs: number;
  onRangeChange: (v: number) => void;
  loading: boolean;
  error: string | null;
  data: Array<{
    time: string;
    bytesIn: number;
    bytesOut: number;
    connections: number;
  }>;
  tunnelId: number;
  onRefresh: (id: number) => void;
}

const TrafficChartCard = React.memo(function TrafficChartCard({
  rangeMs,
  onRangeChange,
  loading,
  error,
  data,
  tunnelId,
  onRefresh,
}: TrafficChartCardProps) {
  const yFormatter = (value: unknown) => {
    const n = Number(value);

    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(n) / Math.log(k));

    return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <Card className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <h3 className="text-lg font-semibold">流量趋势</h3>
        <div className="flex items-center gap-2">
          <TimeRangeSelect value={rangeMs} onChange={onRangeChange} />
          <Button
            isLoading={loading}
            size="sm"
            variant="flat"
            onPress={() => onRefresh(tunnelId)}
          >
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-danger text-sm">{error}</div>
        ) : data.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={data}>
                <CartesianGrid opacity={0.3} strokeDasharray="3 3" />
                <XAxis dataKey="time" fontSize={11} tick={{ fill: "#888" }} />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "#888" }}
                  tickFormatter={yFormatter}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(0,0,0,0.85)",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  formatter={yFormatter}
                  labelStyle={{ color: "#fff" }}
                />
                <Line
                  dataKey="bytesIn"
                  dot={false}
                  name="入站流量"
                  stroke="#10b981"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="bytesOut"
                  dot={false}
                  name="出站流量"
                  stroke="#ef4444"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-8 text-default-500">暂无流量数据</div>
        )}
      </CardBody>
    </Card>
  );
});

export function TunnelMonitorView({
  viewMode = "grid",
  refreshTrigger,
  onLoadingChange,
}: TunnelMonitorViewProps) {
  const [tunnels, setTunnels] = useState<MonitorTunnelApiItem[]>([]);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);

  useEffect(() => {
    onLoadingChange?.(tunnelsLoading);
  }, [tunnelsLoading, onLoadingChange]);
  const [tunnelsError, setTunnelsError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<string | null>(null);

  // Quality data from backend periodic probing (latest per tunnel)
  const [qualityMap, setQualityMap] = useState<
    Record<number, TunnelQualityApiItem>
  >({});
  const [qualityHistoryMap, setQualityHistoryMap] = useState<
    Record<number, TunnelQualityApiItem[]>
  >({});
  const initialHistoryFetched = useRef(false);
  const [qualityLoading, setQualityLoading] = useState(false);
  const qualityTimerRef = useRef<number | null>(null);

  // Detail view state
  const [detailTunnelId, setDetailTunnelId] = useState<number | null>(null);

  // Quality history for chart (mirrors service monitor results)
  const [qualityHistory, setQualityHistory] = useState<TunnelQualityApiItem[]>(
    [],
  );
  const [qualityHistoryLoading, setQualityHistoryLoading] = useState(false);
  const [qualityHistoryError, setQualityHistoryError] = useState<string | null>(
    null,
  );
  const [qualityRangeMs, setQualityRangeMs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tunnel-monitor-quality-range");

      if (saved) return Number(saved);
    } catch { }

    return 60 * 60 * 1000;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "tunnel-monitor-quality-range",
        String(qualityRangeMs),
      );
    } catch { }
  }, [qualityRangeMs]);

  // Tunnel traffic metrics for chart
  const [tunnelMetrics, setTunnelMetrics] = useState<TunnelMetricApiItem[]>([]);
  const [tunnelMetricsLoading, setTunnelMetricsLoading] = useState(false);
  const [tunnelMetricsError, setTunnelMetricsError] = useState<string | null>(
    null,
  );
  const [tunnelRangeMs, setTunnelRangeMs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tunnel-monitor-traffic-range");

      if (saved) return Number(saved);
    } catch { }

    return 60 * 60 * 1000;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "tunnel-monitor-traffic-range",
        String(tunnelRangeMs),
      );
    } catch { }
  }, [tunnelRangeMs]);

  // --- Load tunnel list ---
  const loadTunnels = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!silent) setTunnelsLoading(true);
    try {
      const response = await getMonitorTunnels();

      if (response.code === 0 && response.data) {
        setAccessDenied(null);
        setTunnelsError(null);
        setTunnels(response.data);

        return;
      }
      if (response.code === 403) {
        setAccessDenied(response.msg || "暂无监控权限，请联系管理员授权");
        setTunnelsError(null);
        setTunnels([]);

        return;
      }
      setTunnelsError(response.msg || "加载隧道列表失败");
      if (!silent) toast.error(response.msg || "加载隧道列表失败");
    } catch {
      if (!silent) {
        setTunnelsError("加载隧道列表失败");
        toast.error("加载隧道列表失败");
      }
    } finally {
      if (!silent) setTunnelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTunnels();
  }, [loadTunnels, refreshTrigger]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTunnels({ silent: true });
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [loadTunnels]);

  // --- Initial history load ---
  useEffect(() => {
    if (tunnels.length > 0 && !initialHistoryFetched.current) {
      initialHistoryFetched.current = true;
      const fetchHistory = async () => {
        const end = Date.now();
        // Fetch last 5 minutes (about 30 points)
        const start = end - 5 * 60 * 1000;

        const promises = tunnels.map((t) =>
          getMonitorTunnelQualityHistory(t.id, start, end)
            .then((res) => {
              if (res.code === 0 && res.data) {
                return { id: t.id, data: res.data };
              }

              return { id: t.id, data: [] };
            })
            .catch(() => ({ id: t.id, data: [] })),
        );

        const results = await Promise.all(promises);

        setQualityHistoryMap((prev) => {
          const nextMap = { ...prev };

          results.forEach((r) => {
            const existing = nextMap[r.id] || [];
            const merged = [...r.data, ...existing].sort(
              (a, b) => a.timestamp - b.timestamp,
            );
            const unique: TunnelQualityApiItem[] = [];

            for (const item of merged) {
              if (
                unique.length === 0 ||
                unique[unique.length - 1].timestamp !== item.timestamp
              ) {
                unique.push(item);
              }
            }
            nextMap[r.id] = unique.slice(-UPTIME_KUMA_BARS_COUNT);
          });

          return nextMap;
        });
      };

      void fetchHistory();
    }
  }, [tunnels]);

  // --- Load quality snapshots (auto-polling every 10s) ---
  const loadQuality = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!silent) setQualityLoading(true);
    try {
      const response = await getMonitorTunnelQuality();

      if (response.code === 0 && Array.isArray(response.data)) {
        const map: Record<number, TunnelQualityApiItem> = {};

        for (const q of response.data) {
          map[q.tunnelId] = q;
        }
        setQualityMap(map);

        // Accumulate locally
        setQualityHistoryMap((prev) => {
          const nextMap = { ...prev };

          for (const q of response.data) {
            const currentArr = nextMap[q.tunnelId] || [];
            const lastItem =
              currentArr.length > 0 ? currentArr[currentArr.length - 1] : null;

            if (!lastItem || lastItem.timestamp !== q.timestamp) {
              nextMap[q.tunnelId] = [...currentArr, q].slice(
                -UPTIME_KUMA_BARS_COUNT,
              );
            }
          }

          return nextMap;
        });
      }
    } catch {
      // Silently ignore quality load failures
    } finally {
      if (!silent) setQualityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuality();
  }, [loadQuality]);

  useEffect(() => {
    qualityTimerRef.current = window.setInterval(() => {
      void loadQuality({ silent: true });
    }, QUALITY_POLL_INTERVAL);

    return () => {
      if (qualityTimerRef.current) {
        window.clearInterval(qualityTimerRef.current);
      }
    };
  }, [loadQuality]);

  // --- Load quality history for detail chart ---
  const loadQualityHistory = useCallback(
    async (tunnelId: number, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!silent) setQualityHistoryLoading(true);
      try {
        const end = Date.now();
        const start = end - qualityRangeMs;
        const response = await getMonitorTunnelQualityHistory(
          tunnelId,
          start,
          end,
        );

        if (response.code === 0 && Array.isArray(response.data)) {
          setQualityHistoryError(null);
          setQualityHistory(response.data);

          return;
        }
        if (response.code === 403) {
          setAccessDenied(response.msg || "暂无监控权限");

          return;
        }
        setQualityHistoryError(response.msg || "加载质量历史失败");
        if (!silent) toast.error(response.msg || "加载质量历史失败");
      } catch {
        if (!silent) {
          setQualityHistoryError("加载质量历史失败");
        }
      } finally {
        if (!silent) setQualityHistoryLoading(false);
      }
    },
    [qualityRangeMs],
  );

  // --- Load tunnel traffic metrics for detail chart ---
  const loadTunnelMetrics = useCallback(
    async (tunnelId: number, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!silent) setTunnelMetricsLoading(true);
      try {
        const end = Date.now();
        const start = end - tunnelRangeMs;
        const response = await getTunnelMetrics(tunnelId, start, end);

        if (response.code === 0 && Array.isArray(response.data)) {
          setTunnelMetricsError(null);
          const ordered = [...response.data].sort(
            (a, b) => a.timestamp - b.timestamp,
          );

          setTunnelMetrics(ordered);

          return;
        }
        setTunnelMetricsError(response.msg || "加载流量数据失败");
      } catch {
        if (!silent) setTunnelMetricsError("加载流量数据失败");
      } finally {
        if (!silent) setTunnelMetricsLoading(false);
      }
    },
    [tunnelRangeMs],
  );

  useEffect(() => {
    if (detailTunnelId) {
      void loadQualityHistory(detailTunnelId);
      void loadTunnelMetrics(detailTunnelId);
    }
  }, [detailTunnelId, loadQualityHistory, loadTunnelMetrics]);

  // Auto-refresh detail charts
  useEffect(() => {
    if (!detailTunnelId) return;
    const timer = window.setInterval(() => {
      void loadQualityHistory(detailTunnelId, { silent: true });
      void loadTunnelMetrics(detailTunnelId, { silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [detailTunnelId, loadQualityHistory, loadTunnelMetrics]);

  // Memoize chart data so React.memo sub-components see stable references
  const qualityChartData = useMemo(
    () =>
      qualityHistory.map((q) => ({
        time: formatTimestamp(q.timestamp, qualityRangeMs),
        entryToExit: q.entryToExitLatency >= 0 ? q.entryToExitLatency : null,
        exitToBing: q.exitToBingLatency >= 0 ? q.exitToBingLatency : null,
        entryToExitLoss: q.entryToExitLoss,
        exitToBingLoss: q.exitToBingLoss,
      })),
    [qualityHistory, qualityRangeMs],
  );

  const tunnelChartData = useMemo(
    () =>
      tunnelMetrics.map((m) => ({
        time: formatTimestamp(m.timestamp, tunnelRangeMs),
        bytesIn: m.bytesIn,
        bytesOut: m.bytesOut,
        connections: m.connections,
      })),
    [tunnelMetrics, tunnelRangeMs],
  );

  const detailTunnel =
    detailTunnelId != null
      ? tunnels.find((t) => t.id === detailTunnelId)
      : null;

  // Aggregate stats
  const tunnelStats = useMemo(() => {
    const enabled = tunnels.filter((t) => t.status === 1).length;

    return { total: tunnels.length, enabled };
  }, [tunnels]);

  // Last quality update timestamp
  const lastQualityUpdate = useMemo(() => {
    let latest = 0;

    for (const q of Object.values(qualityMap)) {
      if (q.timestamp > latest) latest = q.timestamp;
    }

    return latest > 0 ? new Date(latest).toLocaleTimeString("zh-CN") : null;
  }, [qualityMap]);

  // =====================
  // RENDER
  // =====================

  if (accessDenied) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Activity className="w-5 h-5 text-warning" />
          <h3 className="text-lg font-semibold">监控权限</h3>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="text-sm text-default-600">{accessDenied}</div>
          <div className="text-xs text-default-500 mt-2">
            如需使用监控功能，请联系管理员在用户页面授予监控权限。
          </div>
        </CardBody>
      </Card>
    );
  }

  // ===== DETAIL VIEW =====
  if (detailTunnelId && detailTunnel) {
    const quality = qualityMap[detailTunnelId];

    return (
      <div className="space-y-6">
        {/* 详情页统一头部 */}
        <Card className="border border-divider bg-content1 shadow-sm">
          <CardBody className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-3 px-4">
            <div className="flex items-center gap-4">
              <Button
                size="sm"
                variant="flat"
                className="bg-default-100 hover:bg-default-200 font-medium"
                onPress={() => {
                  setDetailTunnelId(null);
                  setQualityHistory([]);
                  setTunnelMetrics([]);
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                返回列表
              </Button>
              <div className="w-[1px] h-5 bg-divider hidden sm:block"></div>
              <div className="flex items-center gap-2.5">
                <ArrowRightLeft
                  className={`w-5 h-5 ${detailTunnel.status === 1 ? "text-success" : "text-default-400"}`}
                />
                <h3 className="text-lg font-bold text-foreground">{detailTunnel.name}</h3>
                <Chip
                  className="rounded-md font-medium"
                  color={detailTunnel.status === 1 ? "success" : "danger"}
                  size="sm"
                  variant="flat"
                >
                  {detailTunnel.status === 1 ? "启用" : "禁用"}
                </Chip>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-default-600 bg-default-100/50 px-3 py-1.5 rounded-full border border-divider">
              <LiveDot />
              <span className="font-medium">实时已连接</span>
            </div>
          </CardBody>
        </Card>

        {/* Quality KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card
            key="entry-exit-latency"
            className="border border-divider bg-content1 shadow-sm hover:shadow-md transition-shadow h-full flex items-center justify-center p-4"
          >
            <div className="flex flex-col items-center gap-2">
              <span className="text-foreground text-xs font-bold text-default-500 uppercase tracking-wider flex items-center gap-1">
                <Zap className="w-3 h-3" />
                入口 → 出口 延迟
              </span>
              {qualityLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              ) : quality?.entryToExitLatency !== undefined &&
                quality?.entryToExitLatency >= 0 ? (
                <span
                  className={`text-lg font-bold font-mono ${quality.entryToExitLatency > 200 ? "text-danger" : quality.entryToExitLatency > 100 ? "text-warning" : quality.entryToExitLatency > 50 ? "text-primary" : "text-success"}`}
                >
                  {quality.entryToExitLatency.toFixed(0)}ms
                </span>
              ) : (
                <span className="text-lg font-bold font-mono text-default-400">
                  -
                </span>
              )}
            </div>
          </Card>
          <Card
            key="exit-bing-latency"
            className="border border-divider bg-content1 shadow-sm hover:shadow-md transition-shadow h-full flex items-center justify-center p-4"
          >
            <div className="flex flex-col items-center gap-2">
              <span className="text-foreground text-xs font-bold text-default-500 uppercase tracking-wider flex items-center gap-1">
                <Globe className="w-3 h-3" />
                出口 → Bing 延迟
              </span>
              {qualityLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              ) : quality?.exitToBingLatency !== undefined &&
                quality?.exitToBingLatency >= 0 ? (
                <span
                  className={`text-lg font-bold font-mono ${quality.exitToBingLatency > 200 ? "text-danger" : quality.exitToBingLatency > 100 ? "text-warning" : quality.exitToBingLatency > 50 ? "text-primary" : "text-success"}`}
                >
                  {quality.exitToBingLatency.toFixed(0)}ms
                </span>
              ) : (
                <span className="text-lg font-bold font-mono text-default-400">
                  -
                </span>
              )}
            </div>
          </Card>
          <Card
            key="entry-exit-loss"
            className="border border-divider bg-content1 shadow-sm hover:shadow-md transition-shadow h-full flex items-center justify-center p-4"
          >
            <div className="flex flex-col items-center gap-2">
              <span className="text-foreground text-xs font-bold text-default-500 uppercase tracking-wider">
                入口 → 出口 丢包
              </span>
              <span
                className={`text-lg font-bold font-mono ${(quality?.entryToExitLoss ?? 0) > 0 ? "text-warning" : "text-success"}`}
              >
                {quality?.entryToExitLoss !== undefined
                  ? `${quality.entryToExitLoss.toFixed(1)}%`
                  : "-"}
              </span>
            </div>
          </Card>
          <Card
            key="exit-bing-loss"
            className="border border-divider bg-content1 shadow-sm hover:shadow-md transition-shadow h-full flex items-center justify-center p-4"
          >
            <div className="flex flex-col items-center gap-2">
              <span className="text-foreground text-xs font-bold text-default-500 uppercase tracking-wider">
                出口 → Bing 丢包
              </span>
              <span
                className={`text-lg font-bold font-mono ${(quality?.exitToBingLoss ?? 0) > 0 ? "text-warning" : "text-success"}`}
              >
                {quality?.exitToBingLoss !== undefined
                  ? `${quality.exitToBingLoss.toFixed(1)}%`
                  : "-"}
              </span>
            </div>
          </Card>
        </div>

        {/* Auto-probe status */}
        <div className="flex items-center gap-2 text-xs text-default-500">
          <LiveDot />
          <span>自动探测中（每秒测试，30秒上报）</span>
          {quality?.timestamp && (
            <span className="text-default-400">
              · 最近更新:{" "}
              {new Date(quality.timestamp).toLocaleTimeString("zh-CN")}
            </span>
          )}
          {quality?.errorMessage && (
            <span className="text-danger ml-2">{quality.errorMessage}</span>
          )}
        </div>

        {/* ====== Quality History Chart — isolated with React.memo ====== */}
        <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md p-4">
          <QualityChartCard
            data={qualityChartData}
            error={qualityHistoryError}
            loading={qualityHistoryLoading}
            rangeMs={qualityRangeMs}
            tunnelId={detailTunnelId}
            onRangeChange={setQualityRangeMs}
            onRefresh={loadQualityHistory}
          />
        </div>

        {/* ====== Traffic Chart — isolated with React.memo ====== */}
        <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md p-4">
          <TrafficChartCard
            data={tunnelChartData}
            error={tunnelMetricsError}
            loading={tunnelMetricsLoading}
            rangeMs={tunnelRangeMs}
            tunnelId={detailTunnelId}
            onRangeChange={setTunnelRangeMs}
            onRefresh={loadTunnelMetrics}
          />
        </div>
      </div>
    );
  }

  // ===== LIST/GRID VIEW =====
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-wrap items-center gap-3 mb-0">
        {lastQualityUpdate && (
          <div className="flex items-center gap-2 text-xs text-default-500">
            <LiveDot />
            <span>每秒探测 · 更新于 {lastQualityUpdate}</span>
          </div>
        )}
        <Chip className="rounded-md" color="primary" size="sm" variant="flat">
          隧道 {tunnelStats.enabled}/{tunnelStats.total}
        </Chip>
        {/* <div className="ml-auto">
          <Button isLoading={tunnelsLoading} size="sm" variant="flat" onPress={() => loadTunnels()}>
            刷新
          </Button>
        </div> */}
      </div>

      {tunnelsError ? (
        <Card>
          <CardBody className="space-y-4">
            <div className="text-sm text-default-600">{tunnelsError}</div>
          </CardBody>
        </Card>
      ) : null}

      {viewMode === "grid" ? (
        <div className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-md">
          <div className="flex items-center justify-between border-b border-divider bg-default-100/40 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">
              隧道监控数量
            </span>
            <span className="text-xs text-default-500 whitespace-nowrap">
              {tunnels.length} 个监控
            </span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {tunnels.map((tunnel) => {
                const quality = qualityMap[tunnel.id];
                const isEnabled = tunnel.status === 1;

                return (
                  <Card
                    key={tunnel.id}
                    className="group h-full flex flex-col overflow-hidden border border-divider bg-content1 shadow-sm transition-shadow duration-200 hover:shadow-md cursor-pointer"
                    onClick={() => setDetailTunnelId(tunnel.id)}
                  >
                    <CardHeader className="pb-3 md:pb-3">
                      <div className="flex flex-col gap-2 w-full">
                        <div className="flex items-start justify-between w-full gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="relative flex-shrink-0">
                              <div className="w-10 h-10 rounded-xl bg-default-100/70 dark:bg-default-50/10 flex items-center justify-center border border-divider">
                                <ArrowRightLeft
                                  className={`w-5 h-5 ${isEnabled ? "text-success" : "text-danger"}`}
                                />
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${isEnabled ? "bg-success" : "bg-danger"}`}
                              />
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <h3 className="font-semibold text-foreground text-sm truncate">
                                {tunnel.name}
                              </h3>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span
                                  className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${isEnabled ? "bg-success-500/10 text-success-600 dark:text-success-400" : "bg-danger-500/10 text-danger-600 dark:text-danger-400"}`}
                                >
                                  {isEnabled ? "启用" : "禁用"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="relative flex-shrink-0">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              onPress={() => setDetailTunnelId(tunnel.id)}
                            >
                              <Eye className="w-4 h-4 text-primary" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardBody className="flex flex-1 flex-col pt-0 pb-3">
                      <div className="space-y-2.5 flex-1 py-1">
                        <div className="grid grid-cols-2 gap-3 w-full">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center justify-between px-1 text-[11px] font-bold text-foreground uppercase tracking-wider">
                              <div className="flex items-center gap-1">
                                <Zap className="w-3 h-3 text-default-500" />
                                <span className="text-default-500">入→出</span>
                              </div>
                              <LatencyDisplay
                                loading={qualityLoading}
                                value={quality?.entryToExitLatency}
                              />
                            </div>
                            <UptimeHistoryBar
                              history={qualityHistoryMap[tunnel.id]}
                              latestValue={quality?.entryToExitLatency}
                              type="entryToExit"
                            />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center justify-between px-1 text-[11px] font-bold text-foreground uppercase tracking-wider">
                              <div className="flex items-center gap-1">
                                <Globe className="w-3 h-3 text-default-500" />
                                <span className="text-default-500">
                                  出→Bing
                                </span>
                              </div>
                              <LatencyDisplay
                                loading={qualityLoading}
                                value={quality?.exitToBingLatency}
                              />
                            </div>
                            <UptimeHistoryBar
                              history={qualityHistoryMap[tunnel.id]}
                              latestValue={quality?.exitToBingLatency}
                              type="exitToBing"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-divider mt-1">
                        <span
                          className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${isEnabled ? "bg-primary-500/10 text-primary-500 dark:text-primary-400" : "bg-default-500/10 text-default-500"}`}
                        >
                          {isEnabled ? "活跃" : "静止"}
                        </span>
                        {quality?.errorMessage ? (
                          <span className="text-[11px] text-danger truncate">
                            {quality.errorMessage}
                          </span>
                        ) : quality?.timestamp ? (
                          <span className="text-[11px] text-default-500 flex items-center gap-1">
                            <LiveDot />
                            {new Date(quality.timestamp).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </span>
                        ) : (
                          <span className="text-[11px] text-default-400">
                            等待探测...
                          </span>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <Card className="w-full">
          <Table
            aria-label="隧道列表"
            className="overflow-x-auto min-w-full"
            classNames={{
              th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider whitespace-nowrap",
              td: "border-b border-divider/50 group-data-[last=true]:border-b-0 align-middle p-3",
              tr: "hover:bg-default-50/50 transition-colors",
            }}
          >
            <TableHeader>
              <TableColumn align="center" className="w-[60px] text-center">状态</TableColumn>
              <TableColumn align="center" className="w-[100px] text-center">查看</TableColumn>
              <TableColumn align="start">
                隧道监控名称
                <span className="text-primary-600 font-bold text-[10px] ml-1">
                  ^{tunnels.length}个
                </span>
              </TableColumn>
              <TableColumn align="start">入口→出口</TableColumn>
              <TableColumn align="start">出口→Bing</TableColumn>
              <TableColumn align="center" className="text-center">更新时间</TableColumn>
            </TableHeader>
            <TableBody emptyContent="暂无隧道">
              {tunnels.map((tunnel) => {
                const quality = qualityMap[tunnel.id];
                const hasQualityData = quality !== undefined;

                return (
                  <TableRow
                    key={tunnel.id}
                    className="cursor-pointer h-16"
                    onClick={() => setDetailTunnelId(tunnel.id)}
                  >
                    <TableCell>
                      <div className="flex justify-center items-center w-full gap-1.5">
                        {hasQualityData ? (
                          <Wifi className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <WifiOff className="w-3.5 h-3.5 text-default-300" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-center w-full">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          onPress={() => setDetailTunnelId(tunnel.id)}
                        >
                          <Eye className="w-4 h-4 text-primary" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-sm whitespace-nowrap">
                        {tunnel.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <UptimeHistoryBar
                        history={qualityHistoryMap[tunnel.id]}
                        latestValue={quality?.entryToExitLatency}
                        type="entryToExit"
                      />
                    </TableCell>
                    <TableCell>
                      <UptimeHistoryBar
                        history={qualityHistoryMap[tunnel.id]}
                        latestValue={quality?.exitToBingLatency}
                        type="exitToBing"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-center w-full">
                        {quality?.timestamp ? (
                          <span className="text-xs text-default-500 flex items-center gap-1 whitespace-nowrap tabular-nums">
                            <LiveDot />
                            {new Date(quality.timestamp).toLocaleTimeString(
                              "zh-CN",
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-default-400">-</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
