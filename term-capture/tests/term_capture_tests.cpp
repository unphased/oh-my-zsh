#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "../term-capture.hpp"   // Include the header for term_capture
#include <vector>
#include <string>
#include <csignal>
#include <unistd.h>

TEST_CASE("TermCapture Argument Parsing", "[term_capture][args]") {
    SECTION("Only prefix provided") {
        char* argv[] = {const_cast<char*>("term-capture"), const_cast<char*>("my_log_prefix")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "my_log_prefix");
        REQUIRE(config.command_and_args.empty());
        REQUIRE(config.error_message.empty());
    }

    SECTION("Prefix and simple command provided") {
        char* argv[] = {const_cast<char*>("term-capture"), const_cast<char*>("session1"), const_cast<char*>("ls")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "session1");
        REQUIRE(config.command_and_args.size() == 1);
        REQUIRE(config.command_and_args[0] == "ls");
        REQUIRE(config.error_message.empty());
    }

    SECTION("Prefix, command, and arguments provided") {
        char* argv[] = {
            const_cast<char*>("term-capture"), 
            const_cast<char*>("session2"), 
            const_cast<char*>("grep"), 
            const_cast<char*>("pattern"), 
            const_cast<char*>("file.txt")
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "session2");
        REQUIRE(config.command_and_args.size() == 3);
        REQUIRE(config.command_and_args[0] == "grep");
        REQUIRE(config.command_and_args[1] == "pattern");
        REQUIRE(config.command_and_args[2] == "file.txt");
        REQUIRE(config.error_message.empty());
    }

    SECTION("Insufficient arguments (no prefix)") {
        char* argv[] = {const_cast<char*>("term-capture")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
        // Optionally, check parts of the error message
        REQUIRE(config.error_message.find("Usage: term-capture <prefix>") != std::string::npos);
    }
    
    SECTION("Insufficient arguments (argc is 0 - highly unlikely but good to cover)") {
        char* argv[] = {const_cast<char*>("term-capture")}; // argv[0] is program name
        int argc = 0; // Simulate no arguments at all
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
    }

    SECTION("Insufficient arguments (argc is 1, only program name)") {
        char* argv[] = {const_cast<char*>("term-capture")};
        int argc = 1;
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
    }
}

 // Placeholder for future tests
TEST_CASE("TermCapture PTY Logic (Placeholder)", "[term_capture][pty]") {
    REQUIRE(true);
}

TEST_CASE("build_exec_argv produces NULL-terminated argv for exec", "[term_capture][argv]") {
    SECTION("Non-empty args are NULL-terminated") {
        std::vector<std::string> args = {"grep", "pattern", "file.txt"};
        auto argv_vec = build_exec_argv(args);
        REQUIRE(argv_vec.size() == args.size() + 1);
        REQUIRE(argv_vec.back() == nullptr);
        REQUIRE(std::string(argv_vec[0]) == "grep");
        REQUIRE(std::string(argv_vec[1]) == "pattern");
        REQUIRE(std::string(argv_vec[2]) == "file.txt");
    }

    SECTION("Single-element args are handled") {
        std::vector<std::string> args = {"ls"};
        auto argv_vec = build_exec_argv(args);
        REQUIRE(argv_vec.size() == 2);
        REQUIRE(argv_vec.back() == nullptr);
        REQUIRE(std::string(argv_vec[0]) == "ls");
    }

    SECTION("Empty args yields empty vector (caller should handle fallback)") {
        std::vector<std::string> args;
        auto argv_vec = build_exec_argv(args);
        REQUIRE(argv_vec.empty());
    }
}

TEST_CASE("signal_handler sets exit flag on SIGINT", "[term_capture][signals]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    set_should_exit(false);
    REQUIRE_FALSE(get_should_exit());
    signal_handler(SIGINT);
    REQUIRE(get_should_exit());
    // reset for other tests
    set_should_exit(false);
#else
    SUCCEED("Not built as LIB; signal flag accessors unavailable.");
#endif
}

TEST_CASE("handle_winch can be invoked safely in tests", "[term_capture][signals][winch]") {
    // This ensures we exercise the handle_winch code path without a valid masterFd.
    // It should be a no-op aside from reading current window size from STDIN.
    handle_winch(0);
    REQUIRE(true); // No crash implies success for this smoke test
}

TEST_CASE("signal_handler triggers cleanup on SIGCHLD when child exits", "[term_capture][signals][sigchld]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    reset_did_cleanup();
    REQUIRE_FALSE(get_did_cleanup());

    pid_t pid = fork();
    REQUIRE(pid >= 0);

    if (pid == 0) {
        _exit(0);
    } else {
        set_child_pid_for_test(pid);
        // Poll the handler until it observes/reaps the child and cleans up
        for (int i = 0; i < 200 && !get_did_cleanup(); ++i) {
            signal_handler(SIGCHLD);
            usleep(1000); // 1ms
        }
        REQUIRE(get_did_cleanup());
        // reset for other tests
        reset_did_cleanup();
    }
#else
    SUCCEED("Not built as LIB; SIGCHLD cleanup test unavailable.");
#endif
}

//
// Integration tests
//
#include <sys/stat.h>
#include <cstdio>
#include <fstream>
#include <cstdlib>

static bool file_exists(const std::string& path) {
    struct stat st{};
    return ::stat(path.c_str(), &st) == 0;
}

static size_t file_size(const std::string& path) {
    struct stat st{};
    if (::stat(path.c_str(), &st) == 0) return static_cast<size_t>(st.st_size);
    return 0;
}

static std::string read_all(const std::string& path) {
    std::ifstream ifs(path, std::ios::binary);
    std::ostringstream oss;
    oss << ifs.rdbuf();
    return oss.str();
}

TEST_CASE("Integration: trivial command creates logs and captures output", "[integration][term_capture]") {
    // Prefix under debug/ to keep artifacts in build dir
    const std::string prefix = "debug/it_echo";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";

    // Clean up any leftovers
    std::remove(input_path.c_str());
    std::remove(output_path.c_str());

    // Run term-capture with a trivial command that exits quickly
    // Expect: logs created; output contains "hello"
    int rc = std::system("./debug/term-capture debug/it_echo /bin/echo hello >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));

    // For this run we didn't type anything, so input log should usually be empty
    // (It may not be strictly required, but is expected.)
    CHECK(file_size(input_path) == 0);

    const std::string out = read_all(output_path);
    // PTY may transform newline to CRLF, so check substring rather than exact equality
    REQUIRE(out.find("hello") != std::string::npos);
}

TEST_CASE("Integration: sh -c printf captures multi-line output", "[integration][term_capture]") {
    const std::string prefix = "debug/it_printf";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());

    // Quote the printf argument so the shell interprets the newline escape
    int rc = std::system("./debug/term-capture debug/it_printf /bin/sh -c \"printf 'a\\nb'\" >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));

    const std::string out = read_all(output_path);
    // Expect both 'a' and 'b' present, with some newline/CRLF between
    REQUIRE(out.find('a') != std::string::npos);
    REQUIRE(out.find('b') != std::string::npos);
    REQUIRE(out.find("ab") == std::string::npos); // should not be contiguous without a line break
}
