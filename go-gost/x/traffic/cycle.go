package traffic

import (
	"time"
)

// CalculateNextReset 根据续费周期计算下次归零时间
// 返回零值 time.Time{} 表示不自动归零
func CalculateNextReset(renewalCycle string, from time.Time) time.Time {
	loc := from.Location()

	switch renewalCycle {
	case "daily":
		// 明天 00:00
		return time.Date(from.Year(), from.Month(), from.Day()+1, 0, 0, 0, 0, loc)

	case "weekly":
		// 下周一 00:00
		daysUntilMonday := (8 - int(from.Weekday())) % 7
		if daysUntilMonday == 0 {
			daysUntilMonday = 7
		}
		return time.Date(from.Year(), from.Month(), from.Day()+daysUntilMonday, 0, 0, 0, 0, loc)

	case "monthly", "month":
		// 下月同日 00:00
		return time.Date(from.Year(), from.Month()+1, from.Day(), 0, 0, 0, 0, loc)

	case "quarterly", "quarter":
		// 下季度同日
		currentQuarter := (int(from.Month()) - 1) / 3
		nextQuarterMonth := time.Month(currentQuarter*3 + 4)
		return time.Date(from.Year(), nextQuarterMonth, from.Day(), 0, 0, 0, 0, loc)

	case "halfyear", "halfYear":
		// 半年后同日
		return time.Date(from.Year(), from.Month()+6, from.Day(), 0, 0, 0, 0, loc)

	case "yearly", "year":
		// 明年同日
		return time.Date(from.Year()+1, from.Month(), from.Day(), 0, 0, 0, 0, loc)

	default:
		// once 或其他值：不自动归零
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
