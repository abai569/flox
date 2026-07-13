package handler

import (
	"context"
	"strings"
	"testing"
)

func TestSystemUpgradeHelperBacksUpAndRollsBack(t *testing.T) {
	script := (&systemUpgradeExecutor{}).helperScript()
	for _, expected := range []string{
		`cp /app/data/gost.db "$BACKUP_DIR/gost.db"`,
		`pg_dump --clean --if-exists`,
		`rollback "health_check"`,
		`status_write "rolled_back"`,
		`status_write "rollback_failed"`,
	} {
		if !strings.Contains(script, expected) {
			t.Fatalf("helper script missing %q", expected)
		}
	}
}

func TestSystemUpgradeHelperArgsIncludeRollbackInputs(t *testing.T) {
	exec := &systemUpgradeExecutor{
		deployDir:        defaultPanelDeployDir,
		backendContainer: defaultPanelBackendName,
	}
	args, err := exec.buildHelperRunArgs(
		"sha256:backend",
		"sha256:frontend",
		"helper",
		"1234",
		"4.3.2",
		"4.3.3",
	)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	for _, expected := range []string{
		systemUpgradeBackupRoot + ":" + systemUpgradeBackupRoot,
		"OLD_BACKEND_IMAGE=sha256:backend",
		"OLD_FRONTEND_IMAGE=sha256:frontend",
		"OLD_VERSION=4.3.2",
		"TARGET_VERSION=4.3.3",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("helper args missing %q", expected)
		}
	}
}

func TestSystemUpgradeStatusRoundTrip(t *testing.T) {
	exec := &systemUpgradeExecutor{deployDir: t.TempDir()}
	want := systemUpgradeStatusData{
		State:       "rolled_back",
		FromVersion: "4.3.2",
		ToVersion:   "4.3.3",
		Stage:       "health_check",
		Message:     "升级失败，已自动回滚到原版本",
	}
	if err := exec.writeStatus(want); err != nil {
		t.Fatal(err)
	}
	got, err := exec.readStatus()
	if err != nil {
		t.Fatal(err)
	}
	if got.State != want.State || got.Stage != want.Stage || got.UpdatedAt == 0 {
		t.Fatalf("unexpected status: %+v", got)
	}
}

func TestCurrentContainerImageRejectsUnsafeName(t *testing.T) {
	if _, err := currentContainerImage(context.Background(), "bad name"); err == nil {
		t.Fatal("expected unsafe container name error")
	}
}
