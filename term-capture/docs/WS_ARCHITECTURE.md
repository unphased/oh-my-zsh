# term-capture: WebSocket Architecture and Birds-eye View

Goals
- Live mirror and control of a running term-capture session in a browser (xterm.js).
- Birds-eye overview page listing multiple concurrent sessions, each renderable independently.
- Simple, clean, incremental path that works locally first, with a route to WAN exposure later.

Guiding principles
- Keep term-capture a single self-contained binary with minimal dependencies.
- Favor incremental complexity: start embedded per-session WS, add a registry, later unlock a centralized gateway if/when needed.
- Prefer simple, explicit protocols: raw binary for data, JSON for control and request/response RPC over WebSocket (no separate HTTP endpoints).

Approach comparison

A) Embedded per-session WebSocket (inside term-capture)
- Pros
  - Simple and modular; each session owns its own tiny WS server.
  - Natural coupling to that session’s PTY and log files.
  - Easy to add progressive fetch directly off the real log files.
  - Isolation: session crashes don’t affect others.
  - No external service required for the MVP.
- Cons
  - Discovery: multiple ports require a registry to enumerate active sessions.
  - WAN exposure: many ports, harder to expose safely without a fronting proxy/gateway.
  - Duplicated server resources per session (acceptable up to O(100) sessions).

B) Centralized gateway (separate process/service)
- Pros
  - Single port, single TLS termination, central auth/control, one UI.
  - Easier WAN story; consistent lifecycle and metrics.
- Cons
  - Requires an additional process and IPC with sessions (Unix sockets or TCP).
  - More code and deployment complexity upfront.

Hybrid path (recommended)
1) Phase 1 (MVP): Embedded per-session WS with a simple session registry file.
2) Phase 2: Optional thin gateway that reads the registry and proxies to per-session servers.
3) Phase 3: If needs grow, move to a proper gateway + IPC model; keep per-session option for local use.

Discovery and registry (Phase 1)
- Registry file: ~/.term-capture/sessions.json (or /tmp/term-capture-sessions.json).
- On startup, each term-capture instance:
  - Binds WS to 127.0.0.1:0 (ephemeral port) by default.
  - Writes an entry into the registry: {
      id, pid, prefix, started_at, ws_host, ws_port, token_present, session_meta_path
    }.
  - Also writes a per-session JSON file next to logs: <prefix>.ws.json with the same info.
- On exit, remove the entry. On startup, prune stale entries (pid missing = clean-up).
- Concurrency: use a simple file lock (flock) around registry read/modify/write.

Transport and endpoints
- Library: prefer uWebSockets (uWS) for high-performance WS; fallback to WebSocket++ (header-only with Asio standalone) if build constraints demand. MVP will use WebSocket-only transport.
  - Rationale: uWS provides excellent throughput/latency and native permessage-deflate, with a simple C++ API. WebSocket++ remains a simple, portable backup.
- Bind address: default 127.0.0.1; require --ws-allow-remote to bind 0.0.0.0.
- Authentication:
  - Optional shared secret via --ws-token TOKEN.
  - For WS, accept token via query param (?token=...), header, or JSON hello message.
  - If configured, require token for all WS connections and RPCs.
- Endpoints:
  - WS /ws
    - Outbound: broadcast PTY output bytes to all connected clients as binary frames (raw bytes; no timestamps).
    - Inbound:
      - Text frames only: JSON messages for input and control. For input, send {type:"input", data_b64:"..."}; server decodes and writes to PTY and appends to <prefix>.input (FIFO arbitration).
      - JSON control frames for {type:"resize", cols, rows}, ping/pong, hello/version.
      - Client-sent binary frames are rejected.
  - WS RPC messages (over /ws):
    - get_meta -> JSON { input_size, output_size, started_at, pid, prefix }
    - fetch_input {offset,limit} -> returns container bytes when --log-format=tcap, or raw bytes when --log-format=raw (binary frame)
    - fetch_output {offset,limit} -> returns container bytes when --log-format=tcap, or raw bytes when --log-format=raw (binary frame)
    - get_stats -> JSON { connections, bytes_in, bytes_out, drops, backlog_high_water }

Time-indexed capture format (v1)
- Purpose: enable high-fidelity, time-based playback and cross-session synchronization (birds-eye view).
- Files and naming:
  - New container format "tcap" written per stream as:
    - <prefix>.input.tcap
    - <prefix>.output.tcap
  - Legacy mode (default during MVP): raw byte logs:
    - <prefix>.input
    - <prefix>.output
  - Select with --log-format raw|tcap (see CLI). When tcap is enabled, only .tcap files are written.
- Header (fixed, little-endian for fixed-width fields):
  - magic: 5 bytes, ASCII "TCAP1"
  - flags: u8 bitfield (bit0=1 means little-endian; others reserved 0)
  - started_at_unix_ns: u64 absolute UNIX epoch timestamp in nanoseconds (session start)
  - reserved: 16 bytes (zero for now) for future use (e.g., session id, hostname)
- Record framing (repeats until EOF):
  - type: u8 (0x01 = output, 0x02 = input, 0x10 = resize, 0x11 = marker, 0x20–0x3F reserved for future control/events)
  - ts_mode: u8 (0x00 = absolute; 0x01 = delta)
  - ts_value: ULEB128 unsigned integer
    - If ts_mode=absolute, ts_value is absolute UNIX ns since epoch.
    - If ts_mode=delta, ts_value is nanoseconds since the previous record in the same file (stream-local).
  - length: ULEB128 unsigned integer, byte length of payload
  - payload: [length] bytes
- Encoding notes:
  - ULEB128 is used for ts_value and length to minimize space; small deltas typically encode to 1–3 bytes.
  - Unknown record types must be safely skippable by using the length to advance.
  - Endianness: all fixed-width header fields are little-endian; record integers use varint (LEB128), which is byte-oriented.
- Writer heuristics:
  - Prefer ts_mode=delta when the delta encodes in <=3 bytes (e.g., small gaps), else use absolute.
  - Group bytes naturally as they arrive from the PTY loop to avoid over-fragmentation.
- Playback:
  - A client can reconstruct wall-clock times from absolute timestamps and/or accumulate deltas.
  - Cross-session sync is enabled by absolute timestamps across independent .tcap files.
  - Resize events (type=0x10) payload: struct { u16 cols; u16 rows } in little-endian.
  - Live WS streaming uses raw output bytes with no timestamp envelope; time navigation uses tcap backfill/playback.

Progressive backfill (client scrollback)
- On client connect:
  - Send WS RPC get_meta to learn sizes.
  - Backfill recent tail via WS RPC fetch_output with {offset:max(0, size-N), limit:N}.
  - Start WS to receive live output; append to terminal.
- User scrolls upward:
  - Client requests earlier ranges with offset/limit.
- Rationale: Keeping a single WS channel (data + control + RPC) simplifies deployment (no extra HTTP handlers) and works well with binary frames for backfill; clients can chunk requests as needed.

xterm.js client model
- Create an xterm.js instance per session.
- Initial populate: use WS RPC fetch_output for recent scrollback, write to terminal in chunks.
- Live updates: WS binary frames append to xterm.js buffer.
- Resize: xterm.js ‘resize’ -> send JSON {type:"resize", cols, rows} on WS.
- Input: keypresses -> WS JSON text frame {type:"input", data_b64:"..."} -> server decodes, writes to PTY + <prefix>.input append.

Backpressure and multi-client input
- Output (server->clients):
  - Per-client send queue, bounded (e.g., 2–8 MB). If exceeded:
    - Option A: drop oldest pending frames (with a counter); or
    - Option B: disconnect the slow client with a reason.
- Input (clients->server):
  - Simple FIFO: whatever arrives is written to PTY in arrival order.
  - Document that multiple clients can conflict; add “exclusive control” later.

Security posture (MVP)
- Defaults safe:
  - Bind 127.0.0.1 only.
  - No token required locally unless set.
  - Print “WS listening on 127.0.0.1:<port>” to stderr and write to <prefix>.ws.json + registry.
- For remote access:
  - Recommend a reverse proxy (nginx/traefik) with TLS + auth, proxying to localhost.
  - Or move to Phase 2 gateway that centralizes TLS/auth.

Birds-eye view (Phase 1 UX)
- A static “sessions.html” (served by gateway later, or any static server) loads sessions.json from the registry path exposed behind auth.
- Renders a list of live sessions with connect links (ws://127.0.0.1:PORT/ws).
- For quick-start, host a minimal HTML/JS page with any static server; it connects via WS RPC. A thin gateway can later serve the birds-eye UI.

Minimal CLI (MVP)
- --ws-listen HOST:PORT   (default: 127.0.0.1:0 for ephemeral port)
- --ws-token TOKEN        (optional; if set, required for connections and RPCs)
- --ws-allow-remote       (if present, bind to 0.0.0.0; strongly recommend proxy+TLS)
- --ws-send-buffer BYTES  (per-client buffer before drop/disconnect; default 2 MiB)
- --log-format raw|tcap   (default: raw in MVP; tcap enables time-indexed container logs and RPC backfill of container bytes)

Incremental implementation plan
1) Server bootstrap in parent:
   - After PTY and logs set up, start a uWebSockets (uWS) server in a background thread (kqueue/epoll via usockets).
   - Determine bound port; print to stderr; write <prefix>.ws.json and update registry.
2) Data plane:
   - Hook PTY output path to broadcast bytes to WS clients.
   - Hook WS text frames of type "input" to PTY input and append to <prefix>.input.
   - If --log-format=tcap is enabled, write time-indexed container records to <prefix>.input.tcap and <prefix>.output.tcap instead of raw .input/.output.
3) Control plane:
   - WS JSON: hello (version), resize, ping/pong.
   - WS RPC: get_meta, fetch_input, fetch_output, get_stats.
4) Backpressure and counters:
   - Per-connection bounded queue; simple drop policy and metrics.
   - get_stats RPC reflects counters.
5) Client PoC:
   - Minimal HTML page with xterm.js that:
     - Backfills last N bytes via WS RPC fetch_output.
     - Connects WS for live.
     - Sends resize and input.
6) Registry:
   - Implement file-locking update to sessions.json; prune stale entries; write per-session <prefix>.ws.json.
7) Docs and tests:
   - Document flags + endpoints; add integration tests that:
     - Start term-capture with --ws-listen 127.0.0.1:0 and --ws-token test.
     - Issue get_meta RPC and a small fetch_output slice.
     - Optionally exercise WS connect (headless) to assert 101 Switching Protocols.

Migration to centralized gateway (later)
- Stand up tc-gateway:
  - Reads sessions.json (or subscribes to a named pipe/event).
  - Serves the birds-eye UI, proxies WS to per-session servers.
  - Adds external auth/TLS, rate-limits, and consolidated metrics.
- Optionally switch term-capture to expose a Unix domain socket instead of TCP and let gateway bind public ports.

Key trade-offs summarized
- Embedded WS is the cleanest way to start, minimizes new moving parts, and naturally supports progressive backfill by reading the actual log files.
- A simple on-disk registry + per-session JSON makes discovery trivial and WAN-ready via a thin gateway or reverse proxy.
- When needs grow (auth, TLS, multi-tenant), a centralized gateway can be introduced without breaking the embedded per-session model.

Open questions for later
- Log rotation semantics and how clients detect truncation or rotation; container header trailers and/or index sidecars.
- Compression for WS backfill (permessage-deflate) or chunked RPC for large tails; interaction with varint framing.
- Optional message framing if we later add multiple logical streams over WS.
- Auth token handling best practice (header vs query vs subprotocol; recommend header).
- Limits and quotas for inputs to avoid abuse when exposed remotely.
- Fast-seek playback: optional on-disk index (e.g., every N records store byte offset + abs ts) to accelerate random access.

Recommended next steps (actionable)
- Implement Phase 1 MVP (embedded WS + registry + WS RPC backfill) using uWebSockets (uWS). If uWS build proves problematic on a given host, temporarily use WebSocket++ as a fallback.
- Add CLI flags (--ws-listen, --ws-token, --ws-allow-remote, --ws-send-buffer).
- Write <prefix>.ws.json and update ~/.term-capture/sessions.json with flock.
- Add a minimal xterm.js HTML client to prove end-to-end flow.
- Later, create a small tc-gateway that serves birds-eye from the registry and proxies to sessions.
