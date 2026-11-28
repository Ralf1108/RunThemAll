package main

import (
	"context"
	"fmt"
	"log"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// Guard protects the relay from addresses that overdo it. Per IP address (IPv6: per /64, one
// connection of a home or phone) it limits the open connections and new connections per minute,
// and it counts strikes: rate limits hit, wrong passwords, unknown rooms, broken handshakes,
// traffic far over the limit. Too many strikes in a short time ban the address: all its
// connections are closed and new ones refused, for BanTime, doubled for every further ban up to
// BanMax. Addresses in Bans are always refused, addresses in BanExempt never limited or banned.
type Guard struct {
	cfg GuardConfig

	mu       sync.Mutex
	conns    map[string]map[*guardConn]struct{}
	strikes  map[string]*Bucket
	bans     map[string]banEntry
	offences map[string]offence // past bans, for longer bans of repeat offenders
	rate     *IPLimiter
}

// GuardConfig: the limits, part of Config (flags in main.go).
type GuardConfig struct {
	MaxConnsPerIP int           // open WebSockets per address (control and Ethernet ports together)
	ConnPerMin    float64       // new WebSockets per minute per address
	BanStrikes    int           // strikes within BanWindow that lead to a ban
	BanWindow     time.Duration // strikes are forgotten at BanStrikes per BanWindow
	BanTime       time.Duration // first ban; every further ban (within a day) twice as long
	BanMax        time.Duration
	Bans          []netip.Prefix // always refused
	BanExempt     []netip.Prefix // never limited or banned (e.g. a LAN party's own network)
}

type guardConn struct{ cancel context.CancelFunc }

type banEntry struct {
	until  time.Time
	reason string
}

type offence struct {
	count int
	last  time.Time
}

// Errors of Admit; the relay answers them with an HTTP status (or, for the control socket of
// a banned address, with an error message the page can show).
var (
	errBanned       = fmt.Errorf("banned")
	errTooManyConns = fmt.Errorf("too many connections from this address")
	errConnRate     = fmt.Errorf("too many new connections from this address")
)

func NewGuard(cfg GuardConfig) *Guard {
	perMin := cfg.ConnPerMin
	if perMin <= 0 {
		perMin = 1e9
	}
	return &Guard{
		cfg:      cfg,
		conns:    map[string]map[*guardConn]struct{}{},
		strikes:  map[string]*Bucket{},
		bans:     map[string]banEntry{},
		offences: map[string]offence{},
		rate:     NewIPLimiter(perMin/60, perMin),
	}
}

// ipKey: the address as the guard counts it: IPv4 as it is, IPv6 as its /64 network.
func ipKey(ip string) string {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	a = a.Unmap()
	if a.Is4() {
		return a.String()
	}
	p, _ := a.Prefix(64)
	return p.String()
}

func inAny(ip string, list []netip.Prefix) bool {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	a = a.Unmap()
	for _, p := range list {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func (g *Guard) exempt(ip string) bool { return inAny(ip, g.cfg.BanExempt) }

// Banned tells whether the address is refused now, and until when.
func (g *Guard) Banned(ip string) (bool, banEntry) {
	if g.exempt(ip) {
		return false, banEntry{}
	}
	if inAny(ip, g.cfg.Bans) {
		return true, banEntry{reason: "blocked by the operator"}
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	b, ok := g.bans[ipKey(ip)]
	if ok && time.Now().Before(b.until) {
		return true, b
	}
	return false, banEntry{}
}

// Admit checks a new connection. On success it returns a release function for its end; cancel
// is called when the address gets banned while the connection is open.
func (g *Guard) Admit(ip string, cancel context.CancelFunc) (release func(), err error) {
	if banned, _ := g.Banned(ip); banned {
		return nil, errBanned
	}
	if g.exempt(ip) {
		return func() {}, nil
	}
	key := ipKey(ip)
	if !g.rate.Allow(key) {
		g.Strike(ip, "too many new connections")
		return nil, errConnRate
	}
	g.mu.Lock()
	set := g.conns[key]
	if g.cfg.MaxConnsPerIP > 0 && len(set) >= g.cfg.MaxConnsPerIP {
		g.mu.Unlock()
		g.Strike(ip, "too many connections")
		return nil, errTooManyConns
	}
	if set == nil {
		set = map[*guardConn]struct{}{}
		g.conns[key] = set
	}
	gc := &guardConn{cancel: cancel}
	set[gc] = struct{}{}
	g.mu.Unlock()
	return func() {
		g.mu.Lock()
		delete(g.conns[key], gc)
		if len(g.conns[key]) == 0 {
			delete(g.conns, key)
		}
		g.mu.Unlock()
	}, nil
}

// Strike counts one misbehaviour of the address; too many in a short time ban it.
func (g *Guard) Strike(ip, reason string) {
	if g.cfg.BanStrikes <= 0 || g.exempt(ip) {
		return
	}
	key := ipKey(ip)
	g.mu.Lock()
	if b, ok := g.bans[key]; ok && time.Now().Before(b.until) {
		g.mu.Unlock()
		return // already banned
	}
	bucket := g.strikes[key]
	if bucket == nil {
		window := g.cfg.BanWindow
		if window <= 0 {
			window = 10 * time.Minute
		}
		bucket = NewBucket(float64(g.cfg.BanStrikes)/window.Seconds(), float64(g.cfg.BanStrikes))
		g.strikes[key] = bucket
	}
	if bucket.Take(1) {
		g.mu.Unlock()
		return
	}
	// Banned: the bucket is empty.
	delete(g.strikes, key)
	off := g.offences[key]
	if time.Since(off.last) > 24*time.Hour {
		off.count = 0
	}
	off.count++
	off.last = time.Now()
	g.offences[key] = off
	d := g.cfg.BanTime
	for i := 1; i < off.count && d < g.cfg.BanMax; i++ {
		d *= 2
	}
	if g.cfg.BanMax > 0 && d > g.cfg.BanMax {
		d = g.cfg.BanMax
	}
	g.bans[key] = banEntry{until: time.Now().Add(d), reason: reason}
	var open []*guardConn
	for c := range g.conns[key] {
		open = append(open, c)
	}
	g.mu.Unlock()
	log.Printf("guard: %s banned for %v (%s, ban %d today), %d connection(s) closed", key, d, reason, off.count, len(open))
	for _, c := range open {
		c.cancel()
	}
}

// Forget drops strikes that have run out, ended bans and offences older than a day.
func (g *Guard) Forget() {
	g.rate.Forget(10 * time.Minute)
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	for key, b := range g.bans {
		if now.After(b.until) {
			delete(g.bans, key)
		}
	}
	for key, b := range g.strikes {
		b.mu.Lock()
		idle := now.Sub(b.last) > g.cfg.BanWindow
		b.mu.Unlock()
		if idle {
			delete(g.strikes, key)
		}
	}
	for key, o := range g.offences {
		if now.Sub(o.last) > 24*time.Hour {
			delete(g.offences, key)
		}
	}
}

// Stats for /healthz.
func (g *Guard) Stats() (banned int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	for _, b := range g.bans {
		if now.Before(b.until) {
			banned++
		}
	}
	return banned
}

// ParsePrefixes reads "1.2.3.4, 10.0.0.0/8, 2001:db8::/32" (single addresses become /32 or /128).
func ParsePrefixes(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, part := range splitList(s) {
		if !strings.Contains(part, "/") {
			a, err := netip.ParseAddr(part)
			if err != nil {
				return nil, fmt.Errorf("not an IP address or network: %q", part)
			}
			a = a.Unmap()
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
			continue
		}
		p, err := netip.ParsePrefix(part)
		if err != nil {
			return nil, fmt.Errorf("not an IP address or network: %q", part)
		}
		out = append(out, p.Masked())
	}
	return out, nil
}
