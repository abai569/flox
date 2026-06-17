package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// Config 配置结构体
type Config struct {
	Addr                 string `json:"addr"`
	Secret               string `json:"secret"`
	BlockHttp            int    `json:"block_http,omitempty"`
	BlockTls             int    `json:"block_tls,omitempty"`
	BlockSocks           int    `json:"block_socks,omitempty"`
	BlockOtherPorts      int    `json:"block_other_ports,omitempty"`
	NodeID               int64  `json:"node_id"`
	ServiceName          string `json:"service_name"`
	DomesticDownloadHost string `json:"domestic_download_host"`
}

// LoadConfig 加载配置文件
func LoadConfig(configPath string) (*Config, error) {
	// 检查文件是否存在
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("配置文件不存在: %s", configPath)
	}

	// 读取文件内容
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %v", err)
	}

	// 迁移旧版协议过滤字段名
	data = migrateConfigKeys(data, configPath)

	// 解析JSON
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %v", err)
	}

	// 验证必要的配置项
	if config.Addr == "" {
		return nil, fmt.Errorf("服务器地址不能为空")
	}

	return &config, nil
}

// migrateConfigKeys 将旧版协议过滤字段名迁移到新版
func migrateConfigKeys(data []byte, configPath string) []byte {
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return data
	}

	oldToNew := map[string]string{
		"http":        "block_http",
		"tls":         "block_tls",
		"socks":       "block_socks",
		"block_other": "block_other_ports",
	}

	changed := false
	for oldKey, newKey := range oldToNew {
		if _, hasNew := raw[newKey]; !hasNew {
			if v, hasOld := raw[oldKey]; hasOld {
				raw[newKey] = v
				delete(raw, oldKey)
				changed = true
			}
		} else {
			// 新key已存在，删除旧key（即使不冲突也清理干净）
			delete(raw, oldKey)
		}
	}

	if !changed {
		return data
	}

	newData, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return data
	}

	os.WriteFile(configPath, newData, 0644)
	return newData
}
