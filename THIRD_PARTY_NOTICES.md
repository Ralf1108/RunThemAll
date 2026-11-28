# Third-party components

RunThemAll is an aggregator: these components are **not** part of this repository. They are downloaded
by `scripts/fetch-runtimes.mjs` and published together with the website. For each one, its licence text
and source code are published next to it.

## Boxedwine (master 0fa70a84, file systems of 26R1.0)

- Project: https://github.com/danoon2/Boxedwine
- Licence: GNU General Public License v2.0 (`boxedwine/LICENSE-GPL-2.0.txt`)
- Emulator (`boxedwine.js`, `boxedwine.wasm`): built by RunThemAll from the unchanged source of
  commit 0fa70a84 of the master branch (`scripts/build-boxedwine.mjs`). `boxedwine.js` is changed
  in one place (screen size, see `boxedwine/README-boxedwine.txt`).
- Used unchanged: the file system with Wine 6.0 from the official release `Boxedwine26R1Web.zip`,
  and the web file system with Wine 11.0 (version 48) from https://boxedwine.org/v2/48/TinyCore15Wine11.0-web.zip
- Added: `boxedwine/wine6/win16-extras.zip` with Wine 6.0 modules missing from the web file system
  (16-bit modules such as WinG, toolhelp, ole2, plus `winhttp` and `jsproxy` for OpenTTD).
  Taken unchanged from the full Boxedwine file system http://boxedwine.org/v2/2/TinyCore15Wine6.0.zip
  (Wine, LGPL-2.1+).
- Source code: `boxedwine/source/Boxedwine-0fa70a84-source.tar.gz` (emulator, also
  https://github.com/danoon2/Boxedwine/tree/0fa70a84992fb5bf638f05eaf889e0b465282d90) and
  `boxedwine/source/Boxedwine-26R1.0-source.tar.gz` (release)

The file system archives contain Wine (LGPL-2.1 or later) and parts of Tiny Core Linux (GPL); their
licences are in the archives or with the upstream projects.

## js-dos 8.5.4 with emulators 8.5.3 (DOSBox)

- Projects: https://github.com/caiiiycuk/js-dos, https://github.com/caiiiycuk/emulators,
  https://github.com/js-dos/dosbox
- Licence: GNU General Public License v2.0 (`jsdos/LICENSE-GPL-2.0.txt`)
- Used: unchanged files from the npm package `js-dos@8.5.4`
- Source code: `jsdos/source/`: js-dos `v8.5.4`, emulators `v8.5.3` and the DOSBox fork used by
  emulators 8.5.3 (commit `528578d`)
- All files are served by this site; nothing is loaded from the js-dos CDN. js-dos local storage is off.

## EmulatorJS (newest stable version, currently 4.2.3) with libretro cores

- Project: https://github.com/EmulatorJS/EmulatorJS, https://emulatorjs.org
- Licence: GNU General Public License v3.0 (`emulatorjs/LICENSE-GPL-3.0.txt`)
- Used: unchanged npm package `@emulatorjs/emulatorjs` (folder `data/`) and one core package
  `@emulatorjs/core-<name>` per system in the same version (npm tag `latest`)
- The npm package only has unminified sources; they are joined unchanged into `emulator.min.js`
  (same order as in `loader.js`), `emulator.css` is copied as `emulator.min.css`.
- Source code: `emulatorjs/source/EmulatorJS-<version>-source.tar.gz`
- Cores: every core file (`*.data`) contains its own licence text. `emulatorjs/cores.html` lists all cores
  with version, source repository and licence file. **Some cores do not allow commercial use**, e.g.
  Snes9x, Genesis Plus GX, PicoDrive, FBNeo and MAME 2003-Plus.
- BIOS: RunThemAll ships no BIOS files. Some cores include free replacements (AROS Kickstart in PUAE,
  HLE BIOS in mGBA, melonDS, PCSX ReARMed, Yabause; VICE, Fuse and Caprice32 bring their own ROMs).
- Network: EmulatorJS requests `https://cdn.emulatorjs.org/stable/data/version.json` at start to hint at
  new versions (no user data). All emulator files come from this site; netplay is hidden.

## v86 0.5.476 with SeaBIOS 1.16.2

- Project: https://github.com/copy/v86, https://copy.sh/v86/
- Licence: BSD-2-Clause (v86, `v86/LICENSE-BSD-2-Clause.txt`), GNU Lesser General Public License v3.0
  (SeaBIOS, `v86/bios/LICENSE-LGPL-3.0.txt`)
- Used: unchanged files from the npm package `v86@0.5.476` (`libv86.mjs`, `v86.wasm`) and the BIOS images
  `seabios.bin` and `vgabios.bin` from the `bios/` folder of the same v86 commit (`9457e7a`)
- Source code: `v86/source/`: v86 (commit `9457e7a`) and SeaBIOS `rel-1.16.2`

## Demo programs

Downloaded from their original releases and published under `demos/`. Full list with download links,
versions, licence texts and the games that were checked but not included: [demos/README.md](demos/README.md).

| Demo | Author | Licence | Source |
|---|---|---|---|
| SkiFree 1.04 | Chris Pirih | no explicit licence; offered for free by the author | example in the Boxedwine web release 26R1.0 |
| OpenTTD 15.3 with OpenGFX 8.0 | OpenTTD team | GPL-2.0 | openttd.org |
| Castle of the Winds 1.1A | Rick Saada (SaadaSoft) | no explicit licence; released as freeware by the author | classicdosgames.com |
| Tiny Core Linux 17.1 | Tiny Core team | GPL-2.0 | tinycorelinux.net |
| KolibriOS 0.7.7.0+8930 | KolibriOS team | GPL-2.0 | kolibrios.org (file in the repository, see demos/local/README.md) |
| Keen Dreams 1.13 | id Software / Softdisk | shareware, free to share | classicdosgames.com |
| Star Wars: Dark Forces (demo) | LucasArts | demo, free distribution allowed | classicdosgames.com |
| Indiana Jones and the Fate of Atlantis (demo) | LucasArts | demo, free distribution allowed | classicdosgames.com |
| Boppin' 1.1 (shareware episode) | Accursed Toys / Apogee | shareware, sharing without charge allowed (VENDOR.DOC) | classicdosgames.com, preinstalled in demos/local |
| Doom 1.9 (shareware) | id Software | shareware, free to share | classicdosgames.com |
| Heretic 1.2 (shareware) | Raven Software / id Software | shareware, electronic distribution allowed (LICENSE.DOC) | classicdosgames.com |
| Duke Nukem 3D 1.3D (shareware) | 3D Realms / Apogee | shareware, free sharing and free download sites allowed (LICENSE.TXT) | classicdosgames.com |
| ReactOS 0.4.15 (live CD) | ReactOS project | GPL-2.0 | github.com/reactos/reactos |
| T-Rex 64 1.0.2 | Maciej Małecki | MIT | github.com/maciejmalecki/trex64 |
| Pink Wall 1.0.1 | Luciano C. Siqueira, BrunoRNS | GPL-3.0 (source in the linked repository) | github.com/LucianoCSiqueira/pinkwall |
| Horizontal Shooter 1.1 | Marcus Rowe (undisbeliever) | MIT (code), CC0 (graphics) | github.com/undisbeliever/horizontal-shooter |
| Nova the Squirrel 1.0.6a | NovaSquirrel | GPL-3.0 (source in the linked repository) | github.com/NovaSquirrel/NovaTheSquirrel |
| µCity 1.3 | Antonio Niño Díaz | GPL-3.0 (source in the linked repository) | github.com/AntonioND/ucity |

## Platform logos (`site/img/platforms/`)

The logos on the demo tiles only show which platform a demo belongs to. The trademarks belong to their
owners (Microsoft, Commodore, Nintendo); RunThemAll is not affiliated with them.

| File | Shows | Licence | Source |
|---|---|---|---|
| windows.svg | Windows flag (2002–2012, coloured) | public domain (simple shapes), trademark of Microsoft | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unofficial_Windows_logo_variant_-_2002%E2%80%932012_(Multicolored).svg) |
| windows3.svg | Windows logo from 1992 | public domain (simple shapes), trademark of Microsoft | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Windows_logo_-_1992.svg) |
| dos.svg | MS-DOS logo | MIT, [Devicon](https://github.com/devicons/devicon) (konpa) | via [Iconify](https://icon-sets.iconify.design/devicon/msdos/) |
| commodore.svg | Commodore emblem, coloured | CC0, shape from [Simple Icons](https://simpleicons.org/?q=commodore) | colours added by us |
| snes.svg | SNES controller | CC0, DhulKarnain (Open Clip Art Library) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SNES_controller.svg) |
| nes.svg | NES controller | CC BY-SA 3.0, Fant0men | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nes_controller.svg) |
| gameboy.svg | handheld | CC BY 4.0, [Streamline](https://www.streamlinehq.com/) (Plump color) | via [Iconify](https://icon-sets.iconify.design/streamline-plump-color/gameboy/) |
| cd.svg | CD | Apache-2.0, [Noto Emoji](https://github.com/googlefonts/noto-emoji) (Google) | via [Iconify](https://icon-sets.iconify.design/noto/optical-disk/) |

## coi-serviceworker v0.1.7

- Project: https://github.com/gzuidhof/coi-serviceworker
- Licence: MIT, Copyright (c) 2021 Guido Zuidhof
- Used: `coi-serviceworker.js` (commit 7b1d2a0)
