package selector

import (
	"context"
	"hash/crc32"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/metadata"
	"github.com/go-gost/core/selector"
	ctxvalue "github.com/go-gost/x/ctx"
	mdutil "github.com/go-gost/x/metadata/util"
)

type roundRobinStrategy[T any] struct {
	counter uint64
}

// RoundRobinStrategy is a strategy for node selector.
// The node will be selected by round-robin algorithm.
func RoundRobinStrategy[T any]() selector.Strategy[T] {
	return &roundRobinStrategy[T]{}
}

func (s *roundRobinStrategy[T]) Apply(ctx context.Context, vs ...T) (v T) {
	if len(vs) == 0 {
		return
	}

	weights := make([]int, len(vs))
	total := 0
	for i := range vs {
		weights[i] = strategyWeight(vs[i])
		total += weights[i]
	}
	if total <= 0 {
		n := atomic.AddUint64(&s.counter, 1) - 1
		return vs[int(n%uint64(len(vs)))]
	}

	n := atomic.AddUint64(&s.counter, 1) - 1
	cursor := int(n % uint64(total))
	for i, weight := range weights {
		if cursor < weight {
			return vs[i]
		}
		cursor -= weight
	}
	return vs[len(vs)-1]
}

func strategyWeight[T any](v T) int {
	weight := 0
	if md, _ := any(v).(metadata.Metadatable); md != nil {
		weight = mdutil.GetInt(md.Metadata(), labelWeight)
	}
	if weight <= 0 {
		weight = 1
	}
	return weight
}

type randomStrategy[T any] struct {
	rw *RandomWeighted[T]
	mu sync.Mutex
}

// RandomStrategy is a strategy for node selector.
// The node will be selected randomly.
func RandomStrategy[T any]() selector.Strategy[T] {
	return &randomStrategy[T]{
		rw: NewRandomWeighted[T](),
	}
}

func (s *randomStrategy[T]) Apply(ctx context.Context, vs ...T) (v T) {
	if len(vs) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.rw.Reset()
	for i := range vs {
		s.rw.Add(vs[i], strategyWeight(vs[i]))
	}

	return s.rw.Next()
}

type fifoStrategy[T any] struct{}

// FIFOStrategy is a strategy for node selector.
// The node will be selected from first to last,
// and will stick to the selected node until it is failed.
func FIFOStrategy[T any]() selector.Strategy[T] {
	return &fifoStrategy[T]{}
}

// Apply applies the fifo strategy for the nodes.
func (s *fifoStrategy[T]) Apply(ctx context.Context, vs ...T) (v T) {
	if len(vs) == 0 {
		return
	}
	return vs[0]
}

type hashStrategy[T any] struct {
	r  *rand.Rand
	mu sync.Mutex
}

func HashStrategy[T any]() selector.Strategy[T] {
	return &hashStrategy[T]{
		r: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (s *hashStrategy[T]) Apply(ctx context.Context, vs ...T) (v T) {
	if len(vs) == 0 {
		return
	}
	if h := ctxvalue.HashFromContext(ctx); h != nil {
		value := uint64(crc32.ChecksumIEEE([]byte(h.Source)))
		logger.Default().Tracef("hash %s %d", h.Source, value)
		return vs[value%uint64(len(vs))]
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	return vs[s.r.Intn(len(vs))]
}
