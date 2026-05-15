import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-hot-toast";

import { Button } from "@/shadcn-bridge/heroui/button";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/shadcn-bridge/heroui/dropdown";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@/shadcn-bridge/heroui/modal";
import { Input } from "@/shadcn-bridge/heroui/input";
import { BrandLogo } from "@/components/brand-logo";
import { VersionFooter } from "@/components/version-footer";
import { getLicenseInfo, updatePassword } from "@/api";
import { safeLogout } from "@/utils/logout";
import { siteConfig } from "@/config/site";
import { getAdminFlag, getSessionName } from "@/utils/session";
import { useScrollTopOnPathChange } from "@/hooks/useScrollTopOnPathChange";

interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  target?: string;
}

interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function H5Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState("");
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<null | {
    valid: boolean;
    configured: boolean;
    has_license_key: boolean;
    reason?: string;
    expire_time?: number;
  }>(null);

  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    newUsername: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useScrollTopOnPathChange();

  // 完全对齐桌面端的 10 个菜单项
  const menuItems: MenuItem[] = [
    {
      path: "/dashboard",
      label: "仪表",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
        </svg>
      ),
    },
    {
      path: "/forward",
      label: "规则",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
    {
      path: "/tunnel",
      label: "隧道",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
    {
      path: "/node",
      label: "节点",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
    {
      path: "/monitor",
      label: "监控",
      adminOnly: false,
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M13 10V3L4 14h7v7l9-11h-7z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      ),
    },
    {
      path: "/limit",
      label: "限速",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
    {
      path: "/user",
      label: "用户",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
    },
    {
      path: "/group",
      label: "分组",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a3 3 0 100 6 3 3 0 000-6zM4 9a3 3 0 100 6 3 3 0 000-6zm12 0a3 3 0 100 6 3 3 0 000-6M4 16a2 2 0 00-2 2h4a2 2 0 00-2-2zm12 0a2 2 0 00-2 2h4a2 2 0 00-2-2zm-6 0a2 2 0 00-2 2h4a2 2 0 00-2-2z" />
        </svg>
      ),
    },
    //    {
    //      path: "/panel-sharing",
    //     label: "共享",
    //      adminOnly: true,
    //      icon: (
    //        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    //          <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
    //        </svg>
    //      ),
    //    },
    {
      path: "/config",
      label: "设置",
      adminOnly: true,
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            clipRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            fillRule="evenodd"
          />
        </svg>
      ),
    },
  ];

  useEffect(() => {
    setIsAdmin(getAdminFlag());
    setUsername(getSessionName() || "Admin");

    const fetchLicense = () => {
      getLicenseInfo().then((res) => {
        if (res.code === 0) {
          setLicenseInfo(res.data);
        }
      });
    };

    fetchLicense();
    const licenseInterval = setInterval(fetchLicense, 5 * 60 * 1000);

    return () => {
      clearInterval(licenseInterval);
    };
  }, []);

  const toggleMobileMenu = () => setMobileMenuVisible(!mobileMenuVisible);
  const hideMobileMenu = () => setMobileMenuVisible(false);

  const handleMenuClick = (item: MenuItem) => {
    if (item.target === "_blank") {
      window.open(item.path, "_blank");
    } else {
      navigate(item.path);
      hideMobileMenu();
    }
  };

  const handleLogout = () => {
    safeLogout();
    navigate("/");
  };

  const validatePasswordForm = (): boolean => {
    if (!passwordForm.newUsername.trim()) {
      toast.error("请输入新用户名");

      return false;
    }
    if (passwordForm.newUsername.length < 3) {
      toast.error("用户名长度至少3位");

      return false;
    }
    if (!passwordForm.currentPassword) {
      toast.error("请输入当前密码");

      return false;
    }
    if (!passwordForm.newPassword) {
      toast.error("请输入新密码");

      return false;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error("新密码长度不能少于6位");

      return false;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("两次输入密码不一致");

      return false;
    }

    return true;
  };

  const handlePasswordSubmit = async () => {
    if (!validatePasswordForm()) return;
    setPasswordLoading(true);
    try {
      const response = await updatePassword(passwordForm);

      if (response.code === 0) {
        toast.success("密码修改成功，请重新登录");
        onOpenChange();
        handleLogout();
      } else {
        toast.error(response.msg || "密码修改失败");
      }
    } catch {
      toast.error("修改密码时发生错误");
    } finally {
      setPasswordLoading(false);
    }
  };

  const resetPasswordForm = () => {
    setPasswordForm({
      newUsername: "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  };

  const filteredMenuItems = menuItems.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  return (
    <div className="flex flex-col min-h-screen bg-gray-100 dark:bg-black overflow-x-hidden">
      {/* 顶部导航栏 */}
      <header className="fixed top-0 left-0 w-full bg-white dark:bg-black shadow-sm border-b border-gray-200 dark:border-gray-600 h-14 safe-top flex-shrink-0 flex items-center justify-between px-3 sm:px-4 z-40">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            className="p-1.5 -ml-1.5 text-gray-600 dark:text-gray-300 hover:text-foreground rounded-md active:bg-gray-200 dark:active:bg-gray-800 transition-colors"
            onClick={toggleMobileMenu}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 6h16M4 12h16M4 18h16"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <BrandLogo size={20} />
            <a
              className={`text-sm font-bold truncate max-w-[90px] sm:max-w-none transition-colors cursor-pointer no-underline ${
                licenseInfo?.has_license_key
                  ? "text-foreground hover:text-primary-600 dark:hover:text-primary-300"
                  : "text-foreground hover:text-primary-600 dark:hover:text-primary-300"
              }`}
              href={licenseInfo?.has_license_key ? "/dashboard" : siteConfig.github_repo}
              rel={licenseInfo?.has_license_key ? undefined : "noopener noreferrer"}
              target={licenseInfo?.has_license_key ? undefined : "_blank"}
              title={licenseInfo?.has_license_key ? "返回首页" : "访问 GitHub 仓库"}
            >
              {siteConfig.name}
            </a>
          </div>
        </div>

        {/* 授权信息居左显示 */}
        <div className="flex-1 flex justify-start items-center h-full mx-2 overflow-hidden">
          {licenseInfo && !licenseInfo.has_license_key ? (
            <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 truncate">
              <span className="truncate">体验模式!授权请联系作者</span>
              <a href="https://t.me/erflvx" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 flex-shrink-0 underline whitespace-nowrap">
                TG群组
              </a>
            </div>
          ) : licenseInfo && licenseInfo.configured && (
            <div className="flex items-center justify-start h-full overflow-hidden whitespace-nowrap">
              {licenseInfo.valid ? (
                (() => {
                  const daysLeft = licenseInfo.expire_time
                    ? Math.max(
                      0,
                      Math.floor(
                        (licenseInfo.expire_time - Date.now()) /
                        (1000 * 60 * 60 * 24),
                      ),
                    )
                    : 0;
                  const isExpiringSoon = daysLeft < 5;
                  const textColorClass = isExpiringSoon
                    ? "text-red-500 font-bold dark:text-red-400"
                    : "text-green-600 dark:text-green-400";

                  return (
                    <span className={`${textColorClass} text-xs truncate`}>
                      授权剩余 {daysLeft} 天
                      {isExpiringSoon ? " (即将过期)" : ""}
                    </span>
                  );
                })()
              ) : (
                <span className="text-red-600 dark:text-red-400 text-xs font-bold truncate">
                  {licenseInfo.reason || "授权无效"}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 顶部右侧 - 用户名下拉菜单 */}
        <div className="flex items-center">
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button
                className="text-sm font-medium text-foreground px-1 sm:px-2 min-w-0 bg-transparent"
                variant="light"
              >
                <span className="truncate max-w-[70px] sm:max-w-[120px]">
                  {username}
                </span>
                <svg
                  className="w-4 h-4 ml-0.5 sm:ml-1 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    clipRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    fillRule="evenodd"
                  />
                </svg>
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label="用户菜单">
              <DropdownItem
                key="change-password"
                startContent={
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z"
                      fillRule="evenodd"
                    />
                  </svg>
                }
                onPress={onOpen}
              >
                修改密码
              </DropdownItem>
              <DropdownItem
                key="logout"
                className="text-danger"
                color="danger"
                startContent={
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      clipRule="evenodd"
                      d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
                      fillRule="evenodd"
                    />
                  </svg>
                }
                onPress={handleLogout}
              >
                退出登录
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </header>

      {/* 侧边栏遮罩 */}
      {mobileMenuVisible && (
        <button
          aria-label="关闭菜单"
          className="fixed inset-0 bg-white/50 dark:bg-black/30 z-40 w-full h-full border-0 p-0 m-0 cursor-default"
          type="button"
          onClick={hideMobileMenu}
        />
      )}

      {/* 侧边滑动 Drawer */}
      <aside
        className={`fixed ${!mobileMenuVisible ? "-translate-x-full" : "translate-x-0"} w-[36%] min-w-[140px] bg-white dark:bg-black shadow-2xl border-r border-gray-200 dark:border-gray-600 z-50 transition-transform duration-300 ease-in-out flex flex-col h-[100dvh] top-0 left-0`}
      >
        <div className="px-5 h-14 flex items-center overflow-hidden whitespace-nowrap box-border border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex-shrink-0 flex items-center justify-center w-10">
            <BrandLogo size={28} />
          </div>
          {/* 👇 侧边栏logo的文字 👇 */}
          {/* <div className="max-w-[180px] opacity-100 ml-2">
            <h1 className="text-sm font-bold text-foreground overflow-hidden whitespace-nowrap text-ellipsis">
              {siteConfig.name}
            </h1>
          </div> */}
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <ul className="space-y-1">
            {filteredMenuItems.map((item) => {
              const isActive = location.pathname === item.path;

              return (
                <li key={item.path}>
                  <button
                    className={`w-full flex items-center p-3 rounded-lg text-left relative min-h-[44px] overflow-hidden transition-colors ${isActive ? "text-primary-600 dark:text-primary-300 bg-primary-100 dark:bg-primary-600/20" : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900"}`}
                    onClick={() => handleMenuClick(item)}
                  >
                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center relative z-10">
                      {item.icon}
                    </div>
                    <div className="flex items-center opacity-100 ml-3">
                      <span className="font-medium text-sm relative z-10 whitespace-nowrap">
                        {item.label}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 底部版权信息 */}
        <div className="px-5 py-4 mt-auto flex-shrink-0 flex items-center overflow-hidden whitespace-nowrap box-border">
          <VersionFooter
            showUpdateInfo={isAdmin}
            poweredClassName="text-xs text-gray-400 dark:text-gray-500"
            updateBadgeClassName="inline-flex items-center h-[16px] px-1.5 rounded-xs bg-rose-500/90 text-[8px] font-semibold text-white"
            version={siteConfig.version}
            versionClassName="text-xs text-gray-400 dark:text-gray-500"
          />
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="flex-1 bg-gray-100 dark:bg-black relative pb-8 pt-14">
        {children}
      </main>

      {/* 修改密码弹窗 */}
      <Modal
        backdrop="opaque"
        classNames={{
          base: "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden",
        }}
        isOpen={isOpen}
        placement="center"
        scrollBehavior="outside"
        size="md"
        onOpenChange={() => {
          onOpenChange();
          resetPasswordForm();
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                修改密码
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label="新用户名"
                    placeholder="请输入新用户名（至少3位）"
                    value={passwordForm.newUsername}
                    variant="bordered"
                    onChange={(e) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        newUsername: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="当前密码"
                    placeholder="请输入当前密码"
                    type="password"
                    value={passwordForm.currentPassword}
                    variant="bordered"
                    onChange={(e) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        currentPassword: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="新密码"
                    placeholder="请输入新密码（至少6位）"
                    type="password"
                    value={passwordForm.newPassword}
                    variant="bordered"
                    onChange={(e) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        newPassword: e.target.value,
                      }))
                    }
                  />
                  <Input
                    label="确认密码"
                    placeholder="请再次输入新密码"
                    type="password"
                    value={passwordForm.confirmPassword}
                    variant="bordered"
                    onChange={(e) =>
                      setPasswordForm((prev) => ({
                        ...prev,
                        confirmPassword: e.target.value,
                      }))
                    }
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="flat" onPress={onClose}>
                  取消
                </Button>
                <Button
                  color="primary"
                  isLoading={passwordLoading}
                  onPress={handlePasswordSubmit}
                >
                  确定
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
