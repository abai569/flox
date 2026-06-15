package handler

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"go-backend/internal/http/response"
	"go-backend/internal/middleware"
	"go-backend/internal/store/model"

	nebcert "github.com/slackhq/nebula/cert"
	"golang.org/x/crypto/curve25519"
)

const (
	sdwanCACertConfigName            = "sdwan_ca_cert_pem"
	sdwanCAKeyConfigName             = "sdwan_ca_key_pem"
	sdwanLighthouseNodeID            = "sdwan_lighthouse_node_id"
	sdwanBackupLighthouseNodeIDs     = "sdwan_backup_lighthouse_node_ids"
	sdwanNetworkCIDRConfigName       = "sdwan_network_cidr"
	sdwanAutoReconcileConfigName     = "sdwan_auto_reconcile"
	sdwanReconcileIntervalConfigName = "sdwan_reconcile_interval_sec"
	sdwanDefaultCIDR                 = "192.168.100.0/24"
)

func (h *Handler) nodeIssueSDWANCert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 模式仅正式授权可用"))
		return
	}
	actorUserID, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可签发 SDWAN 证书"))
		return
	}

	var req struct {
		ID    int64  `json:"id"`
		VPNIP string `json:"vpnIp"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || req.ID <= 0 {
		response.WriteJSON(w, response.ErrDefault("节点ID不能为空"))
		return
	}
	_ = actorUserID

	node, err := h.repo.GetNodeByID(req.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	if node == nil {
		response.WriteJSON(w, response.ErrDefault("节点不存在"))
		return
	}

	vpnIP := strings.TrimSpace(req.VPNIP)
	if vpnIP == "" {
		vpnIP = parseSDWANNodeVPNIPFromRemoteConfig(node.RemoteConfig.String)
	}
	if vpnIP == "" {
		vpnIP, err = h.allocateSDWANNodeVPNIP(req.ID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	}
	if net.ParseIP(vpnIP) == nil {
		response.WriteJSON(w, response.ErrDefault("SDWAN 节点 VPN IP 无效"))
		return
	}

	lighthouseNode, err := h.ensureSDWANLighthouseNode(req.ID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	isLighthouse := lighthouseNode != nil && lighthouseNode.ID == req.ID
	lighthouseVPNIP := vpnIP
	if !isLighthouse {
		lighthouseVPNIP = parseSDWANNodeVPNIPFromRemoteConfig(lighthouseNode.RemoteConfig.String)
		if lighthouseVPNIP == "" {
			response.WriteJSON(w, response.ErrDefault("中心节点尚未签发 SDWAN 证书，请先为中心节点签发"))
			return
		}
	}
	lighthouseAddr := h.buildSDWANLighthouseAddr(lighthouseNode, lighthouseVPNIP)

	caCertPEM, caKeyPEM, err := h.ensureSDWANCA()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	hostCertPEM, hostKeyPEM, err := issueSDWANHostCert(node.Name, vpnIP, caCertPEM, caKeyPEM)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}

	updatedRemoteConfig, err := h.persistSDWANNodeConfig(node, vpnIP, caCertPEM, caKeyPEM, lighthouseNode, lighthouseVPNIP, lighthouseAddr)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	_ = h.syncSDWANLighthouseTopology()

	response.WriteJSON(w, response.OK(map[string]any{
		"vpnIp":           vpnIP,
		"caPem":           caCertPEM,
		"certPem":         hostCertPEM,
		"keyPem":          hostKeyPEM,
		"isLighthouse":    isLighthouse,
		"lighthouseVPNIP": lighthouseVPNIP,
		"lighthouseAddr":  lighthouseAddr,
		"remoteConfig":    updatedRemoteConfig,
	}))
}

func (h *Handler) nodeBootstrapSDWAN(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.ErrDefault("请求失败"))
		return
	}
	tier, _ := middleware.GetLicenseTier()
	if tier == middleware.TierBlocked {
		response.WriteJSON(w, response.Err(403, "授权无效，无法操作"))
		return
	}
	if tier == middleware.TierFree {
		response.WriteJSON(w, response.Err(403, "SDWAN 模式仅正式授权可用"))
		return
	}
	_, actorRole, err := userRoleFromRequest(r)
	if err != nil {
		response.WriteJSON(w, response.Err(401, "无效的token或token已过期"))
		return
	}
	if actorRole != 0 {
		response.WriteJSON(w, response.Err(403, "仅管理员可进行 SDWAN 组网"))
		return
	}
	var req struct {
		NodeIDs          []int64 `json:"nodeIds"`
		LighthouseNodeID int64   `json:"lighthouseNodeId"`
	}
	if err := decodeJSON(r.Body, &req); err != nil || len(req.NodeIDs) == 0 {
		response.WriteJSON(w, response.ErrDefault("节点列表不能为空"))
		return
	}
	caCertPEM, caKeyPEM, err := h.ensureSDWANCA()
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	lighthouseNode, err := h.resolveBootstrapLighthouseNode(req.NodeIDs, req.LighthouseNodeID)
	if err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	lighthouseVPNIP := parseSDWANNodeVPNIPFromRemoteConfig(lighthouseNode.RemoteConfig.String)
	if lighthouseVPNIP == "" {
		lighthouseVPNIP, err = h.allocateSDWANNodeVPNIP(lighthouseNode.ID)
		if err != nil {
			response.WriteJSON(w, response.Err(-2, err.Error()))
			return
		}
	}
	lighthouseAddr := h.buildSDWANLighthouseAddr(lighthouseNode, lighthouseVPNIP)
	if _, err := h.persistSDWANNodeConfig(lighthouseNode, lighthouseVPNIP, caCertPEM, caKeyPEM, lighthouseNode, lighthouseVPNIP, lighthouseAddr); err != nil {
		response.WriteJSON(w, response.Err(-2, err.Error()))
		return
	}
	updated := 0
	for _, nodeID := range req.NodeIDs {
		node, getErr := h.repo.GetNodeByID(nodeID)
		if getErr != nil || node == nil {
			continue
		}
		vpnIP := parseSDWANNodeVPNIPFromRemoteConfig(node.RemoteConfig.String)
		if vpnIP == "" {
			vpnIP, err = h.allocateSDWANNodeVPNIP(node.ID)
			if err != nil {
				continue
			}
		}
		if _, err := h.persistSDWANNodeConfig(node, vpnIP, caCertPEM, caKeyPEM, lighthouseNode, lighthouseVPNIP, lighthouseAddr); err != nil {
			continue
		}
		updated++
	}
	_ = h.syncSDWANLighthouseTopology()
	response.WriteJSON(w, response.OK(map[string]any{
		"updatedCount":     updated,
		"lighthouseNodeId": lighthouseNode.ID,
		"lighthouseVPNIP":  lighthouseVPNIP,
		"lighthouseAddr":   lighthouseAddr,
	}))
}

func (h *Handler) ensureSDWANCA() (string, string, error) {
	caCertCfg, _ := h.repo.GetConfigByName(sdwanCACertConfigName)
	caKeyCfg, _ := h.repo.GetConfigByName(sdwanCAKeyConfigName)
	if caCertCfg != nil && caKeyCfg != nil && strings.TrimSpace(caCertCfg.Value) != "" && strings.TrimSpace(caKeyCfg.Value) != "" {
		return strings.TrimSpace(caCertCfg.Value), strings.TrimSpace(caKeyCfg.Value), nil
	}
	caCertPEM, caKeyPEM, err := generateSDWANCA(h.getSDWANNetworkCIDR())
	if err != nil {
		return "", "", err
	}
	now := time.Now().UnixMilli()
	if err := h.repo.UpsertConfig(sdwanCACertConfigName, caCertPEM, now); err != nil {
		return "", "", err
	}
	if err := h.repo.UpsertConfig(sdwanCAKeyConfigName, caKeyPEM, now); err != nil {
		return "", "", err
	}
	return caCertPEM, caKeyPEM, nil
}

func generateSDWANCA(cidrText string) (string, string, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	if strings.TrimSpace(cidrText) == "" {
		cidrText = sdwanDefaultCIDR
	}
	_, cidr, err := net.ParseCIDR(cidrText)
	if err != nil {
		return "", "", err
	}
	before := time.Now().Add(-time.Minute).Round(time.Second)
	after := time.Now().Add(10 * 365 * 24 * time.Hour).Round(time.Second)
	ca := &nebcert.NebulaCertificate{
		Details: nebcert.NebulaCertificateDetails{
			Name:           "FLOX SDWAN CA",
			NotBefore:      before,
			NotAfter:       after,
			PublicKey:      pub,
			IsCA:           true,
			Ips:            []*net.IPNet{cidr},
			Groups:         []string{"flox-sdwan"},
			InvertedGroups: map[string]struct{}{"flox-sdwan": {}},
		},
	}
	if err := ca.Sign(nebcert.Curve_CURVE25519, priv); err != nil {
		return "", "", err
	}
	caPEM, err := ca.MarshalToPEM()
	if err != nil {
		return "", "", err
	}
	return string(caPEM), string(nebcert.MarshalEd25519PrivateKey(priv)), nil
}

func issueSDWANHostCert(nodeName, vpnIP, caCertPEM, caKeyPEM string) (string, string, error) {
	caCert, _, err := nebcert.UnmarshalNebulaCertificateFromPEM([]byte(caCertPEM))
	if err != nil {
		return "", "", err
	}
	caPriv, _, _, err := nebcert.UnmarshalSigningPrivateKey([]byte(caKeyPEM))
	if err != nil {
		return "", "", err
	}
	issuer, err := caCert.Sha256Sum()
	if err != nil {
		return "", "", err
	}
	ones := 32
	if len(caCert.Details.Ips) > 0 {
		ones, _ = caCert.Details.Ips[0].Mask.Size()
	}
	hostIP := &net.IPNet{IP: net.ParseIP(vpnIP).To4(), Mask: net.CIDRMask(ones, 32)}
	hostPub, hostPriv, err := x25519Keypair()
	if err != nil {
		return "", "", err
	}
	before := time.Now().Add(-time.Minute).Round(time.Second)
	after := time.Now().Add(5 * 365 * 24 * time.Hour).Round(time.Second)
	host := &nebcert.NebulaCertificate{
		Details: nebcert.NebulaCertificateDetails{
			Name:           strings.TrimSpace(nodeName),
			Ips:            []*net.IPNet{hostIP},
			Groups:         []string{"flox-sdwan"},
			NotBefore:      before,
			NotAfter:       after,
			PublicKey:      hostPub,
			IsCA:           false,
			Curve:          caCert.Details.Curve,
			Issuer:         issuer,
			InvertedGroups: map[string]struct{}{"flox-sdwan": {}},
		},
	}
	if err := host.Sign(caCert.Details.Curve, caPriv); err != nil {
		return "", "", err
	}
	hostPEM, err := host.MarshalToPEM()
	if err != nil {
		return "", "", err
	}
	return string(hostPEM), string(nebcert.MarshalX25519PrivateKey(hostPriv)), nil
}

func x25519Keypair() ([]byte, []byte, error) {
	privkey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, privkey); err != nil {
		return nil, nil, err
	}
	pubkey, err := curve25519.X25519(privkey, curve25519.Basepoint)
	if err != nil {
		return nil, nil, err
	}
	return pubkey, privkey, nil
}

func (h *Handler) allocateSDWANNodeVPNIP(nodeID int64) (string, error) {
	items, err := h.repo.ListNodes(nil)
	if err != nil {
		return "", err
	}
	_, cidr, err := net.ParseCIDR(h.getSDWANNetworkCIDR())
	if err != nil {
		return "", err
	}
	base := cidr.IP.To4()
	if base == nil {
		return "", fmt.Errorf("当前仅支持 IPv4 SDWAN 网段")
	}
	used := make(map[string]struct{})
	for _, item := range items {
		if asInt64(item["id"], 0) == nodeID {
			continue
		}
		ip := parseSDWANNodeVPNIPFromRemoteConfig(asString(item["remoteConfig"]))
		if ip != "" {
			used[ip] = struct{}{}
		}
	}
	for i := 10; i < 250; i++ {
		candidateIP := net.IPv4(base[0], base[1], base[2], byte(i)).String()
		if !cidr.Contains(net.ParseIP(candidateIP)) {
			continue
		}
		candidate := candidateIP
		if _, ok := used[candidate]; !ok {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("没有可用的 SDWAN VPN IP")
}

func (h *Handler) resolveBootstrapLighthouseNode(nodeIDs []int64, preferredNodeID int64) (*model.Node, error) {
	if preferredNodeID > 0 {
		n, err := h.repo.GetNodeByID(preferredNodeID)
		if err == nil && n != nil {
			_ = h.repo.UpsertConfig(sdwanLighthouseNodeID, fmt.Sprintf("%d", preferredNodeID), time.Now().UnixMilli())
			return n, nil
		}
	}
	if cfg, _ := h.repo.GetConfigByName(sdwanLighthouseNodeID); cfg != nil {
		if id := asInt64(cfg.Value, 0); id > 0 {
			n, err := h.repo.GetNodeByID(id)
			if err == nil && n != nil {
				return n, nil
			}
		}
	}
	if len(nodeIDs) == 0 {
		return nil, fmt.Errorf("节点列表为空")
	}
	return h.ensureSDWANLighthouseNode(nodeIDs[0])
}

func (h *Handler) ensureSDWANLighthouseNode(currentNodeID int64) (*model.Node, error) {
	if cfg, _ := h.repo.GetConfigByName(sdwanLighthouseNodeID); cfg != nil {
		if id := asInt64(cfg.Value, 0); id > 0 {
			n, err := h.repo.GetNodeByID(id)
			if err == nil && n != nil {
				return n, nil
			}
		}
	}
	n, err := h.repo.GetNodeByID(currentNodeID)
	if err != nil {
		return nil, err
	}
	if n == nil {
		return nil, fmt.Errorf("节点不存在")
	}
	if err := h.repo.UpsertConfig(sdwanLighthouseNodeID, fmt.Sprintf("%d", currentNodeID), time.Now().UnixMilli()); err != nil {
		return nil, err
	}
	return n, nil
}

func parseSDWANNodeIDList(raw string) []int64 {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	result := make([]int64, 0, len(parts))
	seen := make(map[int64]struct{})
	for _, part := range parts {
		id := asInt64(strings.TrimSpace(part), 0)
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func formatSDWANNodeIDList(ids []int64) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			parts = append(parts, fmt.Sprintf("%d", id))
		}
	}
	return strings.Join(parts, ",")
}

func (h *Handler) listSDWANLighthouseNodes() (*model.Node, []*model.Node, error) {
	var primary *model.Node
	if cfg, _ := h.repo.GetConfigByName(sdwanLighthouseNodeID); cfg != nil {
		if id := asInt64(cfg.Value, 0); id > 0 {
			n, err := h.repo.GetNodeByID(id)
			if err != nil {
				return nil, nil, err
			}
			primary = n
		}
	}
	backups := make([]*model.Node, 0)
	if cfg, _ := h.repo.GetConfigByName(sdwanBackupLighthouseNodeIDs); cfg != nil {
		for _, id := range parseSDWANNodeIDList(cfg.Value) {
			n, err := h.repo.GetNodeByID(id)
			if err != nil || n == nil {
				continue
			}
			backups = append(backups, n)
		}
	}
	return primary, backups, nil
}

func (h *Handler) syncSDWANLighthouseTopology() error {
	primary, backups, err := h.listSDWANLighthouseNodes()
	if err != nil {
		return err
	}
	primaryVPNIP := ""
	primaryAddr := ""
	if primary != nil {
		primaryVPNIP = parseSDWANNodeVPNIPFromRemoteConfig(primary.RemoteConfig.String)
		primaryAddr = h.buildSDWANLighthouseAddr(primary, primaryVPNIP)
	}
	backupVPNIPs := make([]string, 0)
	backupAddrs := make([]string, 0)
	backupIDs := make(map[int64]struct{})
	for _, n := range backups {
		if n == nil {
			continue
		}
		backupIDs[n.ID] = struct{}{}
		vpn := parseSDWANNodeVPNIPFromRemoteConfig(n.RemoteConfig.String)
		if vpn == "" {
			continue
		}
		backupVPNIPs = append(backupVPNIPs, vpn)
		backupAddrs = append(backupAddrs, h.buildSDWANLighthouseAddr(n, vpn))
	}
	items, err := h.repo.ListNodes(nil)
	if err != nil {
		return err
	}
	for _, item := range items {
		nodeID := asInt64(item["id"], 0)
		role := "peer"
		isLighthouse := false
		if primary != nil && nodeID == primary.ID {
			role = "primary"
			isLighthouse = true
		} else if _, ok := backupIDs[nodeID]; ok {
			role = "backup"
			isLighthouse = true
		}
		updated := mergeRemoteConfig(asString(item["remoteConfig"]), map[string]string{
			"sdwanIsLighthouse":           fmt.Sprintf("%t", isLighthouse),
			"sdwanLighthouseRole":         role,
			"sdwanLighthouseVPNIP":        primaryVPNIP,
			"sdwanLighthouseAddr":         primaryAddr,
			"sdwanBackupLighthouseVPNIPs": strings.Join(backupVPNIPs, ","),
			"sdwanBackupLighthouseAddrs":  strings.Join(backupAddrs, ","),
		})
		if err := h.repo.UpdateNodeRemoteConfig(nodeID, updated); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) persistSDWANNodeConfig(node *model.Node, vpnIP, caCertPEM, caKeyPEM string, lighthouseNode *model.Node, lighthouseVPNIP, lighthouseAddr string) (string, error) {
	if node == nil {
		return "", fmt.Errorf("节点不存在")
	}
	hostCertPEM, hostKeyPEM, err := issueSDWANHostCert(node.Name, vpnIP, caCertPEM, caKeyPEM)
	if err != nil {
		return "", err
	}
	isLighthouse := lighthouseNode != nil && lighthouseNode.ID == node.ID
	if isLighthouse {
		lighthouseVPNIP = vpnIP
	}
	updatedRemoteConfig := mergeRemoteConfig(node.RemoteConfig.String, map[string]string{
		"sdwanCAPEM":           caCertPEM,
		"sdwanCertPEM":         hostCertPEM,
		"sdwanKeyPEM":          hostKeyPEM,
		"sdwanNodeVPNIP":       vpnIP,
		"sdwanIsLighthouse":    fmt.Sprintf("%t", isLighthouse),
		"sdwanLighthouseVPNIP": lighthouseVPNIP,
		"sdwanLighthouseAddr":  lighthouseAddr,
	})
	if err := h.repo.UpdateNodeRemoteConfig(node.ID, updatedRemoteConfig); err != nil {
		return "", err
	}
	node.RemoteConfig.String = updatedRemoteConfig
	node.RemoteConfig.Valid = updatedRemoteConfig != ""
	return updatedRemoteConfig, nil
}

func (h *Handler) buildSDWANLighthouseAddr(node *model.Node, fallbackVPNIP string) string {
	if node == nil {
		return fallbackVPNIP + ":4242"
	}
	if addr := parseSDWANLighthouseAddrFromRemoteConfig(node.RemoteConfig.String); addr != "" {
		return addr
	}
	port := parseSDWANListenPortFromRemoteConfig(node.RemoteConfig.String)
	if port == "" {
		port = "4242"
	}
	host := strings.TrimSpace(node.ServerIP)
	if host == "" && node.ServerIPV4.Valid {
		host = strings.TrimSpace(node.ServerIPV4.String)
	}
	if host == "" && node.ServerIPV6.Valid {
		host = strings.TrimSpace(node.ServerIPV6.String)
	}
	if host == "" {
		host = fallbackVPNIP
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), port)
}
