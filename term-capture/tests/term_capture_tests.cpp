#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "../term-capture.hpp"   // Include the header for term_capture
#include <vector>
#include <string>
#include <csignal>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <fcntl.h>

// Argument-parsing scenarios: happy paths first, then error handling.
TEST_CASE("TermCapture Argument Parsing", "[term_capture][args]") {
    // --- Happy-path parsing ---
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

    // --- Missing argument handling ---
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

    SECTION("Empty prefix is rejected", "[term_capture][args][error]") {
        char* argv[] = {const_cast<char*>("term-capture"), const_cast<char*>("")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Prefix cannot be empty") != std::string::npos);
    }

    // --- WebSocket flag parsing ---
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

    SECTION("Duplicate WS flags take the last value", "[term_capture][args][ws]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-token=first"),
            const_cast<char*>("--ws-token"), const_cast<char*>("second"),
            const_cast<char*>("myprefix"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "myprefix");
        REQUIRE(config.ws_token == "second");
    }

    // --- Communicating command boundaries ---
    SECTION("-- sentinel treats later dashes as command arguments", "[term_capture][args]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("myprefix"),
            const_cast<char*>("--"),
            const_cast<char*>("--not-a-flag"),
            const_cast<char*>("-v"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "myprefix");
        REQUIRE(config.command_and_args.size() == 2);
        REQUIRE(config.command_and_args[0] == "--not-a-flag");
        REQUIRE(config.command_and_args[1] == "-v");
    }

    // --- WebSocket flag error handling ---
    SECTION("Invalid ws-send-buffer value is rejected", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-send-buffer"), const_cast<char*>("not-a-number"),
            const_cast<char*>("myprefix"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Invalid value for --ws-send-buffer") != std::string::npos);
    }

    SECTION("Missing ws flag value is rejected", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-listen"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Missing value for --ws-listen") != std::string::npos);
    }

    SECTION("Missing ws-token value is rejected", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-token"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Missing value for --ws-token") != std::string::npos);
    }

    SECTION("Missing ws-send-buffer value is rejected", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-send-buffer"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Missing value for --ws-send-buffer") != std::string::npos);
    }

    SECTION("Invalid ws-send-buffer equals syntax value is rejected", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-send-buffer=not-a-number"),
            const_cast<char*>("myprefix"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Invalid value for --ws-send-buffer") != std::string::npos);
    }

    SECTION("ws-send-buffer equals syntax parses", "[term_capture][args][ws]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-send-buffer=123"),
            const_cast<char*>("myprefix"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.ws_send_buffer == static_cast<size_t>(123));
        REQUIRE(config.log_prefix == "myprefix");
    }

    SECTION("Only ws flags and no prefix yields usage error", "[term_capture][args][ws][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--ws-allow-remote"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Usage: term-capture") != std::string::npos);
    }

    // --- Unknown flags ---
    SECTION("Unknown flag causes parse failure", "[term_capture][args][error]") {
        char* argv[] = {
            const_cast<char*>("term-capture"),
            const_cast<char*>("--mystery-flag"),
            const_cast<char*>("myprefix"),
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE(config.error_message.find("Unknown flag") != std::string::npos);
    }
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

TEST_CASE("handle_winch wakes the event loop via self-pipe", "[term_capture][signals][winch]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    int fds[2];
    REQUIRE(pipe(fds) == 0);
    set_winch_pipe_fds_for_test(fds[0], fds[1]);

    handle_winch(0);

    char b = '\0';
    ssize_t n = read(fds[0], &b, 1);
    REQUIRE(n == 1);
    REQUIRE(b == 'w');

    set_winch_pipe_fds_for_test(-1, -1);
    close(fds[0]);
    close(fds[1]);
#else
    SUCCEED("Not built as LIB; test hooks unavailable.");
#endif
}

TEST_CASE("cleanup closes internal fds when present", "[term_capture][cleanup]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    // Forward-declare the internal function (linked via term_capture_for_test.o).
    void cleanup();

    int pipe1[2];
    int pipe2[2];
    REQUIRE(pipe(pipe1) == 0);
    REQUIRE(pipe(pipe2) == 0);

    set_winch_pipe_fds_for_test(pipe1[0], pipe1[1]);
    set_master_fd_for_test(pipe2[0]);
    set_child_pid_for_test(-1);

    cleanup();

    int rc = fcntl(pipe1[0], F_GETFL);
    REQUIRE(rc == -1);
    REQUIRE(errno == EBADF);
    rc = fcntl(pipe2[0], F_GETFL);
    REQUIRE(rc == -1);
    REQUIRE(errno == EBADF);

    // Our test still owns the write ends (unless cleanup closed them).
    close(pipe2[1]);
#else
    SUCCEED("Not built as LIB; test hooks unavailable.");
#endif
}

TEST_CASE("restore_terminal attempts tcsetattr when orig termios is available", "[term_capture][termios]") {
#ifdef BUILD_TERM_CAPTURE_AS_LIB
    // Never scribble random termios onto the user's terminal:
    // capture the current settings and "restore" them back.
    if (!set_orig_termios_from_stdin_for_test()) {
        SUCCEED("STDIN is not a TTY; skipping restore_terminal branch coverage.");
        return;
    }

    set_have_orig_termios_for_test(true);
    call_restore_terminal_for_test();
    set_have_orig_termios_for_test(false);
    REQUIRE(true);
#else
    SUCCEED("Not built as LIB; termios hooks unavailable.");
#endif
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

struct IntegrationPrereq {
    bool ready;
    std::string message;
};

static IntegrationPrereq compute_integration_prereq() {
    if (!file_exists("debug/term-capture")) {
        return {false, "Integration tests require debug/term-capture. Run `make debug` before executing them."};
    }
    int fd = ::posix_openpt(O_RDWR | O_NOCTTY);
    if (fd < 0) {
        std::string msg = "posix_openpt failed (" + std::to_string(errno) + ": " + std::string(std::strerror(errno)) + ")";
        msg += ". Integration tests require PTY support.";
        return {false, msg};
    }
    ::close(fd);
    return {true, {}};
}

static const IntegrationPrereq& integration_prereq() {
    static IntegrationPrereq prereq = compute_integration_prereq();
    return prereq;
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

// Integration smoke: captures a short-lived command and checks log artifacts.
TEST_CASE("Integration: trivial command creates logs and captures output", "[integration][term_capture]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    REQUIRE(prereq.ready);
    // Prefix under debug/ to keep artifacts in build dir
    const std::string prefix = "debug/it_echo";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = output_path + ".events";
    const std::string meta_path = prefix + ".meta.json";

    // Clean up any leftovers
    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());

    // Run term-capture with a trivial command that exits quickly
    // Expect: logs created; output contains "hello"
    // Pipe empty input so this test doesn't depend on any interactive keystrokes.
    int rc = std::system("printf '' | ./debug/term-capture debug/it_echo /bin/echo hello >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(input_tidx_path));
    REQUIRE(file_exists(output_tidx_path));
    REQUIRE(file_exists(output_events_path));
    REQUIRE(file_exists(meta_path));

    // For this run we didn't type anything, so input log should usually be empty
    // (It may not be strictly required, but is expected.)
    CHECK(file_size(input_path) == 0);
    CHECK(file_size(input_tidx_path) >= 14);  // header-only is OK
    CHECK(file_size(output_tidx_path) > 14);  // should have at least one record
    CHECK(file_size(output_events_path) >= 13); // header-only is OK in non-tty runs

    const std::string out = read_all(output_path);
    // PTY may transform newline to CRLF, so check substring rather than exact equality
    REQUIRE(out.find("hello") != std::string::npos);
}

// Integration variant: ensure multi-line PTY output is preserved in the log.
TEST_CASE("Integration: sh -c printf captures multi-line output", "[integration][term_capture]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    REQUIRE(prereq.ready);
    const std::string prefix = "debug/it_printf";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = output_path + ".events";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());

    // Quote the printf argument so the shell interprets the newline escape
    int rc = std::system("printf '' | ./debug/term-capture debug/it_printf /bin/sh -c \"printf 'a\\nb'\" >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(output_tidx_path));
    REQUIRE(file_exists(output_events_path));

    const std::string out = read_all(output_path);
    // Expect both 'a' and 'b' present, with some newline/CRLF between
    REQUIRE(out.find('a') != std::string::npos);
    REQUIRE(out.find('b') != std::string::npos);
    REQUIRE(out.find("ab") == std::string::npos); // should not be contiguous without a line break
}

// Integration: default shell fallback when no explicit command is supplied.
TEST_CASE("Integration: fallback to zsh when no command is provided", "[integration][term_capture][shell]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    REQUIRE(prereq.ready);
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
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = output_path + ".events";
    const std::string meta_path = prefix + ".meta.json";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());

    // Pipe commands into term-capture's STDIN so the interactive shell exits automatically.
    // We emit a marker and then exit to keep the test bounded.
    int rc = std::system("printf 'echo fallback_ok\\nexit\\n' | ./debug/term-capture debug/it_fallback >/dev/null 2>&1");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(input_tidx_path));
    REQUIRE(file_exists(output_tidx_path));
    REQUIRE(file_exists(output_events_path));
    REQUIRE(file_exists(meta_path));

    const std::string out = read_all(output_path);
    REQUIRE(out.find("fallback_ok") != std::string::npos);
}

// Integration: WS CLI flags emit stub metadata until the server implementation lands.
TEST_CASE("Integration: WS flags create stub metadata and print skeleton notice", "[integration][term_capture][ws]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    REQUIRE(prereq.ready);
    const std::string prefix = "debug/it_ws";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = output_path + ".events";
    const std::string meta_path = prefix + ".meta.json";
    const std::string ws_meta = prefix + ".ws.json";
    const std::string stderr_path = "debug/it_ws.stderr";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());
    std::remove(ws_meta.c_str());
    std::remove(stderr_path.c_str());

    // Place WS flags before prefix to avoid ambiguity with command args
    int rc = std::system("printf '' | ./debug/term-capture --ws-listen 127.0.0.1:0 "
                         "debug/it_ws /bin/echo ok 2> debug/it_ws.stderr >/dev/null");
    REQUIRE(rc == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(input_tidx_path));
    REQUIRE(file_exists(output_tidx_path));
    REQUIRE(file_exists(output_events_path));
    REQUIRE(file_exists(meta_path));
    REQUIRE(file_exists(ws_meta));

    const std::string err = read_all(stderr_path);
    REQUIRE(err.find("WS: planned") != std::string::npos);
}

// Integration: invalid log paths should fail fast and return non-zero.
TEST_CASE("Integration: invalid log directory causes failure to open logs", "[integration][term_capture][errors]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    REQUIRE(prereq.ready);
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
