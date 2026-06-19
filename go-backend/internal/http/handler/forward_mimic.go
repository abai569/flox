package handler

import (
	"net/http"

	"go-backend/internal/http/response"
)

func (h *Handler) mimicGenerateKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		response.WriteJSON(w, response.Err(405, "请求方法不允许"))
		return
	}
	privKey, pubKey, err := generateWGKeyPair()
	if err != nil {
		response.WriteJSON(w, response.ErrDefault("生成 WG 密钥对失败: "+err.Error()))
		return
	}
	mimicPort, _ := h.repo.GetNextMimicPort()
	wgSubnet, _ := h.repo.GetNextWgSubnet()
	response.WriteJSON(w, response.R{
		Code: 0,
		Data: map[string]interface{}{
			"privateKey": privKey,
			"publicKey":  pubKey,
			"mimicPort":  mimicPort,
			"wgSubnet":   wgSubnet,
		},
	})
}
