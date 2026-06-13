package adapter

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/service"
	floxcfg "github.com/go-gost/x/flox-core/config"
	floxlimiter "github.com/go-gost/x/flox-core/limiter"
	floxforwarder "github.com/go-gost/x/flox-core/forwarder"
	xstats "github.com/go-gost/x/observer/stats"
	goservice "github.com/go-gost/x/service"
	"github.com/sirupsen/logrus"
	nebulacfg "github.com/slackhq/nebula/config"
	"golang.org/x/time/rate"
)

const defaultSDWANConfigPath = "/etc/flox_agent/sdwan/config.yml"

type sdwanDialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
	Dial(network, address string) (net.Conn, error)
	Listen(network, address string) (net.Listener, error)
	ListenPacket(network, address string) (net.PacketConn, error)
}

type sdwanCountedConn struct {
	net.Conn
	stats floxforwarder.TrafficStats
}

func (c *sdwanCountedConn) Read(b []byte) (int, error) {
	n, err := c.Conn.Read(b)
	if n > 0 && c.stats != nil {
		c.stats.AddInputBytes(int64(n))
	}
	return n, err
}

func (c *sdwanCountedConn) Write(b []byte) (int, error) {
	n, err := c.Conn.Write(b)
	if n > 0 && c.stats != nil {
		c.stats.AddOutputBytes(int64(n))
	}
	return n, err
}

type sdwanSelector interface {
	Select(nodes []floxforwarder.Node) (floxforwarder.Node, error)
	Feedback(addr string, success bool)
}

type sdwanFIFOSelector struct {
	mu    sync.Mutex
	fails map[string]int
}

func (s *sdwanFIFOSelector) Select(nodes []floxforwarder.Node) (floxforwarder.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, n := range nodes {
		if s.fails[n.Addr] > 0 {
			continue
		}
		return n, nil
	}
	s.fails = make(map[string]int)
	return nodes[0], nil
}

func (s *sdwanFIFOSelector) Feedback(addr string, success bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if success {
		delete(s.fails, addr)
		return
	}
	s.fails[addr]++
}

type sdwanRoundSelector struct {
	mu  sync.Mutex
	idx int
}

func (s *sdwanRoundSelector) Select(nodes []floxforwarder.Node) (floxforwarder.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	node := nodes[s.idx%len(nodes)]
	s.idx++
	return node, nil
}

func (s *sdwanRoundSelector) Feedback(string, bool) {}

type sdwanRandomSelector struct{}

func (s *sdwanRandomSelector) Select(nodes []floxforwarder.Node) (floxforwarder.Node, error) {
	if len(nodes) == 0 {
		return floxforwarder.Node{}, fmt.Errorf("no target nodes")
	}
	return nodes[time.Now().UnixNano()%int64(len(nodes))], nil
}

func (s *sdwanRandomSelector) Feedback(string, bool) {}

func newSDWANSelector(strategy string) sdwanSelector {
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "round", "roundrobin":
		return &sdwanRoundSelector{}
	case "rand", "random":
		return &sdwanRandomSelector{}
	default:
		return &sdwanFIFOSelector{fails: make(map[string]int)}
	}
}

func resolveSDWANConfigPath(metadata map[string]any) string {
	if metadata != nil {
		if v, ok := metadata["sdwanConfigPath"]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	if s := strings.TrimSpace(os.Getenv("FLOX_SDWAN_CONFIG")); s != "" {
		return s
	}
	return defaultSDWANConfigPath
}

func resolveSDWANConfigYAML(metadata map[string]any) string {
	if metadata == nil {
		return ""
	}
	if v, ok := metadata["sdwanConfigYAML"]; ok {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func resolveSDWANConfigValue(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	if v, ok := metadata[key]; ok {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func writeYAMLScalarOrBlock(b *strings.Builder, key, value string) {
	if value == "" {
		return
	}
	if strings.Contains(value, "\n") {
		b.WriteString("  " + key + ": |\n")
		for _, line := range strings.Split(value, "\n") {
			b.WriteString("    " + line + "\n")
		}
		return
	}
	b.WriteString("  " + key + ": " + value + "\n")
}

func generateSDWANConfigYAML(metadata map[string]any) string {
	caPath := resolveSDWANConfigValue(metadata, "sdwanCAPath")
	caPEM := resolveSDWANConfigValue(metadata, "sdwanCAPEM")
	certPath := resolveSDWANConfigValue(metadata, "sdwanCertPath")
	certPEM := resolveSDWANConfigValue(metadata, "sdwanCertPEM")
	keyPath := resolveSDWANConfigValue(metadata, "sdwanKeyPath")
	keyPEM := resolveSDWANConfigValue(metadata, "sdwanKeyPEM")
	isLighthouse := strings.EqualFold(resolveSDWANConfigValue(metadata, "sdwanIsLighthouse"), "true")
	lighthouseVPNIP := resolveSDWANConfigValue(metadata, "sdwanLighthouseVPNIP")
	lighthouseAddr := resolveSDWANConfigValue(metadata, "sdwanLighthouseAddr")
	backupVPNIPs := strings.Split(resolveSDWANConfigValue(metadata, "sdwanBackupLighthouseVPNIPs"), ",")
	backupAddrs := strings.Split(resolveSDWANConfigValue(metadata, "sdwanBackupLighthouseAddrs"), ",")
	listenHost := resolveSDWANConfigValue(metadata, "sdwanListenHost")
	listenPort := resolveSDWANConfigValue(metadata, "sdwanListenPort")

	if caPath == "" && caPEM == "" && certPath == "" && certPEM == "" && keyPath == "" && keyPEM == "" && lighthouseVPNIP == "" && lighthouseAddr == "" && listenHost == "" && listenPort == "" {
		return ""
	}
	if listenHost == "" {
		listenHost = "0.0.0.0"
	}
	if listenPort == "" {
		listenPort = "4242"
	}
	if lighthouseVPNIP == "" {
		lighthouseVPNIP = "192.168.100.1"
	}
	if lighthouseAddr == "" {
		lighthouseAddr = lighthouseVPNIP + ":" + listenPort
	}

	var b strings.Builder
	b.WriteString("pki:\n")
	if caPEM != "" {
		writeYAMLScalarOrBlock(&b, "ca", caPEM)
	} else {
		writeYAMLScalarOrBlock(&b, "ca", caPath)
	}
	if certPEM != "" {
		writeYAMLScalarOrBlock(&b, "cert", certPEM)
	} else {
		writeYAMLScalarOrBlock(&b, "cert", certPath)
	}
	if keyPEM != "" {
		writeYAMLScalarOrBlock(&b, "key", keyPEM)
	} else {
		writeYAMLScalarOrBlock(&b, "key", keyPath)
	}
	b.WriteString("static_host_map:\n")
	if !isLighthouse {
		b.WriteString("  \"" + lighthouseVPNIP + "\": [\"" + lighthouseAddr + "\"]\n")
		for i := range backupVPNIPs {
			vpn := strings.TrimSpace(backupVPNIPs[i])
			if vpn == "" {
				continue
			}
			addr := ""
			if i < len(backupAddrs) {
				addr = strings.TrimSpace(backupAddrs[i])
			}
			if addr == "" {
				continue
			}
			b.WriteString("  \"" + vpn + "\": [\"" + addr + "\"]\n")
		}
	}
	b.WriteString("lighthouse:\n")
	b.WriteString("  am_lighthouse: " + strconv.FormatBool(isLighthouse) + "\n")
	b.WriteString("  interval: 60\n")
	b.WriteString("  hosts:\n")
	if !isLighthouse {
		b.WriteString("    - \"" + lighthouseVPNIP + "\"\n")
		for _, vpn := range backupVPNIPs {
			vpn = strings.TrimSpace(vpn)
			if vpn == "" {
				continue
			}
			b.WriteString("    - \"" + vpn + "\"\n")
		}
	}
	b.WriteString("listen:\n")
	b.WriteString("  host: " + listenHost + "\n")
	b.WriteString("  port: " + listenPort + "\n")
	b.WriteString("punchy:\n")
	b.WriteString("  punch: true\n")
	b.WriteString("relay:\n")
	b.WriteString("  am_relay: false\n")
	b.WriteString("  use_relays: true\n")
	b.WriteString("tun:\n")
	b.WriteString("  disabled: false\n")
	b.WriteString("  dev: nebula1\n")
	b.WriteString("  mtu: 1300\n")
	b.WriteString("firewall:\n")
	b.WriteString("  outbound_action: drop\n")
	b.WriteString("  inbound_action: drop\n")
	b.WriteString("  outbound:\n")
	b.WriteString("    - port: any\n")
	b.WriteString("      proto: any\n")
	b.WriteString("      host: any\n")
	b.WriteString("  inbound:\n")
	b.WriteString("    - port: any\n")
	b.WriteString("      proto: any\n")
	b.WriteString("      host: any\n")
	return b.String()
}

func getSDWANOverlayService(metadata map[string]any) (sdwanDialer, error) {
	if rawYAML := resolveSDWANConfigYAML(metadata); rawYAML != "" {
		logger := logrus.New()
		logger.Out = os.Stdout
		c := nebulacfg.NewC(logger)
		if err := c.LoadString(rawYAML); err != nil {
			return nil, fmt.Errorf("load inline sdwan config: %w", err)
		}
		return newSDWANOverlayService(c)
	}

	if generated := generateSDWANConfigYAML(metadata); generated != "" {
		logger := logrus.New()
		logger.Out = os.Stdout
		c := nebulacfg.NewC(logger)
		if err := c.LoadString(generated); err != nil {
			return nil, fmt.Errorf("load generated sdwan config: %w", err)
		}
		return newSDWANOverlayService(c)
	}

	path := resolveSDWANConfigPath(metadata)
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("sdwan config not found: %s", path)
	}
	logger := logrus.New()
	logger.Out = os.Stdout
	c := nebulacfg.NewC(logger)
	if err := c.Load(path); err != nil {
		return nil, fmt.Errorf("load sdwan config %s: %w", path, err)
	}
	return newSDWANOverlayService(c)
}

type sdwanTCPForwarder struct {
	name        string
	addr        string
	nodes       []floxforwarder.Node
	sel         sdwanSelector
	limiter     *floxforwarder.ConnLimiter
	limiterName string
	stats       floxforwarder.TrafficStats
	ln          net.Listener
	overlay     sdwanDialer
	overlayListen bool
	dialMode    string
	wg          sync.WaitGroup
}

func (f *sdwanTCPForwarder) Name() string { return f.name }

func (f *sdwanTCPForwarder) Serve(ctx context.Context) error {
	var (
		ln  net.Listener
		err error
	)
	if f.overlayListen {
		ln, err = f.overlay.Listen("tcp", f.addr)
	} else {
		var lc net.ListenConfig
		ln, err = lc.Listen(ctx, "tcp", f.addr)
	}
	if err != nil {
		return err
	}
	f.ln = ln
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
			}
			continue
		}
		if !f.limiter.Acquire() {
			_ = conn.Close()
			continue
		}
		f.wg.Add(1)
		go func() {
			defer f.wg.Done()
			defer f.limiter.Release()
			f.handle(ctx, conn)
		}()
	}
}

func (f *sdwanTCPForwarder) Close() error {
	if f.ln != nil {
		_ = f.ln.Close()
	}
	f.wg.Wait()
	return nil
}

func (f *sdwanTCPForwarder) SetMaxConns(n int) { f.limiter.SetMax(n) }

func (f *sdwanTCPForwarder) handle(ctx context.Context, inbound net.Conn) {
	defer inbound.Close()
	if f.stats != nil {
		f.stats.AddCurrentConns(1)
		defer f.stats.AddCurrentConns(-1)
	}
	if goservice.NeedWrap() {
		inbound = goservice.WrapConnPDetection(inbound)
	}
	if f.stats != nil {
		inbound = &sdwanCountedConn{Conn: inbound, stats: f.stats}
	}
	if f.limiterName != "" {
		if l := floxlimiter.Get(f.limiterName); l != nil {
			inbound = l.WrapConn(inbound)
		}
	}

	target, err := f.sel.Select(f.nodes)
	if err != nil {
		return
	}
	var outbound net.Conn
	if strings.EqualFold(f.dialMode, "direct") {
		var d net.Dialer
		outbound, err = d.DialContext(ctx, "tcp", target.Addr)
	} else {
		outbound, err = f.overlay.DialContext(ctx, "tcp", target.Addr)
	}
	if err != nil {
		f.sel.Feedback(target.Addr, false)
		return
	}
	defer outbound.Close()
	f.sel.Feedback(target.Addr, true)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(outbound, inbound)
		_ = outbound.Close()
		_ = inbound.Close()
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(inbound, outbound)
		_ = inbound.Close()
		_ = outbound.Close()
	}()
	wg.Wait()
}

type sdwanUDPSession struct {
	conn         net.Conn
	expires      time.Time
	readLimiter  *rate.Limiter
	writeLimiter *rate.Limiter
}

type sdwanUDPForwarder struct {
	name        string
	addr        string
	nodes       []floxforwarder.Node
	sel         sdwanSelector
	limiter     *floxforwarder.ConnLimiter
	limiterName string
	stats       floxforwarder.TrafficStats
	conn        net.PacketConn
	overlay     sdwanDialer
	overlayListen bool
	dialMode    string
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup

	mu       sync.Mutex
	sessions map[string]*sdwanUDPSession
}

func (f *sdwanUDPForwarder) Name() string { return f.name }

func (f *sdwanUDPForwarder) Serve(ctx context.Context) error {
	var (
		conn net.PacketConn
		err error
	)
	if f.overlayListen {
		conn, err = f.overlay.ListenPacket("udp", f.addr)
	} else {
		addr, rerr := net.ResolveUDPAddr("udp", f.addr)
		if rerr != nil {
			return rerr
		}
		conn, err = net.ListenUDP("udp", addr)
	}
	if err != nil {
		return err
	}
	f.conn = conn
	go f.cleanupLoop()

	buf := make([]byte, 64*1024)
	for {
		n, remote, err := conn.ReadFrom(buf)
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
			}
			continue
		}
		if !f.limiter.Acquire() {
			continue
		}
		f.wg.Add(1)
		payload := append([]byte(nil), buf[:n]...)
		go func(data []byte, src net.Addr) {
			defer f.wg.Done()
			defer f.limiter.Release()
			f.handlePacket(data, src)
		}(payload, remote)
	}
}

func (f *sdwanUDPForwarder) handlePacket(data []byte, src net.Addr) {
	key := src.String()

	f.mu.Lock()
	sess, ok := f.sessions[key]
	if !ok {
		target, err := f.sel.Select(f.nodes)
		if err != nil {
			f.mu.Unlock()
			return
		}
		var conn net.Conn
		if strings.EqualFold(f.dialMode, "direct") {
			raddr, rerr := net.ResolveUDPAddr("udp", target.Addr)
			if rerr != nil {
				f.mu.Unlock()
				return
			}
			dconn, derr := net.DialUDP("udp", nil, raddr)
			if derr != nil {
				f.sel.Feedback(target.Addr, false)
				f.mu.Unlock()
				return
			}
			conn = dconn
		} else {
			conn, err = f.overlay.Dial("udp", target.Addr)
			if err != nil {
				f.sel.Feedback(target.Addr, false)
				f.mu.Unlock()
				return
			}
		}
		f.sel.Feedback(target.Addr, true)
		var readLimiter, writeLimiter *rate.Limiter
		if f.limiterName != "" {
			if l := floxlimiter.Get(f.limiterName); l != nil {
				readLimiter = l.NewReadLimiter()
				writeLimiter = l.NewWriteLimiter()
			}
		}
		sess = &sdwanUDPSession{
			conn:         conn,
			expires:      time.Now().Add(30 * time.Second),
			readLimiter:  readLimiter,
			writeLimiter: writeLimiter,
		}
		f.sessions[key] = sess
		if f.stats != nil {
			f.stats.AddCurrentConns(1)
		}
		go f.returnLoop(key, sess, src)
	} else {
		sess.expires = time.Now().Add(30 * time.Second)
	}
	f.mu.Unlock()

	if f.stats != nil {
		f.stats.AddInputBytes(int64(len(data)))
	}
	if sess.readLimiter != nil {
		_ = sess.readLimiter.WaitN(context.Background(), len(data))
	}
	_, _ = sess.conn.Write(data)
}

func (f *sdwanUDPForwarder) returnLoop(key string, sess *sdwanUDPSession, clientAddr net.Addr) {
	buf := make([]byte, 64*1024)
	defer func() {
		f.mu.Lock()
		delete(f.sessions, key)
		f.mu.Unlock()
		if f.stats != nil {
			f.stats.AddCurrentConns(-1)
		}
		_ = sess.conn.Close()
	}()
	for {
		n, err := sess.conn.Read(buf)
		if err != nil {
			return
		}
		if f.stats != nil {
			f.stats.AddOutputBytes(int64(n))
		}
		if sess.writeLimiter != nil {
			_ = sess.writeLimiter.WaitN(context.Background(), n)
		}
		_, _ = f.conn.WriteTo(buf[:n], clientAddr)
	}
}

func (f *sdwanUDPForwarder) cleanupLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-f.ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			f.mu.Lock()
			for key, sess := range f.sessions {
				if now.After(sess.expires) {
					_ = sess.conn.Close()
					delete(f.sessions, key)
				}
			}
			f.mu.Unlock()
		}
	}
}

func (f *sdwanUDPForwarder) Close() error {
	f.cancel()
	if f.conn != nil {
		_ = f.conn.Close()
	}
	f.mu.Lock()
	for _, sess := range f.sessions {
		_ = sess.conn.Close()
	}
	f.sessions = nil
	f.mu.Unlock()
	f.wg.Wait()
	return nil
}

func (f *sdwanUDPForwarder) SetMaxConns(n int) { f.limiter.SetMax(n) }

func newSDWANTCPForwarder(cfg *floxcfg.ServiceConfig, overlay sdwanDialer, stats floxforwarder.TrafficStats) (*sdwanTCPForwarder, error) {
	if cfg == nil || cfg.Forwarder == nil || len(cfg.Forwarder.Nodes) == 0 {
		return nil, fmt.Errorf("sdwan tcp forwarder: no target nodes")
	}
	nodes := make([]floxforwarder.Node, 0, len(cfg.Forwarder.Nodes))
	for _, n := range cfg.Forwarder.Nodes {
		nodes = append(nodes, floxforwarder.Node{Name: n.Name, Addr: n.Addr})
	}
	return &sdwanTCPForwarder{
		name:        cfg.Name,
		addr:        cfg.Addr,
		nodes:       nodes,
		sel:         newSDWANSelector(cfg.Forwarder.Selector.Strategy),
		limiter:     floxforwarder.NewConnLimiter(0),
		limiterName: cfg.Limiter,
		stats:       stats,
		overlay:     overlay,
		overlayListen: strings.EqualFold(resolveSDWANConfigValue(cfg.Metadata, "sdwanOverlayListen"), "true"),
		dialMode:    resolveSDWANConfigValue(cfg.Metadata, "sdwanDialMode"),
	}, nil
}

func newSDWANUDPForwarder(cfg *floxcfg.ServiceConfig, overlay sdwanDialer, stats floxforwarder.TrafficStats) (*sdwanUDPForwarder, error) {
	if cfg == nil || cfg.Forwarder == nil || len(cfg.Forwarder.Nodes) == 0 {
		return nil, fmt.Errorf("sdwan udp forwarder: no target nodes")
	}
	nodes := make([]floxforwarder.Node, 0, len(cfg.Forwarder.Nodes))
	for _, n := range cfg.Forwarder.Nodes {
		nodes = append(nodes, floxforwarder.Node{Name: n.Name, Addr: n.Addr})
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &sdwanUDPForwarder{
		name:        cfg.Name,
		addr:        cfg.Addr,
		nodes:       nodes,
		sel:         newSDWANSelector(cfg.Forwarder.Selector.Strategy),
		limiter:     floxforwarder.NewConnLimiter(0),
		limiterName: cfg.Limiter,
		stats:       stats,
		overlay:     overlay,
		overlayListen: strings.EqualFold(resolveSDWANConfigValue(cfg.Metadata, "sdwanOverlayListen"), "true"),
		dialMode:    resolveSDWANConfigValue(cfg.Metadata, "sdwanDialMode"),
		ctx:         ctx,
		cancel:      cancel,
		sessions:    make(map[string]*sdwanUDPSession),
	}, nil
}

// NewSDWANService starts the premium sdwan kernel runtime.
// The first version keeps the public listener on the local node and forwards
// outbound TCP/UDP traffic over a Nebula overlay loaded from disk.
func NewSDWANService(cfg *floxcfg.ServiceConfig) (service.Service, error) {
	if cfg == nil {
		return nil, fmt.Errorf("sdwan service: invalid config")
	}
	overlay, err := getSDWANOverlayService(cfg.Metadata)
	if err != nil {
		return nil, err
	}

	var st *xstats.Stats
	if raw := xstats.NewStats(true); raw != nil {
		st, _ = raw.(*xstats.Stats)
	}
	ast := &adapterStats{st: st}

	var runtime interface {
		Serve(context.Context) error
		Close() error
		SetMaxConns(n int)
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Handler.Type)) {
	case "tcp":
		runtime, err = newSDWANTCPForwarder(cfg, overlay, ast)
	case "udp":
		runtime, err = newSDWANUDPForwarder(cfg, overlay, ast)
	default:
		err = fmt.Errorf("sdwan service %s: unsupported handler type %s", strings.TrimSpace(cfg.Name), cfg.Handler.Type)
	}
	if err != nil {
		return nil, err
	}

	addr, _ := net.ResolveTCPAddr("tcp", cfg.Addr)
	ws := &wrappedService{name: cfg.Name, svc: runtime, addr: addr, stats: ast}
	if addr != nil {
		ws.port = addr.Port
	}
	if parts := strings.SplitN(cfg.Name, "_", 4); len(parts) == 4 {
		if fid, err := strconv.ParseInt(parts[0], 10, 64); err == nil && fid > 0 {
			ws.forwardID = fid
			ws.userID, _ = strconv.ParseInt(parts[1], 10, 64)
			ws.tunnelID, _ = strconv.ParseInt(parts[2], 10, 64)
		}
	}
	return ws, nil
}
