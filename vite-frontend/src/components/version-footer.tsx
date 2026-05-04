import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@/shadcn-bridge/heroui/modal";
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
import { getPanelReleases, upgradePanel, type PanelReleaseItem } from "@/api";

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
      const res = await upgradePanel(selectedVersion || undefined, channel);
      if (res.code === 0) {
        toast.success(res.msg || "升级已提交，面板将自动重启");
        setUpgradeModalOpen(false);
      } else {
        toast.error(res.msg || "升级失败");
      }
    } catch (err) {
      toast.error("升级失败：" + (err as Error).message);
    } finally {
      setUpgrading(false);
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
            variant="flat"
            className="ml-0.5 h-auto px-1.5 py-0 text-[10px] min-w-0 rounded-md"
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
                ) : (
                  <div className="space-y-4">
                    <div className="text-sm justify-between">
                      <p className="text-default-500">
                        当前版本：<span className="font-medium text-default-900 dark:text-white">v{version}</span>
                      </p>
                      <p className="text-default-500 mt-1">
                        目标版本：<span className="font-medium text-default-900 dark:text-white">
                          {selectedVersion || (panelLatestVersion ? `v${panelLatestVersion}` : "最新版本")}
                        </span>
                      </p>
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
                    <div className="text-xs text-default-500">
                      <p className="font-medium mb-1">升级说明：</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>升级将重启面板服务（backend + frontend + postgres）</li>
                        <li>升级过程中面板将暂时不可用</li>
                        <li>升级失败会自动回滚到原版本</li>
                        <li>请确保服务器网络连接稳定</li>
                      </ul>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose} isDisabled={upgrading}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isDisabled={releasesLoading}
                  isLoading={upgrading}
                  onPress={handleConfirmUpgrade}
                >
                  确认升级
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
