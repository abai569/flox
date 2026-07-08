package ss

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/gosocks5"
)

func TestParseSS2022Method(t *testing.T) {
	cases := []struct {
		method   string
		keySize  int
		saltSize int
		aeadName string
	}{
		{"2022-blake3-aes-128-gcm", 16, 16, "aes-128-gcm"},
		{"2022-blake3-aes-256-gcm", 32, 32, "aes-256-gcm"},
		{"2022-blake3-chacha20-poly1305", 32, 32, "chacha20-poly1305"},
		{"2022-BLAKE3-AES-128-GCM", 16, 16, "aes-128-gcm"},
	}
	for _, tc := range cases {
		m, ok := parseSS2022Method(tc.method)
		if !ok {
			t.Fatalf("parseSS2022Method(%q) failed", tc.method)
		}
		if m.keySize != tc.keySize || m.saltSize != tc.saltSize || m.aeadName != tc.aeadName {
			t.Fatalf("unexpected method parse result for %q", tc.method)
		}
	}
	if _, ok := parseSS2022Method("aes-256-gcm"); ok {
		t.Fatal("expected non-2022 method rejection")
	}
}

func TestSS2022DeriveKey(t *testing.T) {
	key, err := ss2022DeriveKey("AAAAAAAAAAAAAAAAAAAAAA==", 16)
	if err != nil {
		t.Fatal(err)
	}
	if len(key) != 16 {
		t.Fatalf("len = %d, want 16", len(key))
	}
	if _, err := ss2022DeriveKey("not-base64", 16); err == nil {
		t.Fatal("expected base64 decode error")
	}
	if _, err := ss2022DeriveKey("AAAA", 16); err == nil {
		t.Fatal("expected key size error")
	}
}

func TestSS2022SessionKey(t *testing.T) {
	master := bytes.Repeat([]byte{1}, 16)
	salt := bytes.Repeat([]byte{2}, 16)
	sk1 := ss2022SessionKey(master, salt, 16)
	sk2 := ss2022SessionKey(master, salt, 16)
	if !bytes.Equal(sk1, sk2) {
		t.Fatal("session key must be deterministic")
	}
	other := ss2022SessionKey(master, bytes.Repeat([]byte{3}, 16), 16)
	if bytes.Equal(sk1, other) {
		t.Fatal("different salt should produce different key")
	}
}

func TestSS2022TCPRoundtripWithPartialReads(t *testing.T) {
	method := "2022-blake3-aes-128-gcm"
	password := "AAAAAAAAAAAAAAAAAAAAAA=="
	c, err := newSS2022Cipher(method, password)
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	serverConn := c.StreamConn(server)
	clientConn := c.StreamConn(client)

	addr := gosocks5.Addr{}
	if err := addr.ParseFrom("example.com:443"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 512)
	addrLen, err := addr.Encode(buf)
	if err != nil {
		t.Fatal(err)
	}
	requestPayload := bytes.Repeat([]byte("r"), 70000)
	requestPlain := append(append([]byte(nil), buf[:addrLen]...), requestPayload...)
	responsePlain := bytes.Repeat([]byte("s"), 70000)

	errCh := make(chan error, 2)
	go func() {
		_, err := clientConn.Write(requestPlain)
		if err != nil {
			errCh <- err
			return
		}
		_, err = serverConn.Write(responsePlain)
		errCh <- err
	}()

	go func() {
		gotReq, err := io.ReadAll(io.LimitReader(serverConn, int64(len(requestPlain))))
		if err != nil {
			errCh <- err
			return
		}
		if !bytes.Equal(gotReq, requestPlain) {
			errCh <- errors.New("request plaintext mismatch")
			return
		}
		gotResp, err := io.ReadAll(io.LimitReader(clientConn, int64(len(responsePlain))))
		if err != nil {
			errCh <- err
			return
		}
		if !bytes.Equal(gotResp, responsePlain) {
			errCh <- errors.New("response plaintext mismatch")
			return
		}
		errCh <- nil
	}()

	for i := 0; i < 2; i++ {
		if err := <-errCh; err != nil {
			t.Fatal(err)
		}
	}
}

func TestSS2022ReadBufferPath(t *testing.T) {
	method := "2022-blake3-aes-128-gcm"
	password := "AAAAAAAAAAAAAAAAAAAAAA=="
	c, err := newSS2022Cipher(method, password)
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	serverConn := c.StreamConn(server)
	clientConn := c.StreamConn(client)

	addr := gosocks5.Addr{}
	if err := addr.ParseFrom("1.2.3.4:53"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 64)
	addrLen, err := addr.Encode(buf)
	if err != nil {
		t.Fatal(err)
	}
	plain := append(append([]byte(nil), buf[:addrLen]...), []byte("hello-partial-read")...)

	go func() {
		_, _ = clientConn.Write(plain)
	}()

	var got []byte
	tmp := make([]byte, 3)
	for len(got) < len(plain) {
		n, err := serverConn.Read(tmp)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, tmp[:n]...)
	}
	if !bytes.Equal(got, plain) {
		t.Fatal("partial read plaintext mismatch")
	}
}

type memoryAddr string

func (a memoryAddr) Network() string { return "memory" }
func (a memoryAddr) String() string  { return string(a) }

type memoryPacket struct {
	buf  []byte
	addr net.Addr
}

type memoryPacketConn struct {
	local  net.Addr
	peer   *memoryPacketConn
	ch     chan memoryPacket
	closeC chan struct{}
	once   sync.Once
}

func newMemoryPacketPair() (*memoryPacketConn, *memoryPacketConn) {
	a := &memoryPacketConn{local: memoryAddr("a"), ch: make(chan memoryPacket, 8), closeC: make(chan struct{})}
	b := &memoryPacketConn{local: memoryAddr("b"), ch: make(chan memoryPacket, 8), closeC: make(chan struct{})}
	a.peer = b
	b.peer = a
	return a, b
}

func (c *memoryPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	select {
	case pkt := <-c.ch:
		n := copy(p, pkt.buf)
		return n, pkt.addr, nil
	case <-c.closeC:
		return 0, nil, net.ErrClosed
	}
}

func (c *memoryPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	buf := append([]byte(nil), p...)
	select {
	case c.peer.ch <- memoryPacket{buf: buf, addr: c.local}:
		return len(p), nil
	case <-c.closeC:
		return 0, net.ErrClosed
	}
}

func (c *memoryPacketConn) Close() error {
	c.once.Do(func() { close(c.closeC) })
	return nil
}

func (c *memoryPacketConn) LocalAddr() net.Addr                { return c.local }
func (c *memoryPacketConn) SetDeadline(time.Time) error        { return nil }
func (c *memoryPacketConn) SetReadDeadline(time.Time) error    { return nil }
func (c *memoryPacketConn) SetWriteDeadline(time.Time) error   { return nil }

func TestSS2022UDPRoundtrip(t *testing.T) {
	method := "2022-blake3-aes-128-gcm"
	password := "AAAAAAAAAAAAAAAAAAAAAA=="
	c, err := newSS2022Cipher(method, password)
	if err != nil {
		t.Fatal(err)
	}
	serverRaw, clientRaw := newMemoryPacketPair()
	defer serverRaw.Close()
	defer clientRaw.Close()
	serverPC := c.PacketConn(serverRaw)
	clientPC := c.PacketConn(clientRaw)

	addr := gosocks5.Addr{}
	if err := addr.ParseFrom("8.8.8.8:53"); err != nil {
		t.Fatal(err)
	}
	packet := make([]byte, 256)
	addrLen, err := addr.Encode(packet)
	if err != nil {
		t.Fatal(err)
	}
	clientPlain := append(append([]byte(nil), packet[:addrLen]...), []byte("client-udp-payload")...)
	serverPlain := append(append([]byte(nil), packet[:addrLen]...), []byte("server-udp-payload")...)

	if _, err := clientPC.WriteTo(clientPlain, serverRaw.LocalAddr()); err != nil {
		t.Fatal(err)
	}
	recv := make([]byte, 1024)
	n, remoteAddr, err := serverPC.ReadFrom(recv)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(recv[:n], clientPlain) {
		t.Fatal("server UDP plaintext mismatch")
	}
	if _, err := serverPC.WriteTo(serverPlain, remoteAddr); err != nil {
		t.Fatal(err)
	}
	n, _, err = clientPC.ReadFrom(recv)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(recv[:n], serverPlain) {
		t.Fatal("client UDP plaintext mismatch")
	}
}

func TestNewSS2022Cipher(t *testing.T) {
	c, err := newSS2022Cipher("2022-blake3-aes-128-gcm", "AAAAAAAAAAAAAAAAAAAAAA==")
	if err != nil {
		t.Fatal(err)
	}
	if c.method.keySize != 16 || len(c.key) != 16 {
		t.Fatal("unexpected key size")
	}
	if _, err := newSS2022Cipher("aes-256-gcm", "AAAAAAAAAAAAAAAAAAAAAA=="); err == nil {
		t.Fatal("expected error for non-ss2022 method")
	}
}

func TestSS2022CipherStreamConnInterface(t *testing.T) {
	c, err := newSS2022Cipher("2022-blake3-aes-128-gcm", "AAAAAAAAAAAAAAAAAAAAAA==")
	if err != nil {
		t.Fatal(err)
	}
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	if _, ok := c.StreamConn(server).(net.Conn); !ok {
		t.Fatal("StreamConn must implement net.Conn")
	}
	if _, ok := c.PacketConn(newMemoryPacketPairMust()).(net.PacketConn); !ok {
		t.Fatal("PacketConn must implement net.PacketConn")
	}
	_ = client
}

func newMemoryPacketPairMust() net.PacketConn {
	a, b := newMemoryPacketPair()
	_ = b
	return a
}

func TestSS2022SessionKeyRandomSalt(t *testing.T) {
	master := make([]byte, 32)
	salt := make([]byte, 32)
	if _, err := rand.Read(master); err != nil {
		t.Fatal(err)
	}
	if _, err := rand.Read(salt); err != nil {
		t.Fatal(err)
	}
	out := ss2022SessionKey(master, salt, 32)
	if len(out) != 32 {
		t.Fatal("unexpected session key size")
	}
}
