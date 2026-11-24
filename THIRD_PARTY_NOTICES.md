# Komponenten anderer Projekte

WebExe ist ein Aggregator: Diese Komponenten sind nicht Teil dieses Repositorys. Sie werden von
`scripts/fetch-runtimes.mjs` heruntergeladen und zusammen mit der Webseite veröffentlicht.

## Boxedwine 26R1.0

- Projekt: https://github.com/danoon2/Boxedwine
- Lizenz: GNU General Public License v2.0
- Verwendet: unveränderte Dateien aus dem offiziellen Release `Boxedwine26R1Web.zip`
  (`boxedwine.js`, `boxedwine.wasm` sowie die Dateisysteme `boxedwine.zip` mit Wine 6.0 und Wine 11.0)
- Zusätzlich: `boxedwine/wine6/win16-extras.zip` enthält 16-Bit-Module von Wine 6.0 (z. B. WinG,
  toolhelp, ole2), die im Web-Dateisystem fehlen. Sie stammen unverändert aus dem vollständigen
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
- BIOS: WebExe liefert keine BIOS-Dateien aus. Freie Ersatz-BIOS sind teilweise in den Cores enthalten
  (AROS-Kickstart in PUAE, HLE-BIOS in mGBA, melonDS, PCSX ReARMed, Yabause; die Commodore-, Sinclair- und
  Amstrad-ROMs liefern VICE, Fuse und Caprice32 selbst mit).
- Netzwerk: EmulatorJS fragt beim Start `https://cdn.emulatorjs.org/stable/data/version.json` ab, um auf neue
  Versionen hinzuweisen (es werden keine Nutzerdaten gesendet). Alle Emulator-Dateien werden von dieser Seite
  geladen; Netplay ist ausgeblendet.

## coi-serviceworker v0.1.7

- Projekt: https://github.com/gzuidhof/coi-serviceworker
- Lizenz: MIT, Copyright (c) 2021 Guido Zuidhof
- Verwendet: `coi-serviceworker.js` (Commit 7b1d2a0)
