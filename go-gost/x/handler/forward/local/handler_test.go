package local

import "testing"

func TestParseServiceName(t *testing.T) {
	tests := []struct {
		name                        string
		service                     string
		forwardID, userID, tunnelID int64
	}{
		{name: "local", service: "17_2_9_tcp", forwardID: 17, userID: 2, tunnelID: 9},
		{name: "remote", service: "rem_s31_17_2_9_tcp", forwardID: 17, userID: 2, tunnelID: 9},
		{name: "invalid remote", service: "rem_s_17_2_9_tcp"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			forwardID, userID, tunnelID := parseServiceName(tt.service)
			if forwardID != tt.forwardID || userID != tt.userID || tunnelID != tt.tunnelID {
				t.Fatalf("parseServiceName(%q) = %d, %d, %d; want %d, %d, %d", tt.service, forwardID, userID, tunnelID, tt.forwardID, tt.userID, tt.tunnelID)
			}
		})
	}
}
