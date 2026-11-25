# Supported systems

[← Back to the README](../README.md)

RunThemAll looks at each file and picks the matching emulator by itself. If it is not sure
(e.g. `.bin`, `.iso`, `.tap`), it suggests the most likely system and you can change it before starting.

## PC programs

| What | Files | Emulator |
|---|---|---|
| DOS | `.exe`, `.com`, `.bat`, also DOS/4GW games | js-dos (DOSBox) |
| Windows 3.x (16 bit) | `.exe` | Boxedwine with Wine 6 |
| Windows 95 to XP (32 bit) | `.exe` | Boxedwine with Wine 6 or Wine 11 |
| Batch files | `.bat` | Windows if Windows programs are next to it, otherwise DOS |

- Long file names are turned into DOS short names (`My Game` → `MYGAME~1`) and back when saving.
- Windows: no 3D graphics (OpenGL, Direct3D), no .NET, no Java.

## Complete operating systems

| What | Files | Emulator |
|---|---|---|
| Bootable CD | `.iso` | v86 (x86 PC with SeaBIOS) |
| Floppy disk | `.img`, `.ima`, `.vfd`, `.flp` | v86 |
| Hard disk | `.img`, `.vhd`, `.raw` | v86 |

Use the button **"Start your own operating system"**. The image boots like a real PC.
The RAM size can be changed in the options (default 128 MB).

## Consoles and home computers

All run with [EmulatorJS](https://emulatorjs.org) and one libretro core per system.

| System | Files | BIOS |
|---|---|---|
| Commodore 64 / 128 / VIC-20 / Plus/4 / PET | `.d64` `.g64` `.t64` `.prg` `.crt` `.tap` … | included |
| Amiga | `.adf` `.dms` `.ipf` `.hdf` `.lha` | free AROS Kickstart included, original Kickstart optional |
| ZX Spectrum, ZX81, Amstrad CPC | `.tzx` `.z80` `.sna` `.p` `.dsk` `.cdt` | included |
| NES, SNES, Game Boy (Color), Game Boy Advance, Nintendo DS, N64, Virtual Boy | `.nes` `.sfc` `.gb` `.gba` `.nds` `.z64` … | not needed (GBA/DS: free replacement included) |
| Master System, Game Gear, Mega Drive, 32X | `.sms` `.gg` `.md` `.32x` … | not needed |
| PlayStation, Saturn, PSP | `.cue` `.chd` `.pbp` `.cso` … | free replacement included |
| Atari 2600 / 7800 / Jaguar, PC Engine, Neo Geo Pocket, WonderSwan | `.a26` `.a78` `.j64` `.pce` `.ngp` `.ws` … | not needed |
| Mega-CD, Atari 5200, Lynx, PC-FX, ColecoVision, 3DO | | **original BIOS needed**, no free replacement |
| Arcade (FBNeo, MAME 2003-Plus) | ROM ZIPs | depends on the game |

### BIOS files

- RunThemAll does **not** ship any copyrighted BIOS files.
- If a BIOS file with the right name is in your ZIP or folder, it is used automatically.
- Otherwise add it before starting with **"Add BIOS file"**.

### Tested so far

C64, Amiga, Super Nintendo, NES and Game Boy Color. The other systems are included but not tested yet.
