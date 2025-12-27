# Playback & Scrubbing Architecture (planning doc)

This document is a scratchpad to refine the browser playback architecture (xterm.js) for termplex (term-capture capture artifacts).

**Status:** planning + early prototyping in `web/` (offline viewer).

## Problem statement
xterm.js (like a real terminal) is fundamentally a “forward-only” state machine: feed it bytes, it updates internal state. A time scrubber needs *random access* (jump to time T, then to time T-30s, etc), which requires reconstruction instead of “undo”.

## Current strategy: use the web viewer as a validation harness
We will use `web/` as a dogfooding “validation interface” for playback correctness and future seek/scrub acceleration.

Key design goal: at all times, we retain a **ground-truth code path** that can seek to a target position by doing a rigorous replay from offset 0, so we can validate any acceleration structure (keyframes, patches, heuristics, compression) against the oracle.

## Near-term focus: the minimum metadata we need
Before building scrubbing, we need capture-time metadata that makes playback correct and seekable:

1. **Timestamps:** map “time” to “byte positions” in the raw streams.
2. **Resize events:** record window size changes as first-class events, aligned to the stream timeline.

These are enough to unlock:
- Time-based seeking (time → raw offset).
- Correct rendering (apply the same resize events at the right points).

## TCAP v1 reminder (layout-first)
TCAP is a layout of raw streams plus sidecars:
- `<prefix>.output` + `<prefix>.output.*` sidecars
- `<prefix>.input` + `<prefix>.input.*` sidecars

See `docs/TCAP.md` for the authoritative layout definition.

## Proposed sidecars (MVP)

### `*.tidx` (time index)
Purpose: map time to raw stream offsets.

Minimum record:
- `t_ns` (monotonic nanoseconds since session start)
- `end_offset` (byte offset in raw stream after the chunk)

Notes:
- Records are per “chunk” (whatever we write per PTY read / stdin read).
- Encoding should be cheap and append-only (varint deltas recommended).

### `*.events.jsonl` (resize metadata)
Purpose: store non-byte events that affect terminal state.

MVP event types:
- `resize(cols, rows)`

Each event record must include:
- `t_ns` (same clock basis as `*.tidx`)
- `stream_offset` (the output byte offset that the resize should be applied “before/at”)
  - This ties events to the exact playback point even if timestamps are coarse.

Encoding (v1): JSONL (one JSON object per line); see `docs/TCAP.md`.

## Playback model (future)

## Two-track playback model (oracle + acceleration)

### Track A: Ground truth (oracle)
Inputs:
- Raw stream bytes (`<prefix>.output`) and sidecars (`<prefix>.output.tidx`, `<prefix>.events.jsonl`).
- Target position as `stream_offset` (or derived from time via `*.tidx`).

Algorithm:
1. Reset terminal state.
2. Replay bytes from `[0, target_offset)`.
3. Apply resize events exactly at `stream_offset` boundaries.

Notes:
- This path is “slow but correct”.
- It must remain available in the debug viewer for validation and for worst-case fallback.

### Track B: Derived acceleration (keyframes + reversible patches)
Goal: make scrubbing fast without requiring a new terminal renderer.

Idea:
- During forward playback (either offline indexing or in-browser), periodically extract a “frame state” from xterm and store:
  - **Keyframes**: full extracted frame state at selected offsets/times.
  - **Patches**: compact, reversible deltas between consecutive sampled frame states (e.g. every ~50ms).

Reconstruction:
- To view time/offset `X`, choose a nearby keyframe `K` and apply patches forward (or backward) to reach `X`.

Validation:
- For any target `X`, compare `Derived(K + patches → X)` against `Oracle(replay 0 → X)` using a deterministic frame-state representation.

### Frame state definition (for validation)
We start with a deliberately small, stable surface area:
- `cols`, `rows`
- cursor position (optional initially)
- viewport lines as text (characters only first; attrs later)

This supports a strong validation loop without depending on full xterm internals.

### Patch formats (evolve over time)
Start simple:
- line-based or cell-range edits with both “before” and “after” content, so patches are inherently reversible.

Then optimize opportunistically:
- detect scroll-like shifts (line motion vectors) to compress “mostly shifted” edits
- emit keyframes when patches become too large (full-screen redraws, mode churn)

### Baseline seek (works without snapshots)
To seek to time T:
1. Use `output.tidx` to compute `offset(T)`.
2. Reset xterm.
3. Replay `output` bytes from 0 → `offset(T)` and apply `resize` events at the appropriate offsets.

This is correct but too slow for frequent scrubbing on large sessions.

### Fast seek (snapshots + replay window)
Introduce periodic “checkpoints”:
- A checkpoint captures enough terminal state so replay can start from there (offset C) rather than from 0.
To seek to time T:
1. Find nearest checkpoint `C <= offset(T)`.
2. Restore checkpoint state.
3. Replay bytes from `C.offset → offset(T)`, applying events in that range.

Checkpoint representation options:
- Full terminal state snapshot (ideal but may depend on xterm internals).
- “Rendered” snapshot (text/attrs) for instant preview + optional upgrade path.

### UX considerations
- While dragging scrubber: show a cheap preview; cancel in-flight replays.
- On release: do the accurate xterm reconstruction (possibly from a checkpoint).

## Debug viewer UX goals (validation interface)
The viewer should make the acceleration structures inspectable:
- Timeline showing keyframes, patches, and resize events.
- Ability to step patches forward/backward manually and see the state change.
- Ability to jump to an offset/time using:
  - oracle replay-from-0
  - keyframe + forward patches
  - keyframe + backward patches
- Ability to compare derived vs oracle state at any point and surface diffs.

## Open questions (to resolve later)
- Clock basis: monotonic since start vs absolute unix ns; recommended: monotonic for seek math + store unix start in meta JSON.
- Resize semantics: apply resize “before next bytes” vs “after current chunk”; define precisely using stream_offset ties.
- How to handle viewing at different window sizes than recorded (reflow is hard; likely “play at recorded size”).
- How input stream participates in playback (typically only output needed to render; input useful for annotations/search/UI).

## Capture robustness checklist (pitfalls)
term-capture sits between a real controlling TTY and a PTY session; a lot of “just works” terminal behavior only happens because the kernel + job control deliver events to the *foreground job*. The wrapper must often proxy that behavior explicitly.

### Foreground process group matters
- Prefer targeting the PTY foreground process group (`tcgetpgrp(masterFd)`) rather than only the initial child PID (jobs can change).

### Stop/continue hygiene
- If the wrapper ever receives `SIGTSTP`/`SIGSTOP`, restore the user’s terminal settings before stopping.
- On `SIGCONT`, re-enter raw mode and re-sync window size (or the user’s terminal can be left “broken”).

### Resize propagation
- Set the PTY size (`TIOCSWINSZ`) and ensure the foreground job sees `SIGWINCH`.
- Ensure the event loop wakes on resize (self-pipe or similar); do not wait for “next keystroke” IO.

### Session teardown policy (HUP/disconnect)
- Decide what should happen if the outer terminal disappears (SIGHUP/SSH drop):
  - Kill the session (simple, current behavior), or
  - Keep it running detached (tmux-like; requires new design).

### Backpressure / blocking IO
- Writes to `STDOUT_FILENO` can block (slow pipe/terminal); if blocked while also reading the PTY, the whole session can stall.
- Robust pattern: nonblocking fds + bounded buffers + `select`/`poll` on writability.

### Signal handling strategy
- Prefer `sigaction()` over `signal()` for predictable semantics.
- Keep signal handlers async-signal-safe; use flags + a wake mechanism (self-pipe) to do real work in the main loop.

### TERM + environment fidelity
- Avoid forcing `TERM` unless necessary; it’s a common source of subtle app behavior differences.
- When in doubt: inherit the parent env and only override when explicitly configured.

### PTY lifecycle edges
- Handle child exit and slave close cleanly (`read(masterFd) == 0` or `EIO` on some platforms).
- Decide how long to drain buffered PTY output after child exit.
