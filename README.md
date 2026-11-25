# Run Them All

**Alte DOS- und Windows-Programme, C64-, Amiga- und Konsolenspiele direkt im Browser starten.
Ohne Installation, ohne Upload.**

Datei, ZIP oder Ordner öffnen, Programm oder Spiel auswählen, starten. Run Them All erkennt selbst, welcher
Emulator gebraucht wird, und lädt ihn. Alles läuft lokal im Browser: Deine Dateien verlassen
deinen Rechner nicht.

Run Them All ist ein **Aggregator**: Die eigentliche Emulation stammt aus großartigen Open-Source-Projekten
(siehe [Credits](#credits)). Run Them All sorgt nur für eine gemeinsame, einfache Oberfläche und bindet
die Emulatoren aus ihren offiziellen Releases ein.

## Was läuft?

| Programmtyp | Erkannt an | Emulator |
|---|---|---|
| DOS (`.com`, `.exe` nur mit MZ-Kopf, DOS/4GW-Spiele) | Dateikopf | [js-dos](https://js-dos.com) (DOSBox) |
| Windows 3.x (16 Bit) | NE-Kopf | [Boxedwine](https://github.com/danoon2/Boxedwine) mit Wine 6 |
| Windows 95 bis XP (32 Bit) | PE-Kopf | Boxedwine mit Wine 6 oder 11 |
| `.bat` | Windows, wenn Windows-Programme danebenliegen, sonst DOS | |
| Konsolen und Heimcomputer (s. u.) | Dateiendung und Magic Bytes | [EmulatorJS](https://emulatorjs.org) mit libretro-Cores |
| Komplette Betriebssysteme: CD-Images (`.iso`), Disketten und Festplatten (`.img`, `.ima`, `.vhd`) | Bootsektor bzw. El-Torito-Kennung, Button „Eigenes Betriebssystem starten“ | [v86](https://github.com/copy/v86) (x86-PC mit SeaBIOS) |

### Konsolen und Heimcomputer

| System | Dateien | BIOS |
|---|---|---|
| Commodore 64 / 128 / VIC-20 / Plus/4 / PET | `.d64` `.g64` `.t64` `.prg` `.crt` `.tap` … | im Core enthalten |
| Amiga | `.adf` `.dms` `.ipf` `.hdf` `.lha` | freier AROS-Kickstart im Core, Original-Kickstart optional |
| ZX Spectrum, ZX81, Amstrad CPC | `.tzx` `.z80` `.sna` `.p` `.dsk` `.cdt` | im Core enthalten |
| NES, SNES, Game Boy (Color), Game Boy Advance, Nintendo DS, N64, Virtual Boy | `.nes` `.sfc` `.gb` `.gba` `.nds` `.z64` … | nicht nötig (GBA/DS: freier Ersatz im Core) |
| Master System, Game Gear, Mega Drive, 32X | `.sms` `.gg` `.md` `.32x` … | nicht nötig |
| PlayStation, Saturn, PSP | `.cue` `.chd` `.pbp` `.cso` … | freier HLE-Ersatz im Core |
| Atari 2600 / 7800 / Jaguar, PC Engine, Neo Geo Pocket, WonderSwan | `.a26` `.a78` `.j64` `.pce` `.ngp` `.ws` … | nicht nötig |
| Mega-CD, Atari 5200, Lynx, PC-FX, ColecoVision, 3DO | | **Original-BIOS nötig**, kein freier Ersatz verfügbar |
| Arcade (FBNeo, MAME 2003-Plus) | ROM-ZIPs | je nach Spiel |

Ist die Erkennung nicht eindeutig (z. B. `.bin`, `.iso`, `.tap`), wird das wahrscheinlichste System
vorgeschlagen und lässt sich ändern. BIOS-Dateien werden automatisch benutzt, wenn sie mit im ZIP
oder Ordner liegen, oder lassen sich vor dem Start hinzufügen. Run Them All liefert selbst keine
urheberrechtlich geschützten BIOS-Dateien aus.

Getestet sind bisher C64 und Amiga; die übrigen Systeme sind eingebunden, aber noch ungetestet.

## Funktionen

- **Demos** unter „Programm öffnen“: freie Programme, Spiele und Betriebssysteme, je Plattform eine Kachel mit
  Symbol in einem seitlich scrollbaren Karussell; mit einem Klick starten, Optionen pro Demo (vollständige Liste in [demos/](demos/README.md))
- Emulatoren werden erst beim Start geladen, und nur der benötigte. Ein Ladebildschirm zeigt
  die Schritte und den Download-Fortschritt („12,3 von 38,5 MB“); danach kommen die Dateien aus dem Browser-Cache.
- Während des Laufs zeigt die Seite, welcher Emulator läuft (z. B. „EmulatorJS 4.2.3 · Commodore 64 · Core vice_x64sc“)
- Vollbild: der Emulator füllt den ganzen Bildschirm
- Öffnen per Dateiauswahl, Ordnerauswahl oder Drag & Drop
- ZIP-Archive werden im Browser entpackt, startbare Dateien werden mit Typ aufgelistet
- Lange Datei- und Ordnernamen werden für DOS in 8.3-Kurznamen umgesetzt
  (`Mein Spiel` → `MEINSP~1`) und beim Sichern zurückübersetzt
- Spielstände und andere geänderte Dateien als ZIP sichern oder, in Chrome/Edge,
  direkt in den geöffneten Ordner zurückschreiben
- Windows: Wine 6.0 (mit 16-Bit-Unterstützung) oder Wine 11.0 (schneller, nur 32 Bit),
  Single- oder Multithreaded, Auflösung und Farbtiefe einstellbar
- DOS: CPU-Geschwindigkeit einstellbar (automatisch, maximal, 286/386/486)
- Konsolen/Heimcomputer: Spielstände, Savestates, Steuerung und Gamepads über das Menü von EmulatorJS
- Die virtuelle Umgebung für Windows-Programme (Wine-Einstellungen) bleibt auf Wunsch im Browser gespeichert und lässt sich unten auf der Seite zurücksetzen

## Grenzen

- Windows: GDI- und DirectDraw-Programme laufen. **OpenGL und Direct3D gehen im Web-Build nicht.**
- .NET- und Java-Programme laufen nicht.
- Die Emulation ist deutlich langsamer als ein echter PC, gedacht ist sie für ältere Software.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```sh
npm run fetch   # lädt die Emulatoren nach site/ (einmalig ~500 MB; boxedwine.org ist langsam, ~10 Minuten)
npm run serve   # http://localhost:8080
```

`npm run serve:no-coi` startet den Server ohne COOP/COEP-Header, so wie GitHub Pages.
`npm run fetch:force` lädt alles neu herunter, auch was schon da ist.

## Emulatoren aktualisieren

Boxedwine, js-dos und v86 sind auf feste Versionen gesetzt (Konstanten oben in
`scripts/fetch-runtimes.mjs`), weil neue Versionen Demos kaputtmachen können. EmulatorJS wird dagegen
bei jedem Download automatisch in der neuesten stabilen Version geholt.

Neue Versionen prüfen und übernehmen, in PowerShell:

```powershell
.\scripts\update.ps1          # zeigt nur an, was es Neues gibt
.\scripts\update.ps1 -Apply   # trägt die neuen Versionen ein und lädt alles neu herunter
```

oder plattformunabhängig mit `npm run update` bzw. `npm run update:apply`.

Was geprüft wird:

| Komponente | Quelle der neuesten Version | Was mit aktualisiert wird |
|---|---|---|
| Boxedwine | neuestes GitHub-Release von danoon2/Boxedwine mit Web-Build (`…Web.zip`) | Tag, Dateiname des Releases, Download-Link der SkiFree-Demo |
| js-dos | npm-Paket `js-dos` (Tag `latest`) | Version von `emulators`, mit der js-dos gebaut ist, und der DOSBox-Commit dieses emulators-Releases (für den Quellcode-Download) |
| v86 | npm-Paket `v86` (Tag `latest`) | Git-Commit des Pakets (für BIOS und Quellcode) und die SeaBIOS-Version dieses Commits |

Danach `npm run serve`, die Demos jedes betroffenen Emulators starten und erst dann committen.
Schlägt der Download fehl, hat die neue Version einen anderen Aufbau (z. B. andere Dateinamen im
Release), und `scripts/fetch-runtimes.mjs` muss angepasst werden. Mit `git diff` sieht man die
eingetragenen Versionen und kann sie zurücknehmen.

Ohne Anmeldung erlaubt die GitHub-API 60 Abfragen pro Stunde. Reicht das nicht, vorher ein Token
setzen: `$env:GITHUB_TOKEN = '...'`.

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/pages.yml` lädt bei jedem Push auf `main` die Emulatoren aus
   ihren offiziellen Releases und veröffentlicht `site/`. EmulatorJS wird dabei immer in der
   **neuesten stabilen Version** geholt (npm-Tag `latest`); Boxedwine, js-dos und v86 sind fest auf eine
   Version gesetzt, weil die Anbindung von deren Release-Aufbau abhängt (Update siehe
   [Emulatoren aktualisieren](#emulatoren-aktualisieren)).

Fremde Binärdateien liegen nicht im Repository, sie werden erst beim Deploy geladen.

### Warum ein Service Worker?

Der schnellere Multithreaded-Build braucht `SharedArrayBuffer`. Browser erlauben das nur mit den
Headern `Cross-Origin-Opener-Policy: same-origin` und `Cross-Origin-Embedder-Policy: require-corp`.
GitHub Pages kann keine eigenen Header setzen, deshalb ergänzt
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) sie im Browser.
Ohne Service Worker (z. B. im privaten Modus von Firefox) läuft automatisch der Singlethreaded-Build.

## Dokumentation

- [SPEC.md](SPEC.md): Spezifikation mit Architektur, Erkennung, Build und Teststand
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): Herkunft und Lizenzen aller eingebundenen Komponenten
- [demos/README.md](demos/README.md): Quellenverzeichnis aller Demo-Spiele (Herkunft, Version, Lizenz, geprüfte Kandidaten)

## Projektstruktur

```
site/                  statische Webseite (wird veröffentlicht)
  index.html, style.css
  js/app.js            Oberfläche
  js/workspace.js      Dateien, ZIPs und Ordner einlesen, Programme finden
  js/exe.js            DOS/Windows-Erkennung anhand des EXE-Kopfs
  js/runner.js         gemeinsame Logik: Änderungen sichern/zurückschreiben
  js/emulator.js       Windows-Programme mit Boxedwine
  js/dos.js            DOS-Programme mit js-dos, 8.3-Kurznamen
  js/systems.js        Konsolen/Heimcomputer: Systeme, Cores, BIOS, Erkennung
  js/ejs.js            Spiele mit EmulatorJS
  js/v86.js            komplette PCs (Betriebssysteme) mit v86
  js/fit.js            skaliert das Emulatorbild auf die Fläche (mit Seitenverhältnis)
  js/platforms.js      Symbole und Farben der Demo-Plattformen
  js/audio.js          gibt den Ton frei, den der Browser zurückhält
  js/zip.js            ZIP lesen/schreiben (ohne Abhängigkeiten)
  boxedwine/, jsdos/, emulatorjs/, v86/, demos/   werden von scripts/fetch-runtimes.mjs erzeugt (nicht im Git)
demos/demos.json       Liste der Demo-Programme (Quelle, Autor, Lizenz)
demos/local/           Demo-Dateien, die im Repository liegen (siehe demos/local/README.md)
scripts/
  fetch-runtimes.mjs   lädt Emulatoren, Lizenzen und Quellcode
  update-runtimes.mjs  prüft Boxedwine, js-dos und v86 auf neue Versionen und trägt sie ein
  update.ps1           dasselbe für PowerShell
  serve.mjs            lokaler Testserver mit COOP/COEP-Headern
```

## Credits

Run Them All wäre ohne diese Projekte nicht möglich:

| Projekt | Wofür | Lizenz |
|---|---|---|
| [Boxedwine](https://github.com/danoon2/Boxedwine) von James Bryant | Windows-Programme (Wine auf emulierter x86-CPU in WebAssembly) | GPL-2.0 |
| [Wine](https://www.winehq.org) | Windows-API für Linux, läuft in Boxedwine | LGPL-2.1+ |
| [js-dos](https://js-dos.com) und [emulators](https://github.com/caiiiycuk/emulators) von Alexander Guryanov | DOS-Programme | GPL-2.0 |
| [DOSBox](https://www.dosbox.com) | DOS-Emulation in js-dos | GPL-2.0 |
| [EmulatorJS](https://emulatorjs.org) | Oberfläche und Laufzeit für libretro-Cores im Browser | GPL-3.0 |
| [libretro](https://www.libretro.com)-Cores, u. a. [VICE](https://vice-emu.sourceforge.io), [PUAE](https://github.com/libretro/libretro-uae), FCEUmm, Snes9x, mGBA, Genesis Plus GX, PCSX ReARMed | die einzelnen Konsolen- und Heimcomputer-Emulatoren, vollständige Liste auf der Seite unter `emulatorjs/cores.html` | je Core, meist GPL; einige nur nichtkommerziell |
| [v86](https://github.com/copy/v86) von Fabian Hemmer | komplette x86-PCs (Betriebssysteme von CD, Diskette, Festplatte) | BSD-2-Clause |
| [SeaBIOS](https://www.seabios.org) | PC-BIOS in v86 | LGPL-3.0 |
| [AROS](https://aros.sourceforge.io) | freier Amiga-Kickstart-Ersatz (im PUAE-Core enthalten) | AROS Public License |
| Demo-Programme: SkiFree (Chris Pirih), OpenTTD mit OpenGFX (OpenTTD-Team), Castle of the Winds (Rick Saada), Keen Dreams (id Software), Boppin’ (Accursed Toys), Demos von Dark Forces und Fate of Atlantis (LucasArts), T-Rex 64 (Maciej Małecki), Nova the Squirrel (NovaSquirrel), µCity (Antonio Niño Díaz), Tiny Core Linux, KolibriOS, ReactOS | Demos auf der Startseite, Quellenverzeichnis in [demos/README.md](demos/README.md) | MIT, GPL-2.0, GPL-3.0; SkiFree und Castle of the Winds ohne ausdrückliche Lizenz, vom Autor freigegeben |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) von Guido Zuidhof | Cross-Origin-Isolation auf GitHub Pages | MIT |

## Lizenz

Run Them All selbst steht unter der [MIT-Lizenz](LICENSE). Die eingebundenen Komponenten haben ihre
eigenen Lizenzen, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
