import type {
  SubscriptionPackageApiItem,
  PackageGroupApiItem,
} from "@/api/types";

import { useState, useMemo } from "react";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody } from "@/shadcn-bridge/heroui/card";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";

interface PackageGroupedViewProps {
  packageGroups: PackageGroupApiItem[];
  filteredList: SubscriptionPackageApiItem[];
  activeTab: "subscription" | "traffic" | "balance";
  onEdit: (item: SubscriptionPackageApiItem) => void;
  onDelete: (item: SubscriptionPackageApiItem) => void;
  onDescEdit: (item: SubscriptionPackageApiItem) => void;
  onGroupFilter: (groupId: number) => void;
  tunnelGroups: { id: number; name: string }[];
}

export function PackageGroupedView({
  packageGroups,
  filteredList,
  activeTab,
  onEdit,
  onDelete,
  onDescEdit,
  onGroupFilter,
  tunnelGroups,
}: PackageGroupedViewProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});

  const groupedPackages = useMemo(() => {
    const groupsMap = new Map<
      number | string,
      { group: PackageGroupApiItem | null; items: SubscriptionPackageApiItem[] }
    >();

    packageGroups.forEach((g) => {
      groupsMap.set(Number(g.id), { group: g, items: [] });
    });
    groupsMap.set("none", { group: null, items: [] });

    filteredList.forEach((pkg) => {
      const groupId =
        pkg.groupId && pkg.groupId > 0 ? Number(pkg.groupId) : "none";
      if (groupsMap.has(groupId)) {
        groupsMap.get(groupId)!.items.push(pkg);
      } else {
        groupsMap.get("none")!.items.push(pkg);
      }
    });

    return Array.from(groupsMap.values()).filter((g) => g.items.length > 0);
  }, [filteredList, packageGroups]);

  const renderGroupBadge = (groupId?: number) => {
    if (!groupId || groupId <= 0)
      return <span className="text-xs text-default-400">未分组</span>;
    const group = packageGroups.find((g) => Number(g.id) === groupId);
    if (!group)
      return <span className="text-xs text-default-400">未分组</span>;
    return (
      <button
        className="inline-flex items-center gap-1 cursor-pointer hover:underline"
        onClick={() => onGroupFilter(groupId)}
      >
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: group.color }}
        />
        <span className="text-xs font-medium" style={{ color: group.color }}>
          {group.name}
        </span>
      </button>
    );
  };

  const renderStatusBadge = (enabled: number) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${enabled === 1 ? "bg-green-500" : "bg-gray-400"}`}
    >
      {enabled === 1 ? "启用" : "停用"}
    </span>
  );

  const renderShopVisibleBadge = (visible: number) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${visible === 1 ? "bg-blue-500" : "bg-gray-400"}`}
    >
      {visible === 1 ? "商店可见" : "后台分配"}
    </span>
  );

  const renderRecommendedBadge = (recommended: number) => (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${recommended === 1 ? "bg-amber-500" : "bg-gray-400"}`}
    >
      {recommended === 1 ? "推荐" : "不推荐"}
    </span>
  );

  const renderStock = (stock: number) => {
    if (stock === -1) return <span className="text-default-400">不限</span>;
    if (stock === 0)
      return <span className="text-red-500 font-medium">已售罄</span>;
    return <span>{stock}</span>;
  };

  const renderActions = (item: SubscriptionPackageApiItem) => (
    <div className="flex gap-1">
      <Button
        isIconOnly
        className="min-w-0 w-8 h-8"
        size="sm"
        variant="flat"
        onPress={() => onEdit(item)}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L18.732 3.732z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </Button>
      <Button
        isIconOnly
        className="min-w-0 w-8 h-8"
        color="danger"
        size="sm"
        variant="flat"
        onPress={() => onDelete(item)}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </Button>
    </div>
  );

  const renderSubscriptionTable = (items: SubscriptionPackageApiItem[]) => (
    <Table
      className="min-w-[640px]"
      classNames={{
        th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
        td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
        tr: "hover:bg-default-50/50 transition-colors",
      }}
    >
      <TableHeader>
        <TableColumn className="whitespace-nowrap min-w-[120px]">名称</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">分组</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">描述</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[140px]">价格</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[140px]">有效期</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">隧道组</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[200px]">限制</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[70px]">启用状态</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[90px]">商店可见</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">自动续费</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[60px]">商店推荐</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">库存</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">操作</TableColumn>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell><div className="font-medium text-sm">{item.name}</div></TableCell>
            <TableCell>{renderGroupBadge(item.groupId)}</TableCell>
            <TableCell>
              <Button size="sm" variant="flat" onPress={() => onDescEdit(item)}>编辑</Button>
            </TableCell>
            <TableCell><div className="text-sm whitespace-nowrap">¥{(item.price / 100).toFixed(2)}</div></TableCell>
            <TableCell><div className="text-sm">{item.validityDays}天</div></TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {(item.tunnelGroupIds || []).length === 0 && <span className="text-xs text-gray-400">未关联</span>}
                {(item.tunnelGroupIds || []).map((gid: number) => {
                  const tg = tunnelGroups.find((g) => g.id === gid);
                  return tg ? (
                    <span key={gid} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">{tg.name}</span>
                  ) : null;
                })}
              </div>
            </TableCell>
            <TableCell className="text-xs text-gray-500">
              <div className="space-y-0.5">
                <div>规则 {item.maxRules > 0 ? item.maxRules : "不限"} · 流量 {item.trafficLimit > 0 ? `${item.trafficLimit} GB` : "不限"}</div>
                <div>连接 {item.maxConnections > 0 ? item.maxConnections : "不限"} · 限速 {item.speedLimit > 0 ? `${item.speedLimit} Mbps` : "不限"}</div>
              </div>
            </TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderStatusBadge(item.enabled)}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderShopVisibleBadge(item.shopVisible)}</div></TableCell>
            <TableCell>
              <div className="flex flex-row gap-1 shrink-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap ${item.autoRenew === 1 ? "bg-purple-500" : "bg-gray-400"}`}>
                  {item.autoRenew === 1 ? "自动续费" : "手动续费"}
                </span>
              </div>
            </TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderRecommendedBadge(item.recommended)}</div></TableCell>
            <TableCell><div className="text-sm">{renderStock(item.stock)}</div></TableCell>
            <TableCell>{renderActions(item)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderTrafficTable = (items: SubscriptionPackageApiItem[]) => (
    <Table
      className="min-w-[640px]"
      classNames={{
        th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
        td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
        tr: "hover:bg-default-50/50 transition-colors",
      }}
    >
      <TableHeader>
        <TableColumn className="whitespace-nowrap min-w-[120px]">名称</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">分组</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">描述</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[120px]">价格</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">流量</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[70px]">启用状态</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[90px]">商店可见</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">自动购流</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[60px]">商店推荐</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">库存</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">操作</TableColumn>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell><div className="font-medium text-sm">{item.name}</div></TableCell>
            <TableCell>{renderGroupBadge(item.groupId)}</TableCell>
            <TableCell>
              <Button size="sm" variant="flat" onPress={() => onDescEdit(item)}>编辑</Button>
            </TableCell>
            <TableCell><div className="text-sm whitespace-nowrap">¥{(item.price / 100).toFixed(2)}</div></TableCell>
            <TableCell><div className="text-sm">{item.trafficLimit > 0 ? `${item.trafficLimit} GB` : "不限"}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderStatusBadge(item.enabled)}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderShopVisibleBadge(item.shopVisible)}</div></TableCell>
            <TableCell>
              <div className="flex flex-row gap-1 shrink-0">
                {item.autoBuyTrafficEnabled === 1 ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap bg-teal-500" title="用户可选择此套餐作为自动购流来源">可用</span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap bg-gray-400">不使用</span>
                )}
              </div>
            </TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderRecommendedBadge(item.recommended)}</div></TableCell>
            <TableCell><div className="text-sm">{renderStock(item.stock)}</div></TableCell>
            <TableCell>{renderActions(item)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderBalanceTable = (items: SubscriptionPackageApiItem[]) => (
    <Table
      className="min-w-[500px]"
      classNames={{
        th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-2 uppercase tracking-wider text-left align-middle",
        td: "py-2 border-b border-divider/50 group-data-[last=true]:border-b-0 text-sm",
        tr: "hover:bg-default-50/50 transition-colors",
      }}
    >
      <TableHeader>
        <TableColumn className="whitespace-nowrap min-w-[120px]">名称</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[100px]">分组</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">描述</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[140px]">充值金额</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[70px]">启用状态</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[90px]">商店可见</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[60px]">商店推荐</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">库存</TableColumn>
        <TableColumn className="whitespace-nowrap min-w-[80px]">操作</TableColumn>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell><div className="font-medium text-sm">{item.name}</div></TableCell>
            <TableCell>{renderGroupBadge(item.groupId)}</TableCell>
            <TableCell>
              <Button size="sm" variant="flat" onPress={() => onDescEdit(item)}>编辑</Button>
            </TableCell>
            <TableCell><div className="text-sm whitespace-nowrap">¥{(item.price / 100).toFixed(2)}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderStatusBadge(item.enabled)}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderShopVisibleBadge(item.shopVisible)}</div></TableCell>
            <TableCell><div className="flex flex-row gap-1 shrink-0">{renderRecommendedBadge(item.recommended)}</div></TableCell>
            <TableCell><div className="text-sm">{renderStock(item.stock)}</div></TableCell>
            <TableCell>{renderActions(item)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const renderGroupTable = (items: SubscriptionPackageApiItem[]) => {
    if (activeTab === "subscription") return renderSubscriptionTable(items);
    if (activeTab === "traffic") return renderTrafficTable(items);
    return renderBalanceTable(items);
  };

  if (groupedPackages.length === 0) {
    return (
      <Card className="shadow-sm border border-divider bg-content1 mb-6">
        <CardBody className="py-16 flex flex-col items-center justify-center min-h-[200px]">
          <h3 className="text-base font-medium text-foreground mb-1">
            未找到匹配的套餐
          </h3>
          <p className="text-default-500 text-sm">
            当前筛选条件下没有套餐，请调整分组筛选
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {groupedPackages.map(({ group, items }) => {
        const groupIdStr = String(group ? group.id : "none");
        const isCollapsed = collapsedGroups[groupIdStr];

        return (
          <div
            key={groupIdStr}
            className="overflow-hidden rounded-xl border border-divider bg-content1 shadow-sm"
          >
            <div
              className="flex items-center justify-between border-b border-divider bg-default-100/50 hover:bg-default-200/30 px-4 py-2.5 cursor-pointer select-none transition-colors"
              onClick={() => {
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [groupIdStr]: !prev[groupIdStr],
                }));
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  isIconOnly
                  className="h-7 w-7 min-w-7 pointer-events-none -ml-1"
                  size="sm"
                  variant="flat"
                >
                  <svg
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${isCollapsed ? "-rotate-90" : "rotate-0"}`}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </Button>
                {group ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {group.name}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 ml-1">
                    <div className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0" />
                    <span className="truncate text-sm font-semibold text-foreground">
                      未分组
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-default-600">
                  {items.length} 个套餐
                </span>
              </div>
            </div>
            {!isCollapsed && (
              <div className="overflow-x-auto">
                {renderGroupTable(items)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
