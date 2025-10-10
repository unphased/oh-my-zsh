#include "catch_amalgamated.hpp"

#include <netdb.h>
#include <atomic>

namespace {
std::atomic<int> link_seam_call_count{0};
}

extern "C" int getaddrinfo(const char* node,
                            const char* service,
                            const struct addrinfo* hints,
                            struct addrinfo** res) {
    (void)node;
    (void)service;
    (void)hints;
    (void)res;
    ++link_seam_call_count;
    return 42;
}

TEST_CASE("link seam override replaces libc symbol", "[link_seam]") {
    link_seam_call_count = 0;
    int rc = ::getaddrinfo(nullptr, nullptr, nullptr, nullptr);
    REQUIRE(rc == 42);
    REQUIRE(link_seam_call_count.load() == 1);
}
