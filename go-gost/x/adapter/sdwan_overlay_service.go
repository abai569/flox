package adapter

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"strings"
	"sync"

	"github.com/sirupsen/logrus"
	"github.com/slackhq/nebula"
	nebulacfg "github.com/slackhq/nebula/config"
	"github.com/slackhq/nebula/overlay"
	"golang.org/x/sync/errgroup"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv6"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/icmp"
	gtcp "gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
	"gvisor.dev/gvisor/pkg/waiter"
)

const sdwanNICID = 1

type sdwanOverlayService struct {
	eg      *errgroup.Group
	control *nebula.Control
	ipstack *stack.Stack

	mu struct {
		sync.Mutex
		listeners map[uint16]*sdwanTCPListener
	}
}

type sdwanTCPListener struct {
	port   uint16
	s      *sdwanOverlayService
	addr   *net.TCPAddr
	accept chan net.Conn
}

func newSDWANOverlayService(c *nebulacfg.C) (*sdwanOverlayService, error) {
	logger := logrus.New()
	logger.Out = os.Stdout
	control, err := nebula.Main(c, false, "flox-sdwan", logger, overlay.NewUserDeviceFromConfig)
	if err != nil {
		return nil, err
	}
	control.Start()

	ctx := control.Context()
	eg, ctx := errgroup.WithContext(ctx)
	s := &sdwanOverlayService{eg: eg, control: control}
	s.mu.listeners = map[uint16]*sdwanTCPListener{}

	device, ok := control.Device().(*overlay.UserDevice)
	if !ok {
		return nil, errors.New("sdwan overlay must use user device")
	}

	s.ipstack = stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{gtcp.NewProtocol, udp.NewProtocol, icmp.NewProtocol4, icmp.NewProtocol6},
	})
	sackEnabledOpt := tcpip.TCPSACKEnabled(true)
	if err := s.ipstack.SetTransportProtocolOption(gtcp.ProtocolNumber, &sackEnabledOpt); err != nil {
		return nil, fmt.Errorf("could not enable TCP SACK: %v", err)
	}
	linkEP := channel.New(512, 1280, "")
	if err := s.ipstack.CreateNIC(sdwanNICID, linkEP); err != nil {
		return nil, fmt.Errorf("could not create netstack NIC: %v", err)
	}
	ipv4Subnet, _ := tcpip.NewSubnet(tcpip.AddrFrom4([4]byte{0, 0, 0, 0}), tcpip.MaskFrom(strings.Repeat("\x00", 4)))
	s.ipstack.SetRouteTable([]tcpip.Route{{Destination: ipv4Subnet, NIC: sdwanNICID}})
	ipNet := device.Cidr()
	pa := tcpip.ProtocolAddress{
		AddressWithPrefix: tcpip.AddrFromSlice(ipNet.Addr().AsSlice()).WithPrefix(),
		Protocol:          ipv4.ProtocolNumber,
	}
	if err := s.ipstack.AddProtocolAddress(sdwanNICID, pa, stack.AddressProperties{PEB: stack.CanBePrimaryEndpoint, ConfigType: stack.AddressConfigStatic}); err != nil {
		return nil, fmt.Errorf("error creating IP: %s", err)
	}
	tcpFwd := gtcp.NewForwarder(s.ipstack, 0, 1024, s.tcpHandler)
	s.ipstack.SetTransportProtocolHandler(gtcp.ProtocolNumber, tcpFwd.HandlePacket)

	reader, writer := device.Pipe()
	go func() {
		<-ctx.Done()
		reader.Close()
		writer.Close()
	}()
	eg.Go(func() error {
		buf := make([]byte, header.IPv4MaximumHeaderSize+header.IPv4MaximumPayloadSize)
		for {
			n, err := reader.Read(buf)
			if err != nil {
				return err
			}
			packetBuf := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(bytes.Clone(buf[:n]))})
			linkEP.InjectInbound(header.IPv4ProtocolNumber, packetBuf)
			if err := ctx.Err(); err != nil {
				return err
			}
		}
	})
	eg.Go(func() error {
		for {
			packet := linkEP.ReadContext(ctx)
			if packet == nil {
				if err := ctx.Err(); err != nil {
					return err
				}
				continue
			}
			bufView := packet.ToView()
			if _, err := bufView.WriteTo(writer); err != nil {
				return err
			}
			bufView.Release()
		}
	})

	return s, nil
}

func (s *sdwanOverlayService) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	switch network {
	case "udp", "udp4", "udp6":
		addr, err := net.ResolveUDPAddr(network, address)
		if err != nil {
			return nil, err
		}
		fullAddr := tcpip.FullAddress{NIC: sdwanNICID, Addr: tcpip.AddrFromSlice(addr.IP), Port: uint16(addr.Port)}
		num := ipv4.ProtocolNumber
		if addr.IP.To4() == nil {
			num = ipv6.ProtocolNumber
		}
		return gonet.DialUDP(s.ipstack, nil, &fullAddr, num)
	case "tcp", "tcp4", "tcp6":
		addr, err := net.ResolveTCPAddr(network, address)
		if err != nil {
			return nil, err
		}
		fullAddr := tcpip.FullAddress{NIC: sdwanNICID, Addr: tcpip.AddrFromSlice(addr.IP), Port: uint16(addr.Port)}
		num := ipv4.ProtocolNumber
		if addr.IP.To4() == nil {
			num = ipv6.ProtocolNumber
		}
		return gonet.DialContextTCP(ctx, s.ipstack, fullAddr, num)
	default:
		return nil, fmt.Errorf("unknown network type: %s", network)
	}
}

func (s *sdwanOverlayService) Dial(network, address string) (net.Conn, error) {
	return s.DialContext(context.Background(), network, address)
}

func (s *sdwanOverlayService) Listen(network, address string) (net.Listener, error) {
	if network != "tcp" && network != "tcp4" {
		return nil, errors.New("only tcp is supported")
	}
	addr, err := net.ResolveTCPAddr(network, address)
	if err != nil {
		return nil, err
	}
	if addr.IP != nil && !bytes.Equal(addr.IP, []byte{0, 0, 0, 0}) {
		return nil, fmt.Errorf("only wildcard address supported, got %q %v", address, addr.IP)
	}
	if addr.Port == 0 {
		return nil, errors.New("specific port required, got 0")
	}
	if addr.Port < 0 || addr.Port >= math.MaxUint16 {
		return nil, fmt.Errorf("invalid port %d", addr.Port)
	}
	port := uint16(addr.Port)
	l := &sdwanTCPListener{port: port, s: s, addr: addr, accept: make(chan net.Conn)}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.mu.listeners[port]; ok {
		_ = old.Close()
		delete(s.mu.listeners, port)
	}
	s.mu.listeners[port] = l
	return l, nil
}

func (s *sdwanOverlayService) ListenPacket(network, address string) (net.PacketConn, error) {
	if network != "udp" && network != "udp4" && network != "udp6" {
		return nil, errors.New("only udp is supported")
	}
	addr, err := net.ResolveUDPAddr(network, address)
	if err != nil {
		return nil, err
	}
	if addr.Port == 0 {
		return nil, errors.New("specific port required, got 0")
	}
	fullAddr := tcpip.FullAddress{NIC: sdwanNICID, Port: uint16(addr.Port)}
	num := ipv4.ProtocolNumber
	if addr.IP != nil && len(addr.IP) > 0 && !addr.IP.IsUnspecified() {
		fullAddr.Addr = tcpip.AddrFromSlice(addr.IP)
		if addr.IP.To4() == nil {
			num = ipv6.ProtocolNumber
		}
	}
	return gonet.DialUDP(s.ipstack, &fullAddr, nil, num)
}

func (s *sdwanOverlayService) Close() error {
	s.mu.Lock()
	for port, l := range s.mu.listeners {
		_ = l.Close()
		delete(s.mu.listeners, port)
	}
	s.mu.Unlock()
	s.control.Stop()
	return nil
}

func (s *sdwanOverlayService) tcpHandler(r *gtcp.ForwarderRequest) {
	endpointID := r.ID()
	s.mu.Lock()
	defer s.mu.Unlock()
	l, ok := s.mu.listeners[endpointID.LocalPort]
	if !ok {
		r.Complete(true)
		return
	}
	var wq waiter.Queue
	ep, err := r.CreateEndpoint(&wq)
	if err != nil {
		r.Complete(true)
		return
	}
	r.Complete(false)
	ep.SocketOptions().SetKeepAlive(true)
	conn := gonet.NewTCPConn(&wq, ep)
	l.accept <- conn
}

func (l *sdwanTCPListener) Accept() (net.Conn, error) {
	conn, ok := <-l.accept
	if !ok {
		return nil, io.EOF
	}
	return conn, nil
}

func (l *sdwanTCPListener) Close() error {
	l.s.mu.Lock()
	defer l.s.mu.Unlock()
	delete(l.s.mu.listeners, uint16(l.addr.Port))
	close(l.accept)
	return nil
}

func (l *sdwanTCPListener) Addr() net.Addr { return l.addr }
