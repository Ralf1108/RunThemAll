# WebExe

**Alte DOS- und Windows-Programme direkt im Browser ausführen. Ohne Installation, ohne Upload.**

Datei, ZIP oder Ordner öffnen, Programm auswählen, starten. WebExe erkennt selbst, welcher
Emulator gebraucht wird, und lädt ihn. Alles läuft lokal im Browser: Deine Dateien verlassen
deinen Rechner nicht.

WebExe ist ein **Aggregator**: Die eigentliche Emulation stammt aus großartigen Open-Source-Projekten
(siehe [Credits](#credits)). WebExe sorgt nur für eine gemeinsame, einfache Oberfläche und bindet
die Emulatoren aus ihren offiziellen Releases ein.

## Was läuft?

| Programmtyp | Erkannt an | Emulator |
|---|---|---|
| DOS (`.com`, `.exe` nur mit MZ-Kopf, DOS/4GW-Spiele) | Dateikopf | [js-dos](https://js-dos.com) (DOSBox) |
| Windows 3.x (16 Bit) | NE-Kopf | [Boxedwine](https://github.com/danoon2/Boxedwine) mit Wine 6 |
| Windows 95 bis XP (32 Bit) | PE-Kopf | Boxedwine mit Wine 6 oder 11 |
| `.bat` | Windows, wenn Windows-Programme danebenliegen, sonst DOS | |

## Funktionen

- Öffnen per Dateiauswahl, Ordnerauswahl oder Drag & Drop
- ZIP-Archive werden im Browser entpackt, startbare Dateien werden mit Typ aufgelistet
- Lange Datei- und Ordnernamen werden für DOS in 8.3-Kurznamen umgesetzt
  (`Mein Spiel` → `MEINSP~1`) und beim Sichern zurückübersetzt
- Spielstände und andere geänderte Dateien als ZIP sichern oder, in Chrome/Edge,
  direkt in den geöffneten Ordner zurückschreiben
- Windows: Wine 6.0 (mit 16-Bit-Unterstützung) oder Wine 11.0 (schneller, nur 32 Bit),
  Single- oder Multithreaded, Auflösung und Farbtiefe einstellbar
- DOS: CPU-Geschwindigkeit einstellbar (automatisch, maximal, 286/386/486)
- Laufwerk C: (Wine-Einstellungen) bleibt auf Wunsch im Browser gespeichert

## Grenzen

- Windows: GDI- und DirectDraw-Programme laufen. **OpenGL und Direct3D gehen im Web-Build nicht.**
- .NET- und Java-Programme laufen nicht.
- Die Emulation ist deutlich langsamer als ein echter PC, gedacht ist sie für ältere Software.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```sh
npm run fetch   # lädt die Emulatoren nach site/ (einmalig; boxedwine.org ist langsam, ~10 Minuten)
npm run serve   # http://localhost:8080
```

`npm run serve:no-coi` startet den Server ohne COOP/COEP-Header, so wie GitHub Pages.

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/pages.yml` lädt bei jedem Push auf `main` die Emulatoren aus
   ihren offiziellen Releases und veröffentlicht `site/`.

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
  js/zip.js            ZIP lesen/schreiben (ohne Abhängigkeiten)
  boxedwine/, jsdos/   werden von scripts/fetch-runtimes.mjs erzeugt (nicht im Git)
scripts/
  fetch-runtimes.mjs   lädt Emulatoren, Lizenzen und Quellcode
  serve.mjs            lokaler Testserver mit COOP/COEP-Headern
```

## Credits

WebExe wäre ohne diese Projekte nicht möglich:

| Projekt | Wofür | Lizenz |
|---|---|---|
| [Boxedwine](https://github.com/danoon2/Boxedwine) von James Bryant | Windows-Programme (Wine auf emulierter x86-CPU in WebAssembly) | GPL-2.0 |
| [Wine](https://www.winehq.org) | Windows-API für Linux, läuft in Boxedwine | LGPL-2.1+ |
| [js-dos](https://js-dos.com) und [emulators](https://github.com/caiiiycuk/emulators) von Alexander Guryanov | DOS-Programme | GPL-2.0 |
| [DOSBox](https://www.dosbox.com) | DOS-Emulation in js-dos | GPL-2.0 |
| [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) von Guido Zuidhof | Cross-Origin-Isolation auf GitHub Pages | MIT |

## Lizenz

WebExe selbst steht unter der [MIT-Lizenz](LICENSE). Die eingebundenen Komponenten haben ihre
eigenen Lizenzen, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
