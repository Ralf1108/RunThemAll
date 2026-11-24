# Demo-Dateien im Repository

Fast alle Demos werden beim Build aus ihren Original-Releases geladen (siehe [../README.md](../README.md)).
Die Dateien hier sind die Ausnahme: Für sie gibt es keinen festen Download-Link oder kein fertiges
Format, deshalb liegen sie im Repository. In `demos.json` verweist das Feld `local` auf sie.

## `os/DOSBOX.BAT` – DOS-Eingabeaufforderung

Eigene Startdatei (MIT, Teil von Run Them All). DOSBox führt sie aus, sie zeigt ein paar Befehle und
endet an der Eingabe `C:\>`. So lässt sich DOSBox wie ein leerer DOS-PC starten.

## `dos/boppin-sw11.zip` – Boppin’ 1.1 Shareware-Episode, installiert

| | |
|---|---|
| Quelle | https://classicdosgames.com/files/games/accursed/1bop11.zip (Apogee-Installer `INSTALL.EXE` mit Archiv `BOPSW11.SHR`) |
| Erstellt | am 25.11.2026 in DOSBox (js-dos) mit `INSTALL.EXE` nach `C:\BOPPIN` installiert, danach `SETUP.EXE`: Sound Blaster für Effekte und Musik. Die installierten Dateien plus `FILE_ID.DIZ` aus dem Paket, Datum der Einträge auf 09.12.1994 gesetzt. |
| Inhalt | `BOPSW.EXE`, `BOPSW.RES`, `BOPHELP.EXE`, `SETUP.EXE`, `BOPPIN.CFG`, `ORDER.FRM`, `VENDOR.DOC`, `FILE_ID.DIZ` |
| SHA-256 | `07686c6eb5dc5ceecff86faa8a8186b7b90cacae5c850bebbf63faf7e8bc094f` |
| Lizenz | Shareware, Weitergabe ohne Gebühr erlaubt (`VENDOR.DOC`) |

Warum im Repository: Das Paket enthält nur ein Installationsprogramm, das man im Browser erst durchklicken müsste.

## `os/kolibri.img` – KolibriOS 0.7.7.0+8930

| | |
|---|---|
| Projekt | https://kolibrios.org/, Quellcode https://git.kolibrios.org/KolibriOS/kolibrios |
| Lizenz | GPL-2.0 (Kernel und die meisten Programme; einzelne Programme haben eigene freie Lizenzen) |
| Bezogen von | https://builds.kolibrios.org/en_US/kolibrios-0.7.7.0+8930-d50642c-img.7z (Nightly-Build, wird dort später ersetzt) |
| Inhalt | `kolibri.img` unverändert aus dem 7z-Archiv entpackt (1.474.560 Byte) |
| Quellcode-Stand | Commit `d50642c` im KolibriOS-Repository |
| SHA-256 | `3ff24874235e2c4d39ba7cd7fb7a2ceb32a45923c0604ec17a8505c0a3a04cc2` |

Warum im Repository: Die Builds gibt es nur als 7z (Node.js kann das ohne Zusatzpaket nicht entpacken),
und ältere Nightly-Builds verschwinden vom Server.
