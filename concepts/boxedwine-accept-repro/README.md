# accept-pollhup – reproduction for Boxedwine

Minimal test for the bugs described in [../boxedwine-upstream-issue.md](../boxedwine-upstream-issue.md):
an accepted TCP socket is never marked as connected in `KNativeSocketObject::accept`, so
`poll()` reports `POLLHUP` for it.

`accept-pollhup.c` is a 32 bit x86 Linux program without libc (system calls only). It listens on
127.0.0.1, connects to itself, accepts the connection and polls the accepted socket:

| Where | Output | Exit code |
|---|---|---|
| Linux (native, expected) | `revents 0x00000004` (POLLOUT) – `OK` | 0 |
| Boxedwine 26R1.0 (tested, web build) | `revents 0x00000014` (POLLOUT + POLLHUP) – `BUG` | 1 |
| Boxedwine with the fix (tested, web build) | `revents 0x00000004` – `OK` | 0 |

`accept-pollhup` is the program built from the source (static ELF, 3.5 KB), so no cross compiler
is needed to try it. The server socket is non-blocking and accept is retried, so the test does
not depend on blocking sockets. An address buffer is passed to accept on purpose:
`accept(fd, NULL, NULL)` stops Boxedwine 26R1.0 ("KMemory::performOnMemory failed to get ram"),
a second problem described in the issue text.

## accept-null

`accept-null.c` / `accept-null` (3.4 KB) does the same, but calls `accept(server, NULL, NULL)`.
Linux and Boxedwine with the fix print `OK: accept returned ...` (exit code 0); Boxedwine 26R1.0
and master (0fa70a84) stop with "KMemory::performOnMemory failed to get ram", because
`KNativeSocketObject::accept` reads the address before checking it. Built and run the same way as
`accept-pollhup` (replace the name). Not yet run in a browser test.

## Build

```sh
gcc -m32 -march=i686 -mno-sse -static -nostdlib -fno-builtin -fno-stack-protector \
    -fno-pie -no-pie -O1 -o accept-pollhup accept-pollhup.c
```

or with clang/LLVM (any host):

```sh
clang --target=i386-linux-gnu -march=i686 -mno-sse -mno-mmx -ffreestanding -fno-builtin \
      -fno-stack-protector -O1 -c accept-pollhup.c
ld.lld -m elf_i386 -static -e _start -N --image-base=0x8048000 -o accept-pollhup accept-pollhup.o
```

`-mno-sse`: the program has no startup code that aligns the stack for SSE.

## Run

Copy `accept-pollhup` into the root of a Boxedwine file system and start it instead of Wine,
for example (desktop build, paths as for a normal Boxedwine start):

```sh
boxedwine -root <root folder> -zip <file system zip> /accept-pollhup
```

The program prints one line from poll and `OK` or `BUG`. On Linux it can be run directly:
`./accept-pollhup`.

## The fix

In `source/kernel/knativesocket.cpp`, `KNativeSocketObject::accept`:

```diff
-    readSockAddrIn(&addr, memory, address);
+    if (address) readSockAddrIn(&addr, memory, address);
 ...
-        s->nativeSocket = result;
+        closesocket(s->nativeSocket); // the constructor opened a socket that is not used
+        s->nativeSocket = result;
+        s->connected = true;
```
