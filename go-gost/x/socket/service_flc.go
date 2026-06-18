package socket

import (
	"context"
	"fmt"
	"strings"

	"github.com/go-gost/core/service"
	"github.com/go-gost/x/config"

	"github.com/go-gost/x/adapter"
	floxcfg "github.com/go-gost/x/flox-core/config"
	"github.com/go-gost/x/flox-core/relay"
	floxchainregistry "github.com/go-gost/x/flox-core/registry"
)

// kernelName returns the kernel name from service config metadata.
// Returns "gost" if not set.
func kernelName(cfg *config.ServiceConfig) string {
	if cfg.Metadata != nil {
		if v, ok := cfg.Metadata["kernel"]; ok {
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(strings.ToLower(s))
				if s == "floxcore" || s == "sdwan" {
					return s
				}
			}
		}
	}
	if cfg.Handler != nil && cfg.Handler.Metadata != nil {
		if v, ok := cfg.Handler.Metadata["kernel"]; ok {
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(strings.ToLower(s))
				if s == "floxcore" || s == "sdwan" {
					return s
				}
			}
		}
	}
	return "gost"
}

// toFloxConfig converts a GOST ServiceConfig to FloxCore ServiceConfig.
func toFloxConfig(cfg *config.ServiceConfig) *floxcfg.ServiceConfig {
	fwd := &floxcfg.ForwarderConfig{}
	if cfg.Forwarder != nil {
		fwd.Selector = floxcfg.SelectorConfig{
			Strategy:    "round",
			MaxFails:    0,
			FailTimeout: 0,
		}
		if cfg.Forwarder.Selector != nil {
			fwd.Selector.Strategy = cfg.Forwarder.Selector.Strategy
			fwd.Selector.MaxFails = cfg.Forwarder.Selector.MaxFails
			fwd.Selector.FailTimeout = floxcfg.Duration(cfg.Forwarder.Selector.FailTimeout)
		}
		for _, n := range cfg.Forwarder.Nodes {
			addr := n.Addr
			if addr == "" {
				addr = n.Name
			}
			fwd.Nodes = append(fwd.Nodes, floxcfg.NodeConfig{
				Name: n.Name,
				Addr: addr,
			})
		}
	}

	handlerType := "tcp"
	if cfg.Handler != nil {
		handlerType = cfg.Handler.Type
	}

	chainName := ""
	if cfg.Handler != nil && cfg.Handler.Chain != "" {
		chainName = cfg.Handler.Chain
	}

	limiterName := ""
	if cfg.Limiter != "" {
		limiterName = cfg.Limiter
	}
	if cfg.Handler != nil && cfg.Handler.Limiter != "" {
		limiterName = cfg.Handler.Limiter
	}

	transportType := ""
	if cfg.Listener != nil {
		transportType = cfg.Listener.Type
	}

	return &floxcfg.ServiceConfig{
		Name:      cfg.Name,
		Addr:      cfg.Addr,
		Transport: transportType,
		Handler: floxcfg.HandlerConfig{
			Type:     handlerType,
			Metadata: cfg.Metadata,
		},
		Forwarder: fwd,
		Chain:     chainName,
		Limiter:   limiterName,
		Metadata:  cfg.Metadata,
	}
}

func parseEntryRelayService(cfg *config.ServiceConfig) (service.Service, error) {
	rt := adapter.LoadRelayRuntimeConfig()
	secret := rt.Secret

	nextChain := ""
	if cfg.Handler != nil {
		nextChain = cfg.Handler.Chain
	}
	target := ""
	if cfg.Metadata != nil {
		if t, ok := cfg.Metadata["target"]; ok {
			target, _ = t.(string)
		}
	}

	sfc := toFloxConfig(cfg)
	return adapter.NewEntryRelayService(sfc, relay.EntryHandler(
		secret,
		nextChain,
		target,
		func(ctx context.Context, chainName string, secret string) (*relay.Session, error) {
			ch := floxchainregistry.GlobalChainRegistry().Get(chainName)
			if ch == nil {
				return nil, fmt.Errorf("flox entry: chain %s not found", chainName)
			}
			return ch.DialSession(ctx, secret)
		},
		relay.DefaultTargetDialer(),
	))
}

// parseFloxService handles floxcore/sdwan kernel routing.
// Returns (nil, nil) to let the caller fall through to GOST.
func parseFloxService(cfg *config.ServiceConfig) (service.Service, error) {
	switch kernelName(cfg) {
	case "floxcore":
		switch cfg.Handler.Type {
		case "tcp", "udp":
			sfc := toFloxConfig(cfg)
			return adapter.NewForwardService(sfc)
		case "relay":
			role := ""
			if cfg.Metadata != nil {
				if r, ok := cfg.Metadata["role"]; ok {
					role, _ = r.(string)
				}
			}
			if role == "entry" {
				return parseEntryRelayService(cfg)
			}
			sfc := toFloxConfig(cfg)
			return adapter.NewRelayService(sfc, "", "", nil)
		default:
			return nil, fmt.Errorf("floxcore kernel does not support handler type %s", cfg.Handler.Type)
		}
	case "sdwan":
		switch cfg.Handler.Type {
		case "tcp", "udp":
			sfc := toFloxConfig(cfg)
			return adapter.NewSDWANService(sfc)
		default:
			return nil, fmt.Errorf("sdwan kernel does not support handler type %s", cfg.Handler.Type)
		}
	case "mimic":
		switch cfg.Handler.Type {
		case "tcp", "udp":
			sfc := toFloxConfig(cfg)
			return adapter.NewMimicForwardService(sfc)
		default:
			return nil, fmt.Errorf("mimic kernel does not support handler type %s", cfg.Handler.Type)
		}
	}
	return nil, nil
}
