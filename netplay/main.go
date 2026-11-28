// RunThemAll netplay relay: connects emulators in different browsers to one virtual LAN.
//
// Browsers cannot open raw TCP/UDP sockets, so every emulator sends its network packets
// to this relay over a WebSocket and the relay passes them on to the other members of the
// same room. It is a pure relay: no game logic and no gateway to the internet.
//
// Run it with defaults (port 8090, plain WebSocket behind a TLS reverse proxy):
//
//	netplay
//
// or with its own certificate:
//
//	netplay -addr :443 -tls-cert fullchain.pem -tls-key privkey.pem
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// Version is set at build time (-ldflags "-X main.Version=...").
var Version = "dev"

func main() {
	cfg := DefaultConfig()
	flag.StringVar(&cfg.Addr, "addr", envOr("NETPLAY_ADDR", cfg.Addr), "listen address")
	flag.StringVar(&cfg.TLSCert, "tls-cert", os.Getenv("NETPLAY_TLS_CERT"), "TLS certificate file (optional; without it a reverse proxy should add TLS)")
	flag.StringVar(&cfg.TLSKey, "tls-key", os.Getenv("NETPLAY_TLS_KEY"), "TLS key file")
	origins := flag.String("origins", envOr("NETPLAY_ORIGINS", "*"), "allowed page origins, comma separated host patterns (e.g. ralf1108.github.io,localhost:*), * for all")
	flag.BoolVar(&cfg.TrustProxy, "trust-proxy", os.Getenv("NETPLAY_TRUST_PROXY") == "1", "take the client IP from X-Forwarded-For (only behind a reverse proxy)")
	flag.IntVar(&cfg.MaxRooms, "max-rooms", cfg.MaxRooms, "rooms at the same time")
	flag.IntVar(&cfg.MaxMembers, "max-members", cfg.MaxMembers, "members per room")
	flag.IntVar(&cfg.MaxMessage, "max-message", cfg.MaxMessage, "largest message in bytes")
	flag.DurationVar(&cfg.RoomTTL, "room-ttl", cfg.RoomTTL, "a room is closed after this time")
	flag.Float64Var(&cfg.MsgPerSec, "msg-rate", cfg.MsgPerSec, "messages per second per player (more are dropped)")
	flag.Float64Var(&cfg.BytePerSec, "byte-rate", cfg.BytePerSec, "bytes per second per player (more are dropped)")
	flag.Float64Var(&cfg.CreatePerMin, "create-rate", cfg.CreatePerMin, "new rooms per minute per IP address")
	flag.Float64Var(&cfg.JoinPerMin, "join-rate", cfg.JoinPerMin, "join attempts per minute per IP address")
	flag.IntVar(&cfg.Guard.MaxConnsPerIP, "max-conns-per-ip", cfg.Guard.MaxConnsPerIP, "open connections per IP address (IPv6: per /64), 0: no limit")
	flag.Float64Var(&cfg.Guard.ConnPerMin, "conn-rate", cfg.Guard.ConnPerMin, "new connections per minute per IP address")
	flag.IntVar(&cfg.Guard.BanStrikes, "ban-strikes", cfg.Guard.BanStrikes, "strikes (rate limits hit, wrong passwords, flooding …) within -ban-window that ban an address, 0: never ban")
	flag.DurationVar(&cfg.Guard.BanWindow, "ban-window", cfg.Guard.BanWindow, "time in which -ban-strikes lead to a ban")
	flag.DurationVar(&cfg.Guard.BanTime, "ban-time", cfg.Guard.BanTime, "length of the first ban; every further ban within a day is twice as long")
	flag.DurationVar(&cfg.Guard.BanMax, "ban-max", cfg.Guard.BanMax, "longest ban")
	bans := flag.String("ban", os.Getenv("NETPLAY_BAN"), "always refused: IP addresses or networks, comma separated (e.g. 203.0.113.7,198.51.100.0/24)")
	exempt := flag.String("ban-exempt", os.Getenv("NETPLAY_BAN_EXEMPT"), "never limited or banned: IP addresses or networks, comma separated")
	lan := flag.String("lan", envOr("NETPLAY_LAN", cfg.LAN.String()), "network of every room, the relay hands out addresses by DHCP (PCs with a network card); off: no DHCP")
	showVersion := flag.Bool("version", false, "print the version")
	flag.Parse()
	if *showVersion {
		fmt.Println(Version)
		return
	}
	cfg.Origins = splitList(*origins)
	var err error
	if cfg.LAN, err = ParseLAN(*lan); err != nil {
		log.Fatal(err)
	}
	if cfg.Guard.Bans, err = ParsePrefixes(*bans); err != nil {
		log.Fatal("-ban: ", err)
	}
	if cfg.Guard.BanExempt, err = ParsePrefixes(*exempt); err != nil {
		log.Fatal("-ban-exempt: ", err)
	}

	hub := NewHub(cfg)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           hub.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go hub.Janitor(ctx)

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	log.Printf("netplay %s listening on %s (origins: %s)", Version, cfg.Addr, strings.Join(cfg.Origins, ","))
	if cfg.TLSCert != "" {
		err = srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
	} else {
		err = srv.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
