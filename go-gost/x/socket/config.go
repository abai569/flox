package socket

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/go-gost/x/config"
)

// configMutex 保护配置文件的并发写入
var configMutex sync.Mutex

func saveConfig() error {
	configMutex.Lock()
	defer configMutex.Unlock()

	file := "gost.json"
	tmpFile := file + ".tmp"

	// 写入临时文件
	f, err := os.Create(tmpFile)
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}

	if err := config.Global().Write(f, "json"); err != nil {
		f.Close()
		os.Remove(tmpFile)
		return fmt.Errorf("写入临时文件失败: %w", err)
	}
	f.Close()

	// 验证：读回来确认 JSON 结构完整
	b, err := os.ReadFile(tmpFile)
	if err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("读取验证失败: %w", err)
	}
	var raw any
	if err := json.Unmarshal(b, &raw); err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("JSON 格式验证失败: %w", err)
	}

	// 验证：尝试用 viper/mapstructure 完整 decode，捕获 TLS 类型错误
	if err := config.ValidateConfigBytes(b); err != nil {
		os.Remove(tmpFile)
		return fmt.Errorf("配置内容验证失败: %w", err)
	}

	// 原子替换
	if err := os.Rename(tmpFile, file); err != nil {
		return fmt.Errorf("替换配置文件失败: %w", err)
	}
	return nil
}
