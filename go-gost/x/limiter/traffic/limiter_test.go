package traffic

import "testing"

func TestNewLimiterUsesBoundedBurst(t *testing.T) {
	lim := NewLimiter(1_250_000).(*llimiter)
	if got, want := lim.limiter.Burst(), 125_000; got != want {
		t.Fatalf("burst = %d, want %d", got, want)
	}

	lim.Set(125_000)
	if got, want := lim.limiter.Burst(), minBurst; got != want {
		t.Fatalf("low-rate burst = %d, want %d", got, want)
	}
}
