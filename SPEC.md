# WebExe – Spezifikation

Stand: 24.11.2026 (vor der Integration von EmulatorJS)

## 1. Ziel

WebExe ist eine statische Webseite, mit der man alte Software direkt im Browser startet:
Datei, ZIP oder Ordner öffnen, Programm auswählen, starten. Der Nutzer soll so wenig wie
möglich tun müssen: keine Installation, keine Konfiguration, keine Konten.

WebExe ist ein **Aggregator**. Die Emulation stammt vollständig aus fremden Open-Source-Projekten,
die unverändert eingebunden werden. WebExe liefert nur:

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
| Lizenzen einhalten | Zu jeder GPL-Komponente werden Lizenztext und Quellcode der genau verwendeten Version mit veröffentlicht. WebExe selbst ist MIT-lizenziert. |
| Keine Datenweitergabe | Emulatoren werden so konfiguriert, dass sie ihre Dateien von der eigenen Seite laden und nichts an Dritte senden. |
| Keine Abhängigkeiten | Kein Framework und kein Build-Schritt für die Seite selbst. Node.js wird nur für die Skripte gebraucht. |

## 3. Nutzerablauf

1. **Öffnen**: per Dateiauswahl (EXE, COM, BAT oder ZIP), Ordnerauswahl oder Drag & Drop.
   - Ein einzelnes ZIP wird im Browser entpackt.
   - Ein gemeinsamer Wurzelordner wird entfernt (`Spiel/SPIEL.EXE` wird zu `SPIEL.EXE`).
   - In Chrome/Edge wird ein Ordner über die File System Access API mit Schreibrecht geöffnet,
     in anderen Browsern über `<input webkitdirectory>` (nur lesend).
2. **Auswählen**: Liste aller startbaren Dateien mit erkanntem Typ (DOS, Windows 16-Bit,
   Windows 32-Bit, Batchdatei). Die wahrscheinlichste steht oben: flache Pfade vor tiefen,
   `.exe` vor `.com` vor `.bat`, Installations- und Deinstallationsprogramme zuletzt.
3. **Optionen** (aufklappbar, werden in `localStorage` gespeichert):
   - Windows: Wine-Version, Single-/Multithread, Auflösung, Farbtiefe, Laufwerk C: behalten
   - DOS: CPU-Geschwindigkeit (Zyklen)
   - Allgemein: Ton
4. **Starten**: Der passende Emulator wird geladen. Danach gibt es diese Aktionen:
   - *Geänderte Dateien sichern*: neue und geänderte Dateien als ZIP herunterladen
   - *In Ordner zurückschreiben* (nur bei Ordnern mit Schreibrecht): neue und geänderte Dateien
     in den Originalordner schreiben. Es wird nie etwas gelöscht.
   - *Vollbild*, *Beenden* (lädt die Seite neu)

## 4. Erkennung des Programmtyps

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

## 5. Emulatoren

### 5.1 Windows: Boxedwine

- Quelle: GitHub-Release `26R1.0` von danoon2/Boxedwine, Datei `Boxedwine26R1Web.zip`
- Builds: Singlethreaded und Multithreaded. „Automatisch“ nimmt Multithreaded, wenn die Seite
  *cross-origin isolated* ist.
- Dateisysteme: Wine 6.0 (abgespeckt, 37 MB) und Wine 11.0 (49 MB, ohne Win16-Unterstützung)
- **Win16-Overlay**: Dem Wine-6-Dateisystem fehlen 34 16-Bit-Module (u. a. WinG, toolhelp,
  lzexpand, ole2). Das Build-Skript nimmt sie unverändert aus dem vollständigen Boxedwine-Dateisystem
  `TinyCore15Wine6.0.zip` (gleicher Build, gemeinsame Dateien sind byte-identisch) und legt sie als
  `wine6/win16-extras.zip` ab (komprimiert, 272 KB). Boxedwine bindet es mit `-zip` über dem
  Wurzeldateisystem ein.
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

### 5.3 Gemeinsame Laufzeitlogik

`site/js/runner.js` enthält die Basisklasse `Runner`:

- merkt sich beim Start Größe und CRC32 jeder Nutzerdatei,
- `changedFiles()` vergleicht den aktuellen Stand im Emulator damit,
- `downloadChanges()` erzeugt ein ZIP (eigener ZIP-Schreiber in `zip.js`),
- `writeBack()` schreibt über die File System Access API in den Originalordner.

## 6. Build und Auslieferung

- `scripts/fetch-runtimes.mjs` lädt alle Emulatoren nach `site/` (nicht im Git):
  `site/boxedwine/`, `site/jsdos/`, `site/coi-serviceworker.js`.
  Downloads werden in `vendor/` zwischengespeichert. ZIP und tar werden ohne externe Werkzeuge
  in Node entpackt.
- Zu jeder Komponente werden der Lizenztext und die Quellcode-Archive der verwendeten Version
  abgelegt (`*/LICENSE-GPL-2.0.txt`, `*/source/`). Der Footer der Seite verlinkt sie.
- `.github/workflows/pages.yml`: bei jedem Push auf `main` Skript ausführen und `site/` auf
  GitHub Pages veröffentlichen. `vendor/` wird zwischengespeichert.
- Versionen sind derzeit fest eingetragen (Boxedwine 26R1.0, js-dos 8.5.4), weil die
  Integration davon abhängt (Dateinamen im Release, Win16-Overlay, Kurzname-Logik).

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
  js/workspace.js           Dateien, ZIPs und Ordner einlesen, Programme finden und bewerten
  js/exe.js                 Erkennung DOS/Win16/Win32
  js/runner.js              Basisklasse, Sichern und Zurückschreiben
  js/emulator.js            Boxedwine-Anbindung (WindowsRunner)
  js/dos.js                 js-dos-Anbindung (DosRunner), 8.3-Kurznamen
  js/zip.js                 ZIP lesen (stored/deflate) und schreiben
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

Nicht getestet: Drag & Drop, Zurückschreiben in Ordner, DOS/4GW-Programme.

## 9. Geplant

Integration von EmulatorJS für Konsolen und Heimcomputer (C64, Amiga, NES, SNES, Game Boy usw.)
mit Erkennung über Dateiendung und Magic Bytes, siehe nächster Abschnitt nach Umsetzung.
