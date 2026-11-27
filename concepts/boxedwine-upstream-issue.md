# Meldung an Boxedwine (zum Einreichen)

Ziel: Pull Request von `Ralf1108/Boxedwine`, Branch `fix-native-accept` (Commit `0d4f13fc`, gepusht)
nach `danoon2/Boxedwine` `master`:
https://github.com/danoon2/Boxedwine/compare/master...Ralf1108:Boxedwine:fix-native-accept

Stand `master` (`0fa70a84`, geprüft am 27.11.2026):

- **Schon behoben:** accept setzt `connected` (`cc9cfd76`, nicht in 26R1.0), Netzwerkkarten-ioctls.
- **Web-Build:** nutzt auf master `KBrowserSocketObject`, dessen accept NULL korrekt behandelt.
- **Noch offen, im PR:** `KNativeSocketObject::accept` (Desktop-Builds) mit NULL-Adresse und der
  verlorene native Socket pro accept.
- **Getestet:** Linux-Desktop-Build von master und master + Fix in Docker (Ubuntu 24.04), Skript
  [boxedwine-accept-repro/linux-test.sh](boxedwine-accept-repro/linux-test.sh). master bricht ab, mit Fix `OK`.
  Das Socket-Leck ist nicht getestet (nur Code-Lesen).

Der Text unten ist auf Englisch und kann so übernommen werden.

---

**Title:** Native sockets: accept with a NULL address, close the unused socket

### Problem 1: accept(fd, NULL, NULL) stops Boxedwine

`KNativeSocketObject::accept` calls `readSockAddrIn(&addr, memory, address)` before checking
`address`. With a NULL address, which POSIX allows and many programs use, Boxedwine stops with

```
KMemory::performOnMemory failed to get ram
```

The address is now only read when it is given, the same way it is already only written back when
given.

### Problem 2: one native socket leaks per accepted connection

The `KNativeSocketObject` created for the accepted connection opens a native socket in its
constructor (`socket(AF_INET, ...)`), and `accept` then overwrites `s->nativeSocket` with the
accepted one, so the first socket is never closed. It is now closed first. The `>= 0` check is
there because the constructor may not have opened one (for example when `socket()` failed).

### Reproduction (problem 1)

`accept-null` is a small 32 bit Linux program without libc (3.4 KB, runs in any Boxedwine root).
It listens on 127.0.0.1, connects to itself and calls `accept(server, NULL, NULL)`.
Source and built program: https://github.com/Ralf1108/RunThemAll/tree/main/concepts/boxedwine-accept-repro
(`accept-null.c`, `accept-null`).

1. Put `accept-null` into an empty folder, for example `/tmp/root`.
2. Run `boxedwine -root /tmp/root /accept-null` (no file system zip needed).

Results with Linux desktop builds (Ubuntu 24.04, `make release` in `project/linux`):

```
master 0fa70a84:          accept(server, NULL, NULL)
                          KMemory::performOnMemory failed to get ram
with this PR (0d4f13fc):  accept(server, NULL, NULL)
                          OK: accept returned 0x00000005
```

Build of the program (or use the built one):

```sh
gcc -m32 -march=i686 -mno-sse -static -nostdlib -fno-builtin -fno-stack-protector \
    -fno-pie -no-pie -O1 -o accept-null accept-null.c
```

Problem 2 has no repro of its own; it was found by reading the code.

### How we found it

We run Boxedwine in the browser with our own socket layer between browsers
(https://github.com/Ralf1108/RunThemAll). Testing 26R1.0 there, we found that accepted sockets
were reported as hung up (already fixed on master in cc9cfd76) and the two problems above, which
are still in master's `KNativeSocketObject`.
