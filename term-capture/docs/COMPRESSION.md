Compression Goals

- Reduce disk usage and WS backfill payloads while keeping append-only writes in the PTY loop (term-capture.cpp:276-380).
- Preserve random-access semantics for RPCs that read slices of the container (see docs/WS_ARCHITECTURE.md:72-115).
- Keep backwards compatibility: older logs stay readable; newer compressed logs should fail-fast or self-describe so older decoders don’t silently skip data.
- Limit hot-path CPU overhead; compression must flush in near-real time without blocking PTY forwarding.

Proposed Format Updates

- Bump the container version to TCAP2 (or retain TCAP1 but set a new flag bit) so readers can detect compression immediately (docs/WS_ARCHITECTURE.md:82-99).
- Reuse the 16-byte reserved header region to store: compression_id (u8), chunk_target_bytes (u24 or u32), optional dictionary hash, remaining padding zeroed.
- Introduce a new record type family (e.g. 0x30–0x3F) representing a compressed chunk. Payload layout:

  struct {
      u8 algorithm;        // matches header compression_id when >0
      u8 flags;            // bit0: original records share timestamp base, etc.
      uleb128 uncompressed_len;
      uleb128 record_count;
      bytes compressed_data;  // zstd frame (preferred) or other codec
  }
    - Within each chunk we pack the raw record stream exactly as it would have been written uncompressed (type/ts_mode/ts/value/len/payload repeated).
    - Future codecs can vary by algorithm id; id=0 is “no compression” and should never appear inside these chunk records.
- Readers that don’t understand compression must stop after encountering unknown type and report an unsupported container version; this makes the upgrade explicit.

Writer & Reader Changes

- Add CLI knobs: --log-format=tcap keeps behavior but gains --tcap-compress=[none|zstd|...] with default none. Persist choice in <prefix>.ws.json so WS clients learn the codec.
- Writer buffering: accumulate PTY bytes per stream in a staging buffer until either chunk_target_bytes or a flush timeout (e.g. 32–64 KiB or 250 ms) then encode:
    1. Serialize staged records into a scratch buffer using the existing framing rules.
    2. If compression is enabled, run zstd streaming compression on the scratch buffer, write a compressed chunk record; else spill the raw records directly.
    3. Keep flushing synchronous with the main loop to avoid added threads; bound scratch buffer size to avoid unbounded memory when terminals stall.
- Reader utilities:
    - Extend the (future) decoder to detect version/flag, decode compressed chunk records, and emit contained records seamlessly.
    - Offer a library helper that returns an iterator of logical records regardless of compression.
    - Optionally expose chunk-level metadata (offset, timestamp span) to accelerate index building later.
- Error handling: if compression fails mid-run, fall back to writing raw uncompressed records but log the failure; set a flag in the header footer or session metadata to explain the switch.

WebSocket & Tooling

- Update get_meta / <prefix>.ws.json so clients know compression_id, chunk_target_bytes, and optional dictionary info.
- RPC fetch_input/fetch_output should continue returning raw container bytes. Clients must be updated to handle compressed chunk records; document this alongside the existing spec.
- For live WS streaming, keep sending raw PTY bytes (uncompressed) to minimize latency; compression only affects persisted container/backfill.
- Provide an optional --ws-permessage-deflate later for live traffic; it’s orthogonal to on-disk compression.
- Update playback tooling/tests to cover both compressed and uncompressed logs, ensuring offsets map correctly (container offsets remain byte positions in the compressed file).

Incremental Implementation Steps

1. Spec & Docs: draft TCAP2 (or flag-based) write-up, update docs/WS_ARCHITECTURE.md and CLI help to describe compression knobs and record layout.
2. Build plumbing: add zstd dependency (prefer static or vendored minimal build); gate with feature flag for environments lacking libzstd.
3. Writer refactor: extract a TcapWriter helper that current PTY loop can call for write_input/write_output to keep term-capture.cpp clean; implement buffering + chunk emission.
4. Reader/test harness: create round-trip tests that encode synthetic sessions, assert decompression reproduces original records, and verify backward compatibility (compressed file rejected when decoder lacks support).
5. WS metadata/test: ensure stub JSON gains compression info; add integration tests that open a compressed log, run fetch RPCs, and decode in test code.
6. Performance validation: benchmark CPU usage and latency with representative workloads; tune chunk size/time thresholds; document recommended settings.
7. Rollout strategy: default to none until tooling fully supports compressed logs, then consider switching default once clients are updated.

Next steps you might take:

1. Review and sign off on the spec changes (header format, record type) so implementation can start.
2. Decide on the compression library policy (static vs system lib) and chunk sizing defaults based on target workloads.

