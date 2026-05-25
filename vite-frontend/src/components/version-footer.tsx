import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { siteConfig } from "@/config/site";
import {
  UPDATE_CHANNEL_CHANGED_EVENT,
  type UpdateReleaseChannel,
  getLatestVersionByChannel,
  getUpdateReleaseChannel,
  hasVersionUpdate,
} from "@/utils/version-update";
import { getPanelReleases, type PanelReleaseItem } from "@/api";
import { runSystemUpgrade } from "@/api/index";

const FALLBACK_GITHUB_REPO = "https://github.com/abai569/flvx";
const UPGRADE_DISMISS_KEY = "upgrade_dismissed_date";

const isUpgradeDismissedToday = (): boolean => {
  try {
    const dismissed = localStorage.getItem(UPGRADE_DISMISS_KEY);

    if (!dismissed) return false;
    const dismissedDate = new Date(dismissed);
    const today = new Date();

    return (
      dismissedDate.getFullYear() === today.getFullYear() &&
      dismissedDate.getMonth() === today.getMonth() &&
      dismissedDate.getDate() === today.getDate()
    );
  } catch {
    return false;
  }
};

interface VersionFooterProps {
  version: string;
  showUpdateInfo?: boolean;
  containerClassName?: string;
  versionClassName?: string;
  poweredClassName?: string;
  updateBadgeClassName?: string;
}

export function VersionFooter({
  version,
  showUpdateInfo = true,
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
  const [notificationOpen, setNotificationOpen] = useState(false);

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
    if (updateAvailable && showUpdateInfo && !isUpgradeDismissedToday()) {
      setNotificationOpen(true);
    }
  }, [updateAvailable, showUpdateInfo]);

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
    try {
      const res = await runSystemUpgrade(selectedVersion || undefined, channel);

      if (res.code === 0) {
        setUpgradeModalOpen(false);
        toast.success(res.data?.message || "升级已触发，面板将自动重启");
        setTimeout(() => {
          window.location.reload();
        }, 60000);
      } else {
        toast.error(res.msg || "升级失败");
        setUpgrading(false);
      }
    } catch (err) {
      toast.error("升级失败：" + (err as Error).message);
      setUpgrading(false);
    }
  };

  const handleDirectUpgrade = async () => {
    setNotificationOpen(false);
    setUpgrading(true);
    try {
      const res = await runSystemUpgrade(
        latestUpdateVersion || undefined,
        channel,
      );

      if (res.code === 0) {
        toast.success(res.data?.message || "升级已触发，面板将自动重启");
        setTimeout(() => {
          window.location.reload();
        }, 60000);
      } else {
        toast.error(res.msg || "升级失败");
        setUpgrading(false);
      }
    } catch (err) {
      toast.error("升级失败：" + (err as Error).message);
      setUpgrading(false);
    }
  };

  const handleDismissNotification = () => {
    localStorage.setItem(UPGRADE_DISMISS_KEY, new Date().toISOString());
    setNotificationOpen(false);
  };

  return (
    <>
      <div className={containerClassName}>
        <p className={versionClassName}>
          v{version}
          {showUpdateInfo && updateAvailable && latestUpdateVersion && (
            <>
              {" → "}
              <span className={updateBadgeClassName} role="status">
                {latestUpdateVersion}
              </span>
            </>
          )}{" "}
          {showUpdateInfo && (
            <Button
              className="inline-flex h-[16px] px-1.5 text-[9px] min-w-0 rounded-xs font-semibold [&>span]:text-[9px]"
              color="primary"
              isLoading={upgrading}
              size="sm"
              onPress={handleOpenUpgradeModal}
            >
              升级
            </Button>
          )}
        </p>
        <p className={poweredClassName}>
          Powered by{" "}
          <a
            className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            href={siteConfig.github_repo}
            rel="noopener noreferrer"
            target="_blank"
          >
            FLVX
          </a>
        </p>
      </div>

      <Modal
        backdrop="blur"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={notificationOpen}
        placement="center"
        scrollBehavior="outside"
        size="sm"
        onOpenChange={setNotificationOpen}
      >
        <ModalContent>
          {(_onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">发现新版本</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm w-full">
                    <div className="text-default-500 text-left">
                      当前版本：
                      <span className="font-medium text-default-900 dark:text-white">
                        v{version}
                      </span>
                    </div>
                    <div className="text-default-500 text-left">
                      最新版本：
                      <span className="font-medium text-primary">
                        {latestUpdateVersion ? `v${latestUpdateVersion}` : "-"}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-default-500">
                    是否立即升级面板？
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 list-disc list-outside pl-4 text-xs text-danger-600/80 dark:text-danger-400/80">
                    <p className="list-item">升级将重启面板和后端服务</p>
                    <p className="list-item">升级过程中面板将暂时不可用</p>
                    <p className="list-item">升级失败会自动回滚到原版本</p>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter className="flex gap-2">
                <Button
                  isDisabled={upgrading}
                  variant="flat"
                  onPress={handleDismissNotification}
                >
                  忽略
                </Button>
                <Button
                  color="primary"
                  isLoading={upgrading}
                  onPress={handleDirectUpgrade}
                >
                  升级
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

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
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm w-full">
                      <div className="text-default-500 text-left">
                        当前版本：
                        <span className="font-medium text-default-900 dark:text-white">
                          v{version}
                        </span>
                      </div>
                      <div className="text-default-500 text-left">
                        目标版本：
                        <span className="font-medium text-default-900 dark:text-white">
                          {selectedVersion ||
                            (panelLatestVersion
                              ? `v${panelLatestVersion}`
                              : "最新版本")}
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
                <Button isDisabled={upgrading} variant="flat" onPress={onClose}>
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
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
