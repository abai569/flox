import type {
  PeerRemoteUsageNodeApiItem,
  PeerShareInstanceApiItem,
} from "@/api/types";
import type { Node } from "./types";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { getPeerRemoteUsageList } from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";

interface RemoteNodeDetailModalProps {
  node: Node | null;
  isOpen: boolean;
  onClose: () => void;
  formatTraffic: (bytes: number) => string;
}

const getInstanceName = (instance: PeerShareInstanceApiItem) => {
  const displayName = instance.displayName?.trim();

  if (displayName) return displayName;
  if (instance.displayIndex && instance.displayIndex > 0) {
    return `实例 ${instance.displayIndex}`;
  }

  return instance.instanceId || "实例";
};

export function RemoteNodeDetailModal({
  node,
  isOpen,
  onClose,
  formatTraffic,
}: RemoteNodeDetailModalProps) {
  const [usage, setUsage] = useState<PeerRemoteUsageNodeApiItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !node) return;
    let active = true;

    setUsage(null);
    setLoading(true);
    getPeerRemoteUsageList(node.id)
      .then((res) => {
        if (!active) return;
        if (res.code !== 0) {
          toast.error(res.msg || "加载远程节点详情失败");

          return;
        }
        const items = Array.isArray(res.data) ? res.data : [];

        setUsage(items.find((item) => item.nodeId === node.id) || null);
      })
      .catch(() => active && toast.error("加载远程节点详情失败"))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [isOpen, node]);

  const instances = usage?.instances || [];
  const instanceDetails = instances.map((instance) => {
    const runtimeInstances = (usage?.runtimeInstances || []).filter(
      (runtime) => runtime.instanceId === instance.instanceId,
    );

    return {
      ...instance,
      currentFlow: runtimeInstances.reduce(
        (total, runtime) => total + runtime.currentFlow,
        0,
      ),
      runtimeCount: runtimeInstances.length,
      deployedRuntimeCount: runtimeInstances.filter(
        (runtime) => runtime.applied === 1,
      ).length,
      deployError: runtimeInstances
        .map((runtime) => runtime.lastError)
        .filter(Boolean)
        .join("; "),
    };
  });

  return (
    <Modal isOpen={isOpen} scrollBehavior="inside" size="2xl" onClose={onClose}>
      <ModalContent>
        <ModalHeader className="truncate">
          {node?.name || "远程节点"}
        </ModalHeader>
        <ModalBody className="space-y-4">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              {(usage?.syncError || node?.syncError) && (
                <div className="rounded-md border border-warning-300/50 bg-warning-50 p-3 text-sm text-warning-700 dark:bg-warning-100/10 dark:text-warning-400">
                  <span className="break-all">
                    {usage?.syncError || node?.syncError}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Detail
                  label="远程地址"
                  value={usage?.remoteUrl || node?.remoteUrl || "-"}
                />
                <Detail
                  label="端口范围"
                  value={
                    usage && usage.portRangeStart > 0
                      ? `${usage.portRangeStart}-${usage.portRangeEnd}`
                      : "-"
                  }
                />
                <Detail
                  label="共享流量"
                  value={
                    usage
                      ? `${formatTraffic(usage.currentFlow || 0)} / ${usage.maxBandwidth > 0 ? formatTraffic(usage.maxBandwidth) : "不限"}`
                      : "-"
                  }
                />
                <Detail
                  label="Runtime / 绑定"
                  value={String(usage?.activeBindingNum || 0)}
                />
              </div>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">实例部署</h3>
                {instanceDetails.length === 0 ? (
                  <div className="rounded-md border border-dashed border-divider p-4 text-sm text-default-500">
                    后端暂未返回实例级部署信息
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-divider">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-default-100/60 text-left text-default-600">
                        <tr>
                          <th className="p-2">实例</th>
                          <th className="p-2">状态</th>
                          <th className="p-2">范围</th>
                          <th className="p-2">流量</th>
                          <th className="p-2">Runtime / 部署</th>
                          <th className="p-2">部署错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {instanceDetails.map((instance) => (
                          <tr
                            key={instance.instanceId}
                            className="border-t border-divider"
                          >
                            <td className="p-2">{getInstanceName(instance)}</td>
                            <td className="p-2">
                              <Chip
                                color={
                                  instance.status === 1 ? "success" : "default"
                                }
                                size="sm"
                                variant="flat"
                              >
                                {instance.status === 1 ? "在线" : "离线"}
                              </Chip>
                            </td>
                            <td className="p-2">
                              {instance.inScope ? "已纳入" : "范围外"}
                            </td>
                            <td className="p-2">
                              {formatTraffic(instance.currentFlow || 0)}
                            </td>
                            <td className="p-2">
                              {instance.runtimeCount || 0} /{" "}
                              {instance.deployedRuntimeCount || 0}
                            </td>
                            <td className="max-w-[260px] break-words p-2 text-danger">
                              {instance.deployError || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">端口占用</h3>
                {usage?.bindings?.length ? (
                  <div className="space-y-2">
                    {usage.bindings.map((binding) => (
                      <div
                        key={binding.bindingId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-default-100/50 p-2 text-sm"
                      >
                        <span>
                          {binding.tunnelName || `隧道 #${binding.tunnelId}`}
                        </span>
                        <span className="text-default-500">
                          端口 {binding.allocatedPort}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-default-500">暂无占用</div>
                )}
              </section>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-divider p-3">
      <div className="text-xs text-default-500">{label}</div>
      <div className="mt-1 break-all text-sm font-medium">{value}</div>
    </div>
  );
}
