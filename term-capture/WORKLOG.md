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

### Coming Soon (Post-Coverage)
- Propagate child exit status to the parent process.
- Verbosity controls for startup/shutdown spam.
- Harden signal handling (SIGHUP, etc.) once seams exist for deterministic tests.

## Future Backlog

### Near-Term Prep
- Kickoff Batch 10 (WS TTY bridge MVP): confirm `uWebSockets` as the transport, keep WebSocket++ as fallback, and retain CLI parsing for `--ws-*` flags with stub logging/JSON metadata writes.
- Prep Batch 14 (time-indexed logging): keep ULEB128 helpers and plan `tcap` container format gated behind `--log-format=tcap`.

### Roadmap Batches (derived from 2025-08-30 review)

**Batch 1 — Test UX and Reports**
- [x] Add coverage report targets (gcovr) to the Makefile.
- [x] Add `test-integration` target and Catch2 tag filters.
- [x] Generate machine-readable JSON/JUnit reports and validate with `jq`/`xmllint`.
- [x] Document RNG seed guidance in README.

**Batch 2 — Integration Tests: Baseline Flows**
- [x] `/bin/echo` smoke test ensuring `.input`/`.output` creation.
- [x] `sh -c "printf 'a\nb'"` multi-line capture test.
- [x] Shell fallback (zsh) with piped script and environment gating.

**Batch 3 — Signals & WINCH Behaviour**
- [x] Exercise `handle_winch` smoke path.
- [x] Verify SIGINT/SIGTERM cleanup.
- [x] Assert SIGCHLD triggers cleanup/exit handling.

**Batch 4 — Error Handling**
- [ ] Design deterministic failure tests for PTY/syscall setup (`posix_openpt`, `grantpt`, `unlockpt`, `ptsname`, `fork`, `open`, `ioctl`, `select`).
- [ ] Introduce seams/shims (depends on Batch 5).

**Batch 5 — Refactoring for Testability**
- [ ] Extract select/read/write loop behind injectable syscalls.
- [ ] Wrap PTY setup/teardown for mocking.
- [ ] Split `cleanup_and_exit` into testable `cleanup()` plus thin exit wrapper.
- [x] Extracted argv helper (complete).

**Batch 6 — Exit Code Propagation**
- [ ] Forward child exit status to parent.
- [ ] Add tests asserting exit propagation.

**Batch 7 — Hexflow End-to-End**
- [ ] Integration tests piping >=0x80 bytes; assert formatting.
- [ ] Ensure locale independence around `isprint`.

**Batch 8 — Performance & Throttling**
- [ ] Define throttling parameters and retention strategy.
- [ ] Implement drop/retain logic with synthetic high-throughput tests.

**Batch 9 — CI & Portability**
- [ ] Decide macOS/Linux CI matrix and stabilise PTY tests.
- [ ] Gate host-dependent tests with tags/Make targets.

**Batch 10 — WebSocket TTY Bridge (MVP)**
- [ ] Implement Phase 1 per `docs/WS_ARCHITECTURE.md` using uWS.
- [ ] Default bind to `127.0.0.1:0`, emit `<prefix>.ws.json`, maintain `~/.term-capture/sessions.json` with pruning/file-locking.
- [ ] Broadcast PTY output, enforce per-client send buffers.
- [ ] Accept WS text input (base64 -> PTY) and expose `get_meta`, `fetch_input`, `fetch_output`, `get_stats` RPCs.

**Batch 11 — Protocol, Auth, Lifecycle**
- [ ] Finalize message protocol (binary output frames, JSON control/input with base64, ping/pong).
- [ ] Support resize over WS -> `TIOCSWINSZ`.
- [ ] Honor optional `--ws-token` for auth.
- [ ] Add heartbeats/idle timeouts and graceful close semantics.

**Batch 12 — Observability & Limits**
- [ ] Metrics/logging (connections, bytes, drops, backlog) with rate-limited logs.
- [ ] Flags for `--ws-max-clients`, `--ws-send-buffer`, `--ws-allow-remote` (default localhost).
- [ ] Document resource footprint; test ~100 concurrent sessions.

**Batch 13 — Architectural Follow-Ups**
- [ ] Compare embedded WS vs `tc-gateway` architecture; decide rollout.
- [ ] Choose TLS termination strategy (prefer reverse proxy) while keeping term-capture plain WS.
- [ ] Finalize discovery: per-session JSON + global registry; wire UI to registry.

**Batch 14 — Time-Indexed Logging & Playback**
- [ ] Spec "tcap v1" container with timestamps and resize events.
- [ ] CLI flag `--log-format raw|tcap` with new file naming.
- [ ] Implement writer encoder with delta/absolute heuristics.
- [ ] Provide minimal decoder (tests + JS client) for round-trip validation.
- [ ] Ensure WS RPCs return container bytes when enabled; document legacy behaviour.
- [ ] Build playback PoC (1x/2x, pause, seek); plan optional index sidecar & compression follow-ups.

## Architecture & Implementation Notes
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
