package traffic

import (
	"time"
)

func clampDay(year int, month time.Month, day int) int {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if day > last {
		return last
	}
	return day
}

// CalculateNextReset 根据续费周期计算下次归零时间
// 返回零值 time.Time{} 表示不自动归零
func CalculateNextReset(renewalCycle string, from time.Time) time.Time {
	loc := from.Location()

	switch renewalCycle {
	case "daily":
		return time.Date(from.Year(), from.Month(), from.Day()+1, 0, 0, 0, 0, loc)

	case "weekly":
		daysUntilMonday := (8 - int(from.Weekday())) % 7
		if daysUntilMonday == 0 {
			daysUntilMonday = 7
		}
		return time.Date(from.Year(), from.Month(), from.Day()+daysUntilMonday, 0, 0, 0, 0, loc)

	case "monthly", "month":
		nextMonth := from.Month() + 1
		nextYear := from.Year()
		if nextMonth > 12 {
			nextMonth = 1
			nextYear++
		}
		day := clampDay(nextYear, nextMonth, from.Day())
		return time.Date(nextYear, nextMonth, day, 0, 0, 0, 0, loc)

	case "quarterly", "quarter":
		currentQuarter := (int(from.Month()) - 1) / 3
		nextQuarterMonth := time.Month(currentQuarter*3 + 4)
		nextYear := from.Year()
		if nextQuarterMonth > 12 {
			nextQuarterMonth -= 12
			nextYear++
		}
		day := clampDay(nextYear, nextQuarterMonth, from.Day())
		return time.Date(nextYear, nextQuarterMonth, day, 0, 0, 0, 0, loc)

	case "halfyear", "halfYear":
		targetMonth := from.Month() + 6
		targetYear := from.Year()
		if targetMonth > 12 {
			targetMonth -= 12
			targetYear++
		}
		day := clampDay(targetYear, targetMonth, from.Day())
		return time.Date(targetYear, targetMonth, day, 0, 0, 0, 0, loc)

	case "yearly", "year":
		day := clampDay(from.Year()+1, from.Month(), from.Day())
		return time.Date(from.Year()+1, from.Month(), day, 0, 0, 0, 0, loc)

	default:
		return time.Time{}
	}
}

// IsAutoResetEnabled 检查是否启用自动归零
func IsAutoResetEnabled(renewalCycle string) bool {
	switch renewalCycle {
	case "daily", "weekly", "monthly", "month", "quarterly", "quarter", "halfyear", "halfYear", "yearly", "year":
		return true
	default:
		return false
	}
}
