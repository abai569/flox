package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/store/model"
)

const (
	githubRepo     = "abai569/flvx"
	githubAPIBase  = "https://api.github.com"
	githubHTMLBase = "https://github.com"
	upgradeTimeout = 5 * time.Minute
	batchWorkers   = 5

	releaseChannelStable = "stable"
	releaseChannelDev    = "dev"
)

var (
	stableVersionPattern = regexp.MustCompile(`^\d+(?:\.\d+)+$`)
	testKeywordPattern   = regexp.MustCompile(`(?i)(alpha|beta|rc)`)
)

type githubRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
	Prerelease  bool   `json:"prerelease"`
	Draft       bool   `json:"draft"`
}

func normalizeReleaseChannel(channel string) string {
	// 空字符串返回空，表示不指定通道（获取最新版本）
	if channel == "" {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case releaseChannelDev:
		return releaseChannelDev
	default:
		return releaseChannelStable
	}
}

func releaseChannelFromTag(tag string) string {
	normalized := strings.ToLower(strings.TrimSpace(tag))
	if normalized == "" {
		return releaseChannelDev
	}
	if testKeywordPattern.MatchString(normalized) {
		return releaseChannelDev
	}
	if stableVersionPattern.MatchString(normalized) {
		return releaseChannelStable
	}

	return releaseChannelDev
}

func releaseChannelLabel(channel string) string {
	if normalizeReleaseChannel(channel) == releaseChannelDev {
		return "测试版"
	}

	return "正式版"
}

func fetchGitHubReleases(perPage int) ([]githubRelease, error) {
	if perPage <= 0 {
		perPage = 20
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(fmt.Sprintf("%s/repos/%s/releases?per_page=%d", githubAPIBase, githubRepo, perPage))
	if err != nil {
		return nil, fmt.Errorf("请求GitHub API失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GitHub API返回 %d: %s", resp.StatusCode, string(body))
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("解析GitHub API响应失败: %v", err)
	}

	return releases, nil
}

func resolveLatestReleaseByChannel(channel string) (string, error) {
	normalizedChannel := normalizeReleaseChannel(channel)
	releases, err := fetchGitHubReleases(50)
	if err != nil {
		return "", err
	}

	// 如果 channel 为空，返回第一个非 draft 的 release（最新版本）
	if normalizedChannel == "" {
		for _, r := range releases {
			if r.Draft {
				continue
			}
			tag := strings.TrimSpace(r.TagName)
			if tag != "" {
				return tag, nil
			}
		}
		return "", fmt.Errorf("未找到版本号")
	}

	// 否则按通道查找
	for _, r := range releases {
		if r.Draft {
			continue
		}
		tag := strings.TrimSpace(r.TagName)
		if tag == "" {
			continue
		}
		if releaseChannelFromTag(tag) == normalizedChannel {
			return tag, nil
		}
	}

	return "", fmt.Errorf("未找到%s版本号", releaseChannelLabel(normalizedChannel))
}

func resolveGitHubProxyURLs(repo interface {
	GetConfigByName(string) (*model.ViteConfig, error)
}) []string {
	if repo == nil {
		return []string{"https://git-proxy.abai.eu.org"}
	}

	enabledCfg, _ := repo.GetConfigByName("github_proxy_enabled")
	enabled := enabledCfg == nil || enabledCfg.Value == "" || enabledCfg.Value == "true"
	if !enabled {
		return nil
	}

	urlsCfg, _ := repo.GetConfigByName("github_proxy_urls")
	if urlsCfg == nil || urlsCfg.Value == "" {
		return []string{"https://git-proxy.abai.eu.org"}
	}

	var urls []string
	if err := json.Unmarshal([]byte(urlsCfg.Value), &urls); err != nil {
		return []string{"https://git-proxy.abai.eu.org"}
	}

	var filtered []string
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u != "" {
			filtered = append(filtered, u)
		}
	}
	if len(filtered) == 0 {
		return []string{"https://git-proxy.abai.eu.org"}
	}
	return filtered
}

func buildProxyURL(proxy, path string) string {
	proxy = strings.TrimRight(proxy, "/")
	return fmt.Sprintf("%s/%s", proxy, strings.TrimLeft(path, "/"))
}

func (h *Handler) nodeUpgrade(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		ID      int64  `json:"id"`
		Version string `json:"version"`
		Channel string `json:"channel"`
	}
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点 ID 无效"))
		return
	}

	channel := normalizeReleaseChannel(req.Channel)
	version := strings.TrimSpace(req.Version)
	if version == "" {
		var err error
		version, err = resolveLatestReleaseByChannel(channel)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取最新%s失败：%v", releaseChannelLabel(channel), err)))
			return
		}
	}

	// 获取自定义全局加速地址
	globalURL, _ := h.repo.GetViteConfigValue("global_download_url")
	if globalURL == "" {
		globalURL = "https://ghfast.top"
	}

	// 构建下载源（只使用全局加速地址）
	downloadURLs := []string{
		fmt.Sprintf("%s/https://github.com/%s/releases/download/%s/gost-{ARCH}", globalURL, githubRepo, version),
	}
	checksumURLs := []string{
		fmt.Sprintf("%s/https://github.com/%s/releases/download/%s/gost-{ARCH}.sha256", globalURL, githubRepo, version),
	}

	result, err := h.wsServer.SendCommand(req.ID, "UpgradeAgent", map[string]interface{}{
		"downloadUrls": downloadURLs,
		"checksumUrls": checksumURLs,
		"version":      version,
	}, upgradeTimeout)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, fmt.Sprintf("升级失败：%v", err)))
		return
	}

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"version": version,
		"message": result.Message,
	}))
}

func resolveLatestRelease() (string, error) {
	return resolveLatestReleaseByChannel(releaseChannelStable)
}

func resolveLatestReleaseAPI() (string, error) {
	return resolveLatestReleaseByChannel(releaseChannelStable)
}

func (h *Handler) nodeBatchUpgrade(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		IDs     []int64 `json:"ids"`
		Version string  `json:"version"`
		Channel string  `json:"channel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}
	if len(req.IDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("ids不能为空"))
		return
	}

	channel := normalizeReleaseChannel(req.Channel)
	version := strings.TrimSpace(req.Version)
	if version == "" {
		var err error
		version, err = resolveLatestReleaseByChannel(channel)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取最新%s失败：%v", releaseChannelLabel(channel), err)))
			return
		}
	}

	// 获取自定义全局加速地址
	globalURL, _ := h.repo.GetViteConfigValue("global_download_url")
	if globalURL == "" {
		globalURL = "https://ghfast.top"
	}

	// 构建下载源（只使用全局加速地址）
	downloadURLs := []string{
		fmt.Sprintf("%s/https://github.com/%s/releases/download/%s/gost-{ARCH}", globalURL, githubRepo, version),
	}
	checksumURLs := []string{
		fmt.Sprintf("%s/https://github.com/%s/releases/download/%s/gost-{ARCH}.sha256", globalURL, githubRepo, version),
	}

	if len(downloadURLs) == 0 {
		response.WriteJSON(w, response.ErrDefault("构建下载源失败"))
		return
	}

	type upgradeResult struct {
		ID      int64  `json:"id"`
		Success bool   `json:"success"`
		Message string `json:"message"`
	}

	results := make([]upgradeResult, len(req.IDs))
	sem := make(chan struct{}, batchWorkers)
	var wg sync.WaitGroup

	for i, id := range req.IDs {
		wg.Add(1)
		go func(index int, nodeID int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result, err := h.wsServer.SendCommand(nodeID, "UpgradeAgent", map[string]interface{}{
				"downloadUrls": downloadURLs,
				"checksumUrls": checksumURLs,
			}, upgradeTimeout)
			if err != nil {
				results[index] = upgradeResult{ID: nodeID, Success: false, Message: err.Error()}
				return
			}
			results[index] = upgradeResult{ID: nodeID, Success: true, Message: result.Message}
		}(i, id)
	}
	wg.Wait()

	response.WriteJSON(w, response.OK(map[string]interface{}{
		"version": version,
		"results": results,
	}))
}

func (h *Handler) listReleases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		Channel string `json:"channel"`
	}
	if err := decodeJSON(r.Body, &req); err != nil && err != io.EOF {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	channel := normalizeReleaseChannel(req.Channel)

	releases, err := fetchGitHubReleases(50)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取版本列表失败: %v", err)))
		return
	}

	type releaseItem struct {
		Version     string `json:"version"`
		Name        string `json:"name"`
		PublishedAt string `json:"publishedAt"`
		Prerelease  bool   `json:"prerelease"`
		Channel     string `json:"channel"`
	}

	items := make([]releaseItem, 0, len(releases))
	for _, r := range releases {
		if r.Draft {
			continue
		}
		tag := strings.TrimSpace(r.TagName)
		if tag == "" {
			continue
		}
		itemChannel := releaseChannelFromTag(tag)
		if itemChannel != channel {
			continue
		}
		items = append(items, releaseItem{
			Version:     tag,
			Name:        r.Name,
			PublishedAt: r.PublishedAt,
			Prerelease:  itemChannel == releaseChannelDev,
			Channel:     itemChannel,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].PublishedAt > items[j].PublishedAt
	})

	response.WriteJSON(w, response.OK(items))
}

func (h *Handler) onNodeOnline(nodeID int64) {
	// 节点重新上线时自动下发隧道和转发规则
	// 适用于：续费后上线、网络恢复、节点重启、升级后重连
	h.redeployNodeRuntime(nodeID)
}

func (h *Handler) redeployNodeRuntime(nodeID int64) {
	tunnelIDs, err := h.repo.ListActiveTunnelIDsByNode(nodeID)
	if err != nil {
		fmt.Printf("redeploy: list tunnels for node %d failed: %v\n", nodeID, err)
		return
	}
	forwardIDs, err := h.repo.ListActiveForwardIDsByNode(nodeID)
	if err != nil {
		fmt.Printf("redeploy: list forwards for node %d failed: %v\n", nodeID, err)
		return
	}

	tunnelFailed := make(map[int64]struct{})
	for _, tunnelID := range tunnelIDs {
		if err := h.redeployTunnelAndForwards(tunnelID); err != nil {
			tunnelFailed[tunnelID] = struct{}{}
			fmt.Printf("redeploy: tunnel %d failed on node %d: %v\n", tunnelID, nodeID, err)
		}
	}

	for _, forwardID := range forwardIDs {
		forward, getErr := h.getForwardRecord(forwardID)
		if getErr != nil || forward == nil {
			continue
		}
		if _, skipped := tunnelFailed[forward.TunnelID]; skipped {
			continue
		}
		if err := h.syncForwardServices(forward, "UpdateService", true); err != nil {
			fmt.Printf("redeploy: forward %d failed on node %d: %v\n", forwardID, nodeID, err)
		}
	}
}

type PanelUpgradeRequest struct {
	Version string `json:"version"`
	Channel string `json:"channel"`
}

type PanelUpgradeCheckResponse struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
}

func (h *Handler) panelUpgradeCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		Channel string `json:"channel"`
	}
	if err := decodeJSON(r.Body, &req); err != nil && err != io.EOF {
		req.Channel = ""
	}

	currentVersion := h.GetFluxVersion()
	latestVersion, err := resolveLatestReleaseByChannel(req.Channel)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取最新版本失败：%v", err)))
		return
	}

	hasUpdate := compareVersions(currentVersion, latestVersion) < 0

	response.WriteJSON(w, response.OK(PanelUpgradeCheckResponse{
		CurrentVersion: currentVersion,
		LatestVersion:  latestVersion,
		HasUpdate:      hasUpdate,
	}))
}

func (h *Handler) panelReleases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req struct {
		Channel string `json:"channel"`
	}
	if err := decodeJSON(r.Body, &req); err != nil && err != io.EOF {
		req.Channel = ""
	}

	releases, err := fetchGitHubReleases(50)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取版本列表失败：%v", err)))
		return
	}

	type releaseItem struct {
		Version     string `json:"version"`
		Name        string `json:"name"`
		PublishedAt string `json:"publishedAt"`
		Prerelease  bool   `json:"prerelease"`
		Channel     string `json:"channel"`
	}

	items := make([]releaseItem, 0, len(releases))
	for _, r := range releases {
		if r.Draft {
			continue
		}
		tag := strings.TrimSpace(r.TagName)
		if tag == "" {
			continue
		}
		itemChannel := releaseChannelFromTag(tag)
		if req.Channel != "" && itemChannel != req.Channel {
			continue
		}
		items = append(items, releaseItem{
			Version:     tag,
			Name:        r.Name,
			PublishedAt: r.PublishedAt,
			Prerelease:  itemChannel == releaseChannelDev,
			Channel:     itemChannel,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].PublishedAt > items[j].PublishedAt
	})

	response.WriteJSON(w, response.OK(items))
}

func (h *Handler) panelUpgrade(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}

	var req PanelUpgradeRequest
	if err := decodeJSON(r.Body, &req); err != nil {
		response.WriteJSON(w, response.ErrDefault("请求参数错误"))
		return
	}

	channel := normalizeReleaseChannel(req.Channel)
	targetVersion := strings.TrimSpace(req.Version)
	if targetVersion == "" {
		var err error
		targetVersion, err = resolveLatestReleaseByChannel(channel)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, fmt.Sprintf("获取最新版本失败：%v", err)))
			return
		}
	}

	currentVersion := h.GetFluxVersion()

	// 使用 panel_install.sh 脚本升级（更可靠）
	go func() {
		fmt.Printf("开始升级面板：%s -> %s\n", currentVersion, targetVersion)
		
		// 下载并执行 panel_install.sh
		cmd := exec.Command("bash", "-c", `
			curl -L https://raw.githubusercontent.com/abai569/flvx/main/panel_install.sh -o /tmp/panel_install.sh && \
			chmod +x /tmp/panel_install.sh && \
			echo -e "2\n" | /tmp/panel_install.sh
		`)
		output, err := cmd.CombinedOutput()
		if err != nil {
			fmt.Printf("面板升级失败：%v\n输出：%s\n", err, string(output))
			return
		}
		fmt.Printf("面板升级完成：%s\n", string(output))
	}()

	response.WriteJSON(w, response.OK(map[string]string{
		"message": "升级任务已提交，面板正在后台升级，完成后将自动重启",
	}))
}

func (h *Handler) broadcastPanelUpgradeProgress(stage string, percent int, message string, hasError bool) {
	if h.wsServer == nil {
		return
	}
	payload := map[string]interface{}{
		"stage":   stage,
		"percent": percent,
		"message": message,
		"error":   hasError,
	}
	data, _ := json.Marshal(payload)
	h.wsServer.BroadcastToAdmins(fmt.Sprintf(`{"type":"panel_upgrade_progress","data":%s}`, string(data)))
}

func (h *Handler) executePanelUpgrade(currentVersion, targetVersion string) error {
	fmt.Printf("开始升级面板：%s -> %s\n", currentVersion, targetVersion)
	h.broadcastPanelUpgradeProgress("starting", 0, "开始升级面板...", false)

	installDir := "/opt/flvx-svc"
	envFile := installDir + "/.env"
	composeFile := installDir + "/docker-compose.yml"
	backupEnvFile := envFile + ".backup"
	backupComposeFile := composeFile + ".backup"

	h.broadcastPanelUpgradeProgress("backing_up", 5, "备份配置文件...", false)
	if err := backupFile(envFile, backupEnvFile); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("备份 .env 失败：%v", err), true)
		return fmt.Errorf("备份 .env 失败：%v", err)
	}
	defer func() {
		_ = os.Remove(backupEnvFile)
	}()

	if err := backupFile(composeFile, backupComposeFile); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("备份 docker-compose.yml 失败：%v", err), true)
		return fmt.Errorf("备份 docker-compose.yml 失败：%v", err)
	}
	defer func() {
		_ = os.Remove(backupComposeFile)
	}()

	latestComposeURL := fmt.Sprintf("https://github.com/%s/releases/download/%s/docker-compose-v4.yml", githubRepo, targetVersion)

	globalURL, _ := h.repo.GetViteConfigValue("global_download_url")
	if globalURL == "" {
		globalURL = "https://ghfast.top"
	}
	// 构建下载 URL：代理模式需要拼接完整 GitHub URL
	// 例如：https://ghfast.top/https://github.com/abai569/flvx/releases/download/...
	downloadURL := fmt.Sprintf("%s/%s", strings.TrimRight(globalURL, "/"), latestComposeURL)

	h.broadcastPanelUpgradeProgress("downloading", 10, "下载 docker-compose.yml...", false)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(downloadURL)
	if err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("下载 docker-compose.yml 失败：%v", err), true)
		return fmt.Errorf("下载 docker-compose.yml 失败：%v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("下载 docker-compose.yml 失败：HTTP %d", resp.StatusCode), true)
		return fmt.Errorf("下载 docker-compose.yml 失败：HTTP %d", resp.StatusCode)
	}

	composeContent, err := io.ReadAll(resp.Body)
	if err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("读取 docker-compose.yml 失败：%v", err), true)
		return fmt.Errorf("读取 docker-compose.yml 失败：%v", err)
	}

	if err := os.WriteFile(composeFile, composeContent, 0644); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("写入 docker-compose.yml 失败：%v", err), true)
		return fmt.Errorf("写入 docker-compose.yml 失败：%v", err)
	}

	h.broadcastPanelUpgradeProgress("updating", 20, "更新版本配置...", false)
	if err := updateEnvVersion(envFile, targetVersion); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("更新 .env 中的版本号失败：%v", err), true)
		return fmt.Errorf("更新 .env 中的版本号失败：%v", err)
	}

	fmt.Println("拉取最新镜像...")
	h.broadcastPanelUpgradeProgress("pulling", 30, "拉取镜像...", false)
	if err := runDockerComposePull(installDir); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("拉取镜像失败：%v", err), true)
		return fmt.Errorf("拉取镜像失败：%v", err)
	}

	fmt.Println("启动服务（自动重建容器）...")
	h.broadcastPanelUpgradeProgress("starting_containers", 80, "启动新服务...", false)
	if err := runDockerComposeUp(installDir); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("启动服务失败：%v", err), true)
		return fmt.Errorf("启动服务失败：%v", err)
	}

	fmt.Println("等待服务健康检查...")
	h.broadcastPanelUpgradeProgress("health_check", 90, "等待服务就绪...", false)
	if err := waitForBackendHealthy(); err != nil {
		h.broadcastPanelUpgradeProgress("failed", 0, fmt.Sprintf("服务健康检查失败：%v", err), true)
		return fmt.Errorf("服务健康检查失败：%v", err)
	}

	fmt.Printf("面板升级成功：%s -> %s\n", currentVersion, targetVersion)
	h.broadcastPanelUpgradeProgress("completed", 100, "升级完成", false)
	return nil
}

func (h *Handler) rollbackPanelUpgrade(version string) {
	fmt.Printf("回滚面板到版本：%s\n", version)
	installDir := "/opt/flvx-svc"
	envFile := installDir + "/.env"

	if err := updateEnvVersion(envFile, version); err != nil {
		fmt.Printf("回滚 .env 失败：%v\n", err)
		return
	}

	if err := runDockerComposeUp(installDir); err != nil {
		fmt.Printf("回滚启动服务失败：%v\n", err)
	}
}

func backupFile(src, dst string) error {
	content, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, content, 0644)
}

func updateEnvVersion(envFile, version string) error {
	content, err := os.ReadFile(envFile)
	if err != nil {
		return err
	}

	lines := strings.Split(string(content), "\n")
	updated := false
	for i, line := range lines {
		if strings.HasPrefix(line, "FLUX_VERSION=") {
			lines[i] = "FLUX_VERSION=" + version
			updated = true
			break
		}
	}

	if !updated {
		lines = append(lines, "FLUX_VERSION="+version)
	}

	return os.WriteFile(envFile, []byte(strings.Join(lines, "\n")), 0644)
}

func runDockerComposePull(workDir string) error {
	cmd := exec.Command("docker", "compose", "-f", workDir+"/docker-compose.yml", "pull")
	cmd.Dir = workDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runDockerComposeDown(workDir string) error {
	cmd := exec.Command("docker", "compose", "-f", workDir+"/docker-compose.yml", "down")
	cmd.Dir = workDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runDockerComposeUp(workDir string) error {
	cmd := exec.Command("docker", "compose", "-f", workDir+"/docker-compose.yml", "up", "-d")
	cmd.Dir = workDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func waitForBackendHealthy() error {
	client := &http.Client{Timeout: 5 * time.Second}
	for i := 0; i < 60; i++ {
		time.Sleep(5 * time.Second)
		resp, err := client.Get("http://localhost:6365/flow/test")
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			return nil
		}
		if err == nil {
			resp.Body.Close()
		}
	}
	return fmt.Errorf("等待后端服务健康检查超时")
}

func compareVersions(current, target string) int {
	current = strings.TrimPrefix(current, "v")
	target = strings.TrimPrefix(target, "v")

	currentParts := strings.Split(current, ".")
	targetParts := strings.Split(target, ".")

	maxLen := len(currentParts)
	if len(targetParts) > maxLen {
		maxLen = len(targetParts)
	}

	for i := 0; i < maxLen; i++ {
		var currNum, targetNum int
		if i < len(currentParts) {
			fmt.Sscanf(currentParts[i], "%d", &currNum)
		}
		if i < len(targetParts) {
			fmt.Sscanf(targetParts[i], "%d", &targetNum)
		}
		if currNum < targetNum {
			return -1
		}
		if currNum > targetNum {
			return 1
		}
	}
	return 0
}
