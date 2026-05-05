import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@/shadcn-bridge/heroui/modal";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Progress } from "@/shadcn-bridge/heroui/progress";

import { siteConfig } from "@/config/site";
import {
  UPDATE_CHANNEL_CHANGED_EVENT,
  type UpdateReleaseChannel,
  getLatestVersionByChannel,
  getUpdateReleaseChannel,
  hasVersionUpdate,
} from "@/utils/version-update";
import { getPanelReleases, upgradePanel, type PanelReleaseItem } from "@/api";

interface UpgradeProgressState {
  stage: string;
  percent: number;
  message: string;
  error: boolean;
}

const FALLBACK_GITHUB_REPO = "https://github.com/abai569/flvx";

interface VersionFooterProps {
  version: string;
  containerClassName?: string;
  versionClassName?: string;
  poweredClassName?: string;
  updateBadgeClassName?: string;
}

export function VersionFooter({
  version,
  containerClassName,
  versionClassName,
  poweredClassName,
  updateBadgeClassName,
}: VersionFooterProps) {
  const [channel, setChannel] = useState<UpdateReleaseChannel>(
    getUpdateReleaseChannel(),
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestUpdateVersion, setLatestUpdateVersion] = useState<string | null>(
    null,
  );
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [releases, setReleases] = useState<PanelReleaseItem[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [upgrading, setUpgrading] = useState(false);
  const [panelLatestVersion, setPanelLatestVersion] = useState<string | null>(
    null,
  );
  const [upgradeProgress, setUpgradeProgress] = useState<UpgradeProgressState | null>(null);

  useEffect(() => {
    const handleChannelChange = () => {
      setChannel(getUpdateReleaseChannel());
    };

    window.addEventListener(UPDATE_CHANNEL_CHANGED_EVENT, handleChannelChange);
    window.addEventListener("storage", handleChannelChange);

    return () => {
      window.removeEventListener(
        UPDATE_CHANNEL_CHANGED_EVENT,
        handleChannelChange,
      );
      window.removeEventListener("storage", handleChannelChange);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const checkUpdate = async () => {
      const latestVersion = await getLatestVersionByChannel(
        channel,
        siteConfig.github_repo || FALLBACK_GITHUB_REPO,
      );

      if (!active) {
        return;
      }

      if (!latestVersion) {
        setUpdateAvailable(false);
        setLatestUpdateVersion(null);
        setPanelLatestVersion(null);

        return;
      }

      const hasUpdate = hasVersionUpdate(version, latestVersion);

      setUpdateAvailable(hasUpdate);
      setLatestUpdateVersion(hasUpdate ? latestVersion : null);
      setPanelLatestVersion(latestVersion);
    };

    void checkUpdate();

    return () => {
      active = false;
    };
  }, [channel, version]);

  useEffect(() => {
    const handleUpgradeProgress = (e: Event) => {
      const customEvent = e as CustomEvent<UpgradeProgressState>;
      setUpgradeProgress(customEvent.detail);

      if (customEvent.detail.error) {
        toast.error(`升级失败：${customEvent.detail.message}`, { duration: 8000 });
        setUpgrading(false);
      } else if (customEvent.detail.percent >= 100) {
        toast.success("升级完成，页面将自动刷新");
        setUpgrading(false);
        setUpgradeModalOpen(false);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    };

    window.addEventListener("panel_upgrade_progress", handleUpgradeProgress);
    return () => {
      window.removeEventListener("panel_upgrade_progress", handleUpgradeProgress);
    };
  }, []);

  const loadReleases = async () => {
    setReleasesLoading(true);
    try {
      const res = await getPanelReleases(channel);
      if (res.code === 0 && res.data) {
        setReleases(res.data);
        if (!panelLatestVersion && res.data.length > 0) {
          setPanelLatestVersion(res.data[0].version);
        }
      }
    } catch (err) {
      console.error("加载版本列表失败:", err);
    } finally {
      setReleasesLoading(false);
    }
  };

  const handleOpenUpgradeModal = async () => {
    setSelectedVersion("");
    await loadReleases();
    setUpgradeModalOpen(true);
  };

  const handleConfirmUpgrade = async () => {
    setUpgrading(true);
    setUpgradeProgress({ stage: "starting", percent: 0, message: "开始升级...", error: false });
    try {
      const res = await upgradePanel(selectedVersion || undefined, channel);
      if (res.code !== 0) {
        toast.error(res.msg || "升级失败");
        setUpgrading(false);
        setUpgradeProgress(null);
      }
    } catch (err) {
      toast.error("升级失败：" + (err as Error).message);
      setUpgrading(false);
      setUpgradeProgress(null);
    }
  };

  return (
    <>
      <div className={containerClassName}>
        <p className={versionClassName}>
          v{version}
          {updateAvailable && latestUpdateVersion && (
            <>
              {" → "}
              <span className={updateBadgeClassName} role="status">
                {latestUpdateVersion}
              </span>
            </>
          )}
          {" "}
          <Button
            size="sm"
            color="primary"
            className="inline-flex h-[18px] px-1.5 text-[10px] min-w-0 rounded-sm font-semibold"
            onPress={handleOpenUpgradeModal}
            isLoading={upgrading}
          >
            升级
          </Button>
        </p>
        <p className={poweredClassName}>
          Powered by Flvx
        </p>
      </div>

      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={upgradeModalOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onOpenChange={setUpgradeModalOpen}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">升级面板</h2>
              </ModalHeader>
              <ModalBody>
                {releasesLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner size="lg" />
                  </div>
                ) : upgrading && upgradeProgress ? (
                  <div className="space-y-4 py-4">
                    <div className="text-center">
                      <p className="text-sm font-medium text-default-800 dark:text-white mb-2">
                        {upgradeProgress.message}
                      </p>
                      <Progress
                        aria-label="升级进度"
                        className="w-full"
                        color={upgradeProgress.error ? "danger" : "warning"}
                        showValueLabel
                        size="md"
                        value={upgradeProgress.percent}
                      />
                    </div>
                    {upgradeProgress.error && (
                      <div className="p-3 bg-danger-50 dark:bg-danger-900/20 rounded-lg border border-danger-200 dark:border-danger-800">
                        <p className="text-xs text-danger-600 dark:text-danger-400">
                          {upgradeProgress.message}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm w-full">
                      <div className="text-default-500 text-left">
                        当前版本：<span className="font-medium text-default-900 dark:text-white">v{version}</span>
                      </div>
                      <div className="text-default-500 text-left">
                        目标版本：<span className="font-medium text-default-900 dark:text-white">
                          {selectedVersion || (panelLatestVersion ? `v${panelLatestVersion}` : "最新版本")}
                        </span>
                      </div>
                    </div>
                    <Select
                      label="选择版本"
                      placeholder="留空则使用当前通道最新版本"
                      selectedKeys={selectedVersion ? [selectedVersion] : []}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0] as string;
                        setSelectedVersion(selected || "");
                      }}
                    >
                      {releases.map((r) => (
                        <SelectItem key={r.version} textValue={r.version}>
                          <div className="flex justify-between items-center">
                            <span>{r.version}</span>
                            <span className="text-xs text-default-400">
                              {new Date(r.publishedAt).toLocaleDateString()}
                              {r.channel === "dev" && (
                                <div className="ml-1 shrink-0 whitespace-nowrap inline-flex items-center justify-center bg-warning-500/10 text-warning-600 dark:text-warning-400 px-1.5 py-0.5 rounded text-[11px] font-medium">
                                  测试
                                </div>
                              )}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </Select>
                    <div className="flex items-center text-center gap-1.5 mb-2 text-default-000">
                      <span className="text-sm font-semibold">升级说明</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 list-disc list-outside pl-4 text-xs text-danger-600/80 dark:text-danger-400/80">
                      <p className="list-item">升级将重启面板和后端服务</p>
                      <p className="list-item">升级过程中面板将暂时不可用</p>
                      <p className="list-item">升级失败会自动回滚到原版本</p>
                      <p className="list-item">请确保服务器网络连接稳定</p>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                {upgrading && upgradeProgress ? (
                  <Button
                    className="w-full"
                    isDisabled={!upgradeProgress.error}
                    variant="flat"
                    onPress={onClose}
                  >
                    {upgradeProgress.error ? "关闭" : "等待升级完成..."}
                  </Button>
                ) : (
                  <>
                    <Button variant="flat" onPress={onClose} isDisabled={upgrading}>
                      取消
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={releasesLoading}
                      isLoading={upgrading}
                      onPress={handleConfirmUpgrade}
                    >
                      确认
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
