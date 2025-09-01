#ifndef TCAP_HPP
#define TCAP_HPP

#include <cstdint>
#include <vector>
#include <utility>

// Header-only ULEB128 utilities (sufficient for tcap varint needs)

inline std::vector<uint8_t> uleb128_encode(uint64_t value) {
    std::vector<uint8_t> out;
    do {
        uint8_t byte = static_cast<uint8_t>(value & 0x7Fu);
        value >>= 7u;
        if (value != 0) {
            byte |= 0x80u;
        }
        out.push_back(byte);
    } while (value != 0);
    return out;
}

// Returns pair<ok, consumed>. ok=false if buffer ended prematurely or overflow.
inline std::pair<bool, size_t> uleb128_decode(const uint8_t* data, size_t len, uint64_t& out_value) {
    uint64_t result = 0;
    uint32_t shift = 0;
    size_t i = 0;
    while (i < len) {
        uint8_t byte = data[i++];
        uint64_t part = static_cast<uint64_t>(byte & 0x7Fu) << shift;
        result |= part;
        if ((byte & 0x80u) == 0) {
            out_value = result;
            return {true, i};
        }
        shift += 7u;
        if (shift >= 64) { // overflow
            return {false, 0};
        }
    }
    return {false, 0};
}

#endif // TCAP_HPP
