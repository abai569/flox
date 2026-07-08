package ss

import (
	"bufio"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/gosocks5"
	"github.com/zeebo/blake3"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	ss2022SubkeyContext    = "shadowsocks 2022 session subkey"
	ss2022ClientStreamType = 0
	ss2022ServerStreamType = 1
	ss2022ClientPacketType = 0
	ss2022ServerPacketType = 1
	ss2022MaxChunkSize     = math.MaxUint16
	ss2022MaxTimeDrift     = 30 * time.Second
)

type ss2022Method struct {
	keySize  int
	saltSize int
	aeadName string
}

func parseSS2022Method(method string) (*ss2022Method, bool) {
	switch strings.ToLower(method) {
	case "2022-blake3-aes-128-gcm":
		return &ss2022Method{keySize: 16, saltSize: 16, aeadName: "aes-128-gcm"}, true
	case "2022-blake3-aes-256-gcm":
		return &ss2022Method{keySize: 32, saltSize: 32, aeadName: "aes-256-gcm"}, true
	case "2022-blake3-chacha20-poly1305":
		return &ss2022Method{keySize: 32, saltSize: 32, aeadName: "chacha20-poly1305"}, true
	default:
		return nil, false
	}
}

func ss2022DeriveKey(password string, keySize int) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(password)
	if err != nil {
		return nil, fmt.Errorf("ss-2022: password must be base64 encoded: %w", err)
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("ss-2022: key size mismatch: got %d, want %d", len(key), keySize)
	}
	return key, nil
}

func ss2022SessionKey(masterKey, salt []byte, keySize int) []byte {
	material := make([]byte, 0, len(masterKey)+len(salt))
	material = append(material, masterKey...)
	material = append(material, salt...)
	out := make([]byte, keySize)
	blake3.DeriveKey(ss2022SubkeyContext, material, out)
	return out
}

func ss2022NewStreamAEAD(aeadName string, key []byte) (cipher.AEAD, error) {
	switch aeadName {
	case "aes-128-gcm", "aes-256-gcm":
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		return cipher.NewGCM(block)
	case "chacha20-poly1305":
		return chacha20poly1305.New(key)
	default:
		return nil, fmt.Errorf("ss-2022: unsupported AEAD: %s", aeadName)
	}
}

func ss2022NewUDPAEAD(method *ss2022Method, key []byte) (cipher.AEAD, error) {
	if method.aeadName == "chacha20-poly1305" {
		return chacha20poly1305.NewX(key)
	}
	return ss2022NewStreamAEAD(method.aeadName, key)
}

func ss2022Timestamp() uint64 {
	return uint64(time.Now().Unix())
}

func ss2022ValidateTimestamp(ts uint64) error {
	now := uint64(time.Now().Unix())
	maxDiff := uint64(ss2022MaxTimeDrift / time.Second)
	if now > ts {
		if now-ts > maxDiff {
			return fmt.Errorf("ss-2022: timestamp expired")
		}
		return nil
	}
	if ts-now > maxDiff {
		return fmt.Errorf("ss-2022: timestamp from future")
	}
	return nil
}

func ss2022Nonce(counter uint64, size int) []byte {
	nonce := make([]byte, size)
	binary.LittleEndian.PutUint64(nonce, counter)
	return nonce
}

func ss2022RandomUint64() (uint64, error) {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint64(buf[:]), nil
}

type ss2022Cipher struct {
	method *ss2022Method
	key    []byte
}

func newSS2022Cipher(method, password string) (*ss2022Cipher, error) {
	m, ok := parseSS2022Method(method)
	if !ok {
		return nil, fmt.Errorf("ss-2022: unsupported method: %s", method)
	}
	key, err := ss2022DeriveKey(password, m.keySize)
	if err != nil {
		return nil, err
	}
	return &ss2022Cipher{method: m, key: key}, nil
}

func (c *ss2022Cipher) StreamConn(conn net.Conn) net.Conn {
	return &ss2022StreamConn{
		Conn:   conn,
		br:     bufio.NewReader(conn),
		method: c.method,
		psk:    append([]byte(nil), c.key...),
	}
}

func (c *ss2022Cipher) PacketConn(pc net.PacketConn) net.PacketConn {
	return &ss2022PacketConn{
		PacketConn: pc,
		method:     c.method,
		psk:        append([]byte(nil), c.key...),
		sessions:   make(map[string]*ss2022UDPServerSession),
	}
}

type ss2022StreamConn struct {
	net.Conn
	br     *bufio.Reader
	method *ss2022Method
	psk    []byte

	roleMu   sync.Mutex
	roleSet  bool
	isClient bool

	rmu         sync.Mutex
	readerAEAD  cipher.AEAD
	readerNonce uint64
	readerReady bool
	readBuf     []byte

	wmu          sync.Mutex
	writerAEAD   cipher.AEAD
	writerNonce  uint64
	writerReady  bool
	requestSalt  []byte
	writerPrimed bool
}

func (c *ss2022StreamConn) ensureRole(reading bool) bool {
	c.roleMu.Lock()
	defer c.roleMu.Unlock()
	if !c.roleSet {
		c.roleSet = true
		c.isClient = !reading
	}
	return c.isClient
}

func (c *ss2022StreamConn) readerOpenChunk(ciphertext []byte) ([]byte, error) {
	nonce := ss2022Nonce(c.readerNonce, c.readerAEAD.NonceSize())
	plaintext, err := c.readerAEAD.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	c.readerNonce++
	return plaintext, nil
}

func (c *ss2022StreamConn) writerSealChunk(plaintext []byte) []byte {
	nonce := ss2022Nonce(c.writerNonce, c.writerAEAD.NonceSize())
	ciphertext := c.writerAEAD.Seal(nil, nonce, plaintext, nil)
	c.writerNonce++
	return ciphertext
}

func (c *ss2022StreamConn) readCiphertextChunk(plainLen int) ([]byte, error) {
	buf := make([]byte, plainLen+c.readerAEAD.Overhead())
	if _, err := io.ReadFull(c.br, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func (c *ss2022StreamConn) initRequestReader() error {
	salt := make([]byte, c.method.saltSize)
	if _, err := io.ReadFull(c.br, salt); err != nil {
		return err
	}
	subkey := ss2022SessionKey(c.psk, salt, c.method.keySize)
	aead, err := ss2022NewStreamAEAD(c.method.aeadName, subkey)
	if err != nil {
		return err
	}
	c.readerAEAD = aead
	c.readerReady = true
	c.readerNonce = 0
	c.requestSalt = append(c.requestSalt[:0], salt...)

	fixedCiphertext, err := c.readCiphertextChunk(11)
	if err != nil {
		return err
	}
	fixedHeader, err := c.readerOpenChunk(fixedCiphertext)
	if err != nil {
		return err
	}
	if len(fixedHeader) != 11 {
		return fmt.Errorf("ss-2022: invalid request fixed header length")
	}
	if fixedHeader[0] != ss2022ClientStreamType {
		return fmt.Errorf("ss-2022: invalid request stream type")
	}
	if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(fixedHeader[1:9])); err != nil {
		return err
	}
	variableLen := int(binary.BigEndian.Uint16(fixedHeader[9:11]))
	variableCiphertext, err := c.readCiphertextChunk(variableLen)
	if err != nil {
		return err
	}
	variableHeader, err := c.readerOpenChunk(variableCiphertext)
	if err != nil {
		return err
	}
	if len(variableHeader) != variableLen {
		return fmt.Errorf("ss-2022: invalid request variable header length")
	}
	addr := gosocks5.Addr{}
	addrLen64, err := addr.ReadFrom(bytes.NewReader(variableHeader))
	if err != nil {
		return err
	}
	addrLen := int(addrLen64)
	if addrLen+2 > len(variableHeader) {
		return fmt.Errorf("ss-2022: request header truncated")
	}
	paddingLen := int(binary.BigEndian.Uint16(variableHeader[addrLen : addrLen+2]))
	if addrLen+2+paddingLen > len(variableHeader) {
		return fmt.Errorf("ss-2022: invalid request padding length")
	}
	plaintext := make([]byte, 0, len(variableHeader)-2-paddingLen)
	plaintext = append(plaintext, variableHeader[:addrLen]...)
	plaintext = append(plaintext, variableHeader[addrLen+2+paddingLen:]...)
	c.readBuf = plaintext
	return nil
}

func (c *ss2022StreamConn) initResponseReader() error {
	if len(c.requestSalt) != c.method.saltSize {
		return fmt.Errorf("ss-2022: request salt missing for response reader")
	}
	salt := make([]byte, c.method.saltSize)
	if _, err := io.ReadFull(c.br, salt); err != nil {
		return err
	}
	subkey := ss2022SessionKey(c.psk, salt, c.method.keySize)
	aead, err := ss2022NewStreamAEAD(c.method.aeadName, subkey)
	if err != nil {
		return err
	}
	c.readerAEAD = aead
	c.readerReady = true
	c.readerNonce = 0

	fixedLen := 1 + 8 + c.method.saltSize + 2
	fixedCiphertext, err := c.readCiphertextChunk(fixedLen)
	if err != nil {
		return err
	}
	fixedHeader, err := c.readerOpenChunk(fixedCiphertext)
	if err != nil {
		return err
	}
	if len(fixedHeader) != fixedLen {
		return fmt.Errorf("ss-2022: invalid response fixed header length")
	}
	if fixedHeader[0] != ss2022ServerStreamType {
		return fmt.Errorf("ss-2022: invalid response stream type")
	}
	if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(fixedHeader[1:9])); err != nil {
		return err
	}
	if !bytes.Equal(fixedHeader[9:9+c.method.saltSize], c.requestSalt) {
		return fmt.Errorf("ss-2022: response request salt mismatch")
	}
	firstPayloadLen := int(binary.BigEndian.Uint16(fixedHeader[9+c.method.saltSize:]))
	if firstPayloadLen == 0 {
		c.readBuf = nil
		return nil
	}
	payloadCiphertext, err := c.readCiphertextChunk(firstPayloadLen)
	if err != nil {
		return err
	}
	payload, err := c.readerOpenChunk(payloadCiphertext)
	if err != nil {
		return err
	}
	c.readBuf = append(c.readBuf[:0], payload...)
	return nil
}

func (c *ss2022StreamConn) ensureReader() error {
	if c.readerReady {
		return nil
	}
	if c.ensureRole(true) {
		return c.initResponseReader()
	}
	return c.initRequestReader()
}

func (c *ss2022StreamConn) readDataChunk() error {
	lengthCiphertext, err := c.readCiphertextChunk(2)
	if err != nil {
		return err
	}
	lengthPlaintext, err := c.readerOpenChunk(lengthCiphertext)
	if err != nil {
		return err
	}
	if len(lengthPlaintext) != 2 {
		return fmt.Errorf("ss-2022: invalid length chunk")
	}
	payloadLen := int(binary.BigEndian.Uint16(lengthPlaintext))
	payloadCiphertext, err := c.readCiphertextChunk(payloadLen)
	if err != nil {
		return err
	}
	payload, err := c.readerOpenChunk(payloadCiphertext)
	if err != nil {
		return err
	}
	c.readBuf = append(c.readBuf[:0], payload...)
	return nil
}

func (c *ss2022StreamConn) Read(b []byte) (int, error) {
	c.rmu.Lock()
	defer c.rmu.Unlock()
	if err := c.ensureReader(); err != nil {
		return 0, err
	}
	for len(c.readBuf) == 0 {
		if err := c.readDataChunk(); err != nil {
			return 0, err
		}
	}
	n := copy(b, c.readBuf)
	c.readBuf = c.readBuf[n:]
	return n, nil
}

func (c *ss2022StreamConn) writeDataChunks(b []byte) (int, error) {
	written := 0
	for len(b) > 0 {
		chunkLen := len(b)
		if chunkLen > ss2022MaxChunkSize {
			chunkLen = ss2022MaxChunkSize
		}
		chunk := b[:chunkLen]
		var lenBuf [2]byte
		binary.BigEndian.PutUint16(lenBuf[:], uint16(chunkLen))
		packet := make([]byte, 0, 2+c.writerAEAD.Overhead()+chunkLen+c.writerAEAD.Overhead())
		packet = append(packet, c.writerSealChunk(lenBuf[:])...)
		packet = append(packet, c.writerSealChunk(chunk)...)
		if _, err := c.Conn.Write(packet); err != nil {
			return written, err
		}
		written += chunkLen
		b = b[chunkLen:]
	}
	return written, nil
}

func (c *ss2022StreamConn) initRequestWriter(first []byte) (int, error) {
	addr := gosocks5.Addr{}
	addrLen64, err := addr.ReadFrom(bytes.NewReader(first))
	if err != nil {
		return 0, err
	}
	addrLen := int(addrLen64)
	addrBytes := append([]byte(nil), first[:addrLen]...)
	remaining := first[addrLen:]
	salt := make([]byte, c.method.saltSize)
	if _, err := rand.Read(salt); err != nil {
		return 0, err
	}
	subkey := ss2022SessionKey(c.psk, salt, c.method.keySize)
	aead, err := ss2022NewStreamAEAD(c.method.aeadName, subkey)
	if err != nil {
		return 0, err
	}
	c.writerAEAD = aead
	c.writerReady = true
	c.writerNonce = 0
	c.requestSalt = append(c.requestSalt[:0], salt...)

	paddingLen := 0
	if len(remaining) == 0 {
		paddingLen = 1
	}
	maxInitialPayload := ss2022MaxChunkSize - len(addrBytes) - 2 - paddingLen
	if maxInitialPayload < 0 {
		return 0, fmt.Errorf("ss-2022: request header too large")
	}
	initialPayloadLen := len(remaining)
	if initialPayloadLen > maxInitialPayload {
		initialPayloadLen = maxInitialPayload
	}
	variablePlaintext := make([]byte, 0, len(addrBytes)+2+paddingLen+initialPayloadLen)
	variablePlaintext = append(variablePlaintext, addrBytes...)
	var padLen [2]byte
	binary.BigEndian.PutUint16(padLen[:], uint16(paddingLen))
	variablePlaintext = append(variablePlaintext, padLen[:]...)
	if paddingLen > 0 {
		padding := make([]byte, paddingLen)
		if _, err := rand.Read(padding); err != nil {
			return 0, err
		}
		variablePlaintext = append(variablePlaintext, padding...)
	}
	variablePlaintext = append(variablePlaintext, remaining[:initialPayloadLen]...)

	fixedPlaintext := make([]byte, 11)
	fixedPlaintext[0] = ss2022ClientStreamType
	binary.BigEndian.PutUint64(fixedPlaintext[1:9], ss2022Timestamp())
	binary.BigEndian.PutUint16(fixedPlaintext[9:11], uint16(len(variablePlaintext)))

	packet := make([]byte, 0, len(salt)+len(fixedPlaintext)+aead.Overhead()+len(variablePlaintext)+aead.Overhead())
	packet = append(packet, salt...)
	packet = append(packet, c.writerSealChunk(fixedPlaintext)...)
	packet = append(packet, c.writerSealChunk(variablePlaintext)...)
	if _, err := c.Conn.Write(packet); err != nil {
		return 0, err
	}
	written := len(first)
	if initialPayloadLen < len(remaining) {
		_, err = c.writeDataChunks(remaining[initialPayloadLen:])
		if err != nil {
			return 0, err
		}
	}
	return written, nil
}

func (c *ss2022StreamConn) initResponseWriter(first []byte) (int, error) {
	if len(c.requestSalt) != c.method.saltSize {
		return 0, fmt.Errorf("ss-2022: request salt missing for response writer")
	}
	salt := make([]byte, c.method.saltSize)
	if _, err := rand.Read(salt); err != nil {
		return 0, err
	}
	subkey := ss2022SessionKey(c.psk, salt, c.method.keySize)
	aead, err := ss2022NewStreamAEAD(c.method.aeadName, subkey)
	if err != nil {
		return 0, err
	}
	c.writerAEAD = aead
	c.writerReady = true
	c.writerNonce = 0
	firstChunkLen := len(first)
	if firstChunkLen > ss2022MaxChunkSize {
		firstChunkLen = ss2022MaxChunkSize
	}
	fixedPlaintext := make([]byte, 1+8+c.method.saltSize+2)
	fixedPlaintext[0] = ss2022ServerStreamType
	binary.BigEndian.PutUint64(fixedPlaintext[1:9], ss2022Timestamp())
	copy(fixedPlaintext[9:9+c.method.saltSize], c.requestSalt)
	binary.BigEndian.PutUint16(fixedPlaintext[9+c.method.saltSize:], uint16(firstChunkLen))

	packet := make([]byte, 0, len(salt)+len(fixedPlaintext)+aead.Overhead()+firstChunkLen+aead.Overhead())
	packet = append(packet, salt...)
	packet = append(packet, c.writerSealChunk(fixedPlaintext)...)
	if firstChunkLen > 0 {
		packet = append(packet, c.writerSealChunk(first[:firstChunkLen])...)
	}
	if _, err := c.Conn.Write(packet); err != nil {
		return 0, err
	}
	if firstChunkLen < len(first) {
		_, err = c.writeDataChunks(first[firstChunkLen:])
		if err != nil {
			return 0, err
		}
	}
	return len(first), nil
}

func (c *ss2022StreamConn) Write(b []byte) (int, error) {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if len(b) == 0 {
		return 0, nil
	}
	if !c.writerReady {
		if c.ensureRole(false) {
			return c.initRequestWriter(b)
		}
		return c.initResponseWriter(b)
	}
	return c.writeDataChunks(b)
}

type ss2022UDPServerSession struct {
	clientSessionID uint64
	serverSessionID uint64
	serverPacketID  uint64
}

type ss2022PacketConn struct {
	net.PacketConn
	method *ss2022Method
	psk    []byte

	mu            sync.Mutex
	roleSet       bool
	isClient      bool
	clientSession uint64
	clientPacket  uint64
	serverSession uint64
	sessions      map[string]*ss2022UDPServerSession
}

func (c *ss2022PacketConn) ensureRole(reading bool) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.roleSet {
		c.roleSet = true
		c.isClient = !reading
	}
	return c.isClient
}

func ss2022BlockCrypt(method *ss2022Method, key, block []byte, encrypt bool) error {
	if method.aeadName == "chacha20-poly1305" {
		return fmt.Errorf("ss-2022: block crypt not used for chacha UDP")
	}
	blk, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	if encrypt {
		blk.Encrypt(block, block)
	} else {
		blk.Decrypt(block, block)
	}
	return nil
}

func ss2022EncryptClientUDPPacket(method *ss2022Method, psk []byte, sessionID, packetID uint64, plaintext []byte) ([]byte, error) {
	if method.aeadName == "chacha20-poly1305" {
		nonce := make([]byte, chacha20poly1305.NonceSizeX)
		if _, err := rand.Read(nonce); err != nil {
			return nil, err
		}
		aead, err := chacha20poly1305.NewX(psk)
		if err != nil {
			return nil, err
		}
		body := make([]byte, 0, 8+8+1+8+2+len(plaintext))
		var tmp [8]byte
		binary.BigEndian.PutUint64(tmp[:], sessionID)
		body = append(body, tmp[:]...)
		binary.BigEndian.PutUint64(tmp[:], packetID)
		body = append(body, tmp[:]...)
		body = append(body, ss2022ClientPacketType)
		binary.BigEndian.PutUint64(tmp[:], ss2022Timestamp())
		body = append(body, tmp[:]...)
		body = append(body, 0, 0)
		body = append(body, plaintext...)
		return append(nonce, aead.Seal(nil, nonce, body, nil)...), nil
	}
	header := make([]byte, 16)
	binary.BigEndian.PutUint64(header[:8], sessionID)
	binary.BigEndian.PutUint64(header[8:], packetID)
	subkey := ss2022SessionKey(psk, header[:8], method.keySize)
	aead, err := ss2022NewUDPAEAD(method, subkey)
	if err != nil {
		return nil, err
	}
	body := make([]byte, 0, 1+8+2+len(plaintext))
	body = append(body, ss2022ClientPacketType)
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], ss2022Timestamp())
	body = append(body, ts[:]...)
	body = append(body, 0, 0)
	body = append(body, plaintext...)
	packet := append([]byte(nil), header...)
	packet = append(packet, aead.Seal(nil, header[4:16], body, nil)...)
	if err := ss2022BlockCrypt(method, psk, packet[:16], true); err != nil {
		return nil, err
	}
	return packet, nil
}

func ss2022DecryptClientUDPPacket(method *ss2022Method, psk, packet []byte) ([]byte, uint64, error) {
	if method.aeadName == "chacha20-poly1305" {
		if len(packet) < chacha20poly1305.NonceSizeX+8+8+1+8+2+16 {
			return nil, 0, fmt.Errorf("ss-2022: UDP packet too short")
		}
		nonce := packet[:chacha20poly1305.NonceSizeX]
		aead, err := chacha20poly1305.NewX(psk)
		if err != nil {
			return nil, 0, err
		}
	body, err := aead.Open(nil, nonce, packet[chacha20poly1305.NonceSizeX:], nil)
		if err != nil {
			return nil, 0, err
		}
		sessionID := binary.BigEndian.Uint64(body[:8])
		if body[16] != ss2022ClientPacketType {
			return nil, 0, fmt.Errorf("ss-2022: invalid UDP client packet type")
		}
		if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(body[17:25])); err != nil {
			return nil, 0, err
		}
		paddingLen := int(binary.BigEndian.Uint16(body[25:27]))
		if 27+paddingLen > len(body) {
			return nil, 0, fmt.Errorf("ss-2022: invalid UDP client padding")
		}
		return append([]byte(nil), body[27+paddingLen:]...), sessionID, nil
	}
	if len(packet) < 16+1+8+2+16 {
		return nil, 0, fmt.Errorf("ss-2022: UDP packet too short")
	}
	buf := append([]byte(nil), packet...)
	if err := ss2022BlockCrypt(method, psk, buf[:16], false); err != nil {
		return nil, 0, err
	}
	sessionID := binary.BigEndian.Uint64(buf[:8])
	subkey := ss2022SessionKey(psk, buf[:8], method.keySize)
	aead, err := ss2022NewUDPAEAD(method, subkey)
	if err != nil {
		return nil, 0, err
	}
	body, err := aead.Open(nil, buf[4:16], buf[16:], nil)
	if err != nil {
		return nil, 0, err
	}
	if body[0] != ss2022ClientPacketType {
		return nil, 0, fmt.Errorf("ss-2022: invalid UDP client packet type")
	}
	if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(body[1:9])); err != nil {
		return nil, 0, err
	}
	paddingLen := int(binary.BigEndian.Uint16(body[9:11]))
	if 11+paddingLen > len(body) {
		return nil, 0, fmt.Errorf("ss-2022: invalid UDP client padding")
	}
	return append([]byte(nil), body[11+paddingLen:]...), sessionID, nil
}

func ss2022EncryptServerUDPPacket(method *ss2022Method, psk []byte, serverSessionID, packetID, clientSessionID uint64, plaintext []byte) ([]byte, error) {
	if method.aeadName == "chacha20-poly1305" {
		nonce := make([]byte, chacha20poly1305.NonceSizeX)
		if _, err := rand.Read(nonce); err != nil {
			return nil, err
		}
		aead, err := chacha20poly1305.NewX(psk)
		if err != nil {
			return nil, err
		}
		body := make([]byte, 0, 8+8+1+8+8+2+len(plaintext))
		var tmp [8]byte
		binary.BigEndian.PutUint64(tmp[:], serverSessionID)
		body = append(body, tmp[:]...)
		binary.BigEndian.PutUint64(tmp[:], packetID)
		body = append(body, tmp[:]...)
		body = append(body, ss2022ServerPacketType)
		binary.BigEndian.PutUint64(tmp[:], ss2022Timestamp())
		body = append(body, tmp[:]...)
		binary.BigEndian.PutUint64(tmp[:], clientSessionID)
		body = append(body, tmp[:]...)
		body = append(body, 0, 0)
		body = append(body, plaintext...)
		return append(nonce, aead.Seal(nil, nonce, body, nil)...), nil
	}
	header := make([]byte, 16)
	binary.BigEndian.PutUint64(header[:8], serverSessionID)
	binary.BigEndian.PutUint64(header[8:], packetID)
	subkey := ss2022SessionKey(psk, header[:8], method.keySize)
	aead, err := ss2022NewUDPAEAD(method, subkey)
	if err != nil {
		return nil, err
	}
	body := make([]byte, 0, 1+8+8+2+len(plaintext))
	body = append(body, ss2022ServerPacketType)
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], ss2022Timestamp())
	body = append(body, ts[:]...)
	var clientBuf [8]byte
	binary.BigEndian.PutUint64(clientBuf[:], clientSessionID)
	body = append(body, clientBuf[:]...)
	body = append(body, 0, 0)
	body = append(body, plaintext...)
	packet := append([]byte(nil), header...)
	packet = append(packet, aead.Seal(nil, header[4:16], body, nil)...)
	if err := ss2022BlockCrypt(method, psk, packet[:16], true); err != nil {
		return nil, err
	}
	return packet, nil
}

func ss2022DecryptServerUDPPacket(method *ss2022Method, psk, packet []byte) ([]byte, uint64, error) {
	if method.aeadName == "chacha20-poly1305" {
		if len(packet) < chacha20poly1305.NonceSizeX+8+8+1+8+8+2+16 {
			return nil, 0, fmt.Errorf("ss-2022: UDP packet too short")
		}
		nonce := packet[:chacha20poly1305.NonceSizeX]
		aead, err := chacha20poly1305.NewX(psk)
		if err != nil {
			return nil, 0, err
		}
	body, err := aead.Open(nil, nonce, packet[chacha20poly1305.NonceSizeX:], nil)
		if err != nil {
			return nil, 0, err
		}
		serverSessionID := binary.BigEndian.Uint64(body[:8])
		if body[16] != ss2022ServerPacketType {
			return nil, 0, fmt.Errorf("ss-2022: invalid UDP server packet type")
		}
		if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(body[17:25])); err != nil {
			return nil, 0, err
		}
		paddingLen := int(binary.BigEndian.Uint16(body[33:35]))
		if 35+paddingLen > len(body) {
			return nil, 0, fmt.Errorf("ss-2022: invalid UDP server padding")
		}
		return append([]byte(nil), body[35+paddingLen:]...), serverSessionID, nil
	}
	if len(packet) < 16+1+8+8+2+16 {
		return nil, 0, fmt.Errorf("ss-2022: UDP packet too short")
	}
	buf := append([]byte(nil), packet...)
	if err := ss2022BlockCrypt(method, psk, buf[:16], false); err != nil {
		return nil, 0, err
	}
	serverSessionID := binary.BigEndian.Uint64(buf[:8])
	subkey := ss2022SessionKey(psk, buf[:8], method.keySize)
	aead, err := ss2022NewUDPAEAD(method, subkey)
	if err != nil {
		return nil, 0, err
	}
	body, err := aead.Open(nil, buf[4:16], buf[16:], nil)
	if err != nil {
		return nil, 0, err
	}
	if body[0] != ss2022ServerPacketType {
		return nil, 0, fmt.Errorf("ss-2022: invalid UDP server packet type")
	}
	if err := ss2022ValidateTimestamp(binary.BigEndian.Uint64(body[1:9])); err != nil {
		return nil, 0, err
	}
	paddingLen := int(binary.BigEndian.Uint16(body[17:19]))
	if 19+paddingLen > len(body) {
		return nil, 0, fmt.Errorf("ss-2022: invalid UDP server padding")
	}
	return append([]byte(nil), body[19+paddingLen:]...), serverSessionID, nil
}

func (c *ss2022PacketConn) ReadFrom(b []byte) (int, net.Addr, error) {
	buf := make([]byte, MaxMessageSize+256)
	n, raddr, err := c.PacketConn.ReadFrom(buf)
	if err != nil {
		return 0, nil, err
	}
	packet := buf[:n]
	if c.ensureRole(true) {
		plaintext, serverSessionID, err := ss2022DecryptServerUDPPacket(c.method, c.psk, packet)
		if err != nil {
			return 0, nil, err
		}
		c.mu.Lock()
		c.serverSession = serverSessionID
		c.mu.Unlock()
		return copy(b, plaintext), raddr, nil
	}
	plaintext, clientSessionID, err := ss2022DecryptClientUDPPacket(c.method, c.psk, packet)
	if err != nil {
		return 0, nil, err
	}
	c.mu.Lock()
	sess := c.sessions[raddr.String()]
	if sess == nil {
		serverSessionID, err := ss2022RandomUint64()
		if err != nil {
			c.mu.Unlock()
			return 0, nil, err
		}
		sess = &ss2022UDPServerSession{
			clientSessionID: clientSessionID,
			serverSessionID: serverSessionID,
		}
		c.sessions[raddr.String()] = sess
	} else {
		sess.clientSessionID = clientSessionID
	}
	c.mu.Unlock()
	return copy(b, plaintext), raddr, nil
}

func (c *ss2022PacketConn) WriteTo(b []byte, addr net.Addr) (int, error) {
	if c.ensureRole(false) {
		c.mu.Lock()
		if c.clientSession == 0 {
			sessionID, err := ss2022RandomUint64()
			if err != nil {
				c.mu.Unlock()
				return 0, err
			}
			c.clientSession = sessionID
		}
		packetID := c.clientPacket
		c.clientPacket++
		clientSessionID := c.clientSession
		c.mu.Unlock()
		packet, err := ss2022EncryptClientUDPPacket(c.method, c.psk, clientSessionID, packetID, b)
		if err != nil {
			return 0, err
		}
		if _, err := c.PacketConn.WriteTo(packet, addr); err != nil {
			return 0, err
		}
		return len(b), nil
	}
	c.mu.Lock()
	sess := c.sessions[addr.String()]
	if sess == nil {
		c.mu.Unlock()
		return 0, fmt.Errorf("ss-2022: UDP session not found for %s", addr.String())
	}
	packetID := sess.serverPacketID
	sess.serverPacketID++
	serverSessionID := sess.serverSessionID
	clientSessionID := sess.clientSessionID
	c.mu.Unlock()
	packet, err := ss2022EncryptServerUDPPacket(c.method, c.psk, serverSessionID, packetID, clientSessionID, b)
	if err != nil {
		return 0, err
	}
	if _, err := c.PacketConn.WriteTo(packet, addr); err != nil {
		return 0, err
	}
	return len(b), nil
}
