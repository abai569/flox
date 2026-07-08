import type { Key } from "react";

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

const getNodeDNSFailover = (nodeId: number) =>
  Network.post<NodeDNSFailoverConfig>("/node/dns-failover/get", { nodeId });

const syncNodeDNSFailover = (nodeId: number) =>
  Network.post<NodeDNSFailoverConfig>("/node/dns-failover/sync", { nodeId });

type DNSFailoverForm = Omit<NodeDNSFailoverConfig, "domain"> & {
  cloudflareAuthMode: "token" | "global_key";
  cloudflareZoneId: string;
  cloudflareApiToken: string;
  cloudflareEmail: string;
  cloudflareGlobalApiKey: string;
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
};

const createDefaultForm = (): DNSFailoverForm => ({
  nodeId: 0,
  enabled: false,
  provider: "aliyun",
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
});

export function NodeDNSFailoverModal({
  isOpen,
  node,
  nodes = [],
  onOpenChange,
  selectedNodeIds: externalSelectedNodeIds,
  onSelectedNodeIdsChange,
}: {
  isOpen: boolean;
  node: NodeLike | null;
  nodes?: NodeLike[];
  onOpenChange: (open: boolean) => void;
  selectedNodeIds?: number[];
  onSelectedNodeIdsChange?: (ids: number[]) => void;
}) {
  const [form, setForm] = useState<DNSFailoverForm>(createDefaultForm());
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [nodeDomains, setNodeDomains] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resultSummary, setResultSummary] = useState<string[]>([]);
  const [existingNodes, setExistingNodes] = useState<Set<number>>(new Set());
  const [providerExpanded, setProviderExpanded] = useState(false);

  const PROVIDER_CACHE_KEY = "dns_failover_provider_v1";

  const loadNodeInfo = (nodeId: number) => {
    getNodeDNSFailover(nodeId).then((res) => {
      if (res.code === 0 && res.data) {
        setExistingNodes((prev) => new Set([...prev, nodeId]));
        if (res.data.domain) {
          setNodeDomains((prev) => ({ ...prev, [nodeId]: res.data.domain }));
        }
      }
    }).catch(() => {});
  };

  useEffect(() => {
    if (!isOpen) return;
    const initialNodeId = node?.id || 0;

    const cached = (() => {
      try {
        return JSON.parse(localStorage.getItem(PROVIDER_CACHE_KEY) || "null");
      } catch {
        return null;
      }
    })();

    setForm(
      cached
        ? { ...createDefaultForm(), ...cached }
        : createDefaultForm(),
    );
    setNodeDomains({});
    setExistingNodes(new Set());
    if (initialNodeId) {
      setSelectedNodeIds([initialNodeId]);
      loadNodeInfo(initialNodeId);
    } else if (externalSelectedNodeIds && externalSelectedNodeIds.length > 0) {
      setSelectedNodeIds(externalSelectedNodeIds);
      for (const id of externalSelectedNodeIds) {
        loadNodeInfo(id);
      }
    } else {
      setSelectedNodeIds([]);
    }
    setResultSummary([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, node?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const cache: Record<string, unknown> = {};
    cache["nodeId"] = 0;
    cache["enabled"] = form.enabled;
    cache["provider"] = form.provider;
    cache["ttl"] = form.ttl;
    cache["manageA"] = form.manageA;
    cache["manageAAAA"] = form.manageAAAA;
    cache["minRecords"] = form.minRecords;
    cache["removeFailCount"] = form.removeFailCount;
    cache["restoreSuccessCount"] = form.restoreSuccessCount;
    cache["syncIntervalSeconds"] = form.syncIntervalSeconds;
    cache["cloudflareAuthMode"] = form.cloudflareAuthMode;
    cache["cloudflareZoneId"] = form.cloudflareZoneId;
    cache["cloudflareApiToken"] = form.cloudflareApiToken;
    cache["cloudflareEmail"] = form.cloudflareEmail;
    cache["cloudflareGlobalApiKey"] = form.cloudflareGlobalApiKey;
    cache["aliyunAccessKeyId"] = form.aliyunAccessKeyId;
    cache["aliyunAccessKeySecret"] = form.aliyunAccessKeySecret;
    localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(cache));
  }, [isOpen, form]);

  const handleSelectedNodeChange = (keys: "all" | Set<Key>) => {
    const nextIds = Array.from(keys === "all" ? [] : keys)
      .map((key) => Number(key))
      .filter((id) => Number.isFinite(id) && id > 0);

    setSelectedNodeIds(nextIds);
    onSelectedNodeIdsChange?.(nextIds);
    setResultSummary([]);

    const newIds = nextIds.filter((id) => !(id in nodeDomains));
    if (newIds.length > 0) {
      setNodeDomains((prev) => {
        const next = { ...prev };
        for (const id of newIds) {
          next[id] = "";
        }
        return next;
      });
      for (const nodeId of newIds) {
        loadNodeInfo(nodeId);
      }
    }

    const removedIds = Object.keys(nodeDomains)
      .map(Number)
      .filter((id) => !nextIds.includes(id));
    if (removedIds.length > 0) {
      setNodeDomains((prev) => {
        const next = { ...prev };
        for (const id of removedIds) {
          delete next[id];
        }
        return next;
      });
    }
  };

  const buildPayload = (
    nodeId: number,
    domain: string,
  ): Partial<NodeDNSFailoverConfig> => ({
    nodeId,
    enabled: form.enabled,
    provider: form.provider,
    domain,
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
          },
  });

  const saveConfig = async () => {
    if (selectedNodeIds.length === 0) {
      toast.success("配置已保存");
      setTimeout(() => onOpenChange(false), 800);
      return;
    }
    const emptyDomains = selectedNodeIds.filter(
      (id) => !nodeDomains[id]?.trim(),
    );
    if (emptyDomains.length > 0) {
      const names = emptyDomains
        .map((id) => nodes.find((n) => n.id === id)?.name || `#${id}`)
        .join("、");
      toast.error(`以下节点未填写域名：${names}`);
      return;
    }

    setSaving(true);
    const results: string[] = [];
    try {
      for (const nodeId of selectedNodeIds) {
        const nodeName =
          nodes.find((item) => item.id === nodeId)?.name || `#${nodeId}`;
        const res = await saveNodeDNSFailover(
          buildPayload(nodeId, nodeDomains[nodeId] || ""),
        );

        if (res.code === 0) {
          const label = existingNodes.has(nodeId) ? "更新成功" : "保存成功";
          results.push(`${nodeName}: ${label}`);
        } else {
          results.push(`${nodeName}: ${res.msg || "保存失败"}`);
        }
      }
      setResultSummary(results);
      const allSuccess = results.every(
        (r) => r.endsWith("保存成功") || r.endsWith("更新成功"),
      );
      if (allSuccess) {
        toast.success(`已保存 ${selectedNodeIds.length} 个节点的 DNS 配置`);
        setTimeout(() => onOpenChange(false), 800);
      } else {
        toast.error("部分节点保存失败");
      }
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
        const nodeName =
          nodes.find((item) => item.id === nodeId)?.name || `#${nodeId}`;
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

  const sortedSelectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));

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
      size="lg"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">DNS 容灾</h2>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <Alert color="warning" variant="flat">
              按多实例在线状态自动增删 DNS A/AAAA
              记录，用于减少手动摘除坏羊毛机；客户端 DNS 缓存仍不可控。
            </Alert>

            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-default-600 hover:bg-default-100 transition-colors"
              type="button"
              onClick={() => setProviderExpanded((v) => !v)}
            >
              DNS 配置
              <svg
                className={`h-4 w-4 transition-transform ${providerExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {providerExpanded && (
            <>
            {/* 上半部分：公共配置 */}
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
                <div className="md:col-span-2 text-xs text-default-500">
                  <a
                    className="text-primary hover:underline"
                    href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Cloudflare 创建 API Token 官方教程
                  </a>
                </div>
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
                {form.cloudflareAuthMode === "token" ? (
                  <>
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
                    <div className="md:col-span-2">
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
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2 text-xs text-default-500">
                  <a
                    className="text-primary hover:underline"
                    href="https://help.aliyun.com/zh/ram/user-guide/create-an-accesskey-pair"
                    rel="noreferrer"
                    target="_blank"
                  >
                    阿里云创建 AccessKey 官方教程
                  </a>
                </div>
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
              </div>
            )}

            </>
            )}

            {/* 下半部分：节点选择 + 逐节点域名 */}
            <hr className="border-divider" />
            <div className="text-sm font-semibold text-default-700">
              调用节点
            </div>
            <div className="relative overflow-visible">
              <Select
                label={selectedNodeIds.length > 0 ? `已选 ${selectedNodeIds.length} 个节点` : "选择节点（可选）"}
                placeholder="选择节点后可为每个节点填写独立域名"
                selectedKeys={new Set(selectedNodeIds.map(String))}
                selectionMode="multiple"
                dropdownPlacement="top"
                onSelectionChange={handleSelectedNodeChange}
              >
                {nodes.map((item) => (
                  <SelectItem key={String(item.id)} textValue={item.name}>
                    {item.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
            {sortedSelectedNodes.length > 0 && (
              <div className="space-y-2">
                {sortedSelectedNodes.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center gap-3 rounded-lg border border-divider px-3 py-2"
                  >
                    <span className="text-sm font-medium min-w-[80px] truncate text-default-700">
                      {n.name}
                    </span>
                    <Input
                      className="flex-1"
                      placeholder="请输入"
                      value={nodeDomains[n.id] || ""}
                      onChange={(e) =>
                        setNodeDomains((prev) => ({
                          ...prev,
                          [n.id]: e.target.value,
                        }))
                      }
                    />
                    {existingNodes.has(n.id) && (nodeDomains[n.id] || "").trim() && (
                      <span className="text-xs text-success whitespace-nowrap">
                        已保存
                      </span>
                    )}
                  </div>
                ))}
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
          <Button
            color="secondary"
            isLoading={syncing}
            variant="flat"
            onPress={syncNow}
          >
            手动同步
          </Button>
          <Button variant="flat" onPress={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button color="primary" isLoading={saving} onPress={saveConfig}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
