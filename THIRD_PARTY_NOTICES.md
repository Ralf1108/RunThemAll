# Komponenten anderer Projekte

Diese Komponenten sind nicht Teil dieses Repositorys. Sie werden von
`scripts/fetch-runtimes.mjs` heruntergeladen und zusammen mit der Webseite veröffentlicht.

## Boxedwine 26R1.0

- Projekt: https://github.com/danoon2/Boxedwine
- Lizenz: GNU General Public License v2.0
- Verwendet: unveränderte Dateien aus dem offiziellen Release `Boxedwine26R1Web.zip`
  (`boxedwine.js`, `boxedwine.wasm` sowie die Dateisysteme `boxedwine.zip` mit Wine 6.0 und Wine 11.0)
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

## coi-serviceworker v0.1.7

- Projekt: https://github.com/gzuidhof/coi-serviceworker
- Lizenz: MIT, Copyright (c) 2021 Guido Zuidhof
- Verwendet: `coi-serviceworker.js` (Commit 7b1d2a0)
