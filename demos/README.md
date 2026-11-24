# Demos und Quellenverzeichnis der Spiele

`demos.json` listet freie Programme, Spiele und Betriebssysteme, die auf der Startseite von Run Them All als Demo
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
| Hinweis | Erfüllt Kriterium 1 nicht streng. **Bewusst beibehalten** (Entscheidung vom 24.11.2026), weil der Autor die Datei selbst kostenlos anbietet und Boxedwine sie mit seinem Release verteilt. Bei einem Einwand des Rechteinhabers wird die Demo entfernt. |

### OpenTTD 15.3 mit OpenGFX 8.0 (32 Bit)

| | |
|---|---|
| System / Emulator | Windows (32 Bit) / Boxedwine mit Wine 6 (die Demo stellt Wine 6 ein, im Wine-11-Dateisystem fehlt `winhttp.dll`) |
| Autoren | OpenTTD-Team (Spiel), OpenTTD-Team und Mitwirkende (OpenGFX) |
| Projektseite | https://www.openttd.org/ |
| Download | https://cdn.openttd.org/openttd-releases/15.3/openttd-15.3-windows-win32.zip und https://cdn.openttd.org/opengfx-releases/8.0/opengfx-8.0-all.zip |
| Datei auf der Seite | `demos/windows/openttd-15.3.zip`: das Windows-ZIP ohne den obersten Ordner, dazu `baseset/opengfx-8.0.tar` aus dem OpenGFX-ZIP. Dateien unverändert. |
| Lizenz | GPL-2.0 (OpenTTD und OpenGFX), Quellcode unter https://www.openttd.org/downloads/openttd-releases/latest bzw. https://github.com/OpenTTD |
| Hinweis | Läuft in Boxedwine (getestet am 24.11.2026). Braucht die Wine-Module `winhttp` und `jsproxy`, die das Download-Script in `boxedwine/wine6/win16-extras.zip` ergänzt. Beim Start meldet OpenTTD, dass keine Grafikbeschleunigung verfügbar ist, das ist harmlos. |

### Castle of the Winds 1.1A (Vollversion, 16 Bit)

| | |
|---|---|
| System / Emulator | Windows 3.x (16 Bit) / Boxedwine mit Wine 6 |
| Autor | Rick Saada (SaadaSoft), Vertrieb 1993 durch Epic MegaGames |
| Projektseite | https://classicdosgames.com/game/castle_of_the_winds.html |
| Download | https://classicdosgames.com/files/games/saadasoft/castl11a.zip |
| Inhalt | `CASTLE1.EXE` (Teil 1 „A Question of Vengeance“), `CASTLE2.EXE` (Teil 2 „Lifthransir's Bane“), je eine `.HLP`-Hilfedatei |
| Datei auf der Seite | `demos/win16/castl11a.zip` (695.273 Byte, unverändert). Zwei Demo-Einträge: „Castle of the Winds 1“ startet `CASTLE1.EXE`, „Castle of the Winds 2“ startet `CASTLE2.EXE` |
| Lizenz | **keine ausdrückliche Lizenz.** Laut classicdosgames.com hat der Autor das Spiel als Freeware freigegeben („Author Rick Saada has generously released this game as freeware“). Für dieses Spiel gibt es dort keine eigene Lizenzdatei. Der Startdialog im Spiel enthält noch den alten Shareware-Text von 1993. |
| Hinweis | Erfüllt Kriterium 1 nicht streng, aber ähnlich wie SkiFree vom Autor freigegeben. Bei einem Einwand des Rechteinhabers wird die Demo entfernt. Läuft in Boxedwine (getestet am 24.11.2026). |

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

### Keen Dreams 1.13 (Shareware)

| | |
|---|---|
| System / Emulator | DOS / js-dos (DOSBox) |
| Autoren | id Software, Vertrieb Softdisk (1991/1992) |
| Projektseite | https://classicdosgames.com/game/Keen_Dreams.html |
| Download | https://classicdosgames.com/online/zip/keendr13.zip (dieselben 24 Dateien wie das Original-ZIP https://classicdosgames.com/files/games/id/keendr13.zip, aber mit Deflate statt dem alten PKZIP-Verfahren „Implode“ gepackt, das Run Them All nicht entpacken kann) |
| Datei auf der Seite | `demos/dos/keendr13.zip` (358.813 Byte), gestartet wird `START.EXE` (das Spiel selbst verlangt den Start über dieses Menü) |
| Lizenz | Shareware, voll spielbar. `LICENSE.DOC` im ZIP erlaubt die Weitergabe, solange keine Dateien hinzugefügt oder entfernt werden. |
| Hinweis | Läuft (getestet am 25.11.2026). |

### Star Wars: Dark Forces 0.163D (englische Shareware-Demo)

| | |
|---|---|
| System / Emulator | DOS / js-dos (DOSBox) |
| Autor | LucasArts (1994) |
| Projektseite | https://classicdosgames.com/game/Star_Wars:_Dark_Forces.html |
| Download | https://classicdosgames.com/online/zip/dforces1.zip, die Fassung der Online-Version: Demo plus die optionalen Zwischensequenzen (`dforces2.zip`, `dforces3.zip`) und eine fertige Soundkonfiguration `IMUSE.INI` (Sound Blaster 16). Das Original-ZIP https://classicdosgames.com/files/games/lucasarts/dforces1.zip hat keine Soundkonfiguration, dort bleibt das Spiel ohne Einrichtung stumm. |
| Datei auf der Seite | `demos/dos/dforces1.zip` (9.913.878 Byte), gestartet wird `DF.EXE` |
| Lizenz | Demo mit einem spielbaren Level. `README.TXT` im ZIP: LucasArts erlaubt Kopien und elektronische Weitergabe, solange kein Geld dafür verlangt wird. |
| Hinweis | Läuft (getestet am 25.11.2026). |

### Indiana Jones and the Fate of Atlantis (englische Demo)

| | |
|---|---|
| System / Emulator | DOS / js-dos (DOSBox) |
| Autor | LucasArts (1992) |
| Projektseite | https://classicdosgames.com/game/Indiana_Jones_and_the_Fate_of_Atlantis.html |
| Download | https://classicdosgames.com/online/zip/fatetdt.zip, die bereits installierte Fassung der „Interactive Demonstration“ (das Original-ZIP https://classicdosgames.com/files/games/lucasarts/fatetdt.zip enthält nur ein DOS-Installationsprogramm mit gepackten Daten) |
| Datei auf der Seite | `demos/dos/fatetdt.zip` (659.362 Byte), gestartet wird `PLAYFATE.EXE s` (Sound Blaster; ohne Parameter erwartet die Demo eine Roland-MT-32, die es in DOSBox hier nicht gibt, und bleibt stumm). |
| Lizenz | Demo. `READ.ME` (v2 der Demo): „You may freely copy and distribute this disk provided you do not alter or eliminate any copyright or trademark notices.“ |
| Hinweis | Läuft (getestet am 25.11.2026). |

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

### DOSBox (DOS-Eingabeaufforderung)

| | |
|---|---|
| System / Emulator | Betriebssystem (DOS) / js-dos (DOSBox) |
| Datei auf der Seite | `demos/os/DOSBOX.BAT`, eigene Startdatei aus `demos/local/os/` (zeigt eine kurze Hilfe und endet an der Eingabe `C:\>`) |
| Lizenz | DOSBox und js-dos GPL-2.0 (siehe THIRD_PARTY_NOTICES.md); die Startdatei gehört zu Run Them All (MIT) |

### Tiny Core Linux 17.1

| | |
|---|---|
| System / Emulator | Betriebssystem (PC, bootet von CD) / v86 |
| Autoren | Robert Shingledecker und das Tiny-Core-Team |
| Projektseite | http://tinycorelinux.net/ |
| Download | http://tinycorelinux.net/17.x/x86/release/TinyCore-17.1.iso |
| Datei auf der Seite | `demos/os/TinyCore-17.1.iso` (27.262.976 Byte, unverändert) |
| Lizenz | GPL-2.0 (Linux-Kernel, BusyBox u. a.), Quellcode unter http://tinycorelinux.net/17.x/x86/release/src/ |
| Hinweis | Bootet in v86 mit 128 MB RAM bis zum grafischen Desktop (getestet am 24.11.2026). |

### KolibriOS 0.7.7.0+8930

| | |
|---|---|
| System / Emulator | Betriebssystem (PC, bootet von Diskette) / v86 |
| Autoren | KolibriOS-Team |
| Projektseite | https://kolibrios.org/ |
| Datei auf der Seite | `demos/os/kolibri.img` (1.474.560 Byte), liegt im Repository unter `demos/local/os/`, Herkunft siehe [local/README.md](local/README.md) |
| Lizenz | GPL-2.0, Quellcode https://git.kolibrios.org/KolibriOS/kolibrios (Commit `d50642c`) |
| Hinweis | Bootet in v86 in wenigen Sekunden bis zum Desktop (getestet am 24.11.2026). |

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
| Calculator 2.0 / 1.0 (win31-calc-unified, Juan Sicilia) | Windows 3.x (16 Bit) | MIT ([LICENSE](https://github.com/siciliajuan/win31-calc-unified/blob/HEAD/LICENSE)) | https://github.com/siciliajuan/win31-calc-unified/releases (v2.0.0, 1.0) | stürzt in Boxedwine (Wine 6, Single- und Multithread) direkt beim Start ab („Unhandled page fault on read access to FFFFFFFF“); `SETUP.EXE` aus demselben Release genauso. Gebaut mit Open Watcom, Ursache noch offen (getestet am 24.11.2026) |
| Tobu Tobu Girl (Simon Larsen) | Game Boy | Code MIT, Grafik CC-BY | https://github.com/SimonLarsen/tobutobugirl | kein Release mit ROM auf GitHub |

## Offene Fragen

- **Mit Open Watcom gebaute Win16-Programme** (Calculator, selbst kompiliertes WineMine) stürzen in Boxedwine beim Start ab, Castle of the Winds (anderer Compiler) läuft. Ursache noch offen.
- **Amiga-Demo**: fehlt noch. Blocky Skies wäre technisch geeignet, braucht aber die Zustimmung des Autors.

## Format von `demos.json`

| Feld | Bedeutung |
|---|---|
| `id` | eindeutiger Name |
| `title`, `platform`, `emulator`, `description` | Anzeige auf der Startseite |
| `author`, `homepage`, `license` | Credits (werden auf der Karte angezeigt) |
| `url` | Download aus dem Original-Release |
| `local` | statt `url`: Datei unter `demos/local/` im Repository (siehe [local/README.md](local/README.md)) |
| `entry` | optional: Datei innerhalb eines ZIP, die übernommen wird |
| `strip` | optional: Ordner am Anfang der Pfade im ZIP, der entfernt wird |
| `add` | optional: weitere Dateien aus anderen Downloads, die ins ZIP kommen (`url`, `entry`, `path`) |
| `wine` | optional: Wine-Version, die die Demo braucht (`wine6` oder `wine11`) |
| `args` | optional: Parameter für das DOS-Programm, z. B. die Soundkarte |
| `cycles` | optional: feste DOSBox-Geschwindigkeit (Zyklen) für diese Demo |
| `note` | optional: Hinweis zur Herkunft |
| `file` | Pfad unter `site/demos/` |
| `start` | Programm bzw. Spieldatei, die gestartet wird |
| `system` | optional: System aus `site/js/systems.js`, z. B. ein EmulatorJS-System oder `pc` für v86 |
