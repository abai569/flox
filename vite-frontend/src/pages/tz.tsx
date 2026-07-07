import type {
  MonitorPublicNodeInstanceGroupApiItem,
  MonitorPublicNodeInstanceGroupMemberApiItem,
} from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Link } from "@/shadcn-bridge/heroui/link";
import { getMonitorPublicNodeInstanceGroups } from "@/api";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { usePublicNodeRealtime } from "@/hooks/use-public-node-realtime";

const INSTANCE_TABLE_COLUMNS = [
  "5%",
  "8%",
  "11%",
  "11%",
  "14%",
  "9%",
  "12%",
  "10%",
  "10%",
  "10%",
] as const;

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

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 100) return 100;

  return value;
};

const getInstanceLabel = (displayIndex?: number): string => {
  const index = Number(displayIndex || 0);

  return `实例 ${index > 0 ? index : "-"}`;
};

function UsageMeter({
  value,
  tone,
}: {
  value: number;
  tone: "cpu" | "memory" | "disk";
}) {
  const percent = clampPercent(value);
  const colorClass =
    tone === "cpu"
      ? "bg-pink-500"
      : tone === "memory"
        ? "bg-violet-600"
        : "bg-indigo-500";

  return (
    <div className="relative h-7 w-full min-w-0 overflow-hidden rounded-md border border-default-300 bg-default-200/80">
      <div
        className={`absolute inset-y-0 left-0 ${colorClass}`}
        style={{ width: `${percent}%` }}
      />
      <div className="relative z-10 flex h-full items-center px-2 text-xs font-bold text-white tabular-nums">
        {percent.toFixed(1)}%
      </div>
    </div>
  );
}

function RegionCell({ value }: { value?: string }) {
  const text = value?.trim() || "-";

  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-secondary-500/10 px-2 py-0.5 text-xs text-secondary-700">
      <span className="truncate">{text}</span>
    </span>
  );
}

function InstanceRows({
  groups,
  loading,
}: {
  groups: MonitorPublicNodeInstanceGroupApiItem[];
  loading: boolean;
}) {
  if (loading && groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          正在加载探针数据...
        </CardBody>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500">
          暂无探针数据
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const totalOutSpeed = group.members.reduce(
          (sum, member) => sum + member.netOutSpeed,
          0,
        );
        const totalInSpeed = group.members.reduce(
          (sum, member) => sum + member.netInSpeed,
          0,
        );

        return (
          <section
            key={group.id}
            className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-sm"
          >
            <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot
                  active={group.status === 1}
                  tone={group.status === 1 ? "success" : "danger"}
                />
                <span className="truncate rounded-md border border-default-300 px-4 py-1.5 text-sm font-medium text-secondary">
                  {group.name} | ID: {group.id}
                </span>
                <span className="text-xs text-default-500">
                  {group.members.length} 个实例
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm font-mono">
                <span className="inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-secondary-500/15 px-3 py-2 text-secondary-700 tabular-nums">
                  {formatSpeed(totalOutSpeed)}
                  <ArrowUp className="h-4 w-4" />
                </span>
                <span className="inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500/15 px-3 py-2 text-primary-700 tabular-nums">
                  {formatSpeed(totalInSpeed)}
                  <ArrowDown className="h-4 w-4" />
                </span>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="min-w-[1040px] w-full table-fixed text-sm">
                  <colgroup>
                    {INSTANCE_TABLE_COLUMNS.map((width, index) => (
                      <col key={index} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="border-b border-default-400/70 text-sm text-foreground">
                    <tr>
                      <th className="px-2 py-2 text-center">状态</th>
                      <th className="px-2 py-2 text-center">实例</th>
                      <th className="px-2 py-2 text-center">v4 地区</th>
                      <th className="px-2 py-2 text-center">v6 地区</th>
                      <th className="px-2 py-2 text-center">速率</th>
                      <th className="px-2 py-2 text-center">开机时长</th>
                      <th className="px-2 py-2 text-center">流量</th>
                      <th className="px-2 py-2 text-center">CPU</th>
                      <th className="px-2 py-2 text-center">RAM</th>
                      <th className="px-2 py-2 text-center">存储</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.members.map((member) => (
                      <InstanceRow
                        key={`${group.id}:${member.displayIndex}`}
                        member={member}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function InstanceRow({
  member,
}: {
  member: MonitorPublicNodeInstanceGroupMemberApiItem;
}) {
  return (
    <tr className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50">
      <td className="px-2 py-3 text-center align-middle">
        <StatusDot
          active={member.status === 1}
          tone={member.status === 1 ? "success" : "danger"}
        />
      </td>
      <td className="px-2 py-3 text-center align-middle font-medium whitespace-nowrap">
        {getInstanceLabel(member.displayIndex)}
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <RegionCell value={member.publicIpV4Region} />
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <RegionCell value={member.publicIpV6Region} />
      </td>
      <td className="px-2 py-3 text-center align-middle font-mono text-xs leading-5 tabular-nums">
        <div className="truncate">{formatSpeed(member.netOutSpeed)}↑</div>
        <div className="truncate">{formatSpeed(member.netInSpeed)}↓</div>
      </td>
      <td className="px-2 py-3 text-center align-middle">
        <div className="truncate">{formatUptime(member.uptime)}</div>
      </td>
      <td className="px-2 py-3 text-center align-middle font-mono text-xs">
        <div className="truncate">{formatBytes(member.periodTx)}↑</div>
        <div className="truncate">{formatBytes(member.periodRx)}↓</div>
      </td>
      <td className="px-2 py-3 align-middle">
        <UsageMeter tone="cpu" value={member.cpuUsage} />
      </td>
      <td className="px-2 py-3 align-middle">
        <UsageMeter tone="memory" value={member.memoryUsage} />
      </td>
      <td className="px-2 py-3 align-middle">
        <UsageMeter tone="disk" value={member.diskUsage} />
      </td>
    </tr>
  );
}

export default function TZPage() {
  const [groups, setGroups] = useState<MonitorPublicNodeInstanceGroupApiItem[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<Record<number, number>>(
    {},
  );

  const loadGroups = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!silent) setLoading(true);
    try {
      const response = await getMonitorPublicNodeInstanceGroups();

      if (response.code === 0 && Array.isArray(response.data)) {
        setError(null);
        setGroups(response.data);
      } else {
        setGroups([]);
        setError(response.msg || "暂未开放公共监控");
      }
    } catch {
      setError("加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const handleRealtimeMessage = useCallback(
    (parsed: { id?: string | number; type?: string; data?: unknown }) => {
      const nodeId = Number(parsed.id);

      if (!nodeId || nodeId <= 0 || parsed.type !== "status") return;

      setRealtimeStatus((prev) => ({ ...prev, [nodeId]: Number(parsed.data) }));
    },
    [],
  );

  const { wsConnected, wsConnecting } = usePublicNodeRealtime({
    onMessage: handleRealtimeMessage,
    enabled: true,
  });

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadGroups({ silent: true });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [loadGroups]);

  usePullToRefresh(loadGroups);

  const displayGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        status: realtimeStatus[group.id] ?? group.status,
      })),
    [groups, realtimeStatus],
  );
  const nodeCount = displayGroups.length;
  const onlineNodeCount = displayGroups.filter((group) => group.status === 1).length;
  const instanceCount = displayGroups.reduce(
    (sum, group) => sum + group.members.length,
    0,
  );
  const onlineInstanceCount = displayGroups.reduce(
    (sum, group) =>
      sum + group.members.filter((member) => member.status === 1).length,
    0,
  );

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-1">
          <Button
            color="secondary"
            isLoading={loading}
            size="sm"
            variant="flat"
            onPress={() => loadGroups()}
          >
            刷新
          </Button>
          <Link className="ml-auto text-xs" color="foreground" href="/">
            返回
          </Link>
        </div>

        {!error && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-2 text-default-600">
              <StatusDot
                active={wsConnected}
                className="h-2 w-2"
                tone={
                  wsConnected ? "success" : wsConnecting ? "warning" : "default"
                }
              />
              {wsConnected
                ? "实时已连接"
                : wsConnecting
                  ? "实时连接中"
                  : "实时未连接"}
            </span>
            <span className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
              节点 {onlineNodeCount}/{nodeCount}
            </span>
            <span className="rounded-md bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">
              实例 {onlineInstanceCount}/{instanceCount}
            </span>
          </div>
        )}

        <div className="text-xs text-default-500">节点实例实时状态（公开探针）</div>

        {error ? (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">探针列表</h3>
            </CardHeader>
            <CardBody>
              <div className="text-sm text-default-600">{error}</div>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {!error && (
        <InstanceRows groups={displayGroups} loading={loading} />
      )}
    </AnimatedPage>
  );
}
