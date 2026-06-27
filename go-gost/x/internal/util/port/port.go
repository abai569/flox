package port

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func ForceClosePortConnections(addr string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("⚠️ ForceClosePortConnections panic recovered: %v\n", r)
			err = nil
		}
	}()

	if addr == "" {
		fmt.Println("⚠️ 地址为空")
		return nil
	}

	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Printf("⚠️ 地址解析失败: %v\n", err)
		return nil
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		fmt.Printf("⚠️ 端口非法: %v\n", err)
		return nil
	}

 ownPID := os.Getpid()

	// 断开 TCP 连接
	cmd := exec.Command("tcpkill", "-i", "any", "port", fmt.Sprintf("%d", port))
	if err := cmd.Start(); err != nil {
		fmt.Printf("⚠️ 启动 tcpkill 失败: %v\n", err)
	} else {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("⚠️ tcpkill goroutine panic recovered: %v\n", r)
				}
			}()
			time.Sleep(5 * time.Second)
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			cmd.Wait()
		}()
	}

	// 断开 UDP 连接
	// 先用 fuser 查询占用端口的进程 PID，排除自己后再 kill
	// 避免 fuser -k 误杀 flox_agent 自身导致 SIGKILL 循环
	udpQuery := exec.Command("fuser", "-n", "udp", fmt.Sprintf("%d", port))
	queryOut, _ := udpQuery.CombinedOutput()
	if strings.TrimSpace(string(queryOut)) != "" {
		pids := strings.Fields(string(queryOut))
		for _, pidStr := range pids {
			pidStr = strings.TrimSpace(pidStr)
			pidStr = strings.TrimSuffix(pidStr, ":")
			pid, parseErr := strconv.Atoi(pidStr)
			if parseErr != nil {
				continue
			}
			if pid == ownPID {
				fmt.Printf("⚠️ 跳过自身 PID %d，不杀 flox_agent\n", pid)
				continue
			}
			killCmd := exec.Command("kill", "-9", pidStr)
			if killErr := killCmd.Run(); killErr != nil {
				fmt.Printf("⚠️ 终止 UDP 连接进程 %s 失败: %v\n", pidStr, killErr)
			}
		}
	}

	fmt.Printf("✅ 正在断开端口 %d 上的所有连接...\n", port)
	return nil
}
