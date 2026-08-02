import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";

const IndexPage = lazy(() => import("@/pages/index"));
const ChangePasswordPage = lazy(() => import("@/pages/change-password"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const MonitorPage = lazy(() => import("@/pages/monitor"));
const TZPage = lazy(() => import("@/pages/tz"));
const ForwardPage = lazy(() => import("@/pages/forward"));
const TunnelPage = lazy(() => import("@/pages/tunnel"));
const NodePage = lazy(() => import("@/pages/node"));
const SDWANPage = lazy(() => import("@/pages/sdwan"));
const UserPage = lazy(() => import("@/pages/user"));
const ConfigPage = lazy(() => import("@/pages/config"));
const ShopPage = lazy(() => import("@/pages/shop"));
const MyHomePage = lazy(() => import("@/pages/myhome"));
const AdminPlansPage = lazy(() => import("@/pages/admin-plans"));
const AdminOrdersPage = lazy(() => import("@/pages/admin-orders"));
const AdminPaymentPage = lazy(() => import("@/pages/admin-payment"));
const AdminTelegramPage = lazy(() => import("@/pages/admin-telegram"));
const AdminPanelAddressPage = lazy(() => import("@/pages/admin-panel-address"));
import AdminLayout from "@/layouts/admin";
import H5Layout from "@/layouts/h5";
import { isLoggedIn } from "@/utils/auth";
import { isRestricted } from "@/utils/session";
import { siteConfig, updateSiteConfig } from "@/config/site";
import { useH5Mode } from "@/hooks/useH5Mode";

const RESTRICTED_PATHS = ["/dashboard"];

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
        navigate("/dashboard", { replace: true });
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
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-white dark:bg-black" />}>
    <Routes>
      <Route element={<LoginRoute />} path="/" />
      <Route element={<TZPage />} path="/tz" />
      <Route element={<Navigate replace to="/node" />} path="/panel-sharing" />
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
            <SDWANPage />
          </ProtectedRoute>
        }
        path="/sdwan"
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
            <ConfigPage />
          </ProtectedRoute>
        }
        path="/config"
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
      <Route
        element={
          <ProtectedRoute>
            <AdminTelegramPage />
          </ProtectedRoute>
        }
        path="/admin/telegram"
      />
      <Route element={<AdminPanelAddressPage />} path="/settings" />
    </Routes>
    </Suspense>
  );
}

export default App;
