import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import Network from "@/api/network";
import { Alert } from "@/shadcn-bridge/heroui/alert";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";

type NodeLike = {
  id: number;
  name: string;
};

type DNSFailoverProvider = "cloudflare" | "aliyun";

interface NodeDNSFailoverConfig {
  nodeId: number;
  enabled: boolean;
  provider: DNSFailoverProvider;
  domain: string;
  ttl: number;
  manageA: boolean;
  manageAAAA: boolean;
  minRecords: number;
  removeFailCount: number;
  restoreSuccessCount: number;
  syncIntervalSeconds: number;
  providerConfig: Record<string, string>;
  currentA: string[];
  currentAAAA: string[];
  expectedA: string[];
  expectedAAAA: string[];
  lastSyncAt: number;
  lastError: string;
}

const saveNodeDNSFailover = (data: Partial<NodeDNSFailoverConfig>) =>
  Network.post<NodeDNSFailoverConfig>("/node/dns-failover/save", data);

const syncNodeDNSFailover = (nodeId: number) =>
  Network.post<NodeDNSFailoverConfig>("/node/dns-failover/sync", { nodeId });

type DNSFailoverForm = NodeDNSFailoverConfig & {
  cloudflareAuthMode: "token" | "global_key";
  cloudflareZoneId: string;
  cloudflareApiToken: string;
  cloudflareEmail: string;
  cloudflareGlobalApiKey: string;
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
  aliyunDomainName: string;
  aliyunRR: string;
};

const createDefaultForm = (nodeId = 0): DNSFailoverForm => ({
  nodeId,
  enabled: false,
  provider: "cloudflare",
  domain: "",
  ttl: 1,
  manageA: true,
  manageAAAA: true,
  minRecords: 1,
  removeFailCount: 3,
  restoreSuccessCount: 3,
  syncIntervalSeconds: 30,
  providerConfig: {},
  currentA: [],
  currentAAAA: [],
  expectedA: [],
  expectedAAAA: [],
  lastSyncAt: 0,
  lastError: "",
  cloudflareAuthMode: "token",
  cloudflareZoneId: "",
  cloudflareApiToken: "",
  cloudflareEmail: "",
  cloudflareGlobalApiKey: "",
  aliyunAccessKeyId: "",
  aliyunAccessKeySecret: "",
  aliyunDomainName: "",
  aliyunRR: "",
});

export function NodeDNSFailoverModal({
  isOpen,
  nodes = [],
  onOpenChange,
}: {
  isOpen: boolean;
  node: NodeLike | null;
  nodes?: NodeLike[];
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<DNSFailoverForm>(createDefaultForm());
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resultSummary, setResultSummary] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setForm(createDefaultForm());
    setSelectedNodeIds([]);
    setResultSummary([]);
  }, [isOpen]);

  const buildPayload = (nodeId: number): Partial<NodeDNSFailoverConfig> => ({
    nodeId,
    enabled: form.enabled,
    provider: form.provider,
    domain: form.domain,
    ttl: Number(form.ttl) || 1,
    manageA: form.manageA,
    manageAAAA: form.manageAAAA,
    minRecords: Number(form.minRecords) || 1,
    removeFailCount: Number(form.removeFailCount) || 3,
    restoreSuccessCount: Number(form.restoreSuccessCount) || 3,
    syncIntervalSeconds: Number(form.syncIntervalSeconds) || 30,
    providerConfig:
      form.provider === "cloudflare"
        ? {
            authMode: form.cloudflareAuthMode,
            zoneId: form.cloudflareZoneId,
            apiToken: form.cloudflareApiToken,
            email: form.cloudflareEmail,
            globalApiKey: form.cloudflareGlobalApiKey,
            proxied: "false",
          }
        : {
            accessKeyId: form.aliyunAccessKeyId,
            accessKeySecret: form.aliyunAccessKeySecret,
            domainName: form.aliyunDomainName,
            rr: form.aliyunRR,
          },
  });

  const saveConfig = async () => {
    if (selectedNodeIds.length === 0) {
      toast.error("请选择调用节点");
      return;
    }
    setSaving(true);
    const results: string[] = [];
    try {
      for (const nodeId of selectedNodeIds) {
        const nodeName = nodes.find((item) => item.id === nodeId)?.name || `#${nodeId}`;
        const res = await saveNodeDNSFailover(buildPayload(nodeId));

        if (res.code === 0) {
          results.push(`${nodeName}: 保存成功`);
        } else {
          results.push(`${nodeName}: ${res.msg || "保存失败"}`);
        }
      }
      setResultSummary(results);
      toast.success(`已保存 ${selectedNodeIds.length} 个节点的 DNS 配置`);
    } catch {
      toast.error("保存 DNS 容灾配置失败");
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    if (selectedNodeIds.length === 0) {
      toast.error("请选择调用节点");
      return;
    }
    setSyncing(true);
    const results: string[] = [];
    try {
      for (const nodeId of selectedNodeIds) {
        const nodeName = nodes.find((item) => item.id === nodeId)?.name || `#${nodeId}`;
        const res = await syncNodeDNSFailover(nodeId);

        if (res.code === 0) {
          results.push(`${nodeName}: 同步成功`);
        } else {
          results.push(`${nodeName}: ${res.msg || "同步失败"}`);
        }
      }
      setResultSummary(results);
      toast.success(`已同步 ${selectedNodeIds.length} 个节点`);
    } catch {
      toast.error("同步 DNS 失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Modal
      backdrop="blur"
      classNames={{
        base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
      }}
      isDismissable={false}
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">DNS 容灾</h2>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
              <Alert color="warning" variant="flat">
                按多实例在线状态自动增删 DNS A/AAAA 记录，用于减少手动摘除坏羊毛机；客户端 DNS 缓存仍不可控。
              </Alert>
              <Select
                label={`调用节点${selectedNodeIds.length > 0 ? ` (已选 ${selectedNodeIds.length} 个)` : ""}`}
                placeholder="选择用于同步 DNS 的节点（可多选）"
                selectedKeys={new Set(selectedNodeIds.map(String))}
                selectionMode="multiple"
                onSelectionChange={(keys) => {
                  setSelectedNodeIds(
                    Array.from(keys)
                      .map((key) => Number(key))
                      .filter((id) => Number.isFinite(id) && id > 0),
                  );
                }}
              >
                {nodes.map((item) => (
                  <SelectItem key={String(item.id)} textValue={item.name}>
                    {item.name} / ID: {item.id}
                  </SelectItem>
                ))}
              </Select>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label="DNS 服务商"
                  selectedKeys={[form.provider]}
                  onSelectionChange={(keys) => {
                    const provider = Array.from(keys)[0] as
                      | "cloudflare"
                      | "aliyun";

                    setForm((prev) => ({
                      ...prev,
                      provider: provider || "cloudflare",
                    }));
                  }}
                >
                  <SelectItem key="cloudflare" textValue="Cloudflare">
                    Cloudflare
                  </SelectItem>
                  <SelectItem key="aliyun" textValue="阿里云 DNS">
                    阿里云 DNS
                  </SelectItem>
                </Select>
                <Input
                  label="完整记录名"
                  placeholder="node.example.com"
                  value={form.domain}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, domain: e.target.value }))
                  }
                />
                <Input
                  label="TTL"
                  min={1}
                  type="number"
                  value={String(form.ttl)}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, ttl: Number(e.target.value) }))
                  }
                />
                <Input
                  label="同步间隔（秒）"
                  min={30}
                  type="number"
                  value={String(form.syncIntervalSeconds)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      syncIntervalSeconds: Number(e.target.value),
                    }))
                  }
                />
                <Input
                  label="最少保留记录数"
                  min={1}
                  type="number"
                  value={String(form.minRecords)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      minRecords: Number(e.target.value),
                    }))
                  }
                />
                <Input
                  label="失败摘除阈值"
                  min={1}
                  type="number"
                  value={String(form.removeFailCount)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      removeFailCount: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <Checkbox
                  isSelected={form.enabled}
                  onValueChange={(enabled) =>
                    setForm((prev) => ({ ...prev, enabled }))
                  }
                >
                  启用自动 DNS 容灾
                </Checkbox>
                <Checkbox
                  isSelected={form.manageA}
                  onValueChange={(manageA) =>
                    setForm((prev) => ({ ...prev, manageA }))
                  }
                >
                  管理 A
                </Checkbox>
                <Checkbox
                  isSelected={form.manageAAAA}
                  onValueChange={(manageAAAA) =>
                    setForm((prev) => ({ ...prev, manageAAAA }))
                  }
                >
                  管理 AAAA
                </Checkbox>
              </div>
              {form.provider === "cloudflare" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select
                    label="Cloudflare 认证方式"
                    selectedKeys={[form.cloudflareAuthMode]}
                    onSelectionChange={(keys) => {
                      const mode = Array.from(keys)[0] as
                        | "token"
                        | "global_key";

                      setForm((prev) => ({
                        ...prev,
                        cloudflareAuthMode: mode || "token",
                      }));
                    }}
                  >
                    <SelectItem key="token" textValue="API Token">
                      API Token
                    </SelectItem>
                    <SelectItem key="global_key" textValue="Global API Key">
                      Global API Key
                    </SelectItem>
                  </Select>
                  <Input
                    label="Zone ID（可选）"
                    placeholder="留空自动识别"
                    value={form.cloudflareZoneId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cloudflareZoneId: e.target.value,
                      }))
                    }
                  />
                  {form.cloudflareAuthMode === "token" ? (
                    <Input
                      label="API Token"
                      placeholder="留空则保留已保存密钥"
                      type="password"
                      value={form.cloudflareApiToken}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          cloudflareApiToken: e.target.value,
                        }))
                      }
                    />
                  ) : (
                    <>
                      <Input
                        label="Email"
                        value={form.cloudflareEmail}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            cloudflareEmail: e.target.value,
                          }))
                        }
                      />
                      <Input
                        label="Global API Key"
                        placeholder="留空则保留已保存密钥"
                        type="password"
                        value={form.cloudflareGlobalApiKey}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            cloudflareGlobalApiKey: e.target.value,
                          }))
                        }
                      />
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="AccessKey ID"
                    value={form.aliyunAccessKeyId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        aliyunAccessKeyId: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="AccessKey Secret"
                    placeholder="留空则保留已保存密钥"
                    type="password"
                    value={form.aliyunAccessKeySecret}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        aliyunAccessKeySecret: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="主域名"
                    placeholder="example.com"
                    value={form.aliyunDomainName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        aliyunDomainName: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="主机记录 RR"
                    placeholder="node"
                    value={form.aliyunRR}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, aliyunRR: e.target.value }))
                    }
                  />
                </div>
              )}
              {resultSummary.length > 0 && (
                <div className="rounded-xl border border-divider p-3 text-xs text-default-600 space-y-1">
                  {resultSummary.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              )}
            </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            color="secondary"
            isLoading={syncing}
            variant="flat"
            onPress={syncNow}
          >
            手动同步
          </Button>
          <Button color="primary" isLoading={saving} onPress={saveConfig}>
            保存配置
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
