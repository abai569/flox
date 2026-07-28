package middleware

import "testing"

func TestShouldSkipFederationRuntimePeerEndpoints(t *testing.T) {
	paths := []string{
		"/api/v1/federation/runtime/reserve-port",
		"/api/v1/federation/runtime/apply-role",
		"/api/v1/federation/runtime/release-role",
		"/api/v1/federation/runtime/diagnose",
		"/api/v1/federation/runtime/service-status",
		"/api/v1/federation/runtime/authoritative-flow",
		"/api/v1/federation/runtime/reset-flow",
		"/api/v1/federation/runtime/command",
	}

	for _, path := range paths {
		if !shouldSkip(path) {
			t.Fatalf("shouldSkip(%q) = false, want true", path)
		}
	}
}

func TestShouldSkipOnlyFederationShareNotify(t *testing.T) {
	if !shouldSkip("/api/v1/federation/share/notify") {
		t.Fatal("share notify must allow provider-to-consumer delivery without panel JWT")
	}
	for _, path := range []string{
		"/api/v1/federation/share/notify/list",
		"/api/v1/federation/share/notify/dismiss",
		"/api/v1/federation/share/create",
	} {
		if shouldSkip(path) {
			t.Fatalf("shouldSkip(%q) = true, want false", path)
		}
	}
}
