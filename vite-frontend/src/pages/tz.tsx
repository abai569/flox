import type {
  MonitorPublicNodeInstanceGroupApiItem,
  MonitorPublicNodeInstanceGroupMemberApiItem,
} from "@/api/types";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { AnimatedPage } from "@/components/animated-page";
import { CountryFlag } from "@/components/country-flag";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { getMonitorPublicNodeInstanceGroups } from "@/api";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useNodeRealtime } from "@/pages/node/use-node-realtime";
import { MoonFilledIcon, SunFilledIcon } from "@/components/icons";
import { useThemeContext } from "@/themes/context";

const INSTANCE_TABLE_COLUMNS = [
  "56px",
  "150px",
  "150px",
  "150px",
  "132px",
  "104px",
  "124px",
  "112px",
  "112px",
  "112px",
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

const getInstanceLabel = (displayIndex?: number, displayName?: string): string => {
  const name = displayName?.trim();

  if (name) return name;
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

function RegionCell({ countryCode, value }: { countryCode?: string; value?: string }) {
  const parts = (value?.trim() || "").split(/\s+/).filter(Boolean);
  let text = value?.trim() || "-";

  if (parts.length > 2) {
    const country = ["香港", "澳门", "台湾"].includes(parts[0]) ? "中国" : parts[0];

    if (parts.includes("香港")) text = "中国 香港";
    else if (parts.includes("澳门")) text = "中国 澳门";
    else if (parts.includes("台湾")) {
      const cityParts = parts.slice(1).filter((part) => !["中国", "台湾"].includes(part));
      const city = cityParts.length ? cityParts[cityParts.length - 1] : "";

      text = city ? `中国 ${city}` : "中国 台湾";
    } else if (country === "日本" && parts[1]) {
      text = `日本 ${parts[1]}`;
    } else {
      const cityParts = parts.slice(1);
      const city = cityParts.length ? cityParts[cityParts.length - 1] : "";

      text = city ? `${country} ${city}` : country;
    }
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary-500/10 px-2 py-0.5 text-xs text-secondary-700 dark:text-secondary-200">
      <CountryFlag code={countryCode} title={text} />
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
        <CardBody className="py-12 text-center text-sm text-default-500 dark:text-default-300">
          正在加载探针数据...
        </CardBody>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-default-500 dark:text-default-300">
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
            <div className="flex w-full items-center gap-2 px-3 py-3 md:justify-start md:px-4 md:py-4">
              <div className="flex min-w-0 shrink items-center gap-2 md:flex-none">
                <span className="min-w-0 max-w-[82px] truncate rounded-md border border-default-300 px-2 py-1.5 text-xs font-medium text-secondary sm:max-w-[140px] md:max-w-none md:px-4 md:text-sm">
                  {group.name} | ID: {group.id}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1 font-mono text-xs md:flex-none md:gap-2 md:text-sm">
                <span className="inline-flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-secondary-500/15 px-1 text-secondary-700 dark:text-secondary-200 tabular-nums md:w-[176px] md:flex-none md:gap-2 md:px-3">
                  {formatSpeed(totalOutSpeed)}
                  <ArrowUp className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </span>
                <span className="inline-flex h-[30px] min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-primary-500/15 px-1 text-primary-700 dark:text-primary-200 tabular-nums md:w-[176px] md:flex-none md:gap-2 md:px-3">
                  {formatSpeed(totalInSpeed)}
                  <ArrowDown className="h-3.5 w-3.5 md:h-4 md:w-4" />
                </span>
              </div>
            </div>
            <div className="px-3 pb-4">
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[1202px] table-fixed text-sm">
                  <colgroup>
                    {INSTANCE_TABLE_COLUMNS.map((width, index) => (
                      <col key={index} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead className="border-b border-default-400/70 text-sm text-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-1 py-2 text-center">状态</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">
                        实例
                        <span className="text-xs text-primary-500 font-normal">
                          ^{group.members.length}个
                        </span>
                      </th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">v4 地区</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">v6 地区</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">速率</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">开机时长</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">流量</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">CPU</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">RAM</th>
                      <th className="whitespace-nowrap px-1 py-2 text-center">存储</th>
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

type RealtimeMetricSnapshot = Partial<MonitorPublicNodeInstanceGroupMemberApiItem> & { instanceId?: string };

function mergeRealtimeMember(
  member: MonitorPublicNodeInstanceGroupMemberApiItem,
  realtimeMetrics: Record<number, RealtimeMetricSnapshot[]>,
) {
  const list = realtimeMetrics[member.nodeId];
  if (!list || list.length === 0) return member;

  const memberId = member.instanceId?.trim() || "";
  if (memberId) {
    const byId = list.find((m) => m.instanceId === memberId);
    if (byId) return { ...member, ...byId };
  }

  const pos = (member.displayIndex || 1) - 1;
  if (pos >= 0 && pos < list.length) {
    return { ...member, ...list[pos] };
  }

  return member;
}

function InstanceRow({
  member,
}: {
  member: MonitorPublicNodeInstanceGroupMemberApiItem;
}) {
  return (
    <tr className="border-b border-divider/50 last:border-b-0 hover:bg-default-50/50">
      <td className="px-1 py-3 text-center align-middle">
        <StatusDot
          active={member.status === 1}
          tone={member.status === 1 ? "success" : "danger"}
        />
      </td>
      <td className="px-1 py-3 text-center align-middle font-medium whitespace-nowrap">
        {getInstanceLabel(member.displayIndex, member.displayName)}
      </td>
      <td className="px-1 py-3 text-center align-middle">
        <RegionCell countryCode={member.publicIpV4CountryCode} value={member.publicIpV4Region} />
      </td>
      <td className="px-1 py-3 text-center align-middle">
        <RegionCell countryCode={member.publicIpV6CountryCode} value={member.publicIpV6Region} />
      </td>
      <td className="px-1 py-3 text-center align-middle font-mono text-xs leading-5 tabular-nums">
        <div className="truncate">{formatSpeed(member.netOutSpeed)}↑</div>
        <div className="truncate">{formatSpeed(member.netInSpeed)}↓</div>
      </td>
      <td className="px-1 py-3 text-center align-middle">
        <div className="truncate">{formatUptime(member.uptime)}</div>
      </td>
      <td className="px-1 py-3 text-center align-middle font-mono text-xs">
        <div className="truncate">{formatBytes(member.periodTx)}↑</div>
        <div className="truncate">{formatBytes(member.periodRx)}↓</div>
      </td>
      <td className="px-1 py-3 align-middle">
        <UsageMeter tone="cpu" value={member.cpuUsage} />
      </td>
      <td className="px-1 py-3 align-middle">
        <UsageMeter tone="memory" value={member.memoryUsage} />
      </td>
      <td className="px-1 py-3 align-middle">
        <UsageMeter tone="disk" value={member.diskUsage} />
      </td>
    </tr>
  );
}

export default function TZPage() {
  const { effectiveMode, setMode } = useThemeContext();
  const [groups, setGroups] = useState<MonitorPublicNodeInstanceGroupApiItem[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<Record<number, number>>(
    {},
  );
  const [realtimeMetrics, setRealtimeMetrics] = useState<
    Record<number, RealtimeMetricSnapshot[]>
  >({});

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

      if (!nodeId || nodeId <= 0) return;

      if (parsed.type === "status") {
        setRealtimeStatus((prev) => ({ ...prev, [nodeId]: Number(parsed.data) }));
        return;
      }

      if (parsed.type === "instance_status") {
        let raw = parsed.data;

        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw);
          } catch {
            return;
          }
        }
        if (!raw || typeof raw !== "object") return;

        const data = raw as Record<string, unknown>;
        const instanceId = String(data.instanceId ?? data.instance_id ?? "").trim();
        const status = Number(data.status ?? 0) === 1 ? 1 : 0;

        if (!instanceId || instanceId.toLowerCase() === "default") return;
        let found = false;

        setGroups((prev) => {
          const next = prev.map((group) => {
            if (Number(group.id) !== nodeId) return group;
            const members = group.members.map((member) => {
              if ((member.instanceId || "").trim() !== instanceId) return member;
              found = true;

              return { ...member, status };
            });

            return found ? { ...group, members } : group;
          });

          return found ? next : prev;
        });
        if (!found && status === 1) {
          window.setTimeout(() => void loadGroups({ silent: true }), 500);
        }

        return;
      }

      if (parsed.type !== "metric") return;

      let raw = parsed.data;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return;
        }
      }
      if (!raw || typeof raw !== "object") return;

      const metric = raw as Record<string, unknown>;
      const instanceId = String(metric.instanceId ?? metric.instance_id ?? "").trim();
      if (!instanceId || instanceId.toLowerCase() === "default") return;
      const knownInstance = groups.some(
        (group) =>
          Number(group.id) === nodeId &&
          group.members.some((member) => (member.instanceId || "").trim() === instanceId),
      );

      if (!knownInstance) {
        window.setTimeout(() => void loadGroups({ silent: true }), 500);
      }

      const patch: RealtimeMetricSnapshot = {
        instanceId,
        status: 1,
        netInSpeed: Number(metric.netInSpeed ?? metric.net_in_speed ?? 0),
        netOutSpeed: Number(metric.netOutSpeed ?? metric.net_out_speed ?? 0),
        netInBytes: Number(metric.netInBytes ?? metric.bytes_received ?? 0),
        netOutBytes: Number(metric.netOutBytes ?? metric.bytes_transmitted ?? 0),
        periodRx: Number(metric.periodRx ?? metric.period_bytes_received ?? 0),
        periodTx: Number(metric.periodTx ?? metric.period_bytes_transmitted ?? 0),
        uptime: Number(metric.uptime ?? 0),
        cpuUsage: Number(metric.cpuUsage ?? metric.cpu_usage ?? 0),
        memoryUsage: Number(metric.memoryUsage ?? metric.memory_usage ?? 0),
        diskUsage: Number(metric.diskUsage ?? metric.disk_usage ?? 0),
        onlineCount: Number(metric.tcpConns ?? metric.tcp_conns ?? 0) +
          Number(metric.udpConns ?? metric.udp_conns ?? 0),
        tcpConns: Number(metric.tcpConns ?? metric.tcp_conns ?? 0),
        udpConns: Number(metric.udpConns ?? metric.udp_conns ?? 0),
      };

      setRealtimeMetrics((prev) => {
        const list = [...(prev[nodeId] || [])];
        const idx = list.findIndex((m) => m.instanceId === instanceId);
        if (idx >= 0) {
          list[idx] = patch;
        } else {
          list.push(patch);
        }
        return { ...prev, [nodeId]: list };
      });
    },
    [groups, loadGroups],
  );

  const { wsConnected, wsConnecting } = useNodeRealtime({
    onMessage: handleRealtimeMessage,
    enabled: true,
    mode: "public",
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
        members: group.members.map((member) =>
          mergeRealtimeMember(member, realtimeMetrics),
        ),
      })),
    [groups, realtimeMetrics, realtimeStatus],
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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              color="primary"
              size="sm"
              variant="flat"
              onPress={() => {
                window.location.href = "/";
              }}
            >
              返回
            </Button>
            <Button
              color="secondary"
              isLoading={loading}
              size="sm"
              variant="flat"
              onPress={() => loadGroups()}
            >
              刷新
            </Button>
          </div>
          <Button
            isIconOnly
            aria-label={effectiveMode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            className="text-foreground"
            size="sm"
            title={effectiveMode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            variant="light"
            onPress={() => setMode(effectiveMode === "dark" ? "light" : "dark")}
          >
            {effectiveMode === "dark" ? (
              <SunFilledIcon size={16} />
            ) : (
              <MoonFilledIcon size={16} />
            )}
          </Button>
        </div>

        {!error && (
          <div className="flex items-center gap-4 overflow-x-auto overscroll-x-contain whitespace-nowrap text-xs">
            <span className="inline-flex shrink-0 items-center gap-2 text-default-600 dark:text-default-300">
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
            <div className="text-xs text-default-500 dark:text-default-300">  实时节点状态</div>
          </div>        
        )}
        
        {!error && (
          <div className="flex items-center gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap text-xs">
            <span className="shrink-0 rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
              节点 {onlineNodeCount}/{nodeCount}
            </span>
            <span className="shrink-0 rounded-md bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">
              实例 {onlineInstanceCount}/{instanceCount}
            </span>
          </div>
        )}

        {error ? (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">探针列表</h3>
            </CardHeader>
            <CardBody>
              <div className="text-sm text-default-600 dark:text-default-300">{error}</div>
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
