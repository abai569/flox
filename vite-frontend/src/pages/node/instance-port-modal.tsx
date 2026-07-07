import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import type { NodeInstancePortApiItem } from "@/api/types";

import { getNodeInstancePorts, saveNodeInstancePort } from "@/api";
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

  return (
    <Modal
      isDismissable={false}
      isOpen={isOpen}
      size="2xl"
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
              <table className="min-w-[760px] w-full text-sm">
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
                        <div className="font-mono text-xs">{item.instanceId}</div>
                        <div className="text-xs text-default-500">
                          {item.hostname || "-"}
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle font-mono text-xs text-default-600">
                        <div>{item.publicIpV4 || "-"}</div>
                        <div>{item.publicIpV6 || "-"}</div>
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
  );
}
