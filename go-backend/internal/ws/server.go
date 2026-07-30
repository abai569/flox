package ws

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
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
	nodeID     int64
	instanceID string
	hostname   string
	secret     string
	conn       *connWrap
	crypto     *security.AESCrypto // 缓存的 AES 加密器，避免每条消息重建
}

type commandResponse struct {
	Type      string          `json:"type"`
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	Data      json.RawMessage `json:"data,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
}

type pendingRequest struct {
	nodeID     int64
	instanceID string
	ch         chan CommandResult
}

type NodeMessage struct {
	NodeID     int64
	InstanceID string
	Hostname   string
	Type       string
	Raw        string
	Data       json.RawMessage
}

const (
	wsPingPeriod = 15 * time.Second
	wsPongWait   = 45 * time.Second
	wsWriteWait  = 5 * time.Second
)

type CommandResult struct {
	Type       string                 `json:"type"`
	Success    bool                   `json:"success"`
	Message    string                 `json:"message"`
	Data       map[string]interface{} `json:"data,omitempty"`
	InstanceID string                 `json:"instanceId,omitempty"`
	Hostname   string                 `json:"hostname,omitempty"`
}

type Server struct {
	repo                  *repo.Repository
	jwtSecret             string
	upgrader              websocket.Upgrader
	onNodeOnline          func(nodeID int64)
	onNodeInstanceOnline  func(nodeID int64, instanceID string)
	onNodeOffline         func(nodeID int64)
	onNodeInstanceOffline func(nodeID int64, instanceID string)
	onNodeMetric          func(nodeID int64, info SystemInfo)

	mu                 sync.RWMutex
	nodeLifecycle      [64]sync.Mutex
	admins             map[*connWrap]struct{}
	publics            map[*connWrap]struct{}
	nodes              map[int64]map[string]*nodeSession
	byConn             map[*websocket.Conn]*nodeSession
	pending            map[string]pendingRequest
	subscribers        map[int]chan NodeMessage
	nextSubscriberID   int
	serviceConnections map[int64]map[string]map[string]int           // nodeID -> instanceID -> serviceName -> connections
	forwardMetrics     map[int64]map[int64]map[string]*ForwardMetric // forwardID -> nodeID -> serviceName -> metric
	forwardMetricsMu   sync.RWMutex
	nodeOfflineTime    map[int64]int64 // nodeID -> offline timestamp (seconds)
	cleanupStop        chan struct{}
	cleanupWG          sync.WaitGroup
	connectionWG       sync.WaitGroup
	hookWG             sync.WaitGroup
	closing            bool
	closeOnce          sync.Once
}

func (s *Server) lockNodeLifecycle(nodeID int64) func() {
	index := uint64(nodeID) % uint64(len(s.nodeLifecycle))
	s.nodeLifecycle[index].Lock()
	return s.nodeLifecycle[index].Unlock
}

type SystemInfo struct {
	Uptime                 uint64          `json:"uptime"`
	BootID                 uint64          `json:"boot_id"`
	BytesReceived          uint64          `json:"bytes_received"`
	BytesTransmitted       uint64          `json:"bytes_transmitted"`
	PeriodBytesReceived    uint64          `json:"period_bytes_received"`
	PeriodBytesTransmitted uint64          `json:"period_bytes_transmitted"`
	BaselineRecordedAt     int64           `json:"baseline_recorded_at"`
	NextResetAt            int64           `json:"next_reset_at"`
	RenewalCycle           string          `json:"renewal_cycle,omitempty"`
	CPUUsage               float64         `json:"cpu_usage"`
	MemoryUsage            float64         `json:"memory_usage"`
	DiskUsage              float64         `json:"disk_usage"`
	Load1                  float64         `json:"load1"`
	Load5                  float64         `json:"load5"`
	Load15                 float64         `json:"load15"`
	TCPConns               int64           `json:"tcp_conns"`
	UDPConns               int64           `json:"udp_conns"`
	NetInSpeed             int64           `json:"net_in_speed"`
	NetOutSpeed            int64           `json:"net_out_speed"`
	NetInBytes             int64           `json:"net_in_bytes"`
	NetOutBytes            int64           `json:"net_out_bytes"`
	NetInterfaceKey        string          `json:"net_interface_key,omitempty"`
	PeriodNetInBytes       int64           `json:"period_net_in_bytes"`
	PeriodNetOutBytes      int64           `json:"period_net_out_bytes"`
	ServiceName            string          `json:"service_name,omitempty"`
	InstanceID             string          `json:"instance_id,omitempty"`
	Hostname               string          `json:"hostname,omitempty"`
	PublicIPV4             string          `json:"public_ip_v4,omitempty"`
	PublicIPV6             string          `json:"public_ip_v6,omitempty"`
	ServiceConnections     map[string]int  `json:"serviceConnections"`
	ForwardMetrics         []ForwardMetric `json:"forward_metrics,omitempty"`
}

// ForwardMetric 转发规则指标
type ForwardMetric struct {
	ForwardID   int64  `json:"forward_id"`
	UserID      int64  `json:"user_id"`
	TunnelID    int64  `json:"tunnel_id"`
	NodeID      int64  `json:"node_id"` // 新增：节点 ID
	Port        int    `json:"port"`    // 新增：入口端口
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

func (s *Server) SetNodeInstanceOnlineHook(fn func(nodeID int64, instanceID string)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.onNodeInstanceOnline = fn
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

func (s *Server) SetNodeInstanceOfflineHook(fn func(nodeID int64, instanceID string)) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.onNodeInstanceOffline = fn
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
	result := make(map[string]int)
	for _, conns := range s.serviceConnections[nodeID] {
		for name, count := range conns {
			result[name] += count
		}
	}
	return result
}

func (s *Server) GetInstanceServiceConnections(nodeID int64, instanceID string) map[string]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	conns := s.serviceConnections[nodeID][strings.TrimSpace(instanceID)]
	result := make(map[string]int, len(conns))
	for name, count := range conns {
		result[name] = count
	}
	return result
}

// GetForwardCurrentConnections 获取指定转发的当前连接数
// 服务名格式为 "{forwardID}_{userID}_{userTunnelID}_tcp" 或 "{forwardID}_{userID}_{userTunnelID}_udp"
func (s *Server) GetForwardCurrentConnections(nodeID int64, forwardID int64) int {
	s.forwardMetricsMu.RLock()
	if nodeMetrics, ok := s.forwardMetrics[forwardID]; ok && len(nodeMetrics) > 0 {
		total := 0
		for _, serviceMetrics := range nodeMetrics {
			for _, fm := range serviceMetrics {
				total += fm.Connections
			}
		}
		s.forwardMetricsMu.RUnlock()
		if total > 0 {
			return total
		}
		// 某些转发模式（例如短连接或未显式上报连接数）可能出现带宽有值但 forwardMetrics.Connections 为 0，
		// 这时回退到 serviceConnections，避免前端长期显示 0/暂无。
	} else {
		s.forwardMetricsMu.RUnlock()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	instanceConns := s.serviceConnections[nodeID]
	if instanceConns == nil {
		return 0
	}

	total := 0
	// 服务名格式：{forwardID}_{userID}_{userTunnelID}_tcp 或 _udp
	// 遍历所有连接数，匹配以 "{forwardID}_" 开头的服务
	prefix := fmt.Sprintf("%d_", forwardID)
	for _, conns := range instanceConns {
		for serviceName, count := range conns {
			if strings.HasPrefix(serviceName, prefix) {
				total += count
			}
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
	for _, serviceMetrics := range nodeMetrics {
		for _, fm := range serviceMetrics {
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

// GetForwardMetricsByShareID returns metrics for services namespaced by a peer share.
func (s *Server) GetForwardMetricsByShareID(shareID int64) []ForwardMetric {
	if s == nil || shareID <= 0 {
		return nil
	}
	prefix := fmt.Sprintf("rem_s%d_", shareID)
	connections := make(map[string]int)
	s.mu.RLock()
	for _, instances := range s.serviceConnections {
		for _, services := range instances {
			for serviceName, count := range services {
				if strings.HasPrefix(serviceName, prefix) {
					connections[serviceName] += count
				}
			}
		}
	}
	s.mu.RUnlock()
	s.forwardMetricsMu.RLock()
	defer s.forwardMetricsMu.RUnlock()
	result := make([]ForwardMetric, 0)
	seenServices := make(map[string]struct{})
	for _, nodeMetrics := range s.forwardMetrics {
		for _, serviceMetrics := range nodeMetrics {
			for serviceName, metric := range serviceMetrics {
				if !strings.HasPrefix(serviceName, prefix) || metric == nil {
					continue
				}
				item := *metric
				item.Connections = connections[serviceName]
				result = append(result, item)
				seenServices[serviceName] = struct{}{}
			}
		}
	}
	for serviceName, count := range connections {
		if _, ok := seenServices[serviceName]; ok {
			continue
		}
		forwardID, userID, tunnelID := parseRemForwardMetricServiceName(serviceName, shareID)
		if forwardID <= 0 {
			continue
		}
		result = append(result, ForwardMetric{
			ForwardID: forwardID, UserID: userID, TunnelID: tunnelID,
			ServiceName: serviceName, Connections: count,
		})
	}
	return result
}

func parseRemForwardMetricServiceName(serviceName string, shareID int64) (forwardID, userID, tunnelID int64) {
	prefix := fmt.Sprintf("rem_s%d_", shareID)
	name := strings.TrimSpace(serviceName)
	if !strings.HasPrefix(name, prefix) {
		return 0, 0, 0
	}
	name = strings.TrimPrefix(name, prefix)
	name = strings.TrimSuffix(strings.TrimSuffix(name, "_tcp"), "_udp")
	parts := strings.Split(name, "_")
	if len(parts) < 3 {
		return 0, 0, 0
	}
	forwardID, _ = strconv.ParseInt(parts[0], 10, 64)
	userID, _ = strconv.ParseInt(parts[1], 10, 64)
	tunnelID, _ = strconv.ParseInt(parts[2], 10, 64)
	return forwardID, userID, tunnelID
}

// ClearForwardMetrics 清除指定转发的实时指标缓存，用于暂停/删除后立即清理前端展示
func (s *Server) ClearForwardMetrics(forwardID int64) {
	s.forwardMetricsMu.Lock()
	defer s.forwardMetricsMu.Unlock()
	delete(s.forwardMetrics, forwardID)
}

func NewServer(repo *repo.Repository, jwtSecret string) *Server {
	s := &Server{
		repo:      repo,
		jwtSecret: jwtSecret,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		admins:             make(map[*connWrap]struct{}),
		publics:            make(map[*connWrap]struct{}),
		nodes:              make(map[int64]map[string]*nodeSession),
		byConn:             make(map[*websocket.Conn]*nodeSession),
		pending:            make(map[string]pendingRequest),
		subscribers:        make(map[int]chan NodeMessage),
		serviceConnections: make(map[int64]map[string]map[string]int),
		forwardMetrics:     make(map[int64]map[int64]map[string]*ForwardMetric), // forwardID -> nodeID -> serviceName -> metric
		nodeOfflineTime:    make(map[int64]int64),                               // nodeID -> offline timestamp
		cleanupStop:        make(chan struct{}),
	}
	// 启动后台清理任务（每 2 分钟清理一次过期数据）
	s.cleanupWG.Add(1)
	go s.cleanupStaleMetrics(2 * time.Minute)
	return s
}

// Close stops the cleanup loop and waits for connection handlers to finish.
func (s *Server) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		close(s.cleanupStop)
		s.mu.Lock()
		s.closing = true
		connections := make([]*websocket.Conn, 0, len(s.byConn)+len(s.admins)+len(s.publics))
		for conn := range s.byConn {
			connections = append(connections, conn)
		}
		for wrapper := range s.admins {
			connections = append(connections, wrapper.conn)
		}
		for wrapper := range s.publics {
			connections = append(connections, wrapper.conn)
		}
		s.mu.Unlock()
		seen := make(map[*websocket.Conn]struct{}, len(connections))
		for _, conn := range connections {
			if conn != nil {
				if _, ok := seen[conn]; ok {
					continue
				}
				seen[conn] = struct{}{}
				_ = conn.Close()
			}
		}
		s.connectionWG.Wait()
		s.hookWG.Wait()
		s.cleanupWG.Wait()
	})
}

func (s *Server) registerConnection(conn *websocket.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		_ = conn.Close()
		return false
	}
	s.connectionWG.Add(1)
	return true
}

func (s *Server) runHook(fn func()) {
	if fn == nil {
		return
	}
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return
	}
	s.hookWG.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.hookWG.Done()
		fn()
	}()
}

func (s *Server) SubscribeNodeMessages(buffer int) (<-chan NodeMessage, func()) {
	if s == nil {
		ch := make(chan NodeMessage)
		close(ch)
		return ch, func() {}
	}
	if buffer < 1 {
		buffer = 1
	}
	ch := make(chan NodeMessage, buffer)
	s.mu.Lock()
	s.nextSubscriberID++
	id := s.nextSubscriberID
	s.subscribers[id] = ch
	s.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			s.mu.Lock()
			if current, ok := s.subscribers[id]; ok {
				delete(s.subscribers, id)
				close(current)
			}
			s.mu.Unlock()
		})
	}
	return ch, unsubscribe
}

func (s *Server) publishNodeMessage(msg NodeMessage) {
	if s == nil {
		return
	}
	s.mu.RLock()
	for _, ch := range s.subscribers {
		select {
		case ch <- msg:
		default:
		}
	}
	s.mu.RUnlock()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	typeVal := query.Get("type")
	secret := strings.TrimSpace(r.Header.Get("Authorization"))
	if secret == "" {
		secret = query.Get("secret")
	}

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

func normalizeInstanceID(instanceID string) string {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" || strings.EqualFold(instanceID, "default") {
		return ""
	}
	if len(instanceID) > 100 {
		return instanceID[:100]
	}
	return instanceID
}

func nodeInstanceKey(nodeID int64, instanceID string) string {
	return fmt.Sprintf("%d:%s", nodeID, normalizeInstanceID(instanceID))
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	if !s.registerConnection(conn) {
		return
	}
	defer s.connectionWG.Done()
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
	if !s.registerConnection(conn) {
		return
	}
	defer s.connectionWG.Done()
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
	if !s.registerConnection(conn) {
		return
	}
	defer s.connectionWG.Done()
	cw := &connWrap{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	done := make(chan struct{})
	go startKeepalive(cw, done)

	version := r.URL.Query().Get("version")
	instanceID := normalizeInstanceID(r.URL.Query().Get("instance_id"))
	hostname := strings.TrimSpace(r.URL.Query().Get("hostname"))

	unlockLifecycle := s.lockNodeLifecycle(nodeID)
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		unlockLifecycle()
		close(done)
		_ = conn.Close()
		return
	}
	if s.nodes[nodeID] == nil {
		s.nodes[nodeID] = make(map[string]*nodeSession)
	}
	var oldConn *websocket.Conn
	if old, ok := s.nodes[nodeID][instanceID]; ok {
		if old.conn != nil && old.conn.conn != nil {
			oldConn = old.conn.conn
			delete(s.byConn, oldConn)
		}
	}
	// 初始化 AES 加密器并缓存（仅创建一次）
	var nodeCrypto *security.AESCrypto
	if strings.TrimSpace(secret) != "" {
		nodeCrypto, _ = security.NewAESCrypto(secret)
	}
	ns := &nodeSession{nodeID: nodeID, instanceID: instanceID, hostname: hostname, secret: secret, conn: cw, crypto: nodeCrypto}
	s.nodes[nodeID][instanceID] = ns
	s.byConn[conn] = ns
	// 节点重新上线，清除离线时间记录
	delete(s.nodeOfflineTime, nodeID)
	s.mu.Unlock()
	if oldConn != nil {
		_ = oldConn.Close()
	}

	if err := s.repo.UpdateNodeOnline(nodeID, 1, version); err != nil {
		fmt.Printf("⚠️ 更新节点%d在线状态失败：%v\n", nodeID, err)
	}
	_ = s.repo.UpsertNodeInstance(repo.NodeInstanceUpsert{
		NodeID:     nodeID,
		InstanceID: instanceID,
		Hostname:   hostname,
		Version:    version,
		Now:        time.Now().UnixMilli(),
	})
	s.broadcastInstanceStatus(nodeID, instanceID, 1)
	s.broadcastStatus(nodeID, 1)

	s.mu.RLock()
	onlineHook := s.onNodeOnline
	instanceOnlineHook := s.onNodeInstanceOnline
	s.mu.RUnlock()
	if onlineHook != nil {
		s.runHook(func() { onlineHook(nodeID) })
	}
	if instanceOnlineHook != nil {
		s.runHook(func() { instanceOnlineHook(nodeID, instanceID) })
	}
	unlockLifecycle()

	defer func() {
		close(done)
		unlockLifecycle := s.lockNodeLifecycle(nodeID)
		defer unlockLifecycle()
		needOfflineBroadcast := false
		removedCurrentInstance := false
		var instanceOfflineHook func(nodeID int64, instanceID string)
		var offlineHook func(nodeID int64)
		s.mu.Lock()
		current, ok := s.nodes[nodeID][instanceID]
		if ok && current.conn.conn == conn {
			delete(s.nodes[nodeID], instanceID)
			delete(s.serviceConnections[nodeID], instanceID)
			removedCurrentInstance = true
			if len(s.nodes[nodeID]) == 0 {
				delete(s.nodes, nodeID)
				if len(s.serviceConnections[nodeID]) == 0 {
					delete(s.serviceConnections, nodeID)
				}
				// 记录节点离线时间
				s.nodeOfflineTime[nodeID] = time.Now().Unix()
				needOfflineBroadcast = true
			}
		}
		delete(s.byConn, conn)
		if removedCurrentInstance {
			instanceOfflineHook = s.onNodeInstanceOffline
		}
		if needOfflineBroadcast {
			offlineHook = s.onNodeOffline
		}
		s.mu.Unlock()
		if removedCurrentInstance {
			_ = s.repo.MarkNodeInstanceOffline(nodeID, instanceID, time.Now().UnixMilli())
			s.broadcastInstanceStatus(nodeID, instanceID, 0)
		}
		if needOfflineBroadcast {
			s.failPendingForNode(nodeID, "节点连接已断开")
			if err := s.repo.UpdateNodeStatus(nodeID, 0); err != nil {
				fmt.Printf("⚠️ 更新节点%d离线状态失败：%v\n", nodeID, err)
			}
			s.broadcastStatus(nodeID, 0)

		}
		if removedCurrentInstance && instanceOfflineHook != nil {
			s.runHook(func() { instanceOfflineHook(nodeID, instanceID) })
		}
		if offlineHook != nil {
			s.runHook(func() { offlineHook(nodeID) })
		}
		_ = conn.Close()
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}

		msg := decryptIfNeeded(payload, ns.crypto, secret)
		s.tryResolvePending(nodeID, ns.instanceID, msg)

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
					metricData := envelope.Data
					// 解析 SystemInfo 并调用 hook
					var sysInfo SystemInfo
					if json.Unmarshal(envelope.Data, &sysInfo) == nil {
						if strings.TrimSpace(sysInfo.InstanceID) == "" {
							sysInfo.InstanceID = ns.instanceID
						}
						if strings.TrimSpace(sysInfo.Hostname) == "" {
							sysInfo.Hostname = ns.hostname
						}
						// 缓存服务连接数
						s.mu.Lock()
						if s.serviceConnections[nodeID] == nil {
							s.serviceConnections[nodeID] = make(map[string]map[string]int)
						}
						s.serviceConnections[nodeID][strings.TrimSpace(sysInfo.InstanceID)] = sysInfo.ServiceConnections
						// 更新 service_name
						if sysInfo.ServiceName != "" {
							_ = s.repo.UpdateNodeServiceName(nodeID, sysInfo.ServiceName)
						}
						// 缓存 forward 指标
						if len(sysInfo.ForwardMetrics) > 0 {
							fmt.Printf("[ws.forward] received %d forward metrics from node %d\n", len(sysInfo.ForwardMetrics), nodeID)
							s.forwardMetricsMu.Lock()
							for _, fm := range sysInfo.ForwardMetrics {
								if fm.NodeID <= 0 {
									fm.NodeID = nodeID
								}
								serviceName := strings.TrimSpace(fm.ServiceName)
								if serviceName == "" {
									serviceName = fmt.Sprintf("%d:%d", fm.NodeID, fm.Port)
								}
								// 初始化 forwardID 的 map（如果不存在）
								if s.forwardMetrics[fm.ForwardID] == nil {
									s.forwardMetrics[fm.ForwardID] = make(map[int64]map[string]*ForwardMetric)
								}
								if s.forwardMetrics[fm.ForwardID][fm.NodeID] == nil {
									s.forwardMetrics[fm.ForwardID][fm.NodeID] = make(map[string]*ForwardMetric)
								}
								// 按 nodeID + serviceName 存储，避免入口/转发链/出口互相覆盖
								s.forwardMetrics[fm.ForwardID][fm.NodeID][serviceName] = &fm
							}
							s.forwardMetricsMu.Unlock()
						}
						s.mu.Unlock()
						_ = s.repo.UpsertNodeInstance(repo.NodeInstanceUpsert{
							NodeID:      nodeID,
							InstanceID:  sysInfo.InstanceID,
							Hostname:    sysInfo.Hostname,
							PublicIPV4:  sysInfo.PublicIPV4,
							PublicIPV6:  sysInfo.PublicIPV6,
							Version:     version,
							NetInSpeed:  sysInfo.NetInSpeed,
							NetOutSpeed: sysInfo.NetOutSpeed,
							NetInBytes:  sysInfo.NetInBytes,
							NetOutBytes: sysInfo.NetOutBytes,
							TCPConns:    sysInfo.TCPConns,
							UDPConns:    sysInfo.UDPConns,
							Uptime:      int64(sysInfo.Uptime),
							PeriodRx:    int64(sysInfo.PeriodBytesReceived),
							PeriodTx:    int64(sysInfo.PeriodBytesTransmitted),
							CPUUsage:    sysInfo.CPUUsage,
							MemUsage:    sysInfo.MemoryUsage,
							DiskUsage:   sysInfo.DiskUsage,
							Now:         time.Now().UnixMilli(),
						})
						if periodNet, err := s.repo.AccumulateNodeInstancePeriodNetTraffic(nodeID, sysInfo.InstanceID, sysInfo.NetInBytes, sysInfo.NetOutBytes, int64(sysInfo.BootID), sysInfo.NetInterfaceKey, time.Now().UnixMilli()); err == nil && periodNet != nil {
							sysInfo.PeriodNetInBytes = periodNet.InBytes
							sysInfo.PeriodNetOutBytes = periodNet.OutBytes
						}
						if normalizedMetricData, err := json.Marshal(sysInfo); err == nil {
							metricData = normalizedMetricData
						}

						s.mu.RLock()
						onMetric := s.onNodeMetric
						s.mu.RUnlock()
						if onMetric != nil {
							s.runHook(func() { onMetric(nodeID, sysInfo) })
						}
					}
					// 广播内层 data 给前端（保持平坦结构兼容性）
					s.broadcastTyped(nodeID, "metric", string(metricData))
				}
				continue
			case "ReportPublicIP":
				// 节点上报公网 IP
				var envelope struct {
					Data struct {
						InstanceID string `json:"instance_id"`
						Hostname   string `json:"hostname"`
						PublicIP   string `json:"public_ip"`
						PublicIPV4 string `json:"public_ip_v4"`
						PublicIPV6 string `json:"public_ip_v6"`
					} `json:"data"`
				}
				if err := json.Unmarshal([]byte(msg), &envelope); err == nil {
					publicIPV4 := envelope.Data.PublicIPV4
					publicIPV6 := envelope.Data.PublicIPV6
					if publicIPV4 == "" {
						publicIPV4 = envelope.Data.PublicIP
						if strings.Contains(publicIPV4, ":") {
							publicIPV6 = publicIPV4
							publicIPV4 = ""
						}
					}
					if publicIPV4 != "" || publicIPV6 != "" {
						if err := s.repo.UpsertNodeInstance(repo.NodeInstanceUpsert{
							NodeID:     nodeID,
							InstanceID: defaultString(envelope.Data.InstanceID, ns.instanceID),
							Hostname:   defaultString(envelope.Data.Hostname, ns.hostname),
							PublicIPV4: publicIPV4,
							PublicIPV6: publicIPV6,
							Version:    version,
							Now:        time.Now().UnixMilli(),
						}); err != nil {
							fmt.Printf("⚠️ 更新节点%d实例公网 IP 失败：%v\n", nodeID, err)
						} else {
							fmt.Printf("✅ 节点%d实例%s公网 IP 已更新\n", nodeID, defaultString(envelope.Data.InstanceID, ns.instanceID))
						}
					}
				}
				continue
			case "UpgradeProgress":
				s.broadcastTyped(nodeID, "upgrade_progress", msg)
				continue
			case "ReportMimicStatus":
				// 节点上报 Mimic 安装状态
				var envelope struct {
					Data struct {
						Status string `json:"status"`
						Error  string `json:"error"`
						NodeID int64  `json:"nodeId"`
					} `json:"data"`
				}
				if err := json.Unmarshal([]byte(msg), &envelope); err == nil {
					status := envelope.Data.Status
					errMsg := envelope.Data.Error
					fmt.Printf("[ws.mimic] node %d reported mimic status: %s (err=%s)\n", nodeID, status, errMsg)
					if s.repo != nil {
						if err := s.repo.UpdateNodeMimicStatus(nodeID, status, errMsg); err != nil {
							fmt.Printf("[ws.mimic] failed to update node %d mimic status: %v\n", nodeID, err)
						}
					}
					// 广播给前端
					s.broadcastTyped(nodeID, "mimic_status", msg)
				}
				continue
			case "TerminalData":
				var envelope struct {
					Data json.RawMessage `json:"data"`
				}
				_ = json.Unmarshal([]byte(msg), &envelope)
				s.publishNodeMessage(NodeMessage{
					NodeID:     nodeID,
					InstanceID: ns.instanceID,
					Hostname:   ns.hostname,
					Type:       parsed.Type,
					Raw:        msg,
					Data:       envelope.Data,
				})
				continue
			case "TerminalOpenResponse", "TerminalInputResponse", "TerminalResizeResponse", "TerminalCloseResponse":
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
				if strings.TrimSpace(sysInfo.InstanceID) == "" {
					sysInfo.InstanceID = ns.instanceID
				}
				if strings.TrimSpace(sysInfo.Hostname) == "" {
					sysInfo.Hostname = ns.hostname
				}
				// 缓存服务连接数
				s.mu.Lock()
				if s.serviceConnections[nodeID] == nil {
					s.serviceConnections[nodeID] = make(map[string]map[string]int)
				}
				s.serviceConnections[nodeID][strings.TrimSpace(sysInfo.InstanceID)] = sysInfo.ServiceConnections
				s.mu.Unlock()
				_ = s.repo.UpsertNodeInstance(repo.NodeInstanceUpsert{
					NodeID:      nodeID,
					InstanceID:  sysInfo.InstanceID,
					Hostname:    sysInfo.Hostname,
					PublicIPV4:  sysInfo.PublicIPV4,
					PublicIPV6:  sysInfo.PublicIPV6,
					Version:     version,
					NetInSpeed:  sysInfo.NetInSpeed,
					NetOutSpeed: sysInfo.NetOutSpeed,
					NetInBytes:  sysInfo.NetInBytes,
					NetOutBytes: sysInfo.NetOutBytes,
					TCPConns:    sysInfo.TCPConns,
					UDPConns:    sysInfo.UDPConns,
					Uptime:      int64(sysInfo.Uptime),
					PeriodRx:    int64(sysInfo.PeriodBytesReceived),
					PeriodTx:    int64(sysInfo.PeriodBytesTransmitted),
					CPUUsage:    sysInfo.CPUUsage,
					MemUsage:    sysInfo.MemoryUsage,
					DiskUsage:   sysInfo.DiskUsage,
					Now:         time.Now().UnixMilli(),
				})
				if periodNet, err := s.repo.AccumulateNodeInstancePeriodNetTraffic(nodeID, sysInfo.InstanceID, sysInfo.NetInBytes, sysInfo.NetOutBytes, int64(sysInfo.BootID), sysInfo.NetInterfaceKey, time.Now().UnixMilli()); err == nil && periodNet != nil {
					sysInfo.PeriodNetInBytes = periodNet.InBytes
					sysInfo.PeriodNetOutBytes = periodNet.OutBytes
				}

				s.mu.RLock()
				onMetric := s.onNodeMetric
				s.mu.RUnlock()
				if onMetric != nil {
					s.runHook(func() { onMetric(nodeID, sysInfo) })
				}
				normalizedMsg := msg
				if data, err := json.Marshal(sysInfo); err == nil {
					normalizedMsg = string(data)
				}
				s.broadcastTyped(nodeID, "metric", normalizedMsg)
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

	sessions := s.activeNodeSessions(nodeID)
	if len(sessions) == 0 {
		return CommandResult{}, errors.New("节点不在线")
	}
	return s.sendCommandToSessions(sessions, cmdType, data, timeout)
}

func (s *Server) SendCommandToInstance(nodeID int64, instanceID string, cmdType string, data interface{}, timeout time.Duration) (CommandResult, error) {
	if s == nil {
		return CommandResult{}, errors.New("server not initialized")
	}
	if strings.TrimSpace(cmdType) == "" {
		return CommandResult{}, errors.New("command type is empty")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ns := s.activeNodeSession(nodeID, instanceID)
	if ns == nil {
		return CommandResult{}, errors.New("节点实例不在线")
	}
	return s.sendCommandToSession(ns, cmdType, data, timeout)
}

func (s *Server) SendTypedMessageToInstance(nodeID int64, instanceID string, msgType string, data interface{}) error {
	if s == nil {
		return errors.New("server not initialized")
	}
	if strings.TrimSpace(msgType) == "" {
		return errors.New("message type is empty")
	}
	ns := s.activeNodeSession(nodeID, instanceID)
	if ns == nil {
		return errors.New("节点实例不在线")
	}
	payload := map[string]interface{}{
		"type": msgType,
		"data": data,
	}
	return s.writeMessageToSession(ns, payload)
}

func (s *Server) activeNodeSessions(nodeID int64) []*nodeSession {
	s.mu.RLock()
	defer s.mu.RUnlock()
	byInstance := s.nodes[nodeID]
	if len(byInstance) == 0 {
		return nil
	}
	sessions := make([]*nodeSession, 0, len(byInstance))
	for _, ns := range byInstance {
		if ns != nil && ns.conn != nil && ns.conn.conn != nil {
			sessions = append(sessions, ns)
		}
	}
	sort.SliceStable(sessions, func(i, j int) bool {
		return sessions[i].instanceID < sessions[j].instanceID
	})
	return sessions
}

func (s *Server) activeNodeSession(nodeID int64, instanceID string) *nodeSession {
	instanceID = normalizeInstanceID(instanceID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	byInstance := s.nodes[nodeID]
	if len(byInstance) == 0 {
		return nil
	}
	ns := byInstance[instanceID]
	if ns == nil || ns.conn == nil || ns.conn.conn == nil {
		return nil
	}
	return ns
}

type commandSessionResult struct {
	result CommandResult
	err    error
}

func (s *Server) sendCommandToSessions(sessions []*nodeSession, cmdType string, data interface{}, timeout time.Duration) (CommandResult, error) {
	if len(sessions) == 0 {
		return CommandResult{}, errors.New("节点不在线")
	}
	if len(sessions) == 1 {
		return s.sendCommandToSession(sessions[0], cmdType, data, timeout)
	}

	resultCh := make(chan commandSessionResult, len(sessions))
	var wg sync.WaitGroup
	for _, ns := range sessions {
		ns := ns
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := s.sendCommandToSession(ns, cmdType, data, timeout)
			resultCh <- commandSessionResult{result: res, err: err}
		}()
	}
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	var result CommandResult
	var firstErr error
	var errorResult CommandResult
	errorsByInstance := make([]string, 0)
	successCount := 0
	for item := range resultCh {
		if item.err != nil {
			if firstErr == nil {
				firstErr = item.err
				errorResult = item.result
			}
			label := item.result.InstanceID
			if strings.TrimSpace(item.result.Hostname) != "" {
				label = item.result.Hostname
			}
			if strings.TrimSpace(label) == "" {
				label = "unknown"
			}
			errorsByInstance = append(errorsByInstance, fmt.Sprintf("实例%s: %v", label, item.err))
			continue
		}
		successCount++
		result = item.result
	}
	if successCount == len(sessions) {
		return result, nil
	}
	if successCount > 0 && !commandRequiresAllInstances(cmdType) {
		return result, nil
	}
	if firstErr == nil {
		return result, nil
	}
	message := strings.Join(errorsByInstance, "; ")
	if successCount > 0 {
		message = fmt.Sprintf("部分实例命令失败（成功 %d/%d）：%s", successCount, len(sessions), message)
	}
	errorResult.Success = false
	errorResult.Message = message
	return errorResult, errors.New(message)
}

func commandRequiresAllInstances(cmdType string) bool {
	switch strings.TrimSpace(cmdType) {
	case "TcpPing", "ListServices", "SdwanDiag":
		return false
	default:
		return true
	}
}

func (s *Server) sendCommandToSession(ns *nodeSession, cmdType string, data interface{}, timeout time.Duration) (CommandResult, error) {
	if ns == nil || ns.conn == nil || ns.conn.conn == nil {
		return CommandResult{}, errors.New("节点不在线")
	}
	baseResult := CommandResult{InstanceID: ns.instanceID, Hostname: ns.hostname}

	requestID := fmt.Sprintf("%d_%s_%d", ns.nodeID, ns.instanceID, time.Now().UnixNano())
	ch := make(chan CommandResult, 1)
	debugMimic := strings.HasPrefix(strings.TrimSpace(cmdType), "Mimic")

	s.mu.Lock()
	s.pending[requestID] = pendingRequest{nodeID: ns.nodeID, instanceID: ns.instanceID, ch: ch}
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
		return baseResult, err
	}
	if debugMimic {
		log.Printf("[mimic.debug] send command node=%d instance=%s type=%s requestId=%s payload=%s", ns.nodeID, ns.instanceID, cmdType, requestID, string(rawCmd))
	}

	if err := s.writeMessageToSession(ns, cmdPayload); err != nil {
		if debugMimic {
			log.Printf("[mimic.debug] write command failed node=%d instance=%s type=%s requestId=%s err=%v", ns.nodeID, ns.instanceID, cmdType, requestID, err)
		}
		cleanup()
		return baseResult, err
	}

	select {
	case result, ok := <-ch:
		if !ok {
			if debugMimic {
				log.Printf("[mimic.debug] command channel closed node=%d instance=%s type=%s requestId=%s", ns.nodeID, ns.instanceID, cmdType, requestID)
			}
			return baseResult, errors.New("命令通道已关闭")
		}
		result.InstanceID = ns.instanceID
		result.Hostname = ns.hostname
		if !result.Success {
			if strings.TrimSpace(result.Message) == "" {
				result.Message = "命令执行失败"
			}
			if debugMimic {
				log.Printf("[mimic.debug] command failed node=%d instance=%s type=%s requestId=%s msg=%s", ns.nodeID, ns.instanceID, cmdType, requestID, result.Message)
			}
			return result, errors.New(result.Message)
		}
		if debugMimic {
			log.Printf("[mimic.debug] command succeeded node=%d instance=%s type=%s requestId=%s", ns.nodeID, ns.instanceID, cmdType, requestID)
		}
		return result, nil
	case <-time.After(timeout):
		if debugMimic {
			log.Printf("[mimic.debug] command timeout node=%d instance=%s type=%s requestId=%s timeout=%s", ns.nodeID, ns.instanceID, cmdType, requestID, timeout)
		}
		cleanup()
		return baseResult, errors.New("等待节点响应超时")
	}
}

func (s *Server) writeMessageToSession(ns *nodeSession, payload interface{}) error {
	if ns == nil || ns.conn == nil || ns.conn.conn == nil {
		return errors.New("节点不在线")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	messageData := raw
	if ns.crypto != nil {
		encrypted, err := ns.crypto.Encrypt(raw)
		if err != nil {
			return err
		}
		wrapper := map[string]interface{}{
			"encrypted": true,
			"data":      encrypted,
			"timestamp": time.Now().UnixMilli(),
		}
		messageData, err = json.Marshal(wrapper)
		if err != nil {
			return err
		}
	}
	ns.conn.mu.Lock()
	defer ns.conn.mu.Unlock()
	_ = ns.conn.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
	err = ns.conn.conn.WriteMessage(websocket.TextMessage, messageData)
	_ = ns.conn.conn.SetWriteDeadline(time.Time{})
	return err
}

func (s *Server) tryResolvePending(nodeID int64, instanceID string, message string) {
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
	if p.nodeID != nodeID || p.instanceID != instanceID {
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

func (s *Server) broadcastInstanceStatus(nodeID int64, instanceID string, status int) {
	instanceID = strings.TrimSpace(instanceID)
	if nodeID <= 0 || instanceID == "" {
		return
	}
	payload := map[string]interface{}{
		"id":   strconv.FormatInt(nodeID, 10),
		"type": "instance_status",
		"data": map[string]interface{}{
			"instanceId": instanceID,
			"status":     status,
		},
	}
	raw, _ := json.Marshal(payload)
	msg := string(raw)
	s.broadcastToAdmins(msg)
	s.broadcastToPublics(msg)
}

func (s *Server) DisconnectNode(nodeID int64) {
	if s == nil {
		return
	}

	unlockLifecycle := s.lockNodeLifecycle(nodeID)
	defer unlockLifecycle()

	type disconnectedSession struct {
		instanceID string
		conn       *websocket.Conn
	}

	s.mu.Lock()
	sessions, ok := s.nodes[nodeID]
	if !ok {
		s.mu.Unlock()
		return
	}

	s.nodeOfflineTime[nodeID] = time.Now().Unix()

	disconnected := make([]disconnectedSession, 0, len(sessions))
	for instanceID, ns := range sessions {
		var conn *websocket.Conn
		if ns.conn != nil && ns.conn.conn != nil {
			conn = ns.conn.conn
			delete(s.byConn, ns.conn.conn)
		}
		disconnected = append(disconnected, disconnectedSession{
			instanceID: instanceID,
			conn:       conn,
		})
	}
	instanceOfflineHook := s.onNodeInstanceOffline
	offlineHook := s.onNodeOffline
	delete(s.nodes, nodeID)
	delete(s.serviceConnections, nodeID)
	s.mu.Unlock()

	now := time.Now().UnixMilli()
	for _, session := range disconnected {
		if session.conn != nil {
			_ = session.conn.Close()
		}
		_ = s.repo.MarkNodeInstanceOffline(nodeID, session.instanceID, now)
		s.broadcastInstanceStatus(nodeID, session.instanceID, 0)
	}

	s.failPendingForNode(nodeID, "节点被面板踢下线")
	if err := s.repo.UpdateNodeStatus(nodeID, 0); err != nil {
		fmt.Printf("⚠️ 更新节点%d离线状态失败：%v\n", nodeID, err)
	}
	s.broadcastStatus(nodeID, 0)

	if instanceOfflineHook != nil {
		for _, session := range disconnected {
			instanceID := session.instanceID
			s.runHook(func() { instanceOfflineHook(nodeID, instanceID) })
		}
	}
	if offlineHook != nil {
		s.runHook(func() { offlineHook(nodeID) })
	}
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
	if msgType == "metric" {
		if publicData, ok := sanitizePublicMetricData(data); ok {
			publicPayload := broadcastMessage{ID: nodeID, Type: msgType, Data: publicData}
			publicRaw, _ := json.Marshal(publicPayload)
			s.broadcastToPublics(string(publicRaw))
		}
		return
	}
	s.broadcastToPublics(msg)
}

func sanitizePublicMetricData(data string) (string, bool) {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		return "", false
	}
	allowed := map[string]struct{}{
		"instance_id":              {},
		"instanceId":               {},
		"status":                   {},
		"net_in_speed":             {},
		"netInSpeed":               {},
		"net_out_speed":            {},
		"netOutSpeed":              {},
		"bytes_received":           {},
		"netInBytes":               {},
		"net_in_bytes":             {},
		"bytes_transmitted":        {},
		"netOutBytes":              {},
		"net_out_bytes":            {},
		"period_net_in_bytes":      {},
		"periodNetInBytes":         {},
		"period_net_out_bytes":     {},
		"periodNetOutBytes":        {},
		"period_bytes_received":    {},
		"periodRx":                 {},
		"period_bytes_transmitted": {},
		"periodTx":                 {},
		"uptime":                   {},
		"cpu_usage":                {},
		"cpuUsage":                 {},
		"memory_usage":             {},
		"memoryUsage":              {},
		"disk_usage":               {},
		"diskUsage":                {},
		"tcp_conns":                {},
		"tcpConns":                 {},
		"udp_conns":                {},
		"udpConns":                 {},
	}
	clean := make(map[string]interface{}, len(allowed))
	for key, value := range raw {
		if _, ok := allowed[key]; ok {
			clean[key] = value
		}
	}
	if len(clean) == 0 {
		return "", false
	}
	out, err := json.Marshal(clean)
	if err != nil {
		return "", false
	}
	return string(out), true
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
	defer s.cleanupWG.Done()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.cleanupStop:
			return
		case <-ticker.C:
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
}
