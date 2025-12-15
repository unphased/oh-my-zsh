Compression Goals

- Reduce disk usage and WS backfill payloads while keeping append-only writes in the PTY loop (term-capture.cpp:276-380).
- Preserve random-access semantics for RPCs that read slices of the persisted data.
- Keep backwards compatibility: older logs stay readable; newer compressed representations should fail-fast or self-describe so older tooling doesn’t silently misinterpret data.
- Limit hot-path CPU overhead; compression must flush in near-real time without blocking PTY forwarding.

Proposed Format Updates

TCAP is now defined as a *layout* of raw streams plus sidecar metadata/index files (see `docs/TCAP.md`). That layout already provides strong compressibility because:
- The raw terminal stream remains a pure byte dump (high redundancy, often compresses well).
- Timing/index metadata is separated, typically very small and highly structured.

Compression therefore belongs in one of two layers:
1. **Post-processing / tooling layer (recommended first):** a “bundle” or archival artifact that packages and compresses the TCAP layout after capture.
2. **Optional on-capture layer (later):** per-stream compression with explicit framing, while still keeping a stable raw-bytes-first story for local inspection.

Writer & Reader Changes

If/when we add compression:
- Prefer compressing *raw* streams and metadata separately (e.g., `.output.zst` and `.output.tidx.zst`), or compressing a bundle that contains both.
- Avoid mixing compression framing into the raw stream itself; the raw stream is intentionally left as an inspectable byte dump.

WebSocket & Tooling

- Update get_meta / <prefix>.ws.json so clients know what artifacts exist (raw streams, tidx sidecars, and any bundled/compressed variants).
- RPC fetch_input/fetch_output should continue returning raw stream bytes; add parallel RPCs for sidecars (e.g., `fetch_output_tidx`) when time-indexed playback lands.
- For live WS streaming, keep sending raw PTY bytes (uncompressed) to minimize latency; compression only affects persisted container/backfill.
- Provide an optional --ws-permessage-deflate later for live traffic; it’s orthogonal to on-disk compression.
- Update playback tooling/tests to cover both compressed and uncompressed artifacts, ensuring offsets map correctly (offsets always refer to positions in the raw stream).

Incremental Implementation Steps

1. Spec & Docs: document TCAP layout + `*.tidx` sidecars (`docs/TCAP.md`), then define a bundle story.
2. Tooling: add a post-processing bundler (`tcap pack`) that packages a TCAP session directory/prefix into one artifact with optional compression.
3. Playback: implement time-indexed playback against raw+sidecar; validate the offset mapping invariants.
4. Only then consider on-capture compression paths if disk usage demands it.

Next steps you might take:

1. Review and sign off on TCAP layout (`docs/TCAP.md`) including the `*.tidx` encoding.
2. Decide whether the first bundling artifact is tar+zstd, zip, or a bespoke single-file wrapper.
