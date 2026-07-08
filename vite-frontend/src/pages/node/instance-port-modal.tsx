import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import type { NodeInstancePortApiItem } from "@/api/types";

import {
  deleteNodeInstancePort,
  getNodeInstancePorts,
  saveNodeInstancePort,
} from "@/api";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";

type NodeLike = {
  id: number;
  name: string;
  port?: string;
};

interface NodeInstancePortModalProps {
  isOpen: boolean;
  node: NodeLike | null;
  onOpenChange: (open: boolean) => void;
}

const validatePortRange = (value: string): string | null => {
  const portRange = value.trim();

  if (!portRange) return null;
  for (const part of portRange.split(",")) {
    const item = part.trim();

    if (!item) return "端口范围格式错误";
    if (item.includes("-")) {
      const pieces = item.split("-");

      if (pieces.length !== 2) return "端口范围格式错误";
      const start = Number(pieces[0].trim());
      const end = Number(pieces[1].trim());

      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end > 65535 ||
        start >= end
      ) {
        return "端口范围必须在 1-65535 之间，且起始端口小于结束端口";
      }
      continue;
    }
    const port = Number(item);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "端口必须在 1-65535 之间";
    }
  }
  return null;
};

const maskAddress = (value?: string): string => {
  const text = value?.trim();

  if (!text) return "暂无";
  if (text.includes(":")) {
    const parts = text.split(":").filter(Boolean);

    if (parts.length <= 3) return text;
    return `::${parts.slice(-3).join(":")}`;
  }
  if (text.includes(".")) {
    const parts = text.split(".");

    if (parts.length >= 2) return `${parts[0]}.${parts[1]}.*`;
    return parts[0].length > 12 ? `${parts[0].slice(0, 12)}...` : parts[0];
  }
  return text.length > 15 ? `${text.slice(0, 15)}...` : text;
};

const copyToClipboard = async (text: string, label: string) => {
  const value = text.trim();

  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label}已复制`);
  } catch {
    toast.error("复制失败");
  }
};

function AddressCell({ label, value }: { label: string; value?: string }) {
  const text = value?.trim() || "";

  return (
    <div
      className={`inline-flex w-fit max-w-full font-mono text-xs font-medium truncate rounded px-1 transition-colors ${
        text
          ? "cursor-pointer hover:bg-default-200/50 text-default-600"
          : "text-default-300"
      }`}
      title={text || "暂无"}
      onClick={(event) => {
        event.stopPropagation();
        void copyToClipboard(text, label);
      }}
    >
      {maskAddress(text)}
    </div>
  );
}

const getInstanceLabel = (displayIndex?: number): string => {
  const index = Number(displayIndex || 0);

  return `实例 ${index > 0 ? index : "-"}`;
};

export function NodeInstancePortModal({
  isOpen,
  node,
  onOpenChange,
}: NodeInstancePortModalProps) {
  const [instances, setInstances] = useState<NodeInstancePortApiItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [nodePortRange, setNodePortRange] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<NodeInstancePortApiItem | null>(null);

  useEffect(() => {
    if (!isOpen || !node) return;
    setLoading(true);
    getNodeInstancePorts(node.id)
      .then((res) => {
        if (res.code !== 0 || !res.data) {
          toast.error(res.msg || "加载实例端口失败");
          return;
        }
        const nextInstances = res.data.instances || [];

        setInstances(nextInstances);
        setNodePortRange(res.data.nodePortRange || node.port || "");
        setValues(
          Object.fromEntries(
            nextInstances.map((item) => [
              item.instanceId,
              item.portRange?.trim() || "",
            ]),
          ),
        );
      })
      .catch(() => toast.error("加载实例端口失败"))
      .finally(() => setLoading(false));
  }, [isOpen, node]);

  const handleSave = async (instanceId: string) => {
    if (!node) return;
    const portRange = values[instanceId]?.trim() || "";
    const error = validatePortRange(portRange);

    if (error) {
      toast.error(error);
      return;
    }
    setSavingId(instanceId);
    try {
      const res = await saveNodeInstancePort(node.id, instanceId, portRange);

      if (res.code !== 0) {
        toast.error(res.msg || "保存实例端口失败");
        return;
      }
      setInstances((prev) =>
        prev.map((item) =>
          item.instanceId === instanceId ? { ...item, portRange } : item,
        ),
      );
      toast.success("实例端口已保存");
    } catch {
      toast.error("保存实例端口失败");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async () => {
    if (!node || !deleteTarget?.instanceId) return;
    setDeletingId(deleteTarget.instanceId);
    try {
      const res = await deleteNodeInstancePort(node.id, deleteTarget.instanceId);

      if (res.code !== 0) {
        toast.error(res.msg || "删除实例失败");
        return;
      }
      setInstances((prev) =>
        prev.filter((item) => item.instanceId !== deleteTarget.instanceId),
      );
      setValues((prev) => {
        const next = { ...prev };

        delete next[deleteTarget.instanceId];

        return next;
      });
      toast.success("实例已删除");
      setDeleteTarget(null);
    } catch {
      toast.error("删除实例失败");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Modal
      isDismissable={false}
      isOpen={isOpen}
      size="lg"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>实例端口范围</span>
          <span className="text-xs font-normal text-default-500">
            {node?.name || "-"} · 节点默认 {nodePortRange || "未设置"}
          </span>
        </ModalHeader>
        <ModalBody>
          {loading ? (
            <div className="flex h-36 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : instances.length === 0 ? (
            <div className="rounded-lg border border-divider p-6 text-center text-sm text-default-500">
              暂无在线实例，实例上报后可在这里配置专属端口范围
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full text-sm">
                <thead className="border-b border-divider text-default-500">
                  <tr>
                    <th className="px-2 py-2 text-left">实例</th>
                    <th className="px-2 py-2 text-left">公网 IP</th>
                    <th className="px-2 py-2 text-left">端口范围</th>
                    <th className="px-2 py-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((item) => (
                    <tr key={item.instanceId} className="border-b border-divider/60">
                      <td className="px-2 py-3 align-middle">
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="text-sm font-medium text-foreground whitespace-nowrap">
                            {getInstanceLabel(item.displayIndex)}
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <div className="flex flex-col gap-1 min-w-0">
                          <AddressCell label="公网 IPv4" value={item.publicIpV4} />
                          <AddressCell label="公网 IPv6" value={item.publicIpV6} />
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <Input
                          placeholder={nodePortRange || "留空继承节点默认端口"}
                          size="sm"
                          value={values[item.instanceId] ?? ""}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [item.instanceId]: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-3 text-center align-middle">
                        <Button
                          color="primary"
                          isLoading={savingId === item.instanceId}
                          size="sm"
                          variant="flat"
                          onPress={() => handleSave(item.instanceId)}
                        >
                          保存
                        </Button>
                        <Button
                          className="ml-2"
                          color="danger"
                          isLoading={deletingId === item.instanceId}
                          size="sm"
                          variant="flat"
                          onPress={() => setDeleteTarget(item)}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={() => onOpenChange(false)}>
            关闭
          </Button>
        </ModalFooter>
      </ModalContent>
      </Modal>
      <Modal
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <ModalContent>
          <ModalHeader>删除实例</ModalHeader>
          <ModalBody>
            <div className="space-y-2 text-sm text-default-600">
              <div>确认删除 {getInstanceLabel(deleteTarget?.displayIndex)}？</div>
              <div>
                删除后该编号会释放，新上线实例会优先占用这个编号。若该实例仍在线，继续上报后会重新出现。
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button color="danger" isLoading={!!deletingId} onPress={handleDelete}>
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
