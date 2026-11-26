package main

import (
	"encoding/binary"
	"net/netip"
	"testing"
)

// dhcpFrame builds a DHCP request as a client without an address sends it (broadcast).
func dhcpFrame(mac [6]byte, typ byte, requested []byte) []byte {
	d := make([]byte, 240)
	d[0], d[1], d[2] = 1, 1, 6
	binary.BigEndian.PutUint32(d[4:8], 0x12345678)
	copy(d[28:34], mac[:])
	binary.BigEndian.PutUint32(d[236:240], 0x63825363)
	d = append(d, 53, 1, typ)
	if requested != nil {
		d = append(d, 50, 4)
		d = append(d, requested...)
	}
	d = append(d, 255)
	f := make([]byte, 42, 42+len(d))
	copy(f[0:6], []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff})
	copy(f[6:12], mac[:])
	binary.BigEndian.PutUint16(f[12:14], 0x0800)
	f[14] = 0x45
	f[23] = 17
	copy(f[30:34], []byte{255, 255, 255, 255})
	binary.BigEndian.PutUint16(f[34:36], 68)
	binary.BigEndian.PutUint16(f[36:38], 67)
	return append(f, d...)
}

func dhcpAnswer(t *testing.T, frame []byte) (byte, netip.Addr) {
	t.Helper()
	if len(frame) < 42+240 || binary.BigEndian.Uint16(frame[36:38]) != 68 {
		t.Fatalf("not a DHCP answer: % x", frame)
	}
	if checksum(frame[14:34]) != 0 {
		t.Fatal("bad IP header checksum")
	}
	d := frame[42:]
	return parseOptions(d[240:])[53][0], netip.AddrFrom4([4]byte(d[16:20]))
}

func TestDHCP(t *testing.T) {
	lan := NewLAN(netip.MustParsePrefix("192.168.77.0/24"))
	a := [6]byte{0, 0x22, 0x15, 1, 2, 3}
	b := [6]byte{0, 0x22, 0x15, 4, 5, 6}

	reply, consumed := lan.Handle(dhcpFrame(a, dhcpDiscover, nil))
	if !consumed || reply == nil {
		t.Fatal("no offer")
	}
	typ, ip := dhcpAnswer(t, reply)
	if typ != dhcpOffer || ip != netip.MustParseAddr("192.168.77.10") {
		t.Fatalf("offer: type %d, address %v", typ, ip)
	}
	if [6]byte(reply[0:6]) != a {
		t.Fatal("offer not sent to the client's MAC")
	}
	reply, _ = lan.Handle(dhcpFrame(a, dhcpRequest, ip.AsSlice()))
	if typ, got := dhcpAnswer(t, reply); typ != dhcpAck || got != ip {
		t.Fatalf("request: type %d, address %v", typ, got)
	}
	// The second PC gets the next address; asking for the first one's address is refused.
	reply, _ = lan.Handle(dhcpFrame(b, dhcpRequest, ip.AsSlice()))
	if typ, _ := dhcpAnswer(t, reply); typ != dhcpNak {
		t.Fatalf("expected NAK, got %d", typ)
	}
	reply, _ = lan.Handle(dhcpFrame(b, dhcpDiscover, nil))
	if _, got := dhcpAnswer(t, reply); got != netip.MustParseAddr("192.168.77.11") {
		t.Fatalf("second PC got %v", got)
	}

	// ARP: who has 192.168.77.1?
	arp := make([]byte, 42)
	copy(arp[0:6], []byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff})
	copy(arp[6:12], a[:])
	binary.BigEndian.PutUint16(arp[12:14], 0x0806)
	copy(arp[14:22], []byte{0, 1, 8, 0, 6, 4, 0, 1})
	copy(arp[22:28], a[:])
	copy(arp[28:32], ip.AsSlice())
	copy(arp[38:42], []byte{192, 168, 77, 1})
	reply, consumed = lan.Handle(arp)
	if consumed || reply == nil || [6]byte(reply[22:28]) != serverMAC || [6]byte(reply[0:6]) != a {
		t.Fatalf("ARP answer wrong: % x", reply)
	}
}

func TestParseLAN(t *testing.T) {
	if p, err := ParseLAN("10.1.2.3/16"); err != nil || p.String() != "10.1.0.0/16" {
		t.Fatalf("got %v %v", p, err)
	}
	if p, err := ParseLAN("off"); err != nil || p.IsValid() {
		t.Fatal("off should switch DHCP off")
	}
	for _, bad := range []string{"10.0.0.0/8", "fd00::/64", "nonsense"} {
		if _, err := ParseLAN(bad); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
}
