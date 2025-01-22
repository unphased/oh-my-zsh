#include <iostream>
#include <iomanip>
#include <cctype>
#include <unistd.h>

void print_byte(unsigned char c) {
    std::cout << std::hex << std::setw(2) << std::setfill('0') 
              << static_cast<int>(c) << ' ' << std::flush;
}

int main() {
    unsigned char buf;
    size_t count = 0;

    while (read(STDIN_FILENO, &buf, 1) > 0) {
        print_byte(buf);
        count++;
        
        // Add newline every 16 bytes, but don't buffer
        if (count % 16 == 0) {
            std::cout << '\n' << std::flush;
        }
    }

    // Add final newline if needed
    if (count % 16 != 0) {
        std::cout << '\n';
    }

    return 0;
}
