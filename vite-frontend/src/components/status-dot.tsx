import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { SmartTooltip } from "@/components/smart-tooltip";

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
  title,
  ...props
}: {
  active?: boolean;
  className?: string;
  tone: StatusDotTone;
  title?: string;
} & Omit<ComponentProps<"span">, "children" | "title">) {
  const colorClass = toneClass[tone];

  const dot =
    active && (tone === "success" || tone === "warning") ? (
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
    ) : (
      <span
        className={cn(
          "inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
          colorClass,
          className,
        )}
        {...props}
      />
    );

  if (title) {
    return <SmartTooltip content={title}>{dot}</SmartTooltip>;
  }

  return dot;
}
