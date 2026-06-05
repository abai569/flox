import type {
  BalanceLogItem,
  RedeemCodeItem,
  DiscountCodeItem,
  SubscriptionPackageApiItem,
  UserApiItem,
} from "@/api/types";

import { useState, useEffect, useCallback, useMemo } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Button } from "@/shadcn-bridge/heroui/button";
import { Input } from "@/shadcn-bridge/heroui/input";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/shadcn-bridge/heroui/dropdown";
import { Card, CardBody, CardHeader } from "@/shadcn-bridge/heroui/card";
import { Chip } from "@/shadcn-bridge/heroui/chip";
import { Switch } from "@/shadcn-bridge/heroui/switch";
import { Select, SelectItem } from "@/shadcn-bridge/heroui/select";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@/shadcn-bridge/heroui/table";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@/shadcn-bridge/heroui/modal";
import Network from "@/api/network";
import {
  getBalanceLogs,
  deleteBalanceLog,
  cleanupBalanceLogs,
  batchDeleteBalanceLogs,
  getRedeemCodes,
  createRedeemCodes,
  deleteRedeemCode,
  getDiscountCodes,
  createDiscountCode,
  deleteDiscountCode,
  getBillingFeatureStatus,
  setBillingFeatureStatus,
  getAllUsers,
  getPackageList,
  createPackageOrder,
  payOrder,
} from "@/api";

// ─── Billing helpers ───
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  const len = 6 + Math.floor(Math.random() * 5);

  return Array.from(
    { length: len },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join("");
}

function fmtMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function fmtTime(ts?: number | null) {
  if (!ts) return "-";

  return new Date(ts).toLocaleString();
}

function parseDateText(value: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  if (!trimmed) return undefined;
  if (/^\d{8}$/.test(trimmed)) {
    const year = parseInt(trimmed.slice(0, 4));
    const month = parseInt(trimmed.slice(4, 6)) - 1;
    const day = parseInt(trimmed.slice(6, 8));
    const d = new Date(year, month, day);

    if (!isNaN(d.getTime())) return d.getTime();
  }
  const d = new Date(trimmed);

  if (!isNaN(d.getTime())) return d.getTime();

  return undefined;
}

// ─── Payment interfaces ───
interface YiPayForm {
  enabled: boolean;
  gateway_url: string;
  pid: string;
  key: string;
  notify_url: string;
  return_url: string;
  sign_mode: string;
  enable_alipay: boolean;
  enable_wxpay: boolean;
}

interface UsdtForm {
  enabled: boolean;
  api_url: string;
  pid: string;
  secret_key: string;
  notify_url: string;
  return_url: string;
  currency: string;
  token: string;
  enable_tron: boolean;
  enable_polygon: boolean;
}

interface PaymentStats {
  paidAmount: number;
  paidOrders: number;
  pendingOrders: number;
}

interface PaymentConfig {
  id: number;
  channel: string;
  config: string;
  enabled: number;
}

const defaultYiPay: YiPayForm = {
  enabled: false,
  gateway_url: "",
  pid: "",
  key: "",
  notify_url: "",
  return_url: "",
  sign_mode: "epay",
  enable_alipay: true,
  enable_wxpay: true,
};

const defaultUsdt: UsdtForm = {
  enabled: false,
  api_url: "",
  pid: "",
  secret_key: "",
  notify_url: "",
  return_url: "",
  currency: "cny",
  token: "usdt",
  enable_tron: true,
  enable_polygon: true,
};

export default function AdminPaymentPage() {
  // ── Payment state ──
  const [configs, setConfigs] = useState<PaymentConfig[]>([]);
  const [stats, setStats] = useState<PaymentStats>({
    paidAmount: 0,
    paidOrders: 0,
    pendingOrders: 0,
  });
  const [packages, setPackages] = useState<SubscriptionPackageApiItem[]>([]);
  const [paymentTabKey, setPaymentTabKey] = useState("usdt");

  const [yipay, setYipay] = useState<YiPayForm>(defaultYiPay);
  const [usdt, setUsdt] = useState<UsdtForm>(defaultUsdt);
  const [editingYiPayKey, setEditingYiPayKey] = useState(false);
  const [editingUsdtKey, setEditingUsdtKey] = useState(false);

  const [testChannel, setTestChannel] = useState("YIPAY");
  const [testPackageId, setTestPackageId] = useState("");
  const [createdPayUrl, setCreatedPayUrl] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  const panelUrl = typeof window !== "undefined" ? window.location.origin : "";

  // ── Billing state ──
  const [redemptionEnabled, setRedemptionEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(true);

  const [logs, setLogs] = useState<BalanceLogItem[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logUserId, setLogUserId] = useState<string>(
    () => localStorage.getItem("adminPaymentLogUserFilter") || "all",
  );
  const [users, setUsers] = useState<UserApiItem[]>([]);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(new Set());
  const [deleteLogConfirmOpen, setDeleteLogConfirmOpen] = useState(false);
  const [deleteLogTarget, setDeleteLogTarget] = useState<BalanceLogItem | null>(
    null,
  );
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  const [redeemCodes, setRedeemCodes] = useState<RedeemCodeItem[]>([]);
  const [redeemType, setRedeemType] = useState<"plan" | "balance">("plan");
  const [redeemCodeVal, setRedeemCodeVal] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemCount, setRedeemCount] = useState("1");
  const [redeemPlanId, setRedeemPlanId] = useState("");
  const [redeemDuration, setRedeemDuration] = useState("30");
  const [redeemStartsAt, setRedeemStartsAt] = useState("");
  const [redeemExpiresAt, setRedeemExpiresAt] = useState("");

  const [discountCodes, setDiscountCodes] = useState<DiscountCodeItem[]>([]);
  const [dcCode, setDcCode] = useState("");
  const [dcType, setDcType] = useState<"percent" | "amount">("percent");
  const [dcValue, setDcValue] = useState("");
  const [dcMaxUses, setDcMaxUses] = useState("0");
  const [dcStartsAt, setDcStartsAt] = useState("");
  const [dcExpiresAt, setDcExpiresAt] = useState("");
  const [dcPlanIds, setDcPlanIds] = useState<number[]>([]);

  // ── Main navigation ──
  const [mainTabKey, setMainTabKey] = useState(
    () => localStorage.getItem("adminPaymentTab") || "billing",
  );
  const handleTabChange = (key: string) => {
    setMainTabKey(key);
    localStorage.setItem("adminPaymentTab", key);
  };

  // ── Payment data loading ──
  const loadPaymentData = useCallback(async () => {
    try {
      const [configRes, statsRes, pkgRes] = await Promise.all([
        Network.post<PaymentConfig[]>("/payment/config/admin/list"),
        Network.post<PaymentStats>("/payment/stats"),
        getPackageList(),
      ]);

      if (configRes.code === 0)
        setConfigs(Array.isArray(configRes.data) ? configRes.data : []);
      if (statsRes.code === 0) setStats(statsRes.data);
      if (pkgRes.code === 0)
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data : []);
    } catch {
      toast.error("加载数据失败");
    }
  }, []);

  useEffect(() => {
    loadPaymentData();
  }, [loadPaymentData]);

  usePullToRefresh(() => {
    loadPaymentData();
    loadBillingData();
  });

  const yipayConfig = useMemo(
    () => configs.find((c) => c.channel === "YIPAY"),
    [configs],
  );
  const usdtConfig = useMemo(
    () => configs.find((c) => c.channel === "USDT"),
    [configs],
  );

  useEffect(() => {
    if (yipayConfig) {
      try {
        const parsed = JSON.parse(yipayConfig.config);

        setYipay({
          enabled: !!yipayConfig.enabled,
          gateway_url: parsed.gateway_url || "",
          pid: parsed.pid || "",
          key: parsed.key || "",
          notify_url:
            parsed.notify_url || panelUrl + "/api/v1/payment/callback/yipay",
          return_url: parsed.return_url || panelUrl + "/shop",
          sign_mode: parsed.sign_mode || "epay",
          enable_alipay: parsed.enable_alipay !== false,
          enable_wxpay: parsed.enable_wxpay !== false,
        });
      } catch {
        setYipay((p) => ({
          ...p,
          enabled: !!yipayConfig.enabled,
          notify_url: panelUrl + "/api/v1/payment/callback/yipay",
          return_url: panelUrl + "/shop",
          sign_mode: "epay",
          enable_alipay: true,
          enable_wxpay: true,
        }));
      }
    }
  }, [yipayConfig]);

  useEffect(() => {
    if (usdtConfig) {
      try {
        const parsed = JSON.parse(usdtConfig.config);

        setUsdt({
          enabled: !!usdtConfig.enabled,
          api_url: parsed.api_url || "",
          pid: parsed.pid || "",
          secret_key: parsed.secret_key || "",
          notify_url:
            parsed.notify_url || panelUrl + "/api/v1/payment/callback/usdt",
          return_url: parsed.return_url || "",
          currency: parsed.currency || "cny",
          token: parsed.token || "usdt",
          enable_tron: parsed.enable_tron !== false,
          enable_polygon: parsed.enable_polygon !== false,
        });
      } catch {
        setUsdt({
          ...defaultUsdt,
          enabled: !!usdtConfig.enabled,
          notify_url: panelUrl + "/api/v1/payment/callback/usdt",
          enable_tron: true,
          enable_polygon: true,
        });
      }
    }
  }, [usdtConfig]);

  const saveConfig = async (
    channel: string,
    enabled: boolean,
    cfg: Record<string, unknown>,
  ) => {
    const res = await Network.post("/payment/config/save", {
      channel,
      config: JSON.stringify(cfg),
      enabled: enabled ? 1 : 0,
    });

    if (res.code === 0) {
      toast.success("保存成功");
      loadPaymentData();
    } else {
      toast.error(res.msg || "保存失败");
    }
  };

  const handleTestOrder = async () => {
    if (!testPackageId) {
      toast.error("请选择套餐");

      return;
    }
    setTestLoading(true);
    try {
      const currency =
        testChannel === "BALANCE"
          ? "BALANCE"
          : testChannel === "USDT"
            ? "USDT"
            : "YIPAY";
      const createRes = await createPackageOrder({
        package_id: Number(testPackageId),
        pay_currency: currency,
      });

      if (createRes.code !== 0) {
        toast.error(createRes.msg || "创建订单失败");
        setTestLoading(false);

        return;
      }
      if (currency === "BALANCE") {
        setCreatedPayUrl("");
        toast.success("余额订单已自动扣款");
        loadPaymentData();
        setTestLoading(false);

        return;
      }
      const payRes = await payOrder(createRes.data.orderId);

      if (payRes.code === 0) {
        setCreatedPayUrl(payRes.data.payUrl || payRes.data.payAddress || "");
        toast.success("测试订单已创建");
        loadPaymentData();
      } else {
        toast.error(payRes.msg || "获取支付链接失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setTestLoading(false);
    }
  };

  // ── Billing data loading ──
  const loadBillingData = useCallback(async () => {
    try {
      const [logRes, redeemRes, discountRes, featureRes, pkgRes] =
        await Promise.all([
          getBalanceLogs({
            page: logPage,
            size: 50,
            userId: logUserId !== "all" ? Number(logUserId) : undefined,
          }),
          getRedeemCodes(),
          getDiscountCodes(),
          getBillingFeatureStatus(),
          getPackageList(),
        ]);

      if (logRes.code === 0) {
        setLogs(logRes.data?.list || []);
        setLogTotal(logRes.data?.total || 0);
      }
      if (redeemRes.code === 0)
        setRedeemCodes(Array.isArray(redeemRes.data) ? redeemRes.data : []);
      if (discountRes.code === 0)
        setDiscountCodes(
          Array.isArray(discountRes.data) ? discountRes.data : [],
        );
      if (featureRes.code === 0) {
        setRedemptionEnabled(!!featureRes.data?.redemptionEnabled);
        setDiscountEnabled(!!featureRes.data?.discountEnabled);
      }
      if (pkgRes.code === 0)
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data : []);
    } catch {
      toast.error("加载数据失败");
    }
  }, [logPage]);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  useEffect(() => {
    (async () => {
      const res = await getBalanceLogs({
        page: logPage,
        size: 50,
        userId: logUserId !== "all" ? Number(logUserId) : undefined,
      });

      if (res.code === 0) {
        setLogs(res.data?.list || []);
        setLogTotal(res.data?.total || 0);
      }
    })();
  }, [logUserId]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await getAllUsers({ size: 1000 });

      if (res.code === 0) setUsers(Array.isArray(res.data) ? res.data : []);
    } catch { }
  }, []);

  const handleDeleteLog = (log: BalanceLogItem) => {
    setDeleteLogTarget(log);
    setDeleteLogConfirmOpen(true);
  };

  const handleConfirmDeleteLog = async () => {
    if (!deleteLogTarget) return;
    const log = deleteLogTarget;

    setDeleteLogConfirmOpen(false);
    setDeleteLogTarget(null);
    const res = await deleteBalanceLog(log.id);

    if (res.code === 0) {
      toast.success("删除成功");
      loadBillingData();
    } else {
      toast.error(res.msg || "删除失败");
    }
  };

  const handleCleanupLogs = () => {
    setCleanupConfirmOpen(true);
  };

  const handleConfirmCleanup = async () => {
    setCleanupConfirmOpen(false);
    const res = await cleanupBalanceLogs();

    if (res.code === 0) {
      toast.success(`清理完成，删除 ${res.data?.deleted || 0} 条记录`);
      loadBillingData();
    } else {
      toast.error(res.msg || "清理失败");
    }
  };

  const toggleSelectLogId = (id: number) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllLogs = () => {
    if (selectedLogIds.size === logs.length) {
      setSelectedLogIds(new Set());
    } else {
      setSelectedLogIds(new Set(logs.map((l) => l.id)));
    }
  };

  const handleBatchDeleteLogs = async () => {
    if (selectedLogIds.size === 0) return;
    const ids = Array.from(selectedLogIds);
    const res = await batchDeleteBalanceLogs(ids);
    if (res.code === 0) {
      const d = res.data as { success: number };
      toast.success(`删除成功 ${d.success} 条`);
      setSelectedLogIds(new Set());
      loadBillingData();
    } else {
      toast.error(res.msg || "批量删除失败");
    }
  };

  const userOptions = useMemo(() => {
    const opts = users.map((u: UserApiItem) => ({
      id: u.id,
      name: (u.name && u.name.trim()) || u.user || `#${u.id}`,
    }));

    opts.sort((a, b) => {
      if (a.name === "admin") return -1;
      if (b.name === "admin") return 1;

      return a.name.localeCompare(b.name, "zh-CN");
    });

    return opts;
  }, [users]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);
  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const activeRedeemCodes = redeemCodes.filter(
    (c) => c.isActive && !c.usedAt,
  ).length;
  const activeDiscountCodes = discountCodes.filter((c) => c.isActive).length;

  const handleCreateRedeem = async () => {
    const count = Math.floor(Number(redeemCount || 1));

    if (count < 1 || count > 500) {
      toast.error("数量 1-500");

      return;
    }
    const data: Record<string, unknown> = {
      type: redeemType,
      count,
      code: redeemCodeVal || undefined,
    };

    if (redeemType === "balance") {
      const amt = Math.round(parseFloat(redeemAmount || "0") * 100);

      if (amt <= 0) {
        toast.error("请输入有效金额");

        return;
      }
      data.amountCents = amt;
    } else if (redeemType === "plan") {
      if (!redeemPlanId) {
        toast.error("请选择商品");

        return;
      }
      data.planId = Number(redeemPlanId);
      if (redeemDuration) {
        const dur = Math.floor(Number(redeemDuration));

        if (dur > 0) data.durationDays = dur;
      }
    }
    if (redeemStartsAt) {
      const ts = parseDateText(redeemStartsAt);

      if (ts) data.startsAt = ts;
    }
    if (redeemExpiresAt) {
      const ts = parseDateText(redeemExpiresAt);

      if (ts) data.expiresAt = ts;
    }
    const res = await createRedeemCodes(data as any);

    if (res.code === 0) {
      toast.success(`已生成 ${res.data?.codes?.length || count} 个兑换码`);
      setRedeemCodeVal("");
      loadBillingData();
    } else {
      toast.error(res.msg || "生成失败");
    }
  };

  const handleDeleteRedeem = async (id: number) => {
    const res = await deleteRedeemCode(id);

    if (res.code === 0) {
      toast.success("已删除");
      loadBillingData();
    } else toast.error(res.msg || "删除失败");
  };

  const handleCreateDiscount = async () => {
    if (!dcCode.trim()) {
      toast.error("请填写折扣码");

      return;
    }
    const val = parseFloat(dcValue || "0");

    if (val <= 0) {
      toast.error("请输入有效值");

      return;
    }
    if (dcType === "percent" && val > 100) {
      toast.error("百分比不能超过 100");

      return;
    }
    const startsAt = parseDateText(dcStartsAt);
    const expiresAt = parseDateText(dcExpiresAt);

    if (expiresAt && startsAt && expiresAt <= startsAt) {
      toast.error("失效时间需晚于生效时间");

      return;
    }
    const res = await createDiscountCode({
      code: dcCode.trim(),
      type: dcType,
      value: val,
      maxUses: Math.max(0, Math.floor(Number(dcMaxUses || 0))),
      planIds: dcPlanIds,
      startsAt,
      expiresAt,
    });

    if (res.code === 0) {
      toast.success("折扣码已创建");
      setDcCode("");
      setDcValue("");
      setDcMaxUses("0");
      setDcStartsAt("");
      setDcExpiresAt("");
      setDcPlanIds([]);
      loadBillingData();
    } else {
      toast.error(res.msg || "创建失败");
    }
  };

  const handleDeleteDiscount = async (id: number) => {
    const res = await deleteDiscountCode(id);

    if (res.code === 0) {
      toast.success("已删除");
      loadBillingData();
    } else toast.error(res.msg || "删除失败");
  };

  const toggleFeature = async (
    key: "redemptionEnabled" | "discountEnabled",
    val: boolean,
  ) => {
    if (key === "redemptionEnabled") setRedemptionEnabled(val);
    else setDiscountEnabled(val);
    const res = await setBillingFeatureStatus({
      ...(key === "redemptionEnabled"
        ? { redemptionEnabled: val ? 1 : 0 }
        : {}),
      ...(key === "discountEnabled" ? { discountEnabled: val ? 1 : 0 } : {}),
    });

    if (res.code !== 0) {
      toast.error(res.msg || "操作失败");
      if (key === "redemptionEnabled") setRedemptionEnabled(!val);
      else setDiscountEnabled(!val);
    }
  };

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">支付 & 营销</h1>
      </div>

      {/* Main tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { key: "billing", label: "账单" },
          { key: "payment", label: "支付" },
          { key: "redeem", label: "兑换码" },
          { key: "discount", label: "折扣码" },
        ].map((tab) => (
          <Button
            key={tab.key}
            color={mainTabKey === tab.key ? "primary" : "default"}
            size="sm"
            variant={mainTabKey === tab.key ? "solid" : "flat"}
            onPress={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* ── Payment Channels ── */}
      {mainTabKey === "payment" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">支付状态</span>
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                    <svg
                      className="w-4 h-4 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p
                  className={`text-xl font-bold ${yipay.enabled || usdt.enabled ? "text-green-600" : "text-gray-400"}`}
                >
                  {yipay.enabled || usdt.enabled ? "已启用" : "未启用"}
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">已收金额</span>
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                      <path
                        clipRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-green-600">
                  {fmtMoney(stats.paidAmount)} 元
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">已支付订单</span>
                  <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                    <svg
                      className="w-4 h-4 text-emerald-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-emerald-600">
                  {stats.paidOrders}
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">待支付订单</span>
                  <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                    <svg
                      className="w-4 h-4 text-orange-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-orange-600">
                  {stats.pendingOrders}
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Sub tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { key: "usdt", label: "U支付" },
              { key: "yipay", label: "易支付" },
              { key: "test", label: "测试下单" },
            ].map((tab) => (
              <Button
                key={tab.key}
                color={paymentTabKey === tab.key ? "primary" : "default"}
                size="sm"
                variant={paymentTabKey === tab.key ? "solid" : "flat"}
                onPress={() => setPaymentTabKey(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {paymentTabKey === "yipay" && (
            <Card className="border border-gray-200 dark:border-default-200 shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h2 className="font-semibold text-foreground">易支付</h2>
                  <Switch
                    isSelected={yipay.enabled}
                    size="lg"
                    onValueChange={async (v) => {
                      setYipay((prev) => {
                        const updated = { ...prev, enabled: v };
                        const { enabled: _, key: k, ...rest } = updated;
                        const cfg: Record<string, unknown> = { ...rest };

                        if (k) cfg.key = k;
                        Network.post("/payment/config/save", {
                          channel: "YIPAY",
                          config: JSON.stringify(cfg),
                          enabled: v ? 1 : 0,
                        })
                          .then((res) => {
                            if (res?.code === 0) {
                              toast.success("设置成功");
                              loadPaymentData();
                            } else {
                              toast.error(res?.msg || "保存失败");
                            }
                          })
                          .catch(() => {
                            toast.error("保存失败");
                          });

                        return updated;
                      });
                    }}
                  />
                </div>
              </CardHeader>
              <CardBody className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      易支付网关
                    </label>
                    <Input
                      placeholder="https://pay.example.com"
                      value={yipay.gateway_url}
                      variant="bordered"
                      onChange={(e) =>
                        setYipay((p) => ({ ...p, gateway_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      商户 PID
                    </label>
                    <Input
                      placeholder="1000"
                      value={yipay.pid}
                      variant="bordered"
                      onChange={(e) =>
                        setYipay((p) => ({ ...p, pid: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      商户密钥
                    </label>
                    {yipay.key && !editingYiPayKey ? (
                      <div className="h-10 flex items-center gap-2 px-3 border border-default-200 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
                        <span className="truncate text-xs text-gray-600 dark:text-gray-400 font-mono">
                          {"\u2022".repeat(
                            Math.max(0, yipay.key.length - 6),
                          )}
                          {yipay.key.slice(-6)}
                        </span>
                        <Button
                          className="shrink-0 ml-auto"
                          size="sm"
                          variant="flat"
                          onPress={() => setEditingYiPayKey(true)}
                        >
                          修改
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          placeholder="留空不修改"
                          value={yipay.key}
                          variant="bordered"
                          onChange={(e) =>
                            setYipay((p) => ({
                              ...p,
                              key: e.target.value,
                            }))
                          }
                        />
                        {yipay.key && (
                          <Button
                            className="shrink-0"
                            size="sm"
                            variant="flat"
                            onPress={() => setEditingYiPayKey(false)}
                          >
                            取消
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      异步通知地址
                    </label>
                    <Input
                      placeholder={panelUrl + "/api/v1/payment/callback/yipay"}
                      value={yipay.notify_url}
                      variant="bordered"
                      onChange={(e) =>
                        setYipay((p) => ({ ...p, notify_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      同步跳转地址
                    </label>
                    <Input
                      placeholder={panelUrl + "/shop"}
                      value={yipay.return_url}
                      variant="bordered"
                      onChange={(e) =>
                        setYipay((p) => ({ ...p, return_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      签名模式
                    </label>
                    <Select
                      selectedKeys={[yipay.sign_mode]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string;
                        if (v) setYipay((p) => ({ ...p, sign_mode: v }));
                      }}
                    >
                      <SelectItem key="epay">标准易支付</SelectItem>
                      <SelectItem key="mpay">码支付 MPay</SelectItem>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        isSelected={yipay.enable_alipay}
                        size="sm"
                        onValueChange={async (v) => {
                          const updated = { ...yipay, enable_alipay: v };
                          setYipay(updated);
                          try {
                            const { enabled, key: k, ...rest } = updated;
                            const cfg: Record<string, unknown> = { ...rest };
                            if (k) cfg.key = k;
                            const res = await Network.post("/payment/config/save", {
                              channel: "YIPAY",
                              config: JSON.stringify(cfg),
                              enabled: enabled ? 1 : 0,
                            });
                            if (res?.code === 0) {
                              toast.success("设置成功");
                              loadPaymentData();
                            } else {
                              toast.error(res?.msg || "保存失败");
                            }
                          } catch {
                            toast.error("保存失败");
                          }
                        }}
                      />
                      <span className="text-sm text-gray-400">启用支付宝</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        isSelected={yipay.enable_wxpay}
                        size="sm"
                        onValueChange={async (v) => {
                          const updated = { ...yipay, enable_wxpay: v };
                          setYipay(updated);
                          try {
                            const { enabled, key: k, ...rest } = updated;
                            const cfg: Record<string, unknown> = { ...rest };
                            if (k) cfg.key = k;
                            const res = await Network.post("/payment/config/save", {
                              channel: "YIPAY",
                              config: JSON.stringify(cfg),
                              enabled: enabled ? 1 : 0,
                            });
                            if (res?.code === 0) {
                              toast.success("设置成功");
                              loadPaymentData();
                            } else {
                              toast.error(res?.msg || "保存失败");
                            }
                          } catch {
                            toast.error("保存失败");
                          }
                        }}
                      />
                      <span className="text-sm text-gray-400">启用微信</span>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    color="primary"
                    onPress={() => {
                      const { enabled, key: k, ...rest } = yipay;
                      const cfg: Record<string, unknown> = { ...rest };

                      if (k) cfg.key = k;
                      saveConfig("YIPAY", enabled, cfg);
                    }}
                  >
                    保存配置
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {paymentTabKey === "usdt" && (
            <Card className="border border-gray-200 dark:border-default-200 shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <h2 className="font-semibold text-foreground">USDT 支付</h2>
                  <Switch
                    isSelected={usdt.enabled}
                    size="lg"
                    onValueChange={async (v) => {
                      setUsdt((prev) => {
                        const updated = { ...prev, enabled: v };
                        const { enabled: _, secret_key: sk, ...rest } = updated;
                        const cfg: Record<string, unknown> = { ...rest };

                        if (sk) cfg.secret_key = sk;
                        Network.post("/payment/config/save", {
                          channel: "USDT",
                          config: JSON.stringify(cfg),
                          enabled: v ? 1 : 0,
                        })
                          .then((res) => {
                            if (res?.code === 0) {
                              toast.success("设置成功");
                              loadPaymentData();
                            } else {
                              toast.error(res?.msg || "保存失败");
                            }
                          })
                          .catch(() => {
                            toast.error("保存失败");
                          });

                        return updated;
                      });
                    }}
                  />
                </div>
              </CardHeader>
              <CardBody className="p-4 space-y-4">
                <div className="text-xs text-default-500">
                  对接自托管 Epusdt (GMPay) 支付网关。请先在 Epusdt
                  管理后台创建商户获取 PID 和密钥。
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      U 支付网关
                    </label>
                    <Input
                      placeholder="https://epusdt.example.com"
                      value={usdt.api_url}
                      variant="bordered"
                      onChange={(e) =>
                        setUsdt((p) => ({ ...p, api_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      U 支付商户 PID
                    </label>
                    <Input
                      placeholder="1000"
                      value={usdt.pid}
                      variant="bordered"
                      onChange={(e) =>
                        setUsdt((p) => ({ ...p, pid: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      U 支付商户密钥
                    </label>
                    {usdt.secret_key && !editingUsdtKey ? (
                      <div className="h-10 flex items-center gap-2 px-3 border border-default-200 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
                        <span className="truncate text-xs text-gray-600 dark:text-gray-400 font-mono">
                          {"\u2022".repeat(
                            Math.max(0, usdt.secret_key.length - 6),
                          )}
                          {usdt.secret_key.slice(-6)}
                        </span>
                        <Button
                          className="shrink-0 ml-auto"
                          size="sm"
                          variant="flat"
                          onPress={() => setEditingUsdtKey(true)}
                        >
                          修改
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          placeholder="留空不修改"
                          value={usdt.secret_key}
                          variant="bordered"
                          onChange={(e) =>
                            setUsdt((p) => ({
                              ...p,
                              secret_key: e.target.value,
                            }))
                          }
                        />
                        {usdt.secret_key && (
                          <Button
                            className="shrink-0"
                            size="sm"
                            variant="flat"
                            onPress={() => setEditingUsdtKey(false)}
                          >
                            取消
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      U 支付异步通知地址
                    </label>
                    <Input
                      placeholder={panelUrl + "/api/v1/payment/callback/usdt"}
                      value={usdt.notify_url}
                      variant="bordered"
                      onChange={(e) =>
                        setUsdt((p) => ({ ...p, notify_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 text-foreground mb-1 block">
                      U 支付同步跳转地址
                    </label>
                    <Input
                      placeholder="https://your-domain.com/shop"
                      value={usdt.return_url}
                      variant="bordered"
                      onChange={(e) =>
                        setUsdt((p) => ({ ...p, return_url: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      isSelected={usdt.enable_tron}
                      size="sm"
                      onValueChange={async (v) => {
                        const updated = { ...usdt, enable_tron: v };
                        setUsdt(updated);
                        try {
                          const { enabled, secret_key: sk, ...rest } = updated;
                          const cfg: Record<string, unknown> = { ...rest };
                          if (sk) cfg.secret_key = sk;
                          const res = await Network.post("/payment/config/save", {
                            channel: "USDT",
                            config: JSON.stringify(cfg),
                            enabled: enabled ? 1 : 0,
                          });
                          if (res?.code === 0) {
                            toast.success("设置成功");
                            loadPaymentData();
                          } else {
                            toast.error(res?.msg || "保存失败");
                          }
                        } catch {
                          toast.error("保存失败");
                        }
                      }}
                    />
                    <span className="text-sm text-gray-400">启用 TRC-20</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      isSelected={usdt.enable_polygon}
                      size="sm"
                      onValueChange={async (v) => {
                        const updated = { ...usdt, enable_polygon: v };
                        setUsdt(updated);
                        try {
                          const { enabled, secret_key: sk, ...rest } = updated;
                          const cfg: Record<string, unknown> = { ...rest };
                          if (sk) cfg.secret_key = sk;
                          const res = await Network.post("/payment/config/save", {
                            channel: "USDT",
                            config: JSON.stringify(cfg),
                            enabled: enabled ? 1 : 0,
                          });
                          if (res?.code === 0) {
                            toast.success("设置成功");
                            loadPaymentData();
                          } else {
                            toast.error(res?.msg || "保存失败");
                          }
                        } catch {
                          toast.error("保存失败");
                        }
                      }}
                    />
                    <span className="text-sm text-gray-400">启用 Polygon</span>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    color="primary"
                    onPress={async () => {
                      try {
                        const { enabled, secret_key: sk, ...rest } = usdt;
                        const cfg: Record<string, unknown> = { ...rest };

                        if (sk) cfg.secret_key = sk;
                        const res = await Network.post("/payment/config/save", {
                          channel: "USDT",
                          config: JSON.stringify(cfg),
                          enabled: enabled ? 1 : 0,
                        });

                        if (res?.code === 0) {
                          toast.success("保存成功");
                          loadPaymentData();
                        } else {
                          toast.error(res?.msg || "保存失败");
                        }
                      } catch {
                        toast.error("保存失败");
                      }
                    }}
                  >
                    保存配置
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {paymentTabKey === "test" && (
            <Card className="border border-gray-200 dark:border-default-200 shadow-md">
              <CardHeader>
                <h2 className="font-semibold text-foreground">测试下单</h2>
              </CardHeader>
              <CardBody className="p-4 space-y-4">
                <p className="text-sm text-gray-400">
                  创建一笔真实支付订单，检查支付接口配置是否正常。
                </p>
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="text-sm text-gray-400 mb-1 block text-foreground">
                      套餐
                    </label>
                    <Select
                      selectedKeys={testPackageId ? [testPackageId] : []}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string;

                        if (v) setTestPackageId(v);
                      }}
                    >
                      {packages
                        .filter((p) => p.enabled === 1)
                        .map((p) => (
                          <SelectItem key={String(p.id)}>
                            {(p.price / 100).toFixed(2)}元 {p.name}
                          </SelectItem>
                        ))}
                    </Select>
                  </div>
                  <div className="flex-1">
                    <label className="text-sm text-gray-400 mb-1 block text-foreground">
                      支付方式
                    </label>
                    <Select
                      selectedKeys={[testChannel]}
                      variant="bordered"
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string;

                        if (v) setTestChannel(v);
                      }}
                    >
                      <SelectItem key="YIPAY">易支付</SelectItem>
                      <SelectItem key="USDT">USDT</SelectItem>
                    </Select>
                  </div>
                  <Button
                    color="primary"
                    isLoading={testLoading}
                    onPress={handleTestOrder}
                  >
                    创建订单
                  </Button>
                </div>
                {createdPayUrl && (
                  <div className="rounded-lg border bg-gray-50 dark:bg-gray-900 p-3">
                    <div className="text-xs text-gray-400 text-foreground mb-1">
                      支付链接
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate text-xs">
                        {createdPayUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => window.open(createdPayUrl, "_blank")}
                      >
                        打开
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => {
                          navigator.clipboard.writeText(createdPayUrl);
                          toast.success("已复制");
                        }}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* ── 账单流水 ── */}
      {mainTabKey === "billing" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 mb-6">
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">余额流水</span>
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                      <path
                        clipRule="evenodd"
                        d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">{logTotal}</p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">可用兑换码</span>
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                    <svg
                      className="w-4 h-4 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeRedeemCodes}
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">生效折扣码</span>
                  <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                    <svg
                      className="w-4 h-4 text-orange-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.707.293l3 3a1 1 0 010 1.414l-3 3A1 1 0 0111 9V8h-2a1 1 0 010-2h2V5a1 1 0 011-1zm-4 8a1 1 0 011.707.707l3 3a1 1 0 01-1.414 1.414L10 12.414V15a1 1 0 11-2 0v-2H6a1 1 0 110-2h2V9a1 1 0 011-1z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeDiscountCodes}
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-default-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path
                  clipRule="evenodd"
                  d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                  fillRule="evenodd"
                />
              </svg>
              <h2 className="font-semibold text-foreground">余额流水</h2>
            </div>
            <div className="flex items-center gap-2">
              <Select
                className="w-24"
                selectedKeys={logUserId === "all" ? ["all"] : [logUserId]}
                size="sm"
                variant="bordered"
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;

                  setLogUserId(val || "all");
                  localStorage.setItem(
                    "adminPaymentLogUserFilter",
                    val || "all",
                  );
                  setLogPage(1);
                }}
              >
                <SelectItem key="all">全部用户</SelectItem>
                {userOptions.map((u) => (
                  <SelectItem key={String(u.id)}>{u.name}</SelectItem>
                ))}
              </Select>
              <Button
                className="h-8 text-xs px-2"
                color="danger"
                variant="flat"
                onPress={handleCleanupLogs}
              >
                删脏数据
              </Button>
            </div>
          </div>
          {selectedLogIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-default-500 mr-1">已选 {selectedLogIds.size} 项</span>
              <Button color="danger" size="sm" variant="flat" onPress={handleBatchDeleteLogs}>
                批量删除
              </Button>
            </div>
          )}
          <div className="relative overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
            <Table
              classNames={{
                th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap w-10">
                  <input
                    checked={logs.length > 0 && selectedLogIds.size === logs.length}
                    className="cursor-pointer"
                    type="checkbox"
                    onChange={toggleSelectAllLogs}
                  />
                </TableColumn>
                <TableColumn className="whitespace-nowrap">用户</TableColumn>
                <TableColumn className="whitespace-nowrap">金额</TableColumn>
                <TableColumn className="whitespace-nowrap">变动前</TableColumn>
                <TableColumn className="whitespace-nowrap">变动后</TableColumn>
                <TableColumn className="whitespace-nowrap">原因</TableColumn>
                <TableColumn className="whitespace-nowrap">时间</TableColumn>
                <TableColumn className="whitespace-nowrap">操作</TableColumn>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="text-center text-default-400 py-8"
                      colSpan={8}
                    >
                      暂无记录
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        <input
                          checked={selectedLogIds.has(log.id)}
                          className="cursor-pointer"
                          type="checkbox"
                          onChange={() => toggleSelectLogId(log.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.userName}
                      </TableCell>
                      <TableCell
                        className={
                          log.amount >= 0
                            ? "text-green-600 font-mono whitespace-nowrap"
                            : "text-red-500 font-mono whitespace-nowrap"
                        }
                      >
                        {log.amount >= 0 ? "+" : ""}
                        {fmtMoney(log.amount)} 元
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {fmtMoney(log.balanceBefore)} 元
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {fmtMoney(log.balanceAfter)} 元
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.reason}
                      </TableCell>
                      <TableCell className="text-sm text-default-600 whitespace-nowrap">
                        {fmtTime(log.createdTime)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPress={() => handleDeleteLog(log)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {logTotal > 50 && (
              <div className="flex items-center justify-between p-4 border-t border-divider">
                <span className="text-sm text-default-500">
                  共 {logTotal} 条
                </span>
                <div className="flex gap-2">
                  <Button
                    isDisabled={logPage <= 1}
                    size="sm"
                    variant="flat"
                    onPress={() => setLogPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    isDisabled={logPage * 50 >= logTotal}
                    size="sm"
                    variant="flat"
                    onPress={() => setLogPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Redeem ── */}
      {mainTabKey === "redeem" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 mb-6">
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">余额流水</span>
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                      <path
                        clipRule="evenodd"
                        d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">{logTotal}</p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">可用兑换码</span>
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                    <svg
                      className="w-4 h-4 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeRedeemCodes}
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">生效折扣码</span>
                  <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                    <svg
                      className="w-4 h-4 text-orange-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.707.293l3 3a1 1 0 010 1.414l-3 3A1 1 0 0111 9V8h-2a1 1 0 010-2h2V5a1 1 0 011-1zm-4 8a1 1 0 011.707.707l3 3a1 1 0 01-1.414 1.414L10 12.414V15a1 1 0 11-2 0v-2H6a1 1 0 110-2h2V9a1 1 0 011-1z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeDiscountCodes}
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-default-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              <h2 className="font-semibold text-foreground">兑换码</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-default-500">兑换</span>
              <Switch
                isSelected={redemptionEnabled}
                size="sm"
                onValueChange={(v) => toggleFeature("redemptionEnabled", v)}
              />
            </div>
          </div>

          <Card className="mb-4">
            <CardHeader>
              <h2 className="font-medium">生成兑换码</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Row 1: 兑换码(50%) + 生效时间(25%) + 失效时间(25%) */}
                <div className="lg:col-span-2 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    兑换码
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="留空自动生成"
                      value={redeemCodeVal}
                      variant="bordered"
                      onChange={(e) =>
                        setRedeemCodeVal(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, "")
                            .slice(0, 64),
                        )
                      }
                    />
                    <Button
                      className="h-10 shrink-0"
                      variant="bordered"
                      onPress={() => setRedeemCodeVal(randomCode())}
                    >
                      随机
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400">
                    随机码为 6-10 位大写字母和数字
                  </p>
                </div>
                <div className="col-span-1 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    生效时间
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="例：20281001"
                      value={redeemStartsAt}
                      variant="bordered"
                      onChange={(e) => setRedeemStartsAt(e.target.value)}
                    />
                    <Dropdown>
                      <DropdownTrigger>
                        <Button className="h-10 shrink-0" variant="bordered">
                          快捷
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 1);
                            setRedeemStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 3);
                            setRedeemStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          3 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 6);
                            setRedeemStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          6 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setFullYear(d.getFullYear() + 1);
                            setRedeemStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 年后
                        </DropdownItem>
                        <DropdownItem onPress={() => setRedeemStartsAt("")}>
                          永久
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                </div>
                <div className="col-span-1 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    失效时间
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="例：20281231"
                      value={redeemExpiresAt}
                      variant="bordered"
                      onChange={(e) => setRedeemExpiresAt(e.target.value)}
                    />
                    <Dropdown>
                      <DropdownTrigger>
                        <Button className="h-10 shrink-0" variant="bordered">
                          快捷
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 1);
                            setRedeemExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 3);
                            setRedeemExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          3 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 6);
                            setRedeemExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          6 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setFullYear(d.getFullYear() + 1);
                            setRedeemExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 年后
                        </DropdownItem>
                        <DropdownItem onPress={() => setRedeemExpiresAt("")}>
                          永久
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                </div>
                <div className="col-span-full h-0" />

                {/* Row 2: 数量 + 类型 + 套餐 + 期限 (各25%) */}
                <div className="col-span-1 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    数量
                  </label>
                  <Input
                    className="h-10"
                    max="500"
                    min="1"
                    type="number"
                    value={redeemCount}
                    variant="bordered"
                    onChange={(e) => setRedeemCount(e.target.value)}
                  />
                </div>
                <div className="col-span-1 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    类型
                  </label>
                  <Select
                    classNames={{
                      trigger: "h-10 bg-default-50 border-default-200",
                      value: "text-sm",
                    }}
                    selectedKeys={[redeemType]}
                    variant="bordered"
                    onSelectionChange={(keys) => {
                      const v = Array.from(keys)[0];

                      if (v === "plan" || v === "balance") setRedeemType(v);
                    }}
                  >
                    <SelectItem key="plan">套餐期限</SelectItem>
                    <SelectItem key="balance">余额</SelectItem>
                  </Select>
                </div>
                {redeemType === "plan" ? (
                  <>
                    <div className="col-span-1 space-y-2">
                      <label className="text-sm text-gray-400 text-foreground">
                        套餐
                      </label>
                      <Select
                        classNames={{
                          trigger: "h-10 bg-default-50 border-default-200",
                          value: "text-sm",
                        }}
                        selectedKeys={redeemPlanId ? [redeemPlanId] : []}
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const v = Array.from(keys)[0] as string;

                          if (v) setRedeemPlanId(v);
                        }}
                      >
                        {packages
                          .filter((p) => p.enabled === 1)
                          .map((p) => (
                            <SelectItem key={String(p.id)}>{p.name}</SelectItem>
                          ))}
                      </Select>
                    </div>
                    <div className="col-span-1 space-y-2">
                      <label className="text-sm text-gray-400 text-foreground">
                        期限
                      </label>
                      <Select
                        classNames={{
                          trigger: "h-10 bg-default-50 border-default-200",
                          value: "text-sm",
                        }}
                        selectedKeys={redeemDuration ? [redeemDuration] : []}
                        variant="bordered"
                        onSelectionChange={(keys) => {
                          const v = Array.from(keys)[0] as string;

                          if (v) setRedeemDuration(v);
                        }}
                      >
                        <SelectItem key="30">1 个月</SelectItem>
                        <SelectItem key="90">3 个月</SelectItem>
                        <SelectItem key="180">6 个月</SelectItem>
                        <SelectItem key="365">1 年</SelectItem>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div className="col-span-2 space-y-2">
                    <label className="text-sm text-gray-400 text-foreground">
                      余额金额
                    </label>
                    <Input
                      className="h-10"
                      min="0.01"
                      step="0.01"
                      type="number"
                      value={redeemAmount}
                      variant="bordered"
                      onChange={(e) => setRedeemAmount(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <Button
                className="h-10"
                color="primary"
                variant="solid"
                onPress={handleCreateRedeem}
              >
                生成兑换码
              </Button>
            </CardBody>
          </Card>

          <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
            <Table
              classNames={{
                th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn className="whitespace-nowrap">兑换码</TableColumn>
                <TableColumn className="whitespace-nowrap">类型</TableColumn>
                <TableColumn className="whitespace-nowrap">内容</TableColumn>
                <TableColumn className="whitespace-nowrap">有效期</TableColumn>
                <TableColumn className="whitespace-nowrap">
                  使用情况
                </TableColumn>
                <TableColumn className="whitespace-nowrap">操作</TableColumn>
              </TableHeader>
              <TableBody>
                {redeemCodes.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="text-center text-default-400 py-8"
                      colSpan={6}
                    >
                      暂无兑换码
                    </TableCell>
                  </TableRow>
                ) : (
                  redeemCodes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {c.code}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Chip size="sm" variant="flat">
                          {c.type === "plan" ? "套餐" : "余额"}
                        </Chip>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.type === "balance"
                          ? `${fmtMoney(c.amountCents || 0)} 元`
                          : `套餐 #${c.planId || "-"} ${c.durationDays || ""}天`}
                      </TableCell>
                      <TableCell className="text-xs text-default-600 whitespace-nowrap">
                        {fmtTime(c.startsAt)} ~ {fmtTime(c.expiresAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.usedAt ? (
                          <span className="text-xs text-default-500">
                            已使用 {c.usedByUsername || `#${c.usedByUserId}`}
                          </span>
                        ) : (
                          <Chip color="success" size="sm" variant="flat">
                            未使用
                          </Chip>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPress={() => handleDeleteRedeem(c.id)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* ─ Discount ── */}
      {mainTabKey === "discount" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 mb-6">
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">余额流水</span>
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                    <svg
                      className="w-4 h-4 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                      <path
                        clipRule="evenodd"
                        d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">{logTotal}</p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">可用兑换码</span>
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-500/20">
                    <svg
                      className="w-4 h-4 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeRedeemCodes}
                </p>
              </CardBody>
            </Card>
            <Card className="border border-gray-200 dark:border-default-200 shadow-md hover:shadow-lg transition-shadow">
              <CardBody className="p-3 lg:p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-default-500">生效折扣码</span>
                  <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                    <svg
                      className="w-4 h-4 text-orange-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        clipRule="evenodd"
                        d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.707.293l3 3a1 1 0 010 1.414l-3 3A1 1 0 0111 9V8h-2a1 1 0 010-2h2V5a1 1 0 011-1zm-4 8a1 1 0 011.707.707l3 3a1 1 0 01-1.414 1.414L10 12.414V15a1 1 0 11-2 0v-2H6a1 1 0 110-2h2V9a1 1 0 011-1z"
                        fillRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground">
                  {activeDiscountCodes}
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-default-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  clipRule="evenodd"
                  d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm7-10a1 1 0 01.707.293l3 3a1 1 0 010 1.414l-3 3A1 1 0 0111 9V8h-2a1 1 0 010-2h2V5a1 1 0 011-1zm-4 8a1 1 0 011.707.707l3 3a1 1 0 01-1.414 1.414L10 12.414V15a1 1 0 11-2 0v-2H6a1 1 0 110-2h2V9a1 1 0 011-1z"
                  fillRule="evenodd"
                />
              </svg>
              <h2 className="font-semibold text-foreground">折扣码</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-default-500">折扣</span>
              <Switch
                isSelected={discountEnabled}
                size="sm"
                onValueChange={(v) => toggleFeature("discountEnabled", v)}
              />
            </div>
          </div>

          <Card className="mb-4">
            <CardHeader>
              <h2 className="font-medium">新增折扣码</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                {/* Row 1 */}
                <div className="lg:col-span-3 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    折扣码
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="例如 SALE2026"
                      value={dcCode}
                      variant="bordered"
                      onChange={(e) =>
                        setDcCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, "")
                            .slice(0, 64),
                        )
                      }
                    />
                    <Button
                      className="h-10 shrink-0"
                      variant="bordered"
                      onPress={() => setDcCode(randomCode())}
                    >
                      随机
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    类型
                  </label>
                  <Select
                    classNames={{
                      trigger: "h-10 bg-default-50 border-default-200",
                      value: "text-sm",
                    }}
                    selectedKeys={[dcType]}
                    variant="bordered"
                    onSelectionChange={(keys) => {
                      const v = Array.from(keys)[0];

                      if (v === "percent" || v === "amount") setDcType(v);
                    }}
                  >
                    <SelectItem key="percent">百分比</SelectItem>
                    <SelectItem key="amount">固定金额</SelectItem>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    {dcType === "percent" ? "百分比" : "金额"}
                  </label>
                  <Input
                    className="h-10"
                    min="0"
                    step={dcType === "percent" ? "1" : "0.01"}
                    type="number"
                    value={dcValue}
                    variant="bordered"
                    onChange={(e) => setDcValue(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    可用次数
                  </label>
                  <Input
                    className="h-10"
                    min="0"
                    placeholder="0=不限"
                    type="number"
                    value={dcMaxUses}
                    variant="bordered"
                    onChange={(e) => setDcMaxUses(e.target.value)}
                  />
                </div>

                {/* Row 2 */}
                <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    生效时间
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="例：20281001"
                      value={dcStartsAt}
                      variant="bordered"
                      onChange={(e) => setDcStartsAt(e.target.value)}
                    />
                    <Dropdown>
                      <DropdownTrigger>
                        <Button className="h-10 shrink-0" variant="bordered">
                          快捷
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 1);
                            setDcStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 3);
                            setDcStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          3 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 6);
                            setDcStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          6 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setFullYear(d.getFullYear() + 1);
                            setDcStartsAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 年后
                        </DropdownItem>
                        <DropdownItem onPress={() => setDcStartsAt("")}>
                          永久
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                  <p className="text-xs text-gray-400">留空表示永久有效</p>
                </div>
                <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                  <label className="text-sm text-gray-400 text-foreground">
                    失效时间
                  </label>
                  <div className="flex gap-2">
                    <Input
                      className="flex-1 h-10"
                      placeholder="例：20281231"
                      value={dcExpiresAt}
                      variant="bordered"
                      onChange={(e) => setDcExpiresAt(e.target.value)}
                    />
                    <Dropdown>
                      <DropdownTrigger>
                        <Button className="h-10 shrink-0" variant="bordered">
                          快捷
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 1);
                            setDcExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 3);
                            setDcExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          3 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setMonth(d.getMonth() + 6);
                            setDcExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          6 月后
                        </DropdownItem>
                        <DropdownItem
                          onPress={() => {
                            const d = new Date();

                            d.setFullYear(d.getFullYear() + 1);
                            setDcExpiresAt(
                              `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
                            );
                          }}
                        >
                          1 年后
                        </DropdownItem>
                        <DropdownItem onPress={() => setDcExpiresAt("")}>
                          永久
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                  <p className="text-xs text-gray-400">留空表示永久有效</p>
                </div>
              </div>
              <Button
                className="h-10"
                color="primary"
                variant="solid"
                onPress={handleCreateDiscount}
              >
                生成折扣码
              </Button>
            </CardBody>
          </Card>

          <div className="overflow-x-auto rounded-xl border border-divider bg-content1 shadow-md">
            <Table
              classNames={{
                th: "bg-default-100/50 text-default-600 text-foreground font-semibold text-sm border-b border-divider py-3 uppercase tracking-wider text-left align-middle",
                td: "py-3 border-b border-divider/50 group-data-[last=true]:border-b-0",
                tr: "hover:bg-default-50/50 transition-colors",
              }}
            >
              <TableHeader>
                <TableColumn>折扣码</TableColumn>
                <TableColumn>优惠</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn>次数</TableColumn>
                <TableColumn>有效期</TableColumn>
                <TableColumn>操作</TableColumn>
              </TableHeader>
              <TableBody>
                {discountCodes.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="text-center text-default-400 py-8"
                      colSpan={6}
                    >
                      暂无折扣码
                    </TableCell>
                  </TableRow>
                ) : (
                  discountCodes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {c.code}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.type === "percent"
                          ? `${c.value}%`
                          : `${fmtMoney(c.value)} 元`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Chip
                          color={c.isActive ? "success" : "default"}
                          size="sm"
                          variant="flat"
                        >
                          {c.isActive ? "生效中" : "停用"}
                        </Chip>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {c.usedCount} / {c.maxUses || "不限"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtTime(c.startsAt)} ~ {fmtTime(c.expiresAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPress={() => handleDeleteDiscount(c.id)}
                        >
                          删除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Modal
        isOpen={deleteLogConfirmOpen}
        placement="center"
        size="sm"
        onOpenChange={(open) => {
          if (!open) {
            setDeleteLogConfirmOpen(false);
            setDeleteLogTarget(null);
          }
        }}
      >
        <ModalContent>
          <ModalHeader className="text-danger flex items-center gap-2">
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            确认删除
          </ModalHeader>
          <ModalBody>
            <div className="text-sm text-default-600 space-y-2">
              <p>删除流水后不可恢复，用户的余额不会自动变动。</p>
              {deleteLogTarget && (
                <p className="text-xs text-default-400">
                  #{deleteLogTarget.id} | 用户: {deleteLogTarget.userName} |{" "}
                  {deleteLogTarget.reason}
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => {
                setDeleteLogConfirmOpen(false);
                setDeleteLogTarget(null);
              }}
            >
              取消
            </Button>
            <Button color="danger" onPress={handleConfirmDeleteLog}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={cleanupConfirmOpen}
        placement="center"
        size="sm"
        onOpenChange={(open) => {
          if (!open) setCleanupConfirmOpen(false);
        }}
      >
        <ModalContent>
          <ModalHeader className="text-danger flex items-center gap-2">
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            确认清理
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-600">
              将删除所有签名无效（signature=0）的余额流水记录。此操作不会自动调整用户余额，清理后建议手动核对。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setCleanupConfirmOpen(false)}>
              取消
            </Button>
            <Button color="danger" onPress={handleConfirmCleanup}>
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </AnimatedPage>
  );
}
