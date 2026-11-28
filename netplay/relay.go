package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Config holds the limits of a relay. Every hoster can change them with flags.
type Config struct {
	Addr       string
	TLSCert    string
	TLSKey     string
	Origins    []string
	TrustProxy bool

	MaxRooms   int
	MaxMembers int
	MaxMessage int
	RoomTTL    time.Duration

	// Traffic per client: messages and bytes per second (bursts up to twice as much).
	MsgPerSec  float64
	BytePerSec float64

	// Per IP address: rooms created and join attempts per minute.
	CreatePerMin float64
	JoinPerMin   float64

	// Network of every room for the DHCP server (PCs with a network card); invalid: no DHCP.
	LAN netip.Prefix

	// Connections per address, strikes and bans (guard.go).
	Guard GuardConfig
}

func DefaultConfig() Config {
	return Config{
		Addr:         ":8090",
		MaxRooms:     1000,
		MaxMembers:   8,
		MaxMessage:   16 * 1024,
		RoomTTL:      12 * time.Hour,
		MsgPerSec:    2000,
		BytePerSec:   1 << 20,
		CreatePerMin: 10,
		JoinPerMin:   30,
		LAN:          netip.MustParsePrefix("192.168.77.0/24"),
		Guard: GuardConfig{
			MaxConnsPerIP: 20, // a LAN party of 8 behind one router: control socket + Ethernet port each
			ConnPerMin:    60,
			BanStrikes:    20,
			BanWindow:     10 * time.Minute,
			BanTime:       10 * time.Minute,
			BanMax:        24 * time.Hour,
		},
	}
}

// Hub knows all rooms. Room codes and peer IDs are unique per hub.
type Hub struct {
	cfg     Config
	mu      sync.Mutex
	rooms   map[string]*Room
	peers   map[uint32]*Client
	tokens  map[string]*Client
	creates *IPLimiter
	joins   *IPLimiter
	guard   *Guard

	proxyWarning sync.Once
}

func NewHub(cfg Config) *Hub {
	return &Hub{
		cfg:     cfg,
		rooms:   map[string]*Room{},
		peers:   map[uint32]*Client{},
		tokens:  map[string]*Client{},
		creates: NewIPLimiter(cfg.CreatePerMin/60, cfg.CreatePerMin),
		joins:   NewIPLimiter(cfg.JoinPerMin/60, cfg.JoinPerMin),
		guard:   NewGuard(cfg.Guard),
	}
}

// Room is one virtual network segment.
type Room struct {
	code    string // shown to the players: a generated code or the name of a named room
	key     string // in Hub.rooms: the code, or the name in upper case
	salt    []byte
	pwHash  []byte // nil: no password
	created time.Time

	mu      sync.Mutex
	members map[uint32]*Client
	order   []uint32 // join order; the first one is the host
	sw      *Switch
}

// Client is one browser connected to the control socket.
type Client struct {
	hub   *Hub
	peer  uint32
	name  string
	token string // lets the same browser open an Ethernet port (v86) in its room
	num   int    // 1..: number in the room, the smallest free one (addresses of virtual networks)
	room  *Room
	out   chan outMsg
	ports []*EthPort
	quota *Bucket
	bytes *Bucket
	done  chan struct{}
	once  sync.Once

	ip       string // for the guard
	overMu   sync.Mutex
	overMsgs float64 // dropped over the limit since the last strike
	overB    float64
}

// overLimit counts data dropped over the traffic limit (control socket and Ethernet ports
// together). Every second's worth of excess (MsgPerSec messages or BytePerSec bytes) is a
// strike: a client that floods the relay for a while gets banned.
func (c *Client) overLimit(size int) {
	cfg := &c.hub.cfg
	c.overMu.Lock()
	c.overMsgs++
	c.overB += float64(size)
	strike := c.overMsgs >= cfg.MsgPerSec || c.overB >= cfg.BytePerSec
	if strike {
		c.overMsgs, c.overB = 0, 0
	}
	c.overMu.Unlock()
	if strike {
		c.hub.guard.Strike(c.ip, "traffic far over the limit")
	}
}

type outMsg struct {
	binary bool
	data   []byte
}

// --- protocol (see README.md) -------------------------------------------------

type ctrlIn struct {
	Type     string          `json:"type"`
	Room     string          `json:"room,omitempty"`
	Password string          `json:"password,omitempty"`
	Name     string          `json:"name,omitempty"`
	To       uint32          `json:"to,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
}

type member struct {
	Peer uint32 `json:"peer"`
	Name string `json:"name"`
	Host bool   `json:"host"`
	Num  int    `json:"num"`
}

type ctrlOut struct {
	Type    string          `json:"type"`
	Room    string          `json:"room,omitempty"`
	Peer    uint32          `json:"peer,omitempty"`
	Token   string          `json:"token,omitempty"`
	Host    uint32          `json:"host,omitempty"`
	Num     int             `json:"num,omitempty"`
	Members []member        `json:"members,omitempty"`
	From    uint32          `json:"from,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	Code    string          `json:"code,omitempty"`
	Message string          `json:"message,omitempty"`
	Version string          `json:"version,omitempty"`
}

// --- HTTP ---------------------------------------------------------------------

func (h *Hub) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("RunThemAll netplay relay " + Version + "\nWebSocket: /v1 (control and packets), /v1/eth (Ethernet frames)\n"))
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		rooms, peers := len(h.rooms), len(h.peers)
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": Version, "rooms": rooms, "clients": peers, "banned": h.guard.Stats()})
	})
	mux.HandleFunc("/v1", h.serveControl)
	mux.HandleFunc("/v1/eth", h.serveEthernet)
	return mux
}

func (h *Hub) accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	opts := &websocket.AcceptOptions{OriginPatterns: h.cfg.Origins}
	for _, o := range h.cfg.Origins {
		if o == "*" {
			opts = &websocket.AcceptOptions{InsecureSkipVerify: true} // any page may use this relay
		}
	}
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(int64(h.cfg.MaxMessage))
	return conn, nil
}

// refuse answers a connection the guard did not let in. A banned page gets a readable error on
// its control socket (as long as it does not hammer the relay), everything else a plain status.
func (h *Hub) refuse(w http.ResponseWriter, r *http.Request, ip string, err error, control bool) {
	if err != errBanned {
		http.Error(w, err.Error(), http.StatusTooManyRequests)
		return
	}
	banned, b := h.guard.Banned(ip)
	if !control || !banned || !h.guard.rate.Allow(ipKey(ip)) {
		http.Error(w, "banned", http.StatusForbidden)
		return
	}
	conn, aerr := h.accept(w, r)
	if aerr != nil {
		return
	}
	text := "This address is blocked by the relay operator."
	if !b.until.IsZero() {
		text = fmt.Sprintf("This address is blocked until %s UTC (%s). Please try again later.", b.until.UTC().Format("15:04"), b.reason)
	}
	msg, _ := json.Marshal(ctrlOut{Type: "error", Code: "banned", Message: text})
	wctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	_ = conn.Write(wctx, websocket.MessageText, msg)
	conn.Close(websocket.StatusPolicyViolation, "banned")
}

// clientIP: the address limits and bans apply to. Behind a reverse proxy (-trust-proxy) it is
// the last entry of X-Forwarded-For, the one the proxy added: the entries before it come from the
// client and could be made up to dodge a ban.
func (h *Hub) clientIP(r *http.Request) string {
	if h.cfg.TrustProxy {
		if fwd := r.Header.Values("X-Forwarded-For"); len(fwd) > 0 {
			parts := strings.Split(fwd[len(fwd)-1], ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	} else if r.Header.Get("X-Forwarded-For") != "" {
		h.proxyWarning.Do(func() {
			log.Print("warning: requests come through a reverse proxy, but -trust-proxy is off: all players count as one address for limits and bans")
		})
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// serveControl: the first text message must be "create" or "join"; after that binary
// messages are packets for other members and text messages are small JSON messages.
func (h *Hub) serveControl(w http.ResponseWriter, r *http.Request) {
	ip := h.clientIP(r)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	release, err := h.guard.Admit(ip, cancel)
	if err != nil {
		h.refuse(w, r, ip, err, true)
		return
	}
	defer release()
	conn, err := h.accept(w, r)
	if err != nil {
		return
	}
	defer conn.CloseNow() // also when the guard ended the connection from inside the read loop

	c := &Client{
		ip:    ip,
		hub:   h,
		out:   make(chan outMsg, 256),
		quota: NewBucket(h.cfg.MsgPerSec, 2*h.cfg.MsgPerSec),
		bytes: NewBucket(h.cfg.BytePerSec, 2*h.cfg.BytePerSec),
		done:  make(chan struct{}),
	}
	go c.writeLoop(ctx, conn)

	// Handshake.
	hello, err := readJSON(ctx, conn, 15*time.Second)
	if err != nil {
		h.guard.Strike(ip, "broken handshake")
		conn.Close(websocket.StatusPolicyViolation, "expected create or join")
		return
	}
	c.name = cleanName(hello.Name)
	var room *Room
	switch hello.Type {
	case "create":
		if !h.creates.Allow(ipKey(ip)) {
			h.guard.Strike(ip, "rate limit (rooms)")
			c.fail(conn, "rate-limited", "Too many rooms created, please wait a minute.")
			return
		}
		room, err = h.createRoom(hello.Password)
	case "join":
		if !h.joins.Allow(ipKey(ip)) {
			h.guard.Strike(ip, "rate limit (joins)")
			c.fail(conn, "rate-limited", "Too many attempts, please wait a minute.")
			return
		}
		room, err = h.findRoom(hello.Room, hello.Password)
	case "enter":
		if !h.joins.Allow(ipKey(ip)) {
			h.guard.Strike(ip, "rate limit (joins)")
			c.fail(conn, "rate-limited", "Too many attempts, please wait a minute.")
			return
		}
		room, err = h.enterRoom(hello.Room, hello.Password, func() bool { return h.creates.Allow(ipKey(ip)) })
	default:
		err = errProtocol
	}
	if err != nil {
		switch err { // guessing passwords or room codes, or not our client
		case errBadPassword:
			h.guard.Strike(ip, "wrong passwords")
		case errNotFound:
			h.guard.Strike(ip, "unknown rooms")
		case errProtocol, errNoName:
			h.guard.Strike(ip, "invalid requests")
		}
		c.fail(conn, errCode(err), err.Error())
		return
	}
	if err := h.addMember(room, c); err != nil {
		c.fail(conn, errCode(err), err.Error())
		return
	}
	defer h.removeMember(c)

	room.mu.Lock()
	host := room.order[0]
	room.mu.Unlock()
	c.sendJSON(ctrlOut{Type: "joined", Room: room.code, Peer: c.peer, Token: c.token, Host: host, Num: c.num, Version: Version})
	room.broadcastMembers()
	log.Printf("room %s: peer %d joined (%s)", room.code, c.peer, hello.Type)

	go keepAlive(ctx, conn)
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if !c.quota.Take(1) || !c.bytes.Take(float64(len(data))) {
			c.overLimit(len(data))
			continue // over the limit: dropped like a lost packet
		}
		if typ == websocket.MessageBinary {
			c.forwardPacket(data)
			continue
		}
		var msg ctrlIn
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "msg":
			c.forwardJSON(msg.To, msg.Data)
		case "leave":
			conn.Close(websocket.StatusNormalClosure, "")
			return
		}
	}
}

// forwardPacket: [4 bytes target peer, big endian, 0 = everybody else][payload] is passed on
// as [4 bytes sender peer][payload].
func (c *Client) forwardPacket(data []byte) {
	if len(data) < 4 {
		return
	}
	to := binary.BigEndian.Uint32(data)
	binary.BigEndian.PutUint32(data, c.peer) // reuse the buffer: it is only read from now on
	msg := outMsg{binary: true, data: data}
	room := c.room
	room.mu.Lock()
	defer room.mu.Unlock()
	if to != 0 {
		if target, ok := room.members[to]; ok && target != c {
			target.push(msg)
		}
		return
	}
	for peer, m := range room.members {
		if peer != c.peer {
			m.push(msg)
		}
	}
}

func (c *Client) forwardJSON(to uint32, data json.RawMessage) {
	if len(data) == 0 {
		return
	}
	b, _ := json.Marshal(ctrlOut{Type: "msg", From: c.peer, Data: data})
	msg := outMsg{data: b}
	room := c.room
	room.mu.Lock()
	defer room.mu.Unlock()
	for peer, m := range room.members {
		if peer != c.peer && (to == 0 || to == peer) {
			m.push(msg)
		}
	}
}

// push never blocks: a client that does not read fast enough loses packets (like UDP).
func (c *Client) push(m outMsg) {
	select {
	case c.out <- m:
	default:
	}
}

func (c *Client) sendJSON(v ctrlOut) {
	b, _ := json.Marshal(v)
	c.push(outMsg{data: b})
}

func (c *Client) fail(conn *websocket.Conn, code, message string) {
	b, _ := json.Marshal(ctrlOut{Type: "error", Code: code, Message: message})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = conn.Write(ctx, websocket.MessageText, b)
	conn.Close(websocket.StatusNormalClosure, code)
}

func (c *Client) writeLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			conn.Close(websocket.StatusGoingAway, "room closed")
			return
		case m := <-c.out:
			typ := websocket.MessageText
			if m.binary {
				typ = websocket.MessageBinary
			}
			wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Write(wctx, typ, m.data)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (c *Client) close() { c.once.Do(func() { close(c.done) }) }

func keepAlive(ctx context.Context, conn *websocket.Conn) {
	t := time.NewTicker(25 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				conn.Close(websocket.StatusGoingAway, "no answer")
				return
			}
		}
	}
}

func readJSON(ctx context.Context, conn *websocket.Conn, timeout time.Duration) (ctrlIn, error) {
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	typ, data, err := conn.Read(rctx)
	if err != nil {
		return ctrlIn{}, err
	}
	if typ != websocket.MessageText {
		return ctrlIn{}, errProtocol
	}
	var msg ctrlIn
	return msg, json.Unmarshal(data, &msg)
}

// --- rooms ----------------------------------------------------------------------

var (
	errProtocol    = errors.New("expected create or join")
	errNotFound    = errors.New("No room with this code.")
	errBadPassword = errors.New("Wrong password.")
	errFull        = errors.New("The room is full.")
	errTooMany     = errors.New("The relay has no free rooms, please try later.")
	errNoName      = errors.New("Enter a room name.")
	errNoPassword  = errors.New("This room has no password: leave the password empty, or choose another room name.")
	errRateLimited = errors.New("Too many rooms created, please wait a minute.")
)

func errCode(err error) string {
	switch err {
	case errNotFound:
		return "not-found"
	case errBadPassword:
		return "bad-password"
	case errFull:
		return "full"
	case errTooMany:
		return "busy"
	case errNoPassword:
		return "no-password"
	case errRateLimited:
		return "rate-limited"
	}
	return "protocol"
}

// Room codes: 10 characters without look-alikes (0/O, 1/I/L), about 49 bits.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newCode() string {
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 11)
	for i, v := range b {
		if i == 5 {
			out = append(out, '-')
		}
		out = append(out, codeAlphabet[int(v)%len(codeAlphabet)])
	}
	return string(out)
}

// NormalizeCode accepts codes typed in lower case, with spaces or without the dash.
func NormalizeCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if strings.ContainsRune(codeAlphabet, r) {
			b.WriteRune(r)
		}
	}
	c := b.String()
	if len(c) != 10 {
		return ""
	}
	return c[:5] + "-" + c[5:]
}

func hashPassword(salt []byte, pw string) []byte {
	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(pw))
	return h.Sum(nil)
}

func (h *Hub) createRoom(password string) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.cfg.MaxRooms {
		return nil, errTooMany
	}
	r := h.newRoom(password)
	for {
		r.code = newCode()
		if _, taken := h.rooms[r.code]; !taken {
			break
		}
	}
	r.key = r.code
	h.rooms[r.key] = r
	return r, nil
}

func (h *Hub) newRoom(password string) *Room {
	r := &Room{created: time.Now(), members: map[uint32]*Client{}, sw: NewSwitch(NewLAN(h.cfg.LAN))}
	if password != "" {
		r.salt = make([]byte, 16)
		_, _ = rand.Read(r.salt)
		r.pwHash = hashPassword(r.salt, password)
	}
	return r
}

func (h *Hub) findRoom(code, password string) (*Room, error) {
	h.mu.Lock()
	r := h.rooms[NormalizeCode(code)]
	h.mu.Unlock()
	if r == nil {
		return nil, errNotFound
	}
	if !r.passwordOK(password) {
		return nil, errBadPassword
	}
	return r, nil
}

func (r *Room) passwordOK(password string) bool {
	return r.pwHash == nil || subtle.ConstantTimeCompare(r.pwHash, hashPassword(r.salt, password)) == 1
}

// enterRoom joins the named room, or creates it when nobody is in it yet (with the given
// password; allowCreate applies the rate limit for new rooms). Names are compared ignoring case.
func (h *Hub) enterRoom(name, password string, allowCreate func() bool) (*Room, error) {
	name = cleanRoomName(name)
	if name == "" {
		return nil, errNoName
	}
	key := strings.ToUpper(name)
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[key]; r != nil {
		if r.pwHash == nil && password != "" {
			return nil, errNoPassword
		}
		if !r.passwordOK(password) {
			return nil, errBadPassword
		}
		return r, nil
	}
	if len(h.rooms) >= h.cfg.MaxRooms {
		return nil, errTooMany
	}
	if !allowCreate() {
		return nil, errRateLimited
	}
	r := h.newRoom(password)
	r.code, r.key = name, key
	h.rooms[key] = r
	return r, nil
}

// cleanRoomName: printable characters, spaces collapsed, at most 32 characters.
func cleanRoomName(s string) string {
	var b strings.Builder
	n := 0
	for _, f := range strings.Fields(s) {
		for _, r := range f {
			if r < 32 || r == 127 || n >= 32 {
				continue
			}
			b.WriteRune(r)
			n++
		}
		if n < 32 {
			b.WriteRune(' ')
			n++
		}
	}
	return strings.TrimSpace(b.String())
}

func (h *Hub) addMember(r *Room, c *Client) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[r.key] != r {
		return errNotFound // closed in the meantime
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.members) >= h.cfg.MaxMembers {
		return errFull
	}
	for c.peer == 0 || h.peers[c.peer] != nil {
		var b [4]byte
		_, _ = rand.Read(b[:])
		c.peer = binary.BigEndian.Uint32(b[:]) & 0x7fffffff // positive: js-dos parses it as a number
	}
	tok := make([]byte, 16)
	_, _ = rand.Read(tok)
	c.token = hex.EncodeToString(tok)
	c.room = r
	used := map[int]bool{}
	for _, m := range r.members {
		used[m.num] = true
	}
	for c.num = 1; used[c.num]; c.num++ {
	}
	r.members[c.peer] = c
	r.order = append(r.order, c.peer)
	h.peers[c.peer] = c
	h.tokens[c.token] = c
	return nil
}

func (h *Hub) removeMember(c *Client) {
	r := c.room
	h.mu.Lock()
	delete(h.peers, c.peer)
	delete(h.tokens, c.token)
	r.mu.Lock()
	delete(r.members, c.peer)
	for i, p := range r.order {
		if p == c.peer {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
	empty := len(r.members) == 0
	ports := c.ports
	c.ports = nil
	r.mu.Unlock()
	if empty {
		delete(h.rooms, r.key)
	}
	h.mu.Unlock()
	c.close()
	for _, p := range ports {
		p.close()
	}
	log.Printf("room %s: peer %d left", r.code, c.peer)
	if !empty {
		r.broadcastMembers()
	} else {
		log.Printf("room %s: closed", r.code)
	}
}

// broadcastMembers tells everybody who is in the room. The first member is the host
// (for js-dos: the one that runs the IPX server); if the host leaves, the next one is host.
func (r *Room) broadcastMembers() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.order) == 0 {
		return
	}
	list := make([]member, 0, len(r.order))
	for i, p := range r.order {
		list = append(list, member{Peer: p, Name: r.members[p].name, Host: i == 0, Num: r.members[p].num})
	}
	b, _ := json.Marshal(ctrlOut{Type: "members", Room: r.code, Host: r.order[0], Members: list})
	for _, m := range r.members {
		m.push(outMsg{data: b})
	}
}

// Janitor closes rooms that are older than RoomTTL and forgets old rate limit entries.
func (h *Hub) Janitor(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		h.creates.Forget(10 * time.Minute)
		h.joins.Forget(10 * time.Minute)
		h.guard.Forget()
		var old []*Client
		h.mu.Lock()
		for _, r := range h.rooms {
			if time.Since(r.created) > h.cfg.RoomTTL {
				r.mu.Lock()
				for _, m := range r.members {
					old = append(old, m)
				}
				r.mu.Unlock()
			}
		}
		h.mu.Unlock()
		for _, c := range old {
			c.close() // the read loop ends and removes the member
		}
	}
}

func cleanName(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r >= 32 && r != 127 {
			b.WriteRune(r)
		}
		if b.Len() >= 32 {
			break
		}
	}
	if b.Len() == 0 {
		return "Player"
	}
	return b.String()
}
