package repo

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"time"
)

// Database maintenance configuration keys persisted in vite_config.
const (
	MaintenanceConfigKeyEnabled         = "db_maintenance_enabled"
	MaintenanceConfigKeyHour            = "db_maintenance_hour"
	MaintenanceConfigKeyVacuumDays      = "db_vacuum_interval_days"
	MaintenanceConfigKeyDockerPruneDays = "docker_prune_interval_days"
	maintenanceKeyLastVacuumAt          = "db_maintenance_last_vacuum_at"
	maintenanceKeyDockerPruneAt         = "docker_prune_last_at"
)

// MaintenanceVacuumMinBytes is the minimum database size before a full VACUUM
// is considered worthwhile.
const MaintenanceVacuumMinBytes int64 = 200 << 20 // 200 MiB

// MaintenanceSettings controls the scheduled SQLite maintenance job.
type MaintenanceSettings struct {
	Enabled                 bool
	Hour                    int
	VacuumIntervalDays      int
	DockerPruneIntervalDays int
}

// MaintenanceOptions are the parameters for a single maintenance run.
type MaintenanceOptions struct {
	VacuumIntervalDays int
	VacuumMinBytes     int64
}

// MaintenanceResult summarises a maintenance run.
type MaintenanceResult struct {
	Dialect      string
	SizeBefore   int64
	SizeAfter    int64
	Checkpointed bool
	Optimized    bool
	Vacuumed     bool
	Duration     time.Duration
}

// SQLiteMaintenanceSettings loads maintenance settings from vite_config,
// falling back to safe defaults (enabled, 04:00, weekly VACUUM).
func (r *Repository) SQLiteMaintenanceSettings() MaintenanceSettings {
	settings := MaintenanceSettings{Enabled: true, Hour: 4, VacuumIntervalDays: 7, DockerPruneIntervalDays: 7}
	if r == nil || r.db == nil {
		return settings
	}
	values, err := r.GetConfigsByNames([]string{
		MaintenanceConfigKeyEnabled,
		MaintenanceConfigKeyHour,
		MaintenanceConfigKeyVacuumDays,
		MaintenanceConfigKeyDockerPruneDays,
	})
	if err != nil {
		return settings
	}
	if raw, ok := values[MaintenanceConfigKeyEnabled]; ok {
		settings.Enabled = parseConfigBool(strings.TrimSpace(raw), settings.Enabled)
	}
	if raw, ok := values[MaintenanceConfigKeyHour]; ok {
		if hour, perr := strconv.Atoi(strings.TrimSpace(raw)); perr == nil && hour >= 0 && hour <= 23 {
			settings.Hour = hour
		}
	}
	if raw, ok := values[MaintenanceConfigKeyVacuumDays]; ok {
		if days, perr := strconv.Atoi(strings.TrimSpace(raw)); perr == nil && days >= 0 {
			settings.VacuumIntervalDays = days
		}
	}
	if raw, ok := values[MaintenanceConfigKeyDockerPruneDays]; ok {
		if days, perr := strconv.Atoi(strings.TrimSpace(raw)); perr == nil && days >= 0 {
			settings.DockerPruneIntervalDays = days
		}
	}
	return settings
}

// DockerImagePruneDue reports whether the scheduled docker image prune should run.
func (r *Repository) DockerImagePruneDue(intervalDays int) bool {
	if r == nil || r.db == nil {
		return false
	}
	if intervalDays <= 0 {
		return true
	}
	cfg, err := r.GetConfigByName(maintenanceKeyDockerPruneAt)
	if err != nil || cfg == nil {
		return true
	}
	last, perr := strconv.ParseInt(strings.TrimSpace(cfg.Value), 10, 64)
	if perr != nil || last <= 0 {
		return true
	}
	return time.Since(time.UnixMilli(last)) >= time.Duration(intervalDays)*24*time.Hour
}

// MarkDockerImagePrune records the timestamp of the last successful image prune.
func (r *Repository) MarkDockerImagePrune(nowMs int64) error {
	if r == nil || r.db == nil {
		return errors.New("repository not initialized")
	}
	return r.UpsertConfig(maintenanceKeyDockerPruneAt, strconv.FormatInt(nowMs, 10), nowMs)
}

func parseConfigBool(raw string, fallback bool) bool {
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

// IsSQLite reports whether the repository is backed by SQLite.
func (r *Repository) IsSQLite() bool {
	if r == nil || r.db == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(r.db.Dialector.Name()), "sqlite")
}

// SQLiteDBSizeBytes returns the logical database size (page_count * page_size).
func (r *Repository) SQLiteDBSizeBytes() int64 {
	if r == nil || r.db == nil || !r.IsSQLite() {
		return 0
	}
	var pageCount, pageSize int64
	if err := r.db.Raw("PRAGMA page_count").Row().Scan(&pageCount); err != nil {
		return 0
	}
	if err := r.db.Raw("PRAGMA page_size").Row().Scan(&pageSize); err != nil {
		return 0
	}
	if pageCount <= 0 || pageSize <= 0 {
		return 0
	}
	return pageCount * pageSize
}

// RunSQLiteMaintenance performs a WAL checkpoint plus query plan optimization
// and, when due, a full VACUUM. It is a no-op for non-SQLite backends
// (Postgres relies on autovacuum).
func (r *Repository) RunSQLiteMaintenance(opts MaintenanceOptions) (MaintenanceResult, error) {
	result := MaintenanceResult{}
	if r == nil || r.db == nil {
		return result, errors.New("repository not initialized")
	}
	result.Dialect = strings.TrimSpace(r.db.Dialector.Name())
	if !r.IsSQLite() {
		return result, nil
	}
	start := time.Now()
	result.SizeBefore = r.SQLiteDBSizeBytes()

	var busy, walFrames, checkpointed int64
	if err := r.db.Raw("PRAGMA wal_checkpoint(TRUNCATE)").Row().Scan(&busy, &walFrames, &checkpointed); err != nil {
		log.Printf("[db maintenance] wal_checkpoint failed: %v", err)
	} else {
		result.Checkpointed = true
	}

	if err := r.db.Exec("PRAGMA optimize").Error; err != nil {
		log.Printf("[db maintenance] optimize failed: %v", err)
	} else {
		result.Optimized = true
	}

	if r.shouldVacuum(opts) {
		if err := r.db.Exec("VACUUM").Error; err != nil {
			log.Printf("[db maintenance] VACUUM failed: %v", err)
		} else {
			result.Vacuumed = true
			now := time.Now().UnixMilli()
			if err := r.UpsertConfig(maintenanceKeyLastVacuumAt, strconv.FormatInt(now, 10), now); err != nil {
				log.Printf("[db maintenance] persist last vacuum time failed: %v", err)
			}
		}
	}

	result.SizeAfter = r.SQLiteDBSizeBytes()
	result.Duration = time.Since(start)
	log.Printf("[db maintenance] dialect=%s size=%d->%d checkpointed=%v optimized=%v vacuumed=%v duration=%s",
		result.Dialect, result.SizeBefore, result.SizeAfter, result.Checkpointed, result.Optimized, result.Vacuumed, result.Duration)
	return result, nil
}

func (r *Repository) shouldVacuum(opts MaintenanceOptions) bool {
	if opts.VacuumMinBytes > 0 && r.SQLiteDBSizeBytes() < opts.VacuumMinBytes {
		return false
	}
	if opts.VacuumIntervalDays <= 0 {
		return true
	}
	cfg, err := r.GetConfigByName(maintenanceKeyLastVacuumAt)
	if err != nil || cfg == nil {
		return true
	}
	last, perr := strconv.ParseInt(strings.TrimSpace(cfg.Value), 10, 64)
	if perr != nil || last <= 0 {
		return true
	}
	return time.Since(time.UnixMilli(last)) >= time.Duration(opts.VacuumIntervalDays)*24*time.Hour
}
