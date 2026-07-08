import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type MetricPillTone = "primary" | "secondary" | "success" | "warning";

const toneClasses: Record<MetricPillTone, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
};

export function MetricPill({
  children,
  className,
  tone = "primary",
}: {
  children: ReactNode;
  className?: string;
  tone?: MetricPillTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-md px-1.5 text-[10px] font-semibold leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
