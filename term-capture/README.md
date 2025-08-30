# Terminal Capture Utilities

This project provides two command-line utilities: `term-capture` and `hexflow`.

## `term-capture`

`term-capture` is a tool that records all terminal input and output to separate log files. It creates a pseudo-terminal (PTY) and runs a specified command (or a default shell, `zsh`) within it. All keyboard input is logged to `<prefix>.input` and all output from the PTY is logged to `<prefix>.output`.

### Usage

```sh
./term-capture <prefix> [command...]
```

- `<prefix>`: Prefix for the log files. For example, if you use `my_session`, it will create `my_session.input` and `my_session.output`.
- `[command...]`: Optional command to execute. If not specified, `zsh` is used by default.

**Example:**

To capture a session where you run `ls -l` and then `pwd`:
```sh
./term-capture my_session_log
# Inside the captured shell:
ls -l
pwd
exit
```
This will create `my_session_log.input` and `my_session_log.output`.

## `hexflow`

`hexflow` is a utility that reads binary data from standard input and prints it to standard output in a mixed hexadecimal and character format. Non-printable characters are shown as hex values, while printable characters are shown as is. Special characters like newline (`\n`), carriage return (`\r`), and tab (`\t`) are represented as `\n`, `\r`, and `\t` respectively.

### Usage

`hexflow` is typically used by piping data into it:

```sh
cat some_binary_file | ./hexflow
```
or
```sh
./term-capture my_session_log
# ... do some work ...
exit

cat my_session_log.input | ./hexflow
cat my_session_log.output | ./hexflow
```

This is useful for inspecting the raw byte streams captured by `term-capture`.

## Building

The project uses a Makefile for building.

### Prerequisites
- A C++ compiler (like g++)
- `make`

### Commands

- **Build debug versions:**
  ```sh
  make debug
  ```
  This will create `debug/term-capture` and `debug/hexflow`.

- **Build release versions:**
  ```sh
  make release
  ```
  This will create `release/term-capture` and `release/hexflow`.

- **Build all (both debug and release):**
  ```sh
  make all
  ```
  or simply:
  ```sh
  make
  ```

- **Clean build artifacts:**
  ```sh
  make clean
  ```
  This will remove the `debug` and `release` directories.

## How `term-capture` Works

1.  **PTY Creation**: It opens a new pseudo-terminal master (`/dev/ptmx`).
2.  **Forking**: It forks a child process.
    *   **Child Process**:
        *   Opens the slave side of the PTY.
        *   Sets up the slave PTY as its controlling terminal.
        *   Redirects its standard input, output, and error to the slave PTY.
        *   Executes the specified command or a default shell (`zsh`).
    *   **Parent Process**:
        *   Sets the main terminal (where `term-capture` was launched) to raw mode.
        *   Relays data:
            *   From standard input (user typing) to the master PTY (child's input).
            *   From the master PTY (child's output) to standard output (user's screen).
        *   Logs input to `<prefix>.input` and output to `<prefix>.output`.
3.  **Signal Handling**: Handles signals like `SIGINT`, `SIGTERM`, `SIGCHLD` for graceful shutdown and `SIGWINCH` to propagate terminal window size changes to the child PTY.
4.  **Cleanup**: Restores the original terminal settings on exit.

## Dependencies

The `term-capture` program relies on standard POSIX PTY and terminal interface functions available on Unix-like systems (Linux, macOS).
The `hexflow` program uses standard C++ iostreams and cctype.

## Testing and RNG seed control

The test suite is built with Catch2 v3 (amalgamated). Our Makefile exposes convenient targets:

- Build and run tests (quiet): `make -C term-capture test`
- Verbose output with durations: `make -C term-capture test-verbose`
- Machine-readable reports:
  - JSON: `make -C term-capture test-json` (writes to `debug/test-results.json`)
  - JUnit XML: `make -C term-capture test-junit` (writes to `debug/junit.xml`)

Catch2 provides an internal pseudo-random generator for things like generators (e.g., GENERATE/take/random) and prints the seed at the start:
“Randomness seeded to: <seed>”

To make any randomness reproducible, pass a specific seed via Catch2’s CLI:
- Use a fixed number: `--rng-seed 12345`
- Or special values: `--rng-seed time` (seed from current time), `--rng-seed random-device` (seed from std::random_device)

Because our Makefile forwards extra arguments through `TEST_ARGS`, you can do for example:
- `make -C term-capture test TEST_ARGS="--rng-seed 12345"`
- Combine with verbosity: `make -C term-capture test TEST_ARGS="--rng-seed 12345 -s -v high --durations yes"`

This ensures that any flaky, randomness-driven failures can be reproduced by re-running with the printed seed.

## Coverage reports

- After running tests, an HTML coverage report is generated at: debug/coverage/index.html
- A text summary is also written to: debug/coverage/coverage.txt
- To run tests (which generate coverage) and then open the report on macOS:
  - make -C term-capture test
  - make -C term-capture open-coverage
- If gcovr is not installed, install it first:
  - brew install gcovr
