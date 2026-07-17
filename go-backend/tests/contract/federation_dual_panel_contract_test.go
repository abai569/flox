package contract_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"go-backend/internal/auth"
	"go-backend/internal/http/response"
	"go-backend/internal/security"
	"go-backend/internal/store/repo"
)

func TestFederationDualPanelMiddleExitAutoPortContract(t *testing.T) {
	providerSecret := "provider-contract-jwt"
	providerRouter, providerRepo := setupContractRouter(t, providerSecret)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	consumerSecret := "consumer-contract-jwt"
	consumerRouter, consumerRepo := setupContractRouter(t, consumerSecret)

	consumerAdminToken, err := auth.GenerateToken(1, "consumer-admin", 0, consumerSecret)
	if err != nil {
		t.Fatalf("generate consumer admin token: %v", err)
	}

	now := time.Now().UnixMilli()
	providerEntryNodeID := insertContractNode(t, providerRepo, "provider-entry", "198.51.100.11", "43000-43010", "provider-entry-secret", 1)
	providerMiddleNodeID := insertContractNode(t, providerRepo, "provider-middle", "198.51.100.12", "44000-44010", "provider-middle-secret", 1)
	providerExitNodeID := insertContractNode(t, providerRepo, "provider-exit", "198.51.100.13", "45000-45010", "provider-exit-secret", 1)

	entryShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "entry-share",
		NodeID:         providerEntryNodeID,
		Token:          "share-entry-token",
		PortRangeStart: 43000,
		PortRangeEnd:   43010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	middleShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "middle-share",
		NodeID:         providerMiddleNodeID,
		Token:          "share-middle-token",
		PortRangeStart: 44000,
		PortRangeEnd:   44010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	exitShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "exit-share",
		NodeID:         providerExitNodeID,
		Token:          "share-exit-token",
		PortRangeStart: 45000,
		PortRangeEnd:   45010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})

	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-entry-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-middle-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-exit-token")

	entryRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-entry-token")
	middleRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-middle-token")
	exitRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-exit-token")

	stopEntry := startMockNodeSession(t, providerServer.URL, "provider-entry-secret")
	defer stopEntry()
	stopMiddle := startMockNodeSession(t, providerServer.URL, "provider-middle-secret")
	defer stopMiddle()
	stopExit := startMockNodeSession(t, providerServer.URL, "provider-exit-secret")
	defer stopExit()

	createTunnel := func(name string) int64 {
		payload := map[string]interface{}{
			"name":   name,
			"type":   2,
			"flow":   99999,
			"status": 1,
			"inNodeId": []map[string]interface{}{
				{"nodeId": entryRemoteNodeID, "protocol": "tls", "strategy": "round"},
			},
			"chainNodes": [][]map[string]interface{}{
				{{"nodeId": middleRemoteNodeID, "protocol": "tls", "strategy": "round"}},
			},
			"outNodeId": []map[string]interface{}{
				{"nodeId": exitRemoteNodeID, "protocol": "tls", "strategy": "round"},
			},
		}
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal create payload: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/create", bytes.NewReader(body))
		req.Header.Set("Authorization", consumerAdminToken)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		consumerRouter.ServeHTTP(res, req)
		assertCode(t, res, 0)

		tunnelID := mustQueryInt64(t, consumerRepo, `SELECT id FROM tunnel WHERE name = ? ORDER BY id DESC LIMIT 1`, name)
		if tunnelID <= 0 {
			t.Fatalf("invalid tunnel id for %s", name)
		}
		return tunnelID
	}

	firstTunnelID := createTunnel("dual-panel-middle-exit-1")

	assertTunnelPortInRange(t, consumerRepo, firstTunnelID, 2, middleRemoteNodeID, 44000, 44010)
	assertTunnelPortInRange(t, consumerRepo, firstTunnelID, 3, exitRemoteNodeID, 45000, 45010)

	assertCount(t, consumerRepo, `SELECT COUNT(1) FROM federation_tunnel_binding WHERE tunnel_id = ? AND status = 1`, firstTunnelID, 2)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, middleShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, exitShareID, 1)

	deleteBody, err := json.Marshal(map[string]interface{}{"id": firstTunnelID})
	if err != nil {
		t.Fatalf("marshal delete payload: %v", err)
	}
	deleteReq := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/delete", bytes.NewReader(deleteBody))
	deleteReq.Header.Set("Authorization", consumerAdminToken)
	deleteReq.Header.Set("Content-Type", "application/json")
	deleteRes := httptest.NewRecorder()
	consumerRouter.ServeHTTP(deleteRes, deleteReq)
	assertCode(t, deleteRes, 0)

	assertCount(t, consumerRepo, `SELECT COUNT(1) FROM federation_tunnel_binding WHERE tunnel_id = ?`, firstTunnelID, 0)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 0`, middleShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 0`, exitShareID, 1)

	secondTunnelID := createTunnel("dual-panel-middle-exit-2")
	assertTunnelPortInRange(t, consumerRepo, secondTunnelID, 2, middleRemoteNodeID, 44000, 44010)
	assertTunnelPortInRange(t, consumerRepo, secondTunnelID, 3, exitRemoteNodeID, 45000, 45010)

	forwardPayload := map[string]interface{}{
		"name":       "dual-panel-remote-entry-forward",
		"tunnelId":   secondTunnelID,
		"remoteAddr": "1.1.1.1:443",
		"strategy":   "fifo",
	}
	forwardBody, err := json.Marshal(forwardPayload)
	if err != nil {
		t.Fatalf("marshal forward payload: %v", err)
	}
	forwardReq := httptest.NewRequest(http.MethodPost, "/api/v1/forward/create", bytes.NewReader(forwardBody))
	forwardReq.Header.Set("Authorization", consumerAdminToken)
	forwardReq.Header.Set("Content-Type", "application/json")
	forwardRes := httptest.NewRecorder()
	consumerRouter.ServeHTTP(forwardRes, forwardReq)
	assertCode(t, forwardRes, 0)

	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, middleShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, exitShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, entryShareID, 1)
}

func TestFederationDualPanelRemoteDiagnosisContract(t *testing.T) {
	providerSecret := "provider-contract-jwt"
	providerRouter, providerRepo := setupContractRouter(t, providerSecret)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	consumerSecret := "consumer-contract-jwt"
	consumerRouter, consumerRepo := setupContractRouter(t, consumerSecret)

	consumerAdminToken, err := auth.GenerateToken(1, "consumer-admin", 0, consumerSecret)
	if err != nil {
		t.Fatalf("generate consumer admin token: %v", err)
	}

	now := time.Now().UnixMilli()
	providerEntryNodeID := insertContractNode(t, providerRepo, "provider-entry-dx", "203.0.113.11", "53000-53010", "provider-entry-dx-secret", 1)
	providerMiddleNodeID := insertContractNode(t, providerRepo, "provider-middle-dx", "203.0.113.12", "54000-54010", "provider-middle-dx-secret", 1)
	providerExitNodeID := insertContractNode(t, providerRepo, "provider-exit-dx", "203.0.113.13", "55000-55010", "provider-exit-dx-secret", 1)

	entryShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "entry-share-dx",
		NodeID:         providerEntryNodeID,
		Token:          "share-entry-dx-token",
		PortRangeStart: 53000,
		PortRangeEnd:   53010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	middleShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "middle-share-dx",
		NodeID:         providerMiddleNodeID,
		Token:          "share-middle-dx-token",
		PortRangeStart: 54000,
		PortRangeEnd:   54010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	exitShareID := insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "exit-share-dx",
		NodeID:         providerExitNodeID,
		Token:          "share-exit-dx-token",
		PortRangeStart: 55000,
		PortRangeEnd:   55010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})

	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-entry-dx-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-middle-dx-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-exit-dx-token")

	entryRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-entry-dx-token")
	middleRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-middle-dx-token")
	exitRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-exit-dx-token")

	stopMiddle := startMockNodeSession(t, providerServer.URL, "provider-middle-dx-secret")
	defer stopMiddle()
	stopExit := startMockNodeSession(t, providerServer.URL, "provider-exit-dx-secret")
	defer stopExit()

	createPayload := map[string]interface{}{
		"name":   "dual-panel-diagnose-remote",
		"type":   2,
		"flow":   99999,
		"status": 1,
		"inNodeId": []map[string]interface{}{
			{"nodeId": entryRemoteNodeID, "protocol": "tls", "strategy": "round"},
		},
		"chainNodes": [][]map[string]interface{}{
			{{"nodeId": middleRemoteNodeID, "protocol": "tls", "strategy": "round"}},
		},
		"outNodeId": []map[string]interface{}{
			{"nodeId": exitRemoteNodeID, "protocol": "tls", "strategy": "round"},
		},
	}
	body, err := json.Marshal(createPayload)
	if err != nil {
		t.Fatalf("marshal create payload: %v", err)
	}
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/create", bytes.NewReader(body))
	createReq.Header.Set("Authorization", consumerAdminToken)
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	consumerRouter.ServeHTTP(createRes, createReq)
	assertCode(t, createRes, 0)

	tunnelID := mustQueryInt64(t, consumerRepo, `SELECT id FROM tunnel WHERE name = ? ORDER BY id DESC LIMIT 1`, "dual-panel-diagnose-remote")
	if tunnelID <= 0 {
		t.Fatalf("invalid tunnel id")
	}

	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, middleShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ? AND status = 1 AND applied = 1`, exitShareID, 1)
	assertCount(t, providerRepo, `SELECT COUNT(1) FROM peer_share_runtime WHERE share_id = ?`, entryShareID, 0)

	diagnoseReq := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/diagnose", bytes.NewBufferString(fmt.Sprintf(`{"tunnelId":%d}`, tunnelID)))
	diagnoseReq.Header.Set("Authorization", consumerAdminToken)
	diagnoseRes := httptest.NewRecorder()
	consumerRouter.ServeHTTP(diagnoseRes, diagnoseReq)

	var out response.R
	if err := json.NewDecoder(diagnoseRes.Body).Decode(&out); err != nil {
		t.Fatalf("decode diagnose response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected diagnose code 0, got %d (%s)", out.Code, out.Msg)
	}

	payload, ok := out.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map payload, got %T", out.Data)
	}
	results, ok := payload["results"].([]interface{})
	if !ok || len(results) == 0 {
		t.Fatalf("expected non-empty results, got %v", payload["results"])
	}

	chainToExitFound := false
	for _, raw := range results {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if valueAsInt(item["fromChainType"]) == 2 && valueAsInt(item["toChainType"]) == 3 {
			chainToExitFound = true
			if !valueAsBool(item["success"]) {
				t.Fatalf("expected chain->exit diagnosis success, got item=%v", item)
			}
			if msg := strings.TrimSpace(valueAsString(item["message"])); msg != "mock tcp ok" {
				t.Fatalf("expected remote diagnosis message 'mock tcp ok', got %q", msg)
			}
		}
	}
	if !chainToExitFound {
		t.Fatalf("expected chain->exit diagnosis item in results")
	}
}

func TestFederationDualPanelRemoteEntryRuntimeContract(t *testing.T) {
	providerSecret := "provider-contract-jwt"
	providerRouter, providerRepo := setupContractRouter(t, providerSecret)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	consumerSecret := "consumer-contract-jwt"
	consumerRouter, consumerRepo := setupContractRouter(t, consumerSecret)

	consumerAdminToken, err := auth.GenerateToken(1, "consumer-admin", 0, consumerSecret)
	if err != nil {
		t.Fatalf("generate consumer admin token: %v", err)
	}

	now := time.Now().UnixMilli()
	providerEntryNodeID := insertContractNode(t, providerRepo, "provider-entry-rt", "198.51.100.21", "43020-43030", "provider-entry-rt-secret", 1)
	providerMiddleNodeID := insertContractNode(t, providerRepo, "provider-middle-rt", "198.51.100.22", "44020-44030", "provider-middle-rt-secret", 1)
	providerExitNodeID := insertContractNode(t, providerRepo, "provider-exit-rt", "198.51.100.23", "45020-45030", "provider-exit-rt-secret", 1)

	insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "entry-share-rt",
		NodeID:         providerEntryNodeID,
		Token:          "share-entry-rt-token",
		PortRangeStart: 43020,
		PortRangeEnd:   43030,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "middle-share-rt",
		NodeID:         providerMiddleNodeID,
		Token:          "share-middle-rt-token",
		PortRangeStart: 44020,
		PortRangeEnd:   44030,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})
	insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "exit-share-rt",
		NodeID:         providerExitNodeID,
		Token:          "share-exit-rt-token",
		PortRangeStart: 45020,
		PortRangeEnd:   45030,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})

	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-entry-rt-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-middle-rt-token")
	importRemoteNodeForContract(t, consumerRouter, consumerAdminToken, providerServer.URL, "share-exit-rt-token")

	entryRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-entry-rt-token")
	middleRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-middle-rt-token")
	exitRemoteNodeID := queryRemoteNodeIDByToken(t, consumerRepo, "share-exit-rt-token")

	var commandMu sync.Mutex
	entryCommands := make([]string, 0, 8)
	stopEntry := startMockNodeSessionWithHook(t, providerServer.URL, "provider-entry-rt-secret", func(cmdType string) {
		commandMu.Lock()
		entryCommands = append(entryCommands, cmdType)
		commandMu.Unlock()
	})
	defer stopEntry()
	stopMiddle := startMockNodeSession(t, providerServer.URL, "provider-middle-rt-secret")
	defer stopMiddle()
	stopExit := startMockNodeSession(t, providerServer.URL, "provider-exit-rt-secret")
	defer stopExit()

	createTunnel := func(name string) int64 {
		payload := map[string]interface{}{
			"name":   name,
			"type":   2,
			"flow":   99999,
			"status": 1,
			"inNodeId": []map[string]interface{}{
				{"nodeId": entryRemoteNodeID, "protocol": "tls", "strategy": "round"},
			},
			"chainNodes": [][]map[string]interface{}{
				{{"nodeId": middleRemoteNodeID, "protocol": "tls", "strategy": "round"}},
			},
			"outNodeId": []map[string]interface{}{
				{"nodeId": exitRemoteNodeID, "protocol": "tls", "strategy": "round"},
			},
		}
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal create payload: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tunnel/create", bytes.NewReader(body))
		req.Header.Set("Authorization", consumerAdminToken)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		consumerRouter.ServeHTTP(res, req)
		assertCode(t, res, 0)

		tunnelID := mustQueryInt64(t, consumerRepo, `SELECT id FROM tunnel WHERE name = ? ORDER BY id DESC LIMIT 1`, name)
		if tunnelID <= 0 {
			t.Fatalf("invalid tunnel id for %s", name)
		}
		return tunnelID
	}

	createTunnel("dual-panel-remote-entry-online")

	commandMu.Lock()
	seenAddChains := false
	seenCommands := append([]string(nil), entryCommands...)
	for _, cmdType := range entryCommands {
		if strings.EqualFold(strings.TrimSpace(cmdType), "AddChains") {
			seenAddChains = true
			break
		}
	}
	commandMu.Unlock()
	if !seenAddChains {
		t.Fatalf("expected entry remote node to receive AddChains, commands=%v", seenCommands)
	}

	stopEntry()
	waitNodeStatus(t, providerRepo, providerEntryNodeID, 0)

	createTunnel("dual-panel-remote-entry-offline")
}

func insertContractNode(t *testing.T, r *repo.Repository, name, ip, portRange, secret string, status int) int64 {
	t.Helper()
	now := time.Now().UnixMilli()
	if err := r.DB().Exec(`
		INSERT INTO node(name, secret, server_ip, server_ip_v4, server_ip_v6, port, interface_name, version, http, tls, socks, created_time, updated_time, status, tcp_listen_addr, udp_listen_addr, inx)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, name, secret, ip, ip, "", portRange, "", "v1", 1, 1, 1, now, now, status, "[::]", "[::]", 0).Error; err != nil {
		t.Fatalf("insert node %s: %v", name, err)
	}
	return mustLastInsertID(t, r, name)
}

func insertPeerShare(t *testing.T, r *repo.Repository, share *repo.PeerShare) int64 {
	t.Helper()
	if share == nil {
		t.Fatalf("share is nil")
	}
	if err := r.CreatePeerShare(share); err != nil {
		t.Fatalf("create peer share %s: %v", share.Name, err)
	}
	saved, err := r.GetPeerShareByToken(share.Token)
	if err != nil {
		t.Fatalf("query peer share %s: %v", share.Name, err)
	}
	if saved == nil {
		t.Fatalf("peer share %s not found after create", share.Name)
	}
	return saved.ID
}

func importRemoteNodeForContract(t *testing.T, router http.Handler, adminToken, remoteURL, token string) {
	t.Helper()
	body, err := json.Marshal(map[string]string{
		"remoteUrl": remoteURL,
		"token":     token,
	})
	if err != nil {
		t.Fatalf("marshal import payload: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/federation/node/import", bytes.NewReader(body))
	req.Header.Set("Authorization", adminToken)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	assertCode(t, res, 0)
}

func queryRemoteNodeIDByToken(t *testing.T, r *repo.Repository, token string) int64 {
	t.Helper()
	id := mustQueryInt64(t, r, `SELECT id FROM node WHERE is_remote = 1 AND remote_token = ? ORDER BY id DESC LIMIT 1`, token)
	if id <= 0 {
		t.Fatalf("invalid remote node id for token %s", token)
	}
	return id
}

func assertTunnelPortInRange(t *testing.T, r *repo.Repository, tunnelID int64, chainType int, nodeID int64, minPort int, maxPort int) {
	t.Helper()
	port := mustQueryInt(t, r, `SELECT port FROM chain_tunnel WHERE tunnel_id = ? AND chain_type = ? AND node_id = ? LIMIT 1`, tunnelID, chainType, nodeID)
	if port < minPort || port > maxPort {
		t.Fatalf("expected port in range [%d,%d], got %d", minPort, maxPort, port)
	}
}

func assertCount(t *testing.T, r *repo.Repository, query string, arg interface{}, expected int) {
	t.Helper()
	got := mustQueryInt(t, r, query, arg)
	if got != expected {
		t.Fatalf("expected count %d, got %d (query: %s, arg: %v)", expected, got, query, arg)
	}
}

func startMockNodeSessionWithHook(t *testing.T, baseURL string, nodeSecret string, onCommand func(cmdType string)) func() {
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
			if onCommand != nil {
				onCommand(strings.TrimSpace(cmd.Type))
			}

			respType := fmt.Sprintf("%sResponse", cmd.Type)
			respPayload := map[string]interface{}{
				"type":      respType,
				"success":   true,
				"message":   "OK",
				"requestId": cmd.RequestID,
			}
			if strings.EqualFold(strings.TrimSpace(cmd.Type), "TcpPing") {
				respPayload["data"] = map[string]interface{}{
					"success":     true,
					"averageTime": 8.5,
					"packetLoss":  0,
					"message":     "mock tcp ok",
				}
			}
			respBytes, err := json.Marshal(respPayload)
			if err != nil {
				continue
			}
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

func TestFederationRuntimeCommandPortRangeEnforcement(t *testing.T) {
	providerSecret := "provider-portrange-jwt"
	providerRouter, providerRepo := setupContractRouter(t, providerSecret)
	providerServer := httptest.NewServer(providerRouter)
	defer providerServer.Close()

	now := time.Now().UnixMilli()
	providerNodeID := insertContractNode(t, providerRepo, "provider-portrange-node", "198.51.100.50", "44000-44010", "provider-portrange-secret", 1)

	insertPeerShare(t, providerRepo, &repo.PeerShare{
		Name:           "portrange-share",
		NodeID:         providerNodeID,
		Token:          "share-portrange-token",
		PortRangeStart: 44000,
		PortRangeEnd:   44010,
		IsActive:       1,
		CreatedTime:    now,
		UpdatedTime:    now,
	})

	stopNode := startMockNodeSession(t, providerServer.URL, "provider-portrange-secret")
	defer stopNode()

	sendCommand := func(token string, cmdType string, data interface{}) *httptest.ResponseRecorder {
		payload := map[string]interface{}{
			"commandType": cmdType,
			"data":        data,
		}
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal command payload: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/federation/runtime/command", bytes.NewReader(body))
		req.Header.Set("Authorization", token)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		providerRouter.ServeHTTP(res, req)
		return res
	}

	// Test: AddService with port OUTSIDE allowed range should be rejected
	outOfRangeData := map[string]interface{}{
		"services": []map[string]interface{}{
			{
				"name": "test_service_tcp",
				"addr": "[::]:55555",
				"handler": map[string]interface{}{
					"type": "tcp",
				},
				"listener": map[string]interface{}{
					"type": "tcp",
				},
			},
		},
	}
	res := sendCommand("share-portrange-token", "AddService", outOfRangeData)
	var out response.R
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 403 {
		t.Fatalf("expected code 403 for out-of-range port, got %d (msg: %s)", out.Code, out.Msg)
	}

	// Test: UpdateService with port OUTSIDE allowed range should be rejected
	res = sendCommand("share-portrange-token", "UpdateService", outOfRangeData)
	out = response.R{}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 403 {
		t.Fatalf("expected code 403 for out-of-range UpdateService, got %d (msg: %s)", out.Code, out.Msg)
	}

	// Test: AddService with port INSIDE allowed range should succeed
	inRangeData := map[string]interface{}{
		"services": []map[string]interface{}{
			{
				"name": "test_service_ok_tcp",
				"addr": "[::]:44005",
				"handler": map[string]interface{}{
					"type": "tcp",
				},
				"listener": map[string]interface{}{
					"type": "tcp",
				},
			},
		},
	}
	res = sendCommand("share-portrange-token", "AddService", inRangeData)
	out = response.R{}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0 for in-range port, got %d (msg: %s)", out.Code, out.Msg)
	}

	// Test: Non-service commands should pass through without port validation
	res = sendCommand("share-portrange-token", "UpdateLimiters", map[string]interface{}{
		"limiter": "federation-limit-test",
		"data": map[string]interface{}{
			"name":   "federation-limit-test",
			"limits": []string{"$ 1MB 1MB"},
		},
	})
	out = response.R{}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0 for UpdateLimiters command, got %d (msg: %s)", out.Code, out.Msg)
	}

	res = sendCommand("share-portrange-token", "reload", nil)
	out = response.R{}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Code != 0 {
		t.Fatalf("expected code 0 for reload command, got %d (msg: %s)", out.Code, out.Msg)
	}
}

func TestFederationNodeImportRequiresAdminAndRejectsDuplicate(t *testing.T) {
	secret := "import-admin-secret"
	router, r := setupContractRouter(t, secret)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/api/v1/federation/connect" || strings.TrimSpace(req.Header.Get("Authorization")) != "import-share-token" {
			http.NotFound(w, req)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"code": 0, "msg": "success", "data": map[string]interface{}{
			"shareId": 9, "shareName": "import-share", "nodeId": 8, "nodeName": "provider", "serverIp": "198.51.100.8", "status": 1,
			"portRangeStart": 30000, "portRangeEnd": 30010, "scopeType": "all_enabled", "autoIncludeNewInstances": true, "minHealthyInstances": 1,
		}})
	}))
	defer remote.Close()

	adminToken, err := auth.GenerateToken(1, "admin", 0, secret)
	if err != nil {
		t.Fatalf("generate admin token: %v", err)
	}
	userToken, err := auth.GenerateToken(2, "user", 1, secret)
	if err != nil {
		t.Fatalf("generate user token: %v", err)
	}
	importNode := func(token string) response.R {
		body := bytes.NewBufferString(fmt.Sprintf(`{"remoteUrl":%q,"token":"import-share-token"}`, remote.URL))
		req := httptest.NewRequest(http.MethodPost, "/api/v1/federation/node/import", body)
		req.Header.Set("Authorization", token)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		var out response.R
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatalf("decode import response: %v", err)
		}
		return out
	}
	if out := importNode(userToken); out.Code != 403 {
		t.Fatalf("expected non-admin import rejection, got %d (%s)", out.Code, out.Msg)
	}
	if out := importNode(adminToken); out.Code != 0 {
		t.Fatalf("expected admin import success, got %d (%s)", out.Code, out.Msg)
	}
	if out := importNode(adminToken); out.Code == 0 || !strings.Contains(out.Msg, "already imported") {
		t.Fatalf("expected duplicate import rejection, got %d (%s)", out.Code, out.Msg)
	}
	var count int64
	if err := r.DB().Table("node").Where("is_remote = 1 AND remote_token = ?", "import-share-token").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("expected one imported node, count=%d err=%v", count, err)
	}
}

func TestFederationRuntimeApplyUsesMinimumHealthyInstances(t *testing.T) {
	router, r := setupContractRouter(t, "multi-runtime-jwt")
	server := httptest.NewServer(router)
	defer server.Close()
	now := time.Now().UnixMilli()
	nodeID := insertContractNode(t, r, "multi-runtime-node", "198.51.100.60", "45000-45010", "multi-runtime-secret", 1)
	shareID := insertPeerShare(t, r, &repo.PeerShare{
		Name: "multi-runtime-share", NodeID: nodeID, Token: "multi-runtime-token", PortRangeStart: 45000, PortRangeEnd: 45010,
		ScopeType: "selected", AutoIncludeNewInstances: 0, MinHealthyInstances: 1, IsActive: 1, CreatedTime: now, UpdatedTime: now,
	})

	stopA := startMockNodeInstanceSessionWithCommandRecorder(t, server.URL, "multi-runtime-secret", "instance-a", nil)
	defer stopA()
	stopB := startMockNodeInstanceSessionWithCommandRecorder(t, server.URL, "multi-runtime-secret", "instance-b", func(cmdType string, _ json.RawMessage) (bool, string) {
		if strings.EqualFold(cmdType, "AddService") {
			return true, "instance-b add service failed"
		}
		return false, ""
	})
	defer stopB()
	time.Sleep(50 * time.Millisecond)
	if err := r.ReplacePeerShareInstances(shareID, nodeID, []string{"instance-a", "instance-b"}, now); err != nil {
		t.Fatalf("select share instances: %v", err)
	}

	reserveBody := bytes.NewBufferString(`{"resourceKey":"multi-runtime-resource","protocol":"tls","requestedPort":45001}`)
	reserveReq := httptest.NewRequest(http.MethodPost, "/api/v1/federation/runtime/reserve-port", reserveBody)
	reserveReq.Header.Set("Authorization", "multi-runtime-token")
	reserveRes := httptest.NewRecorder()
	router.ServeHTTP(reserveRes, reserveReq)
	var reserveOut response.R
	if err := json.NewDecoder(reserveRes.Body).Decode(&reserveOut); err != nil || reserveOut.Code != 0 {
		t.Fatalf("reserve port failed: out=%+v err=%v", reserveOut, err)
	}
	reserveData := reserveOut.Data.(map[string]interface{})
	reservationID := valueAsString(reserveData["reservationId"])

	applyBody := bytes.NewBufferString(fmt.Sprintf(`{"reservationId":%q,"role":"exit","protocol":"tls"}`, reservationID))
	applyReq := httptest.NewRequest(http.MethodPost, "/api/v1/federation/runtime/apply-role", applyBody)
	applyReq.Header.Set("Authorization", "multi-runtime-token")
	applyRes := httptest.NewRecorder()
	router.ServeHTTP(applyRes, applyReq)
	var applyOut response.R
	if err := json.NewDecoder(applyRes.Body).Decode(&applyOut); err != nil || applyOut.Code != 0 {
		t.Fatalf("apply role should meet minimum healthy threshold: out=%+v err=%v", applyOut, err)
	}

	share, err := r.GetPeerShare(shareID)
	if err != nil || share == nil {
		t.Fatalf("load share: %v", err)
	}
	runtimes, err := r.ListActivePeerShareRuntimesByShareID(share.ID)
	if err != nil || len(runtimes) != 1 {
		t.Fatalf("load runtime: %+v err=%v", runtimes, err)
	}
	states, err := r.ListPeerShareRuntimeInstances(runtimes[0].ID)
	if err != nil || len(states) != 2 {
		t.Fatalf("load runtime states: %+v err=%v", states, err)
	}
	stateByID := make(map[string]repo.PeerShareRuntimeInstance, len(states))
	for _, state := range states {
		stateByID[state.InstanceID] = state
	}
	if stateByID["instance-a"].Healthy != 1 || stateByID["instance-a"].Applied != 1 {
		t.Fatalf("expected instance-a healthy, got %+v", stateByID["instance-a"])
	}
	if stateByID["instance-b"].Healthy != 0 || !strings.Contains(stateByID["instance-b"].LastError, "instance-b add service failed") {
		t.Fatalf("expected instance-b failure recorded, got %+v", stateByID["instance-b"])
	}
}
