#ifndef HEXFLOW_HPP
#define HEXFLOW_HPP

#include <iostream> // For std::ostream
#include <iomanip>  // For std::hex, std::setw, std::setfill (used by print_byte)
#include <cctype>   // For isprint (used by print_byte)

// Function to print a single byte in hexflow format.
// Takes the character, an output stream, and a reference to the state
// indicating if the last character printed was non-printable.
void print_byte(unsigned char c, std::ostream& out, bool& last_was_nonprint_state);

#endif // HEXFLOW_HPP
