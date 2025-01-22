#include <iostream>
#include <iomanip>
#include <cctype>
#include <unistd.h>

void print_byte(unsigned char c) {
    if (isprint(c)) {
        std::cout << c << ' ';
    } else if (c == '\n') {
        std::cout << "\\n ";
    } else if (c == '\r') {
        std::cout << "\\r ";
    } else if (c == '\t') {
        std::cout << "\\t ";
    } else {
        std::cout << std::hex << std::setw(2) << std::setfill('0') 
                  << static_cast<int>(c) << ' ';
    }
    std::cout << std::flush;
}

int main() {
    unsigned char buf;
    size_t count = 0;

    while (read(STDIN_FILENO, &buf, 1) > 0) {
        print_byte(buf);
        count++;
        
        // Add newline every 8 bytes (reduced from 16 due to wider output)
        if (count % 8 == 0) {
            std::cout << '\n' << std::flush;
        }
    }

    // Add final newline if needed
    if (count % 8 != 0) {
        std::cout << '\n';
    }

    return 0;
}
