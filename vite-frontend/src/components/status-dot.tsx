import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type StatusDotTone = "success" | "danger" | "warning" | "default";

const toneClass: Record<StatusDotTone, string> = {
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
  default: "bg-default-400",
};

export function StatusDot({
  active = false,
  className,
  tone,
  ...props
}: {
  active?: boolean;
  className?: string;
  tone: StatusDotTone;
} & Omit<ComponentProps<"span">, "children">) {
  const colorClass = toneClass[tone];

  if (active && (tone === "success" || tone === "warning")) {
    return (
      <span
        className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)}
        {...props}
      >
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            colorClass,
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-full w-full rounded-full",
            colorClass,
          )}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
        colorClass,
        className,
      )}
      {...props}
    />
  );
}
