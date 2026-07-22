package local

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/hop"
	md "github.com/go-gost/core/metadata"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/recorder"
	ctxvalue "github.com/go-gost/x/ctx"
	xnet "github.com/go-gost/x/internal/net"
	"github.com/go-gost/x/internal/util/forwarder"
	"github.com/go-gost/x/internal/util/sniffing"
	tls_util "github.com/go-gost/x/internal/util/tls"
	rate_limiter "github.com/go-gost/x/limiter/rate"
	xstats "github.com/go-gost/x/observer/stats"
	stats_wrapper "github.com/go-gost/x/observer/stats/wrapper"
	xrecorder "github.com/go-gost/x/recorder"
	"github.com/go-gost/x/registry"
	forwardStats "github.com/go-gost/x/stats"
)

func init() {
	registry.HandlerRegistry().Register("tcp", NewHandler)
	registry.HandlerRegistry().Register("udp", NewHandler)
	registry.HandlerRegistry().Register("forward", NewHandler)
}

type forwardHandler struct {
	hop      hop.Hop
	md       metadata
	options  handler.Options
	recorder recorder.RecorderObject
	certPool tls_util.CertPool
}

func NewHandler(opts ...handler.Option) handler.Handler {
	options := handler.Options{}
	for _, opt := range opts {
		opt(&options)
	}

	return &forwardHandler{
		options: options,
	}
}

func (h *forwardHandler) Init(md md.Metadata) (err error) {
	if err = h.parseMetadata(md); err != nil {
		return
	}

	for _, ro := range h.options.Recorders {
		if ro.Record == xrecorder.RecorderServiceHandler {
			h.recorder = ro
			break
		}
	}

	if h.md.certificate != nil && h.md.privateKey != nil {
		h.certPool = tls_util.NewMemoryCertPool()
	}

	return
}

// Forward implements handler.Forwarder.
func (h *forwardHandler) Forward(hop hop.Hop) {
	h.hop = hop
}

func (h *forwardHandler) Handle(ctx context.Context, conn net.Conn, opts ...handler.HandleOption) (err error) {
	defer conn.Close()

	start := time.Now()

	ro := &xrecorder.HandlerRecorderObject{
		Service:    h.options.Service,
		RemoteAddr: conn.RemoteAddr().String(),
		LocalAddr:  conn.LocalAddr().String(),
		Network:    "tcp",
		Time:       start,
		SID:        string(ctxvalue.SidFromContext(ctx)),
	}

	ro.ClientIP = conn.RemoteAddr().String()
	if clientAddr := ctxvalue.ClientAddrFromContext(ctx); clientAddr != "" {
		ro.ClientIP = string(clientAddr)
	} else {
		ctx = ctxvalue.ContextWithClientAddr(ctx, ctxvalue.ClientAddr(conn.RemoteAddr().String()))
	}

	if h, _, _ := net.SplitHostPort(ro.ClientIP); h != "" {
		ro.ClientIP = h
	}

	network := "tcp"
	if conn.RemoteAddr().Network() == "udp" {
		network = "udp"
	}
	ro.Network = network

	pStats := xstats.Stats{}
	conn = stats_wrapper.WrapConn(conn, &pStats)

	// 上报流量统计到 stats 包
	var forwardID, userID, tunnelID int64
	var port int
	if h.options.Service != "" {
		// 从服务名解析 forwardID、userID、tunnelID
		// 服务名格式：{forwardID}_{userID}_{tunnelID}_tcp 或 {forwardID}_{userID}_{tunnelID}_udp
		forwardID, userID, tunnelID = parseServiceName(h.options.Service)
		if forwardID > 0 {
			// 获取本地监听地址（节点 ID 和端口）
			localAddr := ro.LocalAddr
			_, portStr, _ := net.SplitHostPort(localAddr)
			port, _ = strconv.Atoi(portStr)
		}
	}

	// 启动后台协程定期上报流量（每 1 秒）
	var statsTicker *time.Ticker
	var statsDone chan struct{}
	var statsWG sync.WaitGroup
	var lastInput, lastOutput uint64
	if forwardID > 0 {
		statsTicker = time.NewTicker(time.Second)
		statsDone = make(chan struct{})
		statsWG.Add(1)
		go func() {
			defer statsWG.Done()
			for {
				select {
				case <-statsTicker.C:
					inputBytes := pStats.Get(stats.KindInputBytes)
					outputBytes := pStats.Get(stats.KindOutputBytes)

					// 上报增量流量（用于计算实时带宽）
					if inputBytes > lastInput {
						forwardStats.AddForwardTraffic(forwardID, userID, tunnelID, h.options.Service, 0, port, true, inputBytes-lastInput)
						lastInput = inputBytes
					}
					if outputBytes > lastOutput {
						forwardStats.AddForwardTraffic(forwardID, userID, tunnelID, h.options.Service, 0, port, false, outputBytes-lastOutput)
						lastOutput = outputBytes
					}
				case <-statsDone:
					return
				}
			}
		}()
	}

	defer func() {
		// 停止定期上报
		if statsTicker != nil {
			statsTicker.Stop()
			close(statsDone)
			statsWG.Wait()
		}

		if err != nil {
			ro.Err = err.Error()
		}
		inputBytes := pStats.Get(stats.KindInputBytes)
		outputBytes := pStats.Get(stats.KindOutputBytes)
		ro.InputBytes = inputBytes
		ro.OutputBytes = outputBytes
		ro.Duration = time.Since(start)

		// Report only the tail that was not emitted by the periodic sampler.
		if forwardID > 0 {
			h.options.Logger.Debugf("[forward.stats] service=%s forwardID=%d userID=%d tunnelID=%d port=%d inBytes=%d outBytes=%d",
				h.options.Service, forwardID, userID, tunnelID, port, inputBytes, outputBytes)
			if inputBytes > lastInput {
				forwardStats.AddForwardTraffic(forwardID, userID, tunnelID, h.options.Service, 0, port, true, inputBytes-lastInput)
			}
			if outputBytes > lastOutput {
				forwardStats.AddForwardTraffic(forwardID, userID, tunnelID, h.options.Service, 0, port, false, outputBytes-lastOutput)
			}
		}
	}()

	if !h.checkRateLimit(conn.RemoteAddr()) {
		return rate_limiter.ErrRateLimit
	}

	var proto string
	if network == "tcp" && h.md.sniffing {
		if h.md.sniffingTimeout > 0 {
			conn.SetReadDeadline(time.Now().Add(h.md.sniffingTimeout))
		}

		br := bufio.NewReader(conn)
		proto, _ = sniffing.Sniff(ctx, br)
		ro.Proto = proto

		if h.md.sniffingTimeout > 0 {
			conn.SetReadDeadline(time.Time{})
		}

		dial := func(ctx context.Context, network, address string) (net.Conn, error) {
			var buf bytes.Buffer
			cc, err := h.options.Router.Dial(ctxvalue.ContextWithBuffer(ctx, &buf), "tcp", address)
			ro.Route = buf.String()
			return cc, err
		}
		sniffer := &forwarder.Sniffer{
			Websocket:           h.md.sniffingWebsocket,
			WebsocketSampleRate: h.md.sniffingWebsocketSampleRate,
			Recorder:            h.recorder.Recorder,
			RecorderOptions:     h.recorder.Options,
			Certificate:         h.md.certificate,
			PrivateKey:          h.md.privateKey,
			NegotiatedProtocol:  h.md.alpn,
			CertPool:            h.certPool,
			MitmBypass:          h.md.mitmBypass,
			ReadTimeout:         h.md.readTimeout,
		}

		conn = xnet.NewReadWriteConn(br, conn, conn)
		switch proto {
		case sniffing.ProtoHTTP:
			return sniffer.HandleHTTP(ctx, conn,
				forwarder.WithDial(dial),
				forwarder.WithHop(h.hop),
				forwarder.WithBypass(h.options.Bypass),
				forwarder.WithHTTPKeepalive(h.md.httpKeepalive),
				forwarder.WithRecorderObject(ro),
			)
		case sniffing.ProtoTLS:
			return sniffer.HandleTLS(ctx, conn,
				forwarder.WithDial(dial),
				forwarder.WithHop(h.hop),
				forwarder.WithBypass(h.options.Bypass),
				forwarder.WithRecorderObject(ro),
			)
		}
	}

	// Determine max retry attempts
	maxRetries := h.md.maxRetries
	if maxRetries <= 0 {
		// Default: try all available nodes
		if nl, ok := h.hop.(hop.NodeList); ok {
			maxRetries = len(nl.Nodes())
		}
		if maxRetries <= 0 {
			maxRetries = 1
		}
	}

	var triedNodes []string
	var lastErr error
	var cc net.Conn

	h.options.Logger.Debugf("[handler.retry] starting retry loop: maxRetries=%d", maxRetries)

	for attempt := 0; attempt < maxRetries; attempt++ {
		// Select a target node, excluding previously tried nodes
		selectCtx := ctxvalue.ContextWithExcludeNodes(ctx, triedNodes)
		var target *chain.Node
		if h.hop != nil {
			target = h.hop.Select(selectCtx,
				hop.ProtocolSelectOption(proto),
			)
		}
		if target == nil {
			h.options.Logger.Debugf("[handler.retry] attempt=%d target=nil, triedNodes=%v", attempt, triedNodes)
			if lastErr != nil {
				return lastErr
			}
			return errors.New("node not available")
		}

		h.options.Logger.Debugf("[handler.retry] attempt=%d selected node=%s addr=%s", attempt, target.Name, target.Addr)

		// Track this node as tried
		triedNodes = append(triedNodes, target.Addr)

		addr := target.Addr
		if opts := target.Options(); opts != nil {
			switch opts.Network {
			case "unix":
				network = opts.Network
			default:
				if _, _, err := net.SplitHostPort(addr); err != nil {
					addr += ":0"
				}
			}
		}

		ro.Network = network
		ro.Host = addr

		var buf bytes.Buffer
		cc, err = h.options.Router.Dial(ctxvalue.ContextWithBuffer(ctx, &buf), network, addr)
		ro.Route = buf.String()
		if err != nil {
			// Mark node as failed for future selections
			if marker := target.Marker(); marker != nil {
				marker.Mark()
				h.options.Logger.Debugf("[handler.retry] attempt=%d dial failed, marked node=%s count=%d err=%v",
					attempt, target.Addr, marker.Count(), err)
			}
			lastErr = err
			// Try next node
			continue
		}

		// Success - reset marker and proceed
		if marker := target.Marker(); marker != nil {
			marker.Reset()
		}
		defer cc.Close()

		stop := make(chan struct{})
		defer close(stop)
		go func() {
			select {
			case <-ctx.Done():
				conn.Close()
				cc.Close()
			case <-stop:
			}
		}()

		if err := xnet.Transport(conn, cc); err != nil {
			if marker := target.Marker(); marker != nil {
				marker.Mark()
				h.options.Logger.Debugf("[handler.transport] transport failed, marked node=%s count=%d err=%v",
					target.Addr, marker.Count(), err)
			}
			return err
		}
		return nil
	}

	// All retries exhausted
	if lastErr != nil {
		return lastErr
	}
	return errors.New("all nodes failed")
}

func (h *forwardHandler) checkRateLimit(addr net.Addr) bool {
	if h.options.RateLimiter == nil {
		return true
	}
	host, _, _ := net.SplitHostPort(addr.String())
	if limiter := h.options.RateLimiter.Limiter(host); limiter != nil {
		return limiter.Allow(1)
	}

	return true
}

// parseServiceName 从服务名解析 forwardID、userID、tunnelID
// 服务名格式：{forwardID}_{userID}_{tunnelID}_tcp 或 {forwardID}_{userID}_{tunnelID}_udp
func parseServiceName(serviceName string) (forwardID, userID, tunnelID int64) {
	if serviceName == "" {
		return 0, 0, 0
	}
	if strings.HasPrefix(serviceName, "rem_s") {
		namespaced := strings.TrimPrefix(serviceName, "rem_s")
		index := strings.IndexByte(namespaced, '_')
		if index <= 0 {
			return 0, 0, 0
		}
		serviceName = namespaced[index+1:]
	}

	// 去除 _tcp 或 _udp 后缀
	name := strings.TrimSuffix(serviceName, "_tcp")
	name = strings.TrimSuffix(name, "_udp")

	// 按 _ 分割
	parts := strings.Split(name, "_")
	if len(parts) < 3 {
		return 0, 0, 0
	}

	forwardID, _ = strconv.ParseInt(parts[0], 10, 64)
	userID, _ = strconv.ParseInt(parts[1], 10, 64)
	tunnelID, _ = strconv.ParseInt(parts[2], 10, 64)

	if forwardID > 0 {
		return forwardID, userID, tunnelID
	}

	return 0, 0, 0
}
