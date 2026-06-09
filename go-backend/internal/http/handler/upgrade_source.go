package handler

import (
	"io"
	"net/http"
	"strings"
	"time"
)

// network environment constants
const (
	envDomestic = "domestic"
	envOverseas = "overseas"
	envUnknown  = "unknown"
)

// Default fallback addresses
const (
	chfsBaseURL = "https://chfs.646321.xyz:8/chfs/shared/flox"
	ghFastURL   = "https://ghfast.top"
)

func detectNetworkEnvironment() string {
	result := envUnknown
	done := make(chan struct{})

	go func() {
		defer func() { done <- struct{}{} }()
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Head("http://www.apple.com/")
		if err != nil {
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		headers := resp.Header.Get("Location") + string(body)
		if strings.Contains(headers, "geo=cn") {
			result = envDomestic
		}
	}()

	go func() {
		defer func() { done <- struct{}{} }()
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Get("https://www.cloudflare.com/cdn-cgi/trace")
		if err != nil {
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if strings.Contains(string(body), "loc=CN") {
			result = envDomestic
		}
	}()

	for i := 0; i < 2; i++ {
		<-done
	}

	return result
}

func buildUpgradeDownloadURLs(version, networkEnv, domesticURL, globalURL string, proxyURLs []string) ([]string, []string) {
	var sources []string

	switch networkEnv {
	case envDomestic:
		sources = []string{domesticURL, globalURL}
	case envOverseas:
		sources = []string{domesticURL, globalURL}
	default:
		// unknown: try everything
		sources = []string{domesticURL, globalURL}
	}

	// Add proxy sources in order
	sources = append(sources, proxyURLs...)

	// Always append raw GitHub as last resort
	sources = append(sources, githubHTMLBase)

	// Deduplicate while preserving order
	seen := make(map[string]bool)
	var unique []string
	for _, s := range sources {
		s = strings.TrimSpace(s)
		if s != "" && !seen[s] {
			seen[s] = true
			unique = append(unique, s)
		}
	}

	// Build download URLs
	downloadURLs := make([]string, 0, len(unique))
	checksumURLs := make([]string, 0, len(unique))

	for _, src := range unique {
		// CHFS special case: direct path without version in URL
		if strings.Contains(src, "chfs") {
			downloadURLs = append(downloadURLs, src+"/gost-{ARCH}")
			checksumURLs = append(checksumURLs, src+"/gost-{ARCH}.sha256")
			continue
		}

		// github.com: needs version tag in path
		if strings.HasPrefix(src, "https://github.com") || strings.HasPrefix(src, githubHTMLBase) {
			downloadURLs = append(downloadURLs, src+"/"+githubRepo+"/releases/download/"+version+"/gost-{ARCH}")
			checksumURLs = append(checksumURLs, src+"/"+githubRepo+"/releases/download/"+version+"/gost-{ARCH}.sha256")
			continue
		}

		// Proxy services: mirror the github path
		downloadURLs = append(downloadURLs, src+"/https://github.com/"+githubRepo+"/releases/download/"+version+"/gost-{ARCH}")
		checksumURLs = append(checksumURLs, src+"/https://github.com/"+githubRepo+"/releases/download/"+version+"/gost-{ARCH}.sha256")
	}

	return downloadURLs, checksumURLs
}
