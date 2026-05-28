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
import {
  login,
  register,
  LoginData,
  checkCaptcha,
  getConfigByName,
} from "@/api";
import { writeLoginSession } from "@/utils/session";
import { useWebViewMode } from "@/hooks/useWebViewMode";

interface LoginForm {
  username: string;
  password: string;
  captchaId: string;
}

export default function IndexPage() {
  const [form, setForm] = useState<LoginForm>({
    username: "",
    password: "",
    captchaId: "",
  });
  const [errors, setErrors] = useState<Partial<LoginForm>>({});
  const [loading, setLoading] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const isWebView = useWebViewMode();
  const [siteKey, setSiteKey] = useState("");

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({ user: "", password: "", confirm: "" });
  const [registerErrors, setRegisterErrors] = useState<Partial<typeof registerForm>>({});
  const [registerLoading, setRegisterLoading] = useState(false);
  const [regEnabled, setRegEnabled] = useState(true);

  useEffect(() => {
    getConfigByName("registration_enabled").then((res) => {
      if (res.code === 0 && res.data) {
        setRegEnabled(res.data.value !== "0");
      }
    }).catch(() => {});
  }, []);

  // 验证表单
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

  // 处理输入变化
  const handleInputChange = (field: keyof LoginForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // 清除该字段的错误
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  // 执行登录请求
  const performLogin = async (captchaToken?: string) => {
    try {
      const finalCaptchaId =
        typeof captchaToken === "string" && captchaToken.trim()
          ? captchaToken
          : form.captchaId;

      const loginData: LoginData = {
        username: form.username.trim(),
        password: form.password,
        captchaId: finalCaptchaId,
      };

      const response = await login(loginData);

      if (response.code !== 0) {
        toast.error(response.msg || "登录失败");
        if (showCaptcha) {
          setForm((prev) => ({ ...prev, captchaId: "" }));
        }

        return;
      }

      // 检查是否需要强制修改密码
      if (response.data.requirePasswordChange) {
        writeLoginSession(response.data);
        toast.success("检测到默认密码，即将跳转到修改密码页面");
        window.location.href = "/change-password";

        return;
      }

      // 保存登录信息
      writeLoginSession(response.data);

      // 登录成功
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

    setLoading(true);

    try {
      // 先检查是否需要验证码
      const checkResponse = await checkCaptcha();

      if (checkResponse.code !== 0) {
        toast.error("检查验证码状态失败，请重试" + checkResponse.msg);
        setLoading(false);

        return;
      }

      // 根据返回值决定是否显示验证码
      if (checkResponse.data === 0) {
        await performLogin();
      } else {
        const configResp = await getConfigByName("cloudflare_site_key");

        if (configResp.code === 0 && configResp.data && configResp.data.value) {
          setSiteKey(configResp.data.value);
          setShowCaptcha(true);
        } else {
          toast.error("未配置Cloudflare Site Key，请联系管理员");
          setLoading(false);
        }
      }
    } catch (error) {
      toast.error("网络错误，请稍后重试" + error);
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleLogin();
    }
  };

  const handleRegister = async () => {
    const errs: Partial<typeof registerForm> = {};
    if (!registerForm.user.trim()) errs.user = "请输入用户名";
    if (!registerForm.password) errs.password = "请输入密码";
    else if (registerForm.password.length < 6) errs.password = "密码长度至少6位";
    if (registerForm.password !== registerForm.confirm) errs.confirm = "两次密码不一致";
    setRegisterErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setRegisterLoading(true);
    try {
      const res = await register({ user: registerForm.user.trim(), password: registerForm.password });
      if (res.code === 0) {
        writeLoginSession(res.data);
        toast.success("注册成功");
        setRegisterOpen(false);
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
                  {loading ? (showCaptcha ? "验证中..." : "登录中...") : "登录"}
                </Button>

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

        {/* 版权信息 - 固定在底部，不占据布局空间 */}

        <VersionFooter
          containerClassName="fixed inset-x-0 bottom-4 text-center py-4"
          poweredClassName="text-xs text-gray-400 dark:text-gray-500"
          showUpdateInfo={false}
          updateBadgeClassName="inline-flex items-center h-[18px] px-1.5 rounded-sm bg-green-500/90 text-[10px] font-semibold text-white"
          version={isWebView ? siteConfig.app_version : siteConfig.version}
          versionClassName="text-xs text-gray-400 dark:text-gray-500 mt-1"
        />

        {/* 验证码弹层 */}
        {showCaptcha && siteKey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button
              className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm captcha-backdrop-enter"
              type="button"
              onClick={() => { setShowCaptcha(false); setLoading(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setShowCaptcha(false); setLoading(false); } }}
            />
            <div className="mb-4 relative z-50 bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-xl">
              <div className="mb-4 text-center text-sm font-medium text-gray-700 dark:text-gray-200">请完成安全验证</div>
              <div className="flex justify-center">
                <Turnstile
                  options={{ theme: ((document.documentElement.classList.contains("dark") || document.documentElement.getAttribute("data-theme") === "dark" || window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light") as "light" | "dark" | "auto" }}
                  siteKey={siteKey}
                  onError={() => { toast.error("验证失败，请刷新重试"); setLoading(false); }}
                  onExpire={() => { setForm((prev) => ({ ...prev, captchaId: "" })); }}
                  onSuccess={(token) => { setForm((prev) => ({ ...prev, captchaId: token })); void performLogin(token); }}
                />
              </div>
            </div>
          </div>
        )}

        <Modal isOpen={registerOpen} placement="center"
          onOpenChange={(open) => { if (!open) { setRegisterOpen(false); setRegisterForm({ user: "", password: "", confirm: "" }); setRegisterErrors({}); } }}>
          <ModalContent>
            <ModalHeader>注册账号</ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-4">
                <Input label="用户名" placeholder="请输入用户名" variant="bordered" value={registerForm.user}
                  isInvalid={!!registerErrors.user} errorMessage={registerErrors.user}
                  onChange={(e) => setRegisterForm((p) => ({ ...p, user: e.target.value }))} />
                <Input label="密码" placeholder="请输入密码" type="password" variant="bordered" value={registerForm.password}
                  isInvalid={!!registerErrors.password} errorMessage={registerErrors.password}
                  onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))} />
                <Input label="确认密码" placeholder="再次输入密码" type="password" variant="bordered" value={registerForm.confirm}
                  isInvalid={!!registerErrors.confirm} errorMessage={registerErrors.confirm}
                  onChange={(e) => setRegisterForm((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={() => { setRegisterOpen(false); setRegisterForm({ user: "", password: "", confirm: "" }); setRegisterErrors({}); }}>
                取消
              </Button>
              <Button color="primary" isLoading={registerLoading} onPress={handleRegister}>
                注册
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </section>
    </DefaultLayout>
  );
}
