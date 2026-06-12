import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
// 👇 加上这一行，引入动画组件
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "@/shadcn-bridge/heroui/button";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Textarea } from "@/shadcn-bridge/heroui/input";
import { Spinner } from "@/shadcn-bridge/heroui/spinner";
import { Divider } from "@/shadcn-bridge/heroui/divider";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import {
  updateConfigs,
  exportBackup,
  importBackup,
  getAnnouncement,
  updateAnnouncement,
  type AnnouncementData,
  getLicenseInfo,
  updateLicenseConfig,
  transferLicense,
  type LicenseInfo,
  setStoreStatus,
} from "@/api";
// 主题设置暂时放在这里，后续可以独立成一个页面或者组件
import { isAdmin } from "@/utils/auth";
import { getCachedConfigs, configCache, updateSiteConfig } from "@/config/site";
import {
  convertBrandAssetToPngDataURL,
  isPngDataURL,
  type BrandAssetKind,
} from "@/utils/brand-asset";

interface ConfigItem {
  key: string;
  label: string;
  placeholder?: string;
  description?: string;
  type: "input" | "switch" | "select";
  options?: { label: string; value: string; description?: string }[];
  dependsOn?: string | string[]; // 依赖的配置项key，数组时为 OR 逻辑
  dependsValue?: string; // 依赖的配置项值
}
const BRAND_PREVIEW_KEYS = ["app_logo", "app_favicon"] as const;

type BrandPreviewKey = (typeof BRAND_PREVIEW_KEYS)[number];
const isBrandPreviewKey = (key: string): key is BrandPreviewKey =>
  BRAND_PREVIEW_KEYS.includes(key as BrandPreviewKey);
const BRAND_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const toBrandAssetKind = (key: BrandPreviewKey): BrandAssetKind => {
  return key === "app_logo" ? "logo" : "favicon";
};
// 快捷开关（直接生效，不受保存按钮控制）
const STANDALONE_SWITCH_KEYS = [
  "payment_enabled",
  "registration_enabled",
  "login_monitor_link",
];
// 网站配置项定义
const CONFIG_ITEMS: ConfigItem[] = [
  {
    key: "ip",
    label: "面板后端地址",
    placeholder: "请输入面板后端 IP:PORT",
    description:
      '格式"ip:port"或"domain:port",用于对接节点时使用。支持套 CDN 和 HTTPS，通讯数据有加密',
    type: "input",
  },
  {
    key: "app_name",
    label: "站点名称",
    placeholder: "请输入站点名称",
    description: "在浏览器标签页和导航栏显示的站点名称",
    type: "input",
  },
  {
    key: "global_download_url",
    label: "自定义全局加速源",
    placeholder: "https://ghfast.top",
    description: "海外机器安装和更新时使用的加速地址，留空使用默认值",
    type: "input",
  },
  {
    key: "domestic_download_url",
    label: "自定义国内镜像源",
    placeholder: "https://chfs.646321.xyz:8/chfs/shared/FLOX",
    description: "国内机器首次对接安装时使用的加速地址，留空使用默认值",
    type: "input",
  },
  {
    key: "app_logo",
    label: "网页角标 Logo",
    description: "用于页面左上角导航角标，上传后会自动转换为 PNG 并持久化保存",
    type: "input",
  },
  {
    key: "app_favicon",
    label: "浏览器缩略图标",
    description: "用于浏览器标签页图标，上传后会自动转换为 PNG 并持久化保存",
    type: "input",
  },
  /* 暂时隐藏精简模式开关
  {
      key: "forward_compact_mode",
      label: "规则页面精简模式",
      description: "开启后，规则页面列表使用 2.1.6-alpha8 样式（全局配置）",
      type: "switch",
    },
  */
  {
    key: "captcha_enabled",
    label: "登录验证码",
    description: "开启后，用户登录时需要完成验证码验证",
    type: "switch",
  },
  {
    key: "register_captcha_enabled",
    label: "注册验证码",
    description: "开启后，用户注册时需要完成验证码验证",
    type: "switch",
  },
  {
    key: "payment_enabled",
    label: "商城系统",
    description:
      "关闭后，将隐藏所有支付、套餐、订单、商城相关菜单项和页面，同时关闭用户注册",
    type: "switch",
  },
  {
    key: "registration_enabled",
    label: "开放注册",
    description: "开启后允许用户自助注册账号",
    type: "switch",
  },
  {
    key: "login_monitor_link",
    label: "探针入口",
    description: "开启后，登录页右上角显示探针入口按钮，点击可查看节点实时状态",
    type: "switch",
  },
  {
    key: "cloudflare_site_key",
    label: "Cloudflare Site Key",
    placeholder: "请输入 Cloudflare Site Key",
    description: "Cloudflare Turnstile 站点密钥",
    type: "input",
    dependsOn: ["captcha_enabled", "register_captcha_enabled"],
    dependsValue: "true",
  },
  {
    key: "cloudflare_secret_key",
    label: "Cloudflare Secret Key",
    placeholder: "请输入 Cloudflare Secret Key",
    description: "Cloudflare Turnstile 密钥",
    type: "input",
    dependsOn: ["captcha_enabled", "register_captcha_enabled"],
    dependsValue: "true",
  },
];
// 初始化时从缓存读取配置，避免闪烁
const getInitialConfigs = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  const configKeys = [
    "app_name",
    "captcha_enabled",
    "register_captcha_enabled",
    "registration_enabled",
    "payment_enabled",
    "cloudflare_site_key",
    "cloudflare_secret_key",
    "forward_compact_mode",
    "ghfast_url",
    "domestic_download_host",
    "ip",
    "panel_domain",
    "app_logo",
    "app_favicon",
  ];
  const initialConfigs: Record<string, string> = {};

  try {
    configKeys.forEach((key) => {
      const cachedValue = localStorage.getItem("vite_config_" + key);

      if (cachedValue) {
        initialConfigs[key] = cachedValue;
      } else if (key === "payment_enabled") {
        // 默认开启商城
        initialConfigs[key] = "true";
      }
    });
  } catch {}

  return initialConfigs;
};

export default function ConfigPage() {
  const navigate = useNavigate();
  const initialConfigs = getInitialConfigs();
  const [configs, setConfigs] =
    useState<Record<string, string>>(initialConfigs);
  const [loading, setLoading] = useState(
    Object.keys(initialConfigs).length === 0,
  );
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalConfigs, setOriginalConfigs] =
    useState<Record<string, string>>(initialConfigs);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const faviconFileInputRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementData>({
    content: "",
    enabled: 0,
  });
  const [announcementLoading, setAnnouncementLoading] = useState(true);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [previewLoadFailed, setPreviewLoadFailed] = useState<
    Partial<Record<BrandPreviewKey, boolean>>
  >({});
  const [brandUploading, setBrandUploading] = useState<
    Partial<Record<BrandPreviewKey, boolean>>
  >({});
  const [exportMode, setExportMode] = useState<"core" | "full">("core");
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseDomain, setLicenseDomain] = useState("");
  const [hmacKey, setHmacKey] = useState("");
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseInfo | null>(null);
  const [transferDomain, setTransferDomain] = useState("");
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);

  // 权限检查
  useEffect(() => {
    if (!isAdmin()) {
      toast.error("权限不足，只有管理员可以访问此页面");
      navigate("/dashboard", { replace: true });

      return;
    }
  }, [navigate]);
  // 加载配置数据（优先从缓存）
  const loadConfigs = async (currentConfigs?: Record<string, string>) => {
    const configsToCompare = currentConfigs || configs;
    const hasInitialData = Object.keys(configsToCompare).length > 0;

    // 如果已有缓存数据，不显示loading，静默更新
    if (!hasInitialData) {
      setLoading(true);
    }
    try {
      const configData = await getCachedConfigs();
      // 只有在数据有变化时才更新
      const hasDataChanged =
        JSON.stringify(configData) !== JSON.stringify(configsToCompare);

      if (hasDataChanged) {
        setConfigs(configData);
        setOriginalConfigs({ ...configData });
        setHasChanges(false);
      } else {
      }
    } catch {
      // 只有在没有缓存数据时才显示错误
      if (!hasInitialData) {
        toast.error("加载配置出错，请重试");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConfigs(initialConfigs);
      loadAnnouncement();
      loadLicenseInfo();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  usePullToRefresh(() => {
    loadConfigs();
    loadAnnouncement();
    loadLicenseInfo();
  });
  const loadLicenseInfo = async () => {
    try {
      const res = await getLicenseInfo();

      if (res.code === 0 && res.data) {
        setLicenseStatus(res.data);
        if (res.data.has_license_key) {
          setLicenseKey(res.data.license_key || "");
          setLicenseDomain(res.data.domain || "");
          setHmacKey(res.data.hmac_key || "");
        }
      } else {
        setLicenseKey("");
        setLicenseDomain("");
      }
    } catch {}
  };
  const handleLicenseSave = async () => {
    if (!licenseDomain.trim()) {
      toast.error("面板域名不能为空");

      return;
    }
    setLicenseSaving(true);
    try {
      const res = await updateLicenseConfig(
        licenseKey.trim(),
        licenseDomain.trim(),
        hmacKey.trim(),
        window.location.hostname,
        window.location.protocol,
      );

      if (res.code === 0) {
        const d = res.data as { valid?: boolean; reason?: string };

        if (d?.valid) {
          toast.success("授权配置验证通过");
          setTimeout(async () => {
            await loadLicenseInfo();
            setTimeout(() => window.location.reload(), 500);
          }, 500);
        } else {
          toast.error("授权验证失败：" + (d?.reason || "未知错误"));
          setLicenseSaving(false);
        }

        return;
      } else {
        toast.error("保存失败：" + res.msg);
      }
    } catch {
      toast.error("保存出错，请重试");
    } finally {
      setLicenseSaving(false);
    }
  };
  const handleTransferLicense = () => {
    if (!transferDomain.trim()) {
      toast.error("请输入新域名");

      return;
    }
    setTransferConfirmOpen(true);
  };
  const confirmTransferLicense = async () => {
    if (!licenseStatus?.has_license_key) {
      toast.error("请先配置授权");

      return;
    }
    setTransferConfirmOpen(false);
    setLicenseSaving(true);
    try {
      const res = await transferLicense(transferDomain.trim());

      if (res.code === 0) {
        toast.success("授权配置已提交，正在后台验证...");

        // 关键修复：保存成功后，延迟重新加载授权信息，获取最新的 license_key
        setTimeout(async () => {
          await loadLicenseInfo();
          // 如果后端更新了授权码，同步更新输入框显示
          if (
            licenseStatus?.license_key &&
            licenseStatus.license_key !== licenseKey.trim()
          ) {
            setLicenseKey(licenseStatus.license_key);
          }
          // 最后刷新页面
          setTimeout(() => window.location.reload(), 800);
        }, 1000);

        return;
      } else {
        toast.error("保存失败：" + res.msg);
      }
    } catch {
      toast.error("转让出错，请重试");
    } finally {
      setLicenseSaving(false);
    }
  };
  const loadAnnouncement = async () => {
    setAnnouncementLoading(true);
    try {
      const res = await getAnnouncement();

      if (res.code === 0 && res.data) {
        setAnnouncement(res.data);
      }
    } catch {
    } finally {
      setAnnouncementLoading(false);
    }
  };
  const saveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      const res = await updateAnnouncement(announcement);

      if (res.code === 0) {
        toast.success("公告保存成功");
      } else {
        toast.error(res.msg || "保存失败");
      }
    } catch {
      toast.error("保存公告失败，请重试");
    } finally {
      setAnnouncementSaving(false);
    }
  };
  const handleConfigChange = (key: string, value: string) => {
    const newConfigs = { ...configs, [key]: value };

    setConfigs(newConfigs);
    if (isBrandPreviewKey(key)) {
      setPreviewLoadFailed((prev) => ({ ...prev, [key]: false }));
    }
    const hasChangesNow =
      Object.keys(newConfigs).some(
        (k) => newConfigs[k] !== originalConfigs[k],
      ) ||
      Object.keys(originalConfigs).some(
        (k) => originalConfigs[k] !== newConfigs[k],
      );

    setHasChanges(hasChangesNow);
  };
  // 快捷开关直接生效（不经过保存按钮）
  const handleDirectSwitchChange = async (key: string, checked: boolean) => {
    const newValue = checked ? "true" : "false";

    const payload: Record<string, string> = { [key]: newValue };

    // 关闭商城系统时联动关闭注册
    if (key === "payment_enabled" && newValue === "false") {
      payload.registration_enabled = "false";
    }

    // 立即更新本地状态
    const newConfigs = { ...configs, ...payload };

    setConfigs(newConfigs);
    setOriginalConfigs((prev) => ({ ...prev, ...payload }));
    setHasChanges(false);

    try {
      const res = await updateConfigs(payload);

      if (res.code !== 0) {
        toast.error(res.msg || "保存失败");
        setConfigs(configs);

        return;
      }
      Object.entries(payload).forEach(([k, v]) => {
        configCache.set(k, v);
        localStorage.setItem("vite_config_" + k, v);
      });
      updateSiteConfig(payload);
      window.dispatchEvent(
        new CustomEvent("configUpdated", {
          detail: { changedKeys: Object.keys(payload) },
        }),
      );
      if (key === "payment_enabled") {
        window.dispatchEvent(
          new CustomEvent("paymentEnabledChanged", {
            detail: { enabled: newValue !== "false" },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("storeEnabledChanged", {
            detail: { enabled: newValue !== "false" },
          }),
        );
        setStoreStatus({ enabled: newValue !== "false" }).catch(() => {});
      }
      toast.success("设置已更新");
    } catch {
      toast.error("保存失败");
      // 回滚
      setConfigs(configs);
    }
  };
  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      const changedKeys = Object.keys(configs).filter(
        (key) => configs[key] !== originalConfigs[key],
      );

      if (changedKeys.length === 0) {
        setHasChanges(false);

        return;
      }
      const changedPayload: Record<string, string> = {};

      changedKeys.forEach((key) => {
        changedPayload[key] = configs[key] || "";
      });
      // 验证码开启时必须填写 Site Key 和 Secret Key
      if (
        (configs.captcha_enabled === "true" ||
          configs.register_captcha_enabled === "true") &&
        (!configs.cloudflare_site_key || !configs.cloudflare_secret_key)
      ) {
        toast.error("开启验证码时必须填写 Cloudflare Site Key 和 Secret Key");
        setSaving(false);

        return;
      }
      // 商城关闭时联动关闭注册
      if (
        changedKeys.includes("payment_enabled") &&
        configs.payment_enabled === "false"
      ) {
        changedPayload.registration_enabled = "false";
        configs.registration_enabled = "false";
      }
      const response = await updateConfigs(changedPayload);

      if (response.code === 0) {
        toast.success("配置保存成功");
        Object.entries(configs).forEach(([key, value]) => {
          configCache.set(key, value);
        });
        setOriginalConfigs({ ...configs });
        setHasChanges(false);
        if (
          changedKeys.some((key) =>
            ["app_name", "app_logo", "app_favicon"].includes(key),
          )
        ) {
          await updateSiteConfig(configs);
          setTimeout(() => {
            window.location.reload();
          }, 800);

          return;
        }
        // 触发配置更新事件，通知其他组件
        window.dispatchEvent(
          new CustomEvent("configUpdated", {
            detail: { changedKeys },
          }),
        );
        if (changedKeys.includes("payment_enabled")) {
          try {
            localStorage.setItem(
              "vite_config_payment_enabled",
              configs.payment_enabled || "",
            );
          } catch {}
          window.dispatchEvent(
            new CustomEvent("paymentEnabledChanged", {
              detail: { enabled: configs.payment_enabled !== "false" },
            }),
          );
          // 同步后端 store_enabled
          setStoreStatus({
            enabled: configs.payment_enabled !== "false",
          }).catch(() => {});
        }
      } else {
        toast.error("保存配置失败: " + response.msg);
      }
    } catch {
      toast.error("保存配置出错，请重试");
    } finally {
      setSaving(false);
    }
  };
  // 检查配置项是否应该显示（依赖检查）
  const shouldShowItem = (item: ConfigItem): boolean => {
    if (!item.dependsOn || !item.dependsValue) {
      return true;
    }

    const keys = Array.isArray(item.dependsOn)
      ? item.dependsOn
      : [item.dependsOn];

    return keys.some((k) => configs[k] === item.dependsValue);
  };
  const getBrandInputRef = (key: BrandPreviewKey) => {
    return key === "app_logo" ? logoFileInputRef : faviconFileInputRef;
  };
  const triggerBrandFilePicker = (key: BrandPreviewKey) => {
    if (brandUploading[key]) {
      return;
    }
    getBrandInputRef(key).current?.click();
  };
  const clearBrandAsset = (key: BrandPreviewKey) => {
    handleConfigChange(key, "");
    setPreviewLoadFailed((prev) => ({ ...prev, [key]: false }));
  };
  const handleBrandFileChange = async (
    key: BrandPreviewKey,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }
    setBrandUploading((prev) => ({ ...prev, [key]: true }));
    try {
      const pngDataURL = await convertBrandAssetToPngDataURL(
        file,
        toBrandAssetKind(key),
      );

      handleConfigChange(key, pngDataURL);
      toast.success(key === "app_logo" ? "Logo 上传成功" : "Favicon 上传成功");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "图片处理失败，请重试";

      toast.error(message);
    } finally {
      setBrandUploading((prev) => ({ ...prev, [key]: false }));
      event.target.value = "";
    }
  };
  const renderBrandPreview = (key: BrandPreviewKey) => {
    const previewUrl = (configs[key] || "").trim();
    const appNamePreview = (configs.app_name || "").trim() || "应用名称";
    const failed = previewLoadFailed[key] === true;
    const showImage = previewUrl.length > 0 && !failed;

    return (
      <div className="mt-3 rounded-lg border border-default-200 dark:border-default-100/30 bg-default-50/60 dark:bg-default-100/10 p-3">
        <p className="text-xs text-default-500">实时预览</p>
        <div className="mt-2 rounded-md border border-default-200 dark:border-default-100/30 bg-white dark:bg-black px-3 py-2">
          {key === "app_logo" ? (
            <div className="flex h-10 items-center gap-2">
              {showImage ? (
                <img
                  alt="logo preview"
                  className="h-7 w-7 rounded-sm border border-default-200 object-cover dark:border-default-100/30"
                  src={previewUrl}
                  onError={() =>
                    setPreviewLoadFailed((prev) => ({ ...prev, [key]: true }))
                  }
                  onLoad={() =>
                    setPreviewLoadFailed((prev) => ({ ...prev, [key]: false }))
                  }
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-default-200 text-[10px] font-semibold text-default-600 dark:bg-default-700 dark:text-default-200">
                  LOGO
                </div>
              )}
              <span className="truncate text-sm font-semibold text-foreground">
                {appNamePreview}
              </span>
            </div>
          ) : (
            <div className="flex h-7 max-w-[260px] items-center gap-2 rounded border border-default-200 bg-default-100/70 px-2 dark:border-default-100/30 dark:bg-default-100/20">
              {showImage ? (
                <img
                  alt="favicon preview"
                  className="h-4 w-4 rounded-sm object-contain"
                  src={previewUrl}
                  onError={() =>
                    setPreviewLoadFailed((prev) => ({ ...prev, [key]: true }))
                  }
                  onLoad={() =>
                    setPreviewLoadFailed((prev) => ({ ...prev, [key]: false }))
                  }
                />
              ) : (
                <div className="h-4 w-4 rounded-sm bg-default-300 dark:bg-default-600" />
              )}
              <span className="truncate text-xs text-default-700 dark:text-default-300">
                {appNamePreview}
              </span>
            </div>
          )}
        </div>
        {previewUrl.length === 0 ? (
          <p className="mt-2 text-xs text-default-500">
            上传图片后会实时显示预览
          </p>
        ) : null}
        {previewUrl.length > 0 && failed ? (
          <p className="mt-2 text-xs text-danger">图片加载失败，请重新上传</p>
        ) : null}
        {previewUrl.length > 0 && !isPngDataURL(previewUrl) ? (
          <p className="mt-2 text-xs text-warning-600 dark:text-warning-400">
            当前是旧版 URL 配置，建议重新上传图片以启用无闪烁加载
          </p>
        ) : null}
      </div>
    );
  };
  const renderBrandAssetUploader = (
    key: BrandPreviewKey,
    isChanged: boolean,
  ) => {
    const value = (configs[key] || "").trim();
    const uploading = brandUploading[key] === true;
    const isLogo = key === "app_logo";

    return (
      <div
        className={`rounded-lg border p-3 ${
          isChanged
            ? "border-warning-300"
            : "border-default-200 dark:border-default-100/30"
        }`}
      >
        <input
          ref={getBrandInputRef(key)}
          accept={BRAND_FILE_ACCEPT}
          className="hidden"
          type="file"
          onChange={(event) => {
            void handleBrandFileChange(key, event);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            color="primary"
            isLoading={uploading}
            size="sm"
            variant="flat"
            onPress={() => triggerBrandFilePicker(key)}
          >
            {value.length > 0
              ? isLogo
                ? "替换 Logo"
                : "替换 Favicon"
              : isLogo
                ? "上传 Logo"
                : "上传 Favicon"}
          </Button>
          <Button
            isDisabled={value.length === 0 || uploading}
            size="sm"
            variant="flat"
            onPress={() => clearBrandAsset(key)}
          >
            清除
          </Button>
          <span className="text-xs text-default-500">
            仅支持图片文件，自动转换为 PNG
          </span>
        </div>
        <p className="mt-2 text-xs text-default-500">
          {isLogo
            ? "建议上传方形图片，系统会统一转换为 96x96 PNG"
            : "建议上传方形图片，系统会统一转换为 64x64 PNG"}
        </p>
        {renderBrandPreview(key)}
      </div>
    );
  };
  // 渲染不同类型的配置项
  const renderConfigItem = (item: ConfigItem) => {
    const isChanged =
      hasChanges && configs[item.key] !== originalConfigs[item.key];

    switch (item.type) {
      case "input":
        if (isBrandPreviewKey(item.key)) {
          return renderBrandAssetUploader(item.key, isChanged);
        }
        if (item.key === "github_proxy_urls") {
          const rawValue = configs[item.key] || "";
          let displayValue = "";

          try {
            const urls = JSON.parse(rawValue);

            if (Array.isArray(urls)) {
              displayValue = urls.join("\n");
            } else {
              displayValue = rawValue;
            }
          } catch {
            displayValue = rawValue;
          }

          return (
            <Textarea
              classNames={{
                inputWrapper: isChanged
                  ? "border-warning-300 data-[hover=true]:border-warning-400"
                  : "",
                input: "font-mono text-sm",
              }}
              minRows={3}
              placeholder={"https://gcode.hostcentral.cc\nhttps://ghfast.top"}
              size="md"
              value={displayValue}
              variant="bordered"
              onChange={(e) => {
                const lines = e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0);

                handleConfigChange(item.key, JSON.stringify(lines));
              }}
            />
          );
        }

        return (
          <Input
            classNames={{
              input: "text-sm",
              inputWrapper: isChanged
                ? "border-warning-300 data-[hover=true]:border-warning-400"
                : "",
            }}
            placeholder={item.placeholder}
            size="md"
            value={configs[item.key] || ""}
            variant="bordered"
            onChange={(e) => handleConfigChange(item.key, e.target.value)}
          />
        );
      case "switch":
        if (item.key === "payment_enabled") {
          return (
            <Switch
              classNames={{
                wrapper: isChanged ? "border-warning-300" : "",
              }}
              color="primary"
              isSelected={configs[item.key] === "true"}
              size="md"
              onValueChange={(checked) =>
                handleConfigChange(item.key, checked ? "true" : "false")
              }
            >
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {configs[item.key] === "true" ? "已开启" : "已关闭"}
              </span>
            </Switch>
          );
        }

        return (
          <Switch
            classNames={{
              wrapper: isChanged ? "border-warning-300" : "",
            }}
            color="primary"
            isSelected={configs[item.key] === "true"}
            size="md"
            onValueChange={(checked) =>
              handleConfigChange(item.key, checked ? "true" : "false")
            }
          >
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {configs[item.key] === "true" ? "已启用" : "已禁用"}
            </span>
          </Switch>
        );
      case "select":
        return (
          <Select
            classNames={{
              trigger: isChanged
                ? "border-warning-300 data-[hover=true]:border-warning-400"
                : "",
            }}
            placeholder="请选择验证码类型"
            selectedKeys={configs[item.key] ? [configs[item.key]] : []}
            size="md"
            variant="bordered"
            onSelectionChange={(keys) => {
              const selectedKey = Array.from(keys)[0] as string;

              if (selectedKey) {
                handleConfigChange(item.key, selectedKey);
              }
            }}
          >
            {item.options?.map((option) => (
              <SelectItem key={option.value} description={option.description}>
                {option.label}
              </SelectItem>
            )) || []}
          </Select>
        );
      default:
        return null;
    }
  };
  const handleExportAll = async () => {
    setExporting(true);
    try {
      await exportBackup([], exportMode);
      toast.success("导出成功");
    } catch {
      toast.error("导出失败，请重试");
    } finally {
      setExporting(false);
    }
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;
    setImportFileName(file.name);
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const response = await importBackup(data);

      if (response.code === 0) {
        toast.success(`导入成功：${JSON.stringify(response.data)}`);
        setImportFileName("");
      } else {
        toast.error("导入失败：" + response.msg);
      }
    } catch {
      toast.error("导入失败，请检查文件格式");
    } finally {
      setImporting(false);
      if (backupFileInputRef.current) {
        backupFileInputRef.current.value = "";
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner label="加载配置中..." size="lg" />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 max-w-7xl mx-auto p-6">
      {/* 左栏：基本设置 */}
      <div>
        <Card className="shadow-md dark:bg-content1">
          <CardHeader className="pb-6">
            <div className="flex items-center w-full">
              <div>
                <h2 className="text-xl font-semibold">基本设置</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  配置网站的基本信息，这些设置会影响网站的显示效果
                </p>
              </div>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-6 pt-8 md:pt-8">
            {CONFIG_ITEMS.map((item, index) => {
              // 检查配置项是否应该显示
              if (!shouldShowItem(item)) {
                return null;
              }
              // 快捷开关独立展示，不在基本设置中重复渲染
              if (STANDALONE_SWITCH_KEYS.includes(item.key)) {
                return null;
              }
              // 计算是否是最后一个显示的项目（用于决定是否显示分隔线）
              const remainingItems = CONFIG_ITEMS.slice(index + 1).filter(
                (i) =>
                  shouldShowItem(i) && !STANDALONE_SWITCH_KEYS.includes(i.key),
              );
              const isLastItem = remainingItems.length === 0;

              return (
                <div key={item.key}>
                  {/* 🎯 如果是开关(switch)，使用 justify-between 左右排列；如果是其他，使用 space-y-3 上下排列 */}
                  <div
                    className={
                      item.type === "switch"
                        ? "flex justify-between items-center gap-4"
                        : "space-y-3"
                    }
                  >
                    {/* 左侧：标题和描述 */}
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {item.label}
                      </label>
                      {item.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {/* 右侧/下方：配置组件 */}
                    {/* flex-shrink-0 防止开关被长文本挤变形 */}
                    <div
                      className={item.type === "switch" ? "flex-shrink-0" : ""}
                    >
                      {renderConfigItem(item)}
                    </div>
                  </div>
                  {/* 分隔线 */}
                  {!isLastItem && <Divider className="mt-6" />}
                </div>
              );
            })}

            {/* 👇 完美靠齐卡片右侧的悬浮保存按钮 */}
            <AnimatePresence>
              {hasChanges && (
                <motion.div
                  animate={{ y: 0, opacity: 1 }}
                  className="sticky fixed bottom-8 z-50 pointer-events-none flex justify-end mt-6"
                  exit={{ y: 100, opacity: 0 }}
                  initial={{ y: 100, opacity: 0 }}
                  transition={{ type: "spring", damping: 20, stiffness: 300 }}
                >
                  {/* 内部容器添加 pointer-events-auto */}
                  <div className="pointer-events-auto flex items-center gap-3 bg-white dark:bg-default-900 rounded-full shadow-2xl border border-default-200 dark:border-default-700 px-5 py-3">
                    {/* 提示图标 */}
                    <div className="flex items-center gap-2 text-warning-600 dark:text-warning-400">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      </svg>
                      <span className="text-sm font-medium whitespace-nowrap">
                        配置已变更
                      </span>
                    </div>
                    {/* 分隔线 */}
                    <div className="w-px h-5 bg-default-200 dark:bg-default-700" />
                    {/* 保存按钮 */}
                    <Button
                      className="rounded-full font-medium text-white min-w-[100px]"
                      color="primary"
                      isLoading={saving}
                      size="sm"
                      startContent={
                        !saving && (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="M5 13l4 4L19 7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                            />
                          </svg>
                        )
                      }
                      onPress={handleSave}
                    >
                      {saving ? "保存中" : "保存"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardBody>
        </Card>

        {/* 快捷开关：即开即生效，不经过保存按钮 */}
        <Card className="shadow-md dark:bg-content1 mt-6">
          <CardHeader className="pb-4">
            <div>
              <h2 className="text-lg font-semibold">快捷开关</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                开关即生效，无需点击保存
              </p>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="py-3">
            <div className="flex flex-col gap-1">
              {CONFIG_ITEMS.filter(
                (item) =>
                  STANDALONE_SWITCH_KEYS.includes(item.key) &&
                  shouldShowItem(item),
              ).map((item) => (
                <div
                  key={item.key}
                  className="flex justify-between items-center py-1"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {item.label}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {item.description}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
                    <Switch
                      color="primary"
                      isDisabled={
                        item.key === "payment_enabled" &&
                        licenseStatus?.tier === "free"
                      }
                      isSelected={
                        item.key === "payment_enabled" &&
                        licenseStatus?.tier === "free"
                          ? false
                          : configs[item.key] === "true"
                      }
                      size="sm"
                      onValueChange={(checked) =>
                        handleDirectSwitchChange(item.key, checked)
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 右栏：公告管理、导出数据、授权码配置 */}
      <div className="space-y-6">
        <Card className="shadow-md dark:bg-content1">
          <CardHeader className="pb-6">
            <div className="flex justify-between items-center w-full gap-4">
              <div>
                <h2 className="text-xl font-semibold">公告管理</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  设置首页显示的公告内容，启用后将在首页顶部展示
                </p>
              </div>
              {!announcementLoading && (
                <Switch
                  color="primary"
                  isSelected={announcement.enabled === 1}
                  size="md"
                  onValueChange={(checked) =>
                    setAnnouncement({
                      ...announcement,
                      enabled: checked ? 1 : 0,
                    })
                  }
                >
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {announcement.enabled === 1 ? "已启用" : "未启用"}
                  </span>
                </Switch>
              )}
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-4 pt-6 md:pt-6">
            {announcementLoading ? (
              <div className="flex justify-center py-8">
                <Spinner size="lg" />
              </div>
            ) : (
              <>
                {/* 👇 下面变得非常清爽，只剩下输入框和保存按钮 */}
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  公告内容
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">
                    公告支持 Markdown 语法，链接会在新标签页打开
                  </span>
                </p>
                <Textarea
                  label=""
                  minRows={4}
                  placeholder="支持 Markdown，例如：**加粗**、[链接](https://example.com)、- 列表"
                  value={announcement.content}
                  variant="bordered"
                  onChange={(e) =>
                    setAnnouncement({
                      ...announcement,
                      content: e.target.value,
                    })
                  }
                />
                <div className="flex justify-end mt-2 pt-4 border-t border-divider/50">
                  <Button
                    color="primary"
                    isLoading={announcementSaving}
                    onPress={saveAnnouncement}
                  >
                    保存公告
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
        {/* 主题设置
      <div className="mt-6 shadow-md">
        <ThemeSettings />
      </div> */}
        {/* 导出全部数据 */}
        <Card className="mt-6 shadow-md dark:bg-content1">
          <CardHeader className="pb-6">
            <div className="flex justify-between items-center w-full">
              <div>
                <h2 className="text-xl font-semibold">数据备份</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  导出系统所有数据为jaon格式文件，优先使用脚本备份数据
                </p>
              </div>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-6 pt-8 md:pt-8">
            {/* 导出部分 */}
            <div className="flex flex-col gap-4">
              {/* 第一行：标题 和 导出按钮 */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  导出数据
                </h3>
                <Button
                  color="primary"
                  isLoading={exporting}
                  onPress={handleExportAll}
                >
                  {exporting ? "导出中..." : "一键导出"}
                </Button>
              </div>

              {/* 第二行及以下：下拉框 和 提示文字 */}
              <div className="flex flex-col gap-1.5">
                <Select
                  classNames={{ trigger: "min-w-[150px]" }}
                  label="选择导出范围，一键导出为json格式文件"
                  selectedKeys={[exportMode]}
                  size="sm"
                  variant="bordered"
                  onSelectionChange={(keys) => {
                    const key = Array.from(keys)[0] as string;

                    if (key === "core" || key === "full") {
                      setExportMode(key);
                    }
                  }}
                >
                  <SelectItem key="core">快速导出（核心数据）</SelectItem>
                  <SelectItem key="full">完整导出（所有数据）</SelectItem>
                </Select>
                <span className="text-xs text-gray-500 ml-1">
                  {exportMode === "core"
                    ? "仅用户/节点/隧道/规则等数据，不包含日志和统计，文件较小，适合快速备份"
                    : "包含所有表和配置项，文件更大，适合完全备份"}
                </span>
              </div>
            </div>
            <Divider />
            {/* 导入部分 */}
            <div className="flex flex-col gap-4">
              {/* 第一行：大标题 和 导入按钮 */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  导入数据
                </h3>
                <Button
                  color="primary"
                  isLoading={importing}
                  onPress={() => backupFileInputRef.current?.click()}
                >
                  {importing ? "导入中..." : "一键导入"}
                </Button>
              </div>

              {/* 第二行及以下：提示文字 和 选中文件状态 */}
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  从json备份文件恢复数据
                </p>
                {importFileName && (
                  <p className="text-xs text-primary">
                    已选择：{importFileName}
                  </p>
                )}
              </div>

              {/* 隐藏的 input，保持不变 */}
              <input
                ref={backupFileInputRef}
                accept=".json"
                className="hidden"
                type="file"
                onChange={handleFileChange}
              />
            </div>
          </CardBody>
        </Card>

        {/* 授权配置 */}
        <Card className="shadow-md dark:bg-content1">
          <CardHeader className="pb-6">
            <div className="flex justify-between items-center w-full gap-4">
              <div>
                <h2 className="text-xl font-semibold">授权配置</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  输入域名和授权码激活授权服务，授权码留空自动生成7天体验授权
                </p>
                <p className="text-sm mt-1">
                  <a
                    className="text-primary hover:underline"
                    href="https://sq.abai.eu.org/renew"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    授权码购买/续费
                  </a>
                </p>
              </div>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-6 pt-8 md:pt-8">
            <div className="space-y-5">
              <div className="space-y-3">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  面板域名
                </label>
                <Input
                  classNames={{ input: "text-sm" }}
                  placeholder="自己的面板域名"
                  size="md"
                  value={licenseDomain}
                  variant="bordered"
                  onChange={(e) => setLicenseDomain(e.target.value)}
                />
              </div>
              <div className="space-y-3">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  授权码
                </label>
                <Input
                  classNames={{ input: "text-sm" }}
                  placeholder="留空自动生成7天体验授权"
                  size="md"
                  value={licenseKey}
                  variant="bordered"
                  onChange={(e) => setLicenseKey(e.target.value)}
                />
              </div>
              <div className="space-y-3">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Flox密钥
                </label>
                <Input
                  classNames={{ input: "text-sm" }}
                  placeholder="联系管理员获取（flox_ 开头）"
                  size="md"
                  value={hmacKey}
                  variant="bordered"
                  onChange={(e) => setHmacKey(e.target.value)}
                />
                <p className="text-xs text-gray-400">
                  必填，请联系管理员获取 Flox 密钥
                </p>
              </div>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-divider/50">
              <div className="flex items-center gap-2">
                {licenseStatus && (
                  <span
                    className={`text-xs font-medium ${licenseStatus.tier === "premium" ? "text-green-600" : licenseStatus.tier === "blocked" ? "text-red-600" : "text-yellow-600"}`}
                  >
                    {licenseStatus.is_trial && licenseStatus.valid
                      ? `体验版，剩余 ${licenseStatus.trial_remaining_days} 天`
                      : licenseStatus.tier === "premium"
                        ? `商业版，授权剩余 ${licenseStatus.expire_time ? Math.floor((licenseStatus.expire_time - Date.now()) / 86400000) : "？"} 天`
                        : licenseStatus.tier === "blocked"
                          ? `授权已阻断：${licenseStatus.reason || "未知原因"}`
                          : "免费版（5 节点 / 5 隧道 / 1 用户，禁用商城系统/TG机器人）"}
                  </span>
                )}
              </div>
              <Button
                color="primary"
                isLoading={licenseSaving}
                size="sm"
                onPress={handleLicenseSave}
              >
                {licenseSaving ? "保存中" : "保存验证"}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* 授权转让 */}
        {licenseStatus?.valid &&
          licenseStatus?.has_license_key &&
          !licenseStatus?.is_trial && (
            <Card className="shadow-md dark:bg-content1">
              <CardHeader className="pb-6">
                <div className="flex justify-between items-center w-full gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">授权转让</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      转让授权到新域名，旧域名将立即失效
                    </p>
                  </div>
                </div>
              </CardHeader>
              <Divider />
              <CardBody className="space-y-6 pt-8 md:pt-8">
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    新域名
                  </label>
                  <Input
                    classNames={{ input: "text-sm" }}
                    placeholder="请输入转让后的新面板域名"
                    size="md"
                    value={transferDomain}
                    variant="bordered"
                    onChange={(e) => setTransferDomain(e.target.value)}
                  />
                  <p className="text-xs text-gray-400">
                    转让后旧域名授权立即失效，每 3 天可转让一次
                  </p>
                </div>
                <div className="text-gray-400 flex justify-end pt-4 border-t border-divider/50">
                  <Button
                    color="primary"
                    isLoading={licenseSaving}
                    size="sm"
                    onPress={handleTransferLicense}
                  >
                    开始转让
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        <Modal
          isOpen={transferConfirmOpen}
          onClose={() => setTransferConfirmOpen(false)}
        >
          <ModalContent>
            <ModalHeader>确认转让授权</ModalHeader>
            <ModalBody>
              <p className="text-sm">
                确认要转让授权到{" "}
                <span className="font-semibold text-primary">
                  {transferDomain}
                </span>{" "}
                吗？
              </p>
              <p className="text-xs text-danger mt-2">
                转让后旧域名授权将立即失效，请认真核对域名
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                color="default"
                onPress={() => setTransferConfirmOpen(false)}
              >
                取消
              </Button>
              <Button
                color="primary"
                isLoading={licenseSaving}
                onPress={confirmTransferLicense}
              >
                确认
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
