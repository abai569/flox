package registry

import (
	"context"
	"strconv"
	"strings"

	"github.com/go-gost/core/limiter"
	"github.com/go-gost/core/limiter/conn"
	"github.com/go-gost/core/limiter/rate"
	"github.com/go-gost/core/limiter/traffic"
)

type trafficLimiterRegistry struct {
	registry[traffic.TrafficLimiter]
}

func (r *trafficLimiterRegistry) Register(name string, v traffic.TrafficLimiter) error {
	return r.registry.Register(name, v)
}

func (r *trafficLimiterRegistry) Get(name string) traffic.TrafficLimiter {
	names := splitTrafficLimiterNames(name)
	if len(names) == 1 {
		return &trafficLimiterWrapper{name: names[0], r: r}
	}
	if len(names) > 1 {
		limiters := make([]traffic.TrafficLimiter, 0, len(names))
		for _, name := range names {
			limiters = append(limiters, &trafficLimiterWrapper{name: name, r: r})
		}
		return &trafficLimiterSet{limiters: limiters}
	}
	return nil
}

func splitTrafficLimiterNames(value string) []string {
	seen := make(map[string]struct{})
	var names []string
	for _, name := range strings.Split(value, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	return names
}

func (r *trafficLimiterRegistry) get(name string) traffic.TrafficLimiter {
	return r.registry.Get(name)
}

type trafficLimiterWrapper struct {
	name string
	r    *trafficLimiterRegistry
}

type trafficLimiterSet struct {
	limiters []traffic.TrafficLimiter
}

func (s *trafficLimiterSet) In(ctx context.Context, key string, opts ...limiter.Option) traffic.Limiter {
	var limits []traffic.Limiter
	for _, lim := range s.limiters {
		if value := lim.In(ctx, key, opts...); value != nil {
			limits = append(limits, value)
		}
	}
	return newTrafficLimitSet(limits)
}

func (s *trafficLimiterSet) Out(ctx context.Context, key string, opts ...limiter.Option) traffic.Limiter {
	var limits []traffic.Limiter
	for _, lim := range s.limiters {
		if value := lim.Out(ctx, key, opts...); value != nil {
			limits = append(limits, value)
		}
	}
	return newTrafficLimitSet(limits)
}

type trafficLimitSet struct {
	limits []traffic.Limiter
}

func newTrafficLimitSet(limits []traffic.Limiter) traffic.Limiter {
	if len(limits) == 0 {
		return nil
	}
	if len(limits) == 1 {
		return limits[0]
	}
	return &trafficLimitSet{limits: limits}
}

func (s *trafficLimitSet) Wait(ctx context.Context, n int) int {
	for _, lim := range s.limits {
		if value := lim.Wait(ctx, n); value < n {
			n = value
		}
	}
	return n
}

func (s *trafficLimitSet) Limit() int {
	limit := 0
	for _, lim := range s.limits {
		if value := lim.Limit(); limit == 0 || value < limit {
			limit = value
		}
	}
	return limit
}

func (s *trafficLimitSet) Set(int) {}

func (s *trafficLimitSet) String() string {
	parts := make([]string, 0, len(s.limits))
	for _, lim := range s.limits {
		parts = append(parts, strconv.Itoa(lim.Limit()))
	}
	return strings.Join(parts, ",")
}

func (w *trafficLimiterWrapper) In(ctx context.Context, key string, opts ...limiter.Option) traffic.Limiter {
	v := w.r.get(w.name)
	if v == nil {
		return nil
	}
	return v.In(ctx, key, opts...)
}

func (w *trafficLimiterWrapper) Out(ctx context.Context, key string, opts ...limiter.Option) traffic.Limiter {
	v := w.r.get(w.name)
	if v == nil {
		return nil
	}
	return v.Out(ctx, key, opts...)
}

type connLimiterRegistry struct {
	registry[conn.ConnLimiter]
}

func (r *connLimiterRegistry) Register(name string, v conn.ConnLimiter) error {
	return r.registry.Register(name, v)
}

func (r *connLimiterRegistry) Get(name string) conn.ConnLimiter {
	if name != "" {
		return &connLimiterWrapper{name: name, r: r}
	}
	return nil
}

func (r *connLimiterRegistry) get(name string) conn.ConnLimiter {
	return r.registry.Get(name)
}

type connLimiterWrapper struct {
	name string
	r    *connLimiterRegistry
}

func (w *connLimiterWrapper) Limiter(key string) conn.Limiter {
	v := w.r.get(w.name)
	if v == nil {
		return nil
	}
	return v.Limiter(key)
}

type rateLimiterRegistry struct {
	registry[rate.RateLimiter]
}

func (r *rateLimiterRegistry) Register(name string, v rate.RateLimiter) error {
	return r.registry.Register(name, v)
}

func (r *rateLimiterRegistry) Get(name string) rate.RateLimiter {
	if name != "" {
		return &rateLimiterWrapper{name: name, r: r}
	}
	return nil
}

func (r *rateLimiterRegistry) get(name string) rate.RateLimiter {
	return r.registry.Get(name)
}

type rateLimiterWrapper struct {
	name string
	r    *rateLimiterRegistry
}

func (w *rateLimiterWrapper) Limiter(key string) rate.Limiter {
	v := w.r.get(w.name)
	if v == nil {
		return nil
	}
	return v.Limiter(key)
}
