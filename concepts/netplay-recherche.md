# Netplay – Recherche und erster Entwurf

Ergänzung zu [browser-netplay-konzept.md](browser-netplay-konzept.md). Stand: 26.11.2026.

## Ergebnis in Kürze

- **Server:** Go, ein einzelnes statisches Programm in `netplay/` (Relay mit Räumen, Passwort,
  Rate-Limits, Ethernet-Switch). Läuft und ist getestet (`go test`).
- **Transport im ersten Schritt: WebSocket**, nicht WebTransport. Begründung unten.
- **js-dos (DOS, IPX):** lässt sich sauber anbinden, ohne js-dos zu verändern. Im Entwurf
  eingebaut; der IPX-Handshake zwischen zwei Browsern über den Relay ist getestet.
- **v86:** spricht von sich aus WebSocket mit rohen Ethernet-Frames → Relay-Seite fertig
  (Switch mit MAC-Learning), Seite noch nicht angebunden.
- **EmulatorJS:** hat eigenes Netplay (Eingaben synchronisieren) über Socket.IO; anbindbar
  über einen kleinen Ersatz für `io()`. Noch nicht gemacht.
- **Boxedwine:** am schwierigsten, braucht eine Änderung an Boxedwine selbst.

## Die Emulatoren im Einzelnen

### js-dos 8.5.4 (DOSBox)

- js-dos bringt IPX-Netzwerk mit. Seit 8.5 läuft das über eine austauschbare JavaScript-
  Schnittstelle `Net` (Quellcode `emulators-8.5.3/src/protocol/protocol.ts`): `peerId`,
  `sendBinary(daten, peerId)`, `recvBinary()` (wird alle 16 ms abgefragt), `queryAliases` usw.
- Standardmäßig steckt dahinter js-dos' eigenes WebRTC-Netz (HumbleNet, `webrtcnet.wasm`,
  Signaling über `net.dos.zone`). Die Player-Option **`sharedNet`** ersetzt es durch ein eigenes
  Objekt → genau unsere Stelle.
- Ablauf: Der **Host** startet mit `startIpxServer: true`, DOSBox betreibt dann den IPX-Server
  selbst. **Gäste** starten mit `connectIpxAddress: "<Peer-ID des Hosts>"`, ihr DOSBox meldet
  sich beim Host an (30-Byte-Anmeldepaket, Antwort mit der IPX-Adresse).
- Für den Relay heißt das: Er muss IPX gar nicht verstehen, er leitet nur Pakete zwischen
  Peer-IDs weiter. MAC-Learning braucht es für DOS nicht.
- In der DOSBox-Konfiguration muss `[ipx] ipx=true` stehen (macht `dos.js` im Raum).
- Einschränkung: Der Host muss zuerst starten; Gäste warten beim Anmelden max. 15 Sekunden.

### v86 (PC mit Netzwerkkarte)

- Option `net_device: { relay_url: "wss://…" }` (oder `network_relay_url`): v86 öffnet selbst
  einen WebSocket und schickt jeden Ethernet-Frame als eine Binärnachricht (Protokoll wie
  „websockproxy“). Daneben gibt es `fetch`, `inbrowser` und `wisp://` – für LAN nicht nötig.
- Relay: Endpunkt `/v1/eth?token=…`, der Raum arbeitet als Switch (MAC-Adressen lernen,
  Unicast gezielt, Broadcast/Multicast an alle). Fertig und getestet.
- Offen auf der Seite: `relay_url` mit Token beim Start setzen, eindeutige MAC pro Spieler,
  IP-Adressen (statisch oder ein kleiner DHCP im Relay pro Raum).

### EmulatorJS 4.2.3 (Konsolen, Heimcomputer)

- Hat eingebautes Netplay: Socket.IO-Client (`src/socket.io.min.js`), Server
  `EJS_netplayUrl` (Standard `netplay.emulatorjs.org`), braucht eine numerische `EJS_gameId`.
- Prinzip: Eingaben werden pro Frame verteilt (Lockstep), kein Netzwerkverkehr der Konsole.
  Alle brauchen dasselbe ROM.
- Benutzte Socket.IO-Ereignisse: `open-room`, `join-room`, `users-updated`, `data-message`,
  `disconnect`. Statt einen Socket.IO-Server nachzubauen, reicht ein kleiner Ersatz für
  `window.io`, der diese Ereignisse über unseren Steuerkanal (JSON-Nachrichten `msg`) schickt.
- Qualität hängt vom EmulatorJS-Netplay selbst ab (Verzögerung, Determinismus des Cores).

### Boxedwine (Windows-Programme)

- Winsock-Aufrufe landen im Linux-Kernel von Boxedwine und von dort in Emscriptens
  Socket-Emulation (SOCKFS): Jede Verbindung wird zu einem WebSocket zu `ws://ziel:port`.
- Damit gehen höchstens ausgehende TCP-Verbindungen über einen Proxy. Ein LAN (Broadcast zum
  Finden von Spielen, Lauschen auf Ports, UDP zwischen Spielern) geht so nicht.
- Für LAN müsste Boxedwine seine Sockets an eine eigene virtuelle Netzwerkschicht geben
  (Änderung im C++-Code, eigener Build). Eher ein späteres Projekt.

### Modem/Nullmodem

- DOSBox kann serielle Ports über TCP tunneln (`serial1=nullmodem`), in js-dos aber nicht über
  `Net` angebunden. Nicht weiter verfolgt.

## Warum zuerst WebSocket statt WebTransport

| | WebSocket | WebTransport |
|---|---|---|
| Emulatoren | v86 spricht es direkt; js-dos ist egal (eigene `Net`-Schicht) | für keinen Emulator direkt nutzbar |
| Browser | alle | Chrome/Edge und Firefox; Safari erst in neuen Versionen (vor Einsatz prüfen) |
| Hosting | läuft hinter jedem Reverse Proxy (Caddy, nginx, Cloudflare), Port 443/TCP | braucht HTTP/3, UDP/443 offen, Proxy-Unterstützung selten |
| Latenz | bei Paketverlust kurze Hänger (TCP) | besser bei Verlust (Datagramme) |

- IPX-Spiele schicken wenige, kleine Pakete (einige KB/s). Bei normalen Verbindungen merkt man
  den TCP-Nachteil kaum.
- Für andere Hoster ist WebSocket viel einfacher (ein Reverse Proxy mit Let's Encrypt genügt).
- Das Nachrichtenformat ist so gewählt, dass später **WebTransport als zweiter Transport** im
  selben Server dazukommen kann (`quic-go/webtransport-go`), mit WebSocket als Rückfall.

## Programmiersprache: Go

- **Go**: ein statisches Programm für Linux/Windows/macOS/ARM ohne Laufzeit, Cross-Compile mit
  einem Befehl, kleines Docker-Image (`FROM scratch`). WebSocket (`coder/websocket`) und
  WebTransport (`quic-go`) sind ausgereift. Goroutinen passen genau zu „ein Client, eine
  Schleife“. Für andere Hoster gut lesbar und leicht selbst zu bauen.
- **Rust** (`tokio`, `wtransport`): etwas weniger Speicher und keine GC-Pausen, aber längere
  Entwicklungszeit, langsamere Builds, höhere Einstiegshürde für Mitwirkende.
- Ein Relay ist durch Netzwerk und Weiterleiten begrenzt, nicht durch Rechenleistung. Bei
  einigen KB/s pro Spieler schafft ein kleiner Go-Server tausende Spieler. Der
  Geschwindigkeitsvorteil von Rust spielt hier keine Rolle.

## Erster Entwurf (umgesetzt)

- `netplay/` – Go-Relay: Räume mit Code (10 Zeichen, ca. 49 Bit) und optionalem Passwort
  (gesalzener Hash, nur im Speicher), Host = erster im Raum, Weitergabe von Paketen an eine
  Peer-ID oder alle, JSON-Nachrichten, Ethernet-Switch, Rate-Limits pro IP und pro Spieler,
  Räume schließen bei leer oder nach 12 h, `/healthz`, Dockerfile, Optionen per Flag/Umgebung.
- `site/js/netplay.js` – Browser-Client und `Net`-Adapter für js-dos.
- `site/js/lobby.js` – Lobby auf der Startseite: Relay-Adresse, Name, Raum erstellen (mit
  Passwort), beitreten, Link teilen (`?room=…&relay=…`, Web Share API oder Zwischenablage),
  Teilnehmerliste, Verlassen. Im Raum zeigt die Toolbar „Room … · host/guest · n players“.
- Test: zwei getrennte Browser, Raum erstellen und beitreten, beide starten DOSBox → das
  IPX-Anmeldepaket geht über den Relay zum Host und die Antwort zurück.

## Offen

1. **Wer betreibt den Standard-Relay?** GitHub Pages kann keinen Server betreiben. Ein kleiner
   VPS mit Caddy genügt. Bis dahin muss man eine Relay-Adresse eingeben.
2. Echter Spieletest mit einem IPX-Spiel (z. B. Doom-Shareware mit `ipxsetup`).
3. Neu verbinden nach „Options → Restart“ (die Seite lädt neu, der Raum ist dann weg).
4. v86 auf der Seite anbinden, danach EmulatorJS.
5. Später: WebTransport, Ende-zu-Ende-Verschlüsselung mit einem Schlüssel, den nur die Spieler
   kennen (der Relay sieht dann nur verschlüsselte Pakete).
