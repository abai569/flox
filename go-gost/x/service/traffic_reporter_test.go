package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBuildReportURLCandidatesSecureFirst(t *testing.T) {
	upload, config := buildReportURLCandidates("panel.example.com:443", "abc")

	if len(upload) != 2 {
		t.Fatalf("expected 2 upload candidates, got %d", len(upload))
	}
	if len(config) != 2 {
		t.Fatalf("expected 2 config candidates, got %d", len(config))
	}

	if upload[0] != "https://panel.example.com:443/flow/upload?secret=abc" {
		t.Fatalf("unexpected upload[0]: %s", upload[0])
	}
	if upload[1] != "http://panel.example.com:443/flow/upload?secret=abc" {
		t.Fatalf("unexpected upload[1]: %s", upload[1])
	}
	if config[0] != "https://panel.example.com:443/flow/config?secret=abc" {
		t.Fatalf("unexpected config[0]: %s", config[0])
	}
	if config[1] != "http://panel.example.com:443/flow/config?secret=abc" {
		t.Fatalf("unexpected config[1]: %s", config[1])
	}
}

func TestTrafficReportRetryKeepsFrozenBatchSeparateFromNewTraffic(t *testing.T) {
	originalSend := sendTrafficReport
	defer func() { sendTrafficReport = originalSend }()

	manager := &GlobalTrafficManager{
		serviceTraffic: make(map[string]*ServiceTraffic),
		ctx:            context.Background(),
	}
	type sentReport struct {
		id    string
		items []TrafficReportItem
	}
	var reports []sentReport
	sendTrafficReport = func(_ context.Context, reportID string, items []TrafficReportItem) (bool, error) {
		reports = append(reports, sentReport{id: reportID, items: append([]TrafficReportItem(nil), items...)})
		if len(reports) == 1 {
			return false, errors.New("response lost")
		}
		return true, nil
	}

	manager.AddTraffic("svc", 10, 20)
	manager.collectAndReport()
	manager.AddTraffic("svc", 3, 4)
	manager.collectAndReport()
	manager.collectAndReport()

	if len(reports) != 3 {
		t.Fatalf("expected 3 reports, got %d", len(reports))
	}
	if reports[0].id == "" || reports[1].id != reports[0].id {
		t.Fatalf("expected retry to preserve report ID, got %q then %q", reports[0].id, reports[1].id)
	}
	if len(reports[1].items) != 1 || reports[1].items[0] != (TrafficReportItem{N: "svc", U: 10, D: 20}) {
		t.Fatalf("unexpected retry items: %#v", reports[1].items)
	}
	if reports[2].id == reports[0].id {
		t.Fatalf("expected next batch to use a new report ID")
	}
	if len(reports[2].items) != 1 || reports[2].items[0] != (TrafficReportItem{N: "svc", U: 3, D: 4}) {
		t.Fatalf("unexpected next batch items: %#v", reports[2].items)
	}
}

func TestTrafficReportPendingBatchPersistsAcrossRestart(t *testing.T) {
	originalSend := sendTrafficReport
	defer func() { sendTrafficReport = originalSend }()

	statePath := t.TempDir() + "/business_traffic.json"
	manager := &GlobalTrafficManager{
		serviceTraffic: make(map[string]*ServiceTraffic),
		statePath:      statePath,
		ctx:            context.Background(),
	}
	var originalID string
	sendTrafficReport = func(_ context.Context, reportID string, _ []TrafficReportItem) (bool, error) {
		originalID = reportID
		return false, errors.New("response lost")
	}
	manager.AddTraffic("svc", 11, 22)
	manager.collectAndReport()
	manager.AddTraffic("svc", 5, 6)
	manager.persistState()

	restored := &GlobalTrafficManager{serviceTraffic: make(map[string]*ServiceTraffic), ctx: context.Background()}
	if err := restored.configureBusinessTrafficState(statePath); err != nil {
		t.Fatalf("restore traffic state: %v", err)
	}
	if restored.pendingReport == nil {
		t.Fatal("expected pending report after restore")
	}
	if restored.pendingReport.ReportID != originalID {
		t.Fatalf("expected report ID %q after restore, got %q", originalID, restored.pendingReport.ReportID)
	}
	if len(restored.pendingReport.Items) != 1 || restored.pendingReport.Items[0] != (TrafficReportItem{N: "svc", U: 11, D: 22}) {
		t.Fatalf("unexpected restored items: %#v", restored.pendingReport.Items)
	}
	if up, down := restored.GetServiceTraffic("svc"); up != 5 || down != 6 {
		t.Fatalf("expected active traffic 5/6 after restore, got %d/%d", up, down)
	}
}

func TestSendBatchTrafficReportFallbackSharesEnvelope(t *testing.T) {
	originalDo := reportDo
	originalURL := httpReportURL
	originalCrypto := httpAESCrypto
	defer func() {
		reportDo = originalDo
		httpReportURL = originalURL
		httpAESCrypto = originalCrypto
	}()

	httpReportURL = "https://panel.example/flow/upload,http://panel.example/flow/upload"
	httpAESCrypto = nil
	var bodies [][]byte
	reportDo = func(_ context.Context, req *http.Request, _ time.Duration) (*http.Response, error) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		bodies = append(bodies, body)
		call := len(bodies)
		if call == 1 {
			return nil, errors.New("tls handshake failed")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok"))}, nil
	}

	ok, err := sendBatchTrafficReport(context.Background(), "report-123", []TrafficReportItem{{N: "svc", U: 1, D: 2}})
	if !ok || err != nil {
		t.Fatalf("expected fallback success, ok=%v err=%v", ok, err)
	}
	if len(bodies) != 2 || string(bodies[0]) != string(bodies[1]) {
		t.Fatalf("expected identical fallback bodies, got %q and %q", bodies[0], bodies[1])
	}
	var envelope trafficReportEnvelope
	if err := json.Unmarshal(bodies[0], &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.ReportID != "report-123" {
		t.Fatalf("expected report ID report-123, got %q", envelope.ReportID)
	}
}

func TestBuildReportURLCandidatesNormalizeSchemeAddr(t *testing.T) {
	upload, config := buildReportURLCandidates("https://panel.example.com:8443/path", "abc")

	if upload[0] != "https://panel.example.com:8443/flow/upload?secret=abc" {
		t.Fatalf("unexpected upload[0]: %s", upload[0])
	}
	if upload[1] != "http://panel.example.com:8443/flow/upload?secret=abc" {
		t.Fatalf("unexpected upload[1]: %s", upload[1])
	}
	if config[0] != "https://panel.example.com:8443/flow/config?secret=abc" {
		t.Fatalf("unexpected config[0]: %s", config[0])
	}
	if config[1] != "http://panel.example.com:8443/flow/config?secret=abc" {
		t.Fatalf("unexpected config[1]: %s", config[1])
	}
}

func TestPostJSONWithFallbackUsesHTTPAfterHTTPSFailure(t *testing.T) {
	orig := reportDo
	defer func() { reportDo = orig }()

	var calls []string
	reportDo = func(_ context.Context, req *http.Request, _ time.Duration) (*http.Response, error) {
		calls = append(calls, req.URL.String())
		if strings.HasPrefix(req.URL.String(), "https://") {
			return nil, errors.New("tls handshake failed")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("ok")),
		}, nil
	}

	ok, err := postJSONWithFallback(
		context.Background(),
		[]string{
			"https://panel.example.com:443/flow/upload?secret=abc",
			"http://panel.example.com:443/flow/upload?secret=abc",
		},
		[]byte(`[]`),
		"GOST-Traffic-Reporter/1.0",
		5*time.Second,
		nil,
	)
	if !ok || err != nil {
		t.Fatalf("expected fallback success, ok=%v err=%v", ok, err)
	}
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls, got %d", len(calls))
	}
	if !strings.HasPrefix(calls[0], "https://") || !strings.HasPrefix(calls[1], "http://") {
		t.Fatalf("unexpected call order: %#v", calls)
	}
}

func TestPostJSONWithFallbackRemembersDetectedURL(t *testing.T) {
	orig := reportDo
	defer func() { reportDo = orig }()

	targets := []string{
		"https://panel.example.com:443/flow/upload?secret=abc",
		"http://panel.example.com:443/flow/upload?secret=abc",
	}

	var preferred string
	var calls []string
	reportDo = func(_ context.Context, req *http.Request, _ time.Duration) (*http.Response, error) {
		calls = append(calls, req.URL.String())
		if strings.HasPrefix(req.URL.String(), "https://") {
			return nil, errors.New("tls handshake failed")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("ok")),
		}, nil
	}

	ok, err := postJSONWithFallback(
		context.Background(),
		targets,
		[]byte(`[]`),
		"GOST-Traffic-Reporter/1.0",
		5*time.Second,
		&preferred,
	)
	if !ok || err != nil {
		t.Fatalf("expected first call success, ok=%v err=%v", ok, err)
	}
	if preferred != targets[1] {
		t.Fatalf("expected preferred url to be remembered as %s, got %s", targets[1], preferred)
	}
	if len(calls) != 2 {
		t.Fatalf("expected 2 calls on first attempt, got %d", len(calls))
	}

	calls = nil
	ok, err = postJSONWithFallback(
		context.Background(),
		targets,
		[]byte(`[]`),
		"GOST-Traffic-Reporter/1.0",
		5*time.Second,
		&preferred,
	)
	if !ok || err != nil {
		t.Fatalf("expected second call success, ok=%v err=%v", ok, err)
	}
	if len(calls) != 1 {
		t.Fatalf("expected second call to use remembered url once, got %d calls", len(calls))
	}
	if !strings.HasPrefix(calls[0], "http://") {
		t.Fatalf("expected remembered http url first, got %s", calls[0])
	}
}
