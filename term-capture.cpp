#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <thread>
#include <csignal>
#include <cstdlib>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <sys/ioctl.h>
#include <sys/select.h>

static volatile bool should_exit = false;

void signal_handler(int) {
  should_exit = true;
}

int main(int argc, char* argv[]) {
  if (argc != 2) {
    std::cerr << "Usage: " << argv[0] << " <log_file>\n";
    return 1;
  }
  std::string logPath = argv[1];

  // 1) Open a master PTY
  int masterFd = posix_openpt(O_RDWR | O_NOCTTY);
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

  // 3) Fork to create a child process
  pid_t pid = fork();
  if (pid < 0) {
    std::cerr << "Error: fork failed.\n";
    close(masterFd);
    return 1;
  }

  if (pid == 0) {
    // Child process: become session leader, attach slave as controlling terminal
    setsid(); // new session
    int slaveFd = open(slaveName, O_RDWR);
    if (slaveFd < 0) {
      std::cerr << "Child: Failed to open slave pty.\n";
      _exit(1);
    }

    // Make the slave PTY the controlling TTY
    ioctl(slaveFd, TIOCSCTTY, 0);

    // Duplicate slaveFd onto stdin/stdout/stderr
    dup2(slaveFd, STDIN_FILENO);
    dup2(slaveFd, STDOUT_FILENO);
    dup2(slaveFd, STDERR_FILENO);

    close(masterFd);
    close(slaveFd);

    // Exec a shell (zsh). The shell now thinks it's running on a real TTY.
    execlp("zsh", "zsh", nullptr);
    _exit(1); // If exec fails
  }

  // Parent process: log everything passing through masterFd
  std::ofstream logFile(logPath, std::ios::app | std::ios::out | std::ios::binary);
  if (!logFile.is_open()) {
    std::cerr << "Failed to open log file: " << logPath << "\n";
    return 1;
  }
  std::cerr << "Capturing shell session. PID: " << pid << std::endl;

  // Install signal handlers
  signal(SIGINT, signal_handler);
  signal(SIGTERM, signal_handler);

  // 4) Relay data between real terminal and the child shell via masterFd
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

    // If user typed something on the real terminal (STDIN), send to child shell
    if (FD_ISSET(STDIN_FILENO, &fds)) {
      char buf[1024];
      ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
      if (n > 0) {
        write(masterFd, buf, n);
        // Also log user input if desired
        logFile << "[INPUT] ";
        logFile.write(buf, n);
        logFile << std::endl;
      }
    }

    // If child shell wrote something, show it on our real terminal and log it
    if (FD_ISSET(masterFd, &fds)) {
      char buf[1024];
      ssize_t n = read(masterFd, buf, sizeof(buf));
      if (n > 0) {
        // Write to real screen
        write(STDOUT_FILENO, buf, n);
        // Log output
        logFile << "[OUTPUT] ";
        logFile.write(buf, n);
        logFile << std::endl;
      }
    }
  }

  // Cleanup
  close(masterFd);
  logFile.close();

  return 0;
}
