# RunThemAll netplay relay

A small server that connects emulators in different browsers to one virtual LAN. Browsers
cannot open raw TCP or UDP sockets, so every emulator sends its network packets to this relay
over a WebSocket, and the relay passes them on to the other players in the same **room**.
A room is one network segment, found by its room code and optionally protected by a password.

The relay is a pure switch: no game logic, no file storage, and **no gateway to the internet**.
Packets only go between the players of a room.

Status: **beta**. Connected: DOS games with IPX network play (js-dos), whole PCs with a network
card (v86, any protocol: TCP/IP, UDP, IPX …) and console games (EmulatorJS, shared inputs). Tested
with two browsers each; a long real game session not yet.

## Run it

One static binary, no dependencies at runtime. Build it with Go 1.24 or newer:

```sh
cd netplay
go build -o netplay .
./netplay                         # listens on :8090, plain WebSocket
```

The page is served over HTTPS, so the browser needs `wss://`. Either put the relay behind a
reverse proxy that adds TLS (Caddy, nginx, Traefik …) or give it a certificate:

```sh
./netplay -addr :443 -tls-cert fullchain.pem -tls-key privkey.pem
```

Caddy example (TLS certificate from Let's Encrypt automatically):

```
relay.example.org {
    reverse_proxy localhost:8090
}
```

Start the relay with `-trust-proxy` behind a proxy, so that rate limits use the real client IP
(from `X-Forwarded-For`).

Docker:

```sh
docker build -t runthemall-netplay netplay
docker run -p 8090:8090 runthemall-netplay
```

On the web page, open **Play together over the network**, enter the relay address
(`wss://relay.example.org`, or `ws://localhost:8090` for a local test) and create a room.

### Options

| Flag | Environment | Default | Meaning |
|---|---|---|---|
| `-addr` | `NETPLAY_ADDR` | `:8090` | listen address |
| `-tls-cert`, `-tls-key` | `NETPLAY_TLS_CERT`, `NETPLAY_TLS_KEY` | – | TLS without a reverse proxy |
| `-origins` | `NETPLAY_ORIGINS` | `*` | pages allowed to connect, e.g. `ralf1108.github.io,localhost:*` |
| `-trust-proxy` | `NETPLAY_TRUST_PROXY=1` | off | client IP from `X-Forwarded-For` |
| `-max-rooms` | | 1000 | rooms at the same time |
| `-max-members` | | 8 | players per room |
| `-max-message` | | 16384 | largest message in bytes |
| `-room-ttl` | | 12h | a room is closed after this time |
| `-msg-rate` | | 2000 | messages per second per player (bursts up to twice; more is dropped like lost packets) |
| `-byte-rate` | | 1048576 | bytes per second per player |
| `-create-rate` | | 10 | new rooms per minute per IP address |
| `-join-rate` | | 30 | join attempts per minute per IP address |
| `-lan` | `NETPLAY_LAN` | `192.168.77.0/24` | network of every room for the DHCP server (/16 to /28); `off`: no DHCP |

Every member also gets a small number in the room (`num` in `joined` and `members`: the
smallest free one from 1); the Windows netplay derives the address 192.168.78.num from it.

`GET /healthz` answers `{"ok":true,"rooms":…,"clients":…}` for monitoring.

## Protocol

### Control socket `/v1`

1. The first message is JSON text, either
   `{"type":"create","name":"Alice","password":"optional"}` or
   `{"type":"join","room":"ABCDE-FGHJK","name":"Bob","password":"…"}`.
2. The relay answers `{"type":"joined","room":"ABCDE-FGHJK","peer":123,"host":123,"token":"…"}`
   or `{"type":"error","code":"not-found|bad-password|full|busy|rate-limited","message":"…"}`.
3. Whenever somebody joins or leaves, everybody gets
   `{"type":"members","host":123,"members":[{"peer":123,"name":"Alice","host":true}, …]}`.
   The first player in the room is the host; when the host leaves, the next one becomes host.
4. **Binary messages** are packets: `[4 bytes target peer ID, big endian][payload]`; target 0
   means everybody else. They arrive as `[4 bytes sender peer ID][payload]`.
5. Text `{"type":"msg","to":0,"data":{…}}` passes small JSON messages (arrive as
   `{"type":"msg","from":123,"data":{…}}`). `{"type":"leave"}` leaves the room.

Room codes have 10 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (about 49 bits); they
can be typed in lower case and without the dash. Peer IDs are random positive 31-bit numbers.
Room passwords are kept only as a salted SHA-256 hash, in memory.

### Ethernet port `/v1/eth?token=…`

For PC emulators with a network card (v86): every binary message is one Ethernet frame. The
token comes from the `joined` message, so the port belongs to a player of the room. The room
works as a switch: it learns the MAC addresses behind the ports, sends unicast frames only to
their port and broadcast/multicast frames to all others.

Every room also has a small **DHCP server** (a virtual host with the address .1 of `-lan`, MAC
`02:52:54:41:00:01`), so the PCs get addresses without any setup: from .10 on, one per MAC
address, for the life of the room. It answers DHCP and ARP for its own address, nothing else;
there is no router and no DNS, the LAN only reaches the other players.

## Emulators

| Emulator | How it connects | State |
|---|---|---|
| js-dos 8.5 (DOSBox) | `sharedNet` option: our `Net` object (`site/js/netplay.js`) replaces js-dos' WebRTC network; the host runs the IPX server (`startIpxServer`), the others connect to its peer ID (`connectIpxAddress`) | works (IPX handshake tested) |
| v86 | NE2000 card with `net_device: { relay_url: "wss://…/v1/eth?token=…" }`, addresses from the room's DHCP server | works (two Tiny Core PCs get addresses and ping each other, ~1.3 ms) |
| EmulatorJS | lockstep in `site/js/ejs-netplay.js` over the control socket: the host's save state goes to everybody (binary chunks, gzip), every player sends its inputs for 4 frames ahead, one packet per frame; a frame runs when all inputs are there. EmulatorJS' own netplay (Socket.IO, experimental in 4.2) is not used | works (NES and SNES: the state checksums stay the same with inputs on both sides) |
| Boxedwine | the fetch script patches `boxedwine.js` so that Emscripten's sockets (SOCKFS) come from `site/js/wine-net.js`: a virtual LAN on the level of sockets, every player is 192.168.78.n (n = number in the room), TCP and UDP go as small packets over the control socket | experimental: needs the own Boxedwine build with fixes in `accept` (scripts/build-boxedwine.mjs). Tested with OpenTTD: client and server in two browsers connect, the server answers and sends the map (~85 KB); then the client's Boxedwine stops on a guest memory fault (a C++ exception the web build cannot catch, also in the official release), so a full OpenTTD game does not run yet |

## Performance

Measured with `loadtest/` on one PC (AMD Ryzen 7 7800X3D, Windows 11, loopback). The test
clients ran on the same machine and used part of the CPU; Linux is usually faster.

| Test | Result |
|---|---|
| one sender → one receiver, 64 / 512 / 1400 B packets | ~114,000 packets/s each = 7 / 59 / 159 MB/s payload |
| 8 pairs at once, 512 B | ~225,000 packets/s = 115 MB/s (saturated) |
| round trip through the relay | below 0.6 ms (p99 0.54 ms) |
| game-like: rooms of 4, every player 35 packets/s × 100 B to the 3 others | |
| – 1000 players | 100 % delivered, delay median 1.0 ms, p99 6.5 ms, relay ~1.3 CPU cores |
| – 2000 players | 100 %, median 2.0 ms, p99 16 ms, ~2.8 cores |
| – 3000 players | 99.9 %, median 6.9 ms, p99 44 ms, ~4.3 cores |
| – 4000 players | overloaded (with the test clients on the same machine): 91 %, median 265 ms |

So one relay core carries roughly 70,000 delivered packets per second, about 700 players of a
game like this. On a rented server the network is usually the limit first: such a player needs
about 10 KB/s down and 3.5 KB/s up (plus TCP/WebSocket overhead, about half again for 100 B
packets), 1000 players about 150 Mbit/s.

Over the limits a player's packets are dropped (the relay never blocks); a receiver that reads
too slowly loses packets from its queue of 256.

```sh
netplay -addr :8091 -msg-rate 1e9 -byte-rate 1e12 -create-rate 1e6 -join-rate 1e6 -max-rooms 100000
go run ./loadtest -mode game -rooms 250 -members 4 -rate 35 -size 100
```

## Development

```sh
go vet ./... && go test ./...
```

The tests start the relay in-process and check rooms, passwords, limits, packets and the switch.
