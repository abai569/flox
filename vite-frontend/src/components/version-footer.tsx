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
  setUpdateReleaseChannel,
} from "@/utils/version-update";
import { checkSystemUpgrade } from "@/api";
import type { SystemUpgradeReleaseApiItem } from "@/api/types";
import { runSystemUpgrade } from "@/api/index";

const FALLBACK_GITHUB_REPO = "https://github.com/abai569/FLOX";
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
  isAdmin?: boolean;
}

export function VersionFooter({
  version,
  showUpdateInfo = true,
  containerClassName,
  versionClassName,
  poweredClassName,
  updateBadgeClassName,
  isAdmin = false,
}: VersionFooterProps) {
  const [channel, setChannel] = useState<UpdateReleaseChannel>(
    getUpdateReleaseChannel(),
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestUpdateVersion, setLatestUpdateVersion] = useState<string | null>(
    null,
  );
  const [upgrading, setUpgrading] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);

  // Manual upgrade modal state
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [releases, setReleases] = useState<SystemUpgradeReleaseApiItem[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [panelLatestVersion, setPanelLatestVersion] = useState<string | null>(
    null,
  );

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

        return;
      }

      const hasUpdate = hasVersionUpdate(version, latestVersion);

      setUpdateAvailable(hasUpdate);
      setLatestUpdateVersion(hasUpdate ? latestVersion : null);
    };

    void checkUpdate();

    const interval = setInterval(checkUpdate, 24 * 60 * 60 * 1000);

    return () => {
      active = false;
      clearInterval(interval);
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
      const res = await checkSystemUpgrade(channel);

      if (res.code === 0 && res.data && res.data.releases) {
        setReleases(res.data.releases);
        if (!panelLatestVersion && res.data.releases.length > 0) {
          setPanelLatestVersion(res.data.releases[0].version);
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
        {upgrading ? (
          <p className={versionClassName}>
            <span className="animate-pulse inline-flex items-center h-[18px] px-2 rounded text-[10px] font-semibold bg-primary text-primary-foreground">
              升级中...
            </span>
          </p>
        ) : showUpdateInfo && updateAvailable && latestUpdateVersion ? (
          <div className="flex flex-col gap-0.5">
            <p className={versionClassName}>
              <span className="text-gray-600 dark:text-white">{version}</span>
            </p>
            <p className={versionClassName}>
              <span className="text-blue-600 dark:text-white text-[10px]">
                ⬇
              </span>
            </p>
            <p className={versionClassName}>
              <span className={updateBadgeClassName} role="status">
                {latestUpdateVersion}
              </span>{" "}
              {showUpdateInfo && (
                <Button
                  className="inline-flex w-[24px] h-[16px] px-0 text-[9px] min-w-0 rounded-xs font-semibold [&>span]:text-[9px]"
                  color="danger"
                  size="sm"
                  onPress={handleOpenUpgradeModal}
                >
                  UP
                </Button>
              )}
            </p>
          </div>
        ) : (
          <p className={versionClassName}>
            <span className="text-gray-600 dark:text-white">{version}</span>{" "}
            {showUpdateInfo && (
              <Button
                className="inline-flex w-[24px] h-[16px] px-0 text-[9px] min-w-0 rounded-xs font-semibold [&>span]:text-[9px]"
                color="danger"
                size="sm"
                onPress={handleOpenUpgradeModal}
              >
                UP
              </Button>
            )}
          </p>
        )}
        {isAdmin && (
          <p className={[versionClassName, "mt-1"].filter(Boolean).join(" ")}>
            <span className="inline-flex rounded-sm bg-gray-100 dark:bg-gray-800">
              <button
                className={`text-[10px] leading-none px-2 py-0.5 rounded-sm transition-colors cursor-pointer font-medium ${channel === "stable" ? "bg-primary text-primary-foreground shadow-sm" : "text-gray-400 dark:text-white hover:text-gray-600 dark:hover:text-gray-300"}`}
                onClick={() => {
                  if (channel !== "stable") {
                    setUpdateReleaseChannel("stable");
                    toast.success("已切换为稳定版");
                  }
                }}
              >
                稳定版
              </button>
              <button
                className={`text-[10px] leading-none px-2 py-0.5 rounded-sm transition-colors cursor-pointer font-medium ${channel === "dev" ? "bg-primary text-primary-foreground shadow-sm" : "text-gray-400 dark:text-white hover:text-gray-600 dark:hover:text-gray-300"}`}
                onClick={() => {
                  if (channel !== "dev") {
                    setUpdateReleaseChannel("dev");
                    toast.success("已切换为开发版");
                  }
                }}
              >
                开发版
              </button>
            </span>
          </p>
        )}
        <p className={[poweredClassName, "mt-1"].filter(Boolean).join(" ")}>
          Powered by{" "}
          <a
            className="text-gray-600 dark:text-white hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            href={siteConfig.github_repo}
            rel="noopener noreferrer"
            target="_blank"
          >
            Flox
          </a>
        </p>
      </div>

      {/* Auto notification popup */}
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
                        {version}
                      </span>
                    </div>
                    <div className="text-default-500 text-left">
                      最新版本：
                      <span className="font-medium text-primary">
                        {latestUpdateVersion ? `${latestUpdateVersion}` : "-"}
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
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Manual upgrade modal with version selection */}
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
                          {version}
                        </span>
                      </div>
                      <div className="text-default-500 text-left">
                        目标版本：
                        <span className="font-medium text-default-900 dark:text-white">
                          {selectedVersion ||
                            (panelLatestVersion
                              ? `${panelLatestVersion}`
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
