# RunThemAll

**Play old DOS and Windows programs, retro console games and whole operating systems right in your
browser. Nothing to install, nothing uploaded.**

👉 **[Open RunThemAll](https://ralf1108.github.io/RunThemAll/)**

## How it works

1. **Open** a file, a ZIP or a folder (or drag it onto the page).
2. **Pick** the program or game. RunThemAll finds out by itself what it is.
3. **Start.** The right emulator is loaded automatically.

No account, no setup. Your files never leave your computer.

Just want to look around? Click one of the **demos** below "Open a program" and press **Start**.

## What runs?

- **DOS** programs and games (`.exe`, `.com`, `.bat`)
- **Windows 3.x** programs (16 bit)
- **Windows 95 to XP** programs (32 bit)
- **Home computers**: Commodore 64, Amiga, ZX Spectrum, Amstrad CPC and more
- **Consoles**: NES, SNES, Game Boy, Game Boy Advance, Nintendo DS, N64, Sega Master System,
  Mega Drive, PlayStation and more
- **Whole operating systems** from a CD, floppy or hard disk image (`.iso`, `.img`, `.vhd`),
  e.g. Linux, ReactOS or your own Windows 98 CD: use **"Start your own operating system"**

Full list of systems and file types: [docs/systems.md](docs/systems.md)

## Demos

Free games, programs and operating systems to try with one click, for example:

- **Operating systems**: Tiny Core Linux, KolibriOS, ReactOS, a plain DOS prompt
- **Windows**: SkiFree, OpenTTD, Castle of the Winds 1 and 2
- **DOS**: Keen Dreams, Dark Forces (demo), Indiana Jones and the Fate of Atlantis (demo), Boppin'
- **Retro**: T-Rex 64 (C64), Pink Wall and Horizontal Shooter (Super Nintendo), Nova the Squirrel (NES), µCity (Game Boy Color)

Where they come from and their licences: [demos/README.md](demos/README.md)

## Tips

- **No sound?** Click once into the picture. Browsers only play sound after a click.
- **Sound on/off and Pause**: buttons next to *Fullscreen* while a program runs.
- **Fullscreen**: button *Fullscreen*. The picture always keeps the shape of the original screen.
- **Mouse in operating systems**: click into the picture to capture the mouse, press `Esc` to release it.
- **Save games**: *Save changed files* downloads all new and changed files as a ZIP.
  If you opened a folder in Chrome or Edge, *Write back to folder* writes them straight back
  into that folder.
- **Settings**: each demo has an *Options* button (e.g. speed, memory, Windows version).
- **Windows programs** get a small virtual PC that is kept in your browser. To delete it, use
  *Reset virtual environment* at the bottom of the page.

## Good to know

- Emulation is slower than a real PC. It is made for older software.
- Windows programs using **3D graphics** (OpenGL, Direct3D) do not work, neither do .NET or Java programs.
- Some consoles need an original **BIOS file**, which you have to add yourself. RunThemAll does not
  include any.
- Programs inside the emulator **cannot go online**.
- Works best in **Chrome or Edge**. Firefox and Safari work too, but cannot write save games back into a folder.

## Privacy

- Everything runs in your browser. Your files are **never uploaded**.
- Page visits are counted anonymously and without cookies with [GoatCounter](https://www.goatcounter.com).

## More

- [docs/systems.md](docs/systems.md): all systems, file types and BIOS files
- [docs/development.md](docs/development.md): run it locally, update the emulators, publish it
- [docs/specification.md](docs/specification.md): how it works inside
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): all included projects and their licences

## Credits

RunThemAll only puts a simple interface on top of great open source emulators:

- [Boxedwine](https://github.com/danoon2/Boxedwine) with [Wine](https://www.winehq.org): Windows programs
- [js-dos](https://js-dos.com) with [DOSBox](https://www.dosbox.com): DOS programs
- [EmulatorJS](https://emulatorjs.org) with [libretro](https://www.libretro.com) cores: consoles and home computers
- [v86](https://github.com/copy/v86) with [SeaBIOS](https://www.seabios.org): complete PCs
- [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker): makes the fast mode work on GitHub Pages

Thanks to all authors of the demos, see [demos/README.md](demos/README.md).

## Licence

RunThemAll is free software under the [MIT licence](LICENSE). The included projects have their own
licences, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
