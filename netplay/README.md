# RunThemAll netplay relay

A small server that connects emulators in different browsers to one virtual LAN. Browsers
cannot open raw TCP or UDP sockets, so every emulator sends its network packets to this relay
over a WebSocket, and the relay passes them on to the other players in the same **room**.
A room is one network segment, found by its room code and optionally protected by a password.

The relay is a pure switch: no game logic, no file storage, and **no gateway to the internet**.
Packets only go between the players of a room.

Status: **first draft (beta)**. DOS games with IPX network play (js-dos) work through it; the
handshake is tested end to end, a full game session not yet.

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

Fixed limits (see `DefaultConfig` in `relay.go`): per player 2000 messages and 1 MB per second
(more is dropped like lost packets); per IP 10 new rooms and 30 join attempts per minute.

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

## Emulators

| Emulator | How it connects | State |
|---|---|---|
| js-dos 8.5 (DOSBox) | `sharedNet` option: our `Net` object (`site/js/netplay.js`) replaces js-dos' WebRTC network; the host runs the IPX server (`startIpxServer`), the others connect to its peer ID (`connectIpxAddress`) | works (IPX handshake tested) |
| v86 | `net_device: { relay_url: "wss://…/v1/eth?token=…" }` | relay side ready (switch tested), page side not yet |
| EmulatorJS | its netplay uses Socket.IO events (`open-room`, `join-room`, `data-message`); a small `io()` replacement on top of the control socket would be enough | not yet |
| Boxedwine | Winsock goes to Emscripten's socket emulation; a LAN needs a change in Boxedwine | not yet |

## Development

```sh
go vet ./... && go test ./...
```

The tests start the relay in-process and check rooms, passwords, limits, packets and the switch.
