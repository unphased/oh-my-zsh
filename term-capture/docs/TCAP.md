# TCAP: Terminal Capture Format (layout-first)

TCAP is the on-disk representation for a captured terminal session.

**Definition (committed):** TCAP is a *layout* of files: per stream, a raw bytestream plus a separate metadata/index stream. A future “bundle/container” (single-file packaging, compression) may wrap this layout, but the raw stream remains the ground-truth payload.

## Goals
- Preserve terminal I/O **as raw bytes** (human-inspectable with `xxd`, streamable with `tail -f`, etc).
- Add **timestamps and metadata** without contaminating the raw byte stream.
- Keep writes **append-only** and cheap in the hot PTY loop.
- Enable fast playback primitives: time→byte-offset, tail/backfill, cross-session alignment.

## Session layout (v1)
Given a capture prefix `<prefix>`:

### Output stream (PTY → user)
- Raw bytes: `<prefix>.output`
- Time index sidecar: `<prefix>.output.tidx`

### Input stream (user → PTY)
- Raw bytes: `<prefix>.input`
- Time index sidecar: `<prefix>.input.tidx`

### Session metadata (optional, small JSON)
- `<prefix>.meta.json`
  - Intended for low-frequency facts: session id, pid, start timestamps, host, cwd, TERM, initial winsize, argv, etc.
  - This file can be written once at startup and optionally updated on exit (or appended as JSONL later if we want crash-friendly updates).

## Time index sidecar (`*.tidx`)
`*.tidx` is an append-only index that maps time to positions in the corresponding raw file.

### Semantics
Each record corresponds to a “commit point” in the raw file: typically one `read()` chunk (PTY output) or one `read()` chunk from stdin (input).

The index does **not** attempt per-byte timestamps; it timestamps *ranges*.

### Record fields (logical)
- `t_ns`: monotonic timestamp in nanoseconds since session start (or an absolute monotonic epoch; pick one and standardize).
- `end_offset`: byte offset in the raw file **after** appending the chunk (i.e., the size of the raw file at that point).

Using `end_offset` (instead of start+len) makes the index self-healing for “tail replay”: if you know the prior record’s end_offset, you can derive the byte range.

### Encoding (binary, compact)
To keep the sidecar small and CPU-cheap, encode as varint deltas:

- File header (once):
  - magic: ASCII `TIDX1` (5 bytes)
  - reserved: u8 flags (0 for now)
  - started_at_unix_ns: u64 (optional; can also live in `<prefix>.meta.json`)

- Records (repeat until EOF):
  - `dt_ns`: ULEB128 (delta from previous `t_ns`; first record is absolute from start: `t_ns` since start)
  - `dend`: ULEB128 (delta from previous `end_offset`; first record is absolute `end_offset`)

Notes:
- Deltas are almost always small; ULEB128 keeps records tiny.
- Readers can scan linearly or build an in-memory sparse index for binary search.

### Crash/atomicity rules
To avoid index entries pointing past durable raw bytes:
- Append raw bytes first, flush if/when desired.
- Then append the corresponding `*.tidx` record.

If a crash happens, a reader should treat any trailing index record that points beyond the raw file length as invalid and truncate it (or ignore it).

## Future: TCAP bundle/container (later)
Once the layout is stable, a single-file packaging format can wrap it:
- tar/zip-like “bundle” containing the raw streams and sidecars
- optional compression applied **per stream** (raw bytes and metadata separately) to preserve good compressibility and allow selective decoding

This bundling layer should be optional and tooling-driven; the capture hot path should remain the layout-first append-only writer.
