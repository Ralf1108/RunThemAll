# Demo-Dateien im Repository

Fast alle Demos werden beim Build aus ihren Original-Releases geladen (siehe [../README.md](../README.md)).
Die Dateien hier sind die Ausnahme: Für sie gibt es keinen festen Download-Link oder kein fertiges
Format, deshalb liegen sie im Repository. In `demos.json` verweist das Feld `local` auf sie.

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
