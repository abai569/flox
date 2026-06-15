//go:build linux

package nftables

import "testing"

func TestConntrackBytes(t *testing.T) {
	fields := []string{
		"ipv4", "2", "tcp", "6", "43", "ESTABLISHED", "src=1.1.1.1", "dst=2.2.2.2", "sport=12345", "dport=56728", "bytes=1200", "packets=10",
		"src=2.2.2.2", "dst=1.1.1.1", "sport=56728", "dport=12345", "bytes=3456", "packets=8",
	}
	if got := conntrackBytes(fields); got != 4656 {
		t.Fatalf("expected 4656, got %d", got)
	}
}
