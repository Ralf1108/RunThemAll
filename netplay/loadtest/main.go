// Load test for the netplay relay. Start the relay with high limits first, e.g.
//
//	netplay -addr :8091 -msg-rate 1e9 -byte-rate 1e12 -create-rate 1e6 -join-rate 1e6 -max-rooms 100000
//
// then one of
//
//	loadtest -mode blast -rooms 1 -size 512     # one sender, one receiver, as fast as possible
//	loadtest -mode rtt   -rooms 1 -size 100     # round trip time through the relay
//	loadtest -mode game  -rooms 250 -members 4 -rate 35 -size 100   # many rooms like a game
//
// The test clients run on the same machine as the relay unless -url points elsewhere, so the
// numbers include the cost of the clients.
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

var (
	url      = flag.String("url", "ws://localhost:8091/v1", "control URL of the relay")
	mode     = flag.String("mode", "blast", "blast, rtt or game")
	rooms    = flag.Int("rooms", 1, "rooms")
	members  = flag.Int("members", 4, "players per room (game mode)")
	size     = flag.Int("size", 512, "payload bytes per packet")
	rate     = flag.Float64("rate", 35, "packets per second per player (game mode)")
	duration = flag.Duration("duration", 10*time.Second, "test time")
)

type player struct {
	conn *websocket.Conn
	peer uint32
	room string
}

func connect(ctx context.Context, hello map[string]string) (*player, error) {
	conn, _, err := websocket.Dial(ctx, *url, nil)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(1 << 20)
	b, _ := json.Marshal(hello)
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		return nil, err
	}
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return nil, err
		}
		var msg struct {
			Type, Room, Message string
			Peer                uint32
		}
		_ = json.Unmarshal(data, &msg)
		switch msg.Type {
		case "joined":
			return &player{conn: conn, peer: msg.Peer, room: msg.Room}, nil
		case "error":
			return nil, fmt.Errorf("relay: %s", msg.Message)
		}
	}
}

// room creates one room with n players.
func room(ctx context.Context, n int) ([]*player, error) {
	host, err := connect(ctx, map[string]string{"type": "create"})
	if err != nil {
		return nil, err
	}
	ps := []*player{host}
	for i := 1; i < n; i++ {
		p, err := connect(ctx, map[string]string{"type": "join", "room": host.room})
		if err != nil {
			return nil, err
		}
		ps = append(ps, p)
	}
	return ps, nil
}

func packet(to uint32, size int) []byte {
	b := make([]byte, 4+max(size, 8))
	binary.BigEndian.PutUint32(b, to)
	return b
}

func main() {
	flag.Parse()
	ctx := context.Background()
	n := 2
	if *mode == "game" {
		n = *members
	}
	all := make([][]*player, *rooms)
	start := time.Now()
	var wg sync.WaitGroup
	sem := make(chan struct{}, 32)
	var setupErr atomic.Value
	for i := range all {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			ps, err := room(ctx, n)
			if err != nil {
				setupErr.Store(err)
				return
			}
			all[i] = ps
		}(i)
	}
	wg.Wait()
	if err, _ := setupErr.Load().(error); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%d rooms x %d players connected in %v\n", *rooms, n, time.Since(start).Round(time.Millisecond))

	switch *mode {
	case "blast":
		blast(ctx, all)
	case "rtt":
		rtt(ctx, all)
	case "game":
		game(ctx, all)
	default:
		fmt.Println("unknown mode")
		os.Exit(2)
	}
}

// blast: in every room the first player sends to the second as fast as the socket allows.
func blast(ctx context.Context, all [][]*player) {
	var sent, received atomic.Int64
	tctx, cancel := context.WithTimeout(ctx, *duration)
	defer cancel()
	var wg sync.WaitGroup
	for _, ps := range all {
		a, b := ps[0], ps[1]
		wg.Add(2)
		go func() {
			defer wg.Done()
			msg := packet(b.peer, *size)
			for tctx.Err() == nil {
				if a.conn.Write(tctx, websocket.MessageBinary, msg) != nil {
					return
				}
				sent.Add(1)
			}
		}()
		go func() {
			defer wg.Done()
			for {
				_, _, err := b.conn.Read(tctx)
				if err != nil {
					return
				}
				received.Add(1)
			}
		}()
	}
	wg.Wait()
	secs := duration.Seconds()
	r := float64(received.Load())
	fmt.Printf("blast, %d B payload: sent %.0f msg/s, delivered %.0f msg/s = %.1f MB/s payload (%.1f%% delivered)\n",
		*size, float64(sent.Load())/secs, r/secs, r*float64(*size)/secs/1e6, 100*r/max(1, float64(sent.Load())))
}

// rtt: ping-pong between the two players of each room, the time is in the payload.
func rtt(ctx context.Context, all [][]*player) {
	var mu sync.Mutex
	var samples []time.Duration
	tctx, cancel := context.WithTimeout(ctx, *duration)
	defer cancel()
	var wg sync.WaitGroup
	for _, ps := range all {
		a, b := ps[0], ps[1]
		wg.Add(2)
		go func() { // b echoes everything back to a
			defer wg.Done()
			for {
				_, data, err := b.conn.Read(tctx)
				if err != nil {
					return
				}
				binary.BigEndian.PutUint32(data, a.peer)
				if b.conn.Write(tctx, websocket.MessageBinary, data) != nil {
					return
				}
			}
		}()
		go func() {
			defer wg.Done()
			msg := packet(b.peer, *size)
			for tctx.Err() == nil {
				binary.BigEndian.PutUint64(msg[4:], uint64(time.Now().UnixNano()))
				if a.conn.Write(tctx, websocket.MessageBinary, msg) != nil {
					return
				}
				_, data, err := a.conn.Read(tctx)
				if err != nil {
					return
				}
				d := time.Duration(time.Now().UnixNano() - int64(binary.BigEndian.Uint64(data[4:])))
				mu.Lock()
				samples = append(samples, d)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	report("round trip", samples, len(samples))
}

// game: every player broadcasts `rate` packets per second to the others in its room, like the
// players of a network game. Measures how many arrive and how late (one way).
func game(ctx context.Context, all [][]*player) {
	var mu sync.Mutex
	var samples []time.Duration
	var sent, received atomic.Int64
	tctx, cancel := context.WithTimeout(ctx, *duration)
	defer cancel()
	var wg sync.WaitGroup
	interval := time.Duration(float64(time.Second) / *rate)
	for _, ps := range all {
		for _, p := range ps {
			wg.Add(2)
			go func() {
				defer wg.Done()
				msg := packet(0, *size)
				t := time.NewTicker(interval)
				defer t.Stop()
				for {
					select {
					case <-tctx.Done():
						return
					case <-t.C:
					}
					binary.BigEndian.PutUint64(msg[4:], uint64(time.Now().UnixNano()))
					binary.BigEndian.PutUint32(msg, 0)
					if p.conn.Write(tctx, websocket.MessageBinary, msg) != nil {
						return
					}
					sent.Add(1)
				}
			}()
			go func() {
				defer wg.Done()
				local := make([]time.Duration, 0, 1024)
				defer func() {
					mu.Lock()
					samples = append(samples, local...)
					mu.Unlock()
				}()
				for {
					typ, data, err := p.conn.Read(tctx)
					if err != nil {
						return
					}
					if typ != websocket.MessageBinary || len(data) < 12 {
						continue
					}
					received.Add(1)
					local = append(local, time.Duration(time.Now().UnixNano()-int64(binary.BigEndian.Uint64(data[4:]))))
				}
			}()
		}
	}
	wg.Wait()
	secs := duration.Seconds()
	players := len(all) * *members
	expected := float64(sent.Load()) * float64(*members-1)
	fmt.Printf("game: %d players, %.0f packets/s sent, %.0f packets/s delivered (%.1f%% of expected), %.2f MB/s payload out\n",
		players, float64(sent.Load())/secs, float64(received.Load())/secs, 100*float64(received.Load())/max(1, expected),
		float64(received.Load())*float64(*size)/secs/1e6)
	report("one way delay", samples, len(samples))
}

func report(what string, s []time.Duration, n int) {
	if n == 0 {
		fmt.Println("no samples")
		return
	}
	slices.Sort(s)
	q := func(p float64) time.Duration { return s[min(len(s)-1, int(p*float64(len(s))))].Round(time.Microsecond) }
	fmt.Printf("%s (%d samples): median %v, p90 %v, p99 %v, max %v\n", what, n, q(.5), q(.9), q(.99), s[len(s)-1].Round(time.Microsecond))
}
