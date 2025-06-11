#ifndef TERM_CAPTURE_HPP
#define TERM_CAPTURE_HPP

#include <string>
#include <vector>
#include <optional> // For C++17, or use a custom optional/pointer for older standards if necessary

// Structure to hold parsed command-line arguments
struct Config {
    std::string log_prefix;
    std::vector<std::string> command_and_args; // command is command_and_args[0]
    bool valid = true; // Was parsing successful?
    std::string error_message; // Error message if parsing failed
};

// Parses command-line arguments.
// Returns a Config struct. If parsing fails, config.valid will be false
// and config.error_message will contain details.
Config parse_arguments(int argc, char* argv[]);

// Function declarations for other functions from term-capture.cpp if they are to be tested
// For example:
// void restore_terminal();
// void cleanup_and_exit(); // Note: exit() makes direct testing hard
// void signal_handler(int sig);
// void handle_winch(int);

#endif // TERM_CAPTURE_HPP
