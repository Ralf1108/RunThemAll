# Meldung an Boxedwine (zum Einreichen)

Ziel: https://github.com/danoon2/Boxedwine (Pull Request aus dem Fork Ralf1108/Boxedwine).

Stand `master` (geprüft am 27.11.2026, upstream `0fa70a84`):

- **Schon behoben auf `master`:** accept setzt `connected` (Commit `cc9cfd76`, 7.6.2026, nicht in 26R1.0).
  Damit ist der POLLHUP-Fehler aus dem Repro in [boxedwine-accept-repro/](boxedwine-accept-repro/) dort erledigt.
  Auch die Netzwerkkarten-ioctls (`SIOCGIFBRDADDR`, `SIOCGIFNETMASK`) sind auf `master` umgesetzt.
- **Noch offen, im PR:** accept mit NULL-Adresse und der verlorene native Socket pro accept.

Der Commit liegt im Checkout `boxedwine-accept-repro/Boxedwine/` (eigenes Git-Repo, von RunThemAll
ignoriert), Branch `fix-native-accept`, Commit `0d4f13fc`. Vor dem PR: `git push -u origin fix-native-accept`
in diesem Ordner, dann auf https://github.com/danoon2/Boxedwine/compare/master...Ralf1108:Boxedwine:fix-native-accept
den PR anlegen. Der Text unten ist auf Englisch und kann so übernommen werden.

---

**Title:** Native sockets: accept with a NULL address, close the unused socket

### accept(fd, NULL, NULL) stops Boxedwine

`KNativeSocketObject::accept` calls `readSockAddrIn(&addr, memory, address)` before checking
`address`. With a NULL address (allowed by POSIX and common) Boxedwine stops with
"KMemory::performOnMemory failed to get ram". The address is now only read when it is given,
the same way it is only written back when given.

### A native socket leaks per accepted connection

The `KNativeSocketObject` created for the accepted connection opens a native socket in its
constructor (`socket(AF_INET, ...)`), and `accept` then overwrites `s->nativeSocket` with the
accepted one. On desktop builds every accepted connection leaks a socket. It is now closed first;
the web build opens none in the constructor, hence the `>= 0` check.

### Reproduction

`accept-null` is a 32 bit Linux test program without libc (3.4 KB, runs in any Boxedwine file
system). It listens on 127.0.0.1, connects to itself and calls `accept(server, NULL, NULL)`:
https://github.com/Ralf1108/RunThemAll/tree/main/concepts/boxedwine-accept-repro
(`accept-null.c` and the built `accept-null`).

1. Copy `accept-null` into the root of a Boxedwine file system.
2. Start it instead of Wine: `boxedwine -root <root folder> -zip <file system zip> /accept-null`
3. Without the fix Boxedwine stops with "KMemory::performOnMemory failed to get ram";
   with the fix it prints `OK: accept returned ...` (exit code 0, as on Linux).

Build (gcc on Linux, or clang/lld on any host):

```sh
gcc -m32 -march=i686 -mno-sse -static -nostdlib -fno-builtin -fno-stack-protector \
    -fno-pie -no-pie -O1 -o accept-null accept-null.c
```

The socket leak has no repro of its own (desktop builds only, one native socket per accepted
connection stays open until the process ends).

The same folder has `accept-pollhup`, which showed the missing `connected = true` in 26R1.0
(already fixed on master in cc9cfd76).

### How we found it

We run the Boxedwine web build in the browser and give Emscripten's SOCKFS our own socket
operations, so that `listen`/`accept` work between browsers (a virtual LAN over a relay
server, https://github.com/Ralf1108/RunThemAll). The changes are not specific to the browser:
desktop builds use the same code.
