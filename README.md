# WebExe

Alte 16- und 32-Bit-Windows-Programme direkt im Browser ausführen.

Man öffnet eine **EXE**, ein **ZIP-Archiv** oder einen **Ordner**, wählt das Programm aus
und startet es. Alles läuft lokal im Browser, es werden keine Dateien hochgeladen.
Die Emulation übernimmt [Boxedwine](https://github.com/danoon2/Boxedwine)
(Wine auf einer emulierten x86-CPU, kompiliert nach WebAssembly).

## Funktionen

- Öffnen per Dateiauswahl, Ordnerauswahl oder Drag & Drop
- ZIP-Archive werden im Browser entpackt, ausführbare Dateien (`.exe`, `.bat`) werden aufgelistet
- Wine 6.0 (kompatibler) oder Wine 11.0 (schneller)
- Multithreaded-Build, wenn der Browser es erlaubt, sonst Singlethreaded
- Geänderte Dateien (z. B. Spielstände) als ZIP sichern oder, in Chrome/Edge,
  direkt in den geöffneten Ordner zurückschreiben
- Laufwerk C: (Wine-Einstellungen) bleibt auf Wunsch im Browser gespeichert (IndexedDB)

## Grenzen

- Unterstützt werden GDI- und DirectDraw-Programme. **OpenGL und Direct3D gehen im Web-Build nicht.**
- .NET- und Java-Programme laufen nicht.
- Die Web-Version ist deutlich langsamer als ein echter PC, gedacht ist sie für ältere Software.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```sh
npm run fetch   # lädt Boxedwine 26R1 nach site/boxedwine/ (ca. 120 MB, einmalig)
npm run serve   # http://localhost:8080
```

`npm run serve:no-coi` startet den Server ohne COOP/COEP-Header (so verhält sich GitHub Pages).

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/pages.yml` lädt bei jedem Push auf `main` das
   Boxedwine-Release herunter und veröffentlicht `site/`.

Die Boxedwine-Dateien liegen nicht im Repository, sie werden beim Deploy geladen.

### Warum der Service Worker?

Der schnellere Multithreaded-Build braucht `SharedArrayBuffer`. Browser erlauben das nur,
wenn die Seite die Header `Cross-Origin-Opener-Policy: same-origin` und
`Cross-Origin-Embedder-Policy: require-corp` sendet. GitHub Pages kann keine eigenen Header
setzen, deshalb ergänzt [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
sie im Browser. Ohne Service Worker (z. B. im privaten Modus von Firefox) läuft automatisch
der Singlethreaded-Build.

## Projektstruktur

```
site/                  statische Webseite (wird veröffentlicht)
  index.html, style.css
  js/app.js            Oberfläche
  js/workspace.js      Dateien, ZIPs und Ordner einlesen
  js/emulator.js       Boxedwine starten, Änderungen sichern/zurückschreiben
  js/zip.js            ZIP lesen/schreiben (ohne Abhängigkeiten)
  boxedwine/           wird von scripts/fetch-boxedwine.mjs erzeugt (nicht im Git)
scripts/
  fetch-boxedwine.mjs  lädt Release, GPL-Lizenz und Quellcode
  serve.mjs            lokaler Testserver mit COOP/COEP-Headern
```

## Lizenz

WebExe selbst steht unter der [MIT-Lizenz](LICENSE).
Mit ausgeliefert werden Komponenten anderer Projekte unter eigenen Lizenzen,
siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
