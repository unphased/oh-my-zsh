# term-capture Roadmap

This document captures the high-level plan: what we are driving right now, what lands next, and where deep-dive design notes live.

## Current Focus (Q2 2025)

### Hardening & Coverage _(in progress)_
- Drive unit/integration coverage of `term-capture.cpp` and `hexflow.cpp`, including failure seams around PTY setup and the select loop.
- Shake out edge scenarios (signal storms, resize churn, log failures) and feed the fixes back into the main loop.
- Outcome: confidence-gated release backed by refreshed coverage reports and a defect checklist.

### Runtime Reliability _(queued)
- Propagate the wrapped command’s exit status to the parent.
- Offer a quiet mode for startup/shutdown chatter and audit signal handling (SIGHUP/SIGINT/SIGTERM/SIGWINCH).
- Outcome: predictable exits and documented knobs for noisy environments.

### WebSocket MVP Preparation _(blocked on hardening)_
- Confirm uWebSockets (uWS) as the transport, keeping WebSocket++ as a fallback.
- Land minimal CLI surface (`--ws-listen`, `--ws-token`, `--ws-allow-remote`, `--ws-send-buffer`).
- Emit `<prefix>.ws.json` and manage `~/.term-capture/sessions.json` with flock-based pruning.
- Outcome: background thread skeleton that starts/stops cleanly without touching the PTY data path yet.

## Near-Term Milestones
- **Log management & storage**: rotation policy, naming schemes, buffered writes with crash-safe flush semantics.
- **High-volume throughput controls**: rate monitoring, retention windows, drop notifications.
- **Session playback foundation**: TCAP writer/reader, time-indexed playback, hooks for WS backfill.
- **Daemonless registry mesh**: peer-to-peer gossip, leader election for registry snapshots, external metadata contract.

## WebSocket Track
Progress is organized into the batches outlined in `docs/WS_ARCHITECTURE.md`:

1. **Batch 7 – MVP spine**: embed WS server, implement CLI flags, write per-session metadata, update registry.
2. **Batch 8 – Data plane hooks**: broadcast PTY output, accept WS input, enforce send buffers.
3. **Batch 9 – Backfill RPCs**: ship `get_meta`, `fetch_input`, `fetch_output`, `get_stats`.
4. **Batch 10 – Browser client PoC**: thin xterm.js page with resize + auth plumbing.
5. **Batch 11+**: protocol hardening, auth/token enforcement, lifecycle, observability.

Parallel exploration: registry mesh experiments (gossip payloads, bully election, permission hardening) continue independently and merge when stable.

## Backlog & Experiments
- Disk usage controls: smarter rotation/archival, optional compression, low-frequency flush.
- Advanced throttling: configurable high-data-rate detection, retention windows, operator alerts.
- Playback UX: aligned timelines, seek acceleration via index sidecars, optional permessage-deflate.
- Architecture comparison: embedded WS vs centralized `tc-gateway` once MVP lands.

## Working With This Roadmap
- Treat this as the single high-level planning hub; update statuses here as work advances.
- Capture implementation detail, day-to-day decisions, and retrospectives in `WORKLOG.md` with backlinks to the relevant roadmap sections.
- Keep component deep dives in dedicated specs under `docs/` (e.g., `docs/WS_ARCHITECTURE.md`, `docs/COMPRESSION.md`) and reference them from this plan as they influence priorities.
