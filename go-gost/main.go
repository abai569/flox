package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	_ "net/http/pprof"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/go-gost/core/logger"
	xlogger "github.com/go-gost/x/logger"
	"github.com/go-gost/x/service"
	"github.com/go-gost/x/socket"
	"github.com/go-gost/x/stats"
	"github.com/go-gost/x/traffic"
	"github.com/judwhite/go-svc"
	psnet "github.com/shirou/gopsutil/v3/net"
)

type stringList []string

func (l *stringList) String() string {
	return fmt.Sprintf("%s", *l)
}
func (l *stringList) Set(value string) error {
	*l = append(*l, value)
	return nil
}

var (
	cfgFile      string
	outputFormat string
	services     stringList
	nodes        stringList
	debug        bool
	trace        bool
	apiAddr      string
	metricsAddr  string
)

func init() {
	log.SetFlags(log.LstdFlags | log.Lshortfile | log.Lmicroseconds)

	args := strings.Join(os.Args[1:], "  ")

	if strings.Contains(args, " -- ") {
		var (
			wg  sync.WaitGroup
			ret int
		)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		for wid, wargs := range strings.Split(" "+args+" ", " -- ") {
			wg.Add(1)
			go func(wid int, wargs string) {
				defer wg.Done()
				defer cancel()
				worker(wid, strings.Split(wargs, "  "), &ctx, &ret)
			}(wid, strings.TrimSpace(wargs))
		}

		wg.Wait()

		os.Exit(ret)
	}
}

func worker(id int, args []string, ctx *context.Context, ret *int) {
	cmd := exec.CommandContext(*ctx, os.Args[0], args...)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(), fmt.Sprintf("_GOST_ID=%d", id))

	if err := cmd.Run(); err != nil {
		log.Fatal(err)
	}
	if cmd.ProcessState.Exited() {
		*ret = cmd.ProcessState.ExitCode()
	}
}

func init() {
	var printVersion bool

	flag.Var(&services, "L", "service list")
	flag.Var(&nodes, "F", "chain node list")
	flag.StringVar(&cfgFile, "C", "", "configuration file")
	flag.BoolVar(&printVersion, "V", false, "print version")
	flag.StringVar(&outputFormat, "O", "", "output format, one of yaml|json format")
	flag.BoolVar(&debug, "D", false, "debug mode")
	flag.BoolVar(&trace, "DD", false, "trace mode")
	flag.StringVar(&apiAddr, "api", "", "api service address")
	flag.StringVar(&metricsAddr, "metrics", "", "metrics service address")
	flag.Parse()

	if printVersion {
		fmt.Fprintf(os.Stdout, "gost %s (%s %s/%s)\n",
			version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		os.Exit(0)
	}
}

func main() {
	// 加载配置文件
	config, err := LoadConfig("config.json")
	if err != nil {
		fmt.Printf("❌ 配置加载失败: %v\n", err)
		fmt.Println("请确保当前目录存在 config.json 文件")
		os.Exit(1)
	}

	fmt.Printf("✅ 配置加载成功 - addr: %s\n", config.Addr)

	log := xlogger.NewLogger()
	logger.SetDefault(log)

	// 初始化流量统计系统
	stats.Init()

	// 根据 service_name 确定配置目录
	configDir := "/etc/flvx_agent"
	if config.ServiceName != "" {
		configDir = "/etc/" + config.ServiceName
	}

	// 启动时检查基线文件是否存在，不存在则创建初始基线
	baselinePath := configDir + "/traffic_baseline.json"
	if _, err := os.Stat(baselinePath); os.IsNotExist(err) {
		fmt.Printf("📝 检测到基线文件不存在，创建初始基线...\n")
		// 使用 config.NodeID（可能为 0，表示未关联面板）
		nodeID := config.NodeID
		if nodeID <= 0 {
			nodeID = 1 // 临时 ID，后续通过 WebSocket 更新
		}
		if _, err := traffic.InitBaselineManager(nodeID, baselinePath); err == nil {
			if bm := traffic.GetManager(); bm != nil {
				// 获取当前网卡流量
				var networkStats struct {
					BytesReceived    uint64
					BytesTransmitted uint64
				}
				ioCounters, err := psnet.IOCounters(true)
				if err == nil {
					for _, io := range ioCounters {
						if io.Name == "lo" || strings.HasPrefix(io.Name, "lo") {
							continue
						}
						networkStats.BytesReceived += io.BytesRecv
						networkStats.BytesTransmitted += io.BytesSent
					}
				}
				if _, err := bm.CreateInitialBaseline(networkStats.BytesReceived, networkStats.BytesTransmitted, ""); err != nil {
					fmt.Printf("⚠️ 创建初始基线失败：%v\n", err)
				} else {
					fmt.Printf("✅ 初始流量基线已创建（上行：%d, 下行：%d）\n", networkStats.BytesReceived, networkStats.BytesTransmitted)
				}
			}
		}
	}

	distro := socket.DetectDistro()
	fullVersion := fmt.Sprintf("%s (%s/%s)", version, distro, runtime.GOARCH)
	wsReporter := socket.StartWebSocketReporterWithConfig(config.Addr, config.Secret, config.Http, config.Tls, config.Socks, fullVersion, config.NodeID)
	defer wsReporter.Stop()
	service.SetHTTPReportURL(config.Addr, config.Secret)

	p := &program{}
	if err := svc.Run(p); err != nil {
		logger.Default().Fatal(err)
	}
}

// GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o gost
// upx --best --lzma gost
