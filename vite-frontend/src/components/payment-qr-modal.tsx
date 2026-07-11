import type { PayOrderResult } from "@/api/types";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "@/lib/qrcode-react";
import { X } from "lucide-react";

import { Modal, ModalContent } from "@/shadcn-bridge/heroui/modal";

interface PaymentQRModalProps {
  isOpen: boolean;
  currency: string;
  result: PayOrderResult | null;
  onClose: () => void;
}

export function PaymentQRModal({
  isOpen,
  currency,
  result,
  onClose,
}: PaymentQRModalProps) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!isOpen || !result?.expiresAt) {
      setRemaining(0);
      return;
    }
    const expiresAt = result.expiresAt;
    const updateRemaining = () => {
      setRemaining(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);

    return () => window.clearInterval(timer);
  }, [isOpen, result?.expiresAt]);

  if (!result) return null;

  const isUSDT = currency === "USDT";
  const isWechat = result.payType === "wxpay";
  const paymentName = isUSDT
    ? result.payType?.toUpperCase() || "USDT"
    : isWechat
      ? "微信支付"
      : "支付宝";
  const displayAmount = isUSDT
    ? `${result.payAmount} ${result.payToken || "USDT"}`
    : `${Number(result.payAmount || 0).toFixed(2)} 元`;
  const qrValue = result.qrContent || result.payUrl;
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  return (
    <Modal isDismissable={false} isOpen={isOpen} placement="center" size="sm">
      <ModalContent className="max-w-[360px] rounded-[26px] border-0 p-0 shadow-2xl">
        <div className="relative flex min-h-[440px] flex-col items-center px-8 pb-9 pt-6 text-center">
          <button
            aria-label="关闭支付弹窗"
            className="absolute right-5 top-5 rounded-full p-1 text-foreground/80 transition-colors hover:bg-default-100"
            type="button"
            onClick={onClose}
          >
            <X size={22} />
          </button>

          <div className="flex h-8 items-center gap-2 text-lg text-foreground/80">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white ${
                isUSDT ? "bg-emerald-500" : isWechat ? "bg-green-500" : "bg-blue-500"
              }`}
            >
              {isUSDT ? "U" : isWechat ? "微" : "支"}
            </span>
            <span>{paymentName}</span>
          </div>

          <p className="mt-5 text-sm text-foreground/80">扫一扫付款</p>
          <p className="mt-1 text-[32px] font-bold tracking-tight text-foreground">
            {displayAmount}
          </p>

          <div className="mt-5 flex h-[190px] w-[190px] items-center justify-center rounded-xl border border-default-200 bg-white p-3">
            {result.qrImageUrl ? (
              <img
                alt="支付二维码"
                className="h-full w-full object-contain"
                src={result.qrImageUrl}
              />
            ) : qrValue ? (
              <QRCodeSVG bgColor="#ffffff" fgColor="#000000" size={164} value={qrValue} />
            ) : (
              <span className="text-sm text-danger">支付二维码生成失败</span>
            )}
          </div>

          <p className="mt-6 text-sm text-default-500">
            {remaining > 0
              ? `二维码剩余有效期 ${minutes}:${seconds}`
              : "二维码已过期"}
          </p>
          <p className="mt-1 text-sm text-default-500">请尽快完成付款</p>
        </div>
      </ModalContent>
    </Modal>
  );
}
