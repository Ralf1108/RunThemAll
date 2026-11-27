/*
 * accept-pollhup: minimal reproduction for Boxedwine's accepted native sockets.
 *
 * A TCP server socket accepts a connection from a client socket in the same process
 * (127.0.0.1). Then poll() asks the accepted socket whether it can be written to.
 *
 *   Linux (and Boxedwine with the fix):  revents = POLLOUT (0x4)            -> "OK", exit code 0
 *   Boxedwine 26R1.0:                    revents contain POLLHUP (0x10)     -> "BUG", exit code 1
 *
 * Reason: KNativeSocketObject::accept (source/kernel/knativesocket.cpp) never sets `connected`
 * on the new socket, so isOpen() is false and kpoll.cpp adds K_POLLHUP. Wine's server then treats
 * the connection as hung up, and a Windows program acting as a TCP server never answers.
 *
 * The program is 32 bit x86 Linux without libc (system calls via int 0x80, socketcall), so it
 * runs in any Boxedwine file system. Build:
 *
 *   gcc -m32 -march=i686 -mno-sse -static -nostdlib -fno-builtin -fno-stack-protector -fno-pie -no-pie -O1 \
 *       -o accept-pollhup accept-pollhup.c
 * or
 *   clang --target=i386-linux-gnu -march=i686 -mno-sse -mno-mmx -ffreestanding -fno-builtin \
 *         -fno-stack-protector -O1 -c accept-pollhup.c
 *   ld.lld -m elf_i386 -static -e _start -N --image-base=0x8048000 -o accept-pollhup accept-pollhup.o
 */

typedef unsigned int u32;
typedef unsigned short u16;

/* i386 system call numbers and socketcall sub-calls */
enum { SYS_exit = 1, SYS_write = 4, SYS_fcntl = 55, SYS_socketcall = 102, SYS_nanosleep = 162, SYS_poll = 168 };
enum { SC_SOCKET = 1, SC_BIND = 2, SC_CONNECT = 3, SC_LISTEN = 4, SC_ACCEPT = 5, SC_GETSOCKNAME = 6 };
enum { AF_INET = 2, SOCK_STREAM = 1, POLLIN = 0x1, POLLOUT = 0x4, POLLERR = 0x8, POLLHUP = 0x10 };
enum { EAGAIN = 11, F_SETFL = 4, O_NONBLOCK = 04000 };

struct sockaddr_in { u16 family; u16 port; u32 addr; unsigned char zero[8]; };
struct pollfd { int fd; short events; short revents; };
struct timespec { long sec; long nsec; };

static int sys3(int n, int a, int b, int c) {
    int r;
    __asm__ volatile("int $0x80" : "=a"(r) : "a"(n), "b"(a), "c"(b), "d"(c) : "memory");
    return r;
}

static int socketcall(int call, u32* args) { return sys3(SYS_socketcall, call, (int)args, 0); }

static int length(const char* s) { int n = 0; while (s[n]) n++; return n; }
static void print(const char* s) { sys3(SYS_write, 1, (int)s, length(s)); }
static void printHex(u32 v) {
    char buf[11] = "0x";
    for (int i = 0; i < 8; i++) buf[2 + i] = "0123456789abcdef"[(v >> (28 - 4 * i)) & 15];
    buf[10] = 0;
    print(buf);
}
static void fail(const char* what, int result) {
    print("error: "); print(what); print(" returned "); printHex((u32)result); print("\n");
    sys3(SYS_exit, 2, 0, 0);
}
static void sleepMs(int ms) {
    struct timespec t = { 0, ms * 1000000L };
    sys3(SYS_nanosleep, (int)&t, 0, 0);
}

void _start(void) {
    struct sockaddr_in addr = { AF_INET, 0, 0x0100007f, { 0 } }; /* 127.0.0.1, any port */
    u32 len = sizeof(addr);

    /* server: socket, bind to 127.0.0.1:0, listen, find out the port */
    u32 a1[3] = { AF_INET, SOCK_STREAM, 0 };
    int server = socketcall(SC_SOCKET, a1);
    if (server < 0) fail("socket", server);
    u32 a2[3] = { (u32)server, (u32)&addr, sizeof(addr) };
    int r = socketcall(SC_BIND, a2);
    if (r < 0) fail("bind", r);
    u32 a3[2] = { (u32)server, 1 };
    r = socketcall(SC_LISTEN, a3);
    if (r < 0) fail("listen", r);
    /* non-blocking, so that accept never waits (accept retries below) */
    r = sys3(SYS_fcntl, server, F_SETFL, O_NONBLOCK);
    if (r < 0) fail("fcntl", r);
    u32 a4[3] = { (u32)server, (u32)&addr, (u32)&len };
    r = socketcall(SC_GETSOCKNAME, a4);
    if (r < 0) fail("getsockname", r);

    /* client: connect to the server */
    int client = socketcall(SC_SOCKET, a1);
    if (client < 0) fail("socket", client);
    u32 a5[3] = { (u32)client, (u32)&addr, sizeof(addr) };
    r = socketcall(SC_CONNECT, a5);
    if (r < 0) fail("connect", r);

    /* server side of the connection (retry a little in case the connection is not queued yet).
     * The address buffer is passed on purpose: Boxedwine 26R1.0 also fails on accept(fd, NULL, NULL),
     * it reads the address before checking it (a second, separate problem). */
    struct sockaddr_in peer;
    u32 peerLen = sizeof(peer);
    u32 a6[3] = { (u32)server, (u32)&peer, (u32)&peerLen };
    int accepted = -EAGAIN;
    for (int i = 0; i < 100 && accepted == -EAGAIN; i++) {
        accepted = socketcall(SC_ACCEPT, a6);
        if (accepted == -EAGAIN) sleepMs(20);
    }
    if (accepted < 0) fail("accept", accepted);

    /* the test: a fresh connection can be written to and is not hung up */
    struct pollfd p = { accepted, POLLIN | POLLOUT, 0 };
    r = sys3(SYS_poll, (int)&p, 1, 1000);
    print("poll on the accepted socket: result "); printHex((u32)r);
    print(", revents "); printHex((u32)(unsigned short)p.revents); print("\n");

    if (r == 1 && (p.revents & POLLOUT) && !(p.revents & (POLLHUP | POLLERR))) {
        print("OK: the accepted socket is open\n");
        sys3(SYS_exit, 0, 0, 0);
    }
    print("BUG: poll reports the accepted socket as hung up (POLLHUP) or not writable\n");
    sys3(SYS_exit, 1, 0, 0);
}
