package handler

import (
	"net/http"
	"os/exec"
	"strings"

	"go-backend/internal/http/response"
)

func (h *Handler) mimicGenerateKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.Err(405, "请求方法不允许"))
		return
	}
	privKey, err := exec.Command("wg", "genkey").Output()
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("生成私钥失败: "+err.Error()))
		return
	}
	privStr := strings.TrimSpace(string(privKey))
	cmd := exec.Command("wg", "pubkey")
	cmd.Stdin = strings.NewReader(privStr)
	pubKey, err := cmd.Output()
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("生成公钥失败: "+err.Error()))
		return
	}
	mimicPort, _ := h.repo.GetNextMimicPort()
	wgSubnet, _ := h.repo.GetNextWgSubnet()
	response.WriteJSON(w, response.R{
		Code: 0,
		Data: map[string]interface{}{
			"privateKey": privStr,
			"publicKey":  strings.TrimSpace(string(pubKey)),
			"mimicPort":  mimicPort,
			"wgSubnet":   wgSubnet,
		},
	})
}
