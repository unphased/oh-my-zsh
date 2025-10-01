#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "../term-capture.hpp"   // Include the header for term_capture
#include <vector>
#include <string>
#include <csignal>
#include <unistd.h>
#include <cerrno>
#include "../term_capture_sys.hpp"

#ifdef BUILD_TERM_CAPTURE_AS_LIB
namespace {
int fake_select_call_count = 0;

int fake_select_impl(int nfds, fd_set* readfds, fd_set* writefds, fd_set* exceptfds, struct timeval* timeout) {
    (void)nfds;
    (void)readfds;
    (void)writefds;
    (void)exceptfds;
    (void)timeout;
    ++fake_select_call_count;
    errno = EINTR;
    return -1;
}
} // namespace
#endif

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
        // Optionally, check parts of the error message (program name is argv[0])
        REQUIRE(config.error_message.find("Usage: term-capture") != std::string::npos);
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

    SECTION("WS flags before prefix and command parsing", "[term_capture][args][ws]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-listen"), const_cast<char*>("127.0.0.1:0"),
            const_cast<char*>("--ws-token"), const_cast<char*>("sekret"),
            const_cast<char*>("--ws-allow-remote"),
            const_cast<char*>("--ws-send-buffer"), const_cast<char*>("2097152"),
            const_cast<char*>("myprefix"),
            const_cast<char*>("/bin/echo"), const_cast<char*>("ok")
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "myprefix");
        REQUIRE(config.ws_listen == "127.0.0.1:0");
        REQUIRE(config.ws_token == "sekret");
        REQUIRE(config.ws_allow_remote == true);
        REQUIRE(config.ws_send_buffer == static_cast<size_t>(2097152));
        REQUIRE(config.command_and_args.size() == 2);
        REQUIRE(config.command_and_args[0] == "/bin/echo");
        REQUIRE(config.command_and_args[1] == "ok");
    }

    SECTION("WS flags with equals syntax", "[term_capture][args][ws]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-listen=127.0.0.1:0"),
            const_cast<char*>("--ws-token=mytok"),
            const_cast<char*>("myprefix2"),
            const_cast<char*>("sh"), const_cast<char*>("-c"), const_cast<char*>("echo hi")
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "myprefix2");
        REQUIRE(config.ws_listen == "127.0.0.1:0");
        REQUIRE(config.ws_token == "mytok");
        REQUIRE(config.command_and_args.size() == 3);
        REQUIRE(config.command_and_args[0] == "sh");
        REQUIRE(config.command_and_args[1] == "-c");
        REQUIRE(config.command_and_args[2] == "echo hi");
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

TEST_CASE("select seam can be overridden in tests", "[term_capture][seams]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    fake_select_call_count = 0;
    auto original = tc::sys::select_impl;
    tc::sys::select_impl = fake_select_impl;
    errno = 0;
    int rc = tc::sys::select(0, nullptr, nullptr, nullptr, nullptr);
    REQUIRE(rc == -1);
    REQUIRE(errno == EINTR);
    REQUIRE(fake_select_call_count == 1);
    tc::sys::select_impl = original;
    tc::sys::reset_to_default_select();
#else
    SUCCEED("Not built as LIB; seam override unavailable.");
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

TEST_CASE("Integration: fallback to zsh when no command is provided", "[integration][term_capture][shell]") {
    // Skip if zsh is not installed
    int has_zsh = std::system("command -v zsh >/dev/null 2>&1");
    if (has_zsh != 0) {
        WARN("zsh not found on PATH; skipping fallback integration test");
        SUCCEED();
        return;
    }

    const std::string prefix = "debug/it_fallback";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());

    // Pipe commands into term-capture's STDIN so the interactive shell exits automatically.
    // We emit a marker and then exit to keep the test bounded.
    int rc = std::system("printf 'echo fallback_ok\\nexit\\n' | ./debug/term-capture debug/it_fallback >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));

    const std::string out = read_all(output_path);
    REQUIRE(out.find("fallback_ok") != std::string::npos);
}

TEST_CASE("Integration: WS flags create stub metadata and print skeleton notice", "[integration][term_capture][ws]") {
    const std::string prefix = "debug/it_ws";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string ws_meta = prefix + ".ws.json";
    const std::string stderr_path = "debug/it_ws.stderr";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(ws_meta.c_str());
    std::remove(stderr_path.c_str());

    // Place WS flags before prefix to avoid ambiguity with command args
    int rc = std::system("./debug/term-capture --ws-listen 127.0.0.1:0 "
                         "debug/it_ws /bin/echo ok 2> debug/it_ws.stderr >/dev/null");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(ws_meta));

    const std::string err = read_all(stderr_path);
    REQUIRE(err.find("WS: planned") != std::string::npos);
}

TEST_CASE("Integration: invalid log directory causes failure to open logs", "[integration][term_capture][errors]") {
    // Use a prefix that points into a non-existent directory
    int rc = std::system("./debug/term-capture debug/does-not-exist/subdir/log /bin/echo ok >/dev/null 2>&1");
    REQUIRE(rc != 0);
}

TEST_CASE("signal_handler on SIGCHLD sets exit flag without exiting", "[term_capture][signals]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    set_should_exit(false);
    REQUIRE_FALSE(get_should_exit());
    // With child_pid defaulting to -1 in library builds, this should not call exit(),
    // but it should set the exit flag.
    signal_handler(SIGCHLD);
    REQUIRE(get_should_exit());
    set_should_exit(false);
#else
    SUCCEED("Not built as LIB; signal flag accessors unavailable.");
#endif
}
