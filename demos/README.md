# Demos und Quellenverzeichnis der Spiele

`demos.json` listet freie Programme und Spiele, die auf der Startseite von WebExe als Demo
angeboten werden: mindestens eines pro Emulator (Boxedwine, js-dos, EmulatorJS) bzw. System.

Die Dateien selbst liegen **nicht** in diesem Repository. `scripts/fetch-runtimes.mjs` lädt sie beim
Build aus ihren Original-Releases (Downloads werden in `vendor/demos/` zwischengespeichert) und legt
sie unter `site/demos/` ab. Damit werden sie zusammen mit der Webseite veröffentlicht.

Stand der Recherche: 24.11.2026.

## Aufnahmekriterien

1. Die Lizenz muss die Weitergabe ausdrücklich erlauben (freie Lizenz oder ausdrückliche Freigabe).
2. Fester Download-Link aus einem offiziellen Release, möglichst ein GitHub-Release mit Versionsnummer.
3. Das Spiel muss ohne Original-BIOS laufen (z. B. Amiga nur mit dem freien AROS-Kickstart).
4. Keine Fan-Spiele zu fremden Marken.

## Aufgenommene Demos

### SkiFree 1.04 (32 Bit)

| | |
|---|---|
| System / Emulator | Windows (32 Bit) / Boxedwine |
| Autor | Chris Pirih |
| Projektseite | https://ski.ihoc.net/ |
| Bezogen von | Boxedwine-Web-Release 26R1.0, Datei `SingleThreaded/ski32.zip` in https://github.com/danoon2/Boxedwine/releases/download/26R1.0/Boxedwine26R1Web.zip |
| Datei auf der Seite | `demos/windows/ski32.zip` (39.491 Byte), gestartet wird `ski32.exe` |
| Lizenz | **keine ausdrückliche Lizenz.** Der Autor bietet die 32-Bit-Version auf seiner Seite kostenlos zum Download an, Boxedwine legt sie seinem Release als Beispiel bei. SkiFree erschien 1991 ursprünglich als Microsoft-Produkt (Microsoft Entertainment Pack), das Microsoft beim Autor lizenziert hatte. |
| Hinweis | Erfüllt Kriterium 1 nicht streng; Aufnahme ist noch zu entscheiden (siehe „Offene Fragen“). |

### ZZT (Reconstruction of ZZT 1.0)

| | |
|---|---|
| System / Emulator | DOS / js-dos (DOSBox) |
| Autoren | Tim Sweeney / Epic MegaGames (Original 1991), Adrian Siekierka (Rekonstruktion des Quellcodes 2020) |
| Projektseite | https://github.com/asiekierka/reconstruction-of-zzt |
| Download | https://github.com/asiekierka/reconstruction-of-zzt/releases/download/v1.0/RecOfZZT.zip |
| Inhalt | `ZZT.EXE`, `ZZT.DAT`, `ZZT.CFG`, `DEMO.ZZT` (Demo-Welt), `LICENSE.TXT` |
| Datei auf der Seite | `demos/dos/zzt.zip` (69.695 Byte, unverändert), gestartet wird `ZZT.EXE` |
| Lizenz | MIT, „Based on a reconstruction of code from ZZT, Copyright 1991 Epic MegaGames, used with permission“ |
| Lizenztext | https://github.com/asiekierka/reconstruction-of-zzt/blob/master/LICENSE.TXT (liegt auch im ZIP) |

### T-Rex 64 1.0.2

| | |
|---|---|
| System / Emulator | Commodore 64 / EmulatorJS mit VICE (`vice_x64sc`) |
| Autor | Maciej Małecki |
| Projektseite | https://github.com/maciejmalecki/trex64, https://maciejmalecki.itch.io/trex64 |
| Download | https://github.com/maciejmalecki/trex64/releases/download/1.0.2/trex.zip |
| Inhalt | `rex.d64`, `rex.prg`, `00readme.md` |
| Datei auf der Seite | `demos/c64/rex.d64` (174.848 Byte, aus dem ZIP übernommen) |
| Lizenz | MIT |
| Lizenztext | https://github.com/maciejmalecki/trex64/blob/master/LICENSE |

### Nova the Squirrel 1.0.6a

| | |
|---|---|
| System / Emulator | NES / EmulatorJS mit FCEUmm |
| Autor | NovaSquirrel |
| Projektseite | https://github.com/NovaSquirrel/NovaTheSquirrel |
| Download | https://github.com/NovaSquirrel/NovaTheSquirrel/releases/download/v1.0.6a/nova.nes |
| Datei auf der Seite | `demos/nes/nova.nes` (262.160 Byte, unverändert) |
| Lizenz | GPL-3.0 |
| Lizenztext | https://github.com/NovaSquirrel/NovaTheSquirrel/blob/master/LICENSE.txt |
| Quellcode | Tag `v1.0.6a` im Projekt-Repository |

### µCity 1.3

| | |
|---|---|
| System / Emulator | Game Boy Color / EmulatorJS mit Gambatte |
| Autor | Antonio Niño Díaz |
| Projektseite | https://github.com/AntonioND/ucity |
| Download | https://github.com/AntonioND/ucity/releases/download/v1.3/ucity.gbc |
| Datei auf der Seite | `demos/gb/ucity.gbc` (131.072 Byte, unverändert) |
| Lizenz | GPL-3.0 |
| Lizenztext | https://github.com/AntonioND/ucity/blob/master/gpl-3.0.txt |
| Quellcode | Tag `v1.3` im Projekt-Repository |

## Geprüft und nicht aufgenommen

| Kandidat | System | Lizenz | Quelle | Grund |
|---|---|---|---|---|
| Plouf! 1.1 (Aurélien Gâteau) | Amiga | GPL-3.0 ([LICENSE](https://github.com/agateau/plouf/blob/master/LICENSE)) | https://agateau.com/projects/plouf/plouf-1.1.adf, Quellcode https://github.com/agateau/plouf | startet mit dem freien AROS-Kickstart nicht (bleibt auf der Workbench stehen; AMOS-Programm braucht das echte Kickstart) |
| Lupengo (Carlo Borreo) | Amiga | GPL | https://lupengo.sourceforge.net/lupamiga.php.html (ADF unter `lupengo.adf.html`) | startet mit AROS nicht (blauer Bildschirm) |
| Blocky Skies 0.73 (alpine9000 / Enable Software) | Amiga | Code BSD-2, Musik CC-BY 4.0 (Simone Bernacchia), **Grafik „All rights reserved“** (Chipmunk u. a.), ein Soundeffekt CC-BY-NC 3.0 | http://alpine9000.github.io/blockyskies/ (`downloads/BlockySkiesPAL_BootDisk_v0_73.lha`), [LEGAL](http://alpine9000.github.io/blockyskies/LEGAL.html), Quellcode https://github.com/alpine9000/blockyskies | läuft mit AROS einwandfrei, aber keine Erlaubnis zur Weitergabe der Grafik; käme nur mit Zustimmung des Autors in Frage |
| Famidash (tfdsoft) | NES | MIT ([LICENSE](https://github.com/tfdsoft/famidash/blob/main/LICENSE)) | https://github.com/tfdsoft/famidash | Fan-Spiel zu einer fremden Marke (Geometry Dash) |
| 8 bit island (gpowerf) | C64 | MIT (laut itch.io) | https://gpowerf.itch.io/8-bit-island | nur über itch.io erhältlich, kein fester Download-Link |
| Galactor (Dr. Ludos) | NES | Code MIT, Grafik/Ton CC-BY | https://drludos.itch.io/galactor | nur über itch.io erhältlich |
| Sprilo (cmrn) | NES | MIT | https://cmrn.itch.io/sprilo | nur über itch.io erhältlich |
| Jump N Bump, Amiga-Port (earok) | Amiga | GPL-3.0 | https://earok.itch.io/jump-n-bump | nur über itch.io erhältlich |
| Tobu Tobu Girl (Simon Larsen) | Game Boy | Code MIT, Grafik CC-BY | https://github.com/SimonLarsen/tobutobugirl | kein Release mit ROM auf GitHub |

## Offene Fragen

- **SkiFree**: keine ausdrückliche Lizenz (siehe oben). Entweder ersetzen, beim Autor nachfragen oder
  bewusst beibehalten, weil Autor und Boxedwine es frei anbieten.
- **Amiga-Demo**: fehlt noch. Blocky Skies wäre technisch geeignet, braucht aber die Zustimmung des Autors.

## Format von `demos.json`

| Feld | Bedeutung |
|---|---|
| `id` | eindeutiger Name |
| `title`, `platform`, `emulator`, `description` | Anzeige auf der Startseite |
| `author`, `homepage`, `license` | Credits (werden auf der Karte angezeigt) |
| `url` | Download aus dem Original-Release |
| `entry` | optional: Datei innerhalb eines ZIP, die übernommen wird |
| `note` | optional: Hinweis zur Herkunft |
| `file` | Pfad unter `site/demos/` |
| `start` | Programm bzw. Spieldatei, die gestartet wird |
| `system` | optional: EmulatorJS-System (siehe `site/js/systems.js`) |
