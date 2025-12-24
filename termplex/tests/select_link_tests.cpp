#define _GNU_SOURCE

#include "catch_amalgamated.hpp"

#include <sys/select.h>
#include <dlfcn.h>
#include <atomic>
#include <cerrno>

namespace {
using select_fn = int (*)(int, fd_set*, fd_set*, fd_set*, struct timeval*);

std::atomic<bool> use_fake_select{false};
std::atomic<int> fake_select_calls{0};

extern "C" int select(int nfds, fd_set* readfds, fd_set* writefds,
                       fd_set* exceptfds, struct timeval* timeout) {
    static select_fn real_select = reinterpret_cast<select_fn>(dlsym(RTLD_NEXT, "select"));
    if (use_fake_select.load()) {
        ++fake_select_calls;
        errno = EINTR;
        use_fake_select = false;
        return -1;
    }
    if (!real_select) {
        errno = ENOSYS;
        return -1;
    }
    return real_select(nfds, readfds, writefds, exceptfds, timeout);
}
} // namespace

// Override select(2) to simulate EINTR and verify seam plumbing.
TEST_CASE("link override can intercept select", "[link_seam][select]") {
    fake_select_calls = 0;
    use_fake_select = true;
    errno = 0;
    int rc = ::select(0, nullptr, nullptr, nullptr, nullptr);
    REQUIRE(rc == -1);
    REQUIRE(errno == EINTR);
    REQUIRE(fake_select_calls.load() == 1);
}
