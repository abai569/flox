//go:build !linux

package socket

import "errors"

func defaultRouteInterfaces() ([]string, error) {
	return nil, errors.New("default route discovery is unsupported on this platform")
}
