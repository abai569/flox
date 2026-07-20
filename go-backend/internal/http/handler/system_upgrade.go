package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
)

const (
	panelDeployDirEnv                 = "PANEL_DEPLOY_DIR"
	panelBackendContainerEnv          = "PANEL_BACKEND_CONTAINER"
	flvxDefaultPanelDeployDir         = "/opt/flvx-svc"
	flvxDefaultPanelBackendName       = "flvx-svc-backend"
	defaultPanelDeployDir             = "/opt/flox-svc"
	defaultPanelBackendName           = "flox-svc-backend"
	defaultImageRegistry              = "ghcr.io/abai569"
	dockerSocketPath                  = "/var/run/docker.sock"
	systemUpgradeBackupRoot           = "/root/floxbackup"
	systemUpgradeStatusFilename       = ".upgrade-status.json"
	maxSystemUpgradeComposeAssetBytes = 1 << 20
	systemUpgradeMessage              = "升级 helper 已启动，面板服务将短暂重启"
	systemUpgradeConflictError        = "已有面板升级任务执行中"
)

var safeBackendContainerPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
var safeUpgradeVersionPattern = regexp.MustCompile(`^v?[0-9A-Za-z][0-9A-Za-z._+-]*$`)
var enableIPv6ComposePattern = regexp.MustCompile(`(?im)^\s*enable_ipv6\s*:\s*['"]?true['"]?\s*(?:#.*)?$`)
var composeBackendImagePattern = regexp.MustCompile(`(?m)^(\s*image:\s*)(\S*/)(?:flox|flvx)-svc-backend:[^\s]+\s*$`)
var composeFrontendImagePattern = regexp.MustCompile(`(?m)^(\s*image:\s*)(\S*/)(?:flox|flvx)-svc-frontend:[^\s]+\s*$`)
var systemUpgradeReleaseBaseURL = githubHTMLBase

type systemUpgradeExecutor struct {
	deployDir        string
	backendContainer string
	imageRegistry    string
}

type systemUpgradeCapabilityData struct {
	Capable          bool     `json:"capable"`
	Reasons          []string `json:"reasons"`
	DeployDir        string   `json:"deployDir"`
	BackendContainer string   `json:"backendContainer"`
}

type systemUpgradeReleaseData struct {
	Version     string `json:"version"`
	Name        string `json:"name"`
	PublishedAt string `json:"publishedAt"`
	Prerelease  bool   `json:"prerelease"`
	Channel     string `json:"channel"`
}

type systemUpgradeVersionData struct {
	CurrentVersion string                      `json:"currentVersion"`
	LatestVersion  string                      `json:"latestVersion"`
	HasUpdate      bool                        `json:"hasUpdate"`
	Channel        string                      `json:"channel"`
	Reason         string                      `json:"reason,omitempty"`
	Capability     systemUpgradeCapabilityData `json:"capability"`
}

type systemUpgradeCheckData struct {
	CurrentVersion string                      `json:"currentVersion"`
	LatestVersion  string                      `json:"latestVersion"`
	HasUpdate      bool                        `json:"hasUpdate"`
	Channel        string                      `json:"channel"`
	Capability     systemUpgradeCapabilityData `json:"capability"`
	Releases       []systemUpgradeReleaseData  `json:"releases"`
}

type systemUpgradeRunData struct {
	Version         string `json:"version"`
	Channel         string `json:"channel"`
	ComposeAsset    string `json:"composeAsset"`
	HelperContainer string `json:"helperContainer"`
	BackendImageID  string `json:"backendImageId"`
	Message         string `json:"message"`
}

type systemUpgradeStatusData struct {
	State       string `json:"state"`
	FromVersion string `json:"fromVersion,omitempty"`
	ToVersion   string `json:"toVersion,omitempty"`
	Stage       string `json:"stage,omitempty"`
	Message     string `json:"message,omitempty"`
	BackupDir   string `json:"backupDir,omitempty"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type systemUpgradeRequest struct {
	Version string `json:"version"`
	Channel string `json:"channel"`
}

func newSystemUpgradeExecutor() *systemUpgradeExecutor {
	deployDir := strings.TrimSpace(os.Getenv(panelDeployDirEnv))
	if deployDir == "" {
		deployDir = defaultPanelDeployDir
	}
	// 兼容旧版安装路径：如果没有新的 flox-svc 目录，检查旧版 flvx-svc 目录
	if _, err := os.Stat(deployDir); err != nil {
		oldDir := flvxDefaultPanelDeployDir
		if _, err2 := os.Stat(oldDir); err2 == nil {
			deployDir = oldDir
		}
	}
	backendContainer := strings.TrimSpace(os.Getenv(panelBackendContainerEnv))
	if backendContainer == "" {
		backendContainer = defaultPanelBackendName
		// 兼容旧版容器名：如果新容器不存在，尝试旧容器名
		ctx := context.Background()
		checkCmd := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.Name}}", backendContainer)
		if checkCmd.Run() != nil {
			oldContainer := flvxDefaultPanelBackendName
			checkOld := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.Name}}", oldContainer)
			if checkOld.Run() == nil {
				backendContainer = oldContainer
			}
		}
	}
	return &systemUpgradeExecutor{deployDir: deployDir, backendContainer: backendContainer}
}

func currentPanelVersion() string {
	version := strings.TrimSpace(os.Getenv("FLOX_VERSION"))
	if version == "" {
		version = strings.TrimSpace(os.Getenv("FLUX_VERSION"))
	}
	if version == "" {
		return "dev"
	}
	return version
}

func validateBackendContainerName(value string) error {
	if value == "" {
		return fmt.Errorf("backend container name is empty")
	}
	if !safeBackendContainerPattern.MatchString(value) {
		return fmt.Errorf("unsafe backend container name: %s", value)
	}
	return nil
}

func validateUpgradeVersion(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("upgrade version is empty")
	}
	if !safeUpgradeVersionPattern.MatchString(value) {
		return fmt.Errorf("unsafe upgrade version")
	}
	return nil
}

func (e *systemUpgradeExecutor) composePath() string {
	return filepath.Join(e.deployDir, "docker-compose.yml")
}
func (e *systemUpgradeExecutor) envPath() string { return filepath.Join(e.deployDir, ".env") }
func (e *systemUpgradeExecutor) statusPath() string {
	return filepath.Join(e.deployDir, systemUpgradeStatusFilename)
}

func (e *systemUpgradeExecutor) capability(ctx context.Context) systemUpgradeCapabilityData {
	reasons := make([]string, 0)
	if !filepath.IsAbs(e.deployDir) {
		reasons = append(reasons, "部署目录必须是绝对路径")
	}
	if err := validateBackendContainerName(e.backendContainer); err != nil {
		reasons = append(reasons, err.Error())
	}
	if out, err := exec.CommandContext(ctx, "docker", "--version").CombinedOutput(); err != nil {
		reasons = append(reasons, fmt.Sprintf("docker CLI 不可用：%v: %s", err, strings.TrimSpace(string(out))))
	}
	if info, err := os.Stat(dockerSocketPath); err != nil {
		reasons = append(reasons, "docker socket 不可用："+err.Error())
	} else if info.IsDir() {
		reasons = append(reasons, "docker socket 路径不是文件")
	}
	if info, err := os.Stat(e.composePath()); err != nil {
		reasons = append(reasons, "部署 docker-compose.yml 不可用："+err.Error())
	} else if info.IsDir() {
		reasons = append(reasons, "部署 docker-compose.yml 不是文件")
	}
	if info, err := os.Stat(e.envPath()); err != nil {
		reasons = append(reasons, "部署.env 不可用："+err.Error())
	} else if info.IsDir() {
		reasons = append(reasons, "部署.env 不是文件")
	}
	if out, err := exec.CommandContext(ctx, "docker", "compose", "version").CombinedOutput(); err != nil {
		reasons = append(reasons, fmt.Sprintf("docker compose 不可用：%v: %s", err, strings.TrimSpace(string(out))))
	}
	if _, err := e.currentBackendImage(ctx); err != nil {
		reasons = append(reasons, err.Error())
	}

	return systemUpgradeCapabilityData{
		Capable:          len(reasons) == 0,
		Reasons:          reasons,
		DeployDir:        e.deployDir,
		BackendContainer: e.backendContainer,
	}
}

func (e *systemUpgradeExecutor) selectComposeAsset(current []byte) string {
	if enableIPv6ComposePattern.Match(current) {
		return "docker-compose-v6.yml"
	}
	return "docker-compose-v4.yml"
}

func (e *systemUpgradeExecutor) helperScript() string {
	return strings.Join([]string{
		"set -u",
		`FLOX_DIR="/opt/flox-svc"`,
		`FLVX_DIR="/opt/flvx-svc"`,
		`BACKUP_DIR="/root/floxbackup/flox_web_upgrade_${UPGRADE_ID}"`,
		`STATUS_FILE="$FLOX_DIR/.upgrade-status.json"`,
		`status_write() {`,
		`  STATE="$1"; STAGE="$2"; MESSAGE="$3"`,
		`  printf '{"state":"%s","fromVersion":"%s","toVersion":"%s","stage":"%s","message":"%s","backupDir":"%s","updatedAt":%s}\n' "$STATE" "$OLD_VERSION" "$TARGET_VERSION" "$STAGE" "$MESSAGE" "$BACKUP_DIR" "$(date +%s000)" > "${STATUS_FILE}.tmp"`,
		`  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"`,
		`  [ ! -d "$FLVX_DIR" ] || cp "$STATUS_FILE" "$FLVX_DIR/.upgrade-status.json" 2>/dev/null || true`,
		`}`,
		`cancel_upgrade() {`,
		`  FAILED_STAGE="$1"; MESSAGE="$2"`,
		`  cp "$BACKUP_DIR/docker-compose.yml" "$FLOX_DIR/docker-compose.yml" 2>/dev/null || true`,
		`  cp "$BACKUP_DIR/.env" "$FLOX_DIR/.env" 2>/dev/null || true`,
		`  docker start "$PANEL_BACKEND_CONTAINER" >/dev/null 2>&1 || true`,
		`  status_write "backup_failed" "$FAILED_STAGE" "$MESSAGE"`,
		`  exit 1`,
		`}`,
		`rollback() {`,
		`  FAILED_STAGE="$1"`,
		`  status_write "rollback_running" "$FAILED_STAGE" "升级失败，正在恢复原版本"`,
		`  docker rm -f flox-svc-backend flox-svc-frontend flvx-svc-backend flvx-svc-frontend 2>/dev/null || true`,
		`  if [ "$DB_TYPE" = "postgres" ]; then`,
		`    POSTGRES_CONTAINER=flox-svc-postgres; docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || POSTGRES_CONTAINER=flvx-svc-postgres`,
		`    docker exec -i "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$BACKUP_DIR/backup.sql" || { status_write "rollback_failed" "$FAILED_STAGE" "PostgreSQL 数据库恢复失败"; return 1; }`,
		`  else`,
		`    rm -f /app/data/gost.db /app/data/gost.db-wal /app/data/gost.db-shm`,
		`    cp "$BACKUP_DIR/gost.db" /app/data/gost.db || { status_write "rollback_failed" "$FAILED_STAGE" "SQLite 数据库恢复失败"; return 1; }`,
		`    [ ! -f "$BACKUP_DIR/gost.db-wal" ] || cp "$BACKUP_DIR/gost.db-wal" /app/data/gost.db-wal || { status_write "rollback_failed" "$FAILED_STAGE" "SQLite WAL 恢复失败"; return 1; }`,
		`    [ ! -f "$BACKUP_DIR/gost.db-shm" ] || cp "$BACKUP_DIR/gost.db-shm" /app/data/gost.db-shm || { status_write "rollback_failed" "$FAILED_STAGE" "SQLite SHM 恢复失败"; return 1; }`,
		`  fi`,
		`  cp "$BACKUP_DIR/docker-compose.yml" "$FLOX_DIR/docker-compose.yml" || { status_write "rollback_failed" "$FAILED_STAGE" "恢复原 compose 失败"; return 1; }`,
		`  cp "$BACKUP_DIR/.env" "$FLOX_DIR/.env" || { status_write "rollback_failed" "$FAILED_STAGE" "恢复原环境配置失败"; return 1; }`,
		`  docker image tag "$OLD_BACKEND_IMAGE" "flox-upgrade-backend-rollback:${UPGRADE_ID}" || { status_write "rollback_failed" "$FAILED_STAGE" "恢复后端镜像标签失败"; return 1; }`,
		`  docker image tag "$OLD_FRONTEND_IMAGE" "flox-upgrade-frontend-rollback:${UPGRADE_ID}" || { status_write "rollback_failed" "$FAILED_STAGE" "恢复前端镜像标签失败"; return 1; }`,
		`  sed -i -E "s|^([[:space:]]*image:[[:space:]]*).*(flox|flvx)-svc-backend:[^[:space:]]+|\\1flox-upgrade-backend-rollback:${UPGRADE_ID}|" "$FLOX_DIR/docker-compose.yml"`,
		`  sed -i -E "s|^([[:space:]]*image:[[:space:]]*).*(flox|flvx)-svc-frontend:[^[:space:]]+|\\1flox-upgrade-frontend-rollback:${UPGRADE_ID}|" "$FLOX_DIR/docker-compose.yml"`,
		`  cd "$FLOX_DIR"`,
		`  docker compose up -d backend frontend || { status_write "rollback_failed" "$FAILED_STAGE" "原版本容器启动失败"; return 1; }`,
		`  cp "$BACKUP_DIR/docker-compose.yml" "$FLOX_DIR/docker-compose.yml" 2>/dev/null || true`,
		`  ROLLBACK_BACKEND=flox-svc-backend; docker inspect "$ROLLBACK_BACKEND" >/dev/null 2>&1 || ROLLBACK_BACKEND=flvx-svc-backend`,
		`  i=0; while [ "$i" -lt 30 ]; do`,
		`    HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$ROLLBACK_BACKEND" 2>/dev/null || true)`,
		`    [ "$HEALTH" = "healthy" ] && status_write "rolled_back" "$FAILED_STAGE" "升级失败，已自动回滚到原版本" && return 0`,
		`    i=$((i+1)); sleep 5`,
		`  done`,
		`  status_write "rollback_failed" "$FAILED_STAGE" "已恢复原配置，但原版本健康检查失败"`,
		`  return 1`,
		`}`,
		`cleanup_old_panel_images() {`,
		`  KEEP_VERSION="$TARGET_VERSION"`,
		`  KEEP_ALT_VERSION="$TARGET_VERSION"`,
		`  case "$TARGET_VERSION" in v*) KEEP_ALT_VERSION="${TARGET_VERSION#v}" ;; *) KEEP_ALT_VERSION="v${TARGET_VERSION}" ;; esac`,
		`  docker image ls --format '{{.Repository}}:{{.Tag}}' ghcr.io/abai569/flox-svc-backend ghcr.io/abai569/flox-svc-frontend 2>/dev/null | while IFS= read -r IMAGE; do`,
		`    [ -n "$IMAGE" ] || continue`,
		`    [ "$IMAGE" != "ghcr.io/abai569/flox-svc-backend:<none>" ] || continue`,
		`    [ "$IMAGE" != "ghcr.io/abai569/flox-svc-frontend:<none>" ] || continue`,
		`    case "$IMAGE" in *":$KEEP_VERSION"|*":$KEEP_ALT_VERSION") continue ;; esac`,
		`    docker image rm "$IMAGE" >/dev/null 2>&1 || true`,
		`  done`,
		`}`,
		`if [ -d "$FLVX_DIR" ] && [ ! -d "$FLOX_DIR" ]; then`,
		`  mkdir -p "$FLOX_DIR"`,
		`  cp -a "$FLVX_DIR/." "$FLOX_DIR/" 2>/dev/null`,
		`  if [ -f "$FLOX_DIR/.env" ]; then`,
		`    sed -i "s|/opt/flvx-svc|/opt/flox-svc|g" "$FLOX_DIR/.env"`,
		`    sed -i "s|flvx-svc-backend|flox-svc-backend|g" "$FLOX_DIR/.env"`,
		`    sed -i "s|flvx-svc-frontend|flox-svc-frontend|g" "$FLOX_DIR/.env"`,
		`    sed -i "s|flvx-svc-postgres|flox-svc-postgres|g" "$FLOX_DIR/.env"`,
		`  fi`,
		`  if [ -f "$FLOX_DIR/docker-compose.yml" ]; then`,
		`    sed -i "s|flvx-svc-backend|flox-svc-backend|g" "$FLOX_DIR/docker-compose.yml"`,
		`    sed -i "s|flvx-svc-frontend|flox-svc-frontend|g" "$FLOX_DIR/docker-compose.yml"`,
		`    sed -i "s|flvx-svc-postgres|flox-svc-postgres|g" "$FLOX_DIR/docker-compose.yml"`,
		`    sed -i "s|/opt/flvx-svc|/opt/flox-svc|g" "$FLOX_DIR/docker-compose.yml"`,
		`  fi`,
		`fi`,
		`mkdir -p "$BACKUP_DIR"`,
		`cp "$FLOX_DIR/docker-compose.yml.upgrade.bak" "$BACKUP_DIR/docker-compose.yml" || { status_write "backup_failed" "backup_config" "备份原 compose 失败，升级已取消"; exit 1; }`,
		`cp "$FLOX_DIR/.env.upgrade.bak" "$BACKUP_DIR/.env" || { status_write "backup_failed" "backup_config" "备份原环境配置失败，升级已取消"; exit 1; }`,
		`DB_TYPE=$(grep '^DB_TYPE=' "$BACKUP_DIR/.env" | cut -d= -f2 | tr -d '\r' | tr -d '"' | tr -d "'" || true)`,
		`DB_TYPE=${DB_TYPE:-sqlite}`,
		`status_write "running" "backup_database" "正在备份数据库"`,
		`if [ "$DB_TYPE" = "postgres" ]; then`,
		`  POSTGRES_USER=$(grep '^POSTGRES_USER=' "$BACKUP_DIR/.env" | cut -d= -f2- || true); POSTGRES_USER=${POSTGRES_USER:-flox_svc}`,
		`  POSTGRES_DB=$(grep '^POSTGRES_DB=' "$BACKUP_DIR/.env" | cut -d= -f2- || true); POSTGRES_DB=${POSTGRES_DB:-flox_svc}`,
		`  POSTGRES_CONTAINER=flox-svc-postgres; docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || POSTGRES_CONTAINER=flvx-svc-postgres`,
		`  docker exec "$POSTGRES_CONTAINER" pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BACKUP_DIR/backup.sql" || cancel_upgrade "backup_database" "PostgreSQL 备份失败，升级已取消"`,
		`else`,
		`  docker stop -t 30 "$PANEL_BACKEND_CONTAINER" >/dev/null 2>&1 || cancel_upgrade "backup_database" "无法停止后端进行 SQLite 备份"`,
		`  [ -s /app/data/gost.db ] || cancel_upgrade "backup_database" "未找到 SQLite 数据库，升级已取消"`,
		`  cp /app/data/gost.db "$BACKUP_DIR/gost.db" || cancel_upgrade "backup_database" "SQLite 主数据库备份失败，升级已取消"`,
		`  [ ! -f /app/data/gost.db-wal ] || cp /app/data/gost.db-wal "$BACKUP_DIR/gost.db-wal" || cancel_upgrade "backup_database" "SQLite WAL 备份失败，升级已取消"`,
		`  [ ! -f /app/data/gost.db-shm ] || cp /app/data/gost.db-shm "$BACKUP_DIR/gost.db-shm" || cancel_upgrade "backup_database" "SQLite SHM 备份失败，升级已取消"`,
		`fi`,
		`printf '{"databaseType":"%s","fromVersion":"%s","toVersion":"%s","createdAt":%s}\n' "$DB_TYPE" "$OLD_VERSION" "$TARGET_VERSION" "$(date +%s000)" > "$BACKUP_DIR/backup.json"`,
		`COUNT=0; for DIR in $(ls -1dt /root/floxbackup/flox_web_upgrade_* 2>/dev/null || true); do COUNT=$((COUNT+1)); [ "$COUNT" -le 5 ] || rm -rf "$DIR"; done`,
		`status_write "running" "pull_images" "数据库备份完成，正在拉取目标镜像"`,
		`cd "$FLOX_DIR"`,
		`docker compose pull backend frontend || { rollback "pull_images"; exit 1; }`,
		`status_write "running" "start_services" "正在启动目标版本"`,
		`docker compose up -d backend frontend || { rollback "start_services"; exit 1; }`,
		`i=0; while [ "$i" -lt 30 ]; do`,
		`  HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' flox-svc-backend 2>/dev/null || true)`,
		`  FRONTEND=$(docker inspect -f '{{.State.Status}}' flox-svc-frontend 2>/dev/null || true)`,
		`  if [ "$HEALTH" = "healthy" ] && [ "$FRONTEND" = "running" ] && docker exec flox-svc-backend wget -q -T 5 -O /dev/null http://127.0.0.1:6365/flow/test; then`,
		`    status_write "success" "complete" "升级成功"`,
		`    cleanup_old_panel_images`,
		`    docker image rm "flox-upgrade-backend-rollback:${UPGRADE_ID}" "flox-upgrade-frontend-rollback:${UPGRADE_ID}" 2>/dev/null || true`,
		`    exit 0`,
		`  fi`,
		`  i=$((i+1)); sleep 5`,
		`done`,
		`rollback "health_check"`,
		`exit 1`,
	}, "\n")
}

func (e *systemUpgradeExecutor) buildHelperRunArgs(imageID, frontendImageID, helperName, upgradeID, oldVersion, targetVersion string) ([]string, error) {
	if err := validateBackendContainerName(e.backendContainer); err != nil {
		return nil, err
	}
	return []string{
		"run", "-d", "--rm", "--name", helperName,
		"--volumes-from", e.backendContainer,
		"-v", dockerSocketPath + ":" + dockerSocketPath,
		"-v", systemUpgradeBackupRoot + ":" + systemUpgradeBackupRoot,
		"-e", panelDeployDirEnv + "=" + e.deployDir,
		"-e", panelBackendContainerEnv + "=" + e.backendContainer,
		"-e", "OLD_BACKEND_IMAGE=" + imageID,
		"-e", "OLD_FRONTEND_IMAGE=" + frontendImageID,
		"-e", "UPGRADE_ID=" + upgradeID,
		"-e", "OLD_VERSION=" + oldVersion,
		"-e", "TARGET_VERSION=" + targetVersion,
		"--entrypoint", "/bin/sh", imageID,
		"-c", e.helperScript(),
	}, nil
}

func (e *systemUpgradeExecutor) updateEnvVersion(envPath, version string) error {
	if err := validateUpgradeVersion(version); err != nil {
		return err
	}
	mode, err := fileModeOrDefault(envPath, 0o600)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	replaced := false
	for i, line := range lines {
		if strings.HasPrefix(line, "FLOX_VERSION=") {
			lines[i] = "FLOX_VERSION=" + version
			replaced = true
		} else if strings.HasPrefix(line, "FLUX_VERSION=") {
			lines[i] = "FLOX_VERSION=" + version
			replaced = true
		}
	}
	if !replaced {
		trimmed := strings.TrimRight(strings.Join(lines, "\n"), "\n")
		if trimmed == "" {
			trimmed = "FLOX_VERSION=" + version
		} else {
			trimmed += "\nFLOX_VERSION=" + version
		}
		return writeFileWithMode(envPath, []byte(trimmed+"\n"), mode)
	}
	content := strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
	return writeFileWithMode(envPath, []byte(content), mode)
}

func normalizeSystemUpgradeCompose(data []byte) []byte {
	text := string(data)
	text = strings.ReplaceAll(text, "${FLUX_VERSION:-latest}", "${FLOX_VERSION:-latest}")
	text = strings.ReplaceAll(text, "${FLUX_VERSION:-dev}", "${FLOX_VERSION:-dev}")
	text = strings.ReplaceAll(text, "FLUX_VERSION:", "FLOX_VERSION:")
	text = regexp.MustCompile(`(?m)^\s*name:\s*sqlite_data\s*$`).ReplaceAllString(text, "    name: flox-svc_sqlite_data")
	text = regexp.MustCompile(`(?m)^\s*name:\s*postgres_data\s*$`).ReplaceAllString(text, "    name: flox-svc_postgres_data")
	return []byte(text)
}

func composeWithTargetVersion(data []byte, version string) ([]byte, error) {
	if err := validateUpgradeVersion(version); err != nil {
		return nil, err
	}
	text := string(normalizeSystemUpgradeCompose(data))
	backendReplaced := false
	frontendReplaced := false
	text = composeBackendImagePattern.ReplaceAllStringFunc(text, func(line string) string {
		backendReplaced = true
		return composeBackendImagePattern.ReplaceAllString(line, `${1}${2}flox-svc-backend:`+version)
	})
	text = composeFrontendImagePattern.ReplaceAllStringFunc(text, func(line string) string {
		frontendReplaced = true
		return composeFrontendImagePattern.ReplaceAllString(line, `${1}${2}flox-svc-frontend:`+version)
	})
	if !backendReplaced || !frontendReplaced {
		return nil, fmt.Errorf("compose image tag replacement failed")
	}
	return []byte(text), nil
}

func (e *systemUpgradeExecutor) backupFile(path string) (string, error) {
	mode, err := fileModeOrDefault(path, 0o600)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	backupPath := path + ".upgrade.bak"
	if err := writeFileWithMode(backupPath, data, mode); err != nil {
		return "", err
	}
	return backupPath, nil
}

func (e *systemUpgradeExecutor) restoreBackup(path string) error {
	backupPath := path + ".upgrade.bak"
	mode, err := fileModeOrDefault(backupPath, 0o600)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(backupPath)
	if err != nil {
		return err
	}
	return writeFileWithMode(path, data, mode)
}

func (e *systemUpgradeExecutor) restoreUpgradeBackups(paths ...string) error {
	var errs []string
	for _, path := range paths {
		if err := e.restoreBackup(path); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", path, err))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

func (e *systemUpgradeExecutor) replaceCompose(path string, data []byte) error {
	if len(bytes.TrimSpace(data)) == 0 {
		return fmt.Errorf("compose asset is empty")
	}
	mode, err := fileModeOrDefault(path, 0o644)
	if err != nil {
		return err
	}
	return writeFileWithMode(path, normalizeSystemUpgradeCompose(data), mode)
}

func fileModeOrDefault(path string, fallback os.FileMode) (os.FileMode, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fallback, nil
		}
		return 0, err
	}
	return info.Mode().Perm(), nil
}

func writeFileWithMode(path string, data []byte, mode os.FileMode) error {
	if err := os.WriteFile(path, data, mode); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}

func (e *systemUpgradeExecutor) currentBackendImage(ctx context.Context) (string, error) {
	return currentContainerImage(ctx, e.backendContainer)
}

func currentContainerImage(ctx context.Context, container string) (string, error) {
	if err := validateBackendContainerName(container); err != nil {
		return "", err
	}
	out, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.Image}}", container).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("inspect %s image failed: %v: %s", container, err, strings.TrimSpace(string(out)))
	}
	imageID := strings.TrimSpace(string(out))
	if imageID == "" {
		return "", fmt.Errorf("%s image id is empty", container)
	}
	return imageID, nil
}

func (e *systemUpgradeExecutor) currentFrontendImage(ctx context.Context) (string, error) {
	for _, container := range []string{"flox-svc-frontend", "flvx-svc-frontend"} {
		if imageID, err := currentContainerImage(ctx, container); err == nil {
			return imageID, nil
		}
	}
	return "", fmt.Errorf("inspect frontend image failed")
}

func (e *systemUpgradeExecutor) readStatus() (systemUpgradeStatusData, error) {
	var status systemUpgradeStatusData
	data, err := os.ReadFile(e.statusPath())
	if err != nil {
		return status, err
	}
	if err := json.Unmarshal(data, &status); err != nil {
		return status, err
	}
	return status, nil
}

func (e *systemUpgradeExecutor) writeStatus(status systemUpgradeStatusData) error {
	status.UpdatedAt = time.Now().UnixMilli()
	data, err := json.Marshal(status)
	if err != nil {
		return err
	}
	return writeFileWithMode(e.statusPath(), append(data, '\n'), 0o600)
}

func extractImageRegistry(imageID string) string {
	// Parse registry from image reference like "ghcr.io/abai569/flox-svc-backend:tag"
	// Strip digest pinning: "image@sha256:abc" → "image"
	if idx := strings.Index(imageID, "@"); idx >= 0 {
		imageID = imageID[:idx]
	}
	// Strip tag: "ghcr.io/abai569/flox-svc-backend:tag" → "ghcr.io/abai569/flox-svc-backend"
	tagSep := strings.LastIndex(imageID, ":")
	slashSep := strings.LastIndex(imageID, "/")
	if tagSep > slashSep {
		imageID = imageID[:tagSep]
	}
	// Remove repo name, keep registry+owner: "ghcr.io/abai569/flox-svc-backend" → "ghcr.io/abai569"
	if idx := strings.LastIndex(imageID, "/"); idx >= 0 {
		return imageID[:idx]
	}
	return defaultImageRegistry
}

func (e *systemUpgradeExecutor) startHelper(ctx context.Context, imageID, frontendImageID, helperName, upgradeID, oldVersion, targetVersion string) (string, error) {
	args, err := e.buildHelperRunArgs(imageID, frontendImageID, helperName, upgradeID, oldVersion, targetVersion)
	if err != nil {
		return "", err
	}
	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("start helper failed: %v: %s", err, strings.TrimSpace(string(out)))
	}
	containerID := strings.TrimSpace(string(out))
	if containerID == "" {
		containerID = helperName
	}
	return containerID, nil
}

func (h *Handler) downloadReleaseAsset(version, filename string) ([]byte, error) {
	url := fmt.Sprintf("%s/%s/releases/download/%s/%s", strings.TrimRight(systemUpgradeReleaseBaseURL, "/"), githubRepo, version, filename)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("下载%s失败：%v", filename, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("下载%s返回 %d: %s", filename, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSystemUpgradeComposeAssetBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取%s失败：%v", filename, err)
	}
	if len(body) > maxSystemUpgradeComposeAssetBytes {
		return nil, fmt.Errorf("下载%s过大", filename)
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, fmt.Errorf("下载%s内容为空", filename)
	}
	return body, nil
}

func releasesForChannel(releases []githubRelease, channel string) []systemUpgradeReleaseData {
	channel = normalizeReleaseChannel(channel)
	items := make([]systemUpgradeReleaseData, 0, len(releases))
	for _, r := range releases {
		if r.Draft {
			continue
		}
		tag := strings.TrimSpace(r.TagName)
		if tag == "" {
			continue
		}
		itemChannel := releaseChannelFromTag(tag)
		if itemChannel != channel {
			continue
		}
		items = append(items, systemUpgradeReleaseData{
			Version:     tag,
			Name:        r.Name,
			PublishedAt: r.PublishedAt,
			Prerelease:  itemChannel == releaseChannelDev,
			Channel:     itemChannel,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return compareVersions(items[i].Version, items[j].Version) > 0
	})
	return items
}

func decodeSystemUpgradeRequest(r *http.Request, req *systemUpgradeRequest) error {
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	return decoder.Decode(req)
}

func systemUpgradeVersionResponse(current, channel, latest string, lookupErr error, capability systemUpgradeCapabilityData) systemUpgradeVersionData {
	data := systemUpgradeVersionData{
		CurrentVersion: current,
		LatestVersion:  latest,
		HasUpdate:      latest != "" && latest != current,
		Channel:        channel,
		Capability:     capability,
	}
	if lookupErr != nil {
		data.LatestVersion = ""
		data.HasUpdate = false
		data.Reason = lookupErr.Error()
	}
	return data
}

func (h *Handler) systemVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	channel := releaseChannelStable
	current := currentPanelVersion()
	exec := newSystemUpgradeExecutor()
	capability := exec.capability(r.Context())
	latest, err := resolveLatestReleaseByChannel(channel)
	response.WriteJSON(w, response.OK(systemUpgradeVersionResponse(current, channel, latest, err, capability)))
}

func (h *Handler) systemCheckUpdates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req systemUpgradeRequest
	if err := decodeSystemUpgradeRequest(r, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	channel := normalizeReleaseChannel(req.Channel)
	current := currentPanelVersion()
	exec := newSystemUpgradeExecutor()
	capability := exec.capability(r.Context())

	githubReleases, err := fetchGitHubReleases(50)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取版本列表失败：%v", err)))
		return
	}
	releases := releasesForChannel(githubReleases, channel)
	latest := ""
	if len(releases) > 0 {
		latest = releases[0].Version
	}
	response.WriteJSON(w, response.OK(systemUpgradeCheckData{
		CurrentVersion: current,
		LatestVersion:  latest,
		HasUpdate:      latest != "" && latest != current,
		Channel:        channel,
		Capability:     capability,
		Releases:       releases,
	}))
}

func (h *Handler) systemUpgradeStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	exec := newSystemUpgradeExecutor()
	status, err := exec.readStatus()
	if err != nil {
		if os.IsNotExist(err) {
			response.WriteJSON(w, response.OK(systemUpgradeStatusData{}))
			return
		}
		response.WriteJSON(w, response.Err(-2, "读取升级状态失败："+err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(status))
}

func (h *Handler) systemUpgradeAcknowledge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	exec := newSystemUpgradeExecutor()
	if err := os.Remove(exec.statusPath()); err != nil && !os.IsNotExist(err) {
		response.WriteJSON(w, response.Err(-2, "确认升级状态失败："+err.Error()))
		return
	}
	response.WriteJSON(w, response.OK(nil))
}

func (h *Handler) systemUpgrade(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	if !h.systemUpgradeMu.TryLock() {
		response.WriteJSON(w, response.ErrDefault(systemUpgradeConflictError))
		return
	}
	defer h.systemUpgradeMu.Unlock()

	var req systemUpgradeRequest
	if err := decodeSystemUpgradeRequest(r, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	channel := normalizeReleaseChannel(req.Channel)
	version := strings.TrimSpace(req.Version)
	if version == "" {
		var err error
		version, err = resolveLatestReleaseByChannel(channel)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取最新%s失败：%v", releaseChannelLabel(channel), err)))
			return
		}
	}

	go func() {
		bot := h.TelegramBot()
		if bot != nil && bot.Enabled() && bot.Running() {
			tier, _ := middleware.GetLicenseTier()
			if tier != middleware.TierFree {
				bot.SendSystemUpgrade(version)
			}
		}
	}()

	exec := newSystemUpgradeExecutor()
	capability := exec.capability(r.Context())
	if !capability.Capable {
		response.WriteJSON(w, response.ErrDefault("当前环境不支持面板自升级："+strings.Join(capability.Reasons, "; ")))
		return
	}
	imageID, err := exec.currentBackendImage(r.Context())
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	frontendImageID, err := exec.currentFrontendImage(r.Context())
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	exec.imageRegistry = extractImageRegistry(imageID)

	composePath := exec.composePath()
	envPath := exec.envPath()
	composeData, err := os.ReadFile(composePath)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, "读取 compose 失败："+err.Error()))
		return
	}
	composeAsset := exec.selectComposeAsset(composeData)
	newCompose, err := h.downloadReleaseAsset(version, composeAsset)
	if err != nil {
		fallbackCompose, fallbackErr := composeWithTargetVersion(composeData, version)
		if fallbackErr != nil {
			response.WriteJSON(w, response.Err(-2, fmt.Sprintf("%v；复用当前 compose 失败：%v", err, fallbackErr)))
			return
		}
		newCompose = fallbackCompose
		composeAsset = composeAsset + " (fallback-current-compose)"
	}
	if _, err := exec.backupFile(composePath); err != nil {
		response.WriteJSON(w, response.Err(-2, "备份 compose 失败："+err.Error()))
		return
	}
	if _, err := exec.backupFile(envPath); err != nil {
		response.WriteJSON(w, response.Err(-2, "备份.env 失败："+err.Error()))
		return
	}
	if err := exec.replaceCompose(composePath, newCompose); err != nil {
		if restoreErr := exec.restoreUpgradeBackups(composePath, envPath); restoreErr != nil {
			err = fmt.Errorf("%v; 回滚失败：%v", err, restoreErr)
		}
		response.WriteJSON(w, response.Err(-2, "替换 compose 失败："+err.Error()))
		return
	}
	if err := exec.updateEnvVersion(envPath, version); err != nil {
		if restoreErr := exec.restoreUpgradeBackups(composePath, envPath); restoreErr != nil {
			err = fmt.Errorf("%v; 回滚失败：%v", err, restoreErr)
		}
		response.WriteJSON(w, response.Err(-2, "更新版本配置失败："+err.Error()))
		return
	}
	upgradeID := fmt.Sprintf("%d", time.Now().Unix())
	oldVersion := currentPanelVersion()
	if err := os.MkdirAll(systemUpgradeBackupRoot, 0o700); err != nil {
		if restoreErr := exec.restoreUpgradeBackups(composePath, envPath); restoreErr != nil {
			err = fmt.Errorf("%v; 回滚失败：%v", err, restoreErr)
		}
		response.WriteJSON(w, response.Err(-2, "创建升级备份目录失败："+err.Error()))
		return
	}
	if err := exec.writeStatus(systemUpgradeStatusData{
		State:       "running",
		FromVersion: oldVersion,
		ToVersion:   version,
		Stage:       "starting_helper",
		Message:     "升级 helper 正在启动",
		BackupDir:   filepath.Join(systemUpgradeBackupRoot, "flox_web_upgrade_"+upgradeID),
	}); err != nil {
		if restoreErr := exec.restoreUpgradeBackups(composePath, envPath); restoreErr != nil {
			err = fmt.Errorf("%v; 回滚失败：%v", err, restoreErr)
		}
		response.WriteJSON(w, response.Err(-2, "写入升级状态失败："+err.Error()))
		return
	}
	helperName := fmt.Sprintf("FLOX-upgrade-helper-%s", upgradeID)
	helperContainer, err := exec.startHelper(r.Context(), imageID, frontendImageID, helperName, upgradeID, oldVersion, version)
	if err != nil {
		if restoreErr := exec.restoreUpgradeBackups(composePath, envPath); restoreErr != nil {
			err = fmt.Errorf("%v; 回滚失败：%v", err, restoreErr)
		}
		_ = exec.writeStatus(systemUpgradeStatusData{
			State:       "rollback_failed",
			FromVersion: oldVersion,
			ToVersion:   version,
			Stage:       "starting_helper",
			Message:     "升级 helper 启动失败，原配置已恢复",
		})
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	// 后台上报安装统计，不阻塞响应
	go func() {
		licenseURL := os.Getenv("LICENSE_SERVER_URL")
		if licenseURL == "" {
			licenseURL = "https://sq.abai.eu.org"
		}
		client := &http.Client{Timeout: 3 * time.Second}
		req, _ := http.NewRequest("GET", licenseURL+"/api/stats/install", nil)
		client.Do(req)
	}()

	response.WriteJSON(w, response.OK(systemUpgradeRunData{
		Version:         version,
		Channel:         channel,
		ComposeAsset:    composeAsset,
		HelperContainer: helperContainer,
		BackendImageID:  imageID,
		Message:         systemUpgradeMessage,
	}))
}
