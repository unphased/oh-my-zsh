#include "term-capture.hpp" // Include the new header

#include <iostream>
#include <fstream>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <chrono>
#include <sstream>

#include "tcap.hpp"

#ifndef TERM_CAPTURE_BUILD_GIT_SHA
#define TERM_CAPTURE_BUILD_GIT_SHA "unknown"
#endif

#ifndef TERM_CAPTURE_BUILD_GIT_DIRTY
#define TERM_CAPTURE_BUILD_GIT_DIRTY 0
#endif

static volatile bool should_exit = false;
static struct termios orig_termios;
static bool have_orig_termios = false;
static int masterFd = -1;
static pid_t child_pid = -1;
static volatile bool did_cleanup = false;
static volatile sig_atomic_t winch_pending = 0;
static int winch_pipe_fds[2] = {-1, -1};

// Restore parent terminal to original settings
void restore_terminal() {
  if (have_orig_termios) {
    tcsetattr(STDIN_FILENO, TCSANOW, &orig_termios);
  }
}

void cleanup() {
  restore_terminal();
  if (winch_pipe_fds[0] >= 0) {
    close(winch_pipe_fds[0]);
    winch_pipe_fds[0] = -1;
  }
  if (winch_pipe_fds[1] >= 0) {
    close(winch_pipe_fds[1]);
    winch_pipe_fds[1] = -1;
  }
  if (masterFd >= 0) {
    close(masterFd);
    masterFd = -1;
  }
  if (child_pid > 0) {
    kill(child_pid, SIGTERM);
    waitpid(child_pid, nullptr, 0);
    child_pid = -1;
  }
  std::cerr << "\nTerminal capture completed. Logs have been saved.\n";
  did_cleanup = true;
}

void cleanup_and_exit(int code) {
  cleanup();
#ifndef BUILD_TERM_CAPTURE_AS_LIB
  exit(code);
#else
  (void)code;
#endif
}

#ifndef BUILD_TERM_CAPTURE_AS_LIB
static int pick_controlling_tty_fd() {
  if (isatty(STDIN_FILENO)) return STDIN_FILENO;
  if (isatty(STDOUT_FILENO)) return STDOUT_FILENO;
  if (isatty(STDERR_FILENO)) return STDERR_FILENO;
  return -1;
}

static void apply_winsize_to_child_pty() {
  if (masterFd < 0) return;
  int tty_fd = pick_controlling_tty_fd();
  if (tty_fd < 0) return;
  struct winsize ws;
  if (ioctl(tty_fd, TIOCGWINSZ, &ws) != 0) return;
  (void)ioctl(masterFd, TIOCSWINSZ, &ws);

  pid_t fg_pgrp = tcgetpgrp(masterFd);
  if (fg_pgrp > 0) {
    (void)kill(-fg_pgrp, SIGWINCH);
  } else if (child_pid > 0) {
    (void)kill(child_pid, SIGWINCH);
  }
}
#endif // BUILD_TERM_CAPTURE_AS_LIB

// Handle Ctrl+C, SIGTERM, etc.
void signal_handler(int sig) {
  should_exit = true;
  if (sig == SIGCHLD) {
    int status;
    pid_t pid = waitpid(-1, &status, WNOHANG);
    if (pid == child_pid) {
      cleanup_and_exit(0);
    }
  }
}

// Propagate window size changes to the child PTY
void handle_winch(int) {
  winch_pending = 1;
  if (winch_pipe_fds[1] >= 0) {
    const char b = 'w';
    (void)write(winch_pipe_fds[1], &b, 1);
  }
}

Config parse_arguments(int argc, char* argv[]) {
  Config config;

  if (argc <= 1) {
    config.valid = false;
    config.error_message = "Usage: " + std::string(argv[0]) + " [--ws-* flags] <prefix> [command...]\n"
      "  <prefix>    Prefix for the log files. Will create <prefix>.input and <prefix>.output\n"
      "  [command]   Optional command to execute (defaults to zsh if not specified)\n"
      "  --ws-listen HOST:PORT     Bind address for WS server (MVP skeleton; no server yet)\n"
      "  --ws-token TOKEN          Optional shared secret for WS connections\n"
      "  --ws-allow-remote         Allow binding to 0.0.0.0 (insecure without proxy/TLS)\n"
      "  --ws-send-buffer BYTES    Per-client send buffer (for future backpressure controls)\n";
    return config;
  }

  bool have_prefix = false;
  bool in_command_args = false;

  auto parse_kv = [](const std::string& s, const std::string& key) -> std::string {
    std::string prefix = key + "=";
    if (s.rfind(prefix, 0) == 0) {
      return s.substr(prefix.size());
    }
    return {};
  };

  for (int i = 1; i < argc; ++i) {
    std::string arg = argv[i];

    if (!in_command_args && !arg.empty() && arg[0] == '-') {
      if (arg == "--") {
        in_command_args = true;
        continue;
      }
      if (arg == "--ws-allow-remote") {
        config.ws_allow_remote = true;
        continue;
      }
      // Support --flag=value form
      std::string v;
      if ((v = parse_kv(arg, "--ws-listen")).size()) {
        config.ws_listen = v;
        continue;
      }
      if ((v = parse_kv(arg, "--ws-token")).size()) {
        config.ws_token = v;
        continue;
      }
      if ((v = parse_kv(arg, "--ws-send-buffer")).size()) {
        try {
          config.ws_send_buffer = static_cast<size_t>(std::stoull(v));
        } catch (...) {
          config.valid = false;
          config.error_message = "Invalid value for --ws-send-buffer: " + v + "\n";
          return config;
        }
        continue;
      }
      // Support --flag value form (consume next)
      if (arg == "--ws-listen" || arg == "--ws-token" || arg == "--ws-send-buffer") {
        if (i + 1 >= argc) {
          config.valid = false;
          config.error_message = "Missing value for " + arg + "\n";
          return config;
        }
        std::string val = argv[++i];
        if (arg == "--ws-listen") {
          config.ws_listen = val;
        } else if (arg == "--ws-token") {
          config.ws_token = val;
        } else { // --ws-send-buffer
          try {
            config.ws_send_buffer = static_cast<size_t>(std::stoull(val));
          } catch (...) {
            config.valid = false;
            config.error_message = "Invalid value for --ws-send-buffer: " + val + "\n";
            return config;
          }
        }
        continue;
      }
      // Unknown flag
      config.valid = false;
      config.error_message = "Unknown flag: " + arg + "\n";
      return config;
    }

    if (!have_prefix) {
      if (arg.empty()) {
        config.valid = false;
        config.error_message = "Prefix cannot be empty.\n";
        return config;
      }
      config.log_prefix = arg;
      have_prefix = true;
    } else {
      in_command_args = true;
      config.command_and_args.push_back(arg);
    }
  }

  if (!have_prefix) {
    config.valid = false;
    config.error_message = "Usage: " + std::string(argv[0]) + " [--ws-* flags] <prefix> [command...]\n";
    return config;
  }

  return config;
}

std::vector<const char*> build_exec_argv(const std::vector<std::string>& args) {
  std::vector<const char*> out;
  if (!args.empty()) {
    out.reserve(args.size() + 1);
    for (const auto& s : args) {
      out.push_back(s.c_str());
    }
    out.push_back(nullptr);
  }
  return out;
}

#ifdef BUILD_TERM_CAPTURE_AS_LIB
bool get_should_exit() { return should_exit; }
void set_should_exit(bool v) { should_exit = v; }
bool get_did_cleanup() { return did_cleanup; }
void reset_did_cleanup(bool v) { did_cleanup = v; }
void set_child_pid_for_test(pid_t pid) { child_pid = pid; }
void set_master_fd_for_test(int fd) { masterFd = fd; }
void set_winch_pipe_fds_for_test(int read_fd, int write_fd) {
  winch_pipe_fds[0] = read_fd;
  winch_pipe_fds[1] = write_fd;
}
void set_have_orig_termios_for_test(bool v) { have_orig_termios = v; }
void call_restore_terminal_for_test() { restore_terminal(); }
bool set_orig_termios_from_stdin_for_test() {
  if (tcgetattr(STDIN_FILENO, &orig_termios) != 0) return false;
  return true;
}
#endif

#ifndef BUILD_TERM_CAPTURE_AS_LIB
int main(int argc, char* argv[]) {
  Config config = parse_arguments(argc, argv);
  if (!config.valid) {
    std::cerr << "Terminal Capture - Records all terminal input and output to separate log files\n\n"
              << config.error_message;
    return 1;
  }
  std::string log_path = config.log_prefix;
  
  // Convert std::vector<std::string> to std::vector<const char*> for execvp
  std::vector<const char*> cmd_args_cstr;
  if (!config.command_and_args.empty()) {
    for (const auto& arg : config.command_and_args) {
        cmd_args_cstr.push_back(arg.c_str());
    }
    cmd_args_cstr.push_back(nullptr); // execvp expects a null-terminated array
  }

  // 1) Open master PTY
  masterFd = posix_openpt(O_RDWR | O_NOCTTY);
  if (masterFd < 0) {
    std::cerr << "Error: posix_openpt failed.\n";
    return 1;
  }
  grantpt(masterFd);
  unlockpt(masterFd);

  // 2) Get the slave PTY name
  char* slaveName = ptsname(masterFd);
  if (!slaveName) {
    std::cerr << "Error: ptsname failed.\n";
    close(masterFd);
    return 1;
  }

  // 3) Fork to create child
  child_pid = fork();
  if (child_pid < 0) {
    std::cerr << "Error: fork failed.\n";
    close(masterFd);
    return 1;
  }

  if (child_pid == 0) {
    // Child: set up slave side
    setsid(); // new session
    int slaveFd = open(slaveName, O_RDWR);
    if (slaveFd < 0) {
      std::cerr << "Child: failed to open slave PTY.\n";
      _exit(1);
    }
    ioctl(slaveFd, TIOCSCTTY, 0);

    // Duplicate slaveFd to stdin, stdout, stderr
    dup2(slaveFd, STDIN_FILENO);
    dup2(slaveFd, STDOUT_FILENO);
    dup2(slaveFd, STDERR_FILENO);
    close(slaveFd);
    close(masterFd);

    // Optionally set TERM for interactive programs
    setenv("TERM", "xterm-256color", 1);

    // Exec the command or fall back to shell
    if (!cmd_args_cstr.empty()) {
      execvp(cmd_args_cstr[0], const_cast<char* const*>(cmd_args_cstr.data()));
    } else {
      // Default to shell if no command specified
      execlp("zsh", "zsh", (char*)nullptr);
    }
    _exit(1); // Exec failed
  }

  // Parent: open separate log files for input and output
  std::string input_path = log_path + ".input";
  std::string output_path = log_path + ".output";
  
  std::ofstream inputFile(input_path, std::ios::out | std::ios::trunc | std::ios::binary);
  std::ofstream outputFile(output_path, std::ios::out | std::ios::trunc | std::ios::binary);
  
  if (!inputFile.is_open() || !outputFile.is_open()) {
    std::cerr << "Failed to open log files\n";
    return 1;
  }

  // TCAP sidecars (v1): timestamps + output events (resize)
  const std::string input_tidx_path = input_path + ".tidx";
  const std::string output_tidx_path = output_path + ".tidx";
  const std::string output_events_path = output_path + ".events";
  const std::string meta_json_path = log_path + ".meta.json";

  auto write_all = [](int fd, const void* buf, size_t len) -> bool {
    const uint8_t* p = static_cast<const uint8_t*>(buf);
    size_t n = len;
    while (n > 0) {
      ssize_t w = ::write(fd, p, n);
      if (w < 0) {
        if (errno == EINTR) continue;
        return false;
      }
      if (w == 0) return false;
      p += static_cast<size_t>(w);
      n -= static_cast<size_t>(w);
    }
    return true;
  };

  auto write_u64_le = [&](int fd, uint64_t v) -> bool {
    uint8_t b[8];
    for (int i = 0; i < 8; ++i) {
      b[i] = static_cast<uint8_t>((v >> (i * 8)) & 0xFFu);
    }
    return write_all(fd, b, sizeof(b));
  };

  auto open_trunc = [](const std::string& path) -> int {
    return ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  };

  int input_tidx_fd = open_trunc(input_tidx_path);
  int output_tidx_fd = open_trunc(output_tidx_path);
  int output_events_fd = open_trunc(output_events_path);

  auto tidx_header = [&](int fd, uint64_t started_at_unix_ns) -> bool {
    const char magic[] = "TIDX1";
    const uint8_t flags = 0;
    return write_all(fd, magic, 5) && write_all(fd, &flags, 1) && write_u64_le(fd, started_at_unix_ns);
  };

  auto events_header = [&](int fd, uint64_t started_at_unix_ns) -> bool {
    const char magic[] = "EVT1";
    const uint8_t flags = 0;
    return write_all(fd, magic, 4) && write_all(fd, &flags, 1) && write_u64_le(fd, started_at_unix_ns);
  };

  const auto started_unix_ns = static_cast<uint64_t>(
      std::chrono::duration_cast<std::chrono::nanoseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
  const auto started_mono = std::chrono::steady_clock::now();

  auto now_mono_ns = [&]() -> uint64_t {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - started_mono).count());
  };

  const bool tidx_ok = input_tidx_fd >= 0 && output_tidx_fd >= 0;
  const bool events_ok = output_events_fd >= 0;
  if (tidx_ok) {
    if (!tidx_header(input_tidx_fd, started_unix_ns) || !tidx_header(output_tidx_fd, started_unix_ns)) {
      std::cerr << "TCAP: warning: failed writing tidx headers; timestamps disabled\n";
      if (input_tidx_fd >= 0) ::close(input_tidx_fd);
      if (output_tidx_fd >= 0) ::close(output_tidx_fd);
      input_tidx_fd = -1;
      output_tidx_fd = -1;
    }
  } else {
    std::cerr << "TCAP: warning: failed to open tidx sidecars; timestamps disabled\n";
  }
  if (events_ok) {
    if (!events_header(output_events_fd, started_unix_ns)) {
      std::cerr << "TCAP: warning: failed writing events header; resize metadata disabled\n";
      ::close(output_events_fd);
      output_events_fd = -1;
    }
  } else {
    std::cerr << "TCAP: warning: failed to open output events sidecar; resize metadata disabled\n";
  }

  // Minimal session meta JSON (debug-friendly; not performance critical).
  {
    std::ofstream meta(meta_json_path, std::ios::out | std::ios::trunc | std::ios::binary);
    if (meta.is_open()) {
      meta << "{\n"
           << "  \"pid\": " << child_pid << ",\n"
           << "  \"build_git_sha\": " << "\"" << TERM_CAPTURE_BUILD_GIT_SHA << "\"" << ",\n"
           << "  \"build_git_dirty\": " << (TERM_CAPTURE_BUILD_GIT_DIRTY ? "true" : "false") << ",\n"
           << "  \"prefix\": " << "\"" << log_path << "\"" << ",\n"
           << "  \"started_at_unix_ns\": " << started_unix_ns << "\n"
           << "}\n";
    }
  }

  uint64_t input_prev_t_ns = 0;
  uint64_t output_prev_t_ns = 0;
  uint64_t input_prev_end = 0;
  uint64_t output_prev_end = 0;
  uint64_t input_end = 0;
  uint64_t output_end = 0;
  uint64_t events_prev_t_ns = 0;
  uint64_t events_prev_off = 0;

  auto write_tidx_record = [&](int fd, uint64_t t_ns, uint64_t end_off,
                               uint64_t& prev_t, uint64_t& prev_end) {
    const uint64_t dt = (prev_t == 0) ? t_ns : (t_ns - prev_t);
    const uint64_t dend = (prev_end == 0) ? end_off : (end_off - prev_end);
    const auto dt_enc = uleb128_encode(dt);
    const auto de_enc = uleb128_encode(dend);
    if (!write_all(fd, dt_enc.data(), dt_enc.size())) return;
    if (!write_all(fd, de_enc.data(), de_enc.size())) return;
    prev_t = t_ns;
    prev_end = end_off;
  };

  auto write_resize_event = [&](uint64_t t_ns, uint64_t out_off, uint16_t cols, uint16_t rows) {
    if (output_events_fd < 0) return;
    // type=1 (resize), then dt_ns, doff, cols, rows as ULEB128.
    const uint8_t type = 1;
    if (!write_all(output_events_fd, &type, 1)) return;
    const uint64_t dt = (events_prev_t_ns == 0) ? t_ns : (t_ns - events_prev_t_ns);
    const uint64_t doff = (events_prev_off == 0) ? out_off : (out_off - events_prev_off);
    const auto dt_enc = uleb128_encode(dt);
    const auto do_enc = uleb128_encode(doff);
    const auto c_enc = uleb128_encode(static_cast<uint64_t>(cols));
    const auto r_enc = uleb128_encode(static_cast<uint64_t>(rows));
    (void)write_all(output_events_fd, dt_enc.data(), dt_enc.size());
    (void)write_all(output_events_fd, do_enc.data(), do_enc.size());
    (void)write_all(output_events_fd, c_enc.data(), c_enc.size());
    (void)write_all(output_events_fd, r_enc.data(), r_enc.size());
    events_prev_t_ns = t_ns;
    events_prev_off = out_off;
  };

  // Put parent terminal in raw mode so keys flow properly
  struct termios raw;
  if (isatty(STDIN_FILENO) && tcgetattr(STDIN_FILENO, &orig_termios) == 0) {
    have_orig_termios = true;
    raw = orig_termios;
    cfmakeraw(&raw);
    tcsetattr(STDIN_FILENO, TCSANOW, &raw);
    // Restore terminal on exit
    atexit(restore_terminal);
  }

  // Handle signals
  signal(SIGINT, signal_handler);
  signal(SIGTERM, signal_handler);
  signal(SIGQUIT, signal_handler);
  signal(SIGCHLD, signal_handler);
  // Forward window size changes to the child
  signal(SIGWINCH, handle_winch);

  // Self-pipe so resize events wake select() immediately (not just on next IO).
  if (pipe(winch_pipe_fds) == 0) {
    for (int i = 0; i < 2; ++i) {
      int flags = fcntl(winch_pipe_fds[i], F_GETFL, 0);
      if (flags >= 0) {
        (void)fcntl(winch_pipe_fds[i], F_SETFL, flags | O_NONBLOCK);
      }
    }
  }

  // Initialize child PTY with correct window size
  apply_winsize_to_child_pty();
  {
    struct winsize ws{};
    int tty_fd = pick_controlling_tty_fd();
    if (tty_fd >= 0 && ioctl(tty_fd, TIOCGWINSZ, &ws) == 0) {
      write_resize_event(now_mono_ns(), 0, ws.ws_col, ws.ws_row);
    }
  }

  std::cerr << "Started capturing shell (PID " << child_pid << ")\n"
            << "Logging input to: " << input_path << "\n"
            << "Logging output to: " << output_path << "\n";

  // MVP skeleton: if any WS flags were provided, emit notice and write stub metadata JSON
  bool ws_enabled = !config.ws_listen.empty() || !config.ws_token.empty() || config.ws_allow_remote || (config.ws_send_buffer > 0);
  if (ws_enabled) {
    std::cerr << "WS: planned, not yet active; parsed CLI flags and wrote stub metadata\n";
    // Write <prefix>.ws.json with minimal metadata
    std::string ws_meta_path = log_path + ".ws.json";
    auto now_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
    std::ostringstream id_ss;
    id_ss << child_pid << "-" << now_ns;
    std::ofstream wsmeta(ws_meta_path, std::ios::binary);
    if (wsmeta.is_open()) {
      wsmeta << "{\n"
             << "  \"id\": \"" << id_ss.str() << "\",\n"
             << "  \"pid\": " << child_pid << ",\n"
             << "  \"build_git_sha\": " << "\"" << TERM_CAPTURE_BUILD_GIT_SHA << "\"" << ",\n"
             << "  \"build_git_dirty\": " << (TERM_CAPTURE_BUILD_GIT_DIRTY ? "true" : "false") << ",\n"
             << "  \"prefix\": " << "\"" << log_path << "\"" << ",\n"
             << "  \"started_at_unix_ns\": " << now_ns << "\n"
             << "}\n";
      wsmeta.close();
    } else {
      std::cerr << "WS: warning: failed to write stub metadata to " << ws_meta_path << "\n";
    }
  }

  // 4) Relay data between real terminal and child PTY
  bool stdin_open = true;
  while (!should_exit) {
    fd_set fds;
    FD_ZERO(&fds);
    if (stdin_open) {
      FD_SET(STDIN_FILENO, &fds);
    }
    FD_SET(masterFd, &fds);
    if (winch_pipe_fds[0] >= 0) {
      FD_SET(winch_pipe_fds[0], &fds);
    }

    int maxFd = masterFd;
    if (stdin_open && STDIN_FILENO > maxFd) {
      maxFd = STDIN_FILENO;
    }
    if (winch_pipe_fds[0] > maxFd) {
      maxFd = winch_pipe_fds[0];
    }
    int ret = ::select(maxFd + 1, &fds, NULL, NULL, NULL);
    if (ret < 0 && errno != EINTR) {
      break;
    }
    if (ret < 0 && errno == EINTR) {
      if (winch_pending) {
        winch_pending = 0;
        struct winsize ws{};
        int tty_fd = pick_controlling_tty_fd();
        if (tty_fd >= 0 && ioctl(tty_fd, TIOCGWINSZ, &ws) == 0) {
          write_resize_event(now_mono_ns(), output_end, ws.ws_col, ws.ws_row);
        }
        apply_winsize_to_child_pty();
      }
      continue;
    }

    if (winch_pipe_fds[0] >= 0 && FD_ISSET(winch_pipe_fds[0], &fds)) {
      char drain[64];
      while (read(winch_pipe_fds[0], drain, sizeof(drain)) > 0) {
      }
    }
    if (winch_pending) {
      winch_pending = 0;
      struct winsize ws{};
      int tty_fd = pick_controlling_tty_fd();
      if (tty_fd >= 0 && ioctl(tty_fd, TIOCGWINSZ, &ws) == 0) {
        write_resize_event(now_mono_ns(), output_end, ws.ws_col, ws.ws_row);
      }
      apply_winsize_to_child_pty();
    }

    // Data from real terminal -> child
    if (stdin_open && FD_ISSET(STDIN_FILENO, &fds)) {
      char buf[1024];
      ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
      if (n > 0) {
        write(masterFd, buf, n);
        // Log user input
        inputFile.write(buf, n);
        inputFile.flush();
        input_end += static_cast<uint64_t>(n);
        if (input_tidx_fd >= 0) {
          write_tidx_record(input_tidx_fd, now_mono_ns(), input_end, input_prev_t_ns, input_prev_end);
        }
      } else if (n == 0) {
        // If STDIN hits EOF (e.g., piped input ends), stop monitoring it but keep
        // capturing the PTY output until the child exits.
        stdin_open = false;
      }
    }

    // Data from child -> real terminal
    if (FD_ISSET(masterFd, &fds)) {
      char buf[1024];
      ssize_t n = read(masterFd, buf, sizeof(buf));
      if (n > 0) {
        // Print to screen
        write(STDOUT_FILENO, buf, n);
        // Log shell output
        outputFile.write(buf, n);
        outputFile.flush();
        output_end += static_cast<uint64_t>(n);
        if (output_tidx_fd >= 0) {
          write_tidx_record(output_tidx_fd, now_mono_ns(), output_end, output_prev_t_ns, output_prev_end);
        }
      }
    }
  }

  inputFile.close();
  outputFile.close();
  if (input_tidx_fd >= 0) ::close(input_tidx_fd);
  if (output_tidx_fd >= 0) ::close(output_tidx_fd);
  if (output_events_fd >= 0) ::close(output_events_fd);
  cleanup_and_exit(0);
  return 0; // Never reached
}
#endif // BUILD_TERM_CAPTURE_AS_LIB
