# TCAP: Terminal Capture Format (layout-first)

TCAP is the on-disk representation for a captured terminal session.

**Definition:** TCAP is a *layout* of files: raw byte streams plus sidecars for timing/metadata. Raw streams remain the ground-truth payload.

## Goals
- Preserve terminal I/O **as raw bytes**.
- Add timestamps/metadata without contaminating raw bytes.
- Keep writes append-only and cheap.
- Enable time→offset seeking and correct playback.

## Session layout (v1)
Given a capture prefix `<prefix>`:

### Raw streams (required)
- `<prefix>.output` — bytes from the PTY (includes ANSI escape sequences)
- `<prefix>.input` — bytes written to the PTY

### Sidecars (recommended)
- `<prefix>.output.tidx` — time→offset index for `<prefix>.output`
- `<prefix>.input.tidx` — time→offset index for `<prefix>.input`
- `<prefix>.events.jsonl` — low-frequency out-of-band events (v1: resize)
- `<prefix>.meta.json` — small JSON metadata (debug-friendly)

Each raw stream has its own `*.tidx` because offsets are per-file.

## Clocks and time basis
TCAP uses two time references:
- `started_at_unix_ns`: wall-clock Unix time (ns since Unix epoch), captured once at session start (cross-session alignment).
- `t_ns`: monotonic time (ns since session start, with implied `t_ns=0` at session start).

If multiple sidecars include `started_at_unix_ns`, writers should write the same value.

## Time index sidecar (`*.tidx`)
`*.tidx` is an append-only index that maps time to positions in the corresponding raw file.

### Semantics
Each record corresponds to a “commit point”: a contiguous run of bytes appended to the raw stream (typically one `read()` worth of bytes). The index timestamps chunk boundaries, not individual bytes.

### Record fields (logical)
- `t_ns`: monotonic time in nanoseconds since session start.
- `end_offset`: byte offset in the raw file **after** appending the chunk (i.e., raw file size at that point).

### How `end_offset` partitions the stream
Let the reconstructed records be `(t_1, end_1), (t_2, end_2), ...`, with implied `(t_0=0, end_0=0)`.

- At time `t_i`, the raw stream length is `end_i` (bytes `[0, end_i)` exist).
- Bytes appended “during record `i`” are exactly `[end_{i-1}, end_i)`.
- Seek invariant (chunk granularity): for time `T`, find the first `i` with `t_i >= T`; then `[0, end_i)` is the stream “up to T”.

### Encoding (binary, compact)
To keep the sidecar small and CPU-cheap, encode as varint deltas.

Header (once):
- magic: ASCII `TIDX1` (5 bytes)
- flags: u8 (0 for v1)
- started_at_unix_ns: u64 little-endian

Records (repeat until EOF):
- `dt_ns`: ULEB128 (delta from previous record’s `t_ns`; first record is a delta from `t_ns=0`)
- `dend`: ULEB128 (delta from previous record’s `end_offset`; first record is a delta from `end_offset=0`)

Reconstruction:
- `t_ns = Σ dt_ns`
- `end_offset = Σ dend`

### Crash/atomicity rules
To avoid index entries pointing past durable raw bytes:
- Append raw bytes first, flush if/when desired.
- Then append the corresponding `*.tidx` record.

If a crash happens, a reader should treat any trailing index record that points beyond the raw file length as invalid and truncate it (or ignore it).

## Events sidecar (`*.events.jsonl`)
`*.events.jsonl` is an append-only stream of low-frequency, out-of-band events that affect terminal rendering. It is JSONL: UTF-8 text, one JSON object per line.

### Schema (v1)
Readers should ignore unknown keys and unknown `type` values.

All events:
- `type` (string)
- `t_ns` (number): monotonic ns since start (same basis as `*.tidx`)

#### `resize` (v1)
Fields:
- `type`: `"resize"`
- `t_ns`: number
- `stream`: `"output"` (reserved; v1 uses `"output"`)
- `stream_offset`: number (absolute byte offset in `<prefix>.output`)
- `cols`: number
- `rows`: number

Apply semantics:
- **Ordering is defined by `stream_offset`**: apply the resize immediately before rendering the byte at `stream_offset` (if any).
- `t_ns` is observational metadata (e.g. for sanity-checking, UI display, or cross-stream correlation) and MUST NOT be used to infer/interpolate a different `stream_offset`.

Monotonicity: writers should emit `t_ns` and `stream_offset` in non-decreasing order; readers should not assume strict monotonicity.

Writer guidance (capture-time): to minimize ambiguity around “bytes already queued” vs “bytes after the resize”, a capture implementation should drain any currently-readable PTY output bytes into `<prefix>.output` (and update `output.tidx`) before recording the resize event, so the resize `stream_offset` points to the first output byte observed after handling the resize.

Example line:
```json
{"type":"resize","t_ns":512345678,"stream":"output","stream_offset":1048576,"cols":120,"rows":32}
```

## Session metadata sidecar (`*.meta.json`)
`*.meta.json` is a small JSON document for low-frequency facts and debugging.

Recommended fields (v1; readers should ignore unknown keys):
- `pid` (number): child PID.
- `prefix` (string): capture prefix used to derive file paths.
- `started_at_unix_ns` (number): wall-clock start time.
- `build_git_sha` (string, optional): git commit id of the term-capture build.
- `build_git_dirty` (boolean, optional): whether the source tree was dirty at build time.

## Future: bundles/containers (later)
Once the layout is stable, a single-file packaging format can wrap it (tar/zip-like bundle, optional per-stream compression). This bundling layer should be optional and tooling-driven; the capture hot path remains layout-first and append-only.
