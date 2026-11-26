# Browser-Netplay für Emulatoren – Konzept-Zusammenfassung

## Ziel
Zwei oder mehr Spieler starten auf der Webseite denselben Emulator (aktuell eingebunden: **js-dos**, **Boxedwine**) und spielen über ein virtuelles LAN miteinander, ohne lokale Installation. Ein externer Relay-Server verbindet die Clients. Der **Raumcode** entspricht dabei einem eigenen **Netzwerksegment**.

## Grundproblem: Browser-Beschränkungen
- Browser dürfen keine rohen TCP- oder UDP-Sockets öffnen. Die Direct Sockets API gibt es nur für Chrome Isolated Web Apps, sie ist also keine Option.
- Darum brauchen wir einen **Relay-Server**. Jeder Emulator schickt seine Netzwerkpakete dorthin, und der Server leitet sie an die anderen Clients im selben Raum weiter (virtueller Hub/Switch).

## Transport-Optionen (Vergleich)
| Option | Charakter | Bewertung |
|---|---|---|
| WebSocket | TCP, zuverlässig, geordnet | Am einfachsten, aber Head-of-Line-Blocking bei Paketverlust |
| WebRTC DataChannel | P2P, unzuverlässig konfigurierbar | Geringe Latenz, braucht aber Signaling + STUN/TURN |
| **WebTransport (HTTP/3)** | QUIC, unzuverlässige **Datagramme** + Streams | **Gewählt**: modern, UDP-artig, Client-Server passt zum Relay-Modell |

### Wichtige Punkte zu WebTransport
- **Datagramm-Größe:** QUIC-Datagramme sind auf etwa 1200 Byte begrenzt (MTU), ein Ethernet-Frame hat aber bis zu 1514 Byte. Darum große Frames fragmentieren oder über einen (unidirektionalen) Stream schicken. IPX-Pakete sind meist kleiner, trotzdem müssen wir das einplanen.
- **TLS-Pflicht:** Wir brauchen ein gültiges Zertifikat. Für die lokale Entwicklung gibt es `serverCertificateHashes` (selbst signiert, max. 14 Tage gültig).
- **UDP/443** muss beim Hoster bzw. in der Firewall offen sein.
- **Fallback:** Manche Netze blockieren UDP. Optional später ein WebSocket-Fallback mit demselben Nachrichtenformat.
- **Browser-Support** vor dem Start prüfen, vor allem Safari/iOS.

## Server
- Ein reiner Dienst-Server (Relay), keine Spiellogik.
- **Sprache: Go** mit `quic-go` / `webtransport-go` (ausgereift, schnell gebaut). Alternative wäre Rust mit `wtransport`.
- Funktionen:
  - `join(raumcode, passwort?)`, danach ist der Client Mitglied des Raums.
  - Binäre Nachrichten an alle anderen im **selben** Raum senden (Broadcast).
  - Bei Ethernet-Frames **MAC-Adressen lernen** (Switch-Verhalten): Unicast nur an das Ziel, Broadcast/Multicast an alle.
  - Optional: DHCP bzw. IP-Vergabe pro Raum für TCP/IP-Spiele.
  - **Kein Gateway ins Internet**: Pakete werden nur zwischen den Clients weitergeleitet, sonst wäre das ein offener Proxy.

## Lobby (Webseite)
- Raum erstellen: Es wird ein zufälliger Raumcode erzeugt, optional mit Passwort.
- Raum beitreten: Raumcode und ggf. Passwort eingeben.
- Teilen: Code bzw. Link per Copy & Paste, WhatsApp usw. (z. B. Web Share API).
- Anzeige der Teilnehmer im Raum.

## Sicherheit / Missbrauchsschutz
- Raumcodes mit genug Entropie (nicht durchprobierbar).
- **Rate-Limiting pro IP** für Join-Versuche und Raum-Erstellung.
- Optionales **Passwort** pro Raum, serverseitig gehasht.
- Limits: max. Clients pro Raum, max. Paketrate/Bandbreite pro Client, Räume laufen nach Inaktivität ab.

## Anbindung der Emulatoren (offen – Recherche nötig)
Je nach Emulator relayen wir auf einer anderen Ebene:
- **js-dos / DOSBox:** **IPX** ist am einfachsten. DOSBox tunnelt IPX ohnehin über UDP. js-dos bringt eigenes Networking mit. Zu klären: Lässt sich der Transport auf unseren WebTransport-Relay umbiegen, und in welchem Format?
- **Boxedwine:** Zu klären, ob und wie Netzwerk/Sockets nach außen geführt werden (Winsock über einen JS-Hook?).
- **PC-Emulatoren mit NIC (v86, QEMU-WASM):** rohe Ethernet-Frames, eindeutige MAC pro Client, IP per DHCP oder statisch.
- **Modem/Nullmodem-Spiele:** den Bytestrom des seriellen Ports weiterleiten.
- **Konsolen (EmulatorJS/RetroArch):** anderes Prinzip. Es werden nur Eingaben synchronisiert (Lockstep/Rollback), kein Netzwerkverkehr. Dafür braucht es dasselbe ROM und Determinismus.

## Stolperfallen (Status)
- Mixed Content: HTTPS, und WebTransport ist ohnehin TLS. Erledigt.
- Hintergrund-Tabs werden gedrosselt: irrelevant, weil der Tab beim Spielen im Vordergrund ist.
- COOP/COEP für SharedArrayBuffer: schon vorhanden.
- Bandbreite: wenige KB/s pro Client erwartet, wird getestet.

## Nächste Schritte
1. Recherche: Netzwerk-Schnittstellen von js-dos und Boxedwine.
2. Go-Relay-Prototyp: WebTransport, Räume, Broadcast, MAC-Learning.
3. Browser-Brücke Emulator ↔ WebTransport (inkl. Fragmentierung großer Frames).
4. Lobby-UI: Raum erstellen/beitreten, Code teilen, Passwort.
5. Rate-Limiting, Limits, Raum-Timeout.
6. Test mit einem IPX-Spiel unter js-dos.
