#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "../term-capture.hpp"   // Include the header for term_capture
#include "../tcap.hpp"
#include <vector>
#include <string>
#include <csignal>
#include <unistd.h>
#include <cstdlib>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <sys/stat.h>

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
#include <cstdio>
#include <fstream>
#include <cstdlib>

static bool file_exists(const std::string& path) {
    struct stat st{};
    return ::stat(path.c_str(), &st) == 0;
}

static bool is_directory(const std::string& path) {
    struct stat st{};
    if (::stat(path.c_str(), &st) != 0) return false;
    return S_ISDIR(st.st_mode);
}

static bool is_regular_file(const std::string& path) {
    struct stat st{};
    if (::stat(path.c_str(), &st) != 0) return false;
    return S_ISREG(st.st_mode);
}

static std::string term_capture_bin() {
    const char* v = std::getenv("TERM_CAPTURE_BIN");
    if (v && *v) return std::string(v);
    // Prefer the coverage-instrumented runtime binary when present so integration
    // tests contribute coverage for `main()` and other runtime-only code paths.
    const std::string cov = "./debug/term-capture_cov";
    if (file_exists(cov)) return cov;
    return "./debug/term-capture";
}

struct IntegrationPrereq {
    bool ready;
    std::string message;
};

static IntegrationPrereq compute_integration_prereq() {
    const std::string bin = term_capture_bin();
    if (!file_exists(bin)) {
        return {false, "Integration tests require " + bin + ". Run `make test-lite` (or build the runtime binary) before executing them."};
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

struct PtyChild {
    pid_t pid{-1};
    int master_fd{-1};
    int stdin_write_fd{-1};
};

static bool set_fd_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0) return false;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}

struct PtyStdioConfig {
    bool pipe_stdin{false};        // make STDIN non-tty (pipe)
    bool devnull_stdout{false};    // make STDOUT non-tty (/dev/null)
    bool keep_stderr_tty{true};    // keep STDERR connected to the PTY
};

static PtyChild spawn_under_pty(const std::vector<std::string>& args, const PtyStdioConfig& cfg = {}) {
    PtyChild child;
    int stdin_pipe[2] = {-1, -1};
    if (cfg.pipe_stdin) {
        if (::pipe(stdin_pipe) != 0) return child;
    }

    int master_fd = ::posix_openpt(O_RDWR | O_NOCTTY);
    if (master_fd < 0) return child;
    if (::grantpt(master_fd) != 0 || ::unlockpt(master_fd) != 0) {
        ::close(master_fd);
        return child;
    }
    char* slave_name = ::ptsname(master_fd);
    if (!slave_name) {
        ::close(master_fd);
        return child;
    }
    int slave_fd = ::open(slave_name, O_RDWR);
    if (slave_fd < 0) {
        ::close(master_fd);
        return child;
    }

    pid_t pid = ::fork();
    if (pid < 0) {
        ::close(slave_fd);
        ::close(master_fd);
        if (stdin_pipe[0] >= 0) ::close(stdin_pipe[0]);
        if (stdin_pipe[1] >= 0) ::close(stdin_pipe[1]);
        return child;
    }
    if (pid == 0) {
        (void)::setsid();
        (void)::ioctl(slave_fd, TIOCSCTTY, 0);

        if (cfg.pipe_stdin) {
            (void)::dup2(stdin_pipe[0], STDIN_FILENO);
        } else {
            (void)::dup2(slave_fd, STDIN_FILENO);
        }

        if (cfg.devnull_stdout) {
            int dn = ::open("/dev/null", O_WRONLY);
            if (dn >= 0) {
                (void)::dup2(dn, STDOUT_FILENO);
                ::close(dn);
            } else {
                (void)::dup2(slave_fd, STDOUT_FILENO);
            }
        } else {
            (void)::dup2(slave_fd, STDOUT_FILENO);
        }

        if (cfg.keep_stderr_tty) {
            (void)::dup2(slave_fd, STDERR_FILENO);
        } else {
            int dn = ::open("/dev/null", O_WRONLY);
            if (dn >= 0) {
                (void)::dup2(dn, STDERR_FILENO);
                ::close(dn);
            } else {
                (void)::dup2(slave_fd, STDERR_FILENO);
            }
        }
        if (slave_fd > STDERR_FILENO) ::close(slave_fd);
        ::close(master_fd);
        if (stdin_pipe[0] >= 0) ::close(stdin_pipe[0]);
        if (stdin_pipe[1] >= 0) ::close(stdin_pipe[1]);

        std::vector<char*> argv;
        argv.reserve(args.size() + 1);
        for (const auto& s : args) argv.push_back(const_cast<char*>(s.c_str()));
        argv.push_back(nullptr);
        ::execvp(argv[0], argv.data());
        _exit(127);
    }

    ::close(slave_fd);
    child.pid = pid;
    child.master_fd = master_fd;
    (void)set_fd_nonblocking(master_fd);
    if (cfg.pipe_stdin) {
        ::close(stdin_pipe[0]);
        child.stdin_write_fd = stdin_pipe[1];
    }
    return child;
}

static int wait_pid_with_timeout(pid_t pid, int timeout_ms) {
    const int step_ms = 10;
    int waited = 0;
    for (;;) {
        int status = 0;
        pid_t rc = ::waitpid(pid, &status, WNOHANG);
        if (rc == pid) return status;
        if (rc < 0) return -1;
        if (waited >= timeout_ms) return -2;
        ::usleep(step_ms * 1000);
        waited += step_ms;
    }
}

static std::string drain_fd_until_eof_or_timeout(int fd, int timeout_ms) {
    std::string out;
    const int step_ms = 10;
    int waited = 0;
    for (;;) {
        char buf[4096];
        ssize_t n = ::read(fd, buf, sizeof(buf));
        if (n > 0) {
            out.append(buf, buf + n);
            continue;
        }
        if (n == 0) break;
        if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) break;

        if (waited >= timeout_ms) break;
        ::usleep(step_ms * 1000);
        waited += step_ms;
    }
    return out;
}

static size_t count_resize_events(const std::string& events_path) {
    const std::string data = read_all(events_path);
    auto parse_u64_field = [](const std::string& line, const std::string& key, uint64_t& out) -> bool {
        const size_t pos = line.find(key);
        if (pos == std::string::npos) return false;
        const size_t start = pos + key.size();
        if (start >= line.size()) return false;
        if (line[start] < '0' || line[start] > '9') return false;
        char* end = nullptr;
        errno = 0;
        unsigned long long v = std::strtoull(line.c_str() + start, &end, 10);
        if (errno != 0) return false;
        if (end == nullptr || end == line.c_str() + start) return false;
        out = static_cast<uint64_t>(v);
        return true;
    };

    size_t count = 0;
    uint64_t prev_t_ns = 0;
    uint64_t prev_off = 0;
    bool have_prev = false;

    size_t start = 0;
    while (start <= data.size()) {
        size_t end = data.find('\n', start);
        if (end == std::string::npos) end = data.size();
        std::string line = data.substr(start, end - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        start = end + 1;

        if (line.empty()) continue;
        if (line.find("\"type\":\"resize\"") == std::string::npos) continue;
        if (line.find("\"stream\":\"output\"") == std::string::npos) continue;

        uint64_t t_ns = 0, stream_offset = 0, cols = 0, rows = 0;
        if (!parse_u64_field(line, "\"t_ns\":", t_ns)) return 0;
        if (!parse_u64_field(line, "\"stream_offset\":", stream_offset)) return 0;
        if (!parse_u64_field(line, "\"cols\":", cols)) return 0;
        if (!parse_u64_field(line, "\"rows\":", rows)) return 0;

        if (have_prev) {
            if (t_ns < prev_t_ns) return 0;
            if (stream_offset < prev_off) return 0;
        }
        prev_t_ns = t_ns;
        prev_off = stream_offset;
        have_prev = true;
        ++count;
    }
    return count;
}

struct TidxParsed {
    uint8_t flags = 0;
    uint64_t started_at_unix_ns = 0;
    std::vector<uint64_t> t_ns;
    std::vector<uint64_t> end_offsets;
};

static bool parse_u64_le(const std::string& data, size_t offset, uint64_t& out) {
    if (offset + 8 > data.size()) return false;
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i) {
        v |= static_cast<uint64_t>(static_cast<uint8_t>(data[offset + static_cast<size_t>(i)])) << (i * 8);
    }
    out = v;
    return true;
}

static bool parse_tidx_file(const std::string& tidx_path, TidxParsed& out) {
    const std::string data = read_all(tidx_path);
    if (data.size() < 14) return false;
    if (data.rfind("TIDX1", 0) != 0) return false;
    out.flags = static_cast<uint8_t>(data[5]);
    if (!parse_u64_le(data, 6, out.started_at_unix_ns)) return false;

    size_t i = 14; // magic(5) + flags(1) + started_at_unix_ns(8)
    uint64_t t = 0;
    uint64_t end = 0;
    while (i < data.size()) {
        uint64_t dt = 0;
        auto r1 = uleb128_decode(reinterpret_cast<const uint8_t*>(data.data() + i), data.size() - i, dt);
        if (!r1.first) return false;
        i += r1.second;

        uint64_t dend = 0;
        auto r2 = uleb128_decode(reinterpret_cast<const uint8_t*>(data.data() + i), data.size() - i, dend);
        if (!r2.first) return false;
        i += r2.second;

        t += dt;
        end += dend;
        out.t_ns.push_back(t);
        out.end_offsets.push_back(end);
    }
    return true;
}

static bool parse_meta_started_at_unix_ns(const std::string& meta_path, uint64_t& out) {
    const std::string s = read_all(meta_path);
    const std::string key = "\"started_at_unix_ns\":";
    size_t pos = s.find(key);
    if (pos == std::string::npos) return false;
    pos += key.size();
    while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t')) pos++;
    if (pos >= s.size() || s[pos] < '0' || s[pos] > '9') return false;
    char* end = nullptr;
    errno = 0;
    unsigned long long v = std::strtoull(s.c_str() + pos, &end, 10);
    if (errno != 0) return false;
    if (end == nullptr || end == s.c_str() + pos) return false;
    out = static_cast<uint64_t>(v);
    return true;
}

// Integration smoke: captures a short-lived command and checks log artifacts.
TEST_CASE("Integration: trivial command creates logs and captures output", "[integration][term_capture]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);
    // Prefix under debug/ to keep artifacts in build dir
    const std::string prefix = "debug/it_echo";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";
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
    const std::string cmd = "printf '' | " + term_capture_bin() + " debug/it_echo /bin/echo hello >/dev/null 2>&1";
    int rc = std::system(cmd.c_str());
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
    // If no controlling TTY is available, the events JSONL may be empty (but the file should exist).
    CHECK(is_regular_file(output_events_path));

    uint64_t meta_started = 0;
    REQUIRE(parse_meta_started_at_unix_ns(meta_path, meta_started));

    TidxParsed input_tidx{};
    TidxParsed output_tidx{};
    REQUIRE(parse_tidx_file(input_tidx_path, input_tidx));
    REQUIRE(parse_tidx_file(output_tidx_path, output_tidx));
    REQUIRE(input_tidx.flags == 0);
    REQUIRE(output_tidx.flags == 0);
    REQUIRE(input_tidx.started_at_unix_ns == meta_started);
    REQUIRE(output_tidx.started_at_unix_ns == meta_started);

    if (!input_tidx.end_offsets.empty()) {
        REQUIRE(input_tidx.end_offsets.back() == file_size(input_path));
    }
    REQUIRE(!output_tidx.end_offsets.empty());
    REQUIRE(output_tidx.end_offsets.back() == file_size(output_path));

    const std::string out = read_all(output_path);
    // PTY may transform newline to CRLF, so check substring rather than exact equality
    REQUIRE(out.find("hello") != std::string::npos);
}

TEST_CASE("Integration: PTY-attached run exercises tty code paths", "[integration][term_capture][pty]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_pty";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";
    const std::string meta_path = prefix + ".meta.json";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());

    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/echo", "pty_ok",
    };
    PtyChild child = spawn_under_pty(args);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);

    const int status = wait_pid_with_timeout(child.pid, 3000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    REQUIRE(file_exists(input_path));
    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(input_tidx_path));
    REQUIRE(file_exists(output_tidx_path));
    REQUIRE(file_exists(output_events_path));
    REQUIRE(file_exists(meta_path));
    REQUIRE(read_all(output_path).find("pty_ok") != std::string::npos);
    REQUIRE(count_resize_events(output_events_path) >= 1);
}

TEST_CASE("Integration: SIGWINCH produces additional resize metadata", "[integration][term_capture][pty][winch]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_winch";
    const std::string output_path = prefix + ".output";
    const std::string output_events_path = prefix + ".events.jsonl";

    std::remove((prefix + ".input").c_str());
    std::remove(output_path.c_str());
    std::remove((output_path + ".tidx").c_str());
    std::remove(output_events_path.c_str());
    std::remove((prefix + ".meta.json").c_str());

    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/sh", "-c", "sleep 0.3; echo winch_ok",
    };
    PtyChild child = spawn_under_pty(args);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);

    ::usleep(50 * 1000);
    struct winsize ws{};
    ws.ws_col = 100;
    ws.ws_row = 40;
    (void)::ioctl(child.master_fd, TIOCSWINSZ, &ws);
    (void)::kill(child.pid, SIGWINCH);

    const int status = wait_pid_with_timeout(child.pid, 5000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    REQUIRE(file_exists(output_path));
    REQUIRE(file_exists(output_events_path));
    REQUIRE(read_all(output_path).find("winch_ok") != std::string::npos);
    REQUIRE(count_resize_events(output_events_path) >= 2);
}

TEST_CASE("Integration: controlling tty falls back to STDOUT when stdin is not a tty", "[integration][term_capture][pty][tty]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_tty_stdout";
    const std::string output_events_path = prefix + ".events.jsonl";

    std::remove((prefix + ".input").c_str());
    std::remove((prefix + ".output").c_str());
    std::remove((prefix + ".output.tidx").c_str());
    std::remove(output_events_path.c_str());
    std::remove((prefix + ".meta.json").c_str());

    PtyStdioConfig cfg;
    cfg.pipe_stdin = true;       // isatty(stdin)=false
    cfg.devnull_stdout = false;  // isatty(stdout)=true
    cfg.keep_stderr_tty = true;
    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/echo", "tty_stdout_ok",
    };
    PtyChild child = spawn_under_pty(args, cfg);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);
    REQUIRE(child.stdin_write_fd >= 0);

    // Close stdin to force EOF inside term-capture.
    ::close(child.stdin_write_fd);
    child.stdin_write_fd = -1;

    const int status = wait_pid_with_timeout(child.pid, 3000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    // If it properly picked STDOUT as controlling tty, it should have written a resize event.
    REQUIRE(is_regular_file(output_events_path));
    REQUIRE(count_resize_events(output_events_path) >= 1);
}

TEST_CASE("Integration: controlling tty falls back to STDERR when stdin/stdout are not ttys", "[integration][term_capture][pty][tty]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_tty_stderr";
    const std::string output_events_path = prefix + ".events.jsonl";

    std::remove((prefix + ".input").c_str());
    std::remove((prefix + ".output").c_str());
    std::remove((prefix + ".output.tidx").c_str());
    std::remove(output_events_path.c_str());
    std::remove((prefix + ".meta.json").c_str());

    PtyStdioConfig cfg;
    cfg.pipe_stdin = true;        // isatty(stdin)=false
    cfg.devnull_stdout = true;    // isatty(stdout)=false
    cfg.keep_stderr_tty = true;   // isatty(stderr)=true
    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/echo", "tty_stderr_ok",
    };
    PtyChild child = spawn_under_pty(args, cfg);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);
    REQUIRE(child.stdin_write_fd >= 0);

    ::close(child.stdin_write_fd);
    child.stdin_write_fd = -1;

    const int status = wait_pid_with_timeout(child.pid, 3000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    REQUIRE(is_regular_file(output_events_path));
    REQUIRE(count_resize_events(output_events_path) >= 1);
}

TEST_CASE("Integration: sidecar failures disable metadata but capture still succeeds", "[integration][term_capture][tcap][errors]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_sidecar_fail";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";
    const std::string meta_path = prefix + ".meta.json";
    const std::string stderr_path = "debug/it_sidecar_fail.stderr";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());
    std::remove(stderr_path.c_str());
    // Remove and replace with directories so open_trunc() fails but logs still open.
    ::rmdir(input_tidx_path.c_str());
    ::rmdir(output_tidx_path.c_str());
    ::rmdir(output_events_path.c_str());
    REQUIRE(::mkdir(input_tidx_path.c_str(), 0755) == 0);
    REQUIRE(::mkdir(output_tidx_path.c_str(), 0755) == 0);
    REQUIRE(::mkdir(output_events_path.c_str(), 0755) == 0);
    REQUIRE(is_directory(input_tidx_path));
    REQUIRE(is_directory(output_tidx_path));
    REQUIRE(is_directory(output_events_path));

    const std::string cmd =
        "printf '' | " + term_capture_bin() + " " + prefix + " /bin/echo sidecar_ok 2> " + stderr_path + " >/dev/null";
    int rc = std::system(cmd.c_str());
    REQUIRE(rc == 0);

    REQUIRE(is_regular_file(input_path));
    REQUIRE(is_regular_file(output_path));
    REQUIRE(is_regular_file(meta_path));
    // Sidecars remain directories (not created as regular files).
    REQUIRE(is_directory(input_tidx_path));
    REQUIRE(is_directory(output_tidx_path));
    REQUIRE(is_directory(output_events_path));

    const std::string err = read_all(stderr_path);
    REQUIRE(err.find("TCAP: warning") != std::string::npos);
}

TEST_CASE("Integration: missing args prints usage and exits non-zero", "[integration][term_capture][args]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string cmd = term_capture_bin() + " >/dev/null 2>&1";
    int rc = std::system(cmd.c_str());
    REQUIRE(rc != 0);
}

TEST_CASE("Integration: stdin EOF stops input but capture continues", "[integration][term_capture][pty][stdin]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_stdin_eof";
    const std::string output_path = prefix + ".output";

    std::remove((prefix + ".input").c_str());
    std::remove(output_path.c_str());
    std::remove((prefix + ".input.tidx").c_str());
    std::remove((output_path + ".tidx").c_str());
    std::remove((prefix + ".events.jsonl").c_str());
    std::remove((prefix + ".meta.json").c_str());

    PtyStdioConfig cfg;
    cfg.pipe_stdin = true; // make stdin non-tty so we can force EOF deterministically
    cfg.devnull_stdout = false;
    cfg.keep_stderr_tty = true;
    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/sh", "-c", "echo before; sleep 0.2; echo after",
    };
    PtyChild child = spawn_under_pty(args, cfg);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);
    REQUIRE(child.stdin_write_fd >= 0);

    // Force EOF on stdin immediately.
    ::close(child.stdin_write_fd);
    child.stdin_write_fd = -1;

    const int status = wait_pid_with_timeout(child.pid, 5000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    REQUIRE(is_regular_file(output_path));
    const std::string out = read_all(output_path);
    REQUIRE(out.find("before") != std::string::npos);
    REQUIRE(out.find("after") != std::string::npos);
}

TEST_CASE("Integration: SIGINT triggers graceful teardown path", "[integration][term_capture][pty][signals]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);

    const std::string prefix = "debug/it_sigint";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove((prefix + ".meta.json").c_str());

    const std::vector<std::string> args = {
        term_capture_bin(), prefix, "/bin/sh", "-c", "sleep 5",
    };
    PtyChild child = spawn_under_pty(args);
    REQUIRE(child.pid > 0);
    REQUIRE(child.master_fd >= 0);

    ::usleep(100 * 1000);
    REQUIRE(::kill(child.pid, SIGINT) == 0);

    const int status = wait_pid_with_timeout(child.pid, 5000);
    (void)drain_fd_until_eof_or_timeout(child.master_fd, 1000);
    ::close(child.master_fd);
    REQUIRE(status >= 0);
    REQUIRE(WIFEXITED(status));
    REQUIRE(WEXITSTATUS(status) == 0);

    // These should exist and (importantly) the process should have reached the close() path.
    REQUIRE(is_regular_file(input_path));
    REQUIRE(is_regular_file(output_path));
    REQUIRE(is_regular_file(input_tidx_path));
    REQUIRE(is_regular_file(output_tidx_path));
    REQUIRE(is_regular_file(output_events_path));
}

// Integration variant: ensure multi-line PTY output is preserved in the log.
TEST_CASE("Integration: sh -c printf captures multi-line output", "[integration][term_capture]") {
    const auto& prereq = integration_prereq();
    INFO(prereq.message);
    if (!prereq.ready) SKIP(prereq.message);
    const std::string prefix = "debug/it_printf";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());

    // Quote the printf argument so the shell interprets the newline escape
    const std::string cmd =
        "printf '' | " + term_capture_bin() + " debug/it_printf /bin/sh -c \"printf 'a\\nb'\" >/dev/null 2>&1";
    int rc = std::system(cmd.c_str());
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
    if (!prereq.ready) SKIP(prereq.message);
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
    const std::string output_events_path = prefix + ".events.jsonl";
    const std::string meta_path = prefix + ".meta.json";

    std::remove(input_path.c_str());
    std::remove(output_path.c_str());
    std::remove(input_tidx_path.c_str());
    std::remove(output_tidx_path.c_str());
    std::remove(output_events_path.c_str());
    std::remove(meta_path.c_str());

    // Pipe commands into term-capture's STDIN so the interactive shell exits automatically.
    // We emit a marker and then exit to keep the test bounded.
    const std::string cmd =
        "printf 'echo fallback_ok\\nexit\\n' | " + term_capture_bin() + " debug/it_fallback >/dev/null 2>&1";
    int rc = std::system(cmd.c_str());
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
    if (!prereq.ready) SKIP(prereq.message);
    const std::string prefix = "debug/it_ws";
    const std::string input_path = prefix + ".input";
    const std::string output_path = prefix + ".output";
    const std::string input_tidx_path = input_path + ".tidx";
    const std::string output_tidx_path = output_path + ".tidx";
    const std::string output_events_path = prefix + ".events.jsonl";
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
    const std::string cmd = "printf '' | " + term_capture_bin() + " --ws-listen 127.0.0.1:0 "
                            "debug/it_ws /bin/echo ok 2> debug/it_ws.stderr >/dev/null";
    int rc = std::system(cmd.c_str());
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
    if (!prereq.ready) SKIP(prereq.message);
    // Use a prefix that points into a non-existent directory
    const std::string cmd = term_capture_bin() + " debug/does-not-exist/subdir/log /bin/echo ok >/dev/null 2>&1";
    int rc = std::system(cmd.c_str());
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
