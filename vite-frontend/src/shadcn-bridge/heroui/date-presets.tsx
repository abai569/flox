import type { DatePreset } from "@/utils/date";

import { Button } from "@/shadcn-bridge/heroui/button";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@/shadcn-bridge/heroui/dropdown";
import { calculateDateFromPreset } from "@/utils/date";

export interface DatePresetsProps {
  presets?: DatePreset[];
  onChange: (timestamp: number) => void;
  className?: string;
}

export function DatePresets({
  presets,
  onChange,
  className,
}: DatePresetsProps) {
  const presetList = presets || [
    { label: "1 月后", offsetMonths: 1 },
    { label: "3 月后", offsetMonths: 3 },
    { label: "6 月后", offsetMonths: 6 },
    { label: "1 年后", offsetMonths: 12 },
    { label: "永久", value: 0 },
  ];

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <Dropdown>
        <DropdownTrigger>
          <Button color="primary" size="sm" variant="flat">
            快捷
          </Button>
        </DropdownTrigger>
        <DropdownMenu aria-label="日期快捷选项">
          {presetList.map((preset) => (
            <DropdownItem
              key={preset.label}
              onPress={() => {
                const timestamp = calculateDateFromPreset(preset);

                onChange(timestamp);
              }}
            >
              {preset.label}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
