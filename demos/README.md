# Demos and their sources

[← Back to the README](../README.md)

`demos.json` lists the free programs, games and operating systems offered as demos on the start page.

- The files are **not** in this repository (with a few exceptions in [local/](local/README.md)).
- `scripts/fetch-runtimes.mjs` downloads them from their original releases (cached in `vendor/demos/`)
  into `site/demos/`, so they are published together with the website.
- Research as of November 2026.

## Rules for adding a demo

1. The licence must clearly allow sharing (free licence or explicit permission).
2. A fixed download link from an official release, ideally a versioned GitHub release.
3. It must run without an original BIOS (e.g. Amiga only with the free AROS Kickstart).
4. No fan games of other people's brands.

## Included demos

### Operating systems

**DOSBox (DOS prompt)**: js-dos (DOSBox)
- File: `demos/os/DOSBOX.BAT`, our own start file from `demos/local/os/` (shows a short help and stops at `C:\>`)
- Licence: DOSBox and js-dos GPL-2.0 (see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)); the start file is part of RunThemAll (MIT)

**Tiny Core Linux 17.1**: v86, boots from CD
- Authors: Robert Shingledecker and the Tiny Core team, http://tinycorelinux.net/
- Download: http://tinycorelinux.net/17.x/x86/release/TinyCore-17.1.iso
- File: `demos/os/TinyCore-17.1.iso` (27,262,976 bytes, unchanged)
- Licence: GPL-2.0 (Linux kernel, BusyBox, …), source: http://tinycorelinux.net/17.x/x86/release/src/
- Boots to the graphical desktop with 128 MB RAM (tested 24 Nov 2026)

**KolibriOS 0.7.7.0+8930**: v86, boots from floppy
- Authors: KolibriOS team, https://kolibrios.org/
- File: `demos/os/kolibri.img` (1,474,560 bytes), stored in the repository under `demos/local/os/`, origin see [local/README.md](local/README.md)
- Licence: GPL-2.0, source: https://git.kolibrios.org/KolibriOS/kolibrios (commit `d50642c`)
- Boots to the desktop in a few seconds (tested 24 Nov 2026)

**ReactOS 0.4.15 (live CD)**: v86 with 512 MB RAM, boots from CD
- Authors: ReactOS project, https://reactos.org/
- Download: https://github.com/reactos/reactos/releases/download/0.4.15-release/ReactOS-0.4.15-release-1-gdbb43bbaeb2-x86-live.zip
- File: `demos/os/reactos-0.4.15-live-<start>-<end>.iso.zst`: the ISO (300,941,312 bytes) split into 287 parts
  of 1 MB, each compressed with zstd (~64 MB in total). v86 only loads the parts ReactOS reads. This keeps
  every file under the 100 MB limit of GitHub Pages.
- Licence: GPL-2.0 (and other free licences for some parts), source: https://github.com/reactos/reactos/tree/0.4.15-release
- Boots to the welcome dialog of the live CD (tested 25 Nov 2026, at most 5 minutes)

### Windows (32 bit)

**SkiFree 1.04**: Boxedwine
- Author: Chris Pirih, https://ski.ihoc.net/
- Taken from: the Boxedwine web release 26R1.0, file `SingleThreaded/ski32.zip` in
  https://github.com/danoon2/Boxedwine/releases/download/26R1.0/Boxedwine26R1Web.zip
- File: `demos/windows/ski32.zip` (39,491 bytes), starts `ski32.exe`
- Licence: **no explicit licence.** The author offers the 32-bit version for free on his website, and
  Boxedwine includes it as an example. SkiFree first came out in 1991 as a Microsoft product
  (Microsoft Entertainment Pack), licensed from the author.
- Does not strictly meet rule 1. **Kept on purpose** (decision of 24 Nov 2026), because the author offers it
  himself and Boxedwine distributes it. Will be removed if the rights holder objects.

**OpenTTD 15.3 with OpenGFX 8.0**: Boxedwine with Wine 6 (the Wine 11 file system lacks `winhttp.dll`)
- Authors: OpenTTD team (game), OpenTTD team and contributors (OpenGFX), https://www.openttd.org/
- Download: https://cdn.openttd.org/openttd-releases/15.3/openttd-15.3-windows-win32.zip and
  https://cdn.openttd.org/opengfx-releases/8.0/opengfx-8.0-all.zip
- File: `demos/windows/openttd-15.3.zip`: the Windows ZIP without its top folder, plus `baseset/opengfx-8.0.tar`
  from the OpenGFX ZIP. Files unchanged.
- Licence: GPL-2.0 (OpenTTD and OpenGFX), source: https://www.openttd.org/downloads/openttd-releases/latest, https://github.com/OpenTTD
- Needs the Wine modules `winhttp` and `jsproxy`, added by the fetch script. The message about missing
  graphics acceleration at start is harmless. Runs (tested 24 Nov 2026).

### Windows 3.x (16 bit)

**Castle of the Winds 1.1A (full version)**: Boxedwine with Wine 6
- Author: Rick Saada (SaadaSoft), published 1993 by Epic MegaGames,
  https://classicdosgames.com/game/castle_of_the_winds.html
- Download: https://classicdosgames.com/files/games/saadasoft/castl11a.zip
- File: `demos/win16/castl11a.zip` (695,273 bytes, unchanged). Two demo entries: part 1 starts `CASTLE1.EXE`,
  part 2 starts `CASTLE2.EXE`.
- Licence: **no explicit licence.** According to classicdosgames.com the author released it as freeware
  ("Author Rick Saada has generously released this game as freeware"). The start dialog still shows
  the old shareware text from 1993.
- Like SkiFree, does not strictly meet rule 1 but was released by the author. Will be removed if the rights
  holder objects. Runs (tested 24 Nov 2026).

### DOS

**Keen Dreams 1.13 (shareware)**: js-dos
- Authors: id Software, published by Softdisk (1991/1992), https://classicdosgames.com/game/Keen_Dreams.html
- Download: https://classicdosgames.com/online/zip/keendr13.zip (the same 24 files as the original ZIP
  https://classicdosgames.com/files/games/id/keendr13.zip, but packed with Deflate instead of the old
  "Implode" method that RunThemAll cannot unpack)
- File: `demos/dos/keendr13.zip` (358,813 bytes), starts `START.EXE` (the game requires this menu)
- Licence: shareware, fully playable. `LICENSE.DOC` allows sharing as long as no files are added or removed.

**Star Wars: Dark Forces 0.163D (English shareware demo)**: js-dos
- Author: LucasArts (1994), https://classicdosgames.com/game/Star_Wars:_Dark_Forces.html
- Download: https://classicdosgames.com/online/zip/dforces1.zip, the version of the online player: demo plus the
  optional cut scenes and a ready sound setup `IMUSE.INI` (Sound Blaster 16). The original ZIP has no sound setup
  and stays silent.
- File: `demos/dos/dforces1.zip` (9,913,878 bytes), starts `DF.EXE`
- Licence: demo with one playable level. `README.TXT`: LucasArts allows copies and electronic distribution
  as long as no money is charged.

**Indiana Jones and the Fate of Atlantis (English demo)**: js-dos
- Author: LucasArts (1992), https://classicdosgames.com/game/Indiana_Jones_and_the_Fate_of_Atlantis.html
- Download: https://classicdosgames.com/online/zip/fatetdt.zip, the installed "Interactive Demonstration"
  (the original ZIP only contains a DOS installer)
- File: `demos/dos/fatetdt.zip` (659,362 bytes), starts `PLAYFATE.EXE s` (Sound Blaster; without the parameter the
  demo expects a Roland MT-32 and stays silent)
- Licence: demo. `READ.ME`: "You may freely copy and distribute this disk provided you do not alter or
  eliminate any copyright or trademark notices."

**Boppin' 1.1 (shareware episode)**: js-dos
- Authors: Accursed Toys (Jennifer Diane Reitz, Michael Lee Reitz), published by Apogee Software (1994),
  https://classicdosgames.com/game/Boppin%27.html
- Download: https://classicdosgames.com/files/games/accursed/1bop11.zip (Apogee installer)
- File: `demos/dos/boppin-sw11.zip`, stored in the repository under `demos/local/dos/`: installed once in DOSBox and
  set to Sound Blaster, origin see [local/README.md](local/README.md). Starts `BOPSW.EXE`.
- Licence: shareware. `VENDOR.DOC`: "Everyone can -- and is encouraged! -- to copy, upload and generally pass
  around this Program without charging for it."
- The full version is not included: classicdosgames calls it freeware, but its `LICENSE.DOC` forbids sharing
  without Apogee's permission, and the author's website mentions no release.

**Doom 1.9 (shareware)**: js-dos, multiplayer
- Author: id Software (1993), https://classicdosgames.com/game/Doom.html
- Download: https://classicdosgames.com/online/zip/doom19s.zip, the installed shareware of the online player
  (the original https://classicdosgames.com/files/games/id/doom19s.zip only contains the DEICE installer)
- File: `demos/dos/doom19s.zip` (2,357,553 bytes), starts `DOOM.EXE`
- Licence: shareware of id Software, free to share. The installed ZIP has no licence file; the licence is in
  the original package (LHA-packed, not checked yet).

**Heretic 1.2 (shareware)**: js-dos, multiplayer
- Authors: Raven Software, published by id Software (1994), https://classicdosgames.com/game/Heretic.html
- Download: https://classicdosgames.com/online/zip/htic_v12.zip (installed shareware)
- File: `demos/dos/htic_v12.zip` (2,794,877 bytes), starts `HERETIC.EXE`
- Licence: `LICENSE.DOC`: "ID grants to you the right to distribute, royalty free and by electronic means only,
  the Software; provided, however the Software must be so distributed only in compressed format." No money.

**Duke Nukem 3D 1.3D (shareware)**: js-dos, multiplayer
- Author: 3D Realms (Apogee Software, 1996), https://classicdosgames.com/game/Duke_Nukem_3D.html
- Download: https://classicdosgames.com/online/zip/3dduke13.zip (installed shareware)
- File: `demos/dos/3dduke13.zip` (5,691,448 bytes), starts `DUKE3D.EXE`
- Licence: `LICENSE.TXT`: individuals may give copies away without charge, and free WWW and FTP sites may offer the
  game for download, with all files unchanged and no copyright notices removed.

**Multiplayer** (field `netplay`): in a room of the Multiplayer panel with two or more players, these demos start
the network setup of the game instead of the game, with the number of players in the room: Doom and Heretic
`IPXSETUP.EXE -nodes <n> -deathmatch`, Duke Nukem 3D `COMMIT.EXE` with a `COMMIT.DAT` written before
(`COMMTYPE = 3` = IPX network, `NUMPLAYERS = <n>`). The host starts first, the others follow. In Duke Nukem 3D one
player (COMMIT picks the "master", not always the room's host) chooses New Game → Start Game, the others see
"Waiting for master". Tested 28 Nov 2026 with two browsers in one room (local relay): Doom and Heretic deathmatch
and Duke Nukem 3D reach the first level together. Two windows of one browser work too; two tabs do not (the hidden
tab is throttled and IPXSETUP never finds the other player).

All DOS demos run (tested 25 Nov 2026, the multiplayer demos 28 Nov 2026).

### Consoles and home computers

**T-Rex 64 1.0.2**: Commodore 64, EmulatorJS with VICE (`vice_x64sc`)
- Author: Maciej Małecki, https://github.com/maciejmalecki/trex64
- Download: https://github.com/maciejmalecki/trex64/releases/download/1.0.2/trex.zip
- File: `demos/c64/rex.d64` (174,848 bytes, taken from the ZIP)
- Licence: MIT, https://github.com/maciejmalecki/trex64/blob/master/LICENSE

**Pink Wall 1.0.1**: Super Nintendo, EmulatorJS with Snes9x
- Authors: Luciano C. Siqueira and BrunoRNS (school capstone project, IFPR Campus Cascavel), https://github.com/LucianoCSiqueira/pinkwall
- Download: https://github.com/LucianoCSiqueira/pinkwall/releases/download/v1.0.1/PinkWall.sfc
- File: `demos/snes/pinkwall.sfc` (1,048,576 bytes, unchanged)
- Licence: GPL-3.0 (https://github.com/LucianoCSiqueira/pinkwall/blob/HEAD/LICENSE), source in the repository.
  The music `pollen8.it` comes from the PVSnesLib examples (MIT).
- Only the name and theme allude to Pink Floyd's album "The Wall"; no material from it is used. Accepted as an
  exception to rule 4 (decision of 25 Nov 2026) to have an SNES demo with sound.
- Runs with music (tested 25 Nov 2026).

**Horizontal Shooter 1.1**: Super Nintendo, EmulatorJS with Snes9x
- Author: Marcus Rowe (undisbeliever), https://github.com/undisbeliever/horizontal-shooter
- Download: https://github.com/undisbeliever/horizontal-shooter/releases/download/v1.1/horizontal-shooter-v1.1.zip
- File: `demos/snes/horizontal-shooter.sfc` (131,072 bytes, taken from the ZIP)
- Licence: code MIT (https://github.com/undisbeliever/horizontal-shooter/blob/master/LICENSE), graphics CC0 (README)
- Runs (tested 25 Nov 2026). Controls: D-pad and B, on the keyboard arrow keys and X.
- **Has no sound**: the ROM never talks to the SNES sound chip (checked), so the title says "no sound".

**Nova the Squirrel 1.0.6a**: NES, EmulatorJS with FCEUmm
- Author: NovaSquirrel, https://github.com/NovaSquirrel/NovaTheSquirrel
- Download: https://github.com/NovaSquirrel/NovaTheSquirrel/releases/download/v1.0.6a/nova.nes
- File: `demos/nes/nova.nes` (262,160 bytes, unchanged)
- Licence: GPL-3.0, https://github.com/NovaSquirrel/NovaTheSquirrel/blob/master/LICENSE.txt, source: tag `v1.0.6a`

**µCity 1.3**: Game Boy Color, EmulatorJS with Gambatte
- Author: Antonio Niño Díaz, https://github.com/AntonioND/ucity
- Download: https://github.com/AntonioND/ucity/releases/download/v1.3/ucity.gbc
- File: `demos/gb/ucity.gbc` (131,072 bytes, unchanged)
- Licence: GPL-3.0, https://github.com/AntonioND/ucity/blob/master/gpl-3.0.txt, source: tag `v1.3`

## Checked but not included

| Candidate | System | Licence | Reason |
|---|---|---|---|
| [Plouf! 1.1](https://agateau.com/projects/plouf/) (Aurélien Gâteau) | Amiga | GPL-3.0 | does not start with the free AROS Kickstart (AMOS program needs the real one) |
| [Lupengo](https://lupengo.sourceforge.net/lupamiga.php.html) (Carlo Borreo) | Amiga | GPL | does not start with AROS (blue screen) |
| [Blocky Skies 0.73](http://alpine9000.github.io/blockyskies/) (alpine9000) | Amiga | code BSD-2, music CC-BY 4.0, **graphics "All rights reserved"**, one sound CC-BY-NC 3.0 ([LEGAL](http://alpine9000.github.io/blockyskies/LEGAL.html)) | runs fine with AROS, but sharing the graphics is not allowed; only with the author's permission |
| [Famidash](https://github.com/tfdsoft/famidash) (tfdsoft) | NES | MIT | fan game of another brand (Geometry Dash) |
| [8 bit island](https://gpowerf.itch.io/8-bit-island) (gpowerf) | C64 | MIT (per itch.io) | only on itch.io, no fixed download link |
| [Galactor](https://drludos.itch.io/galactor) (Dr. Ludos) | NES | code MIT, graphics/sound CC-BY | only on itch.io |
| [Sprilo](https://cmrn.itch.io/sprilo) (cmrn) | NES | MIT | only on itch.io |
| [Jump N Bump, Amiga port](https://earok.itch.io/jump-n-bump) (earok) | Amiga | GPL-3.0 | only on itch.io |
| [Calculator 2.0 / 1.0](https://github.com/siciliajuan/win31-calc-unified/releases) (Juan Sicilia) | Windows 3.x | MIT | crashes in Boxedwine at start ("Unhandled page fault on read access to FFFFFFFF"), also its `SETUP.EXE`; built with Open Watcom, cause unknown |
| [Tobu Tobu Girl](https://github.com/SimonLarsen/tobutobugirl) (Simon Larsen) | Game Boy | code MIT, graphics CC-BY | no GitHub release with a ROM |
| [Space Rescue Squad](https://github.com/undisbeliever/space-rescue-squad) (undisbeliever) | Super Nintendo | code zlib, **graphics only for this game** | no permission to share the graphics |
| [BomberWorld](https://github.com/1r3n33/bomberworld) (1r3n33) | Super Nintendo | no licence | no licence |
| SNES games of [retrobrews/snes-games](https://github.com/retrobrews/snes-games) | Super Nintendo | various | approved for distribution in that collection only |

Open questions:
- **Win16 programs built with Open Watcom** (Calculator, a self-compiled WineMine) crash in Boxedwine at start;
  Castle of the Winds (other compiler) runs.
- **Amiga demo** still missing. Blocky Skies would work technically but needs the author's permission.

## Format of `demos.json`

| Field | Meaning |
|---|---|
| `id` | unique name |
| `title`, `platform`, `emulator`, `description` | shown on the start page (one tile per `platform`, in file order) |
| `author`, `homepage`, `license` | credits shown in the demo info |
| `url` | download from the original release |
| `local` | instead of `url`: a file under `demos/local/` (see [local/README.md](local/README.md)) |
| `entry` | optional: file inside a ZIP to take |
| `strip` | optional: folder at the start of the paths in the ZIP to remove |
| `add` | optional: more files from other downloads to put into the ZIP (`url`, `entry`, `path`) |
| `wine` | optional: Wine version the demo needs (`wine6` or `wine11`) |
| `args` | optional: command line arguments for the DOS program, e.g. the sound card |
| `netplay` | optional, DOS: in a multiplayer room with 2+ players start `start` with `args` instead, after the DOS commands in `prelude`; `{players}` becomes the number of players |
| `cycles` | optional: fixed DOSBox speed (cycles) |
| `memory` | optional: RAM in MB for v86 |
| `chunk` | optional: split a large disk image into zstd-compressed parts of this size, loaded on demand by v86 |
| `note` | optional: note on the origin |
| `file` | path under `site/demos/` |
| `start` | program or game file to start |
| `system` | optional: system from `site/js/systems.js`, e.g. an EmulatorJS system or `pc` for v86 |
