#include <iostream>
#include <iomanip>
#include <cctype>
#include <unistd.h>

static bool last_was_nonprint = false;

void print_byte(unsigned char c) {
    bool is_print = isprint(c);
    
    // Add space when transitioning from non-printable to printable
    if (is_print && last_was_nonprint) {
        std::cout << ' ';
    }
    
    if (is_print) {
        std::cout << c;
    } else if (c == '\n') {
        std::cout << " \\n";
    } else if (c == '\r') {
        std::cout << " \\r";
    } else if (c == '\t') {
        std::cout << " \\t";
    } else {
        std::cout << ' ' << std::hex << std::setw(2) << std::setfill('0') 
                  << static_cast<int>(c);
    }
    
    last_was_nonprint = !is_print;
    std::cout << std::flush;
}

int main() {
    unsigned char buf;
    while (read(STDIN_FILENO, &buf, 1) > 0) {
        print_byte(buf);
    }
    return 0;
}
