# Terminal Capture Utilities

This project provides two command-line utilities: `term-capture` and `hexflow`.

## Vision (what this is building toward)

The long-term goal is to keep the terminal workflow, but add a light client/server-style layer (similar “level” to tmux, but with different primitives) so terminal input/output become durable, queryable data streams.

- **Capture everything**: record bytes from keyboard input and PTY output without omission.
- **Persist as a format**: evolve the on-disk container (“TCAP”) so playback, indexing, and search can be fast and robust.
- **Universal playback UX**: time-scrub across sessions, down to the keystroke, so you can retrace work and regain context quickly.
- **Disposable sessions**: reduce dependence on tmux pane archaeology by making history the primary interface (with tmux-like live control still available).
- **A web surface area**: a thin browser client (xterm.js) for live mirroring/control and for higher-level dashboards that slice across many sessions.

If you’re looking for the WebSocket + browser plan, start with `docs/WS_ARCHITECTURE.md` and `docs/ROADMAP.md`.

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
```

Here is a nice way to view a "mirror" of an active session recording in real time:
```
tail -f my_session_log.output
```

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
  This will create `debug/term-capture` and `debug/hexflow` (with debug symbols and coverage instrumentation; suitable for GDB/lldb and tests).

- **Build release versions:**
  ```sh
  make release
  ```
  This will create `release/term-capture` and `release/hexflow` (lean: optimized, no debug symbols, no test/coverage instrumentation).

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

## Testing

The test suite is built with Catch2 v3. Useful targets include:

- `make -C term-capture test` – default run, emits JSON/JUnit reports under `debug/`
- `make -C term-capture test-verbose` – verbose output with durations
- `make -C term-capture test-unit` / `make -C term-capture test-integration`
- `make -C term-capture test TEST_ARGS="--rng-seed 12345"` – reproduce runs with a fixed RNG seed

Coverage artifacts land in `debug/coverage/`. On macOS, `make -C term-capture open-coverage` opens the HTML report.

## Documentation

- `docs/ROADMAP.md` – high-level objectives, batches, and upcoming milestones
- `WORKLOG.md` – chronological notes on what changed and the reasoning behind it
- `docs/WS_ARCHITECTURE.md` – WebSocket design and phased rollout plan
- `docs/TCAP.md` – TCAP on-disk format (layout-first: raw streams + sidecars)
- `docs/COMPRESSION.md` – TCAP compression goals and implementation strategy
- `web/` – framework-free browser viewer PoC (offline playback from `.output`)

Add future specs under `docs/` and link them here so this guide stays the jumping-off point.

## ULEB128 primer

TCAP tooling uses ULEB128 to store integers compactly. ULEB128 stands for **Unsigned Little Endian Base 128**, a standard variable-length encoding used in DWARF debug info, WebAssembly, and other binary formats. Each byte contributes 7 payload bits (least-significant chunk first); the high bit (`0x80`) marks whether more bytes follow. For example, `0xAC 0x02` encodes the value 300: `(0x2C) + (0x02 << 7)`. The encoding is unsigned—use SLEB128 for signed values.
