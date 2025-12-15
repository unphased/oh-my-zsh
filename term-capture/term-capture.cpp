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
  
  std::ofstream inputFile(input_path, std::ios::app | std::ios::binary);
  std::ofstream outputFile(output_path, std::ios::app | std::ios::binary);
  
  if (!inputFile.is_open() || !outputFile.is_open()) {
    std::cerr << "Failed to open log files\n";
    return 1;
  }

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
      }
    }
  }

  inputFile.close();
  outputFile.close();
  cleanup_and_exit(0);
  return 0; // Never reached
}
#endif // BUILD_TERM_CAPTURE_AS_LIB
