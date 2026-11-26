package main

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Ethernet ports for PC emulators with a network card (v86). v86 connects to a relay URL by
// itself and sends every Ethernet frame as one binary WebSocket message, so the port is its
// own WebSocket: /v1/eth?token=... where the token comes from the "joined" message of the
// control socket. The room works as a switch: it learns which MAC address is behind which port.

// EthPort is one network card in the room.
type EthPort struct {
	out  chan []byte
	done chan struct{}
	once sync.Once
}

func (p *EthPort) close() { p.once.Do(func() { close(p.done) }) }

func (p *EthPort) push(frame []byte) {
	select {
	case p.out <- frame:
	default: // a slow port loses frames, like a real network under load
	}
}

// Switch forwards frames between the ports of a room.
type Switch struct {
	mu    sync.Mutex
	ports map[*EthPort]struct{}
	macs  map[[6]byte]*EthPort
	lan   *LAN // DHCP server of the room, nil when switched off
}

const maxMacs = 256

func NewSwitch(lan *LAN) *Switch {
	return &Switch{ports: map[*EthPort]struct{}{}, macs: map[[6]byte]*EthPort{}, lan: lan}
}

func (s *Switch) add(p *EthPort) {
	s.mu.Lock()
	s.ports[p] = struct{}{}
	s.mu.Unlock()
}

func (s *Switch) remove(p *EthPort) {
	s.mu.Lock()
	delete(s.ports, p)
	for mac, q := range s.macs {
		if q == p {
			delete(s.macs, mac)
		}
	}
	s.mu.Unlock()
}

// Forward sends a frame to the port of its destination MAC address, or to all other ports
// for broadcast, multicast and not yet known addresses.
func (s *Switch) Forward(from *EthPort, frame []byte) {
	if len(frame) < 14 {
		return
	}
	var dst, src [6]byte
	copy(dst[:], frame[0:6])
	copy(src[:], frame[6:12])
	if s.lan != nil && (dst[0]&1 == 1 || dst == serverMAC) {
		reply, consumed := s.lan.Handle(frame)
		if reply != nil {
			from.push(reply)
		}
		if consumed || dst == serverMAC {
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if src[0]&1 == 0 { // unicast source: learn it
		if _, known := s.macs[src]; known || len(s.macs) < maxMacs {
			s.macs[src] = from
		}
	}
	if dst[0]&1 == 0 {
		if to, ok := s.macs[dst]; ok {
			if to != from {
				to.push(frame)
			}
			return
		}
	}
	for p := range s.ports {
		if p != from {
			p.push(frame)
		}
	}
}

func (h *Hub) serveEthernet(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	owner := h.tokens[r.URL.Query().Get("token")]
	h.mu.Unlock()
	if owner == nil {
		http.Error(w, "unknown token: join a room first", http.StatusForbidden)
		return
	}
	conn, err := h.accept(w, r)
	if err != nil {
		return
	}
	room := owner.room
	port := &EthPort{out: make(chan []byte, 256), done: make(chan struct{})}

	room.mu.Lock()
	if room.members[owner.peer] != owner {
		room.mu.Unlock()
		conn.Close(websocket.StatusPolicyViolation, "left the room")
		return
	}
	owner.ports = append(owner.ports, port)
	room.mu.Unlock()
	room.sw.add(port)
	defer room.sw.remove(port)
	log.Printf("room %s: peer %d opened an Ethernet port", room.code, owner.peer)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-port.done:
				conn.Close(websocket.StatusGoingAway, "left the room")
				return
			case frame := <-port.out:
				wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Write(wctx, websocket.MessageBinary, frame)
				wcancel()
				if err != nil {
					return
				}
			}
		}
	}()
	go keepAlive(ctx, conn)

	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary {
			continue
		}
		if !owner.quota.Take(1) || !owner.bytes.Take(float64(len(data))) {
			continue
		}
		room.sw.Forward(port, data)
	}
}
