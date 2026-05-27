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
import { siteConfig } from "@/config/site";
import {
  UPDATE_CHANNEL_CHANGED_EVENT,
  type UpdateReleaseChannel,
  getLatestVersionByChannel,
  getUpdateReleaseChannel,
  hasVersionUpdate,
} from "@/utils/version-update";
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
  const [upgrading, setUpgrading] = useState(false);
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
          {showUpdateInfo && updateAvailable && (
            <Button
              className="inline-flex h-[16px] px-1.5 text-[9px] min-w-0 rounded-xs font-semibold [&>span]:text-[9px]"
              color="primary"
              isLoading={upgrading}
              size="sm"
              onPress={handleDirectUpgrade}
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
    </>
  );
}
