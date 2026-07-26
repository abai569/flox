//go:build linux

package socket

import (
	"errors"
	"sort"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

func defaultRouteInterfaces() ([]string, error) {
	indexes := make(map[int]struct{})
	var routeErr error
	for _, family := range []int{netlink.FAMILY_V4, netlink.FAMILY_V6} {
		routes, err := netlink.RouteListFiltered(family, &netlink.Route{Table: unix.RT_TABLE_MAIN}, netlink.RT_FILTER_TABLE)
		if err != nil {
			routeErr = errors.Join(routeErr, err)
			continue
		}

		bestMetric := int(^uint(0) >> 1)
		familyIndexes := make(map[int]struct{})
		for _, route := range routes {
			if route.Dst != nil && route.Dst.String() != "0.0.0.0/0" && route.Dst.String() != "::/0" {
				continue
			}
			routeIndexes := make(map[int]struct{})
			if route.LinkIndex > 0 {
				routeIndexes[route.LinkIndex] = struct{}{}
			}
			for _, nextHop := range route.MultiPath {
				if nextHop != nil && nextHop.LinkIndex > 0 {
					routeIndexes[nextHop.LinkIndex] = struct{}{}
				}
			}
			if len(routeIndexes) == 0 {
				continue
			}
			metric := route.Priority
			if metric > bestMetric {
				continue
			}
			if metric < bestMetric {
				bestMetric = metric
				familyIndexes = make(map[int]struct{})
			}
			for index := range routeIndexes {
				familyIndexes[index] = struct{}{}
			}
		}
		for index := range familyIndexes {
			indexes[index] = struct{}{}
		}
	}

	var names []string
	for index := range indexes {
		link, err := netlink.LinkByIndex(index)
		if err != nil {
			routeErr = errors.Join(routeErr, err)
			continue
		}
		if attrs := link.Attrs(); attrs != nil && attrs.Name != "" {
			names = append(names, attrs.Name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 && routeErr == nil {
		routeErr = errors.New("no default route interface found")
	}
	return names, routeErr
}
