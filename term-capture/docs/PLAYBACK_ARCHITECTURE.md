# Playback & Scrubbing Architecture (planning doc)

This document is a scratchpad to refine the browser playback architecture (xterm.js) for term-capture.

**Status:** planning only; not yet implemented.

## Problem statement
xterm.js (like a real terminal) is fundamentally a “forward-only” state machine: feed it bytes, it updates internal state. A time scrubber needs *random access* (jump to time T, then to time T-30s, etc), which requires reconstruction instead of “undo”.

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

### `*.events` (resize metadata)
Purpose: store non-byte events that affect terminal state.

MVP event types:
- `resize(cols, rows)`

Each event record must include:
- `t_ns` (same clock basis as `*.tidx`)
- `stream_offset` (the output byte offset that the resize should be applied “before/at”)
  - This ties events to the exact playback point even if timestamps are coarse.

Encoding options (pick one for v1; can evolve later):
- Binary, varint deltas (preferred for size/CPU).
- JSONL for early debugging (human-editable; slower/larger).

## Playback model (future)

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

## Open questions (to resolve later)
- Clock basis: monotonic since start vs absolute unix ns; recommended: monotonic for seek math + store unix start in meta JSON.
- Resize semantics: apply resize “before next bytes” vs “after current chunk”; define precisely using stream_offset ties.
- How to handle viewing at different window sizes than recorded (reflow is hard; likely “play at recorded size”).
- How input stream participates in playback (typically only output needed to render; input useful for annotations/search/UI).
