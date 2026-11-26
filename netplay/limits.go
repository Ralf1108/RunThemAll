package main

import (
	"sync"
	"time"
)

// Bucket is a token bucket: Rate tokens per second, at most Burst saved up.
type Bucket struct {
	mu     sync.Mutex
	rate   float64
	burst  float64
	tokens float64
	last   time.Time
}

func NewBucket(rate, burst float64) *Bucket {
	return &Bucket{rate: rate, burst: burst, tokens: burst, last: time.Now()}
}

// Take removes n tokens if there are enough.
func (b *Bucket) Take(n float64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.tokens += now.Sub(b.last).Seconds() * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
	if b.tokens < n {
		return false
	}
	b.tokens -= n
	return true
}

// IPLimiter keeps one bucket per IP address (rooms created, join attempts).
type IPLimiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*Bucket
}

func NewIPLimiter(rate, burst float64) *IPLimiter {
	return &IPLimiter{rate: rate, burst: burst, buckets: map[string]*Bucket{}}
}

func (l *IPLimiter) Allow(ip string) bool {
	l.mu.Lock()
	b := l.buckets[ip]
	if b == nil {
		b = NewBucket(l.rate, l.burst)
		l.buckets[ip] = b
	}
	l.mu.Unlock()
	return b.Take(1)
}

// Forget drops buckets that were not used for a while (they are full again anyway).
func (l *IPLimiter) Forget(idle time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for ip, b := range l.buckets {
		b.mu.Lock()
		old := time.Since(b.last) > idle
		b.mu.Unlock()
		if old {
			delete(l.buckets, ip)
		}
	}
}
