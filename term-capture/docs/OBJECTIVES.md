# term-capture Objectives Tracker

## Project Snapshot
- Test infrastructure migrated to Catch2 v3 with coverage reporting wired into the Makefile.
- Core utilities (`term-capture`, `hexflow`) have unit tests for argument parsing and byte formatting.
- README documents build, test, and coverage workflows plus forthcoming hardening ideas.
- WebSocket architecture draft (docs/WS_ARCHITECTURE.md) defines a phased rollout plan toward live session mirroring.

## Active Objectives (Q2 2025)
- **Hardening & Coverage** _(in progress)_
  - Expand unit/integration tests to raise coverage on `term-capture.cpp` and `hexflow.cpp`.
  - Exercise edge scenarios (signal storms, PTY exhaustion, resize loops) and fold fixes back into the main loop.
  - Deliverable: coverage report highlighting remaining untested branches and a checklist of resolved defects.
- **Runtime Reliability Enhancements** _(ready to start)_
  - Propagate the wrapped command’s exit status instead of always returning 0.
  - Add a flag or env var to silence/redirect startup and shutdown notices.
  - Audit signal handling (SIGHUP, SIGINT/SIGTERM, SIGWINCH) to ensure clean teardown and restoration.
  - Deliverable: documented behavior in README + regression tests that cover each path.
- **WebSocket MVP Preparation** _(blocked on hardening)_
  - Finish selecting the transport library (uWebSockets preferred; WebSocket++ fallback).
  - Implement minimal CLI flags: `--ws-listen`, `--ws-token`, `--ws-allow-remote`, `--ws-send-buffer`.
  - Output a per-session `<prefix>.ws.json` stub and maintain `~/.term-capture/sessions.json` with flock-based pruning.
  - Deliverable: background thread skeleton that starts/stops cleanly without data plane hooks.

## Upcoming Milestones
- **Log Management & Storage**: rotation policy, pluggable log naming schemes, buffered writes with crash-safe flush semantics.
- **High-Volume Throughput Controls**: configurable data-rate monitoring with boundary retention and drop notices.
- **Session Playback Foundation**: tcap container writer/reader, time-indexed playback tooling, and integration hooks for the WebSocket RPC backfill.
- **Daemonless Registry Mesh**: prototype peer-to-peer gossip between term-capture instances, leader election for the shared registry snapshot, and contract for which peer exposes external metadata.

## WebSocket Roadmap (batches)
1. **Batch 7 – MVP Server Spine**: integrate WS server, CLI flags, registry, per-session metadata stub.
2. **Batch 8 – Data Plane Hooks**: broadcast PTY output, accept WS input, append to logs, surface backpressure counters.
3. **Batch 9 – Backfill RPCs**: implement `get_meta`, `fetch_input`, `fetch_output`, `get_stats` over WS.
4. **Batch 10 – Browser Client PoC**: minimal xterm.js page with resize + authentication plumbing.
5. **Batch 11+**: protocol hardening, auth token enforcement, lifecycle management, observability, and metric surfacing as outlined in `docs/WS_ARCHITECTURE.md`.
- **Registry Mesh Track** (parallel exploration):
  - Sketch gossip heartbeat payloads and on-disk snapshot rotation strategy.
  - Implement PID/UUID-based bully election and switchover tests so one instance owns the public registry sink at a time.
  - Harden permissions around the local gossip socket before wider deployment.

## Backlog & Ideas
- Disk usage controls: smarter rotation/archival, optional compression, and low-frequency flush strategies.
- Advanced throttling: configurable high-data-rate detection, boundary retention windows, and operator-facing alerts.
- Playback UX: timeline alignment across sessions, seek acceleration via index sidecars, and optional permessage-deflate.
- Architectural experiments: compare embedded WS vs centralized `tc-gateway` deployment once MVP lands.

## How to Use This Document
- Treat this file as the concise source of truth for planning discussions.
- Update statuses as objectives move between “Active”, “Upcoming”, and “Backlog”.
- Keep deep design notes and exhaustive task lists in `WORKLOG.md` and supporting docs.
