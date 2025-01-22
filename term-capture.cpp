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

static volatile bool should_exit = false;
static struct termios orig_termios;
static int masterFd = -1;
static pid_t child_pid = -1;

// Restore parent terminal to original settings
void restore_terminal() {
  tcsetattr(STDIN_FILENO, TCSANOW, &orig_termios);
}

void cleanup_and_exit() {
  restore_terminal();
  if (masterFd >= 0) {
    close(masterFd);
  }
  if (child_pid > 0) {
    kill(child_pid, SIGTERM);
    waitpid(child_pid, nullptr, 0);
  }
  exit(0);
}

// Handle Ctrl+C, SIGTERM, etc.
void signal_handler(int sig) {
  should_exit = true;
  if (sig == SIGCHLD) {
    int status;
    pid_t pid = waitpid(-1, &status, WNOHANG);
    if (pid == child_pid) {
      cleanup_and_exit();
    }
  }
}

// Propagate window size changes to the child PTY
void handle_winch(int) {
  struct winsize ws;
  if (ioctl(STDIN_FILENO, TIOCGWINSZ, &ws) == 0 && masterFd >= 0) {
    ioctl(masterFd, TIOCSWINSZ, &ws);
  }
}

int main(int argc, char* argv[]) {
  if (argc != 2) {
    std::cerr << "Usage: " << argv[0] << " <log_file>\n";
    return 1;
  }
  std::string log_path = argv[1];

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

    // Exec a shell
    execlp("zsh", "zsh", (char*)nullptr);
    _exit(1); // Exec failed
  }

  // Parent: log everything to a file
  std::ofstream logFile(log_path, std::ios::app | std::ios::binary);
  if (!logFile.is_open()) {
    std::cerr << "Failed to open log file: " << log_path << "\n";
    return 1;
  }

  // Put parent terminal in raw mode so keys flow properly
  struct termios raw;
  tcgetattr(STDIN_FILENO, &orig_termios);
  raw = orig_termios;
  cfmakeraw(&raw);
  tcsetattr(STDIN_FILENO, TCSANOW, &raw);

  // Restore terminal on exit
  atexit(restore_terminal);

  // Handle signals
  signal(SIGINT, signal_handler);
  signal(SIGTERM, signal_handler);
  signal(SIGQUIT, signal_handler);
  signal(SIGCHLD, signal_handler);
  // Forward window size changes to the child
  signal(SIGWINCH, handle_winch);

  // Initialize child PTY with correct window size
  handle_winch(0);

  std::cerr << "Started capturing shell (PID " << child_pid << "), logging to " << log_path << "\n";

  // 4) Relay data between real terminal and child PTY
  while (!should_exit) {
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(STDIN_FILENO, &fds);
    FD_SET(masterFd, &fds);

    int maxFd = (masterFd > STDIN_FILENO) ? masterFd : STDIN_FILENO;
    int ret = select(maxFd + 1, &fds, NULL, NULL, NULL);
    if (ret < 0 && errno != EINTR) {
      break;
    }

    // Data from real terminal -> child
    if (FD_ISSET(STDIN_FILENO, &fds)) {
      char buf[1024];
      ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
      if (n > 0) {
        write(masterFd, buf, n);
        // Also log user input
        logFile << "[INPUT] ";
        logFile.write(buf, n);
        logFile << std::endl;
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
        logFile << "[OUTPUT] ";
        logFile.write(buf, n);
        logFile << std::endl;
      }
    }
  }

  logFile.close();
  cleanup_and_exit();
  return 0; // Never reached
}
