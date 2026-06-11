package socket

import (
	"errors"
	"strings"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/x/config"
	parser "github.com/go-gost/x/config/parsing/chain"
	floxchain "github.com/go-gost/x/flox-core/chain"
	floxcfg "github.com/go-gost/x/flox-core/config"
	floxregistry "github.com/go-gost/x/flox-core/registry"
	"github.com/go-gost/x/registry"
)

func registerFloxChain(cfg *config.ChainConfig) {
	if cfg == nil {
		return
	}
	fc := &floxcfg.ChainConfig{Name: cfg.Name}
	for _, h := range cfg.Hops {
		if h == nil {
			continue
		}
		hop := floxcfg.HopConfig{Name: h.Name}
		if h.Selector != nil {
			hop.Selector = floxcfg.SelectorConfig{
				Strategy:    h.Selector.Strategy,
				MaxFails:    h.Selector.MaxFails,
				FailTimeout: floxcfg.Duration(h.Selector.FailTimeout),
			}
		}
		for _, n := range h.Nodes {
			if n == nil {
				continue
			}
			addr := n.Addr
			if addr == "" {
				addr = n.Name
			}
			transport := "tcp"
			if n.Dialer != nil && strings.TrimSpace(n.Dialer.Type) != "" {
				transport = strings.TrimSpace(n.Dialer.Type)
			}
			hop.Nodes = append(hop.Nodes, floxcfg.ChainNodeConfig{
				Name:      n.Name,
				Addr:      addr,
				Transport: transport,
			})
		}
		fc.Hops = append(fc.Hops, hop)
	}
	r := floxchain.NewRouter()
	r.AddChain(fc)
	if ch := r.GetChain(fc.Name); ch != nil {
		floxregistry.GlobalChainRegistry().Add(fc.Name, ch)
	}
}

func createChain(req createChainRequest) error {

	name := strings.TrimSpace(req.Data.Name)
	if name == "" {
		return errors.New("chain name is required")
	}
	req.Data.Name = name

	if registry.ChainRegistry().IsRegistered(name) {
		return errors.New("chain " + name + " already exists")
	}

	v, err := parser.ParseChain(&req.Data, logger.Default())
	if err != nil {
		return errors.New("create chain " + name + " failed: " + err.Error())
	}

	if err := registry.ChainRegistry().Register(name, v); err != nil {
		return errors.New("chain " + name + " already exists")
	}
	registerFloxChain(&req.Data)

	config.OnUpdate(func(c *config.Config) error {
		c.Chains = append(c.Chains, &req.Data)
		return nil
	})

	return nil
}

func updateChain(req updateChainRequest) error {

	name := strings.TrimSpace(req.Chain)

	if registry.ChainRegistry().IsRegistered(name) {
		registry.ChainRegistry().Unregister(name)
	}
	floxregistry.GlobalChainRegistry().Remove(name)

	req.Data.Name = name

	v, err := parser.ParseChain(&req.Data, logger.Default())
	if err != nil {
		return errors.New("create chain " + name + " failed: " + err.Error())
	}

	if err := registry.ChainRegistry().Register(name, v); err != nil {
		return errors.New("chain " + name + " already exists")
	}
	registerFloxChain(&req.Data)

	config.OnUpdate(func(c *config.Config) error {
		found := false
		for i := range c.Chains {
			if c.Chains[i].Name == name {
				c.Chains[i] = &req.Data
				found = true
				break
			}
		}
		if !found {
			c.Chains = append(c.Chains, &req.Data)
		}
		return nil
	})

	return nil
}

func deleteChain(req deleteChainRequest) error {

	name := strings.TrimSpace(req.Chain)

	if registry.ChainRegistry().IsRegistered(name) {
		registry.ChainRegistry().Unregister(name)
	}
	floxregistry.GlobalChainRegistry().Remove(name)

	config.OnUpdate(func(c *config.Config) error {
		chains := c.Chains
		c.Chains = nil
		for _, s := range chains {
			if s.Name == name {
				continue
			}
			c.Chains = append(c.Chains, s)
		}
		return nil
	})

	return nil
}

type createChainRequest struct {
	Data config.ChainConfig `json:"data"`
}

type updateChainRequest struct {
	Chain string             `json:"chain"`
	Data  config.ChainConfig `json:"data"`
}

type deleteChainRequest struct {
	Chain string `json:"chain"`
}
