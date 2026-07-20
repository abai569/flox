package handler

import (
	"database/sql"
	"errors"
	"reflect"
	"testing"

	"go-backend/internal/store/model"
	"go-backend/internal/store/repo"
)

func TestBuildForwardControlServiceNamesPauseResume(t *testing.T) {
	base := "12_34_56"
	want := []string{base + "_tcp", base + "_udp"}

	for _, command := range []string{"PauseService", "ResumeService"} {
		got := buildForwardControlServiceNames(base, command)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("command %s expected %v, got %v", command, want, got)
		}
	}
}

func TestBuildForwardControlServiceNamesDelete(t *testing.T) {
	base := "12_34_56"
	want := []string{base, base + "_tcp", base + "_udp"}
	got := buildForwardControlServiceNames(base, " DeleteService ")
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestIsNotActiveShareForwardError(t *testing.T) {
	if !isNotActiveShareForwardError(errors.New(`service "143_1_0" is not an active share forward`)) {
		t.Fatal("expected active share forward error to be recognized")
	}
	if isNotActiveShareForwardError(errors.New("service already exists")) {
		t.Fatal("did not expect unrelated error to be recognized")
	}
}

func TestBuildForwardServiceBaseCandidates(t *testing.T) {
	got := buildForwardServiceBaseCandidates(12, 34, 56, []int64{56, 78, 90})
	want := []string{"12_34_56", "12_34_78", "12_34_90", "12_34_0"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestBuildForwardServiceBaseCandidatesWithZeroPreferred(t *testing.T) {
	got := buildForwardServiceBaseCandidates(12, 34, 0, []int64{78, 0, 90})
	want := []string{"12_34_0", "12_34_78", "12_34_90"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
}

func TestBuildForwardServiceBaseWithResolvedUserTunnel(t *testing.T) {
	got := buildForwardServiceBaseWithResolvedUserTunnel(12, 34, 56)
	if got != "12_34_56" {
		t.Fatalf("expected 12_34_56, got %s", got)
	}
}

func TestBuildForwardServiceBaseWithResolvedUserTunnelFallbackToZero(t *testing.T) {
	got := buildForwardServiceBaseWithResolvedUserTunnel(12, 34, 0)
	if got != "12_34_0" {
		t.Fatalf("expected 12_34_0, got %s", got)
	}
}

func TestShouldTryLegacySingleService(t *testing.T) {
	if !shouldTryLegacySingleService("PauseService") {
		t.Fatalf("PauseService should require legacy fallback")
	}
	if !shouldTryLegacySingleService("resumeService") {
		t.Fatalf("ResumeService should require legacy fallback")
	}
	if shouldTryLegacySingleService("DeleteService") {
		t.Fatalf("DeleteService should not require legacy fallback")
	}
}

func TestShouldSelfHealForwardServiceControl(t *testing.T) {
	if !shouldSelfHealForwardServiceControl("PauseService") {
		t.Fatalf("PauseService should trigger self-heal")
	}
	if !shouldSelfHealForwardServiceControl(" resumeService ") {
		t.Fatalf("ResumeService should trigger self-heal")
	}
	if shouldSelfHealForwardServiceControl("DeleteService") {
		t.Fatalf("DeleteService should not trigger self-heal")
	}
}

func TestControlForwardServiceCommandHandledOnKnownVariant(t *testing.T) {
	bases := []string{"12_34_56"}
	called := make([]string, 0)
	handled, lastNotFoundErr, err := controlForwardServiceCommand(bases, "PauseService", func(name string) error {
		called = append(called, name)
		if name == "12_34_56_udp" {
			return nil
		}
		return errors.New("service " + name + " not found")
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !handled {
		t.Fatalf("expected handled=true")
	}
	if lastNotFoundErr != nil {
		t.Fatalf("expected lastNotFoundErr=nil when handled")
	}
	wantCalls := []string{"12_34_56_tcp", "12_34_56_udp", "12_34_56"}
	if !reflect.DeepEqual(called, wantCalls) {
		t.Fatalf("expected calls %v, got %v", wantCalls, called)
	}
}

func TestControlForwardServiceCommandReturnsLastNotFoundWhenAllMissing(t *testing.T) {
	bases := []string{"12_34_56"}
	handled, lastNotFoundErr, err := controlForwardServiceCommand(bases, "PauseService", func(name string) error {
		return errors.New("service " + name + " not found")
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if handled {
		t.Fatalf("expected handled=false")
	}
	if lastNotFoundErr == nil {
		t.Fatalf("expected lastNotFoundErr when all variants are missing")
	}
}

func TestDeleteForwardServiceCandidatesSkipsNotFoundUntilLegacyMatch(t *testing.T) {
	bases := []string{"12_34_56", "12_34_0"}
	called := make([]string, 0)
	err := deleteForwardServiceCandidates(bases, func(name string) error {
		called = append(called, name)
		if name == "12_34_0" {
			return nil
		}
		return errors.New("service " + name + " not found")
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	wantCalls := []string{"12_34_56_tcp", "12_34_56_udp", "12_34_56", "12_34_0_tcp", "12_34_0_udp", "12_34_0"}
	if !reflect.DeepEqual(called, wantCalls) {
		t.Fatalf("expected calls %v, got %v", wantCalls, called)
	}
}

func TestDeleteForwardServiceCandidatesTreatsAllMissingAsSuccess(t *testing.T) {
	bases := []string{"12_34_56", "12_34_0"}
	err := deleteForwardServiceCandidates(bases, func(name string) error {
		return errors.New("service " + name + " not found")
	})
	if err != nil {
		t.Fatalf("all-missing delete should be tolerated, got %v", err)
	}
}

func TestForwardServiceBaseCandidatesIncludesResolvedAndLegacyZero(t *testing.T) {
	bases := buildForwardServiceBaseCandidates(46, 9, 123, []int64{123, 77, 0})
	want := []string{"46_9_123", "46_9_77", "46_9_0"}
	if !reflect.DeepEqual(bases, want) {
		t.Fatalf("expected %v, got %v", want, bases)
	}
}

func TestDeleteForwardServiceBasesOnNodeRetriesLegacyZeroResidue(t *testing.T) {
	bases := []string{"46_9_123", "46_9_0"}
	called := make([]string, 0)
	err := deleteForwardServiceCandidates(bases, func(name string) error {
		called = append(called, name)
		if name == "46_9_0_tcp" || name == "46_9_0_udp" {
			return nil
		}
		return errors.New("service " + name + " not found")
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"46_9_123_tcp", "46_9_123_udp", "46_9_123", "46_9_0_tcp", "46_9_0_udp", "46_9_0"}
	if !reflect.DeepEqual(called, want) {
		t.Fatalf("expected calls %v, got %v", want, called)
	}
}

func TestDeleteForwardServiceCandidatesDeletesAllMatchingVariants(t *testing.T) {
	bases := []string{"57_7_7", "57_7_0"}
	called := make([]string, 0)
	err := deleteForwardServiceCandidates(bases, func(name string) error {
		called = append(called, name)
		switch name {
		case "57_7_7_tcp", "57_7_7_udp", "57_7_0_tcp", "57_7_0_udp":
			return nil
		default:
			return errors.New("service " + name + " not found")
		}
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"57_7_7_tcp", "57_7_7_udp", "57_7_7", "57_7_0_tcp", "57_7_0_udp", "57_7_0"}
	if !reflect.DeepEqual(called, want) {
		t.Fatalf("expected calls %v, got %v", want, called)
	}
}

func TestValidateForwardPortAvailabilityRejectsOtherForwardOccupancy(t *testing.T) {
	h := &Handler{repo: nil}
	node := &nodeRecord{ID: 9, Name: "test-node"}
	_ = h
	_ = node

	rawRepo, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	h = &Handler{repo: rawRepo}
	if err := rawRepo.DB().Exec(`INSERT INTO forward_port(forward_id, node_id, port) VALUES(1, 9, 2000)`).Error; err != nil {
		t.Fatalf("insert forward port: %v", err)
	}

	err = h.validateForwardPortAvailability(&nodeRecord{ID: 9, Name: "test-node"}, 2000, 2)
	if err == nil {
		t.Fatalf("expected occupancy error")
	}
	if err.Error() != "节点 test-node 端口 2000 已被其他转发占用" {
		t.Fatalf("unexpected error: %v", err)
	}

	err = h.validateForwardPortAvailability(&nodeRecord{ID: 9, Name: "test-node"}, 2000, 1)
	if err != nil {
		t.Fatalf("same forward should be allowed, got %v", err)
	}
}

func TestResolveEffectiveForwardSpeedLimitUsesSmallestPositiveLimit(t *testing.T) {
	rawRepo, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	h := &Handler{repo: rawRepo}
	if err := rawRepo.DB().Create(&model.User{ID: 1001, User: "limit-user", RoleID: 1, ForwardSpeedLimit: 40, SpeedLimit: 30}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := rawRepo.DB().Create(&model.UserTunnel{ID: 1001, UserID: 1001, TunnelID: 1001, SpeedID: sql.NullInt64{Int64: 1001, Valid: true}, ForwardSpeedLimit: sql.NullInt64{Int64: 20, Valid: true}}).Error; err != nil {
		t.Fatalf("create user tunnel: %v", err)
	}
	if err := rawRepo.DB().Create(&model.SpeedLimit{ID: 1001, Name: "active", Speed: 25, Status: 1}).Error; err != nil {
		t.Fatalf("create speed limit: %v", err)
	}
	if err := rawRepo.DB().Create(&model.SpeedLimit{ID: 1002, Name: "forward", Speed: 22, Status: 1}).Error; err != nil {
		t.Fatalf("create forward speed limit: %v", err)
	}
	limit, enabled := h.resolveEffectiveForwardSpeedLimit(&forwardRecord{
		UserID:            1001,
		TunnelID:          1001,
		SpeedID:           sql.NullInt64{Int64: 1002, Valid: true},
		SpeedLimitEnabled: true,
		SpeedLimit:        35,
	})
	if !enabled || limit != 20 {
		t.Fatalf("expected smallest positive limit 20, got enabled=%v limit=%d", enabled, limit)
	}
}

func TestNormalizeSpeedLimitReferenceRejectsDisabledAndClearsMissingRule(t *testing.T) {
	rawRepo, err := repo.Open(":memory:")
	if err != nil {
		t.Fatalf("open repo: %v", err)
	}
	h := &Handler{repo: rawRepo}
	if err := rawRepo.DB().Create(&model.SpeedLimit{ID: 1, Name: "disabled", Speed: 10, Status: 0}).Error; err != nil {
		t.Fatalf("create disabled speed limit: %v", err)
	}
	disabledID := int64(1)
	if _, err := h.normalizeSpeedLimitReference(&disabledID); err == nil {
		t.Fatal("expected disabled rule to be rejected")
	}
	missingID := int64(99)
	if normalized, err := h.normalizeSpeedLimitReference(&missingID); err != nil || normalized != nil {
		t.Fatalf("expected missing rule to be cleared, got normalized=%v err=%v", normalized, err)
	}
}

func TestControlForwardServiceCommandReturnsHardError(t *testing.T) {
	bases := []string{"12_34_56"}
	handled, lastNotFoundErr, err := controlForwardServiceCommand(bases, "PauseService", func(name string) error {
		if name == "12_34_56_tcp" {
			return errors.New("network timeout")
		}
		return nil
	})
	if err == nil {
		t.Fatalf("expected hard error")
	}
	if handled {
		t.Fatalf("expected handled=false on hard error")
	}
	if lastNotFoundErr != nil {
		t.Fatalf("did not expect not-found error alongside hard error")
	}
}

func TestIsAlreadyExistsMessage(t *testing.T) {
	if !isAlreadyExistsMessage("service demo already exists") {
		t.Fatalf("expected already exists message to be tolerated")
	}
	if !isAlreadyExistsMessage("服务已存在") {
		t.Fatalf("expected Chinese already exists message to be tolerated")
	}
	if !isAlreadyExistsMessage("service demo alreadyexists") {
		t.Fatalf("missing-space alreadyexists should be tolerated")
	}
	if isAlreadyExistsMessage("listen tcp [::]:10001: bind: address already in use") {
		t.Fatalf("address already in use must not be treated as already exists")
	}
	if isAlreadyExistsMessage("create service 57_7_7_tcp failed: listen tcp4 0.0.0.0:46222: bind: address alreadyin use") {
		t.Fatalf("alreadyin-use variant must not be treated as already exists")
	}
}

func TestIsBindAddressInUseError(t *testing.T) {
	if !isBindAddressInUseError(errors.New("listen tcp [::]:10001: bind: address already in use")) {
		t.Fatalf("address already in use should be detected")
	}
	if !isBindAddressInUseError(errors.New("listen tcp4 13.228.170.187:16765: bind: cannot assign requested address")) {
		t.Fatalf("cannot assign requested address should be detected")
	}
	if isBindAddressInUseError(errors.New("service demo already exists")) {
		t.Fatalf("already exists should not be treated as bind conflict")
	}
	if isBindAddressInUseError(nil) {
		t.Fatalf("nil error should not be treated as bind conflict")
	}
}

func TestIsAddressAlreadyInUseError(t *testing.T) {
	if !isAddressAlreadyInUseError(errors.New("listen tcp [::]:10001: bind: address already in use")) {
		t.Fatalf("address already in use should be detected")
	}
	if !isAddressAlreadyInUseError(errors.New("create service 57_7_7_tcp failed: listen tcp4 0.0.0.0:46222: bind: address alreadyin use")) {
		t.Fatalf("missing-space alreadyin-use variant should be detected")
	}
	if isAddressAlreadyInUseError(errors.New("listen tcp4 13.228.170.187:16765: bind: cannot assign requested address")) {
		t.Fatalf("cannot assign requested address should not be treated as address-in-use")
	}
}

func TestIsCannotAssignRequestedAddressError(t *testing.T) {
	if !isCannotAssignRequestedAddressError(errors.New("listen tcp4 13.228.170.187:16765: bind: cannot assign requested address")) {
		t.Fatalf("cannot assign requested address should be detected")
	}
	if !isCannotAssignRequestedAddressError(errors.New("listen tcp4 13.228.170.187:16765: bind: cannotassignrequestedaddress")) {
		t.Fatalf("missing-space cannotassignrequestedaddress variant should be detected")
	}
	if isCannotAssignRequestedAddressError(errors.New("listen tcp [::]:10001: bind: address already in use")) {
		t.Fatalf("address already in use should not be treated as cannot-assign")
	}
}

func TestRetryTunnelServiceAddWithCleanupRetriesOnAddressInUse(t *testing.T) {
	addCalls := 0
	cleanupCalls := 0
	err := retryTunnelServiceAddWithCleanup(
		func() error {
			addCalls++
			if addCalls == 1 {
				return errors.New("listen tcp 10.0.0.1:32000: bind: address already in use")
			}
			return nil
		},
		func() error {
			cleanupCalls++
			return nil
		},
		0,
	)
	if err != nil {
		t.Fatalf("expected retry to succeed, got %v", err)
	}
	if addCalls != 2 {
		t.Fatalf("expected 2 add attempts, got %d", addCalls)
	}
	if cleanupCalls != 1 {
		t.Fatalf("expected 1 cleanup attempt, got %d", cleanupCalls)
	}
}

func TestRetryTunnelServiceAddWithCleanupSkipsCleanupOnNonBindError(t *testing.T) {
	addCalls := 0
	cleanupCalls := 0
	err := retryTunnelServiceAddWithCleanup(
		func() error {
			addCalls++
			return errors.New("network timeout")
		},
		func() error {
			cleanupCalls++
			return nil
		},
		0,
	)
	if err == nil {
		t.Fatalf("expected hard error")
	}
	if addCalls != 1 {
		t.Fatalf("expected 1 add attempt, got %d", addCalls)
	}
	if cleanupCalls != 0 {
		t.Fatalf("expected 0 cleanup attempts, got %d", cleanupCalls)
	}
}

func TestRetryTunnelServiceAddWithCleanupReturnsCleanupError(t *testing.T) {
	cleanupErr := errors.New("delete failed")
	err := retryTunnelServiceAddWithCleanup(
		func() error {
			return errors.New("listen tcp 10.0.0.1:32000: bind: address already in use")
		},
		func() error {
			return cleanupErr
		},
		0,
	)
	if !errors.Is(err, cleanupErr) {
		t.Fatalf("expected cleanup error %v, got %v", cleanupErr, err)
	}
}

func TestBuildForwardServiceConfigs_UsesBindIPForListen(t *testing.T) {
	forward := &forwardRecord{RemoteAddr: "1.2.3.4:80", Strategy: "fifo", TunnelID: 7}
	node := &nodeRecord{TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	services := buildForwardServiceConfigs("1_2_0", forward, nil, node, 22000, "10.9.8.7", nil, false)
	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	for _, svc := range services {
		addr, _ := svc["addr"].(string)
		if addr != "10.9.8.7:22000" {
			t.Fatalf("expected bind IP address 10.9.8.7:22000, got %q", addr)
		}
	}
}

func TestBuildForwardServiceConfigs_DefaultListenAddrWhenBindIPEmpty(t *testing.T) {
	forward := &forwardRecord{RemoteAddr: "1.2.3.4:80", Strategy: "fifo", TunnelID: 7}
	node := &nodeRecord{TCPListenAddr: "0.0.0.0", UDPListenAddr: "[::]"}
	services := buildForwardServiceConfigs("1_2_0", forward, nil, node, 22001, "", nil, false)
	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	tcpAddr, _ := services[0]["addr"].(string)
	udpAddr, _ := services[1]["addr"].(string)
	if tcpAddr != "0.0.0.0:22001" {
		t.Fatalf("expected tcp addr 0.0.0.0:22001, got %q", tcpAddr)
	}
	if udpAddr != "[::]:22001" {
		t.Fatalf("expected udp addr [::]:22001, got %q", udpAddr)
	}
}

func TestBuildForwardServiceConfigsWithLimiterNameUsesInlineLimiter(t *testing.T) {
	forward := &forwardRecord{RemoteAddr: "1.2.3.4:80", Strategy: "fifo", TunnelID: 7}
	node := &nodeRecord{TCPListenAddr: "0.0.0.0", UDPListenAddr: "0.0.0.0"}
	services := buildForwardServiceConfigsWithLimiterName("1_2_0", forward, nil, node, 22001, "", "forward_31_speed", false)
	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	for _, svc := range services {
		if got := svc["limiter"]; got != "forward_31_speed" {
			t.Fatalf("expected inline limiter name, got %#v", got)
		}
	}
}

func TestBuildLimiterAddPayloadByNameUsesMbpsAsBytesPerSecond(t *testing.T) {
	name, payload := buildLimiterAddPayloadByName("forward_31_speed", 10)
	if name != "forward_31_speed" {
		t.Fatalf("expected limiter name forward_31_speed, got %q", name)
	}
	limits, ok := payload["limits"].([]string)
	if !ok || len(limits) != 1 {
		t.Fatalf("expected one limiter rule, got %#v", payload["limits"])
	}
	if limits[0] != "$ 1250000B 1250000B" {
		t.Fatalf("expected 10 Mbps to become 1250000 bytes/s, got %q", limits[0])
	}
}

func TestShouldManageLimiterOnNodeRejectsRemoteProvider(t *testing.T) {
	if shouldManageLimiterOnNode(nil) {
		t.Fatal("expected nil node to skip limiter management")
	}
	if shouldManageLimiterOnNode(&nodeRecord{IsRemote: 1}) {
		t.Fatal("expected remote node to skip limiter management")
	}
	if !shouldManageLimiterOnNode(&nodeRecord{}) {
		t.Fatal("expected local node to manage limiters")
	}
}
func TestBuildForwardServiceConfigs_BindIPAlreadyContainsPort(t *testing.T) {
	forward := &forwardRecord{RemoteAddr: "1.2.3.4:80", Strategy: "fifo", TunnelID: 7}
	node := &nodeRecord{TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
	services := buildForwardServiceConfigs("1_2_0", forward, nil, node, 55555, "3.3.3.3:12345", nil, false)
	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	for _, svc := range services {
		addr, _ := svc["addr"].(string)
		if addr != "3.3.3.3:12345" {
			t.Fatalf("expected bind IP with port 3.3.3.3:12345, got %q", addr)
		}
	}
}

func TestBuildForwardServiceConfigs_IPv6BindIP(t *testing.T) {
	tests := []struct {
		name     string
		bindIP   string
		port     int
		wantAddr string
	}{
		{
			name:     "pure ipv6 without port",
			bindIP:   "2001:db8::1",
			port:     22000,
			wantAddr: "[2001:db8::1]:22000",
		},
		{
			name:     "bracketed ipv6 without port",
			bindIP:   "[2001:db8::2]",
			port:     22001,
			wantAddr: "[2001:db8::2]:22001",
		},
		{
			name:     "bracketed ipv6 with port",
			bindIP:   "[2001:db8::3]:8080",
			port:     55555,
			wantAddr: "[2001:db8::3]:8080",
		},
		{
			name:     "ipv6 link-local with zone",
			bindIP:   "fe80::1%eth0",
			port:     22002,
			wantAddr: "[fe80::1%eth0]:22002",
		},
		{
			name:     "ipv6 localhost",
			bindIP:   "::1",
			port:     22003,
			wantAddr: "[::1]:22003",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			forward := &forwardRecord{RemoteAddr: "1.2.3.4:80", Strategy: "fifo", TunnelID: 7}
			node := &nodeRecord{TCPListenAddr: "[::]", UDPListenAddr: "[::]"}
			services := buildForwardServiceConfigs("1_2_0", forward, nil, node, tt.port, tt.bindIP, nil, false)
			if len(services) != 2 {
				t.Fatalf("expected 2 services, got %d", len(services))
			}
			for _, svc := range services {
				addr, _ := svc["addr"].(string)
				if addr != tt.wantAddr {
					t.Fatalf("expected addr %q, got %q", tt.wantAddr, addr)
				}
			}
		})
	}
}

func TestBuildForwardServiceConfigsPreservesDomainTargetsForServiceBackedModes(t *testing.T) {
	tests := []struct {
		name string
		mode string
	}{
		{name: "gost", mode: forwardModeGost},
		{name: "floxcore", mode: forwardModeFloxcore},
		{name: "sdwan", mode: forwardModeSDWAN},
		{name: "mimic", mode: forwardModeMimic},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			forward := &forwardRecord{RemoteAddr: "dynamic.example.com:443", Strategy: "fifo", TunnelID: 7, Mode: tt.mode}
			node := &nodeRecord{TCPListenAddr: "0.0.0.0", UDPListenAddr: "0.0.0.0"}
			services := buildForwardServiceConfigs("1_2_0", forward, nil, node, 22000, "", nil, false)

			assertForwarderNodeAddr(t, services, "dynamic.example.com:443")
		})
	}
}

func TestBuildForwardServiceConfigsMimicIsTCPOnly(t *testing.T) {
	forward := &forwardRecord{RemoteAddr: "dynamic.example.com:443", Strategy: "fifo", TunnelID: 7, Mode: forwardModeMimic}
	node := &nodeRecord{TCPListenAddr: "0.0.0.0", UDPListenAddr: "0.0.0.0"}
	services := buildForwardServiceConfigs("1_2_0", forward, nil, node, 22000, "", nil, false)

	if len(services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(services))
	}
	service := services[0]
	handler, ok := service["handler"].(map[string]interface{})
	if !ok {
		t.Fatalf("service missing handler: %#v", service)
	}
	if handler["type"] != "tcp" {
		t.Fatalf("expected tcp handler, got %#v", handler["type"])
	}
	metadata, ok := service["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("service missing metadata: %#v", service)
	}
	if metadata["kernel"] != forwardModeMimic {
		t.Fatalf("expected mimic kernel, got %#v", metadata["kernel"])
	}
}

func TestBuildSDWANExitServiceConfigsPreservesDomainTargets(t *testing.T) {
	h := &Handler{}
	forward := &forwardRecord{RemoteAddr: "dynamic.example.com:443", Strategy: "fifo", TunnelID: 7, Mode: forwardModeSDWAN}
	node := &nodeRecord{}
	services, err := h.buildSDWANExitServiceConfigs("1_2_0_tcp", "tcp", node, 22000, forward, "forward_31_speed")
	if err != nil {
		t.Fatalf("buildSDWANExitServiceConfigs returned error: %v", err)
	}
	if got := services[0]["limiter"]; got != "forward_31_speed" {
		t.Fatalf("expected SDWAN exit limiter name, got %#v", got)
	}

	assertForwarderNodeAddr(t, services, "dynamic.example.com:443")
}

func assertForwarderNodeAddr(t *testing.T, services []map[string]interface{}, want string) {
	t.Helper()
	if len(services) == 0 {
		t.Fatalf("expected services")
	}
	for _, service := range services {
		forwarder, ok := service["forwarder"].(map[string]interface{})
		if !ok {
			t.Fatalf("service %v missing forwarder", service["name"])
		}
		nodes, ok := forwarder["nodes"].([]map[string]interface{})
		if !ok || len(nodes) != 1 {
			t.Fatalf("service %v expected 1 forwarder node, got %#v", service["name"], forwarder["nodes"])
		}
		addr, _ := nodes[0]["addr"].(string)
		if addr != want {
			t.Fatalf("service %v expected target %q, got %q", service["name"], want, addr)
		}
	}
}

func TestProcessServerAddress_StripsURLSchemeAndPath(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "https with path",
			in:   "https://panel.example.com:8443/api/v1",
			want: "panel.example.com:8443",
		},
		{
			name: "wss with query",
			in:   "wss://panel.example.com:443/system-info?x=1",
			want: "panel.example.com:443",
		},
		{
			name: "http without port",
			in:   "http://panel.example.com",
			want: "panel.example.com",
		},
		{
			name: "manual host with trailing path",
			in:   "panel.example.com:8080/path",
			want: "panel.example.com:8080",
		},
	}

	for _, tt := range tests {
		if got := processServerAddress(tt.in); got != tt.want {
			t.Fatalf("%s: expected %q, got %q", tt.name, tt.want, got)
		}
	}
}

func TestProcessServerAddress_NormalizesIPv6(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "ipv6 host only",
			in:   "2001:db8::1",
			want: "[2001:db8::1]",
		},
		{
			name: "ipv6 host and port",
			in:   "https://[2001:db8::1]:8443/path",
			want: "[2001:db8::1]:8443",
		},
		{
			name: "already bracketed",
			in:   "[2001:db8::2]:9000",
			want: "[2001:db8::2]:9000",
		},
	}

	for _, tt := range tests {
		if got := processServerAddress(tt.in); got != tt.want {
			t.Fatalf("%s: expected %q, got %q", tt.name, tt.want, got)
		}
	}
}

func TestBuildNftablesRulePayloads_ChainExitIPv6Target(t *testing.T) {
	rules := buildNftablesRulePayloads(
		&forwardRecord{ID: 11, UserID: 22, RemoteAddr: "[2a0e:97c0:3f0:1::1086]:26200"},
		&tunnelRecord{Type: 2},
		[]forwardPortRecord{{NodeID: 1, Port: 18080}, {NodeID: 2, Port: 19090}},
		[]chainNodeRecord{{NodeID: 1, ChainType: 1}, {NodeID: 2, ChainType: 3}},
		nil,
		0,
		nil,
	)

	var exitRule *NftablesRulePayload
	for i := range rules {
		if rules[i].NodeID == 2 && rules[i].Protocol == "tcp" {
			exitRule = &rules[i]
			break
		}
	}
	if exitRule == nil {
		t.Fatalf("expected tcp exit rule, got %#v", rules)
	}
	if exitRule.Target != "" {
		t.Fatalf("expected empty IPv4 target for IPv6-only rule, got %q", exitRule.Target)
	}
	if exitRule.NextHopIPv6 != "2a0e:97c0:3f0:1::1086" {
		t.Fatalf("expected raw IPv6 host, got %q", exitRule.NextHopIPv6)
	}
	if exitRule.NextHopPort != 26200 {
		t.Fatalf("expected IPv6 target port 26200, got %d", exitRule.NextHopPort)
	}
}
