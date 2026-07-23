package socket

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestBuildWebSocketCandidatesSecureFirst(t *testing.T) {
	candidates := buildWebSocketCandidates("panel.example.com:443", "abc", "2.0.2", 1, 0, 1, 0, "", "")

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "wss://") {
		t.Fatalf("expected first candidate to start with wss://, got %s", candidates[0])
	}
}

func TestBuildWebSocketCandidatesUsesPreferredScheme(t *testing.T) {
	candidates := buildWebSocketCandidates("panel.example.com:443", "abc", "2.0.2", 1, 0, 1, 0, "ws", "")

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "ws://") {
		t.Fatalf("expected preferred ws:// candidate first, got %s", candidates[0])
	}
}

func TestBuildWebSocketCandidatesNormalizesSchemePrefixedAddr(t *testing.T) {
	candidates := buildWebSocketCandidates("https://panel.example.com:443/path?q=1", "abc", "2.0.2", 0, 0, 0, 0, "", "")

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if !strings.HasPrefix(candidates[0], "wss://panel.example.com:443/") {
		t.Fatalf("expected normalized wss candidate, got %s", candidates[0])
	}
}

func TestDialWebSocketDoesNotFallbackToWS(t *testing.T) {
	orig := wsDial
	defer func() { wsDial = orig }()

	var attempts []string
	wsDial = func(_ *websocket.Dialer, rawURL, _ string) (*websocket.Conn, *http.Response, error) {
		attempts = append(attempts, rawURL)
		if strings.HasPrefix(rawURL, "wss://") {
			return nil, nil, errors.New("tls failed")
		}
		return nil, nil, errors.New("connection failed")
	}

	_, usedURL, err := dialWebSocketWithFallback(
		&websocket.Dialer{},
		[]string{"wss://panel.example.com/system-info?type=1"}, "abc",
	)
	if err == nil || usedURL != "" {
		t.Fatalf("expected secure connection failure, url=%s err=%v", usedURL, err)
	}
	if len(attempts) != 1 {
		t.Fatalf("expected 1 attempt, got %d", len(attempts))
	}
	if !strings.HasPrefix(attempts[0], "wss://") {
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
