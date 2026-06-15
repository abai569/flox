import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Checkbox } from "@/shadcn-bridge/heroui/checkbox";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import {
  bootstrapNodeSDWAN,
  getSDWANSettings,
  getSDWANStatus,
  issueNodeSDWANCert,
  reconcileSDWAN,
  saveSDWANSettings,
  setSDWANLighthouse,
  toggleSDWANBackupLighthouse,
} from "@/api";

interface SDWANNodeStatus {
  id: number;
  name: string;
  status: number;
  vpnIp: string;
  isLighthouse: boolean;
  role: string;
  hasCert: boolean;
  lighthouseAddr: string;
}

interface SDWANLighthouseStatus {
  id: number;
  name: string;
  vpnIp: string;
  addr: string;
}

interface SDWANStatusData {
  tier: string;
  caReady: boolean;
  lighthouseNodeId: number;
  lighthouseName: string;
  lighthouseVPNIP: string;
  lighthouseAddr: string;
  backupLighthouses: SDWANLighthouseStatus[];
  nodes: SDWANNodeStatus[];
}

export default function SDWANPage() {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [status, setStatus] = useState<SDWANStatusData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState({
    networkCIDR: "192.168.100.0/24",
    autoReconcileEnabled: true,
    reconcileIntervalSec: 30,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        getSDWANStatus(),
        getSDWANSettings(),
      ]);

      if (statusRes.code === 0) {
        setStatus(statusRes.data || null);
      } else {
        toast.error(statusRes.msg || "加载 SDWAN 状态失败");
      }
      if (settingsRes.code === 0 && settingsRes.data) {
        setSettings(settingsRes.data);
      }
    } catch {
      toast.error("加载 SDWAN 状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const handleBootstrap = async () => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await bootstrapNodeSDWAN(ids, ids[0]);

      if (res.code === 0) {
        toast.success(`SDWAN 组网完成：${res.data?.updatedCount || 0} 个节点`);
        setSelectedIds(new Set());
        await loadData();
      } else {
        toast.error(res.msg || "SDWAN 组网失败");
      }
    } catch {
      toast.error("SDWAN 组网失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetLighthouse = async (nodeId: number) => {
    setActionLoading(true);
    try {
      const res = await setSDWANLighthouse(nodeId);

      if (res.code === 0) {
        toast.success("中心节点已切换");
        await loadData();
      } else {
        toast.error(res.msg || "切换中心节点失败");
      }
    } catch {
      toast.error("切换中心节点失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleIssueCert = async (nodeId: number) => {
    setActionLoading(true);
    try {
      const res = await issueNodeSDWANCert(nodeId);

      if (res.code === 0) {
        toast.success("节点证书签发成功");
        await loadData();
      } else {
        toast.error(res.msg || "节点证书签发失败");
      }
    } catch {
      toast.error("节点证书签发失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleBackup = async (nodeId: number, enabled: boolean) => {
    setActionLoading(true);
    try {
      const res = await toggleSDWANBackupLighthouse(nodeId, enabled);

      if (res.code === 0) {
        toast.success(enabled ? "已设为备中心节点" : "已移除备中心节点");
        await loadData();
      } else {
        toast.error(res.msg || "备中心节点操作失败");
      }
    } catch {
      toast.error("备中心节点操作失败");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <AnimatedPage className="px-3 lg:px-6 py-8 flex items-center justify-center">
        <Spinner size="lg" />
      </AnimatedPage>
    );
  }

  const networkMembers = (status?.nodes || []).filter((node) => node.hasCert);
  const offlineMembers = networkMembers.filter((node) => node.status !== 1);

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SDWAN 组网管理</h1>
          <p className="text-sm text-default-500 mt-1">
            统一查看证书、中心节点与批量组网状态
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="flat" onPress={() => loadData()}>
            刷新
          </Button>
          <Button
            color="secondary"
            isLoading={actionLoading}
            variant="flat"
            onPress={async () => {
              setActionLoading(true);
              try {
                const res = await reconcileSDWAN();

                if (res.code === 0) {
                  toast.success("已执行 SDWAN 故障切换检查");
                  await loadData();
                } else {
                  toast.error(res.msg || "SDWAN 故障切换检查失败");
                }
              } catch {
                toast.error("SDWAN 故障切换检查失败");
              } finally {
                setActionLoading(false);
              }
            }}
          >
            故障切换检查
          </Button>
          <Button
            color="primary"
            isDisabled={selectedIds.size === 0}
            isLoading={actionLoading}
            onPress={handleBootstrap}
          >
            批量组网
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>CA</CardHeader>
          <CardBody className="text-sm">
            {status?.caReady ? "已生成" : "未生成"}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>主中心节点</CardHeader>
          <CardBody className="text-sm space-y-1">
            <div>{status?.lighthouseName || "未指定"}</div>
            <div className="text-default-500">
              {status?.lighthouseVPNIP || "-"}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>已入网节点</CardHeader>
          <CardBody className="text-sm">
            {(status?.nodes || []).filter((n) => n.hasCert).length} /{" "}
            {status?.nodes?.length || 0}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>当前组网说明</CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p>
            当前版本只有<strong>一张全局 SDWAN 网络</strong>。所以：
          </p>
          <ul className="list-disc pl-5 space-y-1 text-default-600">
            <li>
              列表里<strong>已签证书</strong>且有 <code>VPN IP</code>{" "}
              的节点，就表示已经加入同一张网。
            </li>
            <li>
              <strong>主中心节点</strong>和<strong>备用中心节点</strong>
              也属于这张网，只是承担的角色不同。
            </li>
            <li>没有证书或没有 VPN IP 的节点，表示还没真正入网。</li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>当前网络成员</CardHeader>
        <CardBody className="space-y-3">
          <div className="text-sm text-default-600">
            已入网 <strong>{networkMembers.length}</strong> 个节点
            {offlineMembers.length > 0 && (
              <span className="ml-2 text-warning-600">
                其中离线 {offlineMembers.length} 个
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {networkMembers.length === 0 ? (
              <div className="text-default-500 text-sm">
                当前还没有已入网节点
              </div>
            ) : (
              networkMembers.map((node) => (
                <div
                  key={node.id}
                  className="rounded-lg border border-divider px-4 py-3 bg-default-50/40"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{node.name}</span>
                    {node.role === "primary" && (
                      <span className="px-2 py-0.5 rounded text-xs bg-warning-500/10 text-warning-600">
                        主中心节点
                      </span>
                    )}
                    {node.role === "backup" && (
                      <span className="px-2 py-0.5 rounded text-xs bg-violet-500/10 text-violet-600">
                        备用中心节点
                      </span>
                    )}
                    {node.role === "peer" && (
                      <span className="px-2 py-0.5 rounded text-xs bg-primary-500/10 text-primary-600">
                        普通成员
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-default-500">
                    VPN IP: {node.vpnIp}
                  </div>
                  <div className="text-xs text-default-500 mt-1">
                    状态: {node.status === 1 ? "在线" : "离线"}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>全局网络配置</CardHeader>
        <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="SDWAN 网段"
            placeholder="例如: 192.168.100.0/24"
            value={settings.networkCIDR}
            variant="bordered"
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                networkCIDR: e.target.value,
              }))
            }
          />
          <Input
            label="故障切换检查间隔(秒)"
            placeholder="30"
            value={String(settings.reconcileIntervalSec)}
            variant="bordered"
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                reconcileIntervalSec: Number(e.target.value || 30),
              }))
            }
          />
          <div className="flex items-end justify-between gap-4 rounded-lg border border-divider px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">自动故障切换</span>
              <span className="text-xs text-default-500">
                后台定时检查主中心节点并自动提升备中心节点
              </span>
            </div>
            <Switch
              isSelected={settings.autoReconcileEnabled}
              onValueChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  autoReconcileEnabled: checked,
                }))
              }
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <Button
              color="primary"
              isLoading={actionLoading}
              onPress={async () => {
                setActionLoading(true);
                try {
                  const res = await saveSDWANSettings(settings);

                  if (res.code === 0) {
                    toast.success("SDWAN 全局配置已保存");
                    await loadData();
                  } else {
                    toast.error(res.msg || "保存 SDWAN 配置失败");
                  }
                } catch {
                  toast.error("保存 SDWAN 配置失败");
                } finally {
                  setActionLoading(false);
                }
              }}
            >
              保存 SDWAN 配置
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>备中心节点</CardHeader>
        <CardBody className="text-sm space-y-2">
          {status?.backupLighthouses?.length ? (
            status.backupLighthouses.map((node) => (
              <div
                key={node.id}
                className="flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-medium">{node.name}</div>
                  <div className="text-default-500 text-xs">
                    {node.vpnIp} / {node.addr}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-default-500">暂无备中心节点</div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>节点列表</CardHeader>
        <CardBody className="space-y-3">
          {(status?.nodes || []).map((node) => (
            <div
              key={node.id}
              className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-lg border border-divider"
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  isSelected={selectedIds.has(node.id)}
                  onValueChange={() => toggleSelect(node.id)}
                />
                <div>
                  <div className="font-medium flex items-center gap-2">
                    <span>{node.name}</span>
                    {node.role === "primary" && (
                      <span className="px-2 py-0.5 rounded text-xs bg-warning-500/10 text-warning-600">
                        主中心节点
                      </span>
                    )}
                    {node.role === "backup" && (
                      <span className="px-2 py-0.5 rounded text-xs bg-violet-500/10 text-violet-600">
                        备中心节点
                      </span>
                    )}
                    {node.role === "peer" && node.hasCert && (
                      <span className="px-2 py-0.5 rounded text-xs bg-primary-500/10 text-primary-600">
                        已组网
                      </span>
                    )}
                    {!node.hasCert && (
                      <span className="px-2 py-0.5 rounded text-xs bg-default-500/10 text-default-500">
                        未组网
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-default-500 mt-1">
                    VPN IP: {node.vpnIp || "未分配"}
                  </div>
                  <div className="text-xs text-default-500 mt-1">
                    证书: {node.hasCert ? "已签发" : "未签发"}
                  </div>
                  <div className="text-xs text-default-500 mt-1">
                    网络角色:{" "}
                    {node.role === "primary"
                      ? "主中心节点"
                      : node.role === "backup"
                        ? "备用中心节点"
                        : node.hasCert
                          ? "普通成员"
                          : "未入网"}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => handleIssueCert(node.id)}
                >
                  签证书
                </Button>
                <Button
                  color="secondary"
                  size="sm"
                  variant="flat"
                  onPress={() =>
                    handleToggleBackup(node.id, node.role !== "backup")
                  }
                >
                  {node.role === "backup" ? "移除备中心节点" : "设为备中心节点"}
                </Button>
                <Button
                  color="primary"
                  size="sm"
                  variant="flat"
                  onPress={() => handleSetLighthouse(node.id)}
                >
                  设为中心节点
                </Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </AnimatedPage>
  );
}
