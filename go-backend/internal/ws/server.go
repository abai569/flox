package ws

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"go-backend/internal/auth"
	"go-backend/internal/security"
	"go-backend/internal/store/repo"
)

type encryptedMessage struct {
	Encrypted bool   `json:"encrypted"`
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

type broadcastMessage struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
	Data string `json:"data"`
}

type connWrap struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

type nodeSession struct {
	nodeID int64
	secret string
	conn   *connWrap
	crypto *security.AESCrypto // 缓存的 AES 加密器，避免每条消息重建
}

type commandResponse struct {
	Type      string          `json:"type"`
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	Data      json.RawMessage `json:"data,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
}

type pendingRequest struct {
	nodeID int64
	ch     chan CommandResult
}

const (
	wsPingPeriod = 15 * time.Second
	wsPongWait   = 45 * time.Second
	wsWriteWait  = 5 * time.Second
)

type CommandResult struct {
	Type    string                 `json:"type"`
	Success bool                   `json:"success"`
	Message string                 `json:"message"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

type Server struct {
	repo         *repo.Repository
	jwtSecret    string
	upgrader     websocket.Upgrader
	onNodeOnline  func(nodeID int64)
	onNodeOffline func(nodeID int64)
	onNodeMetric  func(nodeID int64, info SystemInfo)

	mu                    sync.RWMutex
	admins                map[*connWrap]struct{}
	publics               map[*connWrap]struct{}
	nodes                 map[int64]*nodeSession
	byConn                map[*websocket.Conn]*nodeSession
	pending               map[string]pendingRequest
	serviceConnections    map[int64]map[string]int          // nodeID -> serviceName -> connections
	serviceConnUpdateTime map[int64]int64                   // nodeID -> last update time
	forwardMetrics        map[int64]map[int64]*ForwardMetric // forwardID -> nodeID -> metric
	forwardMetricsMu      sync.RWMutex
	nodeOfflineTime       map[int64]int64 // nodeID -> offline timestamp (seconds)
}

type SystemInfo struct {
	Uptime                 uint64         `json:"uptime"`
	BytesReceived          uint64         `json:"bytes_received"`
	BytesTransmitted       uint64         `json:"bytes_transmitted"`
	PeriodBytesReceived    uint64         `json:"period_bytes_received"`
	PeriodBytesTransmitted uint64         `json:"period_bytes_transmitted"`
	BaselineRecordedAt     int64          `json:"baseline_recorded_at"`
	NextResetAt            int64          `json:"next_reset_at"`
	RenewalCycle           string         `json:"renewal_cycle,omitempty"`
	CPUUsage               float64        `json:"cpu_usage"`
	MemoryUsage            float64        `json:"memory_usage"`
	DiskUsage              float64        `json:"disk_usage"`
	Load1                  float64        `json:"load1"`
	Load5                  float64        `json:"load5"`
	Load15                 float64        `json:"load15"`
	TCPConns               int64          `json:"tcp_conns"`
	UDPConns               int64          `json:"udp_conns"`
	NetInSpeed             int64          `json:"net_in_speed"`
	NetOutSpeed            int64          `json:"net_out_speed"`
	ServiceName            string         `json:"service_name,omitempty"`
	ServiceConnections     map[string]int `json:"serviceConnections"`
	ForwardMetrics         []ForwardMetric `json:"forward_metrics,omitempty"`
}

// ForwardMetric 转发规则指标
type ForwardMetric struct {
	ForwardID   int64  `json:"forward_id"`
	UserID      int64  `json:"user_id"`
	TunnelID    int64  `json:"tunnel_id"`
	NodeID      int64  `json:"node_id"`      // 新增：节点 ID
	Port        int    `json:"port"`         // 新增：入口端口
	ServiceName string `json:"service_name"`
	InSpeed     uint64 `json:"in_speed"`
	OutSpeed    uint64 `json:"out_speed"`
	Connections int    `json:"connections"`
}

func (s *Server) SetNodeOnlineHook(fn func(nodeID int64)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.onNodeOnline = fn
	s.mu.Unlock()
}

func (s *Server) SetNodeOfflineHook(fn func(nodeID int64)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.onNodeOffline = fn
	s.mu.Unlock()
}

func (s *Server) SetNodeMetricHook(fn func(nodeID int64, info SystemInfo)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.onNodeMetric = fn
	s.mu.Unlock()
}

// GetServiceConnections 获取指定节点上所有服务的连接数
func (s *Server) GetServiceConnections(nodeID int64) map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if conns, ok := s.serviceConnections[nodeID]; ok {
		// 返回副本避免外部修改
		result := make(map[string]int, len(conns))
		for k, v := range conns {
			result[k] = v
		}
		return result
	}
	return nil
}

// GetForwardCurrentConnections 获取指定转发的当前连接数
// 服务名格式为 "{forwardID}_{userID}_{userTunnelID}_tcp" 或 "{forwardID}_{userID}_{userTunnelID}_udp"
func (s *Server) GetForwardCurrentConnections(nodeID int64, forwardID int64) int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	conns := s.serviceConnections[nodeID]
	if conns == nil {
		return 0
	}

	total := 0
	// 服务名格式：{forwardID}_{userID}_{userTunnelID}_tcp 或 _udp
	// 遍历所有连接数，匹配以 "{forwardID}_" 开头的服务
	prefix := fmt.Sprintf("%d_", forwardID)
	for serviceName, count := range conns {
		if strings.HasPrefix(serviceName, prefix) {
			total += count
		}
	}
	return total
}

// GetForwardMetric 获取指定 forward 的实时指标（汇总所有节点）
func (s *Server) GetForwardMetric(forwardID int64) *ForwardMetric {
	s.forwardMetricsMu.RLock()
	defer s.forwardMetricsMu.RUnlock()
	
	nodeMetrics, ok := s.forwardMetrics[forwardID]
	if !ok || len(nodeMetrics) == 0 {
		return nil
	}
	
	// 汇总所有节点的带宽
	var totalInSpeed, totalOutSpeed, totalConnections uint64
	var firstMetric *ForwardMetric
	for _, fm := range nodeMetrics {
		if firstMetric == nil {
			// 保存第一个指标的元数据
			firstMetric = &ForwardMetric{
				ForwardID:   fm.ForwardID,
				UserID:      fm.UserID,
				TunnelID:    fm.TunnelID,
				ServiceName: fm.ServiceName,
			}
		}
		totalInSpeed += fm.InSpeed
		totalOutSpeed += fm.OutSpeed
		totalConnections += uint64(fm.Connections)
	}
	
	if firstMetric == nil {
		return nil
	}
	
	return &ForwardMetric{
		ForwardID:   firstMetric.ForwardID,
		UserID:      firstMetric.UserID,
		TunnelID:    firstMetric.TunnelID,
		ServiceName: firstMetric.ServiceName,
		InSpeed:     totalInSpeed,
		OutSpeed:    totalOutSpeed,
		Connections: int(totalConnections),
	}
}

func NewServer(repo *repo.Repository, jwtSecret string) *Server {
	s := &Server{
		repo:      repo,
		jwtSecret: jwtSecret,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		admins:                make(map[*connWrap]struct{}),
		publics:               make(map[*connWrap]struct{}),
		nodes:                 make(map[int64]*nodeSession),
		byConn:                make(map[*websocket.Conn]*nodeSession),
		pending:               make(map[string]pendingRequest),
		serviceConnections:    make(map[int64]map[string]int),
		serviceConnUpdateTime: make(map[int64]int64),
		forwardMetrics:        make(map[int64]map[int64]*ForwardMetric), // forwardID -> nodeID -> metric
		nodeOfflineTime:       make(map[int64]int64), // nodeID -> offline timestamp
	}
	// 启动后台清理任务（每 2 分钟清理一次过期数据）
	go s.cleanupStaleMetrics(2 * time.Minute)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	typeVal := query.Get("type")
	secret := query.Get("secret")

	if typeVal == "1" {
		node, err := s.repo.GetNodeBySecret(secret)
		if err != nil || node == nil {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		s.handleNode(w, r, node.ID, secret)
		return
	}

	if typeVal == "0" {
		if _, ok := auth.ValidateToken(secret, s.jwtSecret); !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		s.handleAdmin(w, r)
		return
	}

	if typeVal == "2" {
		s.handlePublic(w, r)
		return
	}

	http.Error(w, "bad request", http.StatusBadRequest)
}

func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	cw := &connWrap{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	done := make(chan struct{})
	go startKeepalive(cw, done)

	s.mu.Lock()
	s.admins[cw] = struct{}{}
	s.mu.Unlock()

	defer func() {
		close(done)
		s.mu.Lock()
		delete(s.admins, cw)
		s.mu.Unlock()
		_ = conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *Server) handlePublic(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	cw := &connWrap{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	done := make(chan struct{})
	go startKeepalive(cw, done)

	s.mu.Lock()
	s.publics[cw] = struct{}{}
	s.mu.Unlock()

	defer func() {
		close(done)
		s.mu.Lock()
		delete(s.publics, cw)
		s.mu.Unlock()
		_ = conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (s *Server) handleNode(w http.ResponseWriter, r *http.Request, nodeID int64, secret string) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	cw := &connWrap{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	done := make(chan struct{})
	go startKeepalive(cw, done)

	version := r.URL.Query().Get("version")
	httpVal := parseIntDefault(r.URL.Query().Get("http"), 0)
	tlsVal := parseIntDefault(r.URL.Query().Get("tls"), 0)
	socksVal := parseIntDefault(r.URL.Query().Get("socks"), 0)
	blockOtherVal := parseIntDefault(r.URL.Query().Get("blockOther"), 0)

	s.mu.Lock()
	if old, ok := s.nodes[nodeID]; ok {
		_ = old.conn.conn.Close()
		delete(s.byConn, old.conn.conn)
	}
	// 初始化 AES 加密器并缓存（仅创建一次）
	var nodeCrypto *security.AESCrypto
	if strings.TrimSpace(secret) != "" {
		nodeCrypto, _ = security.NewAESCrypto(secret)
	}
	ns := &nodeSession{nodeID: nodeID, secret: secret, conn: cw, crypto: nodeCrypto}
	s.nodes[nodeID] = ns
	s.byConn[conn] = ns
	// 节点重新上线，清除离线时间记录
	delete(s.nodeOfflineTime, nodeID)
	s.mu.Unlock()

	_ = s.repo.UpdateNodeOnline(nodeID, 1, version, httpVal, tlsVal, socksVal, blockOtherVal)
	s.broadcastStatus(nodeID, 1)

	s.mu.RLock()
	onlineHook := s.onNodeOnline
	s.mu.RUnlock()
	if onlineHook != nil {
		go onlineHook(nodeID)
	}

	defer func() {
		close(done)
		needOfflineBroadcast := false
		s.mu.Lock()
		current, ok := s.nodes[nodeID]
		if ok && current.conn.conn == conn {
			delete(s.nodes, nodeID)
			// 记录节点离线时间
			s.nodeOfflineTime[nodeID] = time.Now().Unix()
			needOfflineBroadcast = true
		}
		delete(s.byConn, conn)
		s.mu.Unlock()
		if needOfflineBroadcast {
			s.failPendingForNode(nodeID, "节点连接已断开")
			_ = s.repo.UpdateNodeStatus(nodeID, 0)
			s.broadcastStatus(nodeID, 0)

			s.mu.RLock()
			offlineHook := s.onNodeOffline
			s.mu.RUnlock()
			if offlineHook != nil {
				go offlineHook(nodeID)
			}
		}
		_ = conn.Close()
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}

		msg := decryptIfNeeded(payload, ns.crypto, secret)
		s.tryResolvePending(nodeID, msg)

		var parsed struct {
			Type string `json:"type"`
		}
		if json.Unmarshal([]byte(msg), &parsed) == nil && parsed.Type != "" {
			switch parsed.Type {
			case "metric":
				// Agent 新版指标消息：{type:"metric", data:{...}}
				var envelope struct {
					Data json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal([]byte(msg), &envelope); err == nil && len(envelope.Data) > 0 {
					// 解析 SystemInfo 并调用 hook
					var sysInfo SystemInfo
					if json.Unmarshal(envelope.Data, &sysInfo) == nil {
						// 缓存服务连接数
						s.mu.Lock()
						s.serviceConnections[nodeID] = sysInfo.ServiceConnections
						s.serviceConnUpdateTime[nodeID] = time.Now().Unix()
						// 更新 service_name
						if sysInfo.ServiceName != "" {
							_ = s.repo.UpdateNodeServiceName(nodeID, sysInfo.ServiceName)
						}
						// 缓存 forward 指标
						if len(sysInfo.ForwardMetrics) > 0 {
							fmt.Printf("[ws.forward] received %d forward metrics from node %d\n", len(sysInfo.ForwardMetrics), nodeID)
							s.forwardMetricsMu.Lock()
							for _, fm := range sysInfo.ForwardMetrics {
								// 初始化 forwardID 的 map（如果不存在）
								if s.forwardMetrics[fm.ForwardID] == nil {
									s.forwardMetrics[fm.ForwardID] = make(map[int64]*ForwardMetric)
								}
								// 按 nodeID 存储
								s.forwardMetrics[fm.ForwardID][fm.NodeID] = &fm
							}
							s.forwardMetricsMu.Unlock()
						}
						s.mu.Unlock()

						s.mu.RLock()
						onMetric := s.onNodeMetric
						s.mu.RUnlock()
						if onMetric != nil {
							go onMetric(nodeID, sysInfo)
						}
					}
					// 广播内层 data 给前端（保持平坦结构兼容性）
					s.broadcastTyped(nodeID, "metric", string(envelope.Data))
				}
				continue
			case "ReportPublicIP":
				// 节点上报公网 IP
				var envelope struct {
					Data struct {
						PublicIP string `json:"public_ip"`
					} `json:"data"`
				}
				if err := json.Unmarshal([]byte(msg), &envelope); err == nil && envelope.Data.PublicIP != "" {
					// 更新节点公网 IP
					if s.onNodeMetric != nil {
						// 通过 repo 更新数据库
						if err := s.repo.UpdateNodePublicIP(nodeID, envelope.Data.PublicIP); err != nil {
							fmt.Printf("⚠️ 更新节点%d公网 IP 失败：%v\n", nodeID, err)
						} else {
							fmt.Printf("✅ 节点%d公网 IP 已更新：%s\n", nodeID, envelope.Data.PublicIP)
						}
					}
				}
				continue
			case "UpgradeProgress":
				s.broadcastTyped(nodeID, "upgrade_progress", msg)
				continue
			default:
				// Unknown typed messages still get broadcast so future
				// agent message types are not silently lost.
				s.broadcastInfo(nodeID, msg)
				continue
			}
		}

		// 兼容旧版 Agent：无 type 字段的系统信息消息
		if looksLikeSystemInfoMessage(msg) {
			var sysInfo SystemInfo
			if err := json.Unmarshal([]byte(msg), &sysInfo); err == nil {
				// 缓存服务连接数
				s.mu.Lock()
				s.serviceConnections[nodeID] = sysInfo.ServiceConnections
				s.serviceConnUpdateTime[nodeID] = time.Now().Unix()
				s.mu.Unlock()

				s.mu.RLock()
				onMetric := s.onNodeMetric
				s.mu.RUnlock()
				if onMetric != nil {
					go onMetric(nodeID, sysInfo)
				}
				s.broadcastTyped(nodeID, "metric", msg)
				continue
			}
		}

		s.broadcastInfo(nodeID, msg)
	}
}

func looksLikeSystemInfoMessage(msg string) bool {
	// Keep this as a cheap heuristic so that arbitrary JSON objects don't get
	// misclassified as metrics (SystemInfo unmarshal would otherwise succeed with
	// all-zero values).
	if strings.TrimSpace(msg) == "" {
		return false
	}
	if !strings.Contains(msg, "{") {
		return false
	}

	keys := []string{
		"\"uptime\"",
		"\"cpu_usage\"",
		"\"memory_usage\"",
		"\"disk_usage\"",
		"\"bytes_received\"",
		"\"bytes_transmitted\"",
		"\"net_in_speed\"",
		"\"net_out_speed\"",
		"\"tcp_conns\"",
		"\"udp_conns\"",
		"\"load1\"",
		"\"load5\"",
		"\"load15\"",
	}
	matched := 0
	for _, k := range keys {
		if strings.Contains(msg, k) {
			matched++
			if matched >= 3 {
				return true
			}
		}
	}
	return false
}

func (s *Server) SendCommand(nodeID int64, cmdType string, data interface{}, timeout time.Duration) (CommandResult, error) {
	if s == nil {
		return CommandResult{}, errors.New("server not initialized")
	}
	if strings.TrimSpace(cmdType) == "" {
		return CommandResult{}, errors.New("command type is empty")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	s.mu.RLock()
	ns, ok := s.nodes[nodeID]
	s.mu.RUnlock()
	if !ok || ns == nil || ns.conn == nil || ns.conn.conn == nil {
		return CommandResult{}, errors.New("节点不在线")
	}

	requestID := fmt.Sprintf("%d_%d", nodeID, time.Now().UnixNano())
	ch := make(chan CommandResult, 1)

	s.mu.Lock()
	s.pending[requestID] = pendingRequest{nodeID: nodeID, ch: ch}
	s.mu.Unlock()

	cleanup := func() {
		s.mu.Lock()
		if p, exists := s.pending[requestID]; exists {
			delete(s.pending, requestID)
			close(p.ch)
		}
		s.mu.Unlock()
	}

	cmdPayload := map[string]interface{}{
		"type":      cmdType,
		"data":      data,
		"requestId": requestID,
	}
	rawCmd, err := json.Marshal(cmdPayload)
	if err != nil {
		cleanup()
		return CommandResult{}, err
	}

	messageData := rawCmd
	if ns.crypto != nil {
		encrypted, err := ns.crypto.Encrypt(rawCmd)
		if err != nil {
			cleanup()
			return CommandResult{}, err
		}
		wrapper := map[string]interface{}{
			"encrypted": true,
			"data":      encrypted,
			"timestamp": time.Now().UnixMilli(),
		}
		messageData, err = json.Marshal(wrapper)
		if err != nil {
			cleanup()
			return CommandResult{}, err
		}
	}

	ns.conn.mu.Lock()
	_ = ns.conn.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	err = ns.conn.conn.WriteMessage(websocket.TextMessage, messageData)
	_ = ns.conn.conn.SetWriteDeadline(time.Time{})
	ns.conn.mu.Unlock()
	if err != nil {
		cleanup()
		return CommandResult{}, err
	}

	select {
	case result, ok := <-ch:
		if !ok {
			return CommandResult{}, errors.New("命令通道已关闭")
		}
		if !result.Success {
			if strings.TrimSpace(result.Message) == "" {
				result.Message = "命令执行失败"
			}
			return result, errors.New(result.Message)
		}
		return result, nil
	case <-time.After(timeout):
		cleanup()
		return CommandResult{}, errors.New("等待节点响应超时")
	}
}

func (s *Server) tryResolvePending(nodeID int64, message string) {
	if s == nil || strings.TrimSpace(message) == "" {
		return
	}

	// 快速短路：指标消息永远不含 requestId，跳过完整 JSON 解析
	if !strings.Contains(message, "\"requestId\"") {
		return
	}

	var resp commandResponse
	if err := json.Unmarshal([]byte(message), &resp); err != nil {
		return
	}
	if strings.TrimSpace(resp.RequestID) == "" {
		return
	}

	s.mu.Lock()
	p, ok := s.pending[resp.RequestID]
	if ok {
		delete(s.pending, resp.RequestID)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	if p.nodeID != nodeID {
		select {
		case p.ch <- CommandResult{Type: resp.Type, Success: false, Message: "节点响应与请求不匹配"}:
		default:
		}
		close(p.ch)
		return
	}

	result := CommandResult{
		Type:    resp.Type,
		Success: resp.Success,
		Message: resp.Message,
	}
	if len(resp.Data) > 0 {
		var data map[string]interface{}
		if err := json.Unmarshal(resp.Data, &data); err == nil {
			result.Data = data
		}
	}

	select {
	case p.ch <- result:
	default:
	}
	close(p.ch)
}

func (s *Server) failPendingForNode(nodeID int64, message string) {
	if s == nil {
		return
	}

	type pair struct {
		id string
		pr pendingRequest
	}
	items := make([]pair, 0)

	s.mu.Lock()
	for id, pr := range s.pending {
		if pr.nodeID != nodeID {
			continue
		}
		items = append(items, pair{id: id, pr: pr})
		delete(s.pending, id)
	}
	s.mu.Unlock()

	for _, item := range items {
		select {
		case item.pr.ch <- CommandResult{Success: false, Message: message}:
		default:
		}
		close(item.pr.ch)
	}
}

func (s *Server) broadcastStatus(nodeID int64, status int) {
	payload := map[string]interface{}{
		"id":   strconv.FormatInt(nodeID, 10),
		"type": "status",
		"data": status,
	}
	raw, _ := json.Marshal(payload)
	msg := string(raw)
	s.broadcastToAdmins(msg)
	s.broadcastToPublics(msg)
}

func (s *Server) broadcastInfo(nodeID int64, data string) {
	payload := broadcastMessage{ID: nodeID, Type: "info", Data: data}
	raw, _ := json.Marshal(payload)
	msg := string(raw)
	s.broadcastToAdmins(msg)
	s.broadcastToPublics(msg)
}

func (s *Server) broadcastTyped(nodeID int64, msgType string, data string) {
	payload := broadcastMessage{ID: nodeID, Type: msgType, Data: data}
	raw, _ := json.Marshal(payload)
	msg := string(raw)
	s.broadcastToAdmins(msg)
	s.broadcastToPublics(msg)
}

func (s *Server) BroadcastToAdmins(message string) {
	s.mu.RLock()
	admins := make([]*connWrap, 0, len(s.admins))
	for c := range s.admins {
		admins = append(admins, c)
	}
	s.mu.RUnlock()

	for _, c := range admins {
		c.mu.Lock()
		_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
		err := c.conn.WriteMessage(websocket.TextMessage, []byte(message))
		_ = c.conn.SetWriteDeadline(time.Time{})
		c.mu.Unlock()
		if err != nil {
			log.Printf("websocket broadcast failed: %v", err)
		}
	}
}

func (s *Server) broadcastToAdmins(message string) {
	s.BroadcastToAdmins(message)
}

func (s *Server) broadcastToPublics(message string) {
	s.BroadcastToPublics(message)
}

func (s *Server) BroadcastToPublics(message string) {
	s.mu.RLock()
	publics := make([]*connWrap, 0, len(s.publics))
	for c := range s.publics {
		publics = append(publics, c)
	}
	s.mu.RUnlock()

	for _, c := range publics {
		c.mu.Lock()
		_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
		err := c.conn.WriteMessage(websocket.TextMessage, []byte(message))
		_ = c.conn.SetWriteDeadline(time.Time{})
		c.mu.Unlock()
		if err != nil {
			log.Printf("websocket public broadcast failed: %v", err)
		}
	}
}

func decryptIfNeeded(payload []byte, crypto *security.AESCrypto, secret string) string {
	text := string(payload)
	var wrap encryptedMessage
	if err := json.Unmarshal(payload, &wrap); err != nil || !wrap.Encrypted || strings.TrimSpace(wrap.Data) == "" {
		return text
	}

	// 优先使用缓存的 crypto 实例
	c := crypto
	if c == nil && strings.TrimSpace(secret) != "" {
		c, _ = security.NewAESCrypto(secret)
	}
	if c == nil {
		return text
	}
	plain, err := c.Decrypt(wrap.Data)
	if err != nil {
		return text
	}
	return string(plain)
}

func parseIntDefault(v string, fallback int) int {
	x, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return x
}

func startKeepalive(cw *connWrap, done <-chan struct{}) {
	if cw == nil || cw.conn == nil {
		return
	}
	ticker := time.NewTicker(wsPingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			cw.mu.Lock()
			_ = cw.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			err := cw.conn.WriteMessage(websocket.PingMessage, nil)
			_ = cw.conn.SetWriteDeadline(time.Time{})
			cw.mu.Unlock()
			if err != nil {
				_ = cw.conn.Close()
				return
			}
		}
	}
}

// cleanupStaleMetrics 定期清理过期节点的指标数据（离线超过 10 分钟）
func (s *Server) cleanupStaleMetrics(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		now := time.Now().Unix()
		offlineTimeout := int64(10 * 60) // 10 分钟

		// 清理离线超过 10 分钟的节点的 forwardMetrics
		for nodeID, offlineTime := range s.nodeOfflineTime {
			if now-offlineTime > offlineTimeout {
				// 清理该节点的所有 forward 指标
				s.forwardMetricsMu.Lock()
				for forwardID, nodeMetrics := range s.forwardMetrics {
					if _, exists := nodeMetrics[nodeID]; exists {
						delete(nodeMetrics, nodeID)
						// 如果该 forward 没有其他节点的指标了，删除整个 entry
						if len(nodeMetrics) == 0 {
							delete(s.forwardMetrics, forwardID)
						}
					}
				}
				s.forwardMetricsMu.Unlock()

				// 清理离线时间记录
				delete(s.nodeOfflineTime, nodeID)
			}
		}
		s.mu.Unlock()
	}
}
