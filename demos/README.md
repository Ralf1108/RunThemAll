# Demos

`demos.json` listet freie Programme und Spiele, die auf der Startseite von WebExe als Demo
angeboten werden: mindestens eines pro Emulator (Boxedwine, js-dos, EmulatorJS) bzw. System.

Die Dateien selbst liegen **nicht** in diesem Repository. `scripts/fetch-runtimes.mjs` lädt sie beim
Build aus ihren Original-Releases und legt sie unter `site/demos/` ab.

| Feld | Bedeutung |
|---|---|
| `id` | eindeutiger Name |
| `title`, `platform`, `emulator`, `description` | Anzeige auf der Startseite |
| `author`, `homepage`, `license` | Credits (werden auf der Karte angezeigt) |
| `url` | Download aus dem Original-Release |
| `entry` | optional: Datei innerhalb eines ZIP, die übernommen wird |
| `file` | Pfad unter `site/demos/` |
| `start` | Programm bzw. Spieldatei, die gestartet wird |
| `system` | optional: EmulatorJS-System (siehe `site/js/systems.js`) |

## Aufnahmekriterien

- Die Lizenz muss die Weitergabe ausdrücklich erlauben (freie Lizenz oder ausdrücklich Freeware).
- Fester Download-Link, möglichst ein GitHub-Release.
- Muss ohne Original-BIOS laufen (z. B. Amiga nur mit dem freien AROS-Kickstart).

## Aktuelle Demos

| Demo | System | Autor | Lizenz |
|---|---|---|---|
| [SkiFree](https://ski.ihoc.net/) | Windows (Boxedwine) | Chris Pirih | Freeware, liegt dem Boxedwine-Release bei |
| [ZZT](https://github.com/asiekierka/reconstruction-of-zzt) | DOS (js-dos) | Tim Sweeney / Epic MegaGames, Rekonstruktion Adrian Siekierka | MIT, mit Erlaubnis von Epic |
| [T-Rex 64](https://github.com/maciejmalecki/trex64) | C64 (EmulatorJS/VICE) | Maciej Małecki | MIT |
| [Nova the Squirrel](https://github.com/NovaSquirrel/NovaTheSquirrel) | NES (EmulatorJS/FCEUmm) | NovaSquirrel | GPL-3.0 |
| [µCity](https://github.com/AntonioND/ucity) | Game Boy Color (EmulatorJS/Gambatte) | Antonio Niño Díaz | GPL-3.0 |

## Geprüft und nicht aufgenommen

| Kandidat | Grund |
|---|---|
| Plouf! (Amiga, GPL-3.0) | startet mit dem freien AROS-Kickstart nicht (bleibt auf der Workbench stehen) |
| Lupengo (Amiga, GPL) | startet mit AROS nicht (blauer Bildschirm) |
| Blocky Skies (Amiga) | läuft mit AROS, aber die Grafik ist „All rights reserved“ (Code BSD-2, Musik CC-BY) |
| Famidash (NES, MIT) | Fan-Spiel zu einer fremden Marke (Geometry Dash) |
