# Run Them All – Spezifikation

Stand: 24.11.2026

## 1. Ziel

Run Them All ist eine statische Webseite, mit der man alte Software und Spiele direkt im Browser startet:
DOS- und Windows-Programme sowie Spiele für Heimcomputer (C64, Amiga, …) und Konsolen.
Datei, ZIP oder Ordner öffnen, Programm oder Spiel auswählen, starten. Der Nutzer soll so wenig
wie möglich tun müssen: keine Installation, keine Konfiguration, keine Konten.

Run Them All ist ein **Aggregator**. Die Emulation stammt vollständig aus fremden Open-Source-Projekten,
die unverändert eingebunden werden. Run Them All liefert nur:

- eine gemeinsame Oberfläche zum Öffnen, Auswählen und Starten,
- die automatische Erkennung, welcher Emulator für eine Datei zuständig ist,
- die Anbindung der Emulatoren (Dateien hinein, geänderte Dateien heraus),
- einen Build-Prozess, der die Emulatoren aus ihren offiziellen Releases holt.

## 2. Grundsätze

| Grundsatz | Umsetzung |
|---|---|
| Alles läuft lokal | Dateien des Nutzers werden nie hochgeladen. Sie werden im Browser gelesen und in den Speicher des Emulators kopiert. |
| Kein Backend | Reine statische Seite, lauffähig auf GitHub Pages. |
| Keine fremden Binärdateien im Repository | Emulatoren werden beim Build aus den offiziellen Releases bzw. npm-Paketen geladen (`scripts/fetch-runtimes.mjs`). |
| Upstream unverändert | Emulator-Dateien werden nicht verändert. Fehlende Teile werden nur ergänzt (z. B. Overlay mit Wine-16-Bit-Modulen). |
| Lizenzen einhalten | Zu jeder Komponente werden Lizenztext und Quellcode (bzw. Quellcode-Verweis) der verwendeten Version mit veröffentlicht. Run Them All selbst ist MIT-lizenziert. |
| Keine Datenweitergabe | Emulatoren werden so konfiguriert, dass sie ihre Dateien von der eigenen Seite laden und keine Nutzerdaten an Dritte senden. |
| Keine geschützten BIOS-Dateien | Run Them All liefert keine Original-BIOS aus. Freie Ersatz-BIOS werden genutzt, wo es sie gibt. |
| Keine Abhängigkeiten | Kein Framework und kein Build-Schritt für die Seite selbst. Node.js wird nur für die Skripte gebraucht. |

## 3. Nutzerablauf

1. **Öffnen**: per Dateiauswahl (beliebige Datei oder ZIP), Ordnerauswahl oder Drag & Drop.
   - Ein einzelnes ZIP wird im Browser entpackt.
   - Ein gemeinsamer Wurzelordner wird entfernt (`Spiel/SPIEL.EXE` wird zu `SPIEL.EXE`).
   - In Chrome/Edge wird ein Ordner über die File System Access API mit Schreibrecht geöffnet,
     in anderen Browsern über `<input webkitdirectory>` (nur lesend).
2. **Auswählen**: Liste aller startbaren Dateien mit erkanntem Typ (DOS, Windows 16-Bit,
   Windows 32-Bit, Batchdatei oder ein System wie „Commodore 64“, „Amiga“). Die wahrscheinlichste
   steht oben: flache Pfade vor tiefen, `.exe`/Spiele vor `.com` vor `.bat`, Installations- und
   Deinstallationsprogramme zuletzt. Bei Spielen zeigt ein Bereich unter der Liste das System
   (änderbar, wahrscheinlichste Kandidaten zuerst) und den BIOS-Status; eine BIOS-Datei kann dort
   hinzugefügt werden.
3. **Optionen** (aufklappbar, werden in `localStorage` gespeichert):
   - Windows: Wine-Version, Single-/Multithread, Auflösung, Farbtiefe, Laufwerk C: behalten
   - DOS: CPU-Geschwindigkeit (Zyklen)
   - Allgemein: Ton
4. **Starten**: Der passende Emulator wird geladen. Danach gibt es diese Aktionen:
   - *Geänderte Dateien sichern*: neue und geänderte Dateien als ZIP herunterladen
   - *In Ordner zurückschreiben* (nur bei Ordnern mit Schreibrecht): neue und geänderte Dateien
     in den Originalordner schreiben. Es wird nie etwas gelöscht.
   - *Vollbild*: der Emulatorbereich (`#screen`) geht per Fullscreen-API über den ganzen Bildschirm;
     Canvas bzw. Player werden dabei seitenverhältnistreu auf Bildschirmhöhe skaliert
   - *Beenden* (lädt die Seite neu)
   - Neben dem Titel zeigt ein Hinweis, welcher Emulator läuft (z. B. „Boxedwine 26R1 · Wine 6 ·
     Multithreaded“, „js-dos 8.5.4 · DOSBox“, „EmulatorJS 4.2.3 · Commodore 64 · Core vice_x64sc“).
   - Bei EmulatorJS sind *Sichern* und *Zurückschreiben* ausgeblendet; Spielstände und Savestates
     verwaltet das Menü von EmulatorJS.

### 3.1 Laden der Emulatoren

Beim Aufruf lädt der Browser nur die Oberfläche. Die Emulator-Dateien werden erst beim Start geladen,
und nur die des benötigten Emulators. Ein Ladebildschirm im Emulatorbereich zeigt die Schritte
(z. B. „Emulator herunterladen“, „Programmdateien einlesen“, „Wine starten“) und einen Fortschrittsbalken
mit Megabytes. Dazu lädt `prefetch()` (in `runner.js`) die Dateien des Emulators vorab per `fetch`
(Gesamtgröße per `HEAD`), der Emulator bekommt sie danach aus dem HTTP-Cache. Getestet: Die zweite Anfrage
überträgt nur ~300 Byte (Revalidierung). Der Ladebildschirm verschwindet, wenn der Emulator meldet,
dass er läuft (Boxedwine `Running...`, js-dos `ci-ready`, EmulatorJS `EJS_onGameStart`).

### 3.2 Demo-Starter

`demos/demos.json` listet freie Programme (Quelle, Autor, Lizenz, Startdatei, System). Das Build-Skript lädt
sie aus den Original-Releases nach `site/demos/` (optional einzelne Datei aus einem ZIP). Die Startseite zeigt
sie als Karten; „Starten“ lädt die Datei, öffnet sie wie eine Nutzerdatei, wählt Programm und System vor und
startet sofort. Quellenverzeichnis (Herkunft, Version, Download-Link, Lizenz) sowie geprüfte, aber nicht aufgenommene
Kandidaten: `demos/README.md`.

## 4. Erkennung

### 4.1 DOS- und Windows-Programme

Die Erkennung (`site/js/exe.js`) liest nur den Dateikopf.

| Merkmal | Typ | Emulator |
|---|---|---|
| Endung `.com` | DOS | js-dos |
| Kein `MZ`-Kopf (umbenannte COM-Datei) | DOS | js-dos |
| `MZ`, Relocation-Tabelle vor `0x40` | DOS | js-dos |
| `MZ` + `PE\0\0` an `e_lfanew` | Windows 32-Bit | Boxedwine |
| `MZ` + `NE` an `e_lfanew` | Windows 16-Bit | Boxedwine (immer Wine 6) |
| `MZ` + `LE`/`LX` oder unbekannt | DOS (DOS-Extender wie DOS/4GW) | js-dos |
| Endung `.bat` | Windows, wenn im Ordner Windows-Programme liegen, sonst DOS | |

### 4.2 Spiele für Konsolen und Heimcomputer

`site/js/systems.js` enthält die Systemtabelle (System, Core, Endungen, BIOS, Core-Optionen) und
`detectSystems()`. Geprüft werden nur Dateien mit bekannter Endung oder mit mehrdeutiger Endung
(`bin`, `iso`, `img`, `rom`, `cue`, `chd`, `tap`, `dsk`, `sna`, `zip`, `7z`). Bekannte BIOS-Dateien
werden nicht als Spiel gelistet. Gelesen werden die ersten 64 KB.

Reihenfolge der Erkennung:

1. Eindeutige Magic Bytes, z. B. `NES` + `0x1A` (NES), `FDS` + `0x1A`, `C64 CARTRIDGE`,
   `C64-TAPE-RAW`, `C64 tape image`, `GCR-1541`, `DMS!`/`CAPS`/`RDSK` (Amiga), `LYNX`, `ATARI7800`,
   `MV - CPC`/`EXTENDED CPC DSK`, `ZXST`, `ZXTape!` (Spectrum, bei `.cdt` CPC), `CISO` (PSP),
   die drei N64-Byte-Reihenfolgen, Nintendo-Logo an `0x104` (Game Boy), `0x04` (GBA), `0xC0` (DS),
   `SEGA 32X`/`SEGA` an `0x100` (32X/Mega Drive), SMD-Kopf.
2. CD-Abbilder: Kennungen in den ersten Sektoren (`SEGADISCSYSTEM`, `SEGA SEGASATURN`, `PSP GAME`,
   `PLAYSTATION`, 3DO-Kopf).
3. `TMR SEGA` bei `0x7FF0`/`0x3FF0`/`0x1FF0`; der Regionscode trennt Master System und Game Gear.
4. Inhalt und Größe bei Disketten (ADF 880 KB/1,76 MB mit `DOS`-Bootblock, D64-Größen).
5. Dateiendung.
6. Mehrdeutige Endungen ohne Treffer liefern mehrere Kandidaten (z. B. `.cue` → PlayStation,
   Mega-CD, Saturn, PC Engine, 3DO, PC-FX); der Nutzer wählt im Auswahlbereich.

CD-Spuren (`bin`/`img`/`iso`) in Ordnern mit `.cue` werden nicht einzeln gelistet. Gestartet wird
über die `.cue`, die mit allen referenzierten Spuren als ZIP an EmulatorJS geht.

## 5. Emulatoren

### 5.1 Windows: Boxedwine

- Quelle: GitHub-Release `26R1.0` von danoon2/Boxedwine, Datei `Boxedwine26R1Web.zip`
- Builds: Singlethreaded und Multithreaded. „Automatisch“ nimmt Multithreaded, wenn die Seite
  *cross-origin isolated* ist.
- Dateisysteme: Wine 6.0 (abgespeckt, 37 MB) und Wine 11.0 (49 MB, ohne Win16-Unterstützung)
- **Win16-Overlay**: Dem Wine-6-Dateisystem fehlen 34 16-Bit-Module (u. a. WinG, toolhelp,
  lzexpand, ole2). Das Build-Skript nimmt sie unverändert aus dem vollständigen Boxedwine-Dateisystem
  `TinyCore15Wine6.0.zip` (gleicher Build, gemeinsame Dateien sind byte-identisch) und legt sie als
  `wine6/win16-extras.zip` ab (komprimiert, ca. 385 KB). Boxedwine bindet es mit `-zip` über dem
  Wurzeldateisystem ein. Dazu kommen einzelne weitere fehlende Module, die Demos brauchen
  (`winhttp`, `jsproxy` für OpenTTD; Liste `EXTRA_MODULES` im Build-Skript).
- Nutzerdateien: im Emscripten-Dateisystem unter `/d_drive`, in Wine als Laufwerk D:
- Laufwerk C: (Wine-Prefix) optional in IndexedDB (`/root-wine6`, `/root-wine11`)
- Grenzen: kein OpenGL/Direct3D im Web-Build, kein .NET/Java

### 5.2 DOS: js-dos

- Quelle: npm-Paket `js-dos@8.5.4` (enthält emulators 8.5.3 mit DOSBox)
- Ausgeliefert: `js-dos.js/.css`, `emulators.js`, `wdosbox.js/.wasm`, `wlibzip.js/.wasm`
- Start ohne Bundle: `Dos(element, { dosboxConf, initFs, pathPrefix, kiosk: true, autoStart: true })`
- `pathPrefix` zeigt auf die eigene Seite, damit nichts vom js-dos-CDN geladen wird.
  `fsChanges: { local: false }` verhindert Speichern im Browser.
- Nutzerdateien werden Laufwerk C:. Pfade, die nicht ins DOS-8.3-Schema passen, werden auf
  Kurznamen abgebildet (`Langes Verzeichnis` → `LANGES~1`) und beim Sichern zurückübersetzt.
- Geänderte Dateien werden über `ci.fsTree()` und `ci.fsReadFile()` gelesen.

### 5.3 Konsolen und Heimcomputer: EmulatorJS

- Quelle: npm-Paket `@emulatorjs/emulatorjs` in der **neuesten stabilen Version** (npm-Tag `latest`,
  derzeit 4.2.3) und pro Core ein Paket `@emulatorjs/core-<name>` derselben Version.
- Ausgeliefert: `emulatorjs/data/` (Lader, Quellen, Lokalisierung, Entpacker) und
  `data/cores/*.data` (je Core vier Varianten: mit/ohne Threads, WebGL2/Legacy) sowie `cores/reports/`.
  Weil das npm-Paket keine minifizierten Dateien enthält, fügt das Build-Skript die Quellen in der
  Reihenfolge aus `loader.js` zu `emulator.min.js` zusammen (Inhalt unverändert).
- Ein Core pro System (35 Cores, ca. 200 MB). `dosbox_pure` wird nicht genutzt, DOS läuft über js-dos.
- Start: globale `EJS_*`-Variablen setzen und `data/loader.js` laden:
  `EJS_core` = Core-Name, `EJS_gameUrl` = `File`-Objekt des Spiels (Dateiname bleibt erhalten),
  `EJS_biosUrl` = Blob-URL eines ZIP mit allen BIOS-Dateien (EmulatorJS entpackt es; ein `File`-Objekt
  wäre hier fehlerhaft), `EJS_defaultOptions` = Core-Optionen aus der Systemtabelle,
  `EJS_language: 'de-GER'`, `EJS_startOnLoaded: true`, Netplay ausgeblendet.
- BIOS: Dateien mit passendem Namen aus dem geöffneten ZIP/Ordner werden automatisch genutzt,
  zusätzlich vom Nutzer gewählte. Fehlt ein *erforderliches* BIOS, startet das Spiel nicht und es
  erscheint ein Hinweis. Freie Ersatz-BIOS sind in den Cores enthalten: AROS-Kickstart in PUAE,
  HLE-BIOS in mGBA, melonDS, PCSX ReARMed und Yabause; die Commodore-, Sinclair- und Amstrad-ROMs
  liefern VICE, Fuse und Caprice32 selbst mit. Für Mega-CD, Atari 5200, Lynx, PC-FX, ColecoVision
  und 3DO gibt es keinen freien Ersatz.
- Core-Optionen: VICE-Systeme mit `vice_autoloadwarp: enabled` (Warp während des automatischen Ladens,
  die Laufwerksemulation bleibt originalgetreu). Ohne diese Option dauert das Laden von C64-Disketten
  mehrere Minuten.
- Credits: `emulatorjs/cores.html` wird beim Build aus den npm-Metadaten erzeugt (System, Core, Version,
  Quellcode-Repository, Lizenzdatei).
- Externe Anfrage: EmulatorJS prüft beim Start `cdn.emulatorjs.org/stable/data/version.json`
  (Versionshinweis, keine Nutzerdaten). Alle Emulator-Dateien kommen von der eigenen Seite.

### 5.4 Gemeinsame Laufzeitlogik

`site/js/runner.js` enthält die Basisklasse `Runner`:

- merkt sich beim Start Größe und CRC32 jeder Nutzerdatei,
- `changedFiles()` vergleicht den aktuellen Stand im Emulator damit,
- `downloadChanges()` erzeugt ein ZIP (eigener ZIP-Schreiber in `zip.js`),
- `writeBack()` schreibt über die File System Access API in den Originalordner,
- `supportsFileSync` gibt an, ob Sichern/Zurückschreiben möglich ist (bei EmulatorJS nicht).

## 6. Build und Auslieferung

- `scripts/fetch-runtimes.mjs` lädt alle Emulatoren nach `site/` (nicht im Git):
  `site/boxedwine/`, `site/jsdos/`, `site/emulatorjs/`, `site/coi-serviceworker.js`.
  Downloads werden in `vendor/` zwischengespeichert. ZIP und tar werden ohne externe Werkzeuge
  in Node entpackt.
- Zu jeder Komponente werden der Lizenztext und die Quellcode-Archive der verwendeten Version
  abgelegt (`*/LICENSE-*.txt`, `*/source/`). Der Footer der Seite verlinkt sie.
- `.github/workflows/pages.yml`: bei jedem Push auf `main` Skript ausführen und `site/` auf
  GitHub Pages veröffentlichen. `vendor/` wird zwischengespeichert.
- EmulatorJS wird immer in der neuesten stabilen Version geladen. Boxedwine (26R1.0) und js-dos
  (8.5.4) sind fest eingetragen, weil die Integration von ihrem Aufbau abhängt (Dateinamen im
  Release, Win16-Overlay, js-dos-API).
- Größe der veröffentlichten Seite: ca. 320 MB (Boxedwine ~105 MB, EmulatorJS ~205 MB, js-dos ~6 MB,
  Quellcode-Archive). Das Limit von GitHub Pages liegt bei 1 GB.

### Cross-Origin-Isolation

Der Multithreaded-Build von Boxedwine braucht `SharedArrayBuffer`, also die Header
`Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp`.
GitHub Pages setzt keine eigenen Header, deshalb ergänzt `coi-serviceworker` (MIT) sie im Browser.
Ohne Service Worker wird automatisch der Singlethreaded-Build genutzt.
`scripts/serve.mjs` ist ein lokaler Testserver mit diesen Headern (`--no-coi` ohne).

## 7. Dateistruktur

```
site/
  index.html, style.css     Oberfläche (CSS-Klassen mit Präfix wx-, damit js-dos/daisyUI nicht stört)
  js/app.js                 Oberflächenlogik
  js/workspace.js           Dateien, ZIPs und Ordner einlesen, Programme und Spiele finden
  js/exe.js                 Erkennung DOS/Win16/Win32
  js/systems.js             Systemtabelle und Erkennung für Konsolen/Heimcomputer
  js/runner.js              Basisklasse, Sichern und Zurückschreiben
  js/emulator.js            Boxedwine-Anbindung (WindowsRunner)
  js/dos.js                 js-dos-Anbindung (DosRunner), 8.3-Kurznamen
  js/ejs.js                 EmulatorJS-Anbindung (EmulatorJsRunner), BIOS-Übergabe
  js/zip.js                 ZIP lesen (stored/deflate) und schreiben
demos/demos.json            Demo-Programme (werden beim Build geladen)
scripts/
  fetch-runtimes.mjs        Emulatoren, Lizenzen und Quellcode laden
  serve.mjs                 lokaler Testserver
.github/workflows/pages.yml Deploy auf GitHub Pages
THIRD_PARTY_NOTICES.md      Lizenzen und Herkunft aller fremden Komponenten
```

## 8. Getestet

| Fall | Ergebnis |
|---|---|
| SkiFree (Win32) aus ZIP, Wine 6 und 11, Single- und Multithreaded | läuft |
| SkiFree aus Ordner mit Unterordner | läuft |
| Server ohne COOP/COEP (wie GitHub Pages) | Service Worker aktiviert Multithreading |
| Colonization für Windows (Win16, WinG) | läuft mit Wine 6 + Win16-Overlay |
| Selbst gebaute DOS-COM und DOS-EXE in langem Ordnernamen | laufen, `SAVE.TXT` wird mit Originalpfad gesichert |
| ZIP mit DOS- und Windows-Programmen gemischt | Typen korrekt erkannt |
| Great Giana Sisters (`.d64`, C64) | als C64 erkannt, lädt mit Warp, Intro nach ca. 45–90 s |
| Dogs of War (`.adf`, Amiga) | als Amiga erkannt, Titelbild mit freiem AROS-Kickstart |
| Demos SkiFree, ZZT, T-Rex 64, Nova the Squirrel, µCity | starten aus dem Demo-Starter |
| Ladebildschirm bei gedrosselter Verbindung (5 MB/s) | Schritte und „x von 38,5 MB“ sichtbar |
| Vollbild (T-Rex 64) | Emulatorbereich füllt den Bildschirm |

Nicht getestet: Drag & Drop, Zurückschreiben in Ordner, DOS/4GW-Programme, alle Konsolen und
übrigen Heimcomputer, BIOS-Übergabe, CD-Abbilder mit `.cue`.

## 9. Offene Punkte

### Nächste Schritte (Stand 24.11.2026)

1. **Name festlegen**: Arbeitsname ist „Run Them All“ (vorher „WebExe“). Weitere Vorschläge: „Insert Disk“,
   „RetroDrop“. Vor der Entscheidung prüfen, ob der Name auf GitHub, als Domain und als Marke frei ist.
   Bei einer Umbenennung alle Vorkommen ersetzen (Dokumentation, `site/index.html`, `package.json`,
   `scripts/*.mjs`, interne Schlüssel wie `runthemall-options`).
2. **GitHub-Repository anlegen** (leer, ohne README/Lizenz) und pushen:
   `git remote add origin https://github.com/<name>/<repo>.git` und `git push -u origin main`.
3. **GitHub Pages aktivieren**: Settings → Pages → Source „GitHub Actions“.
4. **Ersten Deploy prüfen**: Der erste Lauf dauert ca. 15 Minuten (boxedwine.org ist langsam). Danach die
   veröffentlichte Seite testen: Demos starten, Service Worker aktiviert Multithreading
   (`crossOriginIsolated`), Seitengröße unter 1 GB.
5. Der lokale Projektordner heißt noch `WebExe` und kann umbenannt werden.

### Weitere offene Punkte

- Übrige Systeme testen (Konsolen, Spectrum, CPC, CD-Abbilder, Arcade).
- Arcade-ROM-ZIPs: Ein einzeln geöffnetes ZIP wird derzeit immer entpackt; Arcade-Spiele brauchen das
  ZIP unverändert. Nur ZIPs innerhalb eines Ordners werden als Arcade-Kandidat erkannt.
- Spielstände von EmulatorJS werden im Browser (IndexedDB) gespeichert, nicht in den geöffneten Ordner.
- Amiga-Demo fehlt: Die geprüften freien Spiele laufen mit AROS nicht oder haben unklare Rechte an der Grafik
  (siehe `demos/README.md`).
