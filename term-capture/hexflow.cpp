#include "hexflow.hpp" // Include the header
#include <unistd.h>   // For read
#include <iostream>   // For std::cout in main

// Definition of print_byte, now taking ostream and state as parameters
void print_byte(unsigned char c, std::ostream& out, bool& last_was_nonprint_state) {
    bool is_print = isprint(c);
    
    // Add space when transitioning from non-printable to printable
    if (is_print && last_was_nonprint_state) {
        out << ' ';
    }
    
    if (is_print) {
        out << c;
    } else if (c == '\n') {
        out << " \\n";
    } else if (c == '\r') {
        out << " \\r";
    } else if (c == '\t') {
        out << " \\t";
    } else {
        // Ensure hex output is consistent for tests (e.g., std::hex, std::setw, std::setfill)
        // These are now included via hexflow.hpp -> iomanip
        out << ' ' << std::hex << std::setw(2) << std::setfill('0') 
            << static_cast<int>(c);
    }
    
    last_was_nonprint_state = !is_print; // Update the state
    out << std::flush; // Flushes the output stream, consistent with original behavior
}

int main() {
    unsigned char buf;
    bool last_was_nonprint_main = false; // Local state for the main loop
    while (read(STDIN_FILENO, &buf, 1) > 0) {
        print_byte(buf, std::cout, last_was_nonprint_main); // Pass std::cout and state
    }
    return 0;
}
