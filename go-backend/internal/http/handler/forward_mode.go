package handler

import (
	"fmt"
	"strings"

	"go-backend/internal/middleware"
)

const (
	forwardModeGost     = "gost"
	forwardModeNftables = "nftables"
	forwardModeFloxcore = "floxcore"
	forwardModeSDWAN    = "sdwan"
	forwardModeMimic    = "mimic"
)

func normalizeForwardMode(mode string) string {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		return forwardModeGost
	}
	return mode
}

func isValidForwardMode(mode string) bool {
	switch normalizeForwardMode(mode) {
	case forwardModeGost, forwardModeNftables, forwardModeFloxcore, forwardModeSDWAN, forwardModeMimic:
		return true
	default:
		return false
	}
}

func isPremiumForwardMode(mode string) bool {
	switch normalizeForwardMode(mode) {
	case forwardModeNftables, forwardModeFloxcore, forwardModeSDWAN, forwardModeMimic:
		return true
	default:
		return false
	}
}

func isServiceBackedForwardMode(mode string) bool {
	return normalizeForwardMode(mode) != forwardModeNftables
}

func forwardModeDisplayName(mode string) string {
	switch normalizeForwardMode(mode) {
	case forwardModeFloxcore:
		return "FloxCore"
	case forwardModeSDWAN:
		return "SDWAN"
	case forwardModeNftables:
		return "NFtables"
	case forwardModeMimic:
		return "Mimic"
	default:
		return "Gost"
	}
}

func ensureForwardModeAllowedForTier(tier middleware.TierType, mode string) error {
	if tier != middleware.TierFree {
		return nil
	}
	if !isPremiumForwardMode(mode) {
		return nil
	}
	return fmt.Errorf("%s 模式仅正式授权可用", forwardModeDisplayName(mode))
}

func ensureForwardModeCompatibleWithTunnel(mode string, tunnel *tunnelRecord) error {
	if tunnel == nil {
		return nil
	}
	return nil
}

func ensureForwardModeEnabled(getConfig func(string) (string, bool), mode string) error {
	switch normalizeForwardMode(mode) {
	case forwardModeNftables:
		if v, ok := getConfig("forward_mode_nft_enabled"); ok && v == "false" {
			return fmt.Errorf("NFtables 模式已关闭")
		}
	case forwardModeFloxcore:
		if v, ok := getConfig("forward_mode_flc_enabled"); ok && v == "false" {
			return fmt.Errorf("FloxCore 模式已关闭")
		}
	case forwardModeSDWAN:
		if v, ok := getConfig("forward_mode_sdw_enabled"); ok && v == "false" {
			return fmt.Errorf("SDWAN 模式已关闭")
		}
	case forwardModeMimic:
		if v, ok := getConfig("forward_mode_mimic_enabled"); ok && v == "false" {
			return fmt.Errorf("Mimic 模式已关闭")
		}
	}
	return nil
}
