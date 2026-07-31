export interface CalendarDateLike {
  day: number;
  month: number;
  year: number;
}

export interface DatePreset {
  label: string;
  offsetDays?: number;
  offsetMonths?: number;
  value?: number;
}

export function addCalendarMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date);
  const originalDay = target.getDate();

  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();

  target.setDate(Math.min(originalDay, lastDay));

  return target;
}

export function timestampToCalendarDate(
  timestamp: number | null | undefined,
): CalendarDateLike | null {
  if (!timestamp || timestamp <= 0) {
    return null;
  }
  const date = new Date(timestamp);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function calendarDateToTimestamp(
  date: CalendarDateLike | null | undefined,
  endOfDay: boolean = false,
): number | null {
  if (!date) {
    return null;
  }
  if (endOfDay) {
    return new Date(date.year, date.month - 1, date.day, 0, 0, 1).getTime();
  }

  return new Date(date.year, date.month - 1, date.day, 0, 0, 1).getTime();
}

export function isPermanentDate(value: number | null | undefined): boolean {
  return !value || value <= 0;
}

export function getDefaultDatePresets(): DatePreset[] {
  return [
    { label: "1 月后", offsetMonths: 1 },
    { label: "3 月后", offsetMonths: 3 },
    { label: "6 月后", offsetMonths: 6 },
    { label: "1 年后", offsetMonths: 12 },
    { label: "永久", value: 0 },
  ];
}

export function calculateDateFromPreset(preset: DatePreset): number {
  if (preset.value !== undefined) {
    return preset.value;
  }
  if (preset.offsetMonths !== undefined) {
    const next = addCalendarMonthsClamped(new Date(), preset.offsetMonths);

    next.setHours(0, 0, 1, 0);

    return next.getTime();
  }
  if (preset.offsetDays !== undefined) {
    const now = new Date();

    now.setDate(now.getDate() + preset.offsetDays);
    now.setHours(0, 0, 1, 0);

    return now.getTime();
  }

  return 0;
}
