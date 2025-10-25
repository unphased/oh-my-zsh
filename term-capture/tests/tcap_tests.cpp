#include "catch_amalgamated.hpp"
#include "../tcap.hpp"
#include <vector>
#include <cstdint>

// Encode/decode behaviour for TCAP's ULEB128 helpers.
TEST_CASE("ULEB128 encodes small values into single byte", "[tcap][uleb128]") {
    auto enc0 = uleb128_encode(0);
    REQUIRE(enc0.size() == 1);
    REQUIRE(enc0[0] == 0x00);

    auto enc1 = uleb128_encode(1);
    REQUIRE(enc1.size() == 1);
    REQUIRE(enc1[0] == 0x01);

    auto enc127 = uleb128_encode(127);
    REQUIRE(enc127.size() == 1);
    REQUIRE(enc127[0] == 0x7f);
}

TEST_CASE("ULEB128 encodes multi-byte values correctly", "[tcap][uleb128]") {
    auto enc128 = uleb128_encode(128);
    REQUIRE(enc128.size() == 2);
    REQUIRE(enc128[0] == 0x80);
    REQUIRE(enc128[1] == 0x01);

    auto enc255 = uleb128_encode(255);
    REQUIRE(enc255.size() == 2);
    REQUIRE(enc255[0] == 0xFF);
    REQUIRE(enc255[1] == 0x01);

    auto enc300 = uleb128_encode(300); // 300 = 0b1 0010 1100
    REQUIRE(enc300.size() == 2);
    REQUIRE(enc300[0] == 0xAC); // 0b1010 1100
    REQUIRE(enc300[1] == 0x02); // 0b0000 0010
}

TEST_CASE("ULEB128 round-trip encode/decode", "[tcap][uleb128]") {
    std::vector<uint64_t> values = {
        0ull, 1ull, 2ull, 10ull, 63ull, 64ull, 65ull, 127ull, 128ull, 129ull,
        300ull, 16384ull, 65535ull, 123456789ull, 0xFFFFFFFFull, 0x1FFFFFFFFull
    };
    for (auto v : values) {
        auto enc = uleb128_encode(v);
        uint64_t dec = 0;
        auto res = uleb128_decode(enc.data(), enc.size(), dec);
        REQUIRE(res.first);
        REQUIRE(res.second == enc.size());
        REQUIRE(dec == v);
    }
}

TEST_CASE("ULEB128 decode fails on truncated input", "[tcap][uleb128]") {
    // 0x80 indicates continuation, but we truncate
    std::vector<uint8_t> bad = {0x80};
    uint64_t dec = 0;
    auto res = uleb128_decode(bad.data(), bad.size(), dec);
    REQUIRE_FALSE(res.first);
    REQUIRE(res.second == 0);
}
