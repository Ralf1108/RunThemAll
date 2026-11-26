package main

import (
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"net/netip"
	"sync"
)

// A small DHCP server in every room, so the PCs in a room (v86) get IP addresses without any
// setup: the room is one LAN, by default 192.168.77.0/24. The server is a virtual host on the
// switch (address .1); it answers DHCP and ARP for its own address and nothing else. There is
// no router and no DNS: the LAN only reaches the other players.

// serverMAC is the MAC address of the virtual DHCP server (locally administered).
var serverMAC = [6]byte{0x02, 0x52, 0x54, 0x41, 0x00, 0x01}

const leaseSeconds = 24 * 60 * 60

// LAN hands out the addresses of one room.
type LAN struct {
	mu     sync.Mutex
	prefix netip.Prefix
	server netip.Addr
	first  netip.Addr // first address of the pool
	last   netip.Addr
	leases map[[6]byte]netip.Addr
	used   map[netip.Addr]bool
}

// ParseLAN checks a network like "192.168.77.0/24" (IPv4, /16 to /28). Empty means no DHCP.
func ParseLAN(s string) (netip.Prefix, error) {
	if s == "" || s == "off" {
		return netip.Prefix{}, nil
	}
	p, err := netip.ParsePrefix(s)
	if err != nil || !p.Addr().Is4() || p.Bits() < 16 || p.Bits() > 28 {
		return netip.Prefix{}, fmt.Errorf("-lan: an IPv4 network from /16 to /28 is needed, e.g. 192.168.77.0/24")
	}
	return p.Masked(), nil
}

// NewLAN returns nil for an invalid (empty) prefix: then the room has no DHCP server.
func NewLAN(p netip.Prefix) *LAN {
	if !p.IsValid() {
		return nil
	}
	base := p.Addr().As4()
	n := binary.BigEndian.Uint32(base[:])
	size := uint32(1) << (32 - p.Bits())
	addr := func(v uint32) netip.Addr {
		var b [4]byte
		binary.BigEndian.PutUint32(b[:], v)
		return netip.AddrFrom4(b)
	}
	first := n + 2
	if size >= 64 {
		first = n + 10 // leave a few addresses for fixed setups
	}
	return &LAN{prefix: p, server: addr(n + 1), first: addr(first), last: addr(n + size - 2),
		leases: map[[6]byte]netip.Addr{}, used: map[netip.Addr]bool{}}
}

func (l *LAN) lease(mac [6]byte) (netip.Addr, bool) {
	if ip, ok := l.leases[mac]; ok {
		return ip, true
	}
	for ip := l.first; ip.Compare(l.last) <= 0; ip = ip.Next() {
		if !l.used[ip] {
			l.leases[mac] = ip
			l.used[ip] = true
			return ip, true
		}
	}
	return netip.Addr{}, false
}

func (l *LAN) mask() [4]byte {
	var m [4]byte
	binary.BigEndian.PutUint32(m[:], ^uint32(0)<<(32-l.prefix.Bits()))
	return m
}

// Handle answers a frame meant for the virtual server. It returns the reply (or nil) and whether
// the frame was for the server only (then the switch does not pass it on).
func (l *LAN) Handle(frame []byte) (reply []byte, consumed bool) {
	if len(frame) < 14 {
		return nil, false
	}
	switch binary.BigEndian.Uint16(frame[12:14]) {
	case 0x0806:
		return l.arp(frame), false
	case 0x0800:
		return l.dhcp(frame)
	}
	return nil, false
}

// arp answers "who has <server address>?".
func (l *LAN) arp(frame []byte) []byte {
	a := frame[14:]
	if len(a) < 28 || binary.BigEndian.Uint16(a[0:2]) != 1 || binary.BigEndian.Uint16(a[2:4]) != 0x0800 ||
		binary.BigEndian.Uint16(a[6:8]) != 1 || netip.AddrFrom4([4]byte(a[24:28])) != l.server {
		return nil
	}
	out := make([]byte, 42)
	copy(out[0:6], a[8:14]) // to the asking MAC
	copy(out[6:12], serverMAC[:])
	binary.BigEndian.PutUint16(out[12:14], 0x0806)
	r := out[14:]
	copy(r[0:6], a[0:6]) // hardware/protocol type and sizes
	binary.BigEndian.PutUint16(r[6:8], 2)
	copy(r[8:14], serverMAC[:])
	s := l.server.As4()
	copy(r[14:18], s[:])
	copy(r[18:28], a[8:18]) // sender MAC + IP become the target
	return out
}

// DHCP message types (option 53).
const (
	dhcpDiscover = 1
	dhcpOffer    = 2
	dhcpRequest  = 3
	dhcpAck      = 5
	dhcpNak      = 6
	dhcpRelease  = 7
	dhcpInform   = 8
)

func (l *LAN) dhcp(frame []byte) ([]byte, bool) {
	ip := frame[14:]
	if len(ip) < 20 || ip[0]>>4 != 4 || ip[9] != 17 {
		return nil, false
	}
	ihl := int(ip[0]&15) * 4
	if len(ip) < ihl+8 {
		return nil, false
	}
	udp := ip[ihl:]
	if binary.BigEndian.Uint16(udp[2:4]) != 67 {
		return nil, false
	}
	b := udp[8:]
	if len(b) < 240 || b[0] != 1 || b[1] != 1 || b[2] != 6 || binary.BigEndian.Uint32(b[236:240]) != 0x63825363 {
		return nil, true
	}
	var mac [6]byte
	copy(mac[:], b[28:34])
	opts := parseOptions(b[240:])
	typ := opts[53]
	if len(typ) != 1 {
		return nil, true
	}
	if sid := opts[54]; len(sid) == 4 && netip.AddrFrom4([4]byte(sid)) != l.server {
		return nil, true // the client chose another DHCP server
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	switch typ[0] {
	case dhcpDiscover:
		yours, ok := l.lease(mac)
		if !ok {
			return nil, true
		}
		return l.reply(b, mac, dhcpOffer, yours), true
	case dhcpRequest:
		yours, ok := l.lease(mac)
		if !ok {
			return nil, true
		}
		want := netip.AddrFrom4([4]byte(b[12:16])) // ciaddr while renewing
		if r := opts[50]; len(r) == 4 {
			want = netip.AddrFrom4([4]byte(r))
		}
		if want.IsValid() && !want.IsUnspecified() && want != yours {
			return l.reply(b, mac, dhcpNak, netip.Addr{}), true
		}
		log.Printf("DHCP: %v for %v", yours, net.HardwareAddr(mac[:]))
		return l.reply(b, mac, dhcpAck, yours), true
	case dhcpInform:
		return l.reply(b, mac, dhcpAck, netip.Addr{}), true
	case dhcpRelease:
		if ip, ok := l.leases[mac]; ok {
			delete(l.leases, mac)
			delete(l.used, ip)
		}
	}
	return nil, true
}

func parseOptions(b []byte) map[byte][]byte {
	opts := map[byte][]byte{}
	for i := 0; i < len(b); {
		code := b[i]
		if code == 255 {
			break
		}
		if code == 0 {
			i++
			continue
		}
		if i+1 >= len(b) || i+2+int(b[i+1]) > len(b) {
			break
		}
		opts[code] = b[i+2 : i+2+int(b[i+1])]
		i += 2 + int(b[i+1])
	}
	return opts
}

// reply builds a whole Ethernet frame with the DHCP answer. It goes to the client's MAC and to
// the IP broadcast address, which every client accepts, with or without an address.
func (l *LAN) reply(req []byte, mac [6]byte, typ byte, yours netip.Addr) []byte {
	d := make([]byte, 240, 300)
	d[0], d[1], d[2] = 2, 1, 6
	copy(d[4:8], req[4:8])     // transaction ID
	copy(d[10:12], req[10:12]) // flags
	if typ == dhcpAck && !yours.IsValid() {
		copy(d[12:16], req[12:16]) // INFORM: ciaddr stays
	}
	if yours.IsValid() {
		y := yours.As4()
		copy(d[16:20], y[:])
	}
	s := l.server.As4()
	copy(d[20:24], s[:])
	copy(d[28:44], req[28:44]) // client hardware address
	binary.BigEndian.PutUint32(d[236:240], 0x63825363)
	m := l.mask()
	var lease [4]byte
	binary.BigEndian.PutUint32(lease[:], leaseSeconds)
	d = append(d, 53, 1, typ, 54, 4, s[0], s[1], s[2], s[3])
	if typ != dhcpNak {
		d = append(d, 1, 4, m[0], m[1], m[2], m[3])
		if yours.IsValid() {
			d = append(d, 51, 4, lease[0], lease[1], lease[2], lease[3])
		}
	}
	d = append(d, 255)
	for len(d) < 300 { // BOOTP minimum size, some clients insist on it
		d = append(d, 0)
	}

	frame := make([]byte, 14+20+8+len(d))
	copy(frame[0:6], mac[:])
	copy(frame[6:12], serverMAC[:])
	binary.BigEndian.PutUint16(frame[12:14], 0x0800)
	ip := frame[14:34]
	ip[0] = 0x45
	binary.BigEndian.PutUint16(ip[2:4], uint16(20+8+len(d)))
	ip[8] = 64 // TTL
	ip[9] = 17 // UDP
	copy(ip[12:16], s[:])
	copy(ip[16:20], []byte{255, 255, 255, 255})
	binary.BigEndian.PutUint16(ip[10:12], checksum(ip))
	udp := frame[34:42]
	binary.BigEndian.PutUint16(udp[0:2], 67)
	binary.BigEndian.PutUint16(udp[2:4], 68)
	binary.BigEndian.PutUint16(udp[4:6], uint16(8+len(d))) // checksum 0: none, allowed for UDP over IPv4
	copy(frame[42:], d)
	return frame
}

func checksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(b[i:]))
	}
	for sum > 0xffff {
		sum = sum&0xffff + sum>>16
	}
	return ^uint16(sum)
}
