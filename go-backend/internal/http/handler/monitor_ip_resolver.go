package handler

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	monitorResolvedIPTTL     = 60 * time.Second
	monitorResolveTimeout    = 1500 * time.Millisecond
	monitorIPFamilyV4        = "v4"
	monitorIPFamilyV6        = "v6"
	monitorIPResolveNetwork4 = "ip4"
	monitorIPResolveNetwork6 = "ip6"
)

type monitorResolvedIP struct {
	IP         string
	ResolvedAt int64
	Error      string
}

type monitorIPCacheEntry struct {
	ip         string
	resolvedAt time.Time
	checkedAt  time.Time
	errText    string
}

var monitorIPCache = struct {
	sync.Mutex
	items map[string]monitorIPCacheEntry
}{items: make(map[string]monitorIPCacheEntry)}

func monitorServerGroupIPSource(family string, serverIP string, serverIPV4 string, serverIPV6 string) string {
	switch family {
	case monitorIPFamilyV4:
		if source := strings.TrimSpace(serverIPV4); source != "" {
			return source
		}
	case monitorIPFamilyV6:
		if source := strings.TrimSpace(serverIPV6); source != "" {
			return source
		}
	}

	serverIP = strings.TrimSpace(serverIP)
	if serverIP == "" || !monitorRawMatchesFamily(serverIP, family) {
		return ""
	}
	return serverIP
}

func resolveMonitorNodeIP(nodeID int64, family string, raw string) monitorResolvedIP {
	host := monitorHostFromRaw(raw)
	if host == "" {
		return monitorResolvedIP{}
	}

	if ip := net.ParseIP(host); ip != nil {
		if !monitorIPMatchesFamily(ip, family) {
			return monitorResolvedIP{}
		}
		return monitorResolvedIP{IP: ip.String(), ResolvedAt: time.Now().UnixMilli()}
	}

	key := monitorIPCacheKey(nodeID, family, host)
	now := time.Now()
	if cached, ok := readMonitorIPCache(key, now); ok {
		return cached
	}

	network := monitorIPResolveNetwork4
	if family == monitorIPFamilyV6 {
		network = monitorIPResolveNetwork6
	}

	ctx, cancel := context.WithTimeout(context.Background(), monitorResolveTimeout)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(ctx, network, host)

	resolvedIP := ""
	errText := ""
	if err != nil {
		errText = err.Error()
	} else {
		for _, ip := range ips {
			if monitorIPMatchesFamily(ip, family) {
				resolvedIP = ip.String()
				break
			}
		}
		if resolvedIP == "" {
			errText = fmt.Sprintf("no %s address resolved", family)
		}
	}

	return writeMonitorIPCache(key, now, resolvedIP, errText)
}

func clearMonitorResolvedIPCacheForNode(nodeID int64) {
	if nodeID <= 0 {
		return
	}
	prefix := strconv.FormatInt(nodeID, 10) + "|"
	monitorIPCache.Lock()
	defer monitorIPCache.Unlock()
	for key := range monitorIPCache.items {
		if strings.HasPrefix(key, prefix) {
			delete(monitorIPCache.items, key)
		}
	}
}

func readMonitorIPCache(key string, now time.Time) (monitorResolvedIP, bool) {
	monitorIPCache.Lock()
	defer monitorIPCache.Unlock()
	entry, ok := monitorIPCache.items[key]
	if !ok || now.Sub(entry.checkedAt) >= monitorResolvedIPTTL {
		return monitorResolvedIP{}, false
	}
	return monitorIPCacheEntryToResult(entry), true
}

func writeMonitorIPCache(key string, now time.Time, resolvedIP string, errText string) monitorResolvedIP {
	monitorIPCache.Lock()
	defer monitorIPCache.Unlock()

	entry := monitorIPCacheEntry{checkedAt: now, errText: errText}
	if resolvedIP != "" {
		entry.ip = resolvedIP
		entry.resolvedAt = now
	} else if prev, ok := monitorIPCache.items[key]; ok && prev.ip != "" {
		entry.ip = prev.ip
		entry.resolvedAt = prev.resolvedAt
	}

	monitorIPCache.items[key] = entry
	return monitorIPCacheEntryToResult(entry)
}

func monitorIPCacheEntryToResult(entry monitorIPCacheEntry) monitorResolvedIP {
	resolvedAt := int64(0)
	if !entry.resolvedAt.IsZero() {
		resolvedAt = entry.resolvedAt.UnixMilli()
	}
	return monitorResolvedIP{IP: entry.ip, ResolvedAt: resolvedAt, Error: entry.errText}
}

func monitorIPCacheKey(nodeID int64, family string, host string) string {
	return fmt.Sprintf("%d|%s|%s", nodeID, family, strings.ToLower(host))
}

func monitorRawMatchesFamily(raw string, family string) bool {
	host := monitorHostFromRaw(raw)
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return monitorIPMatchesFamily(ip, family)
	}
	return true
}

func monitorIPMatchesFamily(ip net.IP, family string) bool {
	if ip == nil {
		return false
	}
	if family == monitorIPFamilyV4 {
		return ip.To4() != nil
	}
	if family == monitorIPFamilyV6 {
		return ip.To4() == nil
	}
	return false
}

func monitorHostFromRaw(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if idx := strings.Index(raw, ","); idx >= 0 {
		raw = strings.TrimSpace(raw[:idx])
	}
	if fields := strings.Fields(raw); len(fields) > 0 {
		raw = fields[0]
	}
	if raw == "" {
		return ""
	}

	if strings.HasPrefix(raw, "[") {
		if end := strings.Index(raw, "]"); end > 0 {
			return strings.TrimSpace(raw[1:end])
		}
	}
	if host, _, err := net.SplitHostPort(raw); err == nil {
		return strings.Trim(strings.TrimSpace(host), "[]")
	}
	return strings.Trim(strings.TrimSpace(raw), "[]")
}
