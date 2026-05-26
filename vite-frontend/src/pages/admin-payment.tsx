import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { PageLoadingState } from "@/components/page-state";
import Network from "@/api/network";

interface PaymentConfigItem {
  id: number;
  channel: string;
  config: string;
  enabled: number;
}

const channelInfo: Record<string, { label: string; fields: { key: string; label: string; placeholder: string }[] }> = {
  YIPAY: {
    label: "易支付",
    fields: [
      { key: "gateway_url", label: "网关地址", placeholder: "https://your.epay.com" },
      { key: "pid", label: "商户ID", placeholder: "1000" },
      { key: "key", label: "商户密钥", placeholder: "32位MD5密钥" },
      { key: "notify_url", label: "异步回调地址", placeholder: "https://your.panel.com/api/v1/payment/callback/yipay" },
      { key: "return_url", label: "同步跳转地址", placeholder: "https://your.panel.com/shop" },
    ],
  },
  USDT: {
    label: "USDT (TRC-20)",
    fields: [
      { key: "api_key", label: "API Key", placeholder: "NowPayments API Key" },
      { key: "ipn_secret", label: "IPN Secret", placeholder: "NowPayments IPN Secret" },
    ],
  },
};

const defaultConfigTemplates: Record<string, string> = {
  YIPAY: JSON.stringify({
    gateway_url: "",
    pid: "",
    key: "",
    notify_url: "",
    return_url: "",
  }, null, 2),
  USDT: JSON.stringify({
    api_key: "",
    ipn_secret: "",
  }, null, 2),
};

export default function AdminPaymentPage() {
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<PaymentConfigItem[]>([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState("");
  const [formConfig, setFormConfig] = useState("");
  const [formEnabled, setFormEnabled] = useState(0);
  const [submitLoading, setSubmitLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Network.post<PaymentConfigItem[]>("/payment/config/admin/list");
      if (res.code === 0) {
        setConfigs(Array.isArray(res.data) ? res.data : []);
      } else {
        toast.error(res.msg || "获取支付配置失败");
      }
    } catch {
      toast.error("获取支付配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleEdit = (channel: string) => {
    const existing = configs.find((c) => c.channel === channel);
    setEditingChannel(channel);
    setFormConfig(existing?.config || defaultConfigTemplates[channel] || "{}");
    setFormEnabled(existing?.enabled ?? 0);
    setEditModalOpen(true);
  };

  const handleSave = async () => {
    setSubmitLoading(true);
    try {
      let configObj;
      try {
        configObj = JSON.parse(formConfig);
      } catch {
        toast.error("配置 JSON 格式错误");
        setSubmitLoading(false);
        return;
      }

      const res = await Network.post("/payment/config/save", {
        channel: editingChannel,
        config: JSON.stringify(configObj),
        enabled: formEnabled,
      });
      if (res.code === 0) {
        toast.success("保存成功");
        setEditModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || "保存失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (channel: string) => {
    try {
      const res = await Network.post("/payment/config/delete", { channel });
      if (res.code === 0) {
        toast.success("已删除");
        loadData();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误");
    }
  };

  if (loading) return <PageLoadingState message="加载支付配置..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">支付配置</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Object.entries(channelInfo).map(([channel, info]) => {
          const cfg = configs.find((c) => c.channel === channel);
          return (
            <Card key={channel}>
              <CardHeader>
                <div className="flex justify-between items-center w-full">
                  <span className="font-medium">{info.label}</span>
                  <Chip color={cfg?.enabled ? "success" : "default"} size="sm">
                    {cfg?.enabled ? "已启用" : "未配置"}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody>
                <div className="space-y-2 text-sm mb-4">
                  <div className="flex justify-between text-gray-400">
                    <span>渠道</span>
                    <span className="font-mono">{channel}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>状态</span>
                    <span>{cfg?.enabled ? "启用" : "禁用"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" color="primary" variant="flat" onPress={() => handleEdit(channel)}>
                    {cfg ? "编辑" : "配置"}
                  </Button>
                  {cfg && (
                    <Button size="sm" color="danger" variant="flat" onPress={() => handleDelete(channel)}>
                      清除
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Modal isOpen={editModalOpen} placement="center" size="2xl"
        onOpenChange={(open) => { if (!open) setEditModalOpen(false); }}>
        <ModalContent>
          <ModalHeader>
            配置 {channelInfo[editingChannel]?.label || editingChannel}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch
                isSelected={formEnabled === 1}
                onValueChange={(v) => setFormEnabled(v ? 1 : 0)}
              />
              <span className="text-sm">启用</span>
            </div>

            {channelInfo[editingChannel]?.fields.map((field) => {
              let parsed;
              try { parsed = JSON.parse(formConfig); } catch { parsed = {}; }
              return (
                <Input
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  value={parsed[field.key] || ""}
                  variant="bordered"
                  onChange={(e) => {
                    let obj;
                    try { obj = JSON.parse(formConfig); } catch { obj = {}; }
                    obj[field.key] = e.target.value;
                    setFormConfig(JSON.stringify(obj, null, 2));
                  }}
                />
              );
            })}

            <div className="mt-2">
              <label className="text-sm text-gray-400 mb-1 block">JSON 配置（高级）</label>
              <textarea
                className="w-full h-40 p-3 border rounded-lg text-xs font-mono bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                value={formConfig}
                onChange={(e) => setFormConfig(e.target.value)}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setEditModalOpen(false)}>取消</Button>
            <Button color="primary" isLoading={submitLoading} onPress={handleSave}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
