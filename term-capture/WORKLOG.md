# WORKLOG - term-capture & hexflow

## Planned Work

### Goal: Enhance `term-capture` for robust, regular use and add advanced features.

**0. Test System & Coverage Establishment (Top Priority)**
    - [X] **Set up Test Framework:** Migrated to Catch2 v3 (amalgamated). User to download `catch_amalgamated.hpp` and `catch_amalgamated.cpp` to `tests/`. Removed `tests/main.cpp`. Makefile updated for C++14 and new Catch2 files.
    - [X] **Develop Initial Test Suite:** Create basic tests covering core functionality:
        - [X] `term-capture`: Refactored argument parsing into `parse_arguments` function and `Config` struct. Added `term_capture.hpp`. Added unit tests for `parse_arguments` in `tests/term_capture_tests.cpp`. Makefile updated for new header and dependencies.
        - [X] `hexflow`: Refactored `print_byte` for testability and added comprehensive unit tests in `tests/hexflow_tests.cpp`.
    - [X] **Integrate Coverage Reporting (Makefile):** Configured Makefile to compile test files with coverage flags. Added `test` target to build and run tests. Linked `hexflow.o` and `term_capture.o` (compiled as libs with coverage) into test runner. Makefile updated for `hexflow.hpp`, `term_capture.hpp` and `term_capture.cpp` test compilation.
    - [X] **Generate Coverage Reports (gcovr):** Added Makefile coverage target using gcovr with HTML and text outputs; documented in README.
    - [ ] **General Hardening (Continuous through Testing):** Conduct thorough testing across various shells, commands, and edge cases (e.g., rapid window resizing, unusual signal patterns, PTY exhaustion, different TERM values) to identify and fix stability issues. This will be driven by the test suite.
    - [ ] **Iteratively Increase Coverage:** Continuously write and refine tests to achieve high code coverage for `term-capture.cpp` and `hexflow.cpp`.

**1. Core Robustness & Usability Enhancements (Post-Test Setup):**
    - [ ] **Exit Code Propagation:** Modify `term-capture` to correctly propagate the exit status of the wrapped command/shell, instead of always exiting with 0.
    - [ ] **Configurable Logging Levels/Verbosity:**
        - [ ] Allow suppression or redirection of `term-capture`'s own startup/shutdown messages (e.g., via command-line flags or environment variables).
    - [ ] **Improved Signal Handling:** Review and enhance signal handling for robustness, ensuring all relevant signals are managed gracefully (e.g., SIGHUP), informed by test cases.

**2. Log Management & Storage:**
    - [ ] **Log Rotation & Archival:** Implement a strategy for automatic log rotation (e.g., based on size or time) and potential archival to prevent excessive disk usage.
    - [ ] **Configurable Log Paths:** Allow users to specify log file naming patterns or directories more flexibly (e.g., including timestamps, session IDs, or user-defined structures).
    - [ ] **Disk Access Optimization:** Investigate methods to reduce the frequency of disk writes for log files, potentially by buffering more data in memory before flushing, while considering data loss risk on crash.

**3. Performance & Resource Control for Large Output:**
    - [ ] **High Data Rate Throttling Mechanism:**
        - [ ] Implement logic to monitor data ingress (e.g., from the child PTY to `term-capture`) at regular intervals (e.g., 1/30th of a second).
        - [ ] Define a configurable data rate threshold (e.g., 3MB/s) for these intervals.
        - [ ] If the threshold is exceeded for a configurable number of consecutive intervals (e.g., `N` intervals):
            - [ ] Implement a "boundary retention" strategy: Keep the data from the first `M` and last `M` intervals of this high-rate sequence (where `M` is a configurable integer, e.g., 2).
            - [ ] Discard the data from the intervening `N - 2*M` intervals to save disk space, while aiming to preserve context (like escape sequences for entering/exiting modes).
            - [ ] Log an indicator that data was throttled/dropped.
    - [ ] **Configuration for Throttling:** Provide command-line options or a configuration file mechanism to enable/disable throttling and adjust its parameters (interval duration, rate threshold, `N`, `M`).

**4. Advanced Features:**
    - [ ] **Session Playback Functionality:**
        - [ ] Design and develop a companion tool or mode for `term-capture` logs that allows replaying a captured session in a terminal.
        - [ ] Consider timing aspects to make playback realistic.
        - [ ] Explore integration or compatibility with `tmux`-like features for enhanced playback control (e.g., pause, step, speed control).
        - [ ] This might involve storing timing information alongside the raw input/output streams or developing a format that can accommodate this.
    - [ ] **Structured Logging Format (Optional Enhancement):**
        - [ ] Consider an alternative or additional log format (e.g., JSON-based) that includes timestamps for each chunk of data, stream identifiers (input/output), and metadata about events like window resizing or throttling. This could facilitate more advanced analysis and playback.

**5. Documentation & Build System:**
    - [ ] **Update README:** Keep README.md updated with new features, configuration options, and usage examples.
    - [ ] **Makefile Enhancements:** Review Makefile for any necessary updates as new source files or dependencies are added (e.g., for test framework, coverage report generation).

**6. WebSocket TTY Bridge (New Requirement) — see docs/WS_ARCHITECTURE.md for full plan:**
    - [ ] Phase 1 (MVP): embedded per-session WS + WS RPC backfill + local registry file.
    - [ ] CLI (MVP): --ws-listen, --ws-token, --ws-allow-remote, --ws-send-buffer. Advanced flags (e.g., --ws-max-clients) tracked in Batch 12.
    - [ ] Data plane: WS /ws (binary PTY I/O) and JSON control (resize/hello); WS RPC for meta/backfill/stats (no separate HTTP endpoints).
    - [ ] Multi-client + backpressure as specified; default bind 127.0.0.1; optional shared-secret token.
    - [ ] Observability: counters and lightweight logs per doc.
    - [ ] Birds-eye: maintain sessions registry; later serve a simple UI via a thin gateway.

## In Progress

- (None currently)

## Completed

- (None tracked here yet, initial README created under e411c0a)

## Work Batches (derived from coverage review, 2025-08-30)

Batch 1 — Test UX and Reports
- [x] Add coverage report targets (gcovr) to Makefile (DONE).
- [x] Add test-integration targets and Catch2 tag filters to run only [integration] tests.
- [x] Validate machine-readable reports (via make validate-reports):
  - [x] JSON: generated debug/test-results.json and validated with jq.
  - [x] JUnit: generated debug/junit.xml and validated with xmllint (well-formed).
- [x] RNG seed guidance in README for reproducibility (DONE).

Batch 2 — Integration tests: baseline flows
- [x] Spawn term-capture with a trivial command (e.g., /bin/echo hello).
  - [x] Assert <prefix>.input and <prefix>.output files are created.
  - [x] Assert output file contains expected bytes; input file reflects user keystrokes when applicable (empty in this case).
- [x] Spawn term-capture with a longer command + args (e.g., sh -c "printf 'a\nb'").
- [x] Exercise “no command” fallback to shell (zsh). Gate by environment:
  - [x] Skip if zsh is unavailable; document portability note.
  - Implemented by piping "echo fallback_ok\nexit\n" into term-capture to auto-exit the interactive shell.

Batch 3 — Signals and window size behavior
- [x] Send SIGWINCH to parent; ensure no crash and child PTY gets size (smoke test).
- [x] Send SIGINT/SIGTERM to parent; verify graceful shutdown and closed logs.
- [x] Observe SIGCHLD: child exits; parent performs cleanup_and_exit.

Batch 4 — Error handling
- [ ] Design tests for failure paths (posix_openpt/grantpt/unlockpt/ptsname/fork/open/ioctl/select).
- [ ] Introduce seams/shims to inject failures deterministically (depends on Batch 5).

Batch 5 — Refactoring for testability (minimal, incremental)
- [ ] Extract select/read/write loop into a function that accepts injected syscall shims (read, write, select).
- [ ] Wrap PTY setup/teardown into a small interface for mocking (open/close/ioctl).
- [ ] Split cleanup_and_exit into:
  - [ ] cleanup() that returns status without exiting (testable),
  - [ ] thin exit path in main() that calls exit() (unchanged UX).
- [x] Extract argv construction for exec into a helper to unit-test NULL-termination and mapping.

Batch 6 — Exit code propagation
- [ ] Propagate child process exit code to term-capture’s exit code.
- [ ] Add tests to verify exit statuses are forwarded.

Batch 7 — Hexflow end-to-end
- [ ] Add integration tests piping known bytes (incl. >= 0x80) through hexflow; assert exact output.
- [ ] Set locale in tests or avoid locale sensitivity for isprint.

Batch 8 — Performance and throttling backlog
- [ ] Design throttling parameters and behavior (interval, rate threshold, retention strategy).
- [ ] Implement and test drop/retain logic with synthetic high-throughput data.

Batch 9 — CI and portability
- [ ] Decide macOS/Linux CI matrix; ensure PTY tests are stable on both.
- [ ] Gate flaky/host-dependent tests with Catch2 tags and Makefile targets.

Batch 10 — WebSocket TTY bridge (MVP)
- [ ] Implement Phase 1 per docs/WS_ARCHITECTURE.md using cpp-httplib (header-only).
- [ ] Listen on 127.0.0.1:0 by default; print bound port; write <prefix>.ws.json; update ~/.term-capture/sessions.json (with pruning + file lock).
- [ ] Broadcast PTY output to WS clients; enforce per-client send buffer with drop/disconnect policy.
- [ ] Accept WS binary input -> write to PTY and append to .input; expose WS RPCs: get_meta, fetch_input, fetch_output, and get_stats.

Batch 11 — Protocol, auth, and lifecycle
- [ ] Solidify message protocol per docs/WS_ARCHITECTURE.md: binary data frames; JSON control (resize/hello); ping/pong.
- [ ] Implement resize handling via WS -> TIOCSWINSZ.
- [ ] Enforce optional --ws-token for all WS connections and RPCs.
- [ ] Add heartbeats and idle timeouts; graceful close semantics when last client disconnects.

Batch 12 — Observability and limits
- [ ] Metrics and logging per docs/WS_ARCHITECTURE.md: counters (connections, bytes in/out, drops, backlog) and rate-limited logs.
- [ ] Configuration flags: --ws-max-clients, --ws-send-buffer, --ws-allow-remote (default localhost only).
- [ ] Document resource footprint; test up to ~100 concurrent sessions.

Batch 13 — Architectural follow-ups
- [ ] Evaluate per-session embedded WS (A) vs centralized "tc-gateway" (B) per docs/WS_ARCHITECTURE.md; decide rollout plan.
- [ ] Choose TLS termination strategy (recommend reverse proxy); keep term-capture plain WS.
- [ ] Finalize discovery: per-session <prefix>.ws.json + global sessions.json registry; wire birds-eye UI to the registry.

Batch 14 — Time-indexed logging and playback
- [ ] Spec: define "tcap v1" per-stream container (header + varint-framed records) with absolute/delta timestamps (docs/WS_ARCHITECTURE.md).
- [ ] CLI: add --log-format raw|tcap (default raw in MVP); choose file naming (<prefix>.input.tcap / <prefix>.output.tcap).
- [ ] Writer: implement tcap encoder in term-capture; heuristics for delta vs absolute; include resize events.
- [ ] Reader: implement minimal decoder in tests to validate round-trip; JS client parser for playback.
- [ ] WS RPC: ensure fetch_output/fetch_input return container bytes when tcap enabled; document legacy raw behavior.
- [ ] Tests: unit tests for varint encode/decode; integration tests generating .tcap and verifying decode + timing progression.
- [ ] Playback UX (frontend): PoC player that replays at 1x/2x, pause, seek; multi-session alignment by absolute timestamps.
- [ ] Future: optional index sidecar for fast seek; evaluate permessage-deflate for backfill.

Architecture options and considerations
- Per-session embedded WS:
  - Pros: simple deployment, aligns with 1 shell = 1 server; easy to isolate; scales to ~100 sessions with low overhead.
  - Cons: many listening sockets/ports; harder to expose securely on WAN without proxy; duplicated code/resources per session.
- Centralized gateway:
  - Pros: single port/TLS, shared auth, resource pooling, simpler external exposure; can supervise child sessions.
  - Cons: extra moving part; term-capture needs IPC (Unix sockets) and discovery; slightly more complex to deploy.
- Data framing:
  - Prefer binary frames with raw bytes; use JSON only for control messages (resize, hello).
- Security posture:
  - Default bind 127.0.0.1, require explicit flag to allow remote; recommend reverse proxy with TLS and auth.
- Backpressure:
  - Apply bounded buffers; drop or disconnect misbehaving clients to protect PTY and disk.
- Input arbitration:
  - Simple FIFO is fine; document that concurrent clients can override each other; add exclusive "control" mode later if needed.

Notes
- Keep main() thin; grow testable seams around event loop and PTY pieces.
- Prioritize Batches 1–3 to quickly gain confidence, then unlock Batches 4–6 via refactoring.
