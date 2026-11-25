# Komponenten anderer Projekte

Run Them All ist ein Aggregator: Diese Komponenten sind nicht Teil dieses Repositorys. Sie werden von
`scripts/fetch-runtimes.mjs` heruntergeladen und zusammen mit der Webseite veröffentlicht.

## Boxedwine 26R1.0

- Projekt: https://github.com/danoon2/Boxedwine
- Lizenz: GNU General Public License v2.0
- Verwendet: unveränderte Dateien aus dem offiziellen Release `Boxedwine26R1Web.zip`
  (`boxedwine.js`, `boxedwine.wasm` sowie die Dateisysteme `boxedwine.zip` mit Wine 6.0 und Wine 11.0)
- Zusätzlich: `boxedwine/wine6/win16-extras.zip` enthält 16-Bit-Module von Wine 6.0 (z. B. WinG,
  toolhelp, ole2) sowie die Module `winhttp` und `jsproxy` (für OpenTTD), die im Web-Dateisystem fehlen. Sie stammen unverändert aus dem vollständigen
  Boxedwine-Dateisystem http://boxedwine.org/v2/2/TinyCore15Wine6.0.zip (Wine, LGPL-2.1+).
- Lizenztext: wird als `boxedwine/LICENSE-GPL-2.0.txt` mit veröffentlicht
- Quellcode: der vollständige Quellcode dieser Version wird als
  `boxedwine/source/Boxedwine-26R1.0-source.tar.gz` neben den Binärdateien veröffentlicht
  (ebenso unter https://github.com/danoon2/Boxedwine/tree/26R1.0)

Die Dateisystem-Archive enthalten Wine (LGPL-2.1 oder neuer) und Teile von Tiny Core Linux
(GPL); deren Lizenzen liegen jeweils in den Archiven bzw. bei den Upstream-Projekten.

## js-dos 8.5.4 mit emulators 8.5.3 (DOSBox)

- Projekte: https://github.com/caiiiycuk/js-dos, https://github.com/caiiiycuk/emulators,
  https://github.com/js-dos/dosbox
- Lizenz: GNU General Public License v2.0
- Verwendet: unveränderte Dateien aus dem npm-Paket `js-dos@8.5.4`
  (`js-dos.js`, `js-dos.css`, `emulators/emulators.js`, `wdosbox.js/.wasm`, `wlibzip.js/.wasm`)
- Lizenztext: wird als `jsdos/LICENSE-GPL-2.0.txt` mit veröffentlicht
- Quellcode: wird unter `jsdos/source/` neben den Binärdateien veröffentlicht:
  js-dos `v8.5.4`, emulators `v8.5.3` und der DOSBox-Fork in der von emulators 8.5.3
  verwendeten Version (Commit `528578d`)
- Die Emulator-Dateien werden von dieser Seite selbst ausgeliefert (`pathPrefix`), es werden
  keine Dateien vom js-dos-CDN nachgeladen. Lokale Speicherung von js-dos ist abgeschaltet.

## EmulatorJS (neueste stabile Version, derzeit 4.2.3) mit libretro-Cores

- Projekt: https://github.com/EmulatorJS/EmulatorJS, https://emulatorjs.org
- Lizenz: GNU General Public License v3.0
- Verwendet: unverändertes npm-Paket `@emulatorjs/emulatorjs` (Ordner `data/`) sowie je System ein
  Core-Paket `@emulatorjs/core-<name>` in derselben Version. Die Version wird beim Build über das
  npm-Tag `latest` bestimmt (Vorabversionen sind dort nicht markiert).
- Da das npm-Paket nur die unminifizierten Quellen enthält, werden die Skripte unverändert zu
  `emulator.min.js` zusammengefügt (gleiche Reihenfolge wie in `loader.js`), `emulator.css` wird als
  `emulator.min.css` kopiert.
- Lizenztext: `emulatorjs/LICENSE-GPL-3.0.txt`; Quellcode: `emulatorjs/source/EmulatorJS-<version>-source.tar.gz`
- Cores: Jede Core-Datei (`*.data`) enthält ihren eigenen Lizenztext. Die Seite `emulatorjs/cores.html`
  listet alle Cores mit Version, Quellcode-Repository (EmulatorJS-Forks der libretro-Cores) und Lizenzdatei.
  **Einige Cores erlauben keine kommerzielle Nutzung**, u. a. Snes9x, Genesis Plus GX, PicoDrive,
  FBNeo und MAME 2003-Plus.
- BIOS: Run Them All liefert keine BIOS-Dateien aus. Freie Ersatz-BIOS sind teilweise in den Cores enthalten
  (AROS-Kickstart in PUAE, HLE-BIOS in mGBA, melonDS, PCSX ReARMed, Yabause; die Commodore-, Sinclair- und
  Amstrad-ROMs liefern VICE, Fuse und Caprice32 selbst mit).
- Netzwerk: EmulatorJS fragt beim Start `https://cdn.emulatorjs.org/stable/data/version.json` ab, um auf neue
  Versionen hinzuweisen (es werden keine Nutzerdaten gesendet). Alle Emulator-Dateien werden von dieser Seite
  geladen; Netplay ist ausgeblendet.

## v86 0.5.476 mit SeaBIOS 1.16.2

- Projekt: https://github.com/copy/v86, https://copy.sh/v86/
- Lizenz: BSD-2-Clause (v86), GNU Lesser General Public License v3.0 (SeaBIOS)
- Verwendet: unveränderte Dateien aus dem npm-Paket `v86@0.5.476` (`libv86.mjs`, `v86.wasm`) sowie
  die BIOS-Images `seabios.bin` und `vgabios.bin` aus dem Ordner `bios/` desselben v86-Commits
  (`9457e7a`)
- Lizenztexte: werden als `v86/LICENSE-BSD-2-Clause.txt` und `v86/bios/LICENSE-LGPL-3.0.txt` mit veröffentlicht
- Quellcode: wird unter `v86/source/` neben den Binärdateien veröffentlicht: v86 (Commit `9457e7a`)
  und SeaBIOS `rel-1.16.2`

## Demo-Programme

Werden beim Build aus ihren Original-Releases geladen und unter `demos/` veröffentlicht.
Vollständiges Quellenverzeichnis mit Download-Links, Versionen, Lizenztexten und den geprüften,
aber nicht aufgenommenen Spielen: [demos/README.md](demos/README.md).

| Demo | Autor | Lizenz | Quelle |
|---|---|---|---|
| SkiFree 1.04 | Chris Pirih | keine ausdrückliche Lizenz; vom Autor kostenlos angeboten | Beispiel im Boxedwine-Web-Release 26R1.0 |
| OpenTTD 15.3 mit OpenGFX 8.0 | OpenTTD-Team | GPL-2.0 | openttd.org |
| Castle of the Winds 1.1A | Rick Saada (SaadaSoft) | keine ausdrückliche Lizenz; vom Autor als Freeware freigegeben | classicdosgames.com |
| Tiny Core Linux 17.1 | Tiny-Core-Team | GPL-2.0 | tinycorelinux.net |
| KolibriOS 0.7.7.0+8930 | KolibriOS-Team | GPL-2.0 | kolibrios.org (Datei im Repository, siehe demos/local/README.md) |
| Keen Dreams 1.13 | id Software / Softdisk | Shareware, frei weitergebbar | classicdosgames.com |
| Star Wars: Dark Forces (Demo) | LucasArts | Demo, kostenlose Weitergabe erlaubt | classicdosgames.com |
| Indiana Jones and the Fate of Atlantis (Demo) | LucasArts | Demo, kostenlose Weitergabe erlaubt | classicdosgames.com |
| Boppin’ 1.1 (Shareware-Episode) | Accursed Toys / Apogee | Shareware, Weitergabe ohne Gebühr erlaubt (VENDOR.DOC) | classicdosgames.com, vorinstalliert in demos/local |
| ReactOS 0.4.15 (Live-CD) | ReactOS-Projekt | GPL-2.0 | github.com/reactos/reactos |
| T-Rex 64 1.0.2 | Maciej Małecki | MIT | github.com/maciejmalecki/trex64 |
| Nova the Squirrel 1.0.6a | NovaSquirrel | GPL-3.0 (Quellcode im verlinkten Repository) | github.com/NovaSquirrel/NovaTheSquirrel |
| µCity 1.3 | Antonio Niño Díaz | GPL-3.0 (Quellcode im verlinkten Repository) | github.com/AntonioND/ucity |

## Plattform-Logos (site/img/platforms/)

Die Logos auf den Demo-Kacheln zeigen nur, zu welcher Plattform eine Demo gehört. Die Marken gehören
ihren Inhabern (Microsoft, Commodore, Nintendo); Run Them All steht mit ihnen in keiner Verbindung.

| Datei | Motiv | Lizenz | Quelle |
|---|---|---|---|
| windows.svg | Windows-Flagge (2002–2012, farbig) | gemeinfrei (Logo aus einfachen Formen), Marke von Microsoft | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unofficial_Windows_logo_variant_-_2002%E2%80%932012_(Multicolored).svg) |
| windows3.svg | Windows-Logo von 1992 | gemeinfrei (Logo aus einfachen Formen), Marke von Microsoft | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Windows_logo_-_1992.svg) |
| dos.svg | MS-DOS-Logo | MIT, [Devicon](https://github.com/devicons/devicon) (konpa) | über [Iconify](https://icon-sets.iconify.design/devicon/msdos/) |
| commodore.svg | Commodore-Emblem, eingefärbt | CC0, Form von [Simple Icons](https://simpleicons.org/?q=commodore) | Farben selbst gesetzt |
| nes.svg | NES-Controller | CC BY-SA 3.0, Fant0men | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nes_controller.svg) |
| gameboy.svg | Handheld | CC BY 4.0, [Streamline](https://www.streamlinehq.com/) (Plump color) | über [Iconify](https://icon-sets.iconify.design/streamline-plump-color/gameboy/) |
| cd.svg | CD | Apache-2.0, [Noto Emoji](https://github.com/googlefonts/noto-emoji) (Google) | über [Iconify](https://icon-sets.iconify.design/noto/optical-disk/) |

## coi-serviceworker v0.1.7

- Projekt: https://github.com/gzuidhof/coi-serviceworker
- Lizenz: MIT, Copyright (c) 2021 Guido Zuidhof
- Verwendet: `coi-serviceworker.js` (Commit 7b1d2a0)
