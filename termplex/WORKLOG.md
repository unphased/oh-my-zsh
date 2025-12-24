# WORKLOG - term-capture & hexflow

## Snapshot

### Goal
Enhance `term-capture` for reliable day-to-day capture, then layer WebSocket/observability features.

### Completed to Date
- Catch2 v3 harness in `tests/` (amalgamated headers, removed custom `main`, standardized on C++14).
- Refactored `parse_arguments`, added `term_capture.hpp`, and authored unit tests for core happy-path and failure scenarios.
- Made `hexflow::print_byte` testable with a comprehensive Catch2 suite.
- Makefile upgrades: debug build with coverage flags, library objects for the test runner, `make test` orchestration, and gcovr HTML/TXT/XML/JSON reports.
- Integration tests covering CLI happy paths, WS stub metadata emission, and no-command (zsh) fallback.

### Active Work
- Ongoing hardening via exploratory testing across shells, signals, and PTY edge cases.
- Coverage ratchet: overall branch coverage ~51%; `term-capture.cpp` needs targeted branches while `hexflow.cpp` and `tcap.hpp` are close to done.

### Next Up (Short Horizon)
1. **Testable core extraction** – split `main` so the PTY orchestration runs through `run_capture(const Config&, const TermCaptureDeps&)`, enabling dependency injection in tests.
2. **Syscall seam coverage** – use linker overrides to force failures in `posix_openpt`, `ptsname`, `fork`, `open`, `dup2`, `execvp`, log-file creation, and WS metadata writes; assert branches at `term-capture.cpp:205-335`.
3. **Select-loop exercises** – override `select`, `read`, and `write` to simulate `EINTR`, zero-byte reads, and write failures; verify behaviour around `term-capture.cpp:339-374` including log flushes.
4. **Argument parser edge cases** – add tests for the `--` sentinel, duplicate flags, bad `--ws-send-buffer` input, and unknown flags to cover branches at `term-capture.cpp:81-160`.
5. **ULEB128 overflow guard** – craft a `tcap` test feeding >9 continuation bytes to hit the overflow branch in `uleb128_decode` (`tcap.hpp:18-37`).

See `docs/ROADMAP.md` for the broader milestone and backlog view.

## Architecture & Implementation Notes
- See `docs/WS_ARCHITECTURE.md` for the full WebSocket plan; highlights below are the quick reminders that keep popping up during day-to-day work.
- Embedded WS vs central gateway:
  - Embedded: simple deployment, isolates sessions, scales modestly; downside is many sockets and WAN exposure stories.
  - Gateway: single port/TLS/auth, shared resources, requires IPC + discovery layer.
- Data framing: server→client binary PTY frames, client→server JSON control with base64 payloads.
- Security defaults: bind `127.0.0.1`, require explicit opt-in for remote binds; recommend TLS/auth via reverse proxy.
- Backpressure: enforce bounded buffers; drop or disconnect misbehaving clients.
- Input arbitration: FIFO is acceptable short-term; consider exclusive control later.

## Notes
- Keep `main()` thin; grow testable seams around the event loop and PTY handling.
- Prioritise Batches 1–3 for confidence (done), then execute Batches 4–6 driven by the coverage plan above.
