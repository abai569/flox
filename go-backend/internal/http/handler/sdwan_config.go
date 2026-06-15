package handler

import (
	"encoding/json"
	"strings"
)

func parseRemoteConfigMap(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil || cfg == nil {
		return map[string]any{}
	}
	return cfg
}

func mergeRemoteConfig(raw string, updates map[string]string) string {
	cfg := parseRemoteConfigMap(raw)
	for key, value := range updates {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			delete(cfg, key)
			continue
		}
		cfg[key] = trimmed
	}
	if len(cfg) == 0 {
		return ""
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return raw
	}
	return string(b)
}

func parseSDWANValueFromRemoteConfig(raw, key string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.TrimSpace(key) == "" {
		return ""
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return ""
	}
	if cfg == nil {
		return ""
	}
	return strings.TrimSpace(asString(cfg[key]))
}

func parseSDWANConfigPathFromRemoteConfig(raw string) string {
	_, path := parseSDWANConfigFromRemoteConfig(raw)
	return path
}

func parseSDWANConfigYAMLFromRemoteConfig(raw string) string {
	yaml, _ := parseSDWANConfigFromRemoteConfig(raw)
	return yaml
}

func parseSDWANCAPathFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanCAPath")
}

func parseSDWANCAPEMFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanCAPEM")
}

func parseSDWANCertPathFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanCertPath")
}

func parseSDWANCertPEMFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanCertPEM")
}

func parseSDWANKeyPathFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanKeyPath")
}

func parseSDWANKeyPEMFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanKeyPEM")
}

func parseSDWANLighthouseVPNIPFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanLighthouseVPNIP")
}

func parseSDWANLighthouseAddrFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanLighthouseAddr")
}

func parseSDWANNodeVPNIPFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanNodeVPNIP")
}

func parseSDWANListenHostFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanListenHost")
}

func parseSDWANListenPortFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanListenPort")
}

func parseSDWANIsLighthouseFromRemoteConfig(raw string) string {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanIsLighthouse")
}

func parseSDWANConfigFromRemoteConfig(raw string) (string, string) {
	return parseSDWANValueFromRemoteConfig(raw, "sdwanConfigYAML"), parseSDWANValueFromRemoteConfig(raw, "sdwanConfigPath")
}
