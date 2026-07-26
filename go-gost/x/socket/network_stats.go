package socket

import (
	"errors"
	"sort"
	"strings"

	psnet "github.com/shirou/gopsutil/v3/net"
)

type HostNetworkCounters struct {
	BytesReceived    uint64
	BytesTransmitted uint64
	Interfaces       []string
}

func ReadHostNetworkCounters() (HostNetworkCounters, error) {
	counters, err := psnet.IOCounters(true)
	if err != nil {
		return HostNetworkCounters{}, err
	}

	interfaces, routeErr := defaultRouteInterfaces()
	selected := make(map[string]struct{}, len(interfaces))
	for _, name := range interfaces {
		name = strings.TrimSpace(name)
		if name != "" {
			selected[name] = struct{}{}
		}
	}

	result := sumNetworkCounters(counters, selected)
	if len(selected) > 0 && len(result.Interfaces) > 0 {
		return result, nil
	}

	// Preserve monitoring on unsupported platforms and hosts without a default route.
	result = sumNetworkCounters(counters, nil)
	if len(result.Interfaces) == 0 {
		if routeErr != nil {
			return result, routeErr
		}
		return result, errors.New("no network interfaces found")
	}
	return result, nil
}

func sumNetworkCounters(counters []psnet.IOCountersStat, selected map[string]struct{}) HostNetworkCounters {
	var result HostNetworkCounters
	for _, counter := range counters {
		if counter.Name == "lo" || strings.HasPrefix(counter.Name, "lo") {
			continue
		}
		if selected != nil {
			if _, ok := selected[counter.Name]; !ok {
				continue
			}
		}
		result.BytesReceived += counter.BytesRecv
		result.BytesTransmitted += counter.BytesSent
		result.Interfaces = append(result.Interfaces, counter.Name)
	}
	sort.Strings(result.Interfaces)
	return result
}
