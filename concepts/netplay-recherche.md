# Netplay – Recherche und erster Entwurf

Ergänzung zu [browser-netplay-konzept.md](browser-netplay-konzept.md). Stand: 26.11.2026.

## Ergebnis in Kürze

- **Server:** Go, ein einzelnes statisches Programm in `netplay/` (Relay mit Räumen, Passwort,
  Rate-Limits, Ethernet-Switch). Läuft und ist getestet (`go test`).
- **Transport im ersten Schritt: WebSocket**, nicht WebTransport. Begründung unten.
- **js-dos (DOS, IPX):** lässt sich sauber anbinden, ohne js-dos zu verändern. Im Entwurf
  eingebaut; der IPX-Handshake zwischen zwei Browsern über den Relay ist getestet.
- **v86:** spricht von sich aus WebSocket mit rohen Ethernet-Frames. Eingebaut: Netzwerkkarte
  am Relay, DHCP-Server pro Raum. Getestet: zwei PCs bekommen Adressen und pingen sich an.
- **EmulatorJS:** Das eingebaute Netplay ist in 4.2 experimentell und unfertig. Stattdessen
  eigener Lockstep (`site/js/ejs-netplay.js`): gleicher Spielstand für alle, Eingaben über den
  Relay. Getestet mit NES und SNES.
- **Boxedwine:** virtuelles LAN auf Socket-Ebene über einen Patch an `boxedwine.js`
  (experimentell). UDP und ausgehendes TCP gehen; ein Server in Wine kann noch nicht antworten
  (Fehler in Boxedwine, siehe unten).

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
- Umgesetzt: Im Raum startet der PC mit einer NE2000-Karte, `relay_url` mit dem Token des
  Spielers. Die MAC-Adresse würfelt v86 selbst (00:22:15:xx:xx:xx, 24 Bit Zufall).
- Jeder Raum hat einen kleinen DHCP-Server im Relay (Netz `-lan`, Standard 192.168.77.0/24,
  Server .1, Adressen ab .10). Kein Router, kein DNS: Das LAN erreicht nur die Mitspieler.
- Test: zwei Browser booten Tiny Core (Kommandozeile), bekommen 192.168.77.10 und .11,
  `ping` geht hin und zurück (ca. 1,3 ms lokal).

### EmulatorJS 4.2.3 (Konsolen, Heimcomputer)

- Hat eingebautes Netplay: Socket.IO-Client (`src/socket.io.min.js`), Server
  `EJS_netplayUrl` (Standard `netplay.emulatorjs.org`), braucht eine numerische `EJS_gameId`.
- Prinzip: Eingaben werden pro Frame verteilt (Lockstep), kein Netzwerkverkehr der Konsole.
  Alle brauchen dasselbe ROM.
- Benutzte Socket.IO-Ereignisse: `open-room`, `join-room`, `users-updated`, `data-message`,
  `disconnect`.
- **Aber:** In 4.2.3 ist dieses Netplay nur mit `EJS_DEBUG_XX` und `EJS_EXPERIMENTAL_NETPLAY`
  sichtbar, und im Code steht „control syncing – broken“. Darauf lässt sich nicht aufbauen.
- **Umgesetzt: eigener Lockstep** in `site/js/ejs-netplay.js`, EmulatorJS bleibt unverändert:
  - Der Host schickt seinen Spielstand (gzip, in Teilen à 12 KB, mit Bestätigungen) an alle,
    deren Spiel läuft. Alle laden ihn und zählen ab da Frames.
  - Eine eigene Eingabe wirkt 4 Frames später (ca. 67 ms) und geht an die anderen. Jeder schickt
    pro Frame ein kleines Paket, auch ohne Eingabe.
  - Ein Frame läuft erst, wenn die Eingaben aller Spieler dafür da sind. Dafür gibt es in der
    Emscripten-Hauptschleife den Hook `preMainLoop` (gibt er `false` zurück, wird der Durchlauf
    übersprungen). Er wird beim Start des Cores über einen Wrapper um `window.EJS_Runtime`
    eingesetzt.
  - Alle 300 Frames vergleichen die Spieler eine Prüfsumme des Spielstands. Weicht sie ab,
    schickt der Host seinen Spielstand neu.
  - Host = Spieler 1, die anderen 2–4 in Beitrittsreihenfolge. Speicherstände, Cheats und
    Neustart sind im Raum ausgeblendet. Geht der Host, übernimmt der nächste.
- Traffic: pro Spieler 60 Pakete/s à ca. 12 Byte an jeden anderen Spieler.
- Grenzen: Alle brauchen dieselbe Datei (Name und Größe werden geprüft). Bei großer Latenz
  stockt das Spiel (Verzögerung ist fest 4 Frames). Cores, die nicht deterministisch sind oder
  keine Spielstände können, laufen auseinander.

### Boxedwine (Windows-Programme)

- Im Release 26R1.0 landen Winsock-Aufrufe im Linux-Kernel von Boxedwine und von dort in
  Emscriptens Socket-Emulation (SOCKFS): Jede Verbindung wird zu einem WebSocket zu
  `ws://ziel:port`. Ein LAN (Broadcast, Lauschen auf Ports, UDP zwischen Spielern) geht so nicht.
- **Boxedwine master** (seit Juni 2026, noch in keinem Release) hat eine eigene Netzwerkschicht
  für den Browser: `KBrowserSocketObject` im C++-Code und `project/emscripten/boxedwine-net.js`.
  Die Seite kann in `Module.boxedwineNetworking.transport` ein eigenes Objekt für die Sockets des
  Gastes übergeben (socket, bind, listen, accept, connect, send, recv, Ereignisse; ohne Transport
  nimmt Boxedwine einen WebSocket-Gateway-Server). `transport.virtualIp` wird die Adresse von eth0.
- **Umgesetzt:** RunThemAll baut Boxedwine aus einem festen master-Commit selbst
  (`scripts/build-boxedwine.mjs`, Emscripten 5.0.7, Boxedwines Makefile; Workflow „Build
  Boxedwine“), ohne Änderungen am C++-Code. `site/js/wine-net.js` ist der Transport:
  - Jeder Spieler hat die Adresse 192.168.78.n (n = Nummer im Raum vom Relay, /24).
  - UDP: Datagramme an einen Spieler oder an alle (Broadcast). TCP: connect/listen/accept mit
    kleinem Handshake über den Relay. Der Relay ist zuverlässig und hält die Reihenfolge ein,
    daher keine Sequenznummern.
  - DNS (UDP Port 53, jeder Server): Spielernamen und der eigene Hostname lösen auf die Adressen
    im Raum auf, andere Namen gibt es nicht.
  - Kein Internet: andere Adressen werden abgelehnt.
  - Boxedwine ruft den Transport immer auf dem Haupt-Thread auf (auch im Multithread-Build).
- Die Fehler im alten Socket-Code (`KNativeSocketObject::accept`: kein `connected`, Absturz bei
  NULL als Adresse; fehlende Interface-ioctls) betreffen den Web-Build von master nicht mehr.
  Die zwei accept-Fehler sind im Desktop-Build noch da und als Pull Request an Boxedwine gemeldet.
- **Test mit OpenTTD** (Host `-D` als Server, Gast verbindet über die Konsole): Client und Server
  in zwei Browsern verbinden sich, der Server schickt die Karte (ca. 88 KB).
  Danach bricht OpenTTD beim Client mit einem eigenen Absturzbericht ab
  (`EXCEPTION_ACCESS_VIOLATION` in einer Wine-Systembibliothek, aufgerufen aus OpenTTD). Boxedwine
  selbst läuft weiter; die Daten sind vollständig angekommen, der Fehler liegt in der Emulation oder
  in Wine, nicht in der Netzwerkschicht. Eine ganze OpenTTD-Partie läuft daher noch nicht.

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

## TCP/IP statt IPX?

- **js-dos (DOS): nur IPX.** Der ausgelieferte DOSBox-Kern hat keine Netzwerkkarte. Die
  DOSBox-X-Variante von js-dos hat zwar eine NE2000-Karte, aber nur mit pcap/slirp-Anschluss,
  nicht über die `Net`-Schnittstelle. Die meisten DOS-LAN-Spiele können ohnehin IPX
  (Doom, Duke Nukem 3D, Warcraft I/II, Command & Conquer, Descent, Quake …).
- **TCP/IP über v86:** v86 emuliert einen ganzen PC mit Netzwerkkarte (NE2000). Das Betriebs-
  system darin (DOS mit Paket-Treiber, Windows 9x, Linux) bringt seinen eigenen TCP/IP-Stack mit,
  der Relay transportiert nur Ethernet-Frames (Switch ist fertig). Damit gehen TCP/IP, UDP und
  auch IPX wie in einem echten LAN. Es fehlen: Anbindung auf der Seite und IP-Adressen (statisch
  pro Spieler oder ein kleiner DHCP-Server pro Raum im Relay). Nachteil: Jeder muss dasselbe
  System-Image mit dem Spiel booten (groß; Windows 98 nur mit eigener CD).
- **Boxedwine:** TCP/IP zwischen Spielern bräuchte eine Änderung an Boxedwine (siehe oben).

## Durchsatz des Relays

Gemessen auf einem PC (Ryzen 7 7800X3D, Windows, Testclients auf demselben Rechner), Details
in `netplay/README.md`:

- Ein Sender an einen Empfänger: ca. 114.000 Pakete/s (bei 1400 Byte 159 MB/s).
- Umlaufzeit durch den Relay: unter 0,6 ms.
- Spielähnlich (Räume mit 4 Spielern, je 35 Pakete/s à 100 Byte): 1000 Spieler mit Median 1 ms
  Verzögerung und ca. 1,3 CPU-Kernen; 3000 Spieler noch 99,9 % zugestellt (Median 7 ms).
- Faustregel: ein CPU-Kern ≈ 700 Spieler. Auf einem gemieteten Server ist eher die Bandbreite
  die Grenze (1000 solche Spieler ≈ 150 Mbit/s).

## Offen

1. **Wer betreibt den Standard-Relay?** GitHub Pages kann keinen Server betreiben. Ein kleiner
   VPS mit Caddy genügt. Bis dahin muss man eine Relay-Adresse eingeben.
2. Echter Spieletest mit einem IPX-Spiel (z. B. Doom-Shareware mit `ipxsetup`).
3. Neu verbinden nach „Options → Restart“ (die Seite lädt neu, der Raum ist dann weg).
4. Verzögerung beim Konsolen-Lockstep an die gemessene Latenz anpassen (statt fest 4 Frames).
5. Später: WebTransport, Ende-zu-Ende-Verschlüsselung mit einem Schlüssel, den nur die Spieler
   kennen (der Relay sieht dann nur verschlüsselte Pakete).
