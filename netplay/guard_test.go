package main

import (
	"context"
	"net/netip"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func guardConfig() Config {
	cfg := DefaultConfig()
	cfg.Guard = GuardConfig{MaxConnsPerIP: 20, ConnPerMin: 600, BanStrikes: 3, BanWindow: time.Minute, BanTime: time.Minute, BanMax: time.Hour}
	return cfg
}

// tryDial returns the connection or the dial error (refused by the guard: HTTP status).
func tryDial(url string) (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	return conn, err
}

// closedSoon: the connection is closed by the relay within a few seconds.
func closedSoon(conn *websocket.Conn) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return ctx.Err() == nil
		}
	}
}

func TestGuardBansGuessing(t *testing.T) {
	base := startRelay(t, guardConfig())
	// A member that is already in a room: its connection ends with the ban.
	member := dial(t, base+"/v1")
	member.sendJSON(map[string]any{"type": "enter", "room": "lan", "name": "A"})
	if m, _ := member.next(); m.Type != "joined" {
		t.Fatalf("member: %+v", m)
	}
	member.next() // members

	// Guessing room codes: three strikes are allowed, the fourth bans.
	for i := 0; i < 4; i++ {
		c := dial(t, base+"/v1")
		c.sendJSON(map[string]any{"type": "join", "room": "AAAAA-BBBBB"})
		if m, _ := c.next(); m.Code != "not-found" {
			t.Fatalf("attempt %d: %+v", i, m)
		}
	}
	if !closedSoon(member.conn) {
		t.Fatal("the open connection of the banned address was not closed")
	}
	// New connections get a readable error.
	c := dial(t, base+"/v1")
	if m, _ := c.next(); m.Type != "error" || m.Code != "banned" {
		t.Fatalf("after ban: %+v", m)
	} else {
		t.Log(m.Message)
	}
	// The Ethernet port is refused with a plain status.
	if _, err := tryDial(base + "/v1/eth?token=x"); err == nil {
		t.Fatal("Ethernet port of a banned address accepted")
	}
}

func TestGuardBansWrongPasswords(t *testing.T) {
	base := startRelay(t, guardConfig())
	owner := dial(t, base+"/v1")
	owner.sendJSON(map[string]any{"type": "enter", "room": "secret", "password": "right"})
	owner.next()
	for i := 0; i < 4; i++ {
		c := dial(t, base+"/v1")
		c.sendJSON(map[string]any{"type": "enter", "room": "secret", "password": "wrong"})
		if m, _ := c.next(); m.Code != "bad-password" {
			t.Fatalf("attempt %d: %+v", i, m)
		}
	}
	c := dial(t, base+"/v1")
	if m, _ := c.next(); m.Code != "banned" {
		t.Fatalf("after 4 wrong passwords: %+v", m)
	}
}

func TestGuardConnectionLimit(t *testing.T) {
	cfg := guardConfig()
	cfg.Guard.MaxConnsPerIP = 2
	base := startRelay(t, cfg)
	dial(t, base+"/v1")
	dial(t, base+"/v1")
	if _, err := tryDial(base + "/v1"); err == nil {
		t.Fatal("third connection accepted")
	}
}

func TestGuardConnectionRate(t *testing.T) {
	cfg := guardConfig()
	cfg.Guard.ConnPerMin = 3
	cfg.Guard.BanStrikes = 100
	base := startRelay(t, cfg)
	for i := 0; i < 3; i++ {
		c, err := tryDial(base + "/v1")
		if err != nil {
			t.Fatal(err)
		}
		c.CloseNow()
	}
	if _, err := tryDial(base + "/v1"); err == nil {
		t.Fatal("fourth connection in a minute accepted")
	}
}

func TestGuardBansFlooding(t *testing.T) {
	cfg := guardConfig()
	cfg.MsgPerSec = 20
	cfg.Guard.BanStrikes = 2
	base := startRelay(t, cfg)
	c := dial(t, base+"/v1")
	c.sendJSON(map[string]any{"type": "enter", "room": "flood"})
	c.next()
	c.next()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := 0; i < 500; i++ {
		if c.conn.Write(ctx, websocket.MessageBinary, []byte{0, 0, 0, 0, 1}) != nil {
			break // closed: banned
		}
	}
	if !closedSoon(c.conn) {
		t.Fatal("flooding client not disconnected")
	}
	if m, _ := dial(t, base+"/v1").next(); m.Code != "banned" {
		t.Fatalf("flooding address not banned: %+v", m)
	}
}

func TestGuardExemptAndStaticBan(t *testing.T) {
	cfg := guardConfig()
	cfg.Guard.BanExempt = []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("::1/128")}
	base := startRelay(t, cfg)
	for i := 0; i < 6; i++ {
		c := dial(t, base+"/v1")
		c.sendJSON(map[string]any{"type": "join", "room": "AAAAA-BBBBB"})
		c.next()
	}
	c := dial(t, base+"/v1")
	c.sendJSON(map[string]any{"type": "enter", "room": "ok"})
	if m, _ := c.next(); m.Type != "joined" {
		t.Fatalf("exempt address limited: %+v", m)
	}

	cfg = guardConfig()
	cfg.Guard.Bans = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("::1/128")}
	base = startRelay(t, cfg)
	if m, _ := dial(t, base+"/v1").next(); m.Code != "banned" {
		t.Fatalf("statically banned address let in: %+v", m)
	}
}

func TestGuardEscalation(t *testing.T) {
	g := NewGuard(GuardConfig{BanStrikes: 1, BanWindow: time.Minute, BanTime: 10 * time.Minute, BanMax: 30 * time.Minute})
	ban := func() time.Duration {
		g.Strike("203.0.113.7", "test")
		g.Strike("203.0.113.7", "test")
		_, b := g.Banned("203.0.113.7")
		d := time.Until(b.until).Round(time.Minute)
		g.mu.Lock()
		delete(g.bans, "203.0.113.7") // ban over
		g.mu.Unlock()
		return d
	}
	for i, want := range []time.Duration{10 * time.Minute, 20 * time.Minute, 30 * time.Minute, 30 * time.Minute} {
		if got := ban(); got != want {
			t.Fatalf("ban %d: %v, want %v", i+1, got, want)
		}
	}
	if banned, _ := g.Banned("203.0.113.8"); banned {
		t.Fatal("neighbour address banned")
	}
}

func TestIPKeyAndPrefixes(t *testing.T) {
	for in, want := range map[string]string{
		"203.0.113.7":                 "203.0.113.7",
		"::ffff:203.0.113.7":          "203.0.113.7",
		"2001:db8:1:2:aaaa::1":        "2001:db8:1:2::/64",
		"2001:db8:1:2:bbbb:cccc::999": "2001:db8:1:2::/64",
	} {
		if got := ipKey(in); got != want {
			t.Errorf("ipKey(%s) = %s, want %s", in, got, want)
		}
	}
	p, err := ParsePrefixes("203.0.113.7, 198.51.100.0/24 ,2001:db8::/32")
	if err != nil || len(p) != 3 || p[0].Bits() != 32 || !inAny("198.51.100.99", p) || !inAny("2001:db8::5", p) || inAny("203.0.113.8", p) {
		t.Fatalf("ParsePrefixes: %v %v", p, err)
	}
	if _, err := ParsePrefixes("not-an-ip"); err == nil {
		t.Fatal("bad entry accepted")
	}
}
