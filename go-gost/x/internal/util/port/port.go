package port

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
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
				if err := cmd.Process.Kill(); err != nil {
					fmt.Printf("⚠️ 终止 tcpkill 失败: %v\n", err)
				}
			}
		}()
	}

	// 断开 UDP 连接
	udpCmd := exec.Command("fuser", "-k", "-n", "udp", fmt.Sprintf("%d", port))
	udpCmd.Stdout = nil
	udpCmd.Stderr = nil
	if err := udpCmd.Run(); err != nil {
		fmt.Printf("⚠️ 断开 UDP 连接失败（可能无 fuser 或无活跃 UDP 连接）: %v\n", err)
	}

	fmt.Printf("✅ 正在断开端口 %d 上的所有连接...\n", port)
	return nil
}
