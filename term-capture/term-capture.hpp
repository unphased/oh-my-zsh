#ifndef TERM_CAPTURE_HPP
#define TERM_CAPTURE_HPP

#include <string>
#include <vector>
#include <sys/types.h>

// Structure to hold parsed command-line arguments
struct Config {
    std::string log_prefix;
    std::vector<std::string> command_and_args; // command is command_and_args[0]
    bool valid = true; // Was parsing successful?
    std::string error_message; // Error message if parsing failed

    // WebSocket-related options (MVP skeleton)
    // Flags can appear before the prefix or after the prefix but before the command.
    std::string ws_listen;        // e.g., "127.0.0.1:0" (empty means disabled)
    std::string ws_token;         // optional shared secret (empty means none)
    bool ws_allow_remote = false; // if true, allow 0.0.0.0 bind (security risk without proxy)
    size_t ws_send_buffer = 0;    // per-client buffer size (0 means default/unspecified)
};

// Parses command-line arguments.
// Returns a Config struct. If parsing fails, config.valid will be false
// and config.error_message will contain details.
Config parse_arguments(int argc, char* argv[]);

/**
 * Build a NULL-terminated argv-style array suitable for exec* calls.
 * - If args is empty, returns an empty vector (callers should handle fallback).
 * - If args is non-empty, returns {args[0].c_str(), ..., args[n-1].c_str(), nullptr}.
 * Note: The returned pointers are valid only as long as the original strings live.
 */
std::vector<const char*> build_exec_argv(const std::vector<std::string>& args);

/**
 * Selected functions we can safely call in tests
 * Note: handle_winch will read the current window size from STDIN_FILENO
 * and attempt to propagate it if an internal master FD is valid. In library
 * builds, master FD is typically invalid, so this is a no-op after ioctl read.
 */
void signal_handler(int sig);
void handle_winch(int);

#ifdef BUILD_TERM_CAPTURE_AS_LIB
// Test-only accessors for internal state
bool get_should_exit();
void set_should_exit(bool v);
// Additional test-only hooks
bool get_did_cleanup();
void reset_did_cleanup(bool v = false); // default reset to false for convenience
void set_child_pid_for_test(pid_t pid);
#endif

#endif // TERM_CAPTURE_HPP
