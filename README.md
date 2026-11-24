# WebExe

Alte DOS-Programme und 16-/32-Bit-Windows-Programme direkt im Browser ausführen.

Man öffnet eine **EXE**, ein **ZIP-Archiv** oder einen **Ordner**, wählt das Programm aus
und startet es. Alles läuft lokal im Browser, es werden keine Dateien hochgeladen.
WebExe erkennt am Programm-Header, ob es sich um ein DOS- oder ein Windows-Programm handelt,
und startet den passenden Emulator:

| Programmtyp | Erkennung | Emulator |
|---|---|---|
| DOS (`.com`, `.exe` nur mit MZ-Header, DOS-Extender mit LE/LX) | Header | [js-dos](https://js-dos.com) (DOSBox in WebAssembly) |
| Windows 3.x (16 Bit, NE-Header) | Header | [Boxedwine](https://github.com/danoon2/Boxedwine) (Wine auf emulierter x86-CPU) |
| Windows 32 Bit (PE-Header) | Header | Boxedwine |
| `.bat` | Windows, wenn im Ordner Windows-Programme liegen, sonst DOS | |

## Funktionen

- Öffnen per Dateiauswahl, Ordnerauswahl oder Drag & Drop
- ZIP-Archive werden im Browser entpackt, ausführbare Dateien (`.exe`, `.com`, `.bat`) werden mit Typ aufgelistet
- Lange Datei- und Ordnernamen werden für DOS automatisch in 8.3-Kurznamen umgesetzt
  (z. B. `Mein Spiel` → `MEINSP~1`) und beim Sichern wieder zurückübersetzt
- Wine 6.0 (kompatibler) oder Wine 11.0 (schneller, nur 32-Bit), DOS-CPU-Geschwindigkeit einstellbar.
  Das Wine-6-Dateisystem des Web-Releases wird um fehlende 16-Bit-Module (z. B. WinG) ergänzt,
  16-Bit-Programme laufen immer mit Wine 6.
- Multithreaded-Build, wenn der Browser es erlaubt, sonst Singlethreaded
- Geänderte Dateien (z. B. Spielstände) als ZIP sichern oder, in Chrome/Edge,
  direkt in den geöffneten Ordner zurückschreiben
- Laufwerk C: (Wine-Einstellungen) bleibt auf Wunsch im Browser gespeichert (IndexedDB)

## Grenzen

- Windows: unterstützt werden GDI- und DirectDraw-Programme. **OpenGL und Direct3D gehen im Web-Build nicht.**
- .NET- und Java-Programme laufen nicht.
- Die Web-Version ist deutlich langsamer als ein echter PC, gedacht ist sie für ältere Software.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```sh
npm run fetch   # lädt Boxedwine 26R1 und js-dos 8.5.4 nach site/ (einmalig ca. 270 MB, der
                # Server von boxedwine.org ist langsam, das kann ~10 Minuten dauern)
npm run serve   # http://localhost:8080
```

`npm run serve:no-coi` startet den Server ohne COOP/COEP-Header (so verhält sich GitHub Pages).

## Veröffentlichen auf GitHub Pages

1. Repository auf GitHub anlegen und pushen.
2. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
3. Der Workflow `.github/workflows/pages.yml` lädt bei jedem Push auf `main` Boxedwine
   und js-dos herunter und veröffentlicht `site/`.

Die Emulator-Dateien liegen nicht im Repository, sie werden beim Deploy geladen.

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
  js/workspace.js      Dateien, ZIPs und Ordner einlesen, Programme finden
  js/exe.js            DOS/Windows-Erkennung anhand des EXE-Headers
  js/runner.js         gemeinsame Logik: Änderungen sichern/zurückschreiben
  js/emulator.js       Windows-Programme mit Boxedwine
  js/dos.js            DOS-Programme mit js-dos, 8.3-Kurznamen
  js/zip.js            ZIP lesen/schreiben (ohne Abhängigkeiten)
  boxedwine/, jsdos/   werden von scripts/fetch-runtimes.mjs erzeugt (nicht im Git)
scripts/
  fetch-runtimes.mjs   lädt Emulatoren, GPL-Lizenzen und Quellcode
  serve.mjs            lokaler Testserver mit COOP/COEP-Headern
```

## Lizenz

WebExe selbst steht unter der [MIT-Lizenz](LICENSE).
Mit ausgeliefert werden Komponenten anderer Projekte unter eigenen Lizenzen,
siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
