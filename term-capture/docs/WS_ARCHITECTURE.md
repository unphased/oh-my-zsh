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
  - Binds WS/HTTP to 127.0.0.1:0 (ephemeral port) by default.
  - Writes an entry into the registry: {
      id, pid, prefix, started_at, ws_host, ws_port, token_present, session_meta_path
    }.
  - Also writes a per-session JSON file next to logs: <prefix>.ws.json with the same info.
- On exit, remove the entry. On startup, prune stale entries (pid missing = clean-up).
- Concurrency: use a simple file lock (flock) around registry read/modify/write.

Transport and endpoints
- Library: prefer cpp-httplib (header-only) or similar with WebSocket support; MVP will use WebSocket-only transport.
- Bind address: default 127.0.0.1; require --ws-allow-remote to bind 0.0.0.0.
- Authentication:
  - Optional shared secret via --ws-token TOKEN.
  - For WS, accept token via query param (?token=...), header, or JSON hello message.
  - If configured, require token for all WS connections and RPCs.
- Endpoints:
  - WS /ws
    - Outbound: broadcast PTY output bytes to all connected clients as binary frames.
    - Inbound:
      - Binary frames are written to PTY and appended to <prefix>.input (FIFO arbitration).
      - JSON control frames for {type:"resize", cols, rows}, ping/pong, hello/version.
  - WS RPC messages (over /ws):
    - get_meta -> JSON { input_size, output_size, started_at, pid, prefix }
    - fetch_input {offset,limit} -> returns raw bytes (binary frame)
    - fetch_output {offset,limit} -> returns raw bytes (binary frame)
    - get_stats -> JSON { connections, bytes_in, bytes_out, drops, backlog_high_water }

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
- Initial populate: use HTTP backfill for recent scrollback, write to terminal in chunks.
- Live updates: WS binary frames append to xterm.js buffer.
- Resize: xterm.js ‘resize’ -> send JSON {type:"resize", cols, rows} on WS.
- Input: keypresses -> WS binary frames to server -> PTY write + <prefix>.input append.

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
- --ws-token TOKEN        (optional; if set, required for connections and HTTP)
- --ws-allow-remote       (if present, bind to 0.0.0.0; strongly recommend proxy+TLS)
- --ws-send-buffer BYTES  (per-client buffer before drop/disconnect; default 2 MiB)

Incremental implementation plan
1) Server bootstrap in parent:
   - After PTY and logs set up, start cpp-httplib server in a background thread.
   - Determine bound port; print to stderr; write <prefix>.ws.json and update registry.
2) Data plane:
   - Hook PTY output path to broadcast bytes to WS clients.
   - Hook WS binary frames to PTY input and append to <prefix>.input.
3) Control plane:
   - WS JSON: hello (version), resize, ping/pong.
   - WS RPC: get_meta, fetch_input, fetch_output, get_stats.
4) Backpressure and counters:
   - Per-connection bounded queue; simple drop policy and metrics.
   - /stats endpoint reflects counters.
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
     - Fetch /logs/meta and a small slice.
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
- Log rotation semantics and how clients detect truncation or rotation.
- Compression for WS backfill (permessage-deflate) or chunked RPC for large tails.
- Optional message framing if we later add multiple logical streams over WS.
- Auth token handling best practice (header vs query vs subprotocol; recommend header).
- Limits and quotas for inputs to avoid abuse when exposed remotely.

Recommended next steps (actionable)
- Implement Phase 1 MVP (embedded WS + registry + WS RPC backfill) using cpp-httplib or similar.
- Add CLI flags (--ws-listen, --ws-token, --ws-allow-remote, --ws-send-buffer).
- Write <prefix>.ws.json and update ~/.term-capture/sessions.json with flock.
- Add a minimal xterm.js HTML client to prove end-to-end flow.
- Later, create a small tc-gateway that serves birds-eye from the registry and proxies to sessions.
