import { Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";

import IndexPage from "@/pages/index";
import ChangePasswordPage from "@/pages/change-password";
import DashboardPage from "@/pages/dashboard";
import MonitorPage from "@/pages/monitor";
import TZPage from "@/pages/tz";
import ForwardPage from "@/pages/forward";
import TunnelPage from "@/pages/tunnel";
import NodePage from "@/pages/node";
import UserPage from "@/pages/user";
import GroupPage from "@/pages/group";
import ProfilePage from "@/pages/profile";
import LimitPage from "@/pages/limit";
import ConfigPage from "@/pages/config";
import PanelSharingPage from "@/pages/panel-sharing";
import ShopPage from "@/pages/shop";
import MyHomePage from "@/pages/myhome";
import AdminPlansPage from "@/pages/admin-plans";
import AdminOrdersPage from "@/pages/admin-orders";
import AdminPaymentPage from "@/pages/admin-payment";
import { SettingsPage } from "@/pages/settings";
import AdminLayout from "@/layouts/admin";
import H5Layout from "@/layouts/h5";
import { isLoggedIn } from "@/utils/auth";
import { isRestricted } from "@/utils/session";
import { siteConfig, updateSiteConfig } from "@/config/site";
import { useH5Mode } from "@/hooks/useH5Mode";

const RESTRICTED_PATHS = ["/myhome", "/shop", "/dashboard"];

// 简化的路由保护组件 - 使用 React Router 导航避免循环
const ProtectedRoute = ({
  children,
  skipLayout = false,
}: {
  children: React.ReactNode;
  skipLayout?: boolean;
}) => {
  const authenticated = isLoggedIn();
  const restricted = isRestricted();
  const isH5 = useH5Mode();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!authenticated) {
      navigate("/", { replace: true });
    } else if (restricted && !RESTRICTED_PATHS.includes(location.pathname)) {
      navigate("/myhome", { replace: true });
    }
  }, [authenticated, restricted, location.pathname, navigate]);

  if (!authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white dark:bg-black">
        <div className="text-lg text-gray-700 dark:text-gray-200" />
      </div>
    );
  }

  if (skipLayout) {
    return <>{children}</>;
  }

  const Layout = isH5 ? H5Layout : AdminLayout;

  return <Layout>{children}</Layout>;
};

// 登录页面路由组件 - 已登录则重定向到dashboard（或 sessionStorage 中的重定向地址）
const LoginRoute = () => {
  const authenticated = isLoggedIn();
  const restricted = isRestricted();
  const navigate = useNavigate();

  useEffect(() => {
    if (authenticated) {
      const redirect = sessionStorage.getItem("login_redirect");

      if (redirect) {
        sessionStorage.removeItem("login_redirect");
        navigate(redirect, { replace: true });
      } else if (restricted) {
        navigate("/myhome", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    }
  }, [authenticated, restricted, navigate]);

  if (authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-black">
        <div className="text-lg text-gray-700 dark:text-gray-200" />
      </div>
    );
  }

  return <IndexPage />;
};

function App() {
  // 立即设置页面标题（使用已从缓存读取的配置）
  useEffect(() => {
    document.title = siteConfig.name;

    void updateSiteConfig();

    const handleConfigUpdate = () => {
      void updateSiteConfig();
    };

    window.addEventListener("configUpdated", handleConfigUpdate);

    return () => {
      window.removeEventListener("configUpdated", handleConfigUpdate);
    };
  }, []);

  return (
    <Routes>
      <Route element={<LoginRoute />} path="/" />
      <Route element={<TZPage />} path="/tz" />
      <Route
        element={
          <ProtectedRoute skipLayout={true}>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
        path="/change-password"
      />
      <Route
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
        path="/dashboard"
      />
      <Route
        element={
          <ProtectedRoute>
            <MonitorPage />
          </ProtectedRoute>
        }
        path="/monitor"
      />
      <Route
        element={
          <ProtectedRoute>
            <ForwardPage />
          </ProtectedRoute>
        }
        path="/forward"
      />
      <Route
        element={
          <ProtectedRoute>
            <TunnelPage />
          </ProtectedRoute>
        }
        path="/tunnel"
      />
      <Route
        element={
          <ProtectedRoute>
            <NodePage />
          </ProtectedRoute>
        }
        path="/node"
      />
      <Route
        element={
          <ProtectedRoute>
            <UserPage />
          </ProtectedRoute>
        }
        path="/user"
      />
      <Route
        element={
          <ProtectedRoute>
            <GroupPage />
          </ProtectedRoute>
        }
        path="/group"
      />
      <Route
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
        path="/profile"
      />
      <Route
        element={
          <ProtectedRoute>
            <LimitPage />
          </ProtectedRoute>
        }
        path="/limit"
      />
      <Route
        element={
          <ProtectedRoute>
            <ConfigPage />
          </ProtectedRoute>
        }
        path="/config"
      />
      <Route
        element={
          <ProtectedRoute>
            <PanelSharingPage />
          </ProtectedRoute>
        }
        path="/panel-sharing"
      />
      <Route
        element={
          <ProtectedRoute>
            <ShopPage />
          </ProtectedRoute>
        }
        path="/shop"
      />
      <Route
        element={
          <ProtectedRoute>
            <MyHomePage />
          </ProtectedRoute>
        }
        path="/myhome"
      />
      <Route
        element={
          <ProtectedRoute>
            <AdminPlansPage />
          </ProtectedRoute>
        }
        path="/admin/plans"
      />
      <Route
        element={
          <ProtectedRoute>
            <AdminOrdersPage />
          </ProtectedRoute>
        }
        path="/admin/orders"
      />
      <Route
        element={
          <ProtectedRoute>
            <AdminPaymentPage />
          </ProtectedRoute>
        }
        path="/admin/payment"
      />
      <Route element={<SettingsPage />} path="/settings" />
    </Routes>
  );
}

export default App;
