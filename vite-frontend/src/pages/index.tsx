import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { Turnstile } from "@marsidev/react-turnstile";
import { motion } from "framer-motion";

import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Input } from "@/shadcn-bridge/heroui/input";
import { Button } from "@/shadcn-bridge/heroui/button";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import { siteConfig } from "@/config/site";
import { title } from "@/components/primitives";
import { VersionFooter } from "@/components/version-footer";
import DefaultLayout from "@/layouts/default";
import { login, register, LoginData, getConfigByName } from "@/api";
import { writeLoginSession } from "@/utils/session";
import { useWebViewMode } from "@/hooks/useWebViewMode";

interface LoginForm {
  username: string;
  password: string;
}

export default function IndexPage() {
  const [form, setForm] = useState<LoginForm>({
    username: "",
    password: "",
  });
  const [errors, setErrors] = useState<Partial<LoginForm>>({});
  const [loading, setLoading] = useState(false);
  const isWebView = useWebViewMode();
  const [siteKey, setSiteKey] = useState("");
  const [regSiteKey, setRegSiteKey] = useState("");

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    user: "",
    password: "",
    confirm: "",
  });
  const [registerErrors, setRegisterErrors] = useState<
    Partial<typeof registerForm>
  >({});
  const [registerLoading, setRegisterLoading] = useState(false);
  const [regEnabled, setRegEnabled] = useState(true);

  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [showLoginCaptcha, setShowLoginCaptcha] = useState(false);
  const [loginCaptchaToken, setLoginCaptchaToken] = useState("");

  const [regCaptchaEnabled, setRegCaptchaEnabled] = useState(false);
  const [showRegCaptcha, setShowRegCaptcha] = useState(false);
  const [regCaptchaId, setRegCaptchaId] = useState("");

  useEffect(() => {
    getConfigByName("registration_enabled")
      .then((res) => {
        if (res.code === 0 && res.data) {
          const v = res.data.value;
          setRegEnabled(v === "1" || v === "true");
        }
      })
      .catch(() => {});
    getConfigByName("register_captcha_enabled")
      .then((res) => {
        if (res.code === 0 && res.data) {
          setRegCaptchaEnabled(res.data.value === "true");
        }
      })
      .catch(() => {});
    getConfigByName("captcha_enabled")
      .then((res) => {
        if (res.code === 0 && res.data) {
          setCaptchaEnabled(res.data.value === "true");
        }
      })
      .catch(() => {});
    getConfigByName("cloudflare_site_key")
      .then((res) => {
        if (res.code === 0 && res.data && res.data.value) {
          setSiteKey(res.data.value);
        }
      })
      .catch(() => {});
  }, []);

  const validateForm = (): boolean => {
    const newErrors: Partial<LoginForm> = {};

    if (!form.username.trim()) {
      newErrors.username = "请输入用户名";
    }
    if (!form.password.trim()) {
      newErrors.password = "请输入密码";
    } else if (form.password.length < 6) {
      newErrors.password = "密码长度至少6位";
    }
    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof LoginForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const performLogin = async (captchaToken?: string) => {
    try {
      const loginData: LoginData = {
        username: form.username.trim(),
        password: form.password,
        captchaId: captchaToken || loginCaptchaToken || "",
      };

      const response = await login(loginData);

      if (response.code !== 0) {
        toast.error(response.msg || "登录失败");
        if (captchaEnabled && siteKey) {
          setLoginCaptchaToken("");
        }

        return;
      }

      if (response.data.requirePasswordChange) {
        writeLoginSession(response.data);
        toast.success("检测到默认密码，即将跳转到修改密码页面");
        window.location.href = "/change-password";

        return;
      }

      writeLoginSession(response.data);
      toast.success("登录成功");
      window.location.href = "/dashboard";
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!validateForm()) return;

    if (captchaEnabled && siteKey && !loginCaptchaToken) {
      setShowLoginCaptcha(true);

      return;
    }

    setLoading(true);
    await performLogin();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleLogin();
    }
  };

  const performRegister = async (captchaToken?: string) => {
    setRegisterLoading(true);
    try {
      const res = await register({
        user: registerForm.user.trim(),
        password: registerForm.password,
        captchaId: captchaToken || regCaptchaId || "",
      });

      if (res.code === 0) {
        writeLoginSession(res.data);
        toast.success("注册成功");
        setRegisterOpen(false);
        setRegCaptchaId("");
        window.location.href = "/dashboard";
      } else {
        toast.error(res.msg || "注册失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleRegister = async () => {
    const errs: Partial<typeof registerForm> = {};

    if (!registerForm.user.trim()) errs.user = "请输入用户名";
    if (!registerForm.password) errs.password = "请输入密码";
    else if (registerForm.password.length < 6)
      errs.password = "密码长度至少6位";
    if (registerForm.password !== registerForm.confirm)
      errs.confirm = "两次密码不一致";
    setRegisterErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (regCaptchaEnabled && regSiteKey && !regCaptchaId) {
      setShowRegCaptcha(true);

      return;
    }

    await performRegister();
  };

  const getTurnstileTheme = (): "light" | "dark" | "auto" => {
    if (
      document.documentElement.classList.contains("dark") ||
      document.documentElement.getAttribute("data-theme") === "dark" ||
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }

    return "light";
  };

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center justify-center gap-4 py-4 sm:py-8 md:py-10 pb-20 min-h-[calc(100dvh-120px)] sm:min-h-[calc(100dvh-200px)]">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md px-4 sm:px-0"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <Card className="w-full">
            <CardHeader className="pb-0 pt-6 px-6 flex-col items-center">
              <h1 className={title({ size: "sm" })}>登陆</h1>
              <p className="text-small text-default-500 mt-2">
                请输入您的账号信息
              </p>
            </CardHeader>
            <CardBody className="px-6 py-6">
              <div className="flex flex-col gap-4">
                <Input
                  errorMessage={errors.username}
                  isDisabled={loading}
                  isInvalid={!!errors.username}
                  label="用户名"
                  placeholder="请输入用户名"
                  value={form.username}
                  variant="bordered"
                  onChange={(e) =>
                    handleInputChange("username", e.target.value)
                  }
                  onKeyDown={handleKeyPress}
                />
                <Input
                  isDisabled={loading}
                  isInvalid={!!errors.password}
                  label="密码"
                  placeholder="请输入密码"
                  type="password"
                  value={form.password}
                  variant="bordered"
                  onChange={(e) =>
                    handleInputChange("password", e.target.value)
                  }
                  onKeyDown={handleKeyPress}
                />
                <Button
                  className="mt-2"
                  color="primary"
                  disabled={loading}
                  isLoading={loading}
                  size="lg"
                  onPress={handleLogin}
                >
                  {loading ? "登录中..." : "登录"}
                </Button>
                {captchaEnabled && siteKey && showLoginCaptcha && (
                  <div className="flex justify-center py-2">
                    <Turnstile
                      options={{ theme: getTurnstileTheme() }}
                      siteKey={siteKey}
                      onError={() => {
                        toast.error("验证失败，请刷新重试");
                        setLoginCaptchaToken("");
                      }}
                      onExpire={() => setLoginCaptchaToken("")}
                      onSuccess={(token) => {
                        setLoginCaptchaToken(token);
                        setLoading(true);
                        void performLogin(token);
                      }}
                    />
                  </div>
                )}
                {regEnabled && (
                  <div className="text-center mt-2">
                    <button
                      className="text-sm text-primary hover:underline"
                      type="button"
                      onClick={() => setRegisterOpen(true)}
                    >
                      没有账号？立即注册
                    </button>
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </motion.div>

        <VersionFooter
          containerClassName="fixed inset-x-0 bottom-4 text-center py-4"
          poweredClassName="text-xs text-gray-600 dark:text-white"
          showUpdateInfo={false}
          updateBadgeClassName="inline-flex items-center h-[18px] px-1.5 rounded-sm bg-green-500/90 text-[10px] font-semibold text-white"
          version={isWebView ? siteConfig.app_version : siteConfig.version}
          versionClassName="text-xs text-gray-400 dark:text-gray-500 mt-1"
        />

        <Modal
          isOpen={registerOpen}
          placement="center"
          onOpenChange={(open) => {
            if (!open) {
              setRegisterOpen(false);
              setRegisterForm({ user: "", password: "", confirm: "" });
              setRegisterErrors({});
              setRegCaptchaId("");
              setRegSiteKey("");
            }
          }}
        >
          <ModalContent>
            <ModalHeader>注册账号</ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-4">
                <Input
                  errorMessage={registerErrors.user}
                  isInvalid={!!registerErrors.user}
                  label="用户名"
                  placeholder="请输入用户名"
                  value={registerForm.user}
                  variant="bordered"
                  onChange={(e) =>
                    setRegisterForm((p) => ({ ...p, user: e.target.value }))
                  }
                />
                <Input
                  errorMessage={registerErrors.password}
                  isInvalid={!!registerErrors.password}
                  label="密码"
                  placeholder="请输入密码"
                  type="password"
                  value={registerForm.password}
                  variant="bordered"
                  onChange={(e) =>
                    setRegisterForm((p) => ({ ...p, password: e.target.value }))
                  }
                />
                <Input
                  errorMessage={registerErrors.confirm}
                  isInvalid={!!registerErrors.confirm}
                  label="确认密码"
                  placeholder="再次输入密码"
                  type="password"
                  value={registerForm.confirm}
                  variant="bordered"
                  onChange={(e) =>
                    setRegisterForm((p) => ({ ...p, confirm: e.target.value }))
                  }
                />
                {regCaptchaEnabled && regSiteKey && showRegCaptcha && (
                  <div className="flex justify-center py-2">
                    <Turnstile
                      options={{ theme: getTurnstileTheme() }}
                      siteKey={regSiteKey}
                      onError={() => {
                        toast.error("验证失败，请刷新重试");
                        setRegCaptchaId("");
                      }}
                      onExpire={() => setRegCaptchaId("")}
                      onSuccess={(token) => {
                        setRegCaptchaId(token);
                        setRegisterLoading(true);
                        void performRegister(token);
                      }}
                    />
                  </div>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="flat"
                onPress={() => {
                  setRegisterOpen(false);
                  setRegisterForm({ user: "", password: "", confirm: "" });
                  setRegisterErrors({});
                  setRegCaptchaId("");
                  setRegSiteKey("");
                }}
              >
                取消
              </Button>
              <Button
                color="primary"
                isLoading={registerLoading}
                onPress={handleRegister}
              >
                注册
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </section>
    </DefaultLayout>
  );
}
