//go:build linux

package socket

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

const (
	terminalIdleTimeout       = 30 * time.Minute
	terminalMaxPerNode        = 3
	terminalIdleCheckInterval = 5 * time.Minute
)

type terminalSession struct {
	id           string
	cmd          *exec.Cmd
	ptmx         *os.File
	report       *WebSocketReporter
	once         sync.Once
	writeMu      sync.Mutex
	lastActivity int64
	nodeID       int64
}

var (
	terminalSessions     sync.Map
	terminalIdleOnce     sync.Once
	terminalNodeCounters sync.Map // map[int64]*int32
)

func startTerminalIdleScanner() {
	terminalIdleOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(terminalIdleCheckInterval)
			defer ticker.Stop()
			for range ticker.C {
				now := time.Now().UnixMilli()
				terminalSessions.Range(func(key, value interface{}) bool {
					s := value.(*terminalSession)
					if now-atomic.LoadInt64(&s.lastActivity) > int64(terminalIdleTimeout/time.Millisecond) {
						s.close()
						_ = s.report.sendTerminalEvent(TerminalDataEvent{SessionID: s.id, Event: "exit", Message: "会话空闲超时"})
					}
					return true
				})
			}
		}()
	})
}

func tryIncrementNodeSession(nodeID int64) bool {
	val := new(int32)
	actual, _ := terminalNodeCounters.LoadOrStore(nodeID, val)
	c := atomic.AddInt32(actual.(*int32), 1)
	if c > terminalMaxPerNode {
		atomic.AddInt32(actual.(*int32), -1)
		return false
	}
	return true
}

func decrementNodeSession(nodeID int64) {
	if val, ok := terminalNodeCounters.Load(nodeID); ok {
		atomic.AddInt32(val.(*int32), -1)
	}
}

func openPTY(cols, rows int) (*os.File, *os.File, error) {
	ptmx, err := os.OpenFile("/dev/ptmx", os.O_RDWR, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("打开 PTY 主设备失败: %w", err)
	}

	var ptyNum int
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, ptmx.Fd(), uintptr(syscall.TIOCGPTN), uintptr(unsafe.Pointer(&ptyNum)))
	if errno != 0 {
		ptmx.Close()
		return nil, nil, fmt.Errorf("grantpt 失败: %v", errno)
	}

	var unlock int32
	_, _, errno = unix.Syscall(unix.SYS_IOCTL, ptmx.Fd(), uintptr(syscall.TIOCSPTLCK), uintptr(unsafe.Pointer(&unlock)))
	if errno != 0 {
		ptmx.Close()
		return nil, nil, fmt.Errorf("unlockpt 失败: %v", errno)
	}

	slaveName := fmt.Sprintf("/dev/pts/%d", ptyNum)
	slave, err := os.OpenFile(slaveName, os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		ptmx.Close()
		return nil, nil, fmt.Errorf("打开 PTY 从设备失败: %w", err)
	}
	if err := ptySetWinsize(ptmx, cols, rows); err != nil {
		ptmx.Close()
		slave.Close()
		return nil, nil, fmt.Errorf("设置终端尺寸失败: %w", err)
	}
	return ptmx, slave, nil
}

func ptySetWinsize(f *os.File, cols, rows int) error {
	ws := &unix.Winsize{Row: uint16(rows), Col: uint16(cols), Xpixel: uint16(cols * 8), Ypixel: uint16(rows * 16)}
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, f.Fd(), uintptr(syscall.TIOCSWINSZ), uintptr(unsafe.Pointer(ws)))
	if errno != 0 {
		return errno
	}
	return nil
}

func (w *WebSocketReporter) handleTerminalOpen(data interface{}) error {
	startTerminalIdleScanner()

	var req TerminalOpenRequest
	if err := decodeTerminalRequest(data, &req); err != nil {
		return fmt.Errorf("解析终端打开请求失败: %w", err)
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	if req.SessionID == "" {
		return fmt.Errorf("终端会话ID不能为空")
	}
	cols, rows := normalizeTerminalSize(req.Cols, req.Rows)
	if existing, ok := terminalSessions.Load(req.SessionID); ok {
		existing.(*terminalSession).close()
	}

	nodeID := w.nodeID
	if !tryIncrementNodeSession(nodeID) {
		err := fmt.Errorf("节点终端已达上限 (%d)", terminalMaxPerNode)
		_ = w.sendTerminalEvent(TerminalDataEvent{SessionID: req.SessionID, Event: "error", Message: err.Error()})
		return err
	}

	shell, args := terminalShellCommandArgs()
	cmd := exec.Command(shell, args...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, slave, err := openPTY(cols, rows)
	if err != nil {
		decrementNodeSession(nodeID)
		_ = w.sendTerminalEvent(TerminalDataEvent{SessionID: req.SessionID, Event: "error", Message: err.Error()})
		return err
	}

	cmd.Stdin = slave
	cmd.Stdout = slave
	cmd.Stderr = slave
	cmd.SysProcAttr = &unix.SysProcAttr{Setsid: true, Setctty: true}

	if err := cmd.Start(); err != nil {
		ptmx.Close()
		slave.Close()
		decrementNodeSession(nodeID)
		_ = w.sendTerminalEvent(TerminalDataEvent{SessionID: req.SessionID, Event: "error", Message: err.Error()})
		return err
	}
	slave.Close()

	s := &terminalSession{
		id:           req.SessionID,
		cmd:          cmd,
		ptmx:         ptmx,
		report:       w,
		nodeID:       nodeID,
		lastActivity: time.Now().UnixMilli(),
	}
	terminalSessions.Store(req.SessionID, s)
	_ = w.sendTerminalEvent(TerminalDataEvent{SessionID: req.SessionID, Event: "ready"})
	go s.readLoop()
	go s.waitLoop()
	return nil
}

func handleTerminalInput(data interface{}) error {
	var req TerminalInputRequest
	if err := decodeTerminalRequest(data, &req); err != nil {
		return fmt.Errorf("解析终端输入失败: %w", err)
	}
	if value, ok := terminalSessions.Load(strings.TrimSpace(req.SessionID)); ok {
		s := value.(*terminalSession)
		atomic.StoreInt64(&s.lastActivity, time.Now().UnixMilli())
		s.writeMu.Lock()
		_, err := s.ptmx.Write([]byte(req.Data))
		s.writeMu.Unlock()
		return err
	}
	return fmt.Errorf("终端会话不存在")
}

func handleTerminalResize(data interface{}) error {
	var req TerminalResizeRequest
	if err := decodeTerminalRequest(data, &req); err != nil {
		return fmt.Errorf("解析终端尺寸失败: %w", err)
	}
	cols, rows := normalizeTerminalSize(req.Cols, req.Rows)
	if value, ok := terminalSessions.Load(strings.TrimSpace(req.SessionID)); ok {
		s := value.(*terminalSession)
		atomic.StoreInt64(&s.lastActivity, time.Now().UnixMilli())
		return ptySetWinsize(s.ptmx, cols, rows)
	}
	return fmt.Errorf("终端会话不存在")
}

func handleTerminalClose(data interface{}) error {
	var req TerminalCloseRequest
	if err := decodeTerminalRequest(data, &req); err != nil {
		return fmt.Errorf("解析终端关闭失败: %w", err)
	}
	if value, ok := terminalSessions.Load(strings.TrimSpace(req.SessionID)); ok {
		value.(*terminalSession).close()
	}
	return nil
}

func (s *terminalSession) readLoop() {
	buf := make([]byte, 8192)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			atomic.StoreInt64(&s.lastActivity, time.Now().UnixMilli())
			if sendErr := s.report.sendTerminalEvent(TerminalDataEvent{SessionID: s.id, Event: "data", Data: string(buf[:n])}); sendErr != nil {
				s.close()
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *terminalSession) waitLoop() {
	err := s.cmd.Wait()
	exitCode := 0
	msg := ""
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	s.finish(false)
	if exitCode == 0 && msg == "" {
		_ = s.report.sendTerminalEvent(TerminalDataEvent{SessionID: s.id, Event: "exit", ExitCode: exitCode})
	} else {
		_ = s.report.sendTerminalEvent(TerminalDataEvent{SessionID: s.id, Event: "exit", ExitCode: exitCode, Message: msg})
	}
}

func (s *terminalSession) close() {
	s.finish(true)
}

func (s *terminalSession) finish(killProcess bool) {
	s.once.Do(func() {
		decrementNodeSession(s.nodeID)
		terminalSessions.Delete(s.id)
		s.writeMu.Lock()
		_ = s.ptmx.Close()
		s.writeMu.Unlock()
		if killProcess && s.cmd != nil && s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
	})
}

func (w *WebSocketReporter) CloseTerminalSessions() {
	terminalSessions.Range(func(key, value interface{}) bool {
		s := value.(*terminalSession)
		if s.report == w {
			s.close()
		}
		return true
	})
}

func terminalShellCommandArgs() (string, []string) {
	path := terminalShellPath()
	name := strings.ToLower(filepath.Base(path))
	if strings.Contains(name, "bash") || strings.Contains(name, "zsh") {
		return path, []string{"-l"}
	}
	return path, nil
}

func terminalShellPath() string {
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		if path, err := exec.LookPath(shell); err == nil {
			return path
		}
	}
	for _, shell := range []string{"/bin/bash", "/bin/sh", "bash", "sh"} {
		if path, err := exec.LookPath(shell); err == nil {
			return path
		}
	}
	return "/bin/sh"
}
