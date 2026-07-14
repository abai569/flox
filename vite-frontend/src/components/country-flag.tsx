import { cn } from "@/lib/utils";

type CountryFlagProps = {
  code?: string;
  title?: string;
  className?: string;
};

const normalizeFlagCode = (code?: string): string => {
  const value = code?.trim().toLowerCase() || "";

  return /^[a-z]{2}$/.test(value) ? value : "";
};

export function CountryFlag({ code, title, className }: CountryFlagProps) {
  const normalized = normalizeFlagCode(code);

  if (!normalized) return null;

  return (
    <span
      aria-label={title}
      className={cn(
        "fi inline-block h-3 w-4 shrink-0 overflow-hidden rounded-[1px] ring-1 ring-default-300",
        `fi-${normalized}`,
        className,
      )}
      role={title ? "img" : undefined}
      title={title}
    />
  );
}

// Flag assets are provided by flag-icons: https://flagicons.lipis.dev/
