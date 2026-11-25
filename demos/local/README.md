# Demo files stored in the repository

[← Back to the demo list](../README.md)

Almost all demos are downloaded from their original releases at build time. The files here are the
exception: there is no fixed download link or no ready-to-use format for them, so they are stored in
the repository. In `demos.json` the field `local` points to them.

## `os/DOSBOX.BAT`: DOS prompt

- Our own start file (MIT, part of Run Them All).
- DOSBox runs it; it shows a few commands and stops at the `C:\>` prompt, so DOSBox starts like an empty DOS PC.

## `dos/boppin-sw11.zip`: Boppin' 1.1 shareware episode, installed

- Source: https://classicdosgames.com/files/games/accursed/1bop11.zip (Apogee installer `INSTALL.EXE` with the archive `BOPSW11.SHR`)
- Made on 25 Nov 2026 in DOSBox (js-dos): installed with `INSTALL.EXE` to `C:\BOPPIN`, then `SETUP.EXE` set to
  Sound Blaster for effects and music. The installed files plus `FILE_ID.DIZ` from the package, entry dates set to 9 Dec 1994.
- Contents: `BOPSW.EXE`, `BOPSW.RES`, `BOPHELP.EXE`, `SETUP.EXE`, `BOPPIN.CFG`, `ORDER.FRM`, `VENDOR.DOC`, `FILE_ID.DIZ`
- SHA-256: `07686c6eb5dc5ceecff86faa8a8186b7b90cacae5c850bebbf63faf7e8bc094f`
- Licence: shareware, sharing without charge allowed (`VENDOR.DOC`)
- Why in the repository: the package only contains an installer you would have to click through in the browser first.

## `os/kolibri.img`: KolibriOS 0.7.7.0+8930

- Project: https://kolibrios.org/, source: https://git.kolibrios.org/KolibriOS/kolibrios (commit `d50642c`)
- Licence: GPL-2.0 (kernel and most programs; some programs have their own free licences)
- Taken from: https://builds.kolibrios.org/en_US/kolibrios-0.7.7.0+8930-d50642c-img.7z (nightly build, replaced there later)
- Contents: `kolibri.img` unpacked unchanged from the 7z archive (1,474,560 bytes)
- SHA-256: `3ff24874235e2c4d39ba7cd7fb7a2ceb32a45923c0604ec17a8505c0a3a04cc2`
- Why in the repository: the builds only come as 7z (Node.js cannot unpack it without an extra package),
  and older nightly builds disappear from the server.
