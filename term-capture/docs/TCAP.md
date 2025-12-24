# TCAP: Terminal Capture Format (layout-first)

TCAP is the on-disk representation for a captured terminal session.

**Definition:** TCAP is a *layout* of files: per stream, a raw bytestream plus one or more sidecars for timing and metadata. A future “bundle/container” (single-file packaging, compression) may wrap this layout, but the raw streams remain the ground-truth payload.

## Goals
- Preserve terminal I/O **as raw bytes** (inspectable with `xxd`, streamable with `tail -f`, etc).
- Add **timestamps and metadata** without contaminating the raw byte streams.
- Keep writes **append-only** and cheap in the hot PTY loop.
- Enable practical playback primitives: time→byte-offset, tail/backfill, cross-session alignment.

## Session layout (v1)
Given a capture prefix `<prefix>`, TCAP consists of:

### Raw streams (required)
- Raw bytes: `<prefix>.output`
- Raw bytes: `<prefix>.input`

These are the only files whose contents are “the terminal”: they contain exactly the bytes written to/from the PTY (including ANSI escape sequences).

### Sidecars (recommended)
- Time index sidecar for output: `<prefix>.output.tidx`
- Time index sidecar for input: `<prefix>.input.tidx`
- Events sidecar (non-byte events like resize): `<prefix>.events.jsonl`
- Session metadata (small JSON, low-frequency facts): `<prefix>.meta.json`

Each raw stream has its own `*.tidx` because offsets are per-file and the streams advance independently.

## Clocks and time basis
TCAP uses two time references:
- `started_at_unix_ns`: wall-clock Unix time (nanoseconds since Unix epoch) captured once at session start. Used for “what time did this start?” and cross-session alignment.
- `t_ns`: monotonic time (nanoseconds since session start, with an implied origin of `t_ns=0` at session start). Used for seek math and playback timing.

All sidecars that carry time are expected to use the same session start and `t_ns` basis.

## Time index sidecar (`*.tidx`)
`*.tidx` is an append-only index that maps time to positions in the corresponding raw file.

### Semantics
Each record corresponds to a “commit point” in the raw file: a contiguous run of bytes appended to the raw stream, typically from a single `read()` call (PTY output) or a single `read()` call from stdin (input).

In the current implementation, a record is appended once per main-loop iteration that reads bytes and appends them to `<prefix>.output` or `<prefix>.input`.

The time index does **not** attempt per-byte timestamps; it timestamps *chunk boundaries*.

### Record fields (logical)
- `t_ns`: monotonic time in nanoseconds since session start.
- `end_offset`: byte offset in the raw file **after** appending the chunk (i.e., the raw file size at that point).

Using `end_offset` (instead of start+len) makes the index self-healing for “tail replay”: if you know the prior record’s end_offset, you can derive the byte range.

### How `end_offset` partitions the stream
Let the reconstructed records be `(t_1, end_1), (t_2, end_2), ...`, with implied `(t_0=0, end_0=0)`.

Interpretation:
- At time `t_i`, the raw stream length is `end_i`, meaning bytes in the range `[0, end_i)` have been appended to the raw stream by `t_i`.
- The specific bytes appended “during record `i`” are exactly the half-open range `[end_{i-1}, end_i)`.

This is the core seek invariant: for a given time `T`, find the first record with `t_i >= T`; the corresponding `end_i` is the smallest offset such that bytes `[0, end_i)` represent the stream “up to time `T`” (at chunk granularity).

### Encoding (binary, compact)
To keep the sidecar small and CPU-cheap, encode as varint deltas:

- File header (once):
  - magic: ASCII `TIDX1` (5 bytes)
  - reserved: u8 flags (0 for now)
  - started_at_unix_ns: u64 little-endian

- Records (repeat until EOF):
  - `dt_ns`: ULEB128 (delta from previous record’s `t_ns`; the first record is a delta from `t_ns=0`)
  - `dend`: ULEB128 (delta from previous record’s `end_offset`; the first record is a delta from `end_offset=0`)

Readers reconstruct:
- `t_ns = Σ dt_ns`
- `end_offset = Σ dend`

Notes:
- Deltas are almost always small; ULEB128 keeps records tiny.
- Readers can scan linearly or build an in-memory sparse index for binary search.

### Crash/atomicity rules
To avoid index entries pointing past durable raw bytes:
- Append raw bytes first, flush if/when desired.
- Then append the corresponding `*.tidx` record.

If a crash happens, a reader should treat any trailing index record that points beyond the raw file length as invalid and truncate it (or ignore it).

## Events sidecar (`*.events.jsonl`)
`*.events.jsonl` is an append-only stream of low-frequency, out-of-band events that affect terminal rendering. It is newline-delimited JSON (JSONL): UTF-8 text, one JSON object per line.

Rationale: these events are not expected to be high-rate, and JSONL is easy to inspect and extend while remaining robust to partial writes (readers can ignore a trailing incomplete line).

### Schema (v1)
Readers should ignore unknown keys and unknown `type` values.

Required fields for all events:
- `type` (string): event type name.
- `t_ns` (number): monotonic nanoseconds since session start (same basis as `*.tidx`).

#### `resize` (v1)
Resize events record PTY window size changes and tie them to the output stream timeline.

Fields:
- `type`: `"resize"`
- `t_ns`: number (monotonic ns since start)
- `stream`: `"output"` (reserved for future multi-stream events; v1 only uses `"output"`)
- `stream_offset`: number (absolute byte offset in `<prefix>.output`)
- `cols`: number
- `rows`: number

Semantics:
- A resize event applies “at/before” `stream_offset` during playback: apply the resize before rendering the byte at `stream_offset` (if any).
- `t_ns` and `stream_offset` should be non-decreasing across events.

Example line:
```json
{"type":"resize","t_ns":512345678,"stream":"output","stream_offset":1048576,"cols":120,"rows":32}
```


## Session metadata sidecar (`*.meta.json`)
`*.meta.json` is a small JSON document intended for low-frequency facts and debugging. It is not used in the hot PTY loop.

Recommended fields (v1; readers should ignore unknown keys):
- `pid` (number): child PID.
- `prefix` (string): capture prefix used to derive file paths.
- `started_at_unix_ns` (number): wall-clock start time.
- `build_git_sha` (string, optional): git commit id of the term-capture build.
- `build_git_dirty` (boolean, optional): whether the source tree was dirty at build time.

## Future: bundles/containers (later)
Once the layout is stable, a single-file packaging format can wrap it (tar/zip-like bundle, optional per-stream compression). This bundling layer should be optional and tooling-driven; the capture hot path remains layout-first and append-only.
