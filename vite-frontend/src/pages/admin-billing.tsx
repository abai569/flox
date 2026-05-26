import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";

import { AnimatedPage } from "@/components/animated-page";
import { Button } from "@/shadcn-bridge/heroui/button";
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
import { PageLoadingState } from "@/components/page-state";
import {
  getBalanceLogs,
  getRedeemCodes,
  createRedeemCodes,
  deleteRedeemCode,
  getDiscountCodes,
  createDiscountCode,
  deleteDiscountCode,
  getBillingFeatureStatus,
  setBillingFeatureStatus,
} from "@/api";
import type { BalanceLogItem, RedeemCodeItem, DiscountCodeItem } from "@/api/types";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  const len = 6 + Math.floor(Math.random() * 5);
  return Array.from({ length: len }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

function fmtMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function fmtTime(ts?: number | null) {
	if (!ts) return "-";
	return new Date(ts).toLocaleString();
}

export default function AdminBillingPage() {
	const [loading, setLoading] = useState(true);
	const [tabKey, setTabKey] = useState("balance");

  // Feature toggles
  const [redemptionEnabled, setRedemptionEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(true);

  // Balance logs
  const [logs, setLogs] = useState<BalanceLogItem[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logUserId, setLogUserId] = useState("");

  // Redeem codes
  const [redeemCodes, setRedeemCodes] = useState<RedeemCodeItem[]>([]);
  const [redeemType, setRedeemType] = useState<"plan" | "balance">("balance");
  const [redeemCodeVal, setRedeemCodeVal] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemCount, setRedeemCount] = useState("1");

  // Discount codes
  const [discountCodes, setDiscountCodes] = useState<DiscountCodeItem[]>([]);
  const [dcCode, setDcCode] = useState("");
  const [dcType, setDcType] = useState<"percent" | "amount">("percent");
  const [dcValue, setDcValue] = useState("");
  const [dcMaxUses, setDcMaxUses] = useState("0");
  const [dcPlanIds, setDcPlanIds] = useState<number[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, redeemRes, discountRes, featureRes] = await Promise.all([
        getBalanceLogs({ page: logPage, size: 50, userId: logUserId ? Number(logUserId) : undefined }),
        getRedeemCodes(),
        getDiscountCodes(),
        getBillingFeatureStatus(),
      ]);
      if (logRes.code === 0) { setLogs(logRes.data?.list || []); setLogTotal(logRes.data?.total || 0); }
      if (redeemRes.code === 0) setRedeemCodes(Array.isArray(redeemRes.data) ? redeemRes.data : []);
      if (discountRes.code === 0) setDiscountCodes(Array.isArray(discountRes.data) ? discountRes.data : []);
      if (featureRes.code === 0) {
        setRedemptionEnabled(!!featureRes.data?.redemptionEnabled);
        setDiscountEnabled(!!featureRes.data?.discountEnabled);
      }
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [logPage, logUserId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const activeRedeemCodes = redeemCodes.filter((c) => c.isActive && !c.usedAt).length;
  const activeDiscountCodes = discountCodes.filter((c) => c.isActive).length;

  const handleCreateRedeem = async () => {
    const count = Math.floor(Number(redeemCount || 1));
    if (count < 1 || count > 500) { toast.error("数量 1-500"); return; }
    const data: Record<string, unknown> = {
      type: redeemType,
      count,
      code: redeemCodeVal || undefined,
    };
    if (redeemType === "balance") {
      const amt = Math.round(parseFloat(redeemAmount || "0") * 100);
      if (amt <= 0) { toast.error("请输入有效金额"); return; }
      data.amountCents = amt;
    }
    const res = await createRedeemCodes(data as any);
    if (res.code === 0) {
      toast.success(`已生成 ${res.data?.codes?.length || count} 个兑换码`);
      setRedeemCodeVal("");
      loadAll();
    } else {
      toast.error(res.msg || "生成失败");
    }
  };

  const handleDeleteRedeem = async (id: number) => {
    const res = await deleteRedeemCode(id);
    if (res.code === 0) { toast.success("已删除"); loadAll(); }
    else toast.error(res.msg || "删除失败");
  };

  const handleCreateDiscount = async () => {
    if (!dcCode.trim()) { toast.error("请填写折扣码"); return; }
    const val = parseFloat(dcValue || "0");
    if (val <= 0) { toast.error("请输入有效值"); return; }
    if (dcType === "percent" && val > 100) { toast.error("百分比不能超过100"); return; }
    const res = await createDiscountCode({
      code: dcCode.trim(),
      type: dcType,
      value: val,
      maxUses: Math.max(0, Math.floor(Number(dcMaxUses || 0))),
      planIds: dcPlanIds,
    });
    if (res.code === 0) {
      toast.success("折扣码已创建");
      setDcCode(""); setDcValue(""); setDcMaxUses("0"); setDcPlanIds([]);
      loadAll();
    } else {
      toast.error(res.msg || "创建失败");
    }
  };

  const handleDeleteDiscount = async (id: number) => {
    const res = await deleteDiscountCode(id);
    if (res.code === 0) { toast.success("已删除"); loadAll(); }
    else toast.error(res.msg || "删除失败");
  };

  const toggleFeature = async (key: "redemptionEnabled" | "discountEnabled", val: boolean) => {
    if (key === "redemptionEnabled") setRedemptionEnabled(val);
    else setDiscountEnabled(val);
    const res = await setBillingFeatureStatus({
      ...(key === "redemptionEnabled" ? { redemptionEnabled: val ? 1 : 0 } : {}),
      ...(key === "discountEnabled" ? { discountEnabled: val ? 1 : 0 } : {}),
    });
    if (res.code !== 0) {
      toast.error(res.msg || "操作失败");
      if (key === "redemptionEnabled") setRedemptionEnabled(!val);
      else setDiscountEnabled(!val);
    }
  };

  if (loading) return <PageLoadingState message="加载账单数据..." />;

  return (
    <AnimatedPage className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">账单与营销</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">余额流水</div>
            <div className="text-2xl font-semibold">{logTotal}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">可用兑换码</div>
            <div className="text-2xl font-semibold">{activeRedeemCodes}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">生效折扣码</div>
            <div className="text-2xl font-semibold">{activeDiscountCodes}</div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">兑换入口</div>
            <div className="flex items-center justify-between mt-1">
              <span className={redemptionEnabled ? "text-green-600 font-medium" : "text-gray-400"}>{redemptionEnabled ? "已开启" : "已关闭"}</span>
              <Switch isSelected={redemptionEnabled} onValueChange={(v) => toggleFeature("redemptionEnabled", v)} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-4">
            <div className="text-sm text-gray-400 mb-1">折扣入口</div>
            <div className="flex items-center justify-between mt-1">
              <span className={discountEnabled ? "text-green-600 font-medium" : "text-gray-400"}>{discountEnabled ? "已开启" : "已关闭"}</span>
              <Switch isSelected={discountEnabled} onValueChange={(v) => toggleFeature("discountEnabled", v)} />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {["balance", "redeem", "discount"].map((key) => {
          const labels: Record<string, string> = { balance: "余额流水", redeem: "兑换码", discount: "折扣码" };
          return (
            <Button key={key} size="sm" variant={tabKey === key ? "solid" : "flat"} color={tabKey === key ? "primary" : "default"} onPress={() => setTabKey(key)}>
              {labels[key]}
            </Button>
          );
        })}
      </div>

      {tabKey === "balance" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <h2 className="font-medium">余额流水</h2>
              <div className="flex items-center gap-2 w-48">
                <label className="text-xs text-gray-400 whitespace-nowrap">用户ID</label>
                <input className="w-full p-1.5 border rounded text-sm bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                  placeholder="留空全部" value={logUserId} onChange={(e) => { setLogUserId(e.target.value); setLogPage(1); }} />
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <Table>
              <TableHeader>
                <TableColumn>用户</TableColumn>
                <TableColumn>金额</TableColumn>
                <TableColumn>变动前</TableColumn>
                <TableColumn>变动后</TableColumn>
                <TableColumn>原因</TableColumn>
                <TableColumn>时间</TableColumn>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">暂无记录</TableCell></TableRow>
                ) : logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.userName}</TableCell>
                    <TableCell className={log.amount >= 0 ? "text-green-600 font-mono" : "text-red-500 font-mono"}>
                      {log.amount >= 0 ? "+" : ""}{fmtMoney(log.amount)} 元
                    </TableCell>
                    <TableCell className="font-mono">{fmtMoney(log.balanceBefore)} 元</TableCell>
                    <TableCell className="font-mono">{fmtMoney(log.balanceAfter)} 元</TableCell>
                    <TableCell>{log.reason}</TableCell>
                    <TableCell>{fmtTime(log.createdTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {logTotal > 50 && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-sm text-gray-400">共 {logTotal} 条</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="flat" isDisabled={logPage <= 1} onPress={() => setLogPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <Button size="sm" variant="flat" isDisabled={logPage * 50 >= logTotal} onPress={() => setLogPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tabKey === "redeem" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><h2 className="font-medium">生成兑换码</h2></CardHeader>
            <CardBody className="space-y-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm text-gray-400 mb-1 block">兑换码</label>
                  <div className="flex gap-2">
                    <input className="flex-1 p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700" value={redeemCodeVal}
                      onChange={(e) => setRedeemCodeVal(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64))}
                      placeholder="留空自动生成" />
                    <Button size="sm" variant="flat" onPress={() => setRedeemCodeVal(randomCode())}>随机</Button>
                  </div>
                </div>
                <div className="w-36">
                  <label className="text-sm text-gray-400 mb-1 block">类型</label>
                  <Select variant="bordered" selectedKeys={[redeemType]}
                    onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v === "plan" || v === "balance") setRedeemType(v); }}>
                    <SelectItem key="balance">余额</SelectItem>
                    <SelectItem key="plan">套餐</SelectItem>
                  </Select>
                </div>
                {redeemType === "balance" && (
                  <div className="w-36">
                    <label className="text-sm text-gray-400 mb-1 block">金额</label>
                    <input type="number" step="0.01" min="0.01" className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                      value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} />
                  </div>
                )}
                <div className="w-24">
                  <label className="text-sm text-gray-400 mb-1 block">数量</label>
                  <input type="number" min="1" max="500" className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    value={redeemCount} onChange={(e) => setRedeemCount(e.target.value)} />
                </div>
                <Button color="primary" onPress={handleCreateRedeem}>生成</Button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><h2 className="font-medium">兑换码列表</h2></CardHeader>
            <CardBody>
              <Table>
                <TableHeader>
                  <TableColumn>兑换码</TableColumn>
                  <TableColumn>类型</TableColumn>
                  <TableColumn>内容</TableColumn>
                  <TableColumn>有效期</TableColumn>
                  <TableColumn>使用情况</TableColumn>
                  <TableColumn>操作</TableColumn>
                </TableHeader>
                <TableBody>
                  {redeemCodes.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">暂无兑换码</TableCell></TableRow>
                  ) : redeemCodes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.code}</TableCell>
                      <TableCell><Chip size="sm" variant="flat">{c.type === "plan" ? "套餐" : "余额"}</Chip></TableCell>
                      <TableCell>
                        {c.type === "balance" ? `${fmtMoney(c.amountCents || 0)} 元` : `套餐 #${c.planId || "-"} ${c.durationDays || ""}天`}
                      </TableCell>
                      <TableCell className="text-xs">{fmtTime(c.startsAt)} ~ {fmtTime(c.expiresAt)}</TableCell>
                      <TableCell>
                        {c.usedAt ? <span className="text-xs text-gray-400">已使用 {c.usedByUsername || `#${c.usedByUserId}`}</span> :
                          <Chip size="sm" color="success" variant="flat">未使用</Chip>}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" color="danger" variant="flat" onPress={() => handleDeleteRedeem(c.id)}>删除</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}

      {tabKey === "discount" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><h2 className="font-medium">新增折扣码</h2></CardHeader>
            <CardBody className="space-y-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm text-gray-400 mb-1 block">折扣码</label>
                  <div className="flex gap-2">
                    <input className="flex-1 p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700" value={dcCode}
                      onChange={(e) => setDcCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 64))}
                      placeholder="例如 SALE2026" />
                    <Button size="sm" variant="flat" onPress={() => setDcCode(randomCode())}>随机</Button>
                  </div>
                </div>
                <div className="w-32">
                  <label className="text-sm text-gray-400 mb-1 block">类型</label>
                  <Select variant="bordered" selectedKeys={[dcType]}
                    onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v === "percent" || v === "amount") setDcType(v); }}>
                    <SelectItem key="percent">百分比</SelectItem>
                    <SelectItem key="amount">固定金额</SelectItem>
                  </Select>
                </div>
                <div className="w-36">
                  <label className="text-sm text-gray-400 mb-1 block">{dcType === "percent" ? "百分比" : "金额"}</label>
                  <input type="number" min="0" step={dcType === "percent" ? "1" : "0.01"} className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    value={dcValue} onChange={(e) => setDcValue(e.target.value)} />
                </div>
                <div className="w-24">
                  <label className="text-sm text-gray-400 mb-1 block">可用次数</label>
                  <input type="number" min="0" className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700"
                    value={dcMaxUses} onChange={(e) => setDcMaxUses(e.target.value)} />
                </div>
                <Button color="primary" onPress={handleCreateDiscount}>创建</Button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><h2 className="font-medium">折扣码列表</h2></CardHeader>
            <CardBody>
              <Table>
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
                    <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-8">暂无折扣码</TableCell></TableRow>
                  ) : discountCodes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.code}</TableCell>
                      <TableCell>{c.type === "percent" ? `${c.value}%` : `${fmtMoney(c.value)} 元`}</TableCell>
                      <TableCell>
                        <Chip size="sm" color={c.isActive ? "success" : "default"} variant="flat">
                          {c.isActive ? "生效中" : "停用"}
                        </Chip>
                      </TableCell>
                      <TableCell>{c.usedCount} / {c.maxUses || "不限"}</TableCell>
                      <TableCell className="text-xs">{fmtTime(c.startsAt)} ~ {fmtTime(c.expiresAt)}</TableCell>
                      <TableCell>
                        <Button size="sm" color="danger" variant="flat" onPress={() => handleDeleteDiscount(c.id)}>删除</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}
    </AnimatedPage>
  );
}
