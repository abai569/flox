import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { Button } from "@/shadcn-bridge/heroui/button";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";

import { AnimatedPage } from "@/components/animated-page";
import { getLicenseInfo, type LicenseInfo } from "@/api";

import {
  getTelegramConfig,
  updateTelegramConfig,
  testTelegramBot,
  type TelegramConfig,
} from "@/api";

interface NotificationItemProps {
  icon: string;
  title: string;
  desc: string;
}

function NotificationItem({ icon, title, desc }: NotificationItemProps) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl border border-divider bg-default-50/50 hover:bg-default-100/80 transition-colors shadow-sm cursor-default">
      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-primary/10 text-xl shadow-sm border border-primary/20">
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{title}</p>
        <p className="text-xs text-default-500 truncate mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

export default function AdminTelegramPage() {
  const [config, setConfig] = useState<TelegramConfig>({
    bot_token: "",
    chat_id: "",
    enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);

  const isFree = licenseInfo?.tier === "free";

  const loadData = useCallback(async () => {
    try {
      const [cfg, lic] = await Promise.all([
        getTelegramConfig(),
        getLicenseInfo(),
      ]);
      setConfig(cfg);
      setLicenseInfo(lic.data || null);
    } catch {
      toast.error("加载配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateTelegramConfig(
        config.bot_token,
        config.chat_id,
        config.enabled,
      );
      if (res.code === 0) {
        toast.success("保存成功");
      } else {
        toast.error(res.msg || "保存失败");
      }
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await testTelegramBot();
      if (res.code === 0) {
        toast.success("测试消息已发送，请在 Telegram 中查看");
      } else {
        toast.error(res.msg || "测试失败");
      }
    } catch {
      toast.error("测试失败");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <AnimatedPage className="px-3 lg:px-6 py-8 flex items-center justify-center">
        <Spinner size="lg" />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Telegram Bot 配置</h1>
      </div>

      {isFree && (
        <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded-lg mb-6">
          免费版不支持 Telegram Bot，请配置正式授权以使用此功能
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">基本设置</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              填写 Bot Token 和 Chat ID，即可在 Telegram 中接收面板告警通知
            </p>
          </div>
          <Switch
            color="primary"
            isDisabled={isFree}
            isSelected={config.enabled}
            onValueChange={(v) => {
              setConfig((c) => ({ ...c, enabled: v }));
              updateTelegramConfig(config.bot_token, config.chat_id, v)
                .then((res) => {
                  if (res.code === 0) {
                    toast.success(v ? "Bot 已启用" : "Bot 已禁用");
                  } else {
                    toast.error(res.msg || "切换失败");
                    setConfig((c) => ({ ...c, enabled: !v }));
                  }
                })
                .catch(() => {
                  toast.error("切换失败");
                  setConfig((c) => ({ ...c, enabled: !v }));
                });
            }}
          />
        </CardHeader>
        <CardBody className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Input
              label="Bot Token"
              placeholder="123456:ABC-DEF1234ghIkl-zyx..."
              value={config.bot_token}
              isDisabled={isFree}
              onChange={(e) => setConfig((c) => ({ ...c, bot_token: e.target.value }))}
              description="通过 Telegram @BotFather 创建机器人后向机器人发送 /start 获取，格式如 123456:ABC-DEF..."
            />
            <Input
              label="Chat ID"
              placeholder="个人 ID 或 -100xxxxxxxxxx"
              value={config.chat_id}
              isDisabled={isFree}
              onChange={(e) => setConfig((c) => ({ ...c, chat_id: e.target.value }))}
              description="向机器人发送 /start 获取，群/频道通过 @getidsbot 获取（频道格式为 -100xxxxxxxxxx）"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Bot 状态：</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      config.enabled && !isFree
                        ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                        : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      config.enabled && !isFree ? "text-green-600" : "text-red-500"
                    }`}
                  >
                    {isFree ? "未启用（免费版）" : config.enabled ? "运行中" : "睡觉中"}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                color="secondary"
                isLoading={testing}
                isDisabled={isFree || !config.enabled}
                size="sm"
                onPress={handleTest}
              >
                测试
              </Button>
              <Button
                color="primary"
                isLoading={saving}
                isDisabled={isFree}
                size="sm"
                onPress={handleSave}
              >
                保存
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-6 border border-divider shadow-sm">
        <CardHeader className="flex flex-col items-start gap-1 pb-4 pt-5 px-5">
          <h2 className="text-lg font-bold">推送通知列表</h2>
          <p className="text-xs text-default-500">当以下事件触发时，面板将自动通过 Telegram Bot 发送实时通知</p>
        </CardHeader>
        <CardBody className="pt-0 pb-5 px-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            <NotificationItem icon="🔌" title="节点上下线" desc="节点连接 / 断开时推送" />
            <NotificationItem icon="🚨" title="监控告警" desc="服务检查失败 / 恢复时通知" />
            <NotificationItem icon="⏳" title="节点到期提醒" desc="到期前 3 天起每天推送一次" />
            <NotificationItem icon="🚫" title="用户到期通知" desc="用户到期自动禁用时推送" />
            <NotificationItem icon="🔄" title="流量归零通知" desc="手动 / 自动 / 到期 / 续费归零" />
            <NotificationItem icon="🚀" title="面板启动/升级" desc="面板启动或版本升级时推送" />
            <NotificationItem icon="📊" title="流量告警" desc="用户流量使用达到阈值时推送" />
            <NotificationItem icon="⚠️" title="节点流量告警" desc="节点剩余流量不足 100G/50G/20G 时分别推送" />
          </div>
        </CardBody>
      </Card>
    </AnimatedPage>
  );
}
