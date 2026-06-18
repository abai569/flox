package contract_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"go-backend/internal/http/response"
	"go-backend/internal/security"
	"go-backend/internal/store/repo"
)

func startMockNodeSession(t *testing.T, baseURL string, nodeSecret string) func() {
	t.Helper()
	u, err := url.Parse(baseURL)
	if err != nil {
		t.Fatalf("parse provider url: %v", err)
	}
	if strings.EqualFold(u.Scheme, "https") {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	u.Path = "/system-info"
	q := u.Query()
	q.Set("type", "1")
	q.Set("secret", nodeSecret)
	q.Set("version", "v1")
	q.Set("http", "1")
	q.Set("tls", "1")
	q.Set("socks", "1")
	u.RawQuery = q.Encode()

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial mock node websocket: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			_, raw, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			plain := raw
			var wrap struct {
				Encrypted bool   `json:"encrypted"`
				Data      string `json:"data"`
			}
			if err := json.Unmarshal(raw, &wrap); err == nil && wrap.Encrypted && strings.TrimSpace(wrap.Data) != "" {
				crypto, cryptoErr := security.NewAESCrypto(nodeSecret)
				if cryptoErr == nil {
					if dec, decErr := crypto.Decrypt(wrap.Data); decErr == nil {
						plain = []byte(dec)
					}
				}
			}
			var cmd struct {
				Type      string `json:"type"`
				RequestID string `json:"requestId"`
			}
			if err := json.Unmarshal(plain, &cmd); err != nil {
				continue
			}
			if strings.TrimSpace(cmd.RequestID) == "" {
				continue
			}
			respType := fmt.Sprintf("%sResponse", cmd.Type)
			respPayload := map[string]interface{}{
				"type":      respType,
				"success":   true,
				"message":   "OK",
				"requestId": cmd.RequestID,
			}
			respBytes, _ := json.Marshal(respPayload)
			_ = conn.WriteMessage(websocket.TextMessage, respBytes)
		}
	}()

	var stopOnce sync.Once
	return func() {
		stopOnce.Do(func() {
			_ = conn.Close()
			wg.Wait()
		})
	}
}

func waitNodeStatus(t *testing.T, r *repo.Repository, nodeID int64, expectedStatus int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var status int
		if err := r.DB().Raw("SELECT status FROM node WHERE id = ?", nodeID).Scan(&status).Error; err != nil {
			t.Fatalf("query node status: %v", err)
		}
		if status == expectedStatus {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("node %d did not reach status %d within timeout", nodeID, expectedStatus)
}

func requestContractEnvelope(t *testing.T, router http.Handler, token, path string, body interface{}) response.R {
	t.Helper()
	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
	}
	req, err := http.NewRequest("POST", path, bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")

	w := &mockResponseWriter{header: http.Header{}}
	router.ServeHTTP(w, req)

	if w.statusCode != http.StatusOK {
		t.Fatalf("request %s returned status %d: body=%s", path, w.statusCode, string(w.body))
	}

	var env response.R
	if err := json.Unmarshal(w.body, &env); err != nil {
		t.Fatalf("unmarshal envelope from %s: %v", path, err)
	}
	return env
}

type mockResponseWriter struct {
	header     http.Header
	body       []byte
	statusCode int
}

func (w *mockResponseWriter) Header() http.Header { return w.header }
func (w *mockResponseWriter) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	w.body = append(w.body, b...)
	return len(b), nil
}
func (w *mockResponseWriter) WriteHeader(statusCode int) { w.statusCode = statusCode }

func mustContractSlice(t *testing.T, data interface{}, label string) []interface{} {
	t.Helper()
	if data == nil {
		t.Fatalf("%s: data is nil", label)
	}
	s, ok := data.([]interface{})
	if !ok {
		t.Fatalf("%s: expected []interface{}, got %T", label, data)
	}
	return s
}

func contractValueAsInt64(v interface{}) int64 {
	switch val := v.(type) {
	case int64:
		return val
	case float64:
		return int64(val)
	case json.Number:
		n, _ := val.Int64()
		return n
	case int:
		return int64(val)
	default:
		return 0
	}
}

func contractValueAsString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	default:
		return fmt.Sprintf("%v", val)
	}
}
