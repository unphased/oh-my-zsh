# term-capture Roadmap

This document captures the high-level plan: what we are driving right now, what lands next, and where deep-dive design notes live.

## Current Focus (Q2 2025)

### Playback Validation Viewer _(current focus)_
Drive the robust playback/seeking architecture using the framework-free `web/` viewer as a dogfooding and validation harness.

Core principles:
- Maintain an always-correct **oracle** path: reset + replay from offset 0 → target offset/time.
- Build acceleration structures (keyframes + reversible patches) as derived artifacts, continuously validated against the oracle.

Near-term milestones:
- Time/offset scrubber wired to TCAP (`*.tidx` + `*.events.jsonl`) with “replay from 0” correctness mode.
- Extract deterministic “frame state” snapshots from xterm (start with characters-only viewport) for comparisons.
- Generate keyframes + reversible patches (e.g. ~50ms cadence) and add UI to inspect/apply them forward/backward.
- Compare derived reconstruction vs oracle at arbitrary points and surface diffs (validation UI).
- Iterate toward a stable on-disk/offline “derived index” format once the patch model stabilizes.

### Hardening & Coverage _(in progress)_
- Drive unit/integration coverage of `term-capture.cpp` and `hexflow.cpp`, including failure seams around PTY setup and the select loop.
- Shake out edge scenarios (signal storms, resize churn, log failures) and feed the fixes back into the main loop.
- Outcome: confidence-gated release backed by refreshed coverage reports and a defect checklist.

### Testing Discipline _(ongoing initiative)_
- Fold every new feature behind unit + integration coverage, with failure-path seams validated via linker overrides where practical.
- Maintain a fast smoke suite (CLI, PTY, WS stubs) and document required test updates in PR templates.
- Outcome: testing remains the first-class contract for shipping, not an afterthought.

### Runtime Reliability _(queued)_
- Propagate the wrapped command’s exit status to the parent.
- Offer a quiet mode for startup/shutdown chatter and audit signal handling (SIGHUP/SIGINT/SIGTERM/SIGWINCH).
- Outcome: predictable exits and documented knobs for noisy environments.

### WebSocket Track _(deferred)_
WebSocket work is intentionally punted for now to keep focus on robust offline playback, derived indexing, and seek/scrub correctness.

The full WS plan remains in `docs/WS_ARCHITECTURE.md`, and can be resumed once the playback core and validation harness have hardened.

### Dogfooding & Frontend Beachhead _(parallel)_
- Unblock daily use by adding a tiny browser proof-of-concept that works off existing logs first (no WS required).
- Start with “offline playback”: load `<prefix>.output` and replay it into xterm.js in a static page; this creates the UI foothold while WS work is still hardening-blocked.
- Evolve to “live mode” later, once the offline playback core is solid and we have clear streaming semantics.
- Outcome: a usable viewer early, driving TCAP and playback with real usage instead of speculation.

## Near-Term Milestones
- **Log management & storage**: rotation policy, naming schemes, buffered writes with crash-safe flush semantics.
- **High-volume throughput controls**: rate monitoring, retention windows, drop notifications.
- **Session playback foundation**: TCAP layout (`.input/.output` + `*.tidx` sidecars), time-indexed playback, hooks for WS backfill.
- **Daemonless registry mesh**: peer-to-peer gossip, leader election for registry snapshots, external metadata contract.

## WebSocket Track
Progress is organized into the batches outlined in `docs/WS_ARCHITECTURE.md` (deferred until the playback validation work is in a good place):

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
