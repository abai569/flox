package socket

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHandleTcpProbeListenAcceptsConnection(t *testing.T) {
	portListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := portListener.Addr().(*net.TCPAddr).Port
	_ = portListener.Close()
	reporter := &WebSocketReporter{}
	defer reporter.closeAllTCPProbeListeners()
	response, err := reporter.handleTcpProbeListen(map[string]interface{}{
		"family": "ipv4", "durationSec": 5, "portRange": fmt.Sprint(port),
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Port <= 0 {
		t.Fatalf("probe listener port = %d", response.Port)
	}
	if response.ListenerID == "" {
		t.Fatal("probe listener ID is empty")
	}
	conn, err := net.Dial("tcp4", net.JoinHostPort("127.0.0.1", fmt.Sprint(response.Port)))
	if err != nil {
		t.Fatalf("connect probe listener: %v", err)
	}
	_ = conn.Close()
}

func TestHandleTcpProbeCloseClosesListener(t *testing.T) {
	port := availableTCPProbePort(t)
	reporter := &WebSocketReporter{}
	response, err := reporter.handleTcpProbeListen(map[string]interface{}{
		"family": "ipv4", "durationSec": 5, "portRange": fmt.Sprint(port),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := reporter.handleTcpProbeClose(map[string]interface{}{"listenerId": response.ListenerID}); err != nil {
		t.Fatalf("close probe listener: %v", err)
	}
	if conn, err := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)), 100*time.Millisecond); err == nil {
		_ = conn.Close()
		t.Fatal("probe listener still accepts connections after explicit close")
	}
}

func TestTCPProbeListenerTimeoutAndCloseAreIdempotent(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	reporter := &WebSocketReporter{tcpProbeListeners: map[string]net.Listener{"timeout-test": listener}}
	go reporter.serveTCPProbeListener("timeout-test", listener, 20*time.Millisecond)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		reporter.tcpProbeListenersMu.Lock()
		_, exists := reporter.tcpProbeListeners["timeout-test"]
		reporter.tcpProbeListenersMu.Unlock()
		if !exists {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	reporter.tcpProbeListenersMu.Lock()
	_, exists := reporter.tcpProbeListeners["timeout-test"]
	reporter.tcpProbeListenersMu.Unlock()
	if exists {
		t.Fatal("timed out probe listener remains registered")
	}
	if err := reporter.handleTcpProbeClose(map[string]interface{}{"listenerId": "timeout-test"}); err != nil {
		t.Fatalf("close timed out probe listener: %v", err)
	}
}

func TestHandleTcpProbeListenEnforcesConcurrentLimit(t *testing.T) {
	reporter := &WebSocketReporter{}
	defer reporter.closeAllTCPProbeListeners()
	ports := make([]int, 0, maxTCPProbeListeners+1)
	for len(ports) < maxTCPProbeListeners+1 {
		port := availableTCPProbePort(t)
		duplicate := false
		for _, existing := range ports {
			if existing == port {
				duplicate = true
				break
			}
		}
		if !duplicate {
			ports = append(ports, port)
		}
	}
	for i := 0; i < maxTCPProbeListeners; i++ {
		if _, err := reporter.handleTcpProbeListen(map[string]interface{}{
			"family": "ipv4", "durationSec": 5, "portRange": fmt.Sprint(ports[i]),
		}); err != nil {
			t.Fatalf("start probe listener %d: %v", i, err)
		}
	}
	if _, err := reporter.handleTcpProbeListen(map[string]interface{}{
		"family": "ipv4", "durationSec": 5, "portRange": fmt.Sprint(ports[maxTCPProbeListeners]),
	}); err == nil || !strings.Contains(err.Error(), "limit reached") {
		t.Fatalf("expected listener limit error, got %v", err)
	}
}

func availableTCPProbePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return port
}

func TestParseTcpProbePortsPreservesConfiguredSegments(t *testing.T) {
	ports, err := parseTcpProbePorts("12000-12002,13000,12001")
	if err != nil {
		t.Fatal(err)
	}
	want := []int{12000, 12001, 12002, 13000}
	if len(ports) != len(want) {
		t.Fatalf("ports = %v", ports)
	}
	for i := range want {
		if ports[i] != want[i] {
			t.Fatalf("ports = %v, want %v", ports, want)
		}
	}
}

func TestBuildWebSocketCandidatesSecureFirst(t *testing.T) {
	candidates := buildWebSocketCandidates("panel.example.com:443", "abc", "2.0.2", 1, 0, 1, 0, "", "")

	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "wss://") {
		t.Fatalf("expected first candidate to start with wss://, got %s", candidates[0])
	}
	if !strings.HasPrefix(candidates[1], "ws://") {
		t.Fatalf("expected second candidate to start with ws://, got %s", candidates[1])
	}
}

func TestBuildWebSocketCandidatesUsesPreferredScheme(t *testing.T) {
	candidates := buildWebSocketCandidates("panel.example.com:443", "abc", "2.0.2", 1, 0, 1, 0, "ws", "")

	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "ws://") {
		t.Fatalf("expected preferred ws:// candidate first, got %s", candidates[0])
	}
	if !strings.HasPrefix(candidates[1], "wss://") {
		t.Fatalf("expected fallback wss:// candidate second, got %s", candidates[1])
	}
}

func TestBuildWebSocketCandidatesNormalizesSchemePrefixedAddr(t *testing.T) {
	candidates := buildWebSocketCandidates("https://panel.example.com:443/path?q=1", "abc", "2.0.2", 0, 0, 0, 0, "", "")

	if len(candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "wss://panel.example.com:443/") {
		t.Fatalf("expected normalized wss candidate, got %s", candidates[0])
	}
	if !strings.HasPrefix(candidates[1], "ws://panel.example.com:443/") {
		t.Fatalf("expected normalized ws fallback candidate, got %s", candidates[1])
	}
}

func TestDialWebSocketWithFallbackTriesWSAfterWSSFailure(t *testing.T) {
	orig := wsDial
	defer func() { wsDial = orig }()

	var attempts []string
	wsDial = func(_ *websocket.Dialer, rawURL, _ string) (*websocket.Conn, *http.Response, error) {
		attempts = append(attempts, rawURL)
		if strings.HasPrefix(rawURL, "wss://") {
			return nil, nil, errors.New("tls failed")
		}
		return &websocket.Conn{}, nil, nil
	}

	_, usedURL, err := dialWebSocketWithFallback(
		&websocket.Dialer{},
		[]string{
			"wss://panel.example.com/system-info?type=1",
			"ws://panel.example.com/system-info?type=1",
		}, "abc",
	)
	if err != nil {
		t.Fatalf("expected fallback success, got err=%v", err)
	}
	if !strings.HasPrefix(usedURL, "ws://") {
		t.Fatalf("expected fallback ws:// url, got %s", usedURL)
	}
	if len(attempts) != 2 {
		t.Fatalf("expected 2 attempts, got %d", len(attempts))
	}
	if !strings.HasPrefix(attempts[0], "wss://") || !strings.HasPrefix(attempts[1], "ws://") {
		t.Fatalf("unexpected attempt order: %#v", attempts)
	}
}

func TestDetectWebSocketScheme(t *testing.T) {
	if detectWebSocketScheme("wss://panel.example.com/system-info") != "wss" {
		t.Fatalf("expected wss detection")
	}
	if detectWebSocketScheme("ws://panel.example.com/system-info") != "ws" {
		t.Fatalf("expected ws detection")
	}
	if detectWebSocketScheme("http://panel.example.com/system-info") != "" {
		t.Fatalf("expected empty detection for non-websocket scheme")
	}
}

func TestSanitizeWebSocketURL(t *testing.T) {
	raw := "wss://panel.example.com/system-info?type=1&secret=abc&version=2.0.2"
	sanitized := sanitizeWebSocketURL(raw)

	if strings.Contains(sanitized, "secret=abc") {
		t.Fatalf("expected secret to be masked, got %s", sanitized)
	}
	if !strings.Contains(sanitized, "secret=%2A%2A%2A") {
		t.Fatalf("expected masked secret in url, got %s", sanitized)
	}
}

func TestFormatWebSocketDialErrorIncludesHTTPStatus(t *testing.T) {
	err := errors.New("websocket: bad handshake")
	resp := &http.Response{
		Status: "403 Forbidden",
		Body:   io.NopCloser(strings.NewReader("forbidden")),
	}

	msg := formatWebSocketDialError(err, resp)
	if !strings.Contains(msg, "HTTP 403 Forbidden") {
		t.Fatalf("expected status in message, got %s", msg)
	}
	if !strings.Contains(msg, "forbidden") {
		t.Fatalf("expected response body in message, got %s", msg)
	}
}
