# Meldung an Boxedwine (zum Einreichen)

Ziel: https://github.com/danoon2/Boxedwine (Issue und/oder Pull Request). Der Text unten ist auf
Englisch und kann so übernommen werden. Das Repro liegt in [boxedwine-accept-repro/](boxedwine-accept-repro/)
(Quelltext + fertiges Programm, 3,5 KB) und kann dem PR beigelegt werden.

Geprüft im Browser-Build (RunThemAll, eigener Build mit Emscripten 4.0.10, Single- und
Multithread): offizielles 26R1.0 → `revents 0x14` (BUG), mit dem Fix → `revents 0x4` (OK).

---

**Title:** Accepted native sockets are reported as hung up (POLLHUP); accept with a NULL address stops Boxedwine

**Version:** 26R1.0 (`source/kernel/knativesocket.cpp`, same code on master)

### 1. Accepted sockets are never marked as connected

`KNativeSocketObject::accept` creates the socket object for the new connection but never sets
`connected` on it. `KNativeSocketObject::isOpen()` returns `listening || connected`, so it is
false for every accepted socket, and `kpoll.cpp` reports `K_POLLHUP` for it on every poll:

```cpp
if (!fd->kobject->isOpen()) {
    data->revents |= K_POLLHUP;
}
```

Wine's server then treats the connection as hung up and the program never writes to it.
Example: OpenTTD 15.3 as a server (`openttd -D`) accepts a client and receives its join packet,
but never answers; the client is dropped after a timeout ("took longer than 2000 ticks").

The same function also leaks a native socket per connection: the `KNativeSocketObject`
constructor opens one (`socket(AF_INET, ...)`) and `accept` overwrites `s->nativeSocket`.

### 2. accept(fd, NULL, NULL) stops Boxedwine

`accept` calls `readSockAddrIn(&addr, memory, address)` before checking `address`. With a NULL
address (allowed by POSIX and common) Boxedwine stops with
"KMemory::performOnMemory failed to get ram".

### Reproduction

`accept-pollhup.c` (attached; 32 bit Linux, no libc, runs in any Boxedwine file system): listens
on 127.0.0.1, connects to itself, accepts and polls the accepted socket.

```
26R1.0:     poll on the accepted socket: result 0x00000001, revents 0x00000014
            BUG: poll reports the accepted socket as hung up (POLLHUP) or not writable
with fix:   poll on the accepted socket: result 0x00000001, revents 0x00000004
            OK: the accepted socket is open
```

(Passing NULL instead of the address buffer to accept shows problem 2.)

### Fix

```diff
--- a/source/kernel/knativesocket.cpp
+++ b/source/kernel/knativesocket.cpp
@@ U32 KNativeSocketObject::accept(KThread* thread, const KFileDescriptorPtr& fd, U32 address, U32 len, U32 flags) {
     KMemory* memory = thread->memory;
-    readSockAddrIn(&addr, memory, address);
+    if (address) readSockAddrIn(&addr, memory, address);
     S32 result = (S32)::accept(this->nativeSocket, (struct sockaddr*)&addr, &addrlen);
@@
-        s->nativeSocket = result;
+        closesocket(s->nativeSocket); // the constructor opened a socket that is not used
+        s->nativeSocket = result;
+        s->connected = true;
```

### Related (lower priority)

- `KNativeSocketObject::ioctl` logs "request=8919 not implemented" and "request=891b not
  implemented" (`SIOCGIFBRDADDR`, `SIOCGIFNETMASK`) in the web build; Wine then reports
  "Unable to get interface table!" and programs find no broadcast addresses for LAN discovery
  (OpenTTD: "Detected broadcast addresses:" stays empty).
- Single threaded build: a blocking `accept` on a socket without data never wakes up, because
  `checkWaitingNativeSockets` only selects on sockets whose `readingCond` has parents, and a
  blocking accept waits on `readingCond` directly.

### How we found it

We run the Boxedwine web build in the browser and give Emscripten's SOCKFS our own socket
operations, so that `listen`/`accept` work between browsers (a virtual LAN over a relay
server, https://github.com/Ralf1108/RunThemAll). The fix is not specific to the browser:
desktop builds use the same code.
