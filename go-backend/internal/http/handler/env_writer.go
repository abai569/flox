package handler

import (
	"bufio"
	"os"
	"strings"
)

func UpdateEnvFile(licenseKey, domain, serverURL, hmacKey string) error {
	envPath := "/opt/flox-svc/.env"
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		return nil
	}

	f, err := os.Open(envPath)
	if err != nil {
		return err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	// 重建环境变量
	var result []string
	foundLicenseKey := false
	foundDomain := false
	foundServerURL := false
	foundHmacKey := false

	for _, line := range lines {
		kv := strings.SplitN(line, "=", 2)
		if len(kv) == 2 {
			k := strings.TrimSpace(kv[0])
			switch k {
			case "LICENSE_KEY":
				result = append(result, "LICENSE_KEY="+licenseKey)
				foundLicenseKey = true
				continue
			case "SERVER_DOMAIN":
				result = append(result, "SERVER_DOMAIN="+domain)
				foundDomain = true
				continue
			case "LICENSE_SERVER_URL":
				result = append(result, "LICENSE_SERVER_URL="+serverURL)
				foundServerURL = true
				continue
			case "HMAC_SECRET_KEY":
				foundHmacKey = true
				if hmacKey != "" {
					result = append(result, "HMAC_SECRET_KEY="+hmacKey)
					continue
				}
			}
		}
		result = append(result, line)
	}

	// 追加不存在的
	if !foundLicenseKey && licenseKey != "" {
		result = append(result, "LICENSE_KEY="+licenseKey)
	}
	if !foundDomain && domain != "" {
		result = append(result, "SERVER_DOMAIN="+domain)
	}
	if !foundServerURL && serverURL != "" {
		result = append(result, "LICENSE_SERVER_URL="+serverURL)
	}
	if !foundHmacKey && hmacKey != "" {
		result = append(result, "HMAC_SECRET_KEY="+hmacKey)
	}

	lines = result

	content := strings.Join(lines, "\n") + "\n"
	return osWrite(envPath, []byte(content), 0644)
}

func osWrite(name string, data []byte, perm os.FileMode) error {
	f, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err1 := f.Close(); err1 != nil && err == nil {
		err = err1
	}
	return err
}
