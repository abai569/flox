package selector

import (
	"context"
	"reflect"
	"testing"

	"github.com/go-gost/core/metadata"
)

type testMetadata map[string]any

func (m testMetadata) IsExists(key string) bool {
	_, ok := m[key]
	return ok
}

func (m testMetadata) Set(key string, value any) {
	m[key] = value
}

func (m testMetadata) Get(key string) any {
	return m[key]
}

type weightedItem struct {
	name string
	md   testMetadata
}

func (i *weightedItem) Metadata() metadata.Metadata {
	return i.md
}

func TestRoundRobinStrategyUsesWeights(t *testing.T) {
	strategy := RoundRobinStrategy[*weightedItem]()
	items := []*weightedItem{
		{name: "a", md: testMetadata{"weight": 1}},
		{name: "b", md: testMetadata{"weight": 2}},
	}

	got := make([]string, 0, 6)
	for range 6 {
		got = append(got, strategy.Apply(context.Background(), items...).name)
	}
	want := []string{"a", "b", "b", "a", "b", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("weighted round-robin sequence mismatch: got %v want %v", got, want)
	}
}
