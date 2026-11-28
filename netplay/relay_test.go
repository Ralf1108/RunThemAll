package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func startRelay(t *testing.T, cfg Config) string {
	t.Helper()
	cfg.Origins = []string{"*"}
	srv := httptest.NewServer(NewHub(cfg).Routes())
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

type testClient struct {
	t    *testing.T
	conn *websocket.Conn
}

func dial(t *testing.T, url string) *testClient {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return &testClient{t, conn}
}

func (c *testClient) sendJSON(v any) {
	b, _ := json.Marshal(v)
	if err := c.conn.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// next returns the next message; text messages are decoded.
func (c *testClient) next() (ctrlOut, []byte) {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	typ, data, err := c.conn.Read(ctx)
	if err != nil {
		c.t.Fatal(err)
	}
	if typ == websocket.MessageBinary {
		return ctrlOut{Type: "binary"}, data
	}
	var msg ctrlOut
	if err := json.Unmarshal(data, &msg); err != nil {
		c.t.Fatal(err)
	}
	return msg, nil
}

// expect skips "members" updates until a message of the given type arrives.
func (c *testClient) expect(typ string) (ctrlOut, []byte) {
	c.t.Helper()
	for {
		msg, data := c.next()
		if msg.Type == typ {
			return msg, data
		}
		if msg.Type != "members" {
			c.t.Fatalf("expected %s, got %+v", typ, msg)
		}
	}
}

func packet(to uint32, payload string) []byte {
	b := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(b, to)
	copy(b[4:], payload)
	return b
}

func TestRoomAndPackets(t *testing.T) {
	url := startRelay(t, DefaultConfig()) + "/v1"
	host := dial(t, url)
	host.sendJSON(map[string]string{"type": "create", "name": "Host", "password": "secret"})
	joined, _ := host.expect("joined")
	if joined.Host != joined.Peer || len(joined.Room) != 11 {
		t.Fatalf("unexpected joined message %+v", joined)
	}

	wrong := dial(t, url)
	wrong.sendJSON(map[string]string{"type": "join", "room": joined.Room, "password": "nope"})
	if msg, _ := wrong.next(); msg.Code != "bad-password" {
		t.Fatalf("expected bad-password, got %+v", msg)
	}

	guest := dial(t, url)
	// Lower case and without the dash is accepted too.
	guest.sendJSON(map[string]string{"type": "join", "room": strings.ToLower(strings.ReplaceAll(joined.Room, "-", "")), "password": "secret", "name": "Guest"})
	gj, _ := guest.expect("joined")
	if gj.Host != joined.Peer {
		t.Fatalf("guest sees host %d, want %d", gj.Host, joined.Peer)
	}
	members, _ := host.expect("members")
	for len(members.Members) < 2 {
		members, _ = host.expect("members")
	}

	// Unicast host -> guest arrives with the sender's peer ID in front.
	if err := host.conn.Write(context.Background(), websocket.MessageBinary, packet(gj.Peer, "hello")); err != nil {
		t.Fatal(err)
	}
	_, data := guest.expect("binary")
	if binary.BigEndian.Uint32(data) != joined.Peer || string(data[4:]) != "hello" {
		t.Fatalf("unexpected packet %q", data)
	}
	// Broadcast guest -> everybody else.
	if err := guest.conn.Write(context.Background(), websocket.MessageBinary, packet(0, "all")); err != nil {
		t.Fatal(err)
	}
	_, data = host.expect("binary")
	if binary.BigEndian.Uint32(data) != gj.Peer || string(data[4:]) != "all" {
		t.Fatalf("unexpected broadcast %q", data)
	}
	// JSON messages.
	guest.sendJSON(map[string]any{"type": "msg", "data": map[string]string{"hi": "there"}})
	msg, _ := host.expect("msg")
	if msg.From != gj.Peer || !bytes.Contains(msg.Data, []byte("there")) {
		t.Fatalf("unexpected msg %+v", msg)
	}

	// The host leaves: the guest becomes host.
	host.conn.Close(websocket.StatusNormalClosure, "")
	for {
		m, _ := guest.expect("members")
		if len(m.Members) == 1 {
			if m.Host != gj.Peer {
				t.Fatalf("guest should be host now: %+v", m)
			}
			break
		}
	}
}

func TestUnknownRoomAndFull(t *testing.T) {
	cfg := DefaultConfig()
	cfg.MaxMembers = 1
	url := startRelay(t, cfg) + "/v1"
	c := dial(t, url)
	c.sendJSON(map[string]string{"type": "join", "room": "AAAAA-BBBBB"})
	if msg, _ := c.next(); msg.Code != "not-found" {
		t.Fatalf("expected not-found, got %+v", msg)
	}
	host := dial(t, url)
	host.sendJSON(map[string]string{"type": "create"})
	joined, _ := host.expect("joined")
	second := dial(t, url)
	second.sendJSON(map[string]string{"type": "join", "room": joined.Room})
	if msg, _ := second.next(); msg.Code != "full" {
		t.Fatalf("expected full, got %+v", msg)
	}
}

func TestCreateRateLimit(t *testing.T) {
	cfg := DefaultConfig()
	cfg.CreatePerMin = 2
	url := startRelay(t, cfg) + "/v1"
	var last ctrlOut
	for i := 0; i < 3; i++ {
		c := dial(t, url)
		c.sendJSON(map[string]string{"type": "create"})
		last, _ = c.next()
	}
	if last.Code != "rate-limited" {
		t.Fatalf("third room should be refused, got %+v", last)
	}
}

func TestEthernetSwitch(t *testing.T) {
	base := startRelay(t, DefaultConfig())
	a := dial(t, base+"/v1")
	a.sendJSON(map[string]string{"type": "create"})
	ja, _ := a.expect("joined")
	b := dial(t, base+"/v1")
	b.sendJSON(map[string]string{"type": "join", "room": ja.Room})
	jb, _ := b.expect("joined")
	if ja.Num != 1 || jb.Num != 2 {
		t.Fatalf("numbers in the room: %d, %d", ja.Num, jb.Num)
	}

	ea := dial(t, base+"/v1/eth?token="+ja.Token)
	eb := dial(t, base+"/v1/eth?token="+jb.Token)
	time.Sleep(100 * time.Millisecond) // ports registered

	macA := []byte{2, 0, 0, 0, 0, 0xa}
	macB := []byte{2, 0, 0, 0, 0, 0xb}
	frame := func(dst, src []byte, body string) []byte {
		f := append(append(append([]byte{}, dst...), src...), 0x08, 0x00)
		return append(f, body...)
	}
	bcast := []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff}
	ctx := context.Background()
	// Broadcast from A reaches B (and A's MAC is learned).
	_ = ea.conn.Write(ctx, websocket.MessageBinary, frame(bcast, macA, "who"))
	_, got := eb.expect("binary")
	if !bytes.HasSuffix(got, []byte("who")) {
		t.Fatalf("broadcast not forwarded: %q", got)
	}
	// Unicast reply from B to A.
	_ = eb.conn.Write(ctx, websocket.MessageBinary, frame(macA, macB, "me"))
	_, got = ea.expect("binary")
	if !bytes.HasSuffix(got, []byte("me")) {
		t.Fatalf("unicast not forwarded: %q", got)
	}

	bad := dial(t, base+"/v1")
	_ = bad // a wrong token is refused before the upgrade
	ctx2, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := websocket.Dial(ctx2, base+"/v1/eth?token=wrong", nil); err == nil {
		t.Fatal("wrong token was accepted")
	}
}

func TestNormalizeCode(t *testing.T) {
	for in, want := range map[string]string{
		"abcde-fghjk":   "ABCDE-FGHJK",
		" ABCDEFGHJK ":  "ABCDE-FGHJK",
		"abc":           "",
		"ABCDE-FGHJK-X": "",
	} {
		if got := NormalizeCode(in); got != want {
			t.Errorf("NormalizeCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNamedRoom(t *testing.T) {
	url := startRelay(t, DefaultConfig()) + "/v1"
	a := dial(t, url)
	a.sendJSON(map[string]string{"type": "enter", "room": "  Doom   Night ", "password": "pw", "name": "Alice"})
	ja, _ := a.expect("joined")
	if ja.Room != "Doom Night" || ja.Host != ja.Peer {
		t.Fatalf("unexpected joined message %+v", ja)
	}
	wrong := dial(t, url)
	wrong.sendJSON(map[string]string{"type": "enter", "room": "doom night", "password": "nope"})
	if msg, _ := wrong.next(); msg.Code != "bad-password" {
		t.Fatalf("expected bad-password, got %+v", msg)
	}
	b := dial(t, url)
	b.sendJSON(map[string]string{"type": "enter", "room": "DOOM NIGHT", "password": "pw", "name": "Bob"})
	jb, _ := b.expect("joined")
	if jb.Room != "Doom Night" || jb.Host != ja.Peer || jb.Num != 2 {
		t.Fatalf("Bob did not land in Alice's room: %+v", jb)
	}
	open := dial(t, url)
	open.sendJSON(map[string]string{"type": "enter", "room": "lobby"})
	open.expect("joined")
	sneaky := dial(t, url)
	sneaky.sendJSON(map[string]string{"type": "enter", "room": "Lobby", "password": "x"})
	if msg, _ := sneaky.next(); msg.Code != "no-password" {
		t.Fatalf("expected no-password, got %+v", msg)
	}
	empty := dial(t, url)
	empty.sendJSON(map[string]string{"type": "enter", "room": "   "})
	if msg, _ := empty.next(); msg.Type != "error" {
		t.Fatalf("expected an error for an empty name, got %+v", msg)
	}
}

func TestClientIPBehindProxy(t *testing.T) {
	h := NewHub(Config{TrustProxy: true})
	r := httptest.NewRequest("GET", "/v1", nil)
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.7") // first entry made up by the client
	if got := h.clientIP(r); got != "203.0.113.7" {
		t.Fatalf("clientIP = %s, want the entry of the proxy", got)
	}
	h = NewHub(Config{})
	if got := h.clientIP(r); got != "127.0.0.1" {
		t.Fatalf("without -trust-proxy: %s", got)
	}
}
