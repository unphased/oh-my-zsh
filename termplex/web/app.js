import {
  lastResizeBeforeOffset,
  normalizeResizeEvents,
  offsetAtTimeNs,
  parseEventsJsonl,
  parseTidx,
  timeAtOffsetNs,
  truncateTidxToRawLength,
} from "../js/tcap/index.js";

/**
 * termplex web viewer architecture (single-file PoC)
 *
 * Data flow (happy path):
 *   (URL scan dropdown | URL direct | local file) → bytes + optional TCAP sidecars → loadBytes()
 *     → OutputPlayer (replay engine) → sink (xterm.js or <pre>) → visible terminal.
 *
 * Key subsystems in this file:
 * - UI bindings (`ui`): DOM handles for the top bar, left panel, scrubbers, and terminal stage.
 * - Terminal “bounds” overlay: measures a cell size and sizes `#terminalCanvas` to match the capture’s cols×rows.
 * - OutputPlayer: the byte→text decode loop and optional resize-event playback (TCAP sidecars).
 * - Sink: abstraction over xterm.js vs a plain `<pre>` fallback.
 * - Source loading: local file reads + HTTP fetches (+ optional sidecar discovery for output streams).
 * - Scrubbers: bind time<->offset, keep them synced to playback progress, and route “release” to seek logic.
 * - Seek logic: “bulk” from-0 recompute seeks, and “mode1” incremental drag-right seeking.
 * - Debug/perf panel: persisted toggles + pretty-printed perf stats.
 *
 * Refactor direction (suggested module split):
 * - `web/viewer/ui.js`: UI wiring, status/meta rendering, and scrubber UI logic.
 * - `web/viewer/prefs.js`: load/save prefs + defaulting.
 * - `web/viewer/perf.js`: perfInfo model + render + bulk seek toggles.
 * - `web/viewer/player.js`: OutputPlayer (pure-ish; could be unit tested separately).
 * - `web/viewer/sink.js`: createSink + xterm-specific helpers (flush, render-disable, scrollback).
 * - `web/viewer/sources.js`: loadLocalFile/loadFromUrl/loadTcapSidecarsFromUrl (shared read/parse utilities).
 * - `web/viewer/listing_scan.js`: scanHttpServerListing + HTML parsing helpers.
 *
 * Consolidation opportunities:
 * - `currentOutputSource` / `currentInputSource` could be a `{ output, input }` map keyed by kind.
 * - `loadFromUrl` and `loadLocalFile` both “get bytes + startOffset + name”; that could be unified behind a
 *   `readSource(kind, opts)` returning `{ name, size, startOffset, u8, tcap }`.
 * - Seek code currently toggles several “bulk mode” knobs inline; extracting a `withBulkSeekMode(fn)` wrapper
 *   would reduce branching and make the “bulk vs non-bulk” contract clearer.
 */

// -----------------------------------------------------------------------------
// DOM bindings + terminal sizing overlay (purely view concerns)
// -----------------------------------------------------------------------------
const ui = {
  baseUrl: document.getElementById("baseUrl"),
  scan: document.getElementById("scan"),
  sessionSelect: document.getElementById("sessionSelect"),
  tailBytes: document.getElementById("tailBytes"),
  chunkBytes: document.getElementById("chunkBytes"),
  rateBps: document.getElementById("rateBps"),
  play: document.getElementById("play"),
  pause: document.getElementById("pause"),
  reset: document.getElementById("reset"),
  hopNext: document.getElementById("hopNext"),
  status: document.getElementById("status"),
  chunkCanvas: document.getElementById("chunkCanvas"),
  chunkSummary: document.getElementById("chunkSummary"),
  clearChunkGraph: document.getElementById("clearChunkGraph"),
  inputStatus: document.getElementById("inputStatus"),
  inputHoverStatus: document.getElementById("inputHoverStatus"),
  inputLog: document.getElementById("inputLog"),
  inputFollow: document.getElementById("inputFollow"),
  inputInterpretEscapes: document.getElementById("inputInterpretEscapes"),
  inputWindowKiB: document.getElementById("inputWindowKiB"),
  leftPanel: document.getElementById("leftPanel"),
  panelResizer: document.getElementById("panelResizer"),
  seekMode: document.getElementById("seekMode"),
  playbackClock: document.getElementById("playbackClock"),
  playbackSpeedX: document.getElementById("playbackSpeedX"),
  tidxHzCap: document.getElementById("tidxHzCap"),
  scrollbackLines: document.getElementById("scrollbackLines"),
  bulkNoYield: document.getElementById("bulkNoYield"),
  bulkRenderOff: document.getElementById("bulkRenderOff"),
  bulkZeroScrollback: document.getElementById("bulkZeroScrollback"),
  clearInfo: document.getElementById("clearInfo"),
  infoPanel: document.getElementById("infoPanel"),
  terminalTitle: document.getElementById("terminalTitle"),
  terminalStage: document.getElementById("terminalStage"),
  terminalCanvas: document.getElementById("terminalCanvas"),
  terminal: document.getElementById("terminal"),
  fallback: document.getElementById("fallback"),
  meta: document.getElementById("meta"),
  timeScrub: document.getElementById("timeScrub"),
  timeScrubText: document.getElementById("timeScrubText"),
  timeMaxMark: document.getElementById("timeMaxMark"),
  offsetScrub: document.getElementById("offsetScrub"),
  offsetScrubText: document.getElementById("offsetScrubText"),
  offsetMaxMark: document.getElementById("offsetMaxMark"),
  boundsOverlay: document.getElementById("boundsOverlay"),
  boundsLabel: document.getElementById("boundsLabel"),
};

let currentTermSize = null; // { cols, rows }
let currentXterm = null;
let lastMeasuredCellPx = null; // { cellW, cellH }
let suppressBoundsUpdates = false;
let boundsDirty = false;

// Tracks a capture “terminal size” (cols×rows) and sizes the rendering canvas to match.
// This is intentionally separate from xterm’s fit/resize logic: we want to visualize the capture’s geometry.
function setTermSize(cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  currentTermSize = { cols: c, rows: r };
  if (suppressBoundsUpdates) {
    boundsDirty = true;
    return;
  }
  updateTerminalBounds();
}

function measureFallbackCellPx() {
  if (!ui.terminalStage) return null;
  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  probe.style.fontSize = "12px";
  probe.style.lineHeight = "1.0";
  ui.terminalStage.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  if (!rect.width || !rect.height) return null;
  return { cellW: rect.width, cellH: rect.height };
}

function measureXtermCellPx(term) {
  const screen = ui.terminal ? ui.terminal.querySelector(".xterm-screen") : null;
  if (screen && term && Number.isFinite(term.cols) && term.cols > 0 && Number.isFinite(term.rows) && term.rows > 0) {
    const w = screen.offsetWidth;
    const h = screen.offsetHeight;
    if (w > 0 && h > 0) return { cellW: w / term.cols, cellH: h / term.rows };
  }
  return null;
}

function updateTerminalBounds() {
  if (!ui.terminalCanvas || !ui.boundsOverlay || !ui.boundsLabel) return;
  if (suppressBoundsUpdates) {
    boundsDirty = true;
    return;
  }
  if (!currentTermSize) {
    ui.boundsOverlay.hidden = true;
    return;
  }

  let widthPx = null;
  let heightPx = null;

  if (currentXterm) {
    const screen = ui.terminal ? ui.terminal.querySelector(".xterm-screen") : null;
    if (screen && screen.offsetWidth > 0 && screen.offsetHeight > 0) {
      widthPx = screen.offsetWidth;
      heightPx = screen.offsetHeight;
      lastMeasuredCellPx = { cellW: widthPx / currentXterm.cols, cellH: heightPx / currentXterm.rows };
    }
  }

  if (widthPx == null || heightPx == null) {
    const cell = lastMeasuredCellPx || measureFallbackCellPx();
    if (!cell) return;
    lastMeasuredCellPx = cell;
    widthPx = Math.max(1, Math.round(currentTermSize.cols * cell.cellW));
    heightPx = Math.max(1, Math.round(currentTermSize.rows * cell.cellH));
  }

  ui.terminalCanvas.style.width = `${widthPx}px`;
  ui.terminalCanvas.style.height = `${heightPx}px`;
  ui.boundsOverlay.hidden = false;
  ui.boundsLabel.textContent = `${currentTermSize.cols}×${currentTermSize.rows}`;
}

// -----------------------------------------------------------------------------
// Generic utilities (formatting, clamping, rate config)
// -----------------------------------------------------------------------------
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(1)} GiB`;
}

function fmtBytesBigint(bytes) {
  if (typeof bytes !== "bigint") return "?";
  if (bytes < 0n) return "?";
  if (bytes <= BigInt(Number.MAX_SAFE_INTEGER)) return fmtBytes(Number(bytes));
  return `${bytes} B`;
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isXtermAvailable() {
  return typeof window.Terminal === "function";
}

function rateToBytesPerSec() {
  const raw = ui.rateBps && ui.rateBps.value != null ? String(ui.rateBps.value).trim() : "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50_000;
  if (n <= 0) return Number.POSITIVE_INFINITY; // 0 => instant
  return clampInt(n, 1, 1_000_000_000);
}

function fmtRate(bps) {
  if (!Number.isFinite(bps)) return "∞";
  return `${fmtBytes(bps)}/s`;
}

function currentPlaybackConfigNote() {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  if (typeof playbackClock === "string" && playbackClock === "tidx") {
    const cap = clampInt(Number(ui.tidxHzCap?.value ?? 0), 0, 10_000);
    const capNote = cap > 0 ? `render<=${cap}Hz` : "render<=auto";
    return `clock=tidx x=${playbackSpeedX} ${capNote} cap=${fmtBytes(chunkBytes)}/frame`;
  }
  const bps = rateToBytesPerSec();
  return `clock=bytes rate=${fmtRate(bps)} cap=${fmtBytes(chunkBytes)}/frame`;
}

function currentTermSizeNote() {
  if (!currentTermSize) return "";
  return `size=${currentTermSize.cols}×${currentTermSize.rows}`;
}

// Mirror `hexflow` formatting for raw bytes:
// - printable ASCII -> literal character (with an extra space when transitioning from nonprintable->printable)
// - \n, \r, \t -> " \\n"/" \\r"/" \\t"
// - other nonprintables -> " xx" (2-digit lowercase hex)
function isHexflowPrintableByte(b) {
  return b >= 0x20 && b <= 0x7e;
}

function hexflowFormatBytes(u8, { initialLastWasNonprint = false } = {}) {
  if (!(u8 instanceof Uint8Array)) return "";
  let lastWasNonprint = !!initialLastWasNonprint;
  const out = [];
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    const isPrint = isHexflowPrintableByte(c);
    if (isPrint && lastWasNonprint) out.push(" ");
    if (isPrint) {
      out.push(String.fromCharCode(c));
    } else if (c === 0x0a) {
      out.push(" \\n");
    } else if (c === 0x0d) {
      out.push(" \\r");
    } else if (c === 0x09) {
      out.push(" \\t");
    } else {
      out.push(` ${c.toString(16).padStart(2, "0")}`);
    }
    lastWasNonprint = !isPrint;
  }
  return out.join("");
}

// -----------------------------------------------------------------------------
// Chunk perf monitor (canvas graph)
//
// Records the size/frequency of chunks fed into the output sink (xterm.js writes).
// -----------------------------------------------------------------------------
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

class ChunkPerfMonitor {
  constructor({ canvas, summaryEl, windowMs = 6000 } = {}) {
    this.canvas = canvas || null;
    this.summaryEl = summaryEl || null;
    this.windowMs = clampInt(Number(windowMs), 250, 60_000);
    this._bins = 0;
    this._binMs = 0;
    this._head = 0;
    this._lastBinTsMs = null;
    this._bytes = null;
    this._writes = null;
    this._phase = null;
    this._scaleMaxBytes = 1;
    this._last = null;
    this._hover = null; // { x, idx } | null
    this._raf = null;
    this._dpr = 1;
    this._colors = {
      none: cssVar("--muted", "#9aa7b4"),
      playback: cssVar("--good", "#3ddc97"),
      mode1: cssVar("--accent", "#4aa3ff"),
      seek: "#a17cff",
      bulk: cssVar("--bad", "#ff6b6b"),
    };
    this._bg = "#0e1217";

    if (this.canvas) {
      this.canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
      this.canvas.addEventListener("pointerleave", () => this._clearHover());
      this.canvas.addEventListener("pointerdown", (e) => {
        // Allow click+hold without selecting text / dragging the page.
        try {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
        } catch {
          // ignore
        }
      });
    }

    this.resize();
    this.clear();
  }

  get binMs() {
    return this._binMs;
  }

  get bins() {
    return this._bins;
  }

  resize() {
    const c = this.canvas;
    if (!c) return;
    const dpr = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const cssW = Math.max(1, Math.floor(c.clientWidth || c.getBoundingClientRect().width || c.width || 1));
    const cssH = Math.max(1, Math.floor(c.clientHeight || c.getBoundingClientRect().height || c.height || 64));
    const w = Math.max(1, Math.floor(cssW * dpr));
    const h = Math.max(1, Math.floor(cssH * dpr));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    this._dpr = dpr;

    const nextBins = clampInt(cssW, 16, 2400);
    if (nextBins !== this._bins) {
      this._bins = nextBins;
      this._binMs = this.windowMs / Math.max(1, this._bins);
      this._bytes = new Float64Array(this._bins);
      this._writes = new Uint32Array(this._bins);
      this._phase = new Uint8Array(this._bins);
      this._head = 0;
      this._lastBinTsMs = null;
      this._scaleMaxBytes = 1;
      this._last = null;
      this._hover = null;
    } else {
      this._binMs = this.windowMs / Math.max(1, this._bins);
    }

    this._scheduleRender();
  }

  clear() {
    if (this._bytes) this._bytes.fill(0);
    if (this._writes) this._writes.fill(0);
    if (this._phase) this._phase.fill(0);
    this._head = 0;
    this._lastBinTsMs = null;
    this._scaleMaxBytes = 1;
    this._last = null;
    this._hover = null;
    if (this.summaryEl) this.summaryEl.textContent = "No chunks yet.";
    if (this.canvas) this.canvas.title = "";
    this._scheduleRender();
  }

  _pickHoverFromEvent(e) {
    const c = this.canvas;
    if (!c || !this._bins) return null;
    const rect = c.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) return null;
    const xCss = clampInt(Math.floor(e.clientX - rect.left), 0, this._bins - 1);
    const idx = (this._head + 1 + xCss) % this._bins;
    return { x: xCss, idx };
  }

  _onPointerMove(e) {
    if (!this._bytes || !this._writes || !this._phase) return;
    const picked = this._pickHoverFromEvent(e);
    if (!picked) return;
    if (this._hover && this._hover.x === picked.x && this._hover.idx === picked.idx) return;
    this._hover = picked;
    this._scheduleRender();
  }

  _clearHover() {
    if (!this._hover) return;
    this._hover = null;
    if (this.canvas) this.canvas.title = "";
    this._scheduleRender();
  }

  _phaseId(phase) {
    if (phase === "bulk_seek") return 4;
    if (phase === "seek") return 3;
    if (phase === "mode1") return 2;
    if (phase === "playback") return 1;
    return 0;
  }

  _phaseColor(id) {
    if (id === 4) return this._colors.bulk;
    if (id === 3) return this._colors.seek;
    if (id === 2) return this._colors.mode1;
    if (id === 1) return this._colors.playback;
    return this._colors.none;
  }

  _phaseLabel(id) {
    if (id === 4) return "bulk_seek";
    if (id === 3) return "seek";
    if (id === 2) return "mode1";
    if (id === 1) return "playback";
    return "none";
  }

  _advanceTo(tsMs) {
    if (!Number.isFinite(tsMs)) return;
    if (this._lastBinTsMs == null) {
      this._lastBinTsMs = tsMs;
      return;
    }
    const deltaMs = tsMs - this._lastBinTsMs;
    if (deltaMs <= 0) return;
    const steps = Math.floor(deltaMs / this._binMs);
    if (steps <= 0) return;

    if (steps >= this._bins) {
      this._bytes.fill(0);
      this._writes.fill(0);
      this._phase.fill(0);
      this._head = 0;
      this._lastBinTsMs = tsMs;
      return;
    }

    for (let i = 0; i < steps; i++) {
      this._head = (this._head + 1) % this._bins;
      this._bytes[this._head] = 0;
      this._writes[this._head] = 0;
      this._phase[this._head] = 0;
    }
    this._lastBinTsMs += steps * this._binMs;
  }

  record({ tsMs, phase, bytes, chars, absStart, absEnd } = {}) {
    if (!this._bytes || !this._writes || !this._phase) return;
    const b = clampInt(Number(bytes), 0, 1_000_000_000);
    if (b <= 0) return;
    const now = Number.isFinite(tsMs) ? tsMs : performance.now();
    this._advanceTo(now);
    const id = this._phaseId(phase);
    this._bytes[this._head] += b;
    this._writes[this._head] += 1;
    if (id > this._phase[this._head]) this._phase[this._head] = id;
    this._last = {
      tsMs: now,
      phase: typeof phase === "string" ? phase : null,
      bytes: b,
      chars: clampInt(Number(chars), 0, 1_000_000_000),
      absStart: typeof absStart === "bigint" ? absStart : null,
      absEnd: typeof absEnd === "bigint" ? absEnd : null,
    };
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._raf != null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.render();
    });
  }

  render() {
    const c = this.canvas;
    if (!c || !this._bytes || !this._writes || !this._phase) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const barW = Math.max(1, Math.floor(this._dpr));
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, w, h);

    let maxBytes = 1;
    for (let i = 0; i < this._bins; i++) {
      if (this._bytes[i] > maxBytes) maxBytes = this._bytes[i];
    }
    this._scaleMaxBytes = Math.max(maxBytes, Math.floor(this._scaleMaxBytes * 0.95));
    const denom = Math.max(1, this._scaleMaxBytes);
    const denomSqrt = Math.sqrt(denom);

    const hoverX = this._hover ? this._hover.x : null;
    for (let x = 0; x < this._bins; x++) {
      const idx = (this._head + 1 + x) % this._bins; // left=oldest, right=newest
      const b = this._bytes[idx];
      if (b <= 0) continue;
      const y = Math.max(1, Math.round((Math.sqrt(b) / denomSqrt) * h));
      ctx.fillStyle = this._phaseColor(this._phase[idx]);
      ctx.fillRect(x * barW, h - y, barW, y);
      if (hoverX != null && x === hoverX) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(1, Math.floor(this._dpr));
        ctx.strokeRect(x * barW + 0.5, h - y + 0.5, Math.max(1, barW) - 1, Math.max(1, y) - 1);
      }
    }
    if (hoverX != null) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(hoverX * barW, 0, Math.max(1, barW), h);
    }

    // Summary + runtime info.
    const last1sBins = Math.max(1, Math.floor(1000 / this._binMs));
    let bytes1s = 0;
    let writes1s = 0;
    for (let i = 0; i < Math.min(this._bins, last1sBins); i++) {
      const idx = (this._head - i + this._bins) % this._bins;
      bytes1s += this._bytes[idx];
      writes1s += this._writes[idx];
    }

    let bytesWindow = 0;
    let writesWindow = 0;
    for (let i = 0; i < this._bins; i++) {
      bytesWindow += this._bytes[i];
      writesWindow += this._writes[i];
    }

    const nowTs = this._last ? this._last.tsMs : performance.now();

    const last = this._last;
    const lastNote = last ? `last=${fmtBytes(last.bytes)} ${last.phase || ""}`.trim() : "last=?";
    const rateNote = `1s=${fmtRate(bytes1s)} (${writes1s}/s)`;
    const binNote = `bin=${this._binMs.toFixed(1)}ms win=${(this._binMs * this._bins).toFixed(0)}ms`;

    let hoverNote = "";
    let hoverRuntime = null;
    if (this._hover && this._lastBinTsMs != null) {
      const x = this._hover.x;
      const idx = this._hover.idx;
      const b = this._bytes[idx] || 0;
      const writes = this._writes[idx] || 0;
      const phaseId = this._phase[idx] || 0;
      const binStart = this._lastBinTsMs - (this._bins - 1 - x) * this._binMs;
      const binEnd = binStart + this._binMs;
      const ageStart = nowTs - binStart;
      const ageEnd = nowTs - binEnd;
      const phase = this._phaseLabel(phaseId);
      hoverNote = `hover=t-${Math.max(0, ageStart).toFixed(0)}..${Math.max(0, ageEnd).toFixed(0)}ms bytes=${fmtBytes(b)} writes=${writes} phase=${phase}`;
      hoverRuntime = {
        x,
        binStartMsAgo: Math.max(0, ageStart),
        binEndMsAgo: Math.max(0, ageEnd),
        bytes: b,
        writes,
        phase,
      };
      if (this.canvas) this.canvas.title = hoverNote;
    } else if (this.canvas && this.canvas.title) {
      this.canvas.title = "";
    }

    const summary = hoverNote
      ? `${hoverNote} • ${rateNote} • window=${fmtBytes(bytesWindow)} (${writesWindow} writes) • ${binNote}`
      : `${lastNote} • ${rateNote} • window=${fmtBytes(bytesWindow)} (${writesWindow} writes) • ${binNote}`;
    if (this.summaryEl) this.summaryEl.textContent = summary;

    perfInfo.runtime.chunks = {
      windowMs: Math.round(this._binMs * this._bins),
      binMs: this._binMs,
      bins: this._bins,
      scaleMaxBytes: this._scaleMaxBytes,
      last: last
        ? {
            tsMs: last.tsMs,
            phase: last.phase,
            bytes: last.bytes,
            chars: last.chars,
            absStart: typeof last.absStart === "bigint" ? String(last.absStart) : null,
            absEnd: typeof last.absEnd === "bigint" ? String(last.absEnd) : null,
          }
        : null,
      hover: hoverRuntime,
      last1s: {
        bytes: bytes1s,
        writes: writes1s,
        bytesPerSec: bytes1s,
        writesPerSec: writes1s,
      },
      window: {
        bytes: bytesWindow,
        writes: writesWindow,
      },
    };
    renderInfoThrottled();
  }
}

// -----------------------------------------------------------------------------
// OutputPlayer: core replay engine (bytes -> decoded text -> sink.write)
//
// This class is intentionally UI-agnostic:
// - It knows nothing about DOM, selects, or status messaging.
// - It optionally consumes a resize-event stream (TCAP sidecars) to call back into the viewer on resizes.
//
// Refactor candidate: move to `web/viewer/player.js` and unit test it with a fake sink.
// -----------------------------------------------------------------------------
class OutputPlayer {
  constructor({ write, reset, onProgress, onChunk } = {}) {
    this._write = write;
    this._reset = reset;
    this._onProgress = onProgress;
    this._onChunk = typeof onChunk === "function" ? onChunk : null;
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._buf = null;
    this._offset = 0;
    this._baseOffset = 0n;
    this._raf = null;
    this._playing = false;
    this._speedBps = 500_000;
    this._chunkBytes = 32_768;
    this._lastTs = 0;
    this._carryBytes = 0;
    this._events = null;
    this._eventIndex = 0;
    this._onEvent = null;
    this._clockMode = "bytes"; // "bytes" | "tidx"
    this._clockSpeedX = 1.0;
    this._clockTidx = null;
    this._clockTimeNs = null;
    this._rafAvgMs = null;
    this._tidxEmitHzCap = 0;
    this._tidxSinceEmitMs = 0;
    this._chunkPhase = null;
  }

  hasLoaded() {
    return !!this._buf;
  }

  isPlaying() {
    return !!this._playing;
  }

  bytesTotal() {
    return this._buf ? this._buf.length : 0;
  }

  bytesOffset() {
    return this._offset;
  }

  // Replace the currently loaded byte buffer and reset playback state back to 0.
  // `baseOffset` is the absolute stream offset that corresponds to local offset 0 (tail loads use this).
  load(u8, { baseOffset = 0 } = {}) {
    this.stop();
    this._reset();
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._buf = u8;
    this._offset = 0;
    this._baseOffset = BigInt(baseOffset);
    this._lastTs = 0;
    this._carryBytes = 0;
    this._clockTimeNs = null;
    this._eventIndex = 0;
    this._applyEventsAtAbsOffset(this._baseOffset);
    this._emitProgress(0);
  }

  configure({ speedBps, chunkBytes, clockMode, clockSpeedX, clockTidx, tidxEmitHzCap } = {}) {
    this._speedBps = speedBps;
    this._chunkBytes = chunkBytes;
    if (clockMode === "bytes" || clockMode === "tidx") this._clockMode = clockMode;
    if (Number.isFinite(clockSpeedX)) this._clockSpeedX = Math.max(0, Number(clockSpeedX));
    this._clockTidx = clockTidx || null;
    if (Number.isFinite(tidxEmitHzCap)) this._tidxEmitHzCap = clampInt(Number(tidxEmitHzCap), 0, 10_000);
  }

  stop() {
    this._playing = false;
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  play() {
    if (!this._buf) return;
    if (this._playing) return;
    this._playing = true;
    this._lastTs = performance.now();
    this._carryBytes = 0;
    this._tidxSinceEmitMs = 0;
    if (this._clockMode === "tidx" && this._clockTidx) {
      const abs = this._baseOffset + BigInt(this._offset);
      this._clockTimeNs = timeAtOffsetNs(this._clockTidx, abs);
    } else {
      this._clockTimeNs = null;
    }
    this._raf = requestAnimationFrame((ts) => this._tick(ts));
  }

  pause() {
    this.stop();
  }

  reset() {
    if (!this._buf) return;
    this.stop();
    this._reset();
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._offset = 0;
    this._carryBytes = 0;
    this._clockTimeNs = null;
    this._eventIndex = 0;
    if (this._events && this._onEvent) {
      const initial = lastResizeBeforeOffset(this._events, this._baseOffset);
      if (initial) this._onEvent(initial);

      while (
        this._eventIndex < this._events.length &&
        BigInt(this._events[this._eventIndex].streamOffset ?? 0n) < this._baseOffset
      ) {
        this._eventIndex++;
      }
      this._applyEventsAtAbsOffset(this._baseOffset);
    }
    this._emitProgress(0);
  }

  // Full recompute seek: resets state and replays from local offset 0 up to `targetOffset`.
  // - Default behavior yields periodically to keep the UI responsive.
  // - Bulk seeks can disable yielding by passing `yieldEveryMs: null`.
  async seekToLocalOffset(targetOffset, { yieldEveryMs = 12, phase = null } = {}) {
    if (!this._buf) return;
    const target = clampInt(Number(targetOffset), 0, this._buf.length);

    this.stop();
    this._reset();
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._offset = 0;
    this._carryBytes = 0;
    this._eventIndex = 0;
    if (this._events && this._onEvent) {
      const initial = lastResizeBeforeOffset(this._events, this._baseOffset);
      if (initial) this._onEvent(initial);

      while (
        this._eventIndex < this._events.length &&
        BigInt(this._events[this._eventIndex].streamOffset ?? 0n) < this._baseOffset
      ) {
        this._eventIndex++;
      }
      this._applyEventsAtAbsOffset(this._baseOffset);
    }
    this._emitProgress(0);

    const shouldYield = Number.isFinite(yieldEveryMs) && yieldEveryMs > 0;
    let lastYield = shouldYield ? performance.now() : 0;

    const prevPhase = this._chunkPhase;
    this._chunkPhase = phase || (shouldYield ? "seek" : "bulk_seek");
    try {
      while (this._offset < target) {
        const start = this._offset;
        const end = Math.min(target, start + this._chunkBytes);
        this._offset = end;
        this._writeBytesWithResizeEvents(start, end);
        this._emitProgress(end - start);

        if (shouldYield) {
          const now = performance.now();
          if (now - lastYield >= yieldEveryMs) {
            lastYield = now;
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          }
        }
      }
    } finally {
      this._chunkPhase = prevPhase;
    }
  }

  // Incremental seek: advances forward from the *current* offset to `targetOffset`.
  // Used by seek mode 1 (drag-right evaluation); never rewinds (drag-left does no work).
  async advanceToLocalOffset(targetOffset, { yieldEveryMs = 12, phase = "mode1" } = {}) {
    if (!this._buf) return;
    const target = clampInt(Number(targetOffset), 0, this._buf.length);
    if (target <= this._offset) return;

    // Ensure playback RAF isn't running, but keep the current terminal/decoder state.
    this.stop();

    const prevPhase = this._chunkPhase;
    this._chunkPhase = phase || "mode1";
    try {
      let lastYield = performance.now();
      while (this._offset < target) {
        const start = this._offset;
        const end = Math.min(target, start + this._chunkBytes);
        this._offset = end;
        this._writeBytesWithResizeEvents(start, end);
        this._emitProgress(end - start);

        const now = performance.now();
        if (now - lastYield >= yieldEveryMs) {
          lastYield = now;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
      }
    } finally {
      this._chunkPhase = prevPhase;
    }

    if (this._offset >= this._buf.length) {
      const flush = this._decoder.decode(new Uint8Array(), { stream: false });
      if (flush) this._write(flush);
    }
  }

  setEvents(events, { onEvent } = {}) {
    this._events = Array.isArray(events) ? events : null;
    this._onEvent = typeof onEvent === "function" ? onEvent : null;
    this._eventIndex = 0;

    if (this._events && this._onEvent) {
      const initial = lastResizeBeforeOffset(this._events, this._baseOffset);
      if (initial) this._onEvent(initial);

      while (
        this._eventIndex < this._events.length &&
        BigInt(this._events[this._eventIndex].streamOffset ?? 0n) < this._baseOffset
      ) {
        this._eventIndex++;
      }
      this._applyEventsAtAbsOffset(this._baseOffset);
    }
  }

  _applyEventsAtAbsOffset(absOffset) {
    if (!this._events || !this._onEvent) return;
    while (this._eventIndex < this._events.length) {
      const ev = this._events[this._eventIndex];
      if (!ev || ev.type !== "resize") {
        this._eventIndex++;
        continue;
      }
      const off = BigInt(ev.streamOffset ?? 0n);
      if (off !== absOffset) break;
      this._onEvent(ev);
      this._eventIndex++;
    }
  }

  _emitProgress(extraBytesWritten, extra = {}) {
    if (!this._buf) return;
    this._onProgress({
      offset: this._offset,
      total: this._buf.length,
      extraBytesWritten,
      done: this._offset >= this._buf.length,
      ...extra,
    });
  }

  _estimateRaf(dtMs) {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 1000) return;
    // EMA to smooth out jitter; good enough for diagnostics / coarse quantization.
    this._rafAvgMs = this._rafAvgMs == null ? dtMs : this._rafAvgMs * 0.9 + dtMs * 0.1;
  }

  _tidxNextAfterAbsOffset(absOffset) {
    const tidx = this._clockTidx;
    if (!tidx || !Array.isArray(tidx.endOffsets) || !tidx.endOffsets.length) return null;
    const arr = tidx.endOffsets;
    const last = BigInt(arr[arr.length - 1] ?? 0n);
    const off = absOffset + 1n;
    if (off > last) return null;

    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (BigInt(arr[mid]) >= off) hi = mid;
      else lo = mid + 1;
    }
    return {
      index: lo,
      absOffset: BigInt(arr[lo] ?? 0n),
      timeNs: BigInt(tidx.tNs[lo] ?? 0n),
    };
  }

  _tick(ts) {
    if (!this._playing || !this._buf) return;

    this._chunkPhase = "playback";
    const dtMs = Math.max(0, ts - this._lastTs);
    this._lastTs = ts;
    this._estimateRaf(dtMs);

    let end = null;
    if (this._clockMode === "tidx" && this._clockTidx && this._clockTimeNs != null) {
      const deltaNs = BigInt(Math.floor(dtMs * 1_000_000 * this._clockSpeedX));
      const targetTimeNs = this._clockTimeNs + (deltaNs >= 0n ? deltaNs : 0n);
      this._clockTimeNs = targetTimeNs;

      const targetAbs = offsetAtTimeNs(this._clockTidx, targetTimeNs);
      const currentAbs = this._baseOffset + BigInt(this._offset);
      const targetLocalBig = targetAbs - this._baseOffset;
      const targetLocal = Number(targetLocalBig >= 0n ? targetLocalBig : 0n);
      const desired = clampInt(targetLocal, 0, this._buf.length);

      const rafHz = this._rafAvgMs && this._rafAvgMs > 0 ? 1000 / this._rafAvgMs : null;
      const baseEmitMs = this._rafAvgMs || 16.667;
      const capMs = this._tidxEmitHzCap > 0 ? 1000 / this._tidxEmitHzCap : baseEmitMs;
      const effectiveEmitMs = Math.max(baseEmitMs, capMs);

      const next = this._tidxNextAfterAbsOffset(currentAbs);
      let idle = null;
      if (targetAbs === currentAbs && next) {
        const startNs = timeAtOffsetNs(this._clockTidx, currentAbs);
        const totalNs = next.timeNs > startNs ? next.timeNs - startNs : 0n;
        const elapsedNs = this._clockTimeNs > startNs ? this._clockTimeNs - startNs : 0n;
        const untilNextNs = next.timeNs > this._clockTimeNs ? next.timeNs - this._clockTimeNs : 0n;
        const permille = totalNs > 0n ? Number((elapsedNs * 1000n) / totalNs) : 0;
        idle = {
          startNs,
          nextTimeNs: next.timeNs,
          nextAbsOffset: next.absOffset,
          elapsedNs,
          totalNs,
          untilNextNs,
          progress01: permille / 1000,
        };
      }

      const hasBytesAvailable = desired > this._offset;
      this._tidxSinceEmitMs += dtMs;

      const shouldWrite = hasBytesAvailable && this._tidxSinceEmitMs >= effectiveEmitMs;
      if (!shouldWrite) {
        this._emitProgress(0, {
          clock: { mode: "tidx", timeNs: this._clockTimeNs, speedX: this._clockSpeedX },
          raf: { avgMs: this._rafAvgMs, hz: rafHz },
          tidx: {
            desiredAbs: targetAbs,
            currentAbs,
            effectiveEmitMs,
            sinceEmitMs: this._tidxSinceEmitMs,
            emitHzCap: this._tidxEmitHzCap,
            idle,
          },
        });
        this._raf = requestAnimationFrame((nextTs) => this._tick(nextTs));
        return;
      }

      this._tidxSinceEmitMs = 0;
      end = Math.min(desired, this._offset + this._chunkBytes);
    } else {
      let budget = this._chunkBytes;
      if (Number.isFinite(this._speedBps)) {
        this._carryBytes += (this._speedBps * dtMs) / 1000;
        const whole = Math.floor(this._carryBytes);
        if (whole <= 0) {
          this._raf = requestAnimationFrame((nextTs) => this._tick(nextTs));
          return;
        }

        this._carryBytes -= whole;
        budget = clampInt(whole, 1, this._chunkBytes);
      } else {
        budget = this._chunkBytes;
      }
      end = Math.min(this._buf.length, this._offset + budget);
    }

    const start = this._offset;
    this._offset = end;

    this._writeBytesWithResizeEvents(start, end);

    if (this._offset >= this._buf.length) {
      const flush = this._decoder.decode(new Uint8Array(), { stream: false });
      if (flush) this._write(flush);
      this._emitProgress(this._offset - start);
      this.stop();
      return;
    }

    if (this._clockMode === "tidx" && this._clockTidx && this._clockTimeNs != null) {
      const rafHz = this._rafAvgMs && this._rafAvgMs > 0 ? 1000 / this._rafAvgMs : null;
      const baseEmitMs = this._rafAvgMs || 16.667;
      const capMs = this._tidxEmitHzCap > 0 ? 1000 / this._tidxEmitHzCap : baseEmitMs;
      const effectiveEmitMs = Math.max(baseEmitMs, capMs);
      const currentAbs = this._baseOffset + BigInt(this._offset);
      const desiredAbs = offsetAtTimeNs(this._clockTidx, this._clockTimeNs);
      const next = this._tidxNextAfterAbsOffset(currentAbs);
      let idle = null;
      if (desiredAbs === currentAbs && next) {
        const startNs = timeAtOffsetNs(this._clockTidx, currentAbs);
        const totalNs = next.timeNs > startNs ? next.timeNs - startNs : 0n;
        const elapsedNs = this._clockTimeNs > startNs ? this._clockTimeNs - startNs : 0n;
        const untilNextNs = next.timeNs > this._clockTimeNs ? next.timeNs - this._clockTimeNs : 0n;
        const permille = totalNs > 0n ? Number((elapsedNs * 1000n) / totalNs) : 0;
        idle = {
          startNs,
          nextTimeNs: next.timeNs,
          nextAbsOffset: next.absOffset,
          elapsedNs,
          totalNs,
          untilNextNs,
          progress01: permille / 1000,
        };
      }
      this._emitProgress(this._offset - start, {
        clock: { mode: "tidx", timeNs: this._clockTimeNs, speedX: this._clockSpeedX },
        raf: { avgMs: this._rafAvgMs, hz: rafHz },
        tidx: {
          desiredAbs,
          currentAbs,
          effectiveEmitMs,
          sinceEmitMs: this._tidxSinceEmitMs,
          emitHzCap: this._tidxEmitHzCap,
          idle,
        },
      });
    } else {
      this._emitProgress(this._offset - start);
    }
    this._raf = requestAnimationFrame((nextTs) => this._tick(nextTs));
  }

  _writeBytesWithResizeEvents(start, end) {
    if (!this._buf) return;
    if (!this._events || !this._onEvent) {
      const chunk = this._buf.subarray(start, end);
      const text = this._decoder.decode(chunk, { stream: true });
      if (text) {
        if (this._onChunk) {
          this._onChunk({
            tsMs: performance.now(),
            phase: this._chunkPhase,
            bytes: chunk.length,
            chars: text.length,
            absStart: this._baseOffset + BigInt(start),
            absEnd: this._baseOffset + BigInt(end),
          });
        }
        this._write(text);
      }
      return;
    }

    let cursor = start;
    while (cursor < end) {
      const cursorAbs = this._baseOffset + BigInt(cursor);
      while (this._eventIndex < this._events.length) {
        const ev = this._events[this._eventIndex];
        const off = BigInt(ev && ev.streamOffset != null ? ev.streamOffset : 0n);
        if (off >= cursorAbs) break;
        this._onEvent(ev);
        this._eventIndex++;
      }
      this._applyEventsAtAbsOffset(cursorAbs);

      const nextEvAbs =
        this._eventIndex < this._events.length ? BigInt(this._events[this._eventIndex].streamOffset ?? 0n) : null;
      let cut = end;
      if (nextEvAbs != null) {
        if (nextEvAbs > cursorAbs) {
          const nextLocal = Number(nextEvAbs - this._baseOffset);
          if (Number.isFinite(nextLocal) && nextLocal > cursor && nextLocal < end) cut = nextLocal;
        } else {
          continue;
        }
      }

      if (cut <= cursor) break;
      const chunk = this._buf.subarray(cursor, cut);
      cursor = cut;
      const text = this._decoder.decode(chunk, { stream: true });
      if (text) {
        if (this._onChunk) {
          this._onChunk({
            tsMs: performance.now(),
            phase: this._chunkPhase,
            bytes: chunk.length,
            chars: text.length,
            absStart: this._baseOffset + BigInt(cursor - chunk.length),
            absEnd: this._baseOffset + BigInt(cursor),
          });
        }
        this._write(text);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Sink: abstracts xterm.js vs a simple <pre> fallback.
//
// Responsibilities:
// - Provide a `write(string)` method used by OutputPlayer.
// - Provide `reset()` and `resize(cols, rows)` for seek/playback resets and TCAP resize events.
// - Provide `flush()` for "bulk seek" mode: we hide rendering and then wait for xterm to finish
//   processing its internal write buffer before making the terminal visible again.
//
// Refactor candidate: move to `web/viewer/sink.js` and return `{ sink, term }`.
// -----------------------------------------------------------------------------
function createSink() {
  if (isXtermAvailable()) {
    const term = new window.Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.0,
      scrollback: 10000,
    });

    ui.fallback.hidden = true;
    ui.terminal.hidden = false;
    ui.terminal.innerHTML = "";
    term.open(ui.terminal);
    term.focus();
    currentXterm = term;
    // Defer measurement until xterm has had a chance to render.
    requestAnimationFrame(() => updateTerminalBounds());

    // For debugging in devtools.
    window.__TERM_CAPTURE_XTERM_TERM = term;

    // xterm.write() is async (buffered). For bulk no-yield seeks, it can be useful to force synchronous processing
    // so that the timing reflects actual terminal evaluation (not queued work that drains afterward).
    //
    // This uses private xterm internals when available; it is best-effort and safe to fall back to async write.
    const writeAsync = (s) => term.write(s);
    const tryWriteSync = (s) => {
      const t = term;
      const core = t && typeof t === "object" ? (t._core || t._coreTerminal || t._coreService || null) : null;
      const wb =
        core && typeof core === "object"
          ? core.writeBuffer || core._writeBuffer || (core._core && core._core.writeBuffer) || null
          : null;
      if (wb && typeof wb.writeSync === "function") {
        wb.writeSync(String(s));
        return true;
      }
      return false;
    };
    const supportsWriteSync = (() => {
      try {
        return tryWriteSync("");
      } catch {
        return false;
      }
    })();

    let writeImpl = writeAsync;

    return {
      kind: "xterm",
      supportsWriteSync,
      setWriteMode: (mode) => {
        if (mode === "sync" && supportsWriteSync) {
          writeImpl = (s) => {
            if (!tryWriteSync(s)) writeAsync(s);
          };
          return;
        }
        writeImpl = writeAsync;
      },
      write: (s) => writeImpl(s),
      flush: () =>
        new Promise((resolve) => {
          term.write("", () => resolve());
        }),
      reset: () => term.reset(),
      resize: (cols, rows) => {
        setTermSize(cols, rows);
        term.resize(cols, rows);
        requestAnimationFrame(() => updateTerminalBounds());
      },
    };
  }

  ui.terminal.hidden = true;
  ui.terminal.innerHTML = "";
  ui.fallback.hidden = false;
  ui.fallback.textContent = "";
  currentXterm = null;

  return {
    kind: "pre",
    write: (s) => {
      ui.fallback.textContent += s;
      ui.fallback.scrollTop = ui.fallback.scrollHeight;
    },
    supportsWriteSync: false,
    setWriteMode: (_mode) => {},
    flush: async () => {},
    reset: () => {
      ui.fallback.textContent = "";
    },
    resize: (cols, rows) => setTermSize(cols, rows),
  };
}

// -----------------------------------------------------------------------------
// Viewer session state
//
// Notes:
// - `sink` + `player` are effectively the "runtime". We recreate them on each loadBytes() to guarantee a clean
//   terminal state (xterm buffer, decoder stream state, and resize-event cursor).
// - `currentLoadedBaseOffset` is critical when tail-loading: local offset 0 corresponds to absolute offset baseOffset.
// - `currentLoadedAbsSize` is best-effort; URL loads try HEAD content-length, local loads use File.size.
//
// Refactor candidate: collect these into a single `viewerState` object (and group per-kind sources in a map).
// -----------------------------------------------------------------------------
let currentUrl = null;
let scannedSessionsByBase = new Map(); // base -> { base, outputUrl, inputUrl, metaUrl }
let currentSession = null; // { base, outputUrl, inputUrl, metaUrl } | null
let currentSessionMeta = null; // object | null
let sink = createSink();
let currentTcap = null;
let currentLoadedKind = null; // "output" | "input" | null
let currentLoadedBaseOffset = 0;
let currentLoadedAbsSize = null; // number | null, total output size in bytes if known
let currentOutputSource = null; // { type:"url", url } | { type:"file", file } | null
let currentInputSource = null; // { type:"url", url } | { type:"file", file } | null
let loadSeq = 0;
let suppressUiProgress = false;
let chunkMonitor = null; // ChunkPerfMonitor | null

let sessionLoadSeq = 0;
let inputLoadSeq = 0;
let currentInput = {
  name: null,
  size: null,
  baseOffset: 0,
  absSize: null,
  u8: null,
  tidx: null,
  lastAbsOffset: 0n,
  lastTimeNs: null,
  decoder: new TextDecoder("utf-8", { fatal: false }),
};
let inputChipHover = null; // { inputAbs: bigint, timeNs: bigint|null, label: string|null }
let inputChipHoverRaf = null;

let lastInfoRenderAt = 0;
function renderInfoThrottled({ force = false } = {}) {
  if (!ui.infoPanel) return;
  const now = performance.now();
  if (!force && now - lastInfoRenderAt < 250) return;
  lastInfoRenderAt = now;
  renderInfo();
}

function installChunkMonitor() {
  if (!ui.chunkCanvas) return null;
  const monitor = new ChunkPerfMonitor({ canvas: ui.chunkCanvas, summaryEl: ui.chunkSummary, windowMs: 6000 });
  ui.clearChunkGraph?.addEventListener("click", () => monitor.clear());

  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => monitor.resize());
    ro.observe(ui.chunkCanvas);
  } else {
    window.addEventListener("resize", () => monitor.resize());
  }

  monitor.resize();
  return monitor;
}

function updateRuntimeInputInfo() {
  perfInfo.runtime.input = {
    loaded: !!currentInput.u8,
    name: currentInput.name,
    size: currentInput.size,
    baseOffset: currentInput.baseOffset,
    absSize: currentInput.absSize,
    hasTidx: !!currentInput.tidx,
    lastAbsOffset: typeof currentInput.lastAbsOffset === "bigint" ? String(currentInput.lastAbsOffset) : null,
    lastTimeNs: typeof currentInput.lastTimeNs === "bigint" ? fmtNs(currentInput.lastTimeNs) : null,
    follow: inputFollow,
    interpretEscapes: inputInterpretEscapes,
    windowKiB: inputWindowKiB,
  };
}

function updateRuntimeSessionInfo() {
  if (!currentSession) {
    perfInfo.runtime.session = null;
    return;
  }
  const outputName = decodeURIComponent(new URL(currentSession.outputUrl).pathname.split("/").pop() || "output");
  const inputName = decodeURIComponent(new URL(currentSession.inputUrl).pathname.split("/").pop() || "input");
  perfInfo.runtime.session = {
    base: currentSession.base,
    output: outputName,
    input: inputName,
    urls: { output: currentSession.outputUrl, input: currentSession.inputUrl, meta: currentSession.metaUrl },
    meta: currentSessionMeta,
  };
}

// -----------------------------------------------------------------------------
// Input log translation (optional)
//
// When enabled, this pass can condense verbose input escape sequences into compact tokens.
// Start with: xterm SGR mouse reporting (1006): ESC [ < Cb ; Cx ; Cy (M|m)
// -----------------------------------------------------------------------------
function parseAsciiIntFromBytes(u8, i, { max = 1_000_000 } = {}) {
  const len = u8.length;
  let n = 0;
  let j = i;
  while (j < len) {
    const b = u8[j];
    if (b < 48 || b > 57) break;
    n = n * 10 + (b - 48);
    if (n > max) return null;
    j++;
  }
  if (j === i) return null;
  return { n, next: j };
}

function tryParseSgrMouse(u8, i) {
  const len = u8.length;
  if (i + 6 >= len) return null;
  if (u8[i] !== 0x1b) return null; // ESC
  if (u8[i + 1] !== 0x5b) return null; // [
  if (u8[i + 2] !== 0x3c) return null; // <
  let j = i + 3;

  const cbRes = parseAsciiIntFromBytes(u8, j, { max: 4096 });
  if (!cbRes) return null;
  j = cbRes.next;
  if (j >= len || u8[j] !== 0x3b) return null; // ;
  j++;

  const xRes = parseAsciiIntFromBytes(u8, j, { max: 100_000 });
  if (!xRes) return null;
  j = xRes.next;
  if (j >= len || u8[j] !== 0x3b) return null; // ;
  j++;

  const yRes = parseAsciiIntFromBytes(u8, j, { max: 100_000 });
  if (!yRes) return null;
  j = yRes.next;
  if (j >= len) return null;

  const tail = u8[j];
  if (tail !== 0x4d && tail !== 0x6d) return null; // M | m
  j++;

  return {
    kind: "sgr_mouse",
    len: j - i,
    event: { cb: cbRes.n, x: xRes.n, y: yRes.n, up: tail === 0x6d },
  };
}

function findStIndex(u8, start) {
  for (let j = start; j + 1 < u8.length; j++) {
    if (u8[j] === 0x1b && u8[j + 1] === 0x5c) return j; // ESC \
  }
  return null;
}

function bytesToAscii(u8) {
  if (!(u8 instanceof Uint8Array) || !u8.length) return "";
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}

function safeAsciiPreview(s, { max = 80 } = {}) {
  const raw = typeof s === "string" ? s : "";
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function hexToAsciiString(hex) {
  const h = typeof hex === "string" ? hex : "";
  if (h.length % 2 !== 0) return null;
  let out = "";
  for (let i = 0; i < h.length; i += 2) {
    const byte = Number.parseInt(h.slice(i, i + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out += String.fromCharCode(byte);
  }
  return out;
}

function tryParseDecrpm(u8, i) {
  // CSI ? <mode> ; <state> $ y
  const len = u8.length;
  if (i + 7 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b || u8[i + 2] !== 0x3f) return null; // ESC [ ?
  let j = i + 3;
  const modeRes = parseAsciiIntFromBytes(u8, j, { max: 100_000_000 });
  if (!modeRes) return null;
  j = modeRes.next;
  if (j >= len || u8[j] !== 0x3b) return null; // ;
  j++;
  const stateRes = parseAsciiIntFromBytes(u8, j, { max: 9 });
  if (!stateRes) return null;
  j = stateRes.next;
  if (j + 1 >= len || u8[j] !== 0x24 || u8[j + 1] !== 0x79) return null; // $ y
  j += 2;
  return { kind: "decrpm", len: j - i, mode: modeRes.n, state: stateRes.n };
}

function tryParseDa1(u8, i) {
  // CSI ? Ps ; ... c
  const len = u8.length;
  if (i + 4 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b || u8[i + 2] !== 0x3f) return null; // ESC [ ?
  let j = i + 3;
  while (j < len) {
    const b = u8[j];
    if ((b >= 48 && b <= 57) || b === 0x3b) {
      j++;
      continue;
    }
    break;
  }
  if (j >= len || u8[j] !== 0x63) return null; // c
  const params = bytesToAscii(u8.subarray(i + 3, j));
  return { kind: "da1", len: j + 1 - i, params };
}

function tryParseCsiPrivateU(u8, i) {
  // CSI ? Ps u   (often used by kitty keyboard protocol queries/replies)
  const len = u8.length;
  if (i + 4 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b || u8[i + 2] !== 0x3f) return null; // ESC [ ?
  let j = i + 3;
  const ps = parseAsciiIntFromBytes(u8, j, { max: 1_000_000 });
  if (!ps) return null;
  j = ps.next;
  if (j >= len || u8[j] !== 0x75) return null; // u
  return { kind: "csi_private_u", len: j + 1 - i, ps: ps.n };
}

function tryParseKittyKey(u8, i) {
  // kitty keyboard protocol: CSI codepoint ; mods : type u
  const len = u8.length;
  if (i + 7 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b) return null; // ESC [
  let j = i + 2;
  const codeRes = parseAsciiIntFromBytes(u8, j, { max: 0x10ffff });
  if (!codeRes) return null;
  j = codeRes.next;
  if (j >= len || u8[j] !== 0x3b) return null; // ;
  j++;
  const modsRes = parseAsciiIntFromBytes(u8, j, { max: 1_000_000 });
  if (!modsRes) return null;
  j = modsRes.next;
  if (j >= len || u8[j] !== 0x3a) return null; // :
  j++;
  const typeRes = parseAsciiIntFromBytes(u8, j, { max: 32 });
  if (!typeRes) return null;
  j = typeRes.next;
  if (j >= len || u8[j] !== 0x75) return null; // u
  j++;
  return { kind: "kitty_key", len: j - i, codepoint: codeRes.n, mods: modsRes.n, eventType: typeRes.n };
}

function tryParseCsiUKey(u8, i) {
  // CSI codepoint ; mods u
  const len = u8.length;
  if (i + 6 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b) return null; // ESC [
  let j = i + 2;
  const codeRes = parseAsciiIntFromBytes(u8, j, { max: 0x10ffff });
  if (!codeRes) return null;
  j = codeRes.next;
  if (j >= len || u8[j] !== 0x3b) return null; // ;
  j++;
  const modsRes = parseAsciiIntFromBytes(u8, j, { max: 1_000_000 });
  if (!modsRes) return null;
  j = modsRes.next;
  // Must be plain `u`, not kitty's `:...u`.
  if (j < len && u8[j] === 0x3a) return null; // :
  if (j >= len || u8[j] !== 0x75) return null; // u
  j++;
  return { kind: "csi_u_key", len: j - i, codepoint: codeRes.n, mods: modsRes.n };
}

function tryParseCsiWindowOpT(u8, i) {
  // CSI ... t
  const len = u8.length;
  if (i + 4 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b) return null; // ESC [
  let j = i + 2;
  while (j < len) {
    const b = u8[j];
    if ((b >= 48 && b <= 57) || b === 0x3b) {
      j++;
      continue;
    }
    break;
  }
  if (j >= len || u8[j] !== 0x74) return null; // t
  const params = bytesToAscii(u8.subarray(i + 2, j));
  return { kind: "csi_t", len: j + 1 - i, params };
}

function tryParseCsiFocus(u8, i) {
  // CSI I (focus in) or CSI O (focus out)
  const len = u8.length;
  if (i + 2 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5b) return null; // ESC [
  const final = u8[i + 2];
  if (final === 0x49) return { kind: "focus_in", len: 3 };
  if (final === 0x4f) return { kind: "focus_out", len: 3 };
  return null;
}

function tryParseOsc11(u8, i) {
  // OSC 11;... BEL|ST
  const len = u8.length;
  if (i + 5 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x5d) return null; // ESC ]
  if (u8[i + 2] !== 0x31 || u8[i + 3] !== 0x31 || u8[i + 4] !== 0x3b) return null; // "11;"
  const payloadStart = i + 5;
  for (let j = payloadStart; j < len; j++) {
    if (u8[j] === 0x07) {
      const payload = bytesToAscii(u8.subarray(payloadStart, j));
      return { kind: "osc_11", len: j + 1 - i, payload };
    }
    if (u8[j] === 0x1b && j + 1 < len && u8[j + 1] === 0x5c) {
      const payload = bytesToAscii(u8.subarray(payloadStart, j));
      return { kind: "osc_11", len: j + 2 - i, payload };
    }
  }
  return null;
}

function tryParseDcsDecrqssResponse(u8, i) {
  // DCS 1 $ r <string> ST
  const len = u8.length;
  if (i + 6 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x50) return null; // ESC P
  if (u8[i + 2] !== 0x31 || u8[i + 3] !== 0x24 || u8[i + 4] !== 0x72) return null; // "1$r"
  const st = findStIndex(u8, i + 5);
  if (st == null) return null;
  const payload = bytesToAscii(u8.subarray(i + 5, st));
  return { kind: "decrqss", len: st + 2 - i, payload };
}

function tryParseDcsXtgettcapResponse(u8, i) {
  // DCS 1 + r <hex...> ST
  const len = u8.length;
  if (i + 6 >= len) return null;
  if (u8[i] !== 0x1b || u8[i + 1] !== 0x50) return null; // ESC P
  if (u8[i + 2] !== 0x31 || u8[i + 3] !== 0x2b || u8[i + 4] !== 0x72) return null; // "1+r"
  const st = findStIndex(u8, i + 5);
  if (st == null) return null;
  const raw = bytesToAscii(u8.subarray(i + 5, st));
  const items = raw.split(";").filter(Boolean);
  const decoded = [];
  for (const item of items) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const nameHex = item.slice(0, eq);
    const valHex = item.slice(eq + 1);
    const name = hexToAsciiString(nameHex);
    const value = hexToAsciiString(valHex);
    decoded.push({ name, value, nameHex, valHex });
  }
  return { kind: "xtgettcap", len: st + 2 - i, raw, decoded };
}

const INPUT_ESCAPE_PARSERS = [
  tryParseSgrMouse,
  tryParseDecrpm,
  tryParseDa1,
  tryParseOsc11,
  tryParseDcsDecrqssResponse,
  tryParseDcsXtgettcapResponse,
  tryParseCsiFocus,
  tryParseCsiPrivateU,
  tryParseKittyKey,
  tryParseCsiUKey,
  tryParseCsiWindowOpT,
];
const INPUT_TOKEN_CONDENSERS = [condenseDecrpmTokens, condenseSgrMouseTokens];

function sgrMouseButtonLabel(cb) {
  // Best-effort decoding for xterm SGR mouse "Cb".
  const wheel = (cb & 64) !== 0;
  const base = cb & 3;
  if (wheel) {
    if (base === 0) return "WheelUp";
    if (base === 1) return "WheelDown";
    if (base === 2) return "WheelLeft";
    if (base === 3) return "WheelRight";
    return "Wheel";
  }
  if (base === 0) return "L";
  if (base === 1) return "M";
  if (base === 2) return "R";
  return "?";
}

function sgrMouseModsLabel(cb) {
  const mods = [];
  if (cb & 4) mods.push("S");
  if (cb & 8) mods.push("A");
  if (cb & 16) mods.push("C");
  return mods.length ? mods.join("") : "";
}

function condenseSgrMouseTokens(inTokens) {
  const outTokens = [];
  for (let i = 0; i < inTokens.length; i++) {
    const t = inTokens[i];
    if (t.kind !== "macro" || t.type !== "sgr_mouse") {
      outTokens.push(t);
      continue;
    }
    const baseKey = (() => {
      const cb = t.data.cb | 0;
      const btn = cb & 3;
      const mods = cb & (4 | 8 | 16);
      const wheel = cb & (64 | 128);
      return `${btn}|${mods}|${wheel}`;
    })();

    const group = [t];
    let j = i + 1;
    while (j < inTokens.length && inTokens[j].kind === "macro" && inTokens[j].type === "sgr_mouse") {
      const ev = inTokens[j].data;
      const cb = ev.cb | 0;
      const btn = cb & 3;
      const mods = cb & (4 | 8 | 16);
      const wheel = cb & (64 | 128);
      const k = `${btn}|${mods}|${wheel}`;
      if (k !== baseKey) break;
      group.push(inTokens[j]);
      j++;
    }

    const events = group.map((tok) => tok.data);
    const hasMotion = events.some((ev) => (ev.cb & 32) !== 0);
    const isWheel = (events[0].cb & 64) !== 0;

    if (hasMotion && events.length > 1) {
      outTokens.push({
        kind: "macro",
        type: "sgr_mouse_drag",
        events,
        start: group[0].start,
        end: group[group.length - 1].end,
      });
      i = j - 1;
      continue;
    }

    if (isWheel && group.length > 1) {
      // Stack consecutive wheel events of the same direction at the same coordinate.
      let run = [group[0]];
      const flushRun = () => {
        if (!run.length) return;
        if (run.length === 1) {
          outTokens.push(run[0]);
          run = [];
          return;
        }
        const first = run[0].data;
        outTokens.push({
          kind: "macro",
          type: "sgr_wheel_stack",
          data: { ...first, count: run.length },
          start: run[0].start,
          end: run[run.length - 1].end,
        });
        run = [];
      };

      for (let k = 1; k < group.length; k++) {
        const prev = run[run.length - 1].data;
        const cur = group[k].data;
        const same =
          (prev.cb | 0) === (cur.cb | 0) &&
          (prev.x | 0) === (cur.x | 0) &&
          (prev.y | 0) === (cur.y | 0) &&
          !!prev.up === !!cur.up;
        if (!same) {
          flushRun();
          run = [group[k]];
          continue;
        }
        run.push(group[k]);
      }
      flushRun();
      i = j - 1;
      continue;
    }

    // No special condensation; preserve original tokens so click-to-hop stays correct.
    for (const tok of group) outTokens.push(tok);
    i = j - 1;
  }
  return outTokens;
}

function decrpmStateLabel(state) {
  if (state === 1) return "set";
  if (state === 2) return "reset";
  if (state === 3) return "perma-set";
  if (state === 4) return "perma-reset";
  return `state=${state}`;
}

function condenseDecrpmTokens(inTokens) {
  const outTokens = [];
  for (let i = 0; i < inTokens.length; i++) {
    const t = inTokens[i];
    if (t.kind !== "macro" || t.type !== "decrpm") {
      outTokens.push(t);
      continue;
    }
    const state = t.data.state | 0;
    const modes = [t.data.mode | 0];
    let j = i + 1;
    while (j < inTokens.length && inTokens[j].kind === "macro" && inTokens[j].type === "decrpm") {
      const next = inTokens[j].data;
      if ((next.state | 0) !== state) break;
      modes.push(next.mode | 0);
      j++;
    }
    if (modes.length > 1) {
      outTokens.push({
        kind: "macro",
        type: "decrpm_run",
        data: { state, modes },
        start: t.start,
        end: inTokens[j - 1] && inTokens[j - 1].end != null ? inTokens[j - 1].end : t.end,
      });
    } else {
      outTokens.push(t);
    }
    i = j - 1;
  }
  return outTokens;
}

function tokenToDisplayParts(token) {
  if (!token || token.kind !== "macro") return null;
  if (token.type === "sgr_mouse") {
    const ev = token.data;
    const btn = sgrMouseButtonLabel(ev.cb);
    const mods = sgrMouseModsLabel(ev.cb);
    const motion = (ev.cb & 32) !== 0;
    const kind = ev.up ? "up" : motion ? "move" : "down";
    return {
      type: "sgr_mouse",
      label: `mouse ${btn}${mods ? `+${mods}` : ""} (${ev.x},${ev.y}) ${kind}`,
      title: `xterm SGR mouse (1006): ${btn}${mods ? `+${mods}` : ""} ${kind} at (${ev.x},${ev.y}).\nraw: CSI < ${ev.cb} ; ${ev.x} ; ${ev.y} ${ev.up ? "m" : "M"}`,
    };
  }
  if (token.type === "sgr_mouse_drag") {
    const first = token.events[0];
    const lastEv = token.events[token.events.length - 1];
    const btn = sgrMouseButtonLabel(first.cb);
    const mods = sgrMouseModsLabel(first.cb);
    const upNote = lastEv.up ? " up" : "";
    return {
      type: "sgr_mouse_drag",
      label: `mouse drag ${btn}${mods ? `+${mods}` : ""} (${first.x},${first.y})…(${lastEv.x},${lastEv.y}) n=${token.events.length}${upNote}`,
      title: `xterm SGR mouse drag (1006): ${btn}${mods ? `+${mods}` : ""} from (${first.x},${first.y}) to (${lastEv.x},${lastEv.y}) in ${token.events.length} events.${upNote}\nraw: CSI < … M/m (condensed)`,
    };
  }
  if (token.type === "sgr_wheel_stack") {
    const ev = token.data;
    const btn = sgrMouseButtonLabel(ev.cb);
    const mods = sgrMouseModsLabel(ev.cb);
    const count = clampInt(Number(ev.count), 2, 1_000_000);
    const dir = btn.startsWith("Wheel") ? btn.slice("Wheel".length) : btn;
    return {
      type: "sgr_wheel_stack",
      label: `wheel ${dir}${mods ? `+${mods}` : ""} ×${count} (${ev.x},${ev.y})`,
      title: `xterm SGR mouse wheel (1006): ${btn}${mods ? `+${mods}` : ""} repeated ${count}× at (${ev.x},${ev.y}).\nraw: CSI < ${ev.cb} ; ${ev.x} ; ${ev.y} M (stacked)`,
    };
  }
  if (token.type === "decrpm") {
    const mode = token.data.mode;
    const state = token.data.state;
    const stateLabel = decrpmStateLabel(state);
    return {
      type: "decrpm",
      label: `mode ?${mode} ${stateLabel}`,
      title: `DECRPM (Report Mode): private mode ?${mode} is ${stateLabel}.\nraw: CSI ? ${mode} ; ${state} $ y`,
    };
  }
  if (token.type === "decrpm_run") {
    const { state, modes } = token.data || {};
    const stateLabel = decrpmStateLabel(state | 0);
    const preview = Array.isArray(modes) ? modes.slice(0, 6).join(",") : "";
    const more = Array.isArray(modes) && modes.length > 6 ? `,+${modes.length - 6}` : "";
    return {
      type: "decrpm_run",
      label: `modes ${preview}${more} ${stateLabel}`,
      title: `DECRPM run: ${Array.isArray(modes) ? modes.length : "?"} private modes are ${stateLabel}.\nraw: CSI ? … $ y (condensed)`,
    };
  }
  if (token.type === "da1") {
    const params = token.data.params || "";
    return {
      type: "da1",
      label: `DA1 ?${params}c`,
      title: `Primary Device Attributes (DA1): terminal feature ID list.\nraw: CSI ? ${params} c`,
    };
  }
  if (token.type === "osc_11") {
    const payload = token.data.payload || "";
    return {
      type: "osc_11",
      label: `OSC 11 ${safeAsciiPreview(payload, { max: 36 })}`,
      title: `OSC 11: background color report/set.\npayload: ${payload}`,
    };
  }
  if (token.type === "decrqss") {
    const payload = token.data.payload || "";
    return {
      type: "decrqss",
      label: `DECRQSS ${safeAsciiPreview(payload, { max: 36 })}`,
      title: `DECRQSS response: requested status string (often SGR).\nraw: DCS 1 $ r ${payload} ST`,
    };
  }
  if (token.type === "xtgettcap") {
    const decoded = Array.isArray(token.data.decoded) ? token.data.decoded : [];
    const first = decoded[0] || null;
    const name = first && typeof first.name === "string" ? first.name : null;
    const value = first && typeof first.value === "string" ? first.value : null;
    const count = decoded.length;
    const labelName = name || (first ? first.nameHex : "cap");
    const valuePreview = value ? safeAsciiPreview(value, { max: 28 }) : "";
    const countNote = count > 1 ? ` (+${count - 1})` : "";
    return {
      type: "xtgettcap",
      label: `XTGETTCAP ${labelName}${countNote}${valuePreview ? ` ${valuePreview}` : ""}`,
      title:
        count === 1
          ? `XTGETTCAP response: terminal capability ${labelName}.\nvalue: ${value || ""}`
          : `XTGETTCAP response: ${count} terminal capabilities.\nkeys: ${decoded.map((d) => d.name || d.nameHex).join(", ")}`,
    };
  }
  if (token.type === "focus_in" || token.type === "focus_out") {
    return {
      type: token.type,
      label: token.type === "focus_in" ? "focus in" : "focus out",
      title: token.type === "focus_in" ? "Focus In event (focus tracking enabled).\nraw: CSI I" : "Focus Out event (focus tracking enabled).\nraw: CSI O",
    };
  }
  if (token.type === "csi_private_u") {
    const ps = token.data.ps;
    return {
      type: "csi_private_u",
      label: `CSI ?${ps}u`,
      title: `Private CSI ?…u report (keyboard protocol / terminal capability reply).\nraw: CSI ? ${ps} u`,
    };
  }
  if (token.type === "kitty_key") {
    const cp = token.data.codepoint;
    const mods = token.data.mods;
    const et = token.data.eventType;
    const ch = Number.isFinite(cp) && cp >= 32 && cp <= 0x10ffff ? String.fromCodePoint(cp) : null;
    const chLabel = ch && ch !== " " ? ch : ch === " " ? "SPACE" : `U+${cp.toString(16).toUpperCase()}`;
    const typeLabel = et === 1 ? "press" : et === 2 ? "repeat" : et === 3 ? "release" : `type=${et}`;
    return {
      type: "kitty_key",
      label: `key ${chLabel} ${typeLabel} mods=${mods}`,
      title: `Kitty keyboard protocol key event: ${chLabel} (${typeLabel}), mods=${mods}.\nraw: CSI ${cp};${mods}:${et}u`,
    };
  }
  if (token.type === "csi_u_key") {
    const cp = token.data.codepoint;
    const mods = token.data.mods;
    const ch = Number.isFinite(cp) && cp >= 32 && cp <= 0x10ffff ? String.fromCodePoint(cp) : null;
    const chLabel = ch && ch !== " " ? ch : ch === " " ? "SPACE" : `U+${cp.toString(16).toUpperCase()}`;
    const modsLabel = decodeCsiUMods(mods);
    return {
      type: "csi_u_key",
      label: `key ${chLabel} ${modsLabel}`,
      title: `CSI u key event: Unicode codepoint ${cp} with modifiers ${modsLabel}.\nraw: CSI ${cp};${mods}u`,
    };
  }
  if (token.type === "csi_t") {
    const params = token.data.params || "";
    const nums = params
      .split(";")
      .map((p) => (p === "" ? null : Number(p)))
      .filter((n) => Number.isFinite(n));
    if (nums.length >= 3 && nums[0] === 48) {
      const rows = nums[1];
      const cols = nums[2];
      const rest = nums.length > 3 ? ` +${nums.length - 3} more` : "";
      return {
        type: "csi_t",
        label: `term size rows=${rows} cols=${cols}${rest}`,
        title: `xterm window report (CSI … t): rows=${rows}, cols=${cols}.\nraw: CSI ${params} t`,
      };
    }
    return {
      type: "csi_t",
      label: `CSI t ${params}`,
      title: `xterm window ops/report (CSI … t).\nraw: CSI ${params} t`,
    };
  }
  return { type: token.type || "macro", label: token.type || "macro", title: token.type || "macro" };
}

function decodeCsiUMods(mods) {
  // Common xterm-style encoding: 1 + bitmask (Shift=1, Alt=2, Ctrl=4, Meta=8).
  const m = clampInt(Number(mods), 0, 1_000_000);
  if (m <= 1) return "mods=1 (none)";
  const mask = m - 1;
  const parts = [];
  if (mask & 1) parts.push("Shift");
  if (mask & 2) parts.push("Alt");
  if (mask & 4) parts.push("Ctrl");
  if (mask & 8) parts.push("Meta");
  return parts.length ? `mods=${m} (${parts.join("+")})` : `mods=${m}`;
}

function tokenizeInputBytes(u8) {
  const tokens = [];
  let scan = 0;
  let last = 0;
  while (scan < u8.length) {
    if (u8[scan] !== 0x1b) {
      scan++;
      continue;
    }
    let res = null;
    for (const parser of INPUT_ESCAPE_PARSERS) {
      res = parser(u8, scan);
      if (res) break;
    }
    if (!res) {
      scan++;
      continue;
    }
    if (last < scan) tokens.push({ kind: "bytes", start: last, end: scan });
    const token = { kind: "macro", type: res.kind, data: null, start: scan, end: scan + res.len, event: null, events: null };
    if (res.kind === "sgr_mouse") token.data = res.event;
    else if (res.kind === "decrpm") token.data = { mode: res.mode, state: res.state };
    else if (res.kind === "da1") token.data = { params: res.params };
    else if (res.kind === "osc_11") token.data = { payload: res.payload };
    else if (res.kind === "decrqss") token.data = { payload: res.payload };
    else if (res.kind === "xtgettcap") token.data = { raw: res.raw, decoded: res.decoded };
    else if (res.kind === "focus_in" || res.kind === "focus_out") token.data = {};
    else if (res.kind === "csi_private_u") token.data = { ps: res.ps };
    else if (res.kind === "kitty_key") token.data = { codepoint: res.codepoint, mods: res.mods, eventType: res.eventType };
    else if (res.kind === "csi_u_key") token.data = { codepoint: res.codepoint, mods: res.mods };
    else if (res.kind === "csi_t") token.data = { params: res.params };
    else token.data = {};
    tokens.push(token);
    scan += res.len;
    last = scan;
  }
  if (last < u8.length) tokens.push({ kind: "bytes", start: last, end: u8.length });

  let condensed = tokens;
  for (const condense of INPUT_TOKEN_CONDENSERS) condensed = condense(condensed);
  return condensed;
}

function renderInputLogTokensToDom(container, u8, tokens, { initialLastWasNonprint = false } = {}) {
  if (!container) return;
  container.textContent = "";
  const frag = document.createDocumentFragment();
  const windowAbsStartStr = container instanceof HTMLElement ? container.dataset.windowAbsStart : null;
  const windowAbsStart = windowAbsStartStr != null && windowAbsStartStr !== "" ? BigInt(windowAbsStartStr) : 0n;

  let lastWasNonprint = !!initialLastWasNonprint;
  let endedWithSpace = true;

  const appendText = (text) => {
    if (!text) return;
    frag.appendChild(document.createTextNode(text));
    endedWithSpace = /\s$/.test(text);
  };

  const appendChip = (parts, token) => {
    if (!parts) return;
    if (!endedWithSpace) appendText(" ");
    const span = document.createElement("span");
    span.className = `input-chip input-chip--${parts.type}`;
    span.textContent = parts.label;
    if (parts.title) span.title = parts.title;
    if (token && token.start != null) {
      const absStart = windowAbsStart + BigInt(token.start);
      span.dataset.inputAbs = String(absStart);
    }
    frag.appendChild(span);
    appendText(" ");
    endedWithSpace = true;
  };

  for (const t of tokens) {
    if (t.kind === "bytes") {
      const slice = u8.subarray(t.start, t.end);
      const text = hexflowFormatBytes(slice, { initialLastWasNonprint: lastWasNonprint });
      appendText(text);
      if (slice.length) lastWasNonprint = !isHexflowPrintableByte(slice[slice.length - 1]);
      continue;
    }
    if (t.kind === "macro") {
      appendChip(tokenToDisplayParts(t), t);
      lastWasNonprint = false;
      continue;
    }
  }

  container.appendChild(frag);
}

function renderInputLogFromLocalOffset(localOffset, { absOffset = null, timeNs = null } = {}) {
  if (!ui.inputLog) return;
  if (!currentInput.u8) {
    ui.inputLog.textContent = "";
    setInputStatus("No input loaded.");
    setInputHoverStatus("");
    setInputChipHover(null);
    updateRuntimeInputInfo();
    renderInfoThrottled();
    return;
  }

  const fmtAbs = (abs) => {
    if (typeof abs === "bigint") {
      if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) return fmtBytes(Number(abs));
      return `${abs} B`;
    }
    if (Number.isFinite(abs)) return fmtBytes(abs);
    return "?";
  };

  const u8 = currentInput.u8;
  const desiredLocal = Number(localOffset);
  const local = clampInt(desiredLocal, 0, u8.length);
  const clampedToLoaded = Number.isFinite(desiredLocal) && desiredLocal > u8.length;
  const windowBytes = clampInt(inputWindowKiB * 1024, 1, 16 * 1024 * 1024);
  const start = Math.max(0, local - windowBytes);
  const slice = u8.subarray(start, local);
  const initialLastWasNonprint = start > 0 ? !isHexflowPrintableByte(u8[start - 1]) : false;
  if (!inputInterpretEscapes) {
    ui.inputLog.textContent = hexflowFormatBytes(slice, { initialLastWasNonprint });
    ui.inputLog.dataset.windowAbsStart = "";
  } else {
    const tokens = tokenizeInputBytes(slice);
    ui.inputLog.dataset.windowAbsStart = String(BigInt(currentInput.baseOffset || 0) + BigInt(start));
    renderInputLogTokensToDom(ui.inputLog, slice, tokens, { initialLastWasNonprint });
  }
  if (inputFollow) ui.inputLog.scrollTop = ui.inputLog.scrollHeight;

  currentInput.lastAbsOffset = absOffset != null ? BigInt(absOffset) : BigInt(currentInput.baseOffset) + BigInt(local);
  currentInput.lastTimeNs = typeof timeNs === "bigint" ? timeNs : null;
  const absNote =
    absOffset != null ? `off=${fmtAbs(absOffset)}` : `off=${fmtBytes(currentInput.baseOffset + local)}`;
  const timeNote = typeof timeNs === "bigint" ? ` t=${fmtNs(timeNs)}` : "";
  const windowNote = start > 0 ? ` (window ${fmtBytes(slice.length)}; showing tail)` : "";
  const clampNote = clampedToLoaded ? " (outside loaded range; increase Tail or set Tail=0)" : "";
  const modeNote = inputInterpretEscapes ? " mode=interpret" : "";
  setInputStatus(`Input ${absNote}${timeNote}${windowNote}${clampNote}${modeNote}`);

  updateRuntimeInputInfo();
  renderInfoThrottled();
}

function renderInputLogTail() {
  if (!currentInput.u8) {
    renderInputLogFromLocalOffset(0);
    return;
  }
  renderInputLogFromLocalOffset(currentInput.u8.length);
}

function syncInputLogToCurrentOutputOffset() {
  if (!currentInput.tidx) return;
  if (!player || !player.hasLoaded()) return;
  const outputTidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!outputTidx) return;

  const outputAbs = BigInt(currentLoadedBaseOffset || 0) + BigInt(player.bytesOffset());
  const timeNs = timeAtOffsetNs(outputTidx, outputAbs);
  const inputAbs = offsetAtTimeNs(currentInput.tidx, timeNs);
  const base = BigInt(currentInput.baseOffset || 0);
  const localBig = inputAbs - base;
  const local = Number(localBig > 0n ? localBig : 0n);
  if (Number.isFinite(local)) renderInputLogFromLocalOffset(local, { absOffset: inputAbs, timeNs });
}

function onPlaybackProgress({ offset, total, done, clock, raf, tidx }) {
  if (suppressUiProgress) return;

  if (raf) perfInfo.runtime.raf = raf;
  if (clock) perfInfo.runtime.playback.clock = clock;
  if (tidx) perfInfo.runtime.playback.tidx = tidx;

  const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
  let timeNote = "";
  if (clock && clock.mode === "tidx" && typeof clock.timeNs === "bigint") {
    timeNote = ` t=${fmtNs(clock.timeNs)}`;
  } else if (currentTcap && currentTcap.outputTidx) {
    timeNote = ` t=${fmtNs(timeAtOffsetNs(currentTcap.outputTidx, BigInt(currentLoadedBaseOffset || 0) + BigInt(offset)))}`;
  }

  let idleNote = "";
  const idle = tidx && tidx.idle ? tidx.idle : null;
  if (idle && typeof idle.untilNextNs === "bigint" && idle.untilNextNs >= 250_000_000n) {
    const p = Number.isFinite(idle.progress01) ? Math.max(0, Math.min(1, idle.progress01)) : 0;
    idleNote = ` idle=${Math.round(p * 100)}% next+${fmtNs(idle.untilNextNs)}`;
  }

  const sizeNote = currentTermSizeNote();
  ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}${timeNote}${idleNote} ${sizeNote} ${currentPlaybackConfigNote()}`.trim();
  syncScrubbersFromProgress({
    localOffset: offset,
    localTotal: total,
    clockTimeNs: clock && clock.mode === "tidx" ? clock.timeNs : null,
  });

  // If we have both an output time and an input time index, keep the input log synced.
  const outputTidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  const outputAbs = BigInt(currentLoadedBaseOffset || 0) + BigInt(offset);
  const timeNs =
    clock && clock.mode === "tidx" && typeof clock.timeNs === "bigint"
      ? clock.timeNs
      : outputTidx
        ? timeAtOffsetNs(outputTidx, outputAbs)
        : null;
  if (typeof timeNs === "bigint" && currentInput.tidx) {
    const inputAbs = offsetAtTimeNs(currentInput.tidx, timeNs);
    const base = BigInt(currentInput.baseOffset || 0);
    const localBig = inputAbs - base;
    const local = Number(localBig > 0n ? localBig : 0n);
    const lastAbs = typeof currentInput.lastAbsOffset === "bigint" ? currentInput.lastAbsOffset : null;
    if (lastAbs == null || inputAbs !== lastAbs) {
      if (Number.isFinite(local)) renderInputLogFromLocalOffset(local, { absOffset: inputAbs, timeNs });
    }
  }

  updateHopNextUi();
  renderInfoThrottled();
}

let player = new OutputPlayer({
  write: (s) => sink.write(s),
  reset: () => sink.reset(),
  onProgress: onPlaybackProgress,
  onChunk: (info) => {
    if (chunkMonitor) chunkMonitor.record(info);
  },
});

function setStatus(msg, { error = false } = {}) {
  ui.status.textContent = msg;
  ui.status.style.color = error ? "var(--bad)" : "var(--muted)";
}

function setInputStatus(msg, { error = false } = {}) {
  if (!ui.inputStatus) return;
  ui.inputStatus.textContent = msg;
  ui.inputStatus.style.color = error ? "var(--bad)" : "var(--muted)";
}

function setInputHoverStatus(msg) {
  if (!ui.inputHoverStatus) return;
  ui.inputHoverStatus.textContent = msg || "";
}

function currentPlaybackTimeNs() {
  // Prefer the playback clock time when in tidx mode (it advances even while "idle").
  const clock = perfInfo && perfInfo.runtime && perfInfo.runtime.playback ? perfInfo.runtime.playback.clock : null;
  if (clock && clock.mode === "tidx" && typeof clock.timeNs === "bigint") return clock.timeNs;

  const outputTidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!outputTidx) return null;
  const outAbs = BigInt(currentAbsOffset());
  return timeAtOffsetNs(outputTidx, outAbs);
}

function updateInputChipHoverStatus() {
  if (!inputChipHover || !ui.inputHoverStatus) {
    inputChipHoverRaf = null;
    return;
  }
  const nowNs = currentPlaybackTimeNs();
  const tNs = inputChipHover.timeNs;
  if (typeof nowNs !== "bigint" || typeof tNs !== "bigint") {
    setInputHoverStatus("hover: (needs input+output .tidx)");
  } else {
    const deltaNs = nowNs - tNs;
    const sign = deltaNs < 0n ? "-" : "";
    const abs = deltaNs < 0n ? -deltaNs : deltaNs;
    const ms = Number(abs / 1_000_000n);
    const sec = ms / 1000;
    const label = inputChipHover.label ? ` ${inputChipHover.label}` : "";
    setInputHoverStatus(`hover:${label} t=${fmtNs(tNs)} (Δ=${sign}${sec.toFixed(3)}s)`);
  }
  inputChipHoverRaf = requestAnimationFrame(() => updateInputChipHoverStatus());
}

function setInputChipHover(opts) {
  if (!opts || opts.inputAbs == null) {
    inputChipHover = null;
    if (inputChipHoverRaf != null) cancelAnimationFrame(inputChipHoverRaf);
    inputChipHoverRaf = null;
    setInputHoverStatus("");
    return;
  }
  const { inputAbs, label } = opts;
  const abs = typeof inputAbs === "bigint" ? inputAbs : BigInt(String(inputAbs));
  const timeNs = currentInput && currentInput.tidx ? timeAtOffsetNs(currentInput.tidx, abs) : null;
  inputChipHover = { inputAbs: abs, timeNs: typeof timeNs === "bigint" ? timeNs : null, label: label || null };
  if (inputChipHoverRaf == null) inputChipHoverRaf = requestAnimationFrame(() => updateInputChipHoverStatus());
}

function currentAbsOffset() {
  return clampInt(currentLoadedBaseOffset + player.bytesOffset(), 0, Number.MAX_SAFE_INTEGER);
}

function setRangeMark(markEl, rangeEl, value) {
  if (!markEl || !rangeEl) return;
  const min = Number(rangeEl.min || 0);
  const max = Number(rangeEl.max || 0);
  const v = clampInt(Number(value), min, max);
  const denom = Math.max(1, max - min);
  const pct = ((v - min) / denom) * 100;
  markEl.style.left = `${pct}%`;
  markEl.hidden = false;
}

function hideRangeMark(markEl) {
  if (!markEl) return;
  markEl.hidden = true;
}

// -----------------------------------------------------------------------------
// Seek mode 1 (incremental drag-right)
//
// Goals:
// - While dragging *right*, incrementally advance terminal evaluation in real time.
// - While dragging *left*, do nothing (terminal state remains at the farthest evaluated point).
// - On release:
//   - If released at max-drag, no recompute needed.
//   - If released left of max-drag, fall back to a full from-0 recompute seek (bulk seek).
//
// Refactor candidate: this logic + the marker UI could live in `web/viewer/seek_modes.js`.
// -----------------------------------------------------------------------------
function isMode1Enabled() {
  return seekMode === 1;
}

function msAtAbsOffset(absOffset) {
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!tidx || currentLoadedKind !== "output") return 0;
  const ns = timeAtOffsetNs(tidx, BigInt(absOffset));
  return clampInt(Number(ns / 1_000_000n), 0, Number.MAX_SAFE_INTEGER);
}

function absOffsetAtMs(ms) {
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!tidx || currentLoadedKind !== "output") return null;
  const clampedMs = clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER);
  const abs = offsetAtTimeNs(tidx, BigInt(clampedMs) * 1_000_000n);
  const n = Number(abs);
  if (!Number.isFinite(n)) return null;
  return clampInt(n, 0, Number.MAX_SAFE_INTEGER);
}

function mode1UpdateMaxMarks() {
  if (!mode1State.active) return;
  if (ui.offsetScrub && ui.offsetMaxMark && !ui.offsetScrub.disabled) {
    setRangeMark(ui.offsetMaxMark, ui.offsetScrub, mode1State.maxAbs);
  }
  if (ui.timeScrub && ui.timeMaxMark && !ui.timeScrub.disabled) {
    const ms = mode1State.maxMs || msAtAbsOffset(mode1State.maxAbs);
    setRangeMark(ui.timeMaxMark, ui.timeScrub, ms);
  }
}

function mode1BeginGesture(source) {
  if (!isMode1Enabled()) return;
  mode1State.active = true;
  mode1State.source = source;
  mode1State.maxAbs = currentAbsOffset();
  mode1State.maxMs = msAtAbsOffset(mode1State.maxAbs);
  perfInfo.gesture = {
    active: true,
    source,
    maxAbs: mode1State.maxAbs,
    maxMs: mode1State.maxMs,
    releasedAbs: 0,
    fullRecompute: false,
  };
  player.pause();
  mode1UpdateMaxMarks();
  renderInfo();
}

function mode1ObserveTarget({ source, abs, ms }) {
  if (!isMode1Enabled()) return;
  if (!mode1State.active) mode1BeginGesture(source);
  const absClamped = clampInt(Number(abs), 0, Number.MAX_SAFE_INTEGER);
  if (absClamped > mode1State.maxAbs) {
    mode1State.maxAbs = absClamped;
    mode1State.maxMs = source === "time" ? clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER) : msAtAbsOffset(absClamped);
    perfInfo.gesture.maxAbs = mode1State.maxAbs;
    perfInfo.gesture.maxMs = mode1State.maxMs;
    mode1UpdateMaxMarks();
    renderInfo();
    return true;
  }
  return false;
}

async function mode1AdvanceToAbsOffset(absOffset, { source = "scrub" } = {}) {
  if (!player.hasLoaded()) return;
  if (!isMode1Enabled()) return;
  if (currentLoadedBaseOffset > 0) return;
  const abs = clampInt(Number(absOffset), 0, Number.MAX_SAFE_INTEGER);
  const localTarget = Math.max(0, abs - currentLoadedBaseOffset);
  if (localTarget <= player.bytesOffset()) return;

  const seq = mode1State.pumpSeq;
  const startedAt = performance.now();
  await player.advanceToLocalOffset(localTarget, { yieldEveryMs: 8 });
  if (seq !== mode1State.pumpSeq) return;
  const ms = performance.now() - startedAt;

  updateAggStats(perfInfo.incremental, ms, {
    kind: currentLoadedKind,
    source,
    absOffset: abs,
    localOffset: localTarget,
    ms,
  });
  renderInfo();
}

function mode1RequestAdvance(absOffset) {
  if (!isMode1Enabled()) return;
  if (currentLoadedBaseOffset > 0) return;
  const abs = clampInt(Number(absOffset), 0, Number.MAX_SAFE_INTEGER);
  mode1State.pendingAbs = mode1State.pendingAbs == null ? abs : Math.max(mode1State.pendingAbs, abs);
  if (mode1State.pumping) return;

  mode1State.pumping = true;
  const pumpSeq = mode1State.pumpSeq;
  void (async () => {
    try {
      while (mode1State.pendingAbs != null && pumpSeq === mode1State.pumpSeq) {
        const target = mode1State.pendingAbs;
        mode1State.pendingAbs = null;
        // eslint-disable-next-line no-await-in-loop
        await mode1AdvanceToAbsOffset(target, { source: "mode1-drag" });
      }
    } finally {
      if (pumpSeq === mode1State.pumpSeq) mode1State.pumping = false;
    }
  })();
}

async function mode1WaitForIdle() {
  const seq = mode1State.pumpSeq;
  let spins = 0;
  while (seq === mode1State.pumpSeq && (mode1State.pumping || mode1State.pendingAbs != null)) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    if (++spins > 600) break;
  }
}

// -----------------------------------------------------------------------------
// Preferences + debug/perf panel model
//
// - PERSISTED: values in localStorage under PREFS_KEY (base URL, tail/chunk/rate, left panel width, seek mode, etc).
// - RUNTIME-ONLY: perfInfo counters and last timings used to compare seek strategies.
//
// Refactor candidate: move prefs load/save + defaults into `web/viewer/prefs.js`, and perfInfo into `web/viewer/perf.js`.
// -----------------------------------------------------------------------------
const PREFS_KEY = "termplex.web.viewer.prefs.v1";
const perfInfo = {
  seekMode: 0,
  settings: {
    scrollbackLines: 10000,
    bulk: { noYield: true, renderOff: true, zeroScrollback: true },
  },
  runtime: {
    raf: { avgMs: null, hz: null },
    playback: { clock: null, tidx: null },
    input: null,
    session: null,
    chunks: null,
  },
  fullSeek: { count: 0, lastMs: null, minMs: null, maxMs: null, avgMs: null, last: null },
  incremental: { count: 0, lastMs: null, minMs: null, maxMs: null, avgMs: null, last: null },
  gesture: { active: false, source: null, maxAbs: 0, maxMs: 0, releasedAbs: 0, fullRecompute: false },
};
let seekMode = 0; // 0 | 1
let playbackClock = "bytes"; // "bytes" | "tidx"
let playbackSpeedX = 1.0;
let tidxEmitHzCap = 0;
let inputFollow = true;
let inputInterpretEscapes = false;
let inputWindowKiB = 64;
let scrollbackLines = 10000;
let bulkNoYield = true;
let bulkRenderOff = true;
let bulkZeroScrollback = true;
const mode1State = {
  active: false,
  source: null, // "time" | "offset" | null
  maxAbs: 0,
  maxMs: 0,
  pendingAbs: null,
  pumping: false,
  pumpSeq: 0,
};

function resetGestureUi() {
  mode1State.active = false;
  mode1State.source = null;
  mode1State.maxAbs = 0;
  mode1State.maxMs = 0;
  mode1State.pendingAbs = null;
  mode1State.pumping = false;
  mode1State.pumpSeq++;
  hideRangeMark(ui.timeMaxMark);
  hideRangeMark(ui.offsetMaxMark);
  perfInfo.gesture = { active: false, source: null, maxAbs: 0, maxMs: 0, releasedAbs: 0, fullRecompute: false };
  renderInfo();
}

function updateAggStats(agg, ms, last) {
  agg.count++;
  agg.lastMs = ms;
  agg.last = last;
  agg.minMs = agg.minMs == null ? ms : Math.min(agg.minMs, ms);
  agg.maxMs = agg.maxMs == null ? ms : Math.max(agg.maxMs, ms);
  agg.avgMs = agg.avgMs == null ? ms : agg.avgMs + (ms - agg.avgMs) / agg.count;
}

function safeJson(obj) {
  return JSON.stringify(
    obj,
    (_k, v) => {
      if (typeof v === "bigint") return `${v}n`;
      if (typeof v === "number" && !Number.isFinite(v)) return String(v);
      return v;
    },
    2,
  );
}

function yamlNeedsQuotes(s) {
  if (s === "") return true;
  if (/[\n\r]/.test(s)) return false; // handled separately
  // YAML gotchas: leading/trailing whitespace, ":" in ambiguous positions, "#", "-", "{", "}", "[", "]", commas, etc.
  if (/^\s|\s$/.test(s)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (s.includes(": ")) return true;
  if (s.includes("#")) return true;
  if (/^(null|true|false|yes|no|on|off|nan|~)$/i.test(s)) return true;
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return true;
  return false;
}

function yamlScalar(v, indent) {
  if (v == null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return String(v);
  }
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "string") {
    if (v.includes("\n")) {
      const pad = " ".repeat(indent);
      const lines = v.replace(/\r\n/g, "\n").split("\n");
      return `|\n${lines.map((ln) => `${pad}  ${ln}`).join("\n")}`;
    }
    if (!yamlNeedsQuotes(v)) return v;
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}

function safeYaml(obj) {
  const seen = new Set();
  const walk = (v, indent) => {
    if (v == null || typeof v !== "object") return yamlScalar(v, indent);
    if (seen.has(v)) return '"[circular]"';
    seen.add(v);

    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      const lines = [];
      for (const item of v) {
        if (item != null && typeof item === "object") {
          const inner = walk(item, indent + 2);
          const parts = String(inner).split("\n");
          lines.push(`${" ".repeat(indent)}- ${parts[0]}`);
          for (let i = 1; i < parts.length; i++) lines.push(`${" ".repeat(indent + 2)}${parts[i]}`);
        } else {
          lines.push(`${" ".repeat(indent)}- ${yamlScalar(item, indent + 2)}`);
        }
      }
      return lines.join("\n");
    }

    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    const lines = [];
    for (const key of keys) {
      const safeKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
      const val = v[key];
      if (val != null && typeof val === "object") {
        const inner = walk(val, indent + 2);
        lines.push(`${" ".repeat(indent)}${safeKey}:`);
        const parts = String(inner).split("\n");
        for (const p of parts) lines.push(`${" ".repeat(indent + 2)}${p}`);
      } else {
        lines.push(`${" ".repeat(indent)}${safeKey}: ${yamlScalar(val, indent + 2)}`);
      }
    }
    return lines.join("\n");
  };
  return walk(obj, 0);
}

function renderInfo() {
  if (!ui.infoPanel) return;
  perfInfo.seekMode = seekMode;
  perfInfo.settings.scrollbackLines = scrollbackLines;
  perfInfo.settings.bulk = { noYield: bulkNoYield, renderOff: bulkRenderOff, zeroScrollback: bulkZeroScrollback };
  perfInfo.settings.playback = { clock: playbackClock, speedX: playbackSpeedX, tidxEmitHzCap };
  ui.infoPanel.value = safeYaml(perfInfo);
}

function clearPerfInfo() {
  perfInfo.fullSeek = { count: 0, lastMs: null, minMs: null, maxMs: null, avgMs: null, last: null };
  perfInfo.incremental = { count: 0, lastMs: null, minMs: null, maxMs: null, avgMs: null, last: null };
  perfInfo.gesture = { active: false, source: null, maxAbs: 0, maxMs: 0, releasedAbs: 0, fullRecompute: false };
  renderInfo();
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (!prefs || typeof prefs !== "object") return;

    if (typeof prefs.baseUrl === "string" && ui.baseUrl) ui.baseUrl.value = prefs.baseUrl;
    if (typeof prefs.tailBytes === "number" && ui.tailBytes) ui.tailBytes.value = String(prefs.tailBytes);
    if (typeof prefs.chunkBytes === "number" && ui.chunkBytes) ui.chunkBytes.value = String(prefs.chunkBytes);
    if (typeof prefs.rateBps === "number" && ui.rateBps) ui.rateBps.value = String(prefs.rateBps);
    if (typeof prefs.panelWidthPx === "number" && ui.leftPanel) {
      ui.leftPanel.style.width = `${clampInt(prefs.panelWidthPx, 200, 2400)}px`;
    }
    if (typeof prefs.seekMode === "number") {
      seekMode = clampInt(prefs.seekMode, 0, 1);
      if (ui.seekMode) ui.seekMode.value = String(seekMode);
    }
    if (typeof prefs.playbackClock === "string" && (prefs.playbackClock === "bytes" || prefs.playbackClock === "tidx")) {
      playbackClock = prefs.playbackClock;
      if (ui.playbackClock) ui.playbackClock.value = playbackClock;
    }
    if (typeof prefs.playbackSpeedX === "number") {
      const v = Number(prefs.playbackSpeedX);
      playbackSpeedX = Number.isFinite(v) ? Math.max(0, v) : 1.0;
      if (ui.playbackSpeedX) ui.playbackSpeedX.value = String(playbackSpeedX);
    }
    if (typeof prefs.tidxEmitHzCap === "number") {
      tidxEmitHzCap = clampInt(Number(prefs.tidxEmitHzCap), 0, 10_000);
      if (ui.tidxHzCap) ui.tidxHzCap.value = String(tidxEmitHzCap);
    }
    if (typeof prefs.inputFollow === "boolean") {
      inputFollow = prefs.inputFollow;
      if (ui.inputFollow) ui.inputFollow.checked = inputFollow;
    }
    if (typeof prefs.inputInterpretEscapes === "boolean") {
      inputInterpretEscapes = prefs.inputInterpretEscapes;
      if (ui.inputInterpretEscapes) ui.inputInterpretEscapes.checked = inputInterpretEscapes;
    }
    if (typeof prefs.inputWindowKiB === "number") {
      inputWindowKiB = clampInt(Number(prefs.inputWindowKiB), 1, 16 * 1024);
      if (ui.inputWindowKiB) ui.inputWindowKiB.value = String(inputWindowKiB);
    }
    if (typeof prefs.scrollbackLines === "number") {
      scrollbackLines = clampInt(prefs.scrollbackLines, 0, 1_000_000);
      if (ui.scrollbackLines) ui.scrollbackLines.value = String(scrollbackLines);
    }
    if (typeof prefs.bulkNoYield === "boolean") {
      bulkNoYield = prefs.bulkNoYield;
      if (ui.bulkNoYield) ui.bulkNoYield.checked = bulkNoYield;
    }
    if (typeof prefs.bulkRenderOff === "boolean") {
      bulkRenderOff = prefs.bulkRenderOff;
      if (ui.bulkRenderOff) ui.bulkRenderOff.checked = bulkRenderOff;
    }
    if (typeof prefs.bulkZeroScrollback === "boolean") {
      bulkZeroScrollback = prefs.bulkZeroScrollback;
      if (ui.bulkZeroScrollback) ui.bulkZeroScrollback.checked = bulkZeroScrollback;
    }
  } catch {
    // ignore
  }
}

function savePrefs() {
  try {
    const prefs = {
      baseUrl: ui.baseUrl ? String(ui.baseUrl.value || "").trim() : "../",
      tailBytes: clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER),
      chunkBytes: clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024),
      rateBps: clampInt(Number(ui.rateBps.value), 0, 1_000_000_000),
      panelWidthPx: ui.leftPanel ? clampInt(ui.leftPanel.getBoundingClientRect().width, 200, 2400) : undefined,
      seekMode,
      playbackClock,
      playbackSpeedX,
      tidxEmitHzCap,
      inputFollow,
      inputInterpretEscapes,
      inputWindowKiB,
      scrollbackLines,
      bulkNoYield,
      bulkRenderOff,
      bulkZeroScrollback,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// -----------------------------------------------------------------------------
// Left panel UX helpers (resizable sidebar)
//
// Refactor candidate: move to `web/viewer/layout.js` with a small helper that persists width.
// -----------------------------------------------------------------------------
function installPanelResizer() {
  if (!ui.leftPanel || !ui.panelResizer) return;
  const minWidth = 260;

  function clampWidthPx(px) {
    const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.8));
    return clampInt(px, minWidth, maxWidth);
  }

  ui.panelResizer.addEventListener("pointerdown", (e) => {
    if (!ui.leftPanel || !ui.panelResizer) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = ui.leftPanel.getBoundingClientRect().width;
    ui.panelResizer.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      ui.leftPanel.style.width = `${clampWidthPx(startW + dx)}px`;
    };
    const onUp = () => {
      ui.panelResizer.removeEventListener("pointermove", onMove);
      ui.panelResizer.removeEventListener("pointerup", onUp);
      ui.panelResizer.removeEventListener("pointercancel", onUp);
      savePrefs();
    };

    ui.panelResizer.addEventListener("pointermove", onMove);
    ui.panelResizer.addEventListener("pointerup", onUp, { once: true });
    ui.panelResizer.addEventListener("pointercancel", onUp, { once: true });
  });

  // Clamp saved width against current viewport constraints.
  if (ui.leftPanel.style.width) {
    const parsed = Number(String(ui.leftPanel.style.width).replace("px", ""));
    if (Number.isFinite(parsed)) ui.leftPanel.style.width = `${clampWidthPx(parsed)}px`;
  }
}

function xtermSourceNote() {
  const src =
    typeof window.__TERM_CAPTURE_XTERM_SOURCE === "string" ? window.__TERM_CAPTURE_XTERM_SOURCE : null;
  if (!src) return "";
  return ` xterm=${src}`;
}

// xterm-specific knobs used for perf experiments.
// Note: scrollback affects memory/perf; setting it to 0 during bulk seeks is safe for "time-travel" workflows.
function applyScrollbackSetting(lines) {
  if (!currentXterm || typeof currentXterm.setOption !== "function") return;
  currentXterm.setOption("scrollback", clampInt(Number(lines), 0, 1_000_000));
}

// Bulk seek render suppression: we hide the terminal stage while ingesting/recomputing to avoid visible flicker.
// We use `visibility:hidden` (not display:none) to keep layout stable and avoid reflow surprises.
function setTerminalRenderHidden(hidden) {
  if (!ui.terminalStage) return;
  ui.terminalStage.style.visibility = hidden ? "hidden" : "";
}

function updateButtons() {
  const hasLoaded = player.hasLoaded();
  ui.play.disabled = !hasLoaded;
  ui.pause.disabled = !hasLoaded;
  ui.reset.disabled = !hasLoaded;
  updateHopNextUi();
}

function nextTidxAbsOffsetAfter(tidx, absOffset) {
  if (!tidx || typeof tidx !== "object") return null;
  const arr = tidx.endOffsets;
  if (!Array.isArray(arr) || !arr.length) return null;
  let abs = 0n;
  if (typeof absOffset === "bigint") abs = absOffset;
  else abs = BigInt(clampInt(Number(absOffset), 0, Number.MAX_SAFE_INTEGER));
  if (abs < 0n) abs = 0n;
  const off = abs + 1n;

  let lo = 0;
  let hi = arr.length - 1;
  const last = BigInt(arr[hi] ?? 0n);
  if (off > last) return null;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (BigInt(arr[mid]) >= off) hi = mid;
    else lo = mid + 1;
  }
  return BigInt(arr[lo] ?? 0n);
}

let lastHopNextLabel = null;
let lastHopNextTitle = null;
function updateHopNextUi() {
  if (!ui.hopNext) return;
  const hasLoaded = player.hasLoaded();
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!hasLoaded || currentLoadedKind !== "output" || !tidx) {
    ui.hopNext.disabled = true;
    const label = "Hop next";
    const title = "Fast-forward to the next output event (requires output .tidx).";
    if (label !== lastHopNextLabel) ui.hopNext.textContent = label;
    if (title !== lastHopNextTitle) ui.hopNext.title = title;
    lastHopNextLabel = label;
    lastHopNextTitle = title;
    return;
  }

  const currentAbs = BigInt(currentLoadedBaseOffset || 0) + BigInt(player.bytesOffset());
  const nextAbs = nextTidxAbsOffsetAfter(tidx, currentAbs);
  if (nextAbs == null) {
    ui.hopNext.disabled = true;
    const label = "Hop next";
    const title = "Already at the last indexed output offset.";
    if (label !== lastHopNextLabel) ui.hopNext.textContent = label;
    if (title !== lastHopNextTitle) ui.hopNext.title = title;
    lastHopNextLabel = label;
    lastHopNextTitle = title;
    return;
  }

  const bytesDelta = nextAbs - currentAbs;
  const nextTimeNs = timeAtOffsetNs(tidx, nextAbs);
  const clock = perfInfo.runtime.playback.clock;
  const nowTimeNs =
    clock && clock.mode === "tidx" && typeof clock.timeNs === "bigint" ? clock.timeNs : timeAtOffsetNs(tidx, currentAbs);
  const timeDeltaNs = nextTimeNs > nowTimeNs ? nextTimeNs - nowTimeNs : 0n;

  const baseAbs = BigInt(currentLoadedBaseOffset || 0);
  const nextLocalBig = nextAbs - baseAbs;
  const withinLoaded =
    nextLocalBig >= 0n &&
    nextLocalBig <= BigInt(Number.MAX_SAFE_INTEGER) &&
    Number(nextLocalBig) <= player.bytesTotal();

  ui.hopNext.disabled = !withinLoaded;

  const deltaNote = timeDeltaNs > 0n ? ` (+${fmtNs(timeDeltaNs)})` : "";
  const label = `Hop next${deltaNote}`;
  const title = withinLoaded
    ? `Hop forward by ${fmtBytesBigint(bytesDelta)} (${fmtNs(timeDeltaNs)}) to off=${fmtBytesBigint(nextAbs)}.`
    : `Next hop is ${fmtBytesBigint(bytesDelta)} (${fmtNs(timeDeltaNs)}) ahead, but outside the loaded bytes (set Tail=0).`;

  if (label !== lastHopNextLabel) ui.hopNext.textContent = label;
  if (title !== lastHopNextTitle) ui.hopNext.title = title;
  lastHopNextLabel = label;
  lastHopNextTitle = title;
}

// -----------------------------------------------------------------------------
// Scrubbers (time + absolute offset)
//
// Model:
// - Time scrubber is only enabled for OUTPUT when a `.tidx` sidecar is available.
// - Offset scrubber is enabled for OUTPUT and INPUT (absolute bytes in the loaded stream).
// - `syncScrubbersFromProgress()` keeps the sliders consistent during playback, but yields to user input while dragging.
//
// Refactor candidate: group this logic into a `Scrubbers` controller with a small interface:
//   - configure({ kind, tidx, absSize, baseOffset })
//   - onProgress({ absOffset })
//   - onUserRelease({ source, absOffset })
// -----------------------------------------------------------------------------
function setScrubber({ enabled, text, ms, maxMs } = {}) {
  if (!ui.timeScrub || !ui.timeScrubText) return;
  if (Number.isFinite(maxMs)) ui.timeScrub.max = String(Math.max(0, Math.floor(maxMs)));
  if (Number.isFinite(ms)) ui.timeScrub.value = String(Math.max(0, Math.floor(ms)));
  ui.timeScrub.disabled = !enabled;
  if (typeof text === "string") ui.timeScrubText.textContent = text;
}

function setOffsetScrubber({ enabled, text, absOffset, absMax } = {}) {
  if (!ui.offsetScrub || !ui.offsetScrubText) return;
  if (Number.isFinite(absMax)) ui.offsetScrub.max = String(Math.max(0, Math.floor(absMax)));
  if (Number.isFinite(absOffset)) ui.offsetScrub.value = String(Math.max(0, Math.floor(absOffset)));
  ui.offsetScrub.disabled = !enabled;
  if (typeof text === "string") ui.offsetScrubText.textContent = text;
}

function configureTimeScrubber() {
  if (!ui.timeScrub || !ui.timeScrubText) return;

  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!tidx || currentLoadedKind !== "output") {
    setScrubber({ enabled: false, text: "t=?" });
    return;
  }

  const lastNs = tidx.tNs.length ? BigInt(tidx.tNs[tidx.tNs.length - 1]) : 0n;
  const maxMs = Number(lastNs / 1_000_000n);
  if (!Number.isFinite(maxMs) || maxMs < 0) {
    setScrubber({ enabled: false, text: "t=?" });
    return;
  }

  if (currentLoadedBaseOffset > 0) {
    setScrubber({ enabled: false, ms: 0, maxMs, text: `t=0 / ${fmtNs(lastNs)} (tail; set Tail=0)` });
    return;
  }

  setScrubber({ enabled: true, ms: 0, maxMs, text: `t=0 / ${fmtNs(lastNs)}` });
}

function configureOffsetScrubber() {
  if (!ui.offsetScrub || !ui.offsetScrubText) return;

  if ((currentLoadedKind !== "output" && currentLoadedKind !== "input") || !player.hasLoaded()) {
    setOffsetScrubber({ enabled: false, text: "off=?" });
    return;
  }

  const absMax =
    Number.isFinite(currentLoadedAbsSize) && currentLoadedAbsSize != null
      ? currentLoadedAbsSize
      : currentLoadedBaseOffset + player.bytesTotal();

  if (!Number.isFinite(absMax) || absMax < 0) {
    setOffsetScrubber({ enabled: false, text: "off=?" });
    return;
  }

  if (currentLoadedBaseOffset > 0) {
    setOffsetScrubber({ enabled: true, absOffset: currentLoadedBaseOffset, absMax, text: `off=${fmtBytes(currentLoadedBaseOffset)} / ${fmtBytes(absMax)} (tail; seeks reload)` });
    return;
  }

  setOffsetScrubber({ enabled: true, absOffset: 0, absMax, text: `off=0 / ${fmtBytes(absMax)}` });
}

function configureScrubbers() {
  configureTimeScrubber();
  configureOffsetScrubber();
}

let scrubSyncGuard = false;
let scrubUserActive = null; // "time" | "offset" | null

function syncScrubbersFromProgress({ localOffset, localTotal, clockTimeNs } = {}) {
  if (scrubUserActive) return;
  const absOffset = currentLoadedBaseOffset + clampInt(Number(localOffset), 0, Number.MAX_SAFE_INTEGER);
  const absMax =
    Number.isFinite(currentLoadedAbsSize) && currentLoadedAbsSize != null
      ? currentLoadedAbsSize
      : currentLoadedBaseOffset + clampInt(Number(localTotal), 0, Number.MAX_SAFE_INTEGER);

  scrubSyncGuard = true;
  try {
    if (ui.offsetScrub && !ui.offsetScrub.disabled) {
      ui.offsetScrub.value = String(absOffset);
      if (ui.offsetScrubText) {
        const pct = absMax > 0 ? ((absOffset / absMax) * 100).toFixed(1) : "0.0";
        ui.offsetScrubText.textContent = `off=${fmtBytes(absOffset)} / ${fmtBytes(absMax)} (${pct}%)`;
      }
    }

    const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
    if (tidx && ui.timeScrub && !ui.timeScrub.disabled) {
      const tNs = typeof clockTimeNs === "bigint" ? clockTimeNs : timeAtOffsetNs(tidx, BigInt(absOffset));
      const ms = Number(tNs / 1_000_000n);
      if (Number.isFinite(ms)) ui.timeScrub.value = String(clampInt(ms, 0, Number.MAX_SAFE_INTEGER));
      const lastNs = tidx.tNs.length ? BigInt(tidx.tNs[tidx.tNs.length - 1]) : 0n;
      if (ui.timeScrubText) ui.timeScrubText.textContent = `t=${fmtNs(tNs)} / ${fmtNs(lastNs)}`;
    }
  } finally {
    scrubSyncGuard = false;
  }
}

// -----------------------------------------------------------------------------
// Load pipeline: reset runtime + ingest bytes
//
// `setupPlaybackPipeline()` recreates sink+player and applies per-session settings (e.g. scrollback).
// `loadBytes()` is the single choke point after we’ve acquired bytes from either:
//   - Local file: File API + optional tail slicing
//   - URL: HTTP GET + optional Range tailing + optional TCAP sidecars (output only)
// -----------------------------------------------------------------------------
function setupPlaybackPipeline() {
  sink = createSink();
  applyScrollbackSetting(scrollbackLines);
  player = new OutputPlayer({
    write: (s) => sink.write(s),
    reset: () => sink.reset(),
    onProgress: onPlaybackProgress,
    onChunk: (info) => {
      if (chunkMonitor) chunkMonitor.record(info);
    },
  });

  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  const speedBps = rateToBytesPerSec();
  player.configure({
    speedBps,
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
}

function loadBytes({ name, size, startOffset, u8, tcap, kind }) {
  currentTcap = tcap || null;
  currentLoadedKind = kind || null;
  currentLoadedBaseOffset = typeof startOffset === "number" ? startOffset : 0;
  currentLoadedAbsSize = Number.isFinite(size) ? size : null;
  setupPlaybackPipeline();
  if (chunkMonitor) chunkMonitor.clear();
  resetGestureUi();
  if (ui.terminalTitle) ui.terminalTitle.textContent = kind === "input" ? "Input" : "Output";
  if (currentTcap && currentTcap.outputEvents) {
    const initial = lastResizeBeforeOffset(currentTcap.outputEvents, BigInt(startOffset || 0));
    if (initial) setTermSize(initial.cols, initial.rows);
  }

  player.load(u8, { baseOffset: typeof startOffset === "number" ? startOffset : 0 });
  if (currentTcap && currentTcap.outputEvents) {
    player.setEvents(currentTcap.outputEvents, {
      onEvent: (ev) => {
        if (ev.type === "resize") sink.resize(ev.cols, ev.rows);
      },
    });
  }

  configureScrubbers();

  const tailNote = typeof startOffset === "number" && startOffset > 0 ? ` (tail ${fmtBytes(u8.length)})` : "";
  setStatus(
    `Loaded ${name}${tailNote} (${kind || "?"}). Renderer: ${sink.kind === "xterm" ? "xterm.js" : "fallback"}.${xtermSourceNote()}`,
  );
  updateButtons();

  if (!Number.isFinite(rateToBytesPerSec())) {
    player.play();
  }
}

// Local file loader:
// - Respects Tail bytes by slicing the File blob from the end (fast for large captures).
// - Uses `loadSeq` so rapid re-selections can cancel earlier async reads.
async function loadLocalFile(file, { kind, tailBytesOverride = null } = {}) {
  if (!file) return;
  try {
    savePrefs();
    const seq = ++loadSeq;
    const tailBytes =
      tailBytesOverride != null ? clampInt(Number(tailBytesOverride), 0, Number.MAX_SAFE_INTEGER) : clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);
    const fileSize = file.size;
    const start = tailBytes > 0 ? Math.max(0, fileSize - tailBytes) : 0;
    const blob = file.slice(start, fileSize);
    const buf = await blob.arrayBuffer();
    if (seq !== loadSeq) return; // superseded
    loadBytes({
      name: file.name || kind,
      size: fileSize,
      startOffset: start,
      u8: new Uint8Array(buf),
      tcap: null,
      kind,
    });
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
  }
}

async function loadInputLocalFile(file, { tailBytesOverride = null } = {}) {
  if (!file) return;
  try {
    savePrefs();
    const seq = ++inputLoadSeq;
    const tailBytes =
      tailBytesOverride != null
        ? clampInt(Number(tailBytesOverride), 0, Number.MAX_SAFE_INTEGER)
        : clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);
    const fileSize = file.size;
    const start = tailBytes > 0 ? Math.max(0, fileSize - tailBytes) : 0;
    const blob = file.slice(start, fileSize);
    const buf = await blob.arrayBuffer();
    if (seq !== inputLoadSeq) return;
    currentInput = {
      name: file.name || "input",
      size: fileSize,
      baseOffset: start,
      absSize: fileSize,
      u8: new Uint8Array(buf),
      tidx: null,
      lastAbsOffset: 0n,
      lastTimeNs: null,
      decoder: new TextDecoder("utf-8", { fatal: false }),
    };
    currentInputSource = { type: "file", file };
    setInputStatus(`Loaded ${currentInput.name}${start > 0 ? ` (tail ${fmtBytes(currentInput.u8.length)})` : ""}.`);
    renderInputLogTail();
    updateButtons();
  } catch (e) {
    setInputStatus(`Input load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    currentInputSource = null;
    currentInput = {
      name: null,
      size: null,
      baseOffset: 0,
      absSize: null,
      u8: null,
      tidx: null,
      lastAbsOffset: 0n,
      lastTimeNs: null,
      decoder: new TextDecoder("utf-8", { fatal: false }),
    };
    renderInputLogTail();
  }
}

// UI entry point for local files: records "source" (so we can reload with Tail=0 during bulk seeks)
// and then delegates to the async loader.
function pickLocalFile(file, { kind }) {
  currentUrl = null;
  if (kind === "input") {
    if (!file) {
      currentInputSource = null;
      currentInput = {
        name: null,
        size: null,
        baseOffset: 0,
        absSize: null,
        u8: null,
        tidx: null,
        lastAbsOffset: 0n,
        lastTimeNs: null,
        decoder: new TextDecoder("utf-8", { fatal: false }),
      };
      renderInputLogTail();
      updateButtons();
      return;
    }
    setInputStatus(`Selected ${file.name} (${fmtBytes(file.size)}). Loading…`);
    updateButtons();
    currentInputSource = { type: "file", file };
    void loadInputLocalFile(file);
    return;
  }
  if (!file) {
    setStatus("No file loaded.");
    ui.meta.textContent = "";
    updateButtons();
    return;
  }

  setStatus(`Selected ${file.name} (${fmtBytes(file.size)}). Loading…`);
  updateButtons();
  if (kind === "output") currentOutputSource = { type: "file", file };
  void loadLocalFile(file, { kind });
}

ui.fileOutput?.addEventListener("change", () => {
  pickLocalFile(ui.fileOutput.files && ui.fileOutput.files[0] ? ui.fileOutput.files[0] : null, { kind: "output" });
});

ui.fileInput?.addEventListener("change", () => {
  pickLocalFile(ui.fileInput.files && ui.fileInput.files[0] ? ui.fileInput.files[0] : null, { kind: "input" });
});

function isFileDragEvent(e) {
  const types = e && e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
  return types.includes("Files");
}

// Drag/drop support for the topbar Output/Input "field" containers.
// This keeps local-file workflows compact: users can either click the File button or drop a file onto the field.
function installFileDropTarget(el, { kind }) {
  if (!el) return;
  const setActive = (on) => {
    el.classList.toggle("drop-active", !!on);
  };

  el.addEventListener("dragenter", (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    setActive(true);
  });
  el.addEventListener("dragover", (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setActive(true);
  });
  el.addEventListener("dragleave", (e) => {
    const next = e.relatedTarget;
    if (next && next instanceof Node && el.contains(next)) return;
    setActive(false);
  });
  el.addEventListener("drop", (e) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    setActive(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
    pickLocalFile(file, { kind });
  });
}

ui.pickOutputFile?.addEventListener("click", () => {
  if (!ui.fileOutput) return;
  ui.fileOutput.value = "";
  ui.fileOutput.click();
});

ui.pickInputFile?.addEventListener("click", () => {
  if (!ui.fileInput) return;
  ui.fileInput.value = "";
  ui.fileInput.click();
});

installFileDropTarget(ui.outputField, { kind: "output" });
installFileDropTarget(ui.inputField, { kind: "input" });

ui.play.addEventListener("click", () => {
  player.play();
});

ui.pause.addEventListener("click", () => {
  player.pause();
});

ui.reset.addEventListener("click", () => {
  player.reset();
});

ui.hopNext?.addEventListener("click", () => {
  if (currentLoadedKind !== "output") {
    setStatus("Hop next only applies to output playback.", { error: true });
    return;
  }
  if (!player.hasLoaded()) return;
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!tidx) {
    setStatus("Hop next requires a .tidx sidecar (time-based index).", { error: true });
    return;
  }

  const wasPlaying = typeof player.isPlaying === "function" ? player.isPlaying() : false;
  const currentAbs = BigInt(currentAbsOffset());
  const nextAbs = nextTidxAbsOffsetAfter(tidx, currentAbs);
  if (nextAbs == null) {
    setStatus("Hop next: already at the last indexed offset.");
    return;
  }
  const baseAbs = BigInt(currentLoadedBaseOffset || 0);
  const nextLocalBig = nextAbs - baseAbs;
  if (nextLocalBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    setStatus("Hop next: next offset is too large for the current JS buffer model.", { error: true });
    return;
  }
  const nextLocal = Number(nextLocalBig >= 0n ? nextLocalBig : 0n);
  if (!Number.isFinite(nextLocal)) {
    setStatus("Hop next: next offset is out of range.", { error: true });
    return;
  }
  if (nextLocal > player.bytesTotal()) {
    setStatus("Hop next: next event is outside the currently loaded bytes (increase Tail or set Tail=0).", {
      error: true,
    });
    return;
  }

  void (async () => {
    const startedAt = performance.now();
    await player.advanceToLocalOffset(nextLocal, { yieldEveryMs: 8 });
    const ms = performance.now() - startedAt;
    const tNs = timeAtOffsetNs(tidx, nextAbs);
    setStatus(`Hopped to off=${fmtBytesBigint(nextAbs)} (t=${fmtNs(tNs)}) in ${ms.toFixed(1)}ms.`);
    if (wasPlaying) player.play();
    updateHopNextUi();
  })();
});

ui.rateBps.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({
    speedBps: rateToBytesPerSec(),
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
  savePrefs();
});

ui.chunkBytes.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({
    speedBps: rateToBytesPerSec(),
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
  savePrefs();
});

ui.tailBytes.addEventListener("change", () => {
  savePrefs();
});

ui.baseUrl.addEventListener("change", () => {
  savePrefs();
});

function resolvedBaseUrl() {
  const raw = (ui.baseUrl && ui.baseUrl.value ? ui.baseUrl.value : "../").trim() || "../";
  return new URL(raw, window.location.href).toString();
}

// -----------------------------------------------------------------------------
// URL auto-discovery: scan an `http.server` directory listing and populate the Output/Input dropdowns.
//
// This is deliberately “dumb but robust”:
// - It works with both newer table-based and older plain-text directory listings.
// - It tries to annotate entries with last-modified and size when available.
// - For output files, it also detects `*.tidx` and `*.events.jsonl` sidecars.
//
// Refactor candidate: move all listing parsing + scan into `web/viewer/listing_scan.js`.
// -----------------------------------------------------------------------------
function setSelectOptions(selectEl, items, placeholder) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.href;
    opt.textContent = item.label || item.name;
    if (item.title) opt.title = item.title;
    selectEl.appendChild(opt);
  }
  selectEl.value = "";
}

function parsePyHttpServerListingRowMeta(rowEl) {
  const tds = rowEl ? Array.from(rowEl.querySelectorAll("td")) : [];
  if (tds.length < 3) return { lastModifiedText: null, sizeBytes: null };

  const lastModifiedText = (tds[1].textContent || "").trim() || null;
  const sizeText = (tds[2].textContent || "").trim();
  const sizeBytes = /^\d+$/.test(sizeText) ? Number(sizeText) : null;
  return { lastModifiedText, sizeBytes };
}

function parseLegacyListingMeta(anchorEl) {
  // Best-effort parsing for older `http.server` HTML that doesn't render a table.
  // Typically: "<a>name</a>  2025-01-01 12:34  1234"
  const parentText = anchorEl && anchorEl.parentElement ? anchorEl.parentElement.textContent || "" : "";
  const nameText = anchorEl ? anchorEl.textContent || "" : "";
  const rest = parentText.replace(nameText, " ").trim();
  const m = rest.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(\d+)\b/);
  return {
    lastModifiedText: m ? m[1] : null,
    sizeBytes: m ? Number(m[2]) : null,
  };
}

function fmtListingLabel({ name, lastModifiedText, sizeBytes, sidecarNote }) {
  const parts = [name];
  if (lastModifiedText) parts.push(lastModifiedText);
  if (Number.isFinite(sizeBytes)) parts.push(fmtBytes(sizeBytes));
  if (sidecarNote) parts.push(sidecarNote);
  return parts.join(" — ");
}

async function scanHttpServerListing() {
  try {
    currentUrl = resolvedBaseUrl();
    savePrefs();

    const res = await fetch(currentUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${currentUrl} failed: HTTP ${res.status}`);
    const html = await res.text();

    // Python SimpleHTTPServer emits a directory listing HTML page; parse anchor tags + best-effort metadata.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    const links = anchors
      .map((a) => a.getAttribute("href"))
      .filter((href) => href && href !== "../")
      .map((href) => new URL(href, currentUrl));

    const byName = new Map();
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href || href === "../") continue;
      const url = new URL(href, currentUrl);
      if (url.pathname.endsWith("/")) continue;
      const name = decodeURIComponent(url.pathname.split("/").pop() || "");
      const row = a.closest("tr");
      const metaFromTable = row ? parsePyHttpServerListingRowMeta(row) : { lastModifiedText: null, sizeBytes: null };
      const meta =
        metaFromTable.lastModifiedText || metaFromTable.sizeBytes != null ? metaFromTable : parseLegacyListingMeta(a);
      byName.set(name, {
        name,
        href: url.toString(),
        lastModifiedText: meta.lastModifiedText,
        sizeBytes: meta.sizeBytes,
      });
    }

    const nameSet = new Set(Array.from(byName.keys()));

    // Session gating: only list sessions that have all required TCAP artifacts present.
    // Required (v1):
    // - <base>.output + <base>.output.tidx
    // - <base>.input  + <base>.input.tidx
    // - <base>.meta.json
    // - <base>.events.jsonl
    const bases = new Set();
    for (const name of nameSet) {
      if (name.endsWith(".meta.json")) bases.add(name.slice(0, -".meta.json".length));
    }

    const sessions = [];
    for (const base of bases) {
      const metaName = `${base}.meta.json`;
      const eventsName = `${base}.events.jsonl`;
      const outputName = nameSet.has(`${base}.output`) ? `${base}.output` : nameSet.has(`${base}.output.tcap`) ? `${base}.output.tcap` : null;
      const inputName = nameSet.has(`${base}.input`) ? `${base}.input` : nameSet.has(`${base}.input.tcap`) ? `${base}.input.tcap` : null;
      if (!outputName || !inputName) continue;

      const outputTidxName = `${outputName}.tidx`;
      const inputTidxName = `${inputName}.tidx`;
      const ok =
        nameSet.has(metaName) &&
        nameSet.has(eventsName) &&
        nameSet.has(outputName) &&
        nameSet.has(outputTidxName) &&
        nameSet.has(inputName) &&
        nameSet.has(inputTidxName);
      if (!ok) continue;

      const metaInfo = byName.get(metaName) || { name: metaName, lastModifiedText: null, sizeBytes: null };
      const outInfo = byName.get(outputName) || { name: outputName, lastModifiedText: null, sizeBytes: null };
      const inInfo = byName.get(inputName) || { name: inputName, lastModifiedText: null, sizeBytes: null };

      const parts = [base];
      if (metaInfo.lastModifiedText) parts.push(metaInfo.lastModifiedText);
      if (Number.isFinite(outInfo.sizeBytes)) parts.push(`out ${fmtBytes(outInfo.sizeBytes)}`);
      if (Number.isFinite(inInfo.sizeBytes)) parts.push(`in ${fmtBytes(inInfo.sizeBytes)}`);
      const label = parts.join(" — ");

      const titleParts = [
        base,
        metaInfo.lastModifiedText ? `modified: ${metaInfo.lastModifiedText}` : null,
        outputName,
        outputTidxName,
        inputName,
        inputTidxName,
        metaName,
        eventsName,
      ].filter(Boolean);

      sessions.push({
        base,
        href: base,
        label,
        title: titleParts.join("\n"),
        outputUrl: new URL(outputName, currentUrl).toString(),
        inputUrl: new URL(inputName, currentUrl).toString(),
        metaUrl: new URL(metaName, currentUrl).toString(),
      });
    }

    const sortKey = (x) => byName.get(`${x.base}.meta.json`)?.lastModifiedText || "";
    sessions.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.base.localeCompare(b.base));

    scannedSessionsByBase = new Map(sessions.map((s) => [s.base, s]));
    setSelectOptions(ui.sessionSelect, sessions, sessions.length ? "Select…" : "No complete sessions found");

    setStatus(`Scanned ${currentUrl}: ${sessions.length} complete sessions. Select one to load.`);
    updateButtons();
  } catch (e) {
    currentUrl = null;
    scannedSessionsByBase = new Map();
    setSelectOptions(ui.sessionSelect, [], "Scan failed");
    setStatus(
      `Scan failed: ${e instanceof Error ? e.message : String(e)}. Tip: run the server from the repo root and open /web/.`,
      { error: true },
    );
    updateButtons();
  }
}

// -----------------------------------------------------------------------------
// HTTP loading (direct URLs + Range tailing)
//
// Behavior:
// - Best-effort HEAD to learn `content-length` (falls back if blocked).
// - Optional tailing via Range (startByte = size - tailBytes).
// - Optional TCAP sidecars for OUTPUT only (tidx + events).
// - Uses `loadSeq` as a simple cancellation token for overlapping loads.
//
// Refactor candidate: unify with local loading behind a `readBytes()` helper that returns `{ u8, startOffset, size }`.
// -----------------------------------------------------------------------------
async function fetchArrayBufferWithOptionalRange(url, startByte) {
  const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : undefined;
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  return await res.arrayBuffer();
}

async function loadTidxSidecarFromUrl(url, { rawLength } = {}) {
  try {
    const tidxUrl = `${url}.tidx`;
    const buf = await fetchArrayBufferWithOptionalRange(tidxUrl, 0);
    let tidx = parseTidx(new Uint8Array(buf));
    if (tidx && Number.isFinite(rawLength)) tidx = truncateTidxToRawLength(tidx, BigInt(rawLength));
    return tidx;
  } catch {
    return null;
  }
}

async function loadFromUrl(url, { kind }) {
  try {
    savePrefs();
    const seq = ++loadSeq;
    const tailBytes = clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);

    let size = null;
    try {
      const head = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (head.ok) {
        const len = head.headers.get("content-length");
        if (len) size = Number(len);
      }
    } catch {
      // ignore: HEAD might be blocked; we'll still GET
    }

    if (seq !== loadSeq) return; // superseded

    const start = size != null && tailBytes > 0 ? Math.max(0, size - tailBytes) : 0;
    const buf = await fetchArrayBufferWithOptionalRange(url, start);
    const u8 = new Uint8Array(buf);

    if (seq !== loadSeq) return; // superseded

    const tcap = kind === "output" ? await loadTcapSidecarsFromUrl(url, { rawLength: size }) : null;
    if (tcap) tcap.baseOffset = start;

    if (seq !== loadSeq) return; // superseded

    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || `${kind}`);
    if (kind === "output") currentOutputSource = { type: "url", url };
    if (kind === "input") currentInputSource = { type: "url", url };
    loadBytes({ name, size: size != null ? size : u8.length, startOffset: start, u8, tcap, kind });
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
  }
}

async function loadInputFromUrl(url) {
  try {
    savePrefs();
    const seq = ++inputLoadSeq;
    const tailBytes = clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);

    let size = null;
    try {
      const head = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (head.ok) {
        const len = head.headers.get("content-length");
        if (len) size = Number(len);
      }
    } catch {
      // ignore
    }

    if (seq !== inputLoadSeq) return;

    const start = size != null && tailBytes > 0 ? Math.max(0, size - tailBytes) : 0;
    const buf = await fetchArrayBufferWithOptionalRange(url, start);
    const u8 = new Uint8Array(buf);

    if (seq !== inputLoadSeq) return;

    const tidx = await loadTidxSidecarFromUrl(url, { rawLength: size != null ? size : u8.length });

    if (seq !== inputLoadSeq) return;

    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "input");
    currentInput = {
      name,
      size: size != null ? size : u8.length,
      baseOffset: start,
      absSize: size != null ? size : null,
      u8,
      tidx,
      lastAbsOffset: 0n,
      lastTimeNs: null,
      decoder: new TextDecoder("utf-8", { fatal: false }),
    };

    currentInputSource = { type: "url", url };
    setInputStatus(`Loaded ${name}${start > 0 ? ` (tail ${fmtBytes(u8.length)})` : ""}${tidx ? " (tidx)" : ""}.`);
    if (tidx) syncInputLogToCurrentOutputOffset();
    else renderInputLogTail();
    updateButtons();
  } catch (e) {
    setInputStatus(`Input load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    currentInputSource = null;
    currentInput = {
      name: null,
      size: null,
      baseOffset: 0,
      absSize: null,
      u8: null,
      tidx: null,
      lastAbsOffset: 0n,
      lastTimeNs: null,
      decoder: new TextDecoder("utf-8", { fatal: false }),
    };
    renderInputLogTail();
  }
}

async function loadMetaFromUrl(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  return await res.json();
}

async function loadSession(sess) {
  const seq = ++sessionLoadSeq;
  currentSession = sess;
  currentSessionMeta = null;
  updateRuntimeSessionInfo();
  renderInfoThrottled({ force: true });
  if (chunkMonitor) chunkMonitor.clear();

  // Clear input while loading so the panel reflects the session boundary.
  currentInputSource = { type: "url", url: sess.inputUrl };
  currentInput = {
    name: null,
    size: null,
    baseOffset: 0,
    absSize: null,
    u8: null,
    tidx: null,
    lastAbsOffset: 0n,
    lastTimeNs: null,
    decoder: new TextDecoder("utf-8", { fatal: false }),
  };
  renderInputLogTail();
  setInputStatus(`Loading ${decodeURIComponent(new URL(sess.inputUrl).pathname.split("/").pop() || "input")}…`);

  setStatus(`Loading session ${sess.base}…`);

  try {
    const [meta] = await Promise.all([
      loadMetaFromUrl(sess.metaUrl),
      loadFromUrl(sess.outputUrl, { kind: "output" }),
      loadInputFromUrl(sess.inputUrl),
    ]);
    if (seq !== sessionLoadSeq) return;
    currentSessionMeta = meta && typeof meta === "object" ? meta : null;
    updateRuntimeSessionInfo();

    // Defensive checks: sessions should only be listed when these exist, but the directory may change mid-load.
    if (!currentTcap || !currentTcap.outputTidx) setStatus("Session load incomplete: missing output .tidx.", { error: true });
    if (!currentTcap || !currentTcap.outputEvents) setStatus("Session load incomplete: missing .events.jsonl.", { error: true });
    if (!currentInput.u8) setInputStatus("Session load incomplete: missing input bytes.", { error: true });
    if (!currentInput.tidx) setInputStatus("Session load incomplete: missing input .tidx.", { error: true });
    if (!currentSessionMeta) setStatus("Session load incomplete: missing .meta.json.", { error: true });

    syncInputLogToCurrentOutputOffset();
    renderInfoThrottled({ force: true });
  } catch (e) {
    if (seq !== sessionLoadSeq) return;
    currentSessionMeta = null;
    updateRuntimeSessionInfo();
    setStatus(`Session load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    renderInfoThrottled({ force: true });
  }
}

function fmtNs(ns) {
  if (typeof ns !== "bigint") return "?";
  if (ns < 0n) return "?";
  const s = ns / 1_000_000_000n;
  const ms = (ns % 1_000_000_000n) / 1_000_000n;
  if (s < 60n) return `${s}.${String(ms).padStart(3, "0")}s`;
  const m = s / 60n;
  const remS = s % 60n;
  const remMs = ms;
  return `${m}m${remS}.${String(remMs).padStart(3, "0")}s`;
}

function fmtMsAsNs(ms) {
  if (!Number.isFinite(ms)) return "?";
  const n = Math.max(0, Math.floor(ms));
  return fmtNs(BigInt(n) * 1_000_000n);
}

// -----------------------------------------------------------------------------
// Seeking
//
// Two seek styles exist:
// - Bulk seek (from-0 recompute): resets terminal state and replays from the beginning to the target offset.
//   This path is used by mode 0 release, and as a fallback in mode 1 when the user releases left of max-drag.
//   Bulk-only perf toggles (no-yield, render-off, scrollback->0) apply *only* here.
// - Incremental seek (mode 1): advances forward from the current state using OutputPlayer.advanceToLocalOffset().
//
// Refactor candidate: extract bulk seek “enter/exit perf mode” to a helper for clarity.
// -----------------------------------------------------------------------------
async function fullSeekToAbsOffset(absOffset, { source = "offset" } = {}) {
  if (currentLoadedKind !== "output" && currentLoadedKind !== "input") return;
  const kind = currentLoadedKind;
  const abs = clampInt(Number(absOffset), 0, Number.MAX_SAFE_INTEGER);

  const startedAt = performance.now();
  let reloadMs = 0;
  let flushMs = 0;

  if (currentLoadedBaseOffset > 0) {
    if (ui.tailBytes) ui.tailBytes.value = "0";
    savePrefs();
    if (kind === "output" && currentSession && currentSession.outputUrl && currentSession.inputUrl) {
      setStatus("Reloading full session (Tail=0) for from-0 seek…");
      setInputStatus("Reloading full input (Tail=0) for from-0 seek…");
      await Promise.all([
        loadFromUrl(currentSession.outputUrl, { kind: "output" }),
        loadInputFromUrl(currentSession.inputUrl),
      ]);
      // Ensure input sync runs after both streams are ready.
      syncInputLogToCurrentOutputOffset();
    } else {
      setStatus(`Reloading full ${kind} (Tail=0) for from-0 seek…`);
      const src = kind === "output" ? currentOutputSource : currentInputSource;
      const srcLabel = kind === "output" ? "output source" : "input source";
      if (src && src.type === "url") {
        await loadFromUrl(src.url, { kind });
      } else if (src && src.type === "file") {
        await loadLocalFile(src.file, { kind, tailBytesOverride: 0 });
      } else {
        setStatus(`Seek failed: missing ${srcLabel} for reload.`, { error: true });
        return;
      }
    }
    reloadMs = performance.now() - startedAt;
  }

  if (currentLoadedBaseOffset > 0) {
    setStatus(`Seek failed: ${kind} is still in tail mode.`, { error: true });
    return;
  }

  const localOffset = Math.max(0, abs - currentLoadedBaseOffset);
  setStatus(`Seeking (replay from 0) to off=${fmtBytes(abs)}…`);

  const doRenderOff = bulkRenderOff;
  const doNoYield = bulkNoYield;
  const doZeroScrollback = bulkZeroScrollback;
  const prevVisibility = ui.terminalStage ? ui.terminalStage.style.visibility : "";
  const canWriteSync = !!(sink && sink.supportsWriteSync);
  const useWriteSync = doNoYield && canWriteSync;

  const seekStart = performance.now();
  let seekMs = 0;
  boundsDirty = false;
  // Bulk seeks are performance-sensitive; avoid per-chunk DOM churn regardless of render mode.
  suppressUiProgress = true;
  if (doRenderOff) {
    suppressBoundsUpdates = true;
    setTerminalRenderHidden(true);
  }
  if (doZeroScrollback) applyScrollbackSetting(0);

  try {
    if (useWriteSync && sink && typeof sink.setWriteMode === "function") sink.setWriteMode("sync");
    await player.seekToLocalOffset(localOffset, { yieldEveryMs: doNoYield ? null : 12 });
    seekMs = performance.now() - seekStart;

    // xterm.write() is async; always flush so timings reflect *processed* terminal state, not just queued writes.
    const flushStart = performance.now();
    await sink.flush();
    flushMs = performance.now() - flushStart;
  } finally {
    if (useWriteSync && sink && typeof sink.setWriteMode === "function") sink.setWriteMode("async");
    if (doZeroScrollback) applyScrollbackSetting(scrollbackLines);
    suppressUiProgress = false;
    if (doRenderOff) {
      suppressBoundsUpdates = false;
      if (ui.terminalStage) ui.terminalStage.style.visibility = prevVisibility;
      if (
        currentXterm &&
        typeof currentXterm.refresh === "function" &&
        Number.isFinite(currentXterm.rows) &&
        currentXterm.rows > 0
      ) {
        currentXterm.refresh(0, currentXterm.rows - 1);
      }
      if (boundsDirty) {
        boundsDirty = false;
        updateTerminalBounds();
      }
    }
  }
  const totalMs = performance.now() - startedAt;

  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  const timeNote = kind === "output" && tidx ? ` t=${fmtNs(timeAtOffsetNs(tidx, BigInt(abs)))}` : "";
  setStatus(`Seeked to off=${fmtBytes(abs)}.${timeNote}`);
  syncScrubbersFromProgress({ localOffset, localTotal: player.bytesTotal() });
  syncInputLogToCurrentOutputOffset();
  updateHopNextUi();

  updateAggStats(perfInfo.fullSeek, totalMs, {
    kind,
    source,
    absOffset: abs,
    localOffset,
    reloadMs,
    seekMs,
    flushMs,
    bulk: { noYield: doNoYield, renderOff: doRenderOff, zeroScrollback: doZeroScrollback, writeSync: useWriteSync },
    totalMs,
  });
  renderInfo();
}

async function handleScrubRelease({ source, abs, ms }) {
  const releaseAbs = clampInt(Number(abs), 0, Number.MAX_SAFE_INTEGER);
  if (!isMode1Enabled() || !mode1State.active || currentLoadedBaseOffset > 0) {
    resetGestureUi();
    await fullSeekToAbsOffset(releaseAbs, { source: source === "time" ? `time:${clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER)}ms` : "offset" });
    return;
  }

  perfInfo.gesture.releasedAbs = releaseAbs;
  perfInfo.gesture.fullRecompute = releaseAbs < mode1State.maxAbs;
  renderInfo();

  if (releaseAbs < mode1State.maxAbs) {
    await fullSeekToAbsOffset(releaseAbs, { source: source === "time" ? `mode1-time:${clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER)}ms` : "mode1-offset" });
    resetGestureUi();
    return;
  }

  // Ensure we're fully caught up to the farthest-right position, then keep that state.
  mode1RequestAdvance(mode1State.maxAbs);
  await mode1WaitForIdle();
  resetGestureUi();
}

async function scrubSeekToMs(ms) {
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (currentLoadedKind !== "output" || !tidx) return;

  const clampedMs = clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER);
  const targetNs = BigInt(clampedMs) * 1_000_000n;
  const absOffset = offsetAtTimeNs(tidx, targetNs);
  await fullSeekToAbsOffset(absOffset, { source: `time:${clampedMs}ms` });
}

async function scrubSeekToAbsOffset(absOffset) {
  await fullSeekToAbsOffset(absOffset, { source: "offset" });
}

// -----------------------------------------------------------------------------
// TCAP sidecars (output only)
//
// - `.output.tidx` provides an offset→time mapping for the time scrubber.
// - `<prefix>.events.jsonl` provides resize events so the terminal can track recorded geometry changes.
//
// Current behavior:
// - Sidecars are only loaded for OUTPUT streams.
// - Sidecars are optional; everything still works without them (offset scrubber + raw replay).
//
// Refactor candidate: move parsing/loading into `web/viewer/tcap_sidecars.js`.
// -----------------------------------------------------------------------------
async function loadTcapSidecarsFromUrl(outputUrl, { rawLength } = {}) {
  const urlObj = new URL(outputUrl);
  const path = urlObj.pathname;
  let prefixUrl = null;
  if (path.endsWith(".output")) prefixUrl = outputUrl.slice(0, -".output".length);
  else if (path.endsWith(".output.tcap")) prefixUrl = outputUrl.slice(0, -".output.tcap".length);

  const tidxUrl = `${outputUrl}.tidx`;
  const eventsUrl = prefixUrl ? `${prefixUrl}.events.jsonl` : null;
  const out = {};
  try {
    const buf = await fetchArrayBufferWithOptionalRange(tidxUrl, 0);
    out.outputTidx = parseTidx(new Uint8Array(buf));
  } catch {
    out.outputTidx = null;
  }
  if (eventsUrl) {
    try {
      const res = await fetch(eventsUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`fetch ${eventsUrl} failed: HTTP ${res.status}`);
      const text = await res.text();
      out.outputEvents = normalizeResizeEvents(parseEventsJsonl(text));
    } catch {
      out.outputEvents = null;
    }
  } else {
    out.outputEvents = null;
  }
  if (out.outputTidx && Number.isFinite(rawLength)) {
    out.outputTidx = truncateTidxToRawLength(out.outputTidx, BigInt(rawLength));
  }
  return out.outputTidx || out.outputEvents ? out : null;
}

// -----------------------------------------------------------------------------
// UI event wiring
//
// Refactor candidate:
// - Extract these listeners into an `initViewer()` that receives dependencies (sink/player/state) explicitly.
// - Group handlers by feature area (scan/load, playback controls, perf panel, scrubbers).
// -----------------------------------------------------------------------------
ui.scan.addEventListener("click", () => {
  void scanHttpServerListing();
});

ui.sessionSelect?.addEventListener("change", () => {
  updateButtons();
  const base = ui.sessionSelect && ui.sessionSelect.value ? String(ui.sessionSelect.value) : "";
  if (!base) return;
  const sess = scannedSessionsByBase.get(base);
  if (!sess) {
    setStatus(`Unknown session: ${base}`, { error: true });
    return;
  }
  void loadSession(sess);
});

ui.seekMode?.addEventListener("change", () => {
  seekMode = clampInt(Number(ui.seekMode.value), 0, 1);
  savePrefs();
  resetGestureUi();
  renderInfo();
});

ui.playbackClock?.addEventListener("change", () => {
  playbackClock = ui.playbackClock.value === "tidx" ? "tidx" : "bytes";
  savePrefs();
  renderInfo();
  // Apply immediately if possible; for non-output streams or missing tidx, player falls back to bytes mode.
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({
    speedBps: rateToBytesPerSec(),
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
});

ui.playbackSpeedX?.addEventListener("change", () => {
  const v = Number(ui.playbackSpeedX.value);
  playbackSpeedX = Number.isFinite(v) ? Math.max(0, v) : 1.0;
  if (ui.playbackSpeedX) ui.playbackSpeedX.value = String(playbackSpeedX);
  savePrefs();
  renderInfo();
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({
    speedBps: rateToBytesPerSec(),
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
});

ui.tidxHzCap?.addEventListener("change", () => {
  tidxEmitHzCap = clampInt(Number(ui.tidxHzCap.value), 0, 10_000);
  if (ui.tidxHzCap) ui.tidxHzCap.value = String(tidxEmitHzCap);
  savePrefs();
  renderInfo();
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({
    speedBps: rateToBytesPerSec(),
    chunkBytes,
    clockMode: playbackClock,
    clockSpeedX: playbackSpeedX,
    clockTidx: currentLoadedKind === "output" && currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null,
    tidxEmitHzCap,
  });
});

ui.scrollbackLines?.addEventListener("change", () => {
  scrollbackLines = clampInt(Number(ui.scrollbackLines.value), 0, 1_000_000);
  applyScrollbackSetting(scrollbackLines);
  savePrefs();
  renderInfo();
});

ui.inputFollow?.addEventListener("change", () => {
  inputFollow = !!ui.inputFollow.checked;
  savePrefs();
  updateRuntimeInputInfo();
  renderInfo();
});

ui.inputInterpretEscapes?.addEventListener("change", () => {
  inputInterpretEscapes = !!ui.inputInterpretEscapes.checked;
  savePrefs();
  if (currentInput && currentInput.u8) {
    const base = BigInt(currentInput.baseOffset || 0);
    const last = typeof currentInput.lastAbsOffset === "bigint" ? currentInput.lastAbsOffset : base;
    const localBig = last - base;
    const local = Number(localBig > 0n ? localBig : 0n);
    if (Number.isFinite(local)) renderInputLogFromLocalOffset(local, { absOffset: last, timeNs: currentInput.lastTimeNs });
    else renderInputLogTail();
  }
  updateRuntimeInputInfo();
  renderInfo();
});

ui.inputLog?.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const chip = target ? target.closest(".input-chip") : null;
  if (!chip) return;
  const absStr = chip instanceof HTMLElement ? chip.dataset.inputAbs : null;
  if (!absStr) return;
  const inputAbs = BigInt(absStr);
  const inputTidx = currentInput && currentInput.tidx ? currentInput.tidx : null;
  const outputTidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (!inputTidx || !outputTidx) {
    setStatus("Click-hop requires both input and output .tidx sidecars.", { error: true });
    return;
  }
  const timeNs = timeAtOffsetNs(inputTidx, inputAbs);
  const outAbs = offsetAtTimeNs(outputTidx, timeNs);
  const wasPlaying = typeof player.isPlaying === "function" ? player.isPlaying() : false;
  void (async () => {
    await fullSeekToAbsOffset(outAbs, { source: "input-click" });
    if (wasPlaying) player.play();
  })();
});

ui.inputLog?.addEventListener("pointermove", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const chip = target ? target.closest(".input-chip") : null;
  if (!chip) {
    if (inputChipHover) setInputChipHover(null);
    return;
  }
  const absStr = chip instanceof HTMLElement ? chip.dataset.inputAbs : null;
  if (!absStr) return;
  const inputAbs = BigInt(absStr);
  if (inputChipHover && inputChipHover.inputAbs === inputAbs) return;
  const label = chip.textContent ? chip.textContent.trim() : null;
  setInputChipHover({ inputAbs, label });
});

ui.inputLog?.addEventListener("pointerleave", () => {
  if (inputChipHover) setInputChipHover(null);
});

ui.inputWindowKiB?.addEventListener("change", () => {
  inputWindowKiB = clampInt(Number(ui.inputWindowKiB.value), 1, 16 * 1024);
  if (ui.inputWindowKiB) ui.inputWindowKiB.value = String(inputWindowKiB);
  savePrefs();
  if (currentInput && currentInput.u8) {
    const base = BigInt(currentInput.baseOffset || 0);
    const last = typeof currentInput.lastAbsOffset === "bigint" ? currentInput.lastAbsOffset : base;
    const localBig = last - base;
    const local = Number(localBig > 0n ? localBig : 0n);
    if (Number.isFinite(local)) renderInputLogFromLocalOffset(local, { absOffset: last });
    else renderInputLogTail();
  }
  renderInfo();
});

ui.bulkNoYield?.addEventListener("change", () => {
  bulkNoYield = !!ui.bulkNoYield.checked;
  savePrefs();
  renderInfo();
});

ui.bulkRenderOff?.addEventListener("change", () => {
  bulkRenderOff = !!ui.bulkRenderOff.checked;
  savePrefs();
  renderInfo();
});

ui.bulkZeroScrollback?.addEventListener("change", () => {
  bulkZeroScrollback = !!ui.bulkZeroScrollback.checked;
  savePrefs();
  renderInfo();
});

ui.clearInfo?.addEventListener("click", () => {
  clearPerfInfo();
});

ui.timeScrub?.addEventListener("input", () => {
  if (scrubSyncGuard) return;
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (currentLoadedKind !== "output" || !tidx) return;
  const lastNs = tidx.tNs.length ? BigInt(tidx.tNs[tidx.tNs.length - 1]) : 0n;
  const ms = clampInt(Number(ui.timeScrub.value), 0, Number.MAX_SAFE_INTEGER);
  ui.timeScrubText.textContent = `t=${fmtMsAsNs(ms)} / ${fmtNs(lastNs)}`;

  const abs = absOffsetAtMs(ms);
  scrubSyncGuard = true;
  try {
    if (ui.offsetScrub && !ui.offsetScrub.disabled) {
      if (abs != null) {
        ui.offsetScrub.value = String(abs);
        const absMax = Number.isFinite(currentLoadedAbsSize) && currentLoadedAbsSize != null ? currentLoadedAbsSize : abs;
        const pct = absMax > 0 ? ((abs / absMax) * 100).toFixed(1) : "0.0";
        if (ui.offsetScrubText) ui.offsetScrubText.textContent = `off=${fmtBytes(abs)} / ${fmtBytes(absMax)} (${pct}%)`;
      }
    }
  } finally {
    scrubSyncGuard = false;
  }

  if (isMode1Enabled() && abs != null && mode1ObserveTarget({ source: "time", abs, ms })) {
    mode1RequestAdvance(abs);
  }
});

ui.timeScrub?.addEventListener("change", () => {
  const ms = clampInt(Number(ui.timeScrub.value), 0, Number.MAX_SAFE_INTEGER);
  const abs = absOffsetAtMs(ms);
  if (abs == null) return;
  void handleScrubRelease({ source: "time", abs, ms });
});

ui.timeScrub?.addEventListener("pointerdown", () => {
  scrubUserActive = "time";
  mode1BeginGesture("time");
});
ui.timeScrub?.addEventListener("pointerup", () => {
  scrubUserActive = null;
});
ui.timeScrub?.addEventListener("pointercancel", () => {
  scrubUserActive = null;
  if (isMode1Enabled()) resetGestureUi();
});

ui.offsetScrub?.addEventListener("input", () => {
  if (scrubSyncGuard) return;
  if (currentLoadedKind !== "output" && currentLoadedKind !== "input") return;
  const abs = clampInt(Number(ui.offsetScrub.value), 0, Number.MAX_SAFE_INTEGER);
  const absMax =
    Number.isFinite(currentLoadedAbsSize) && currentLoadedAbsSize != null
      ? currentLoadedAbsSize
      : currentLoadedBaseOffset + player.bytesTotal();
  const pct = absMax > 0 ? ((abs / absMax) * 100).toFixed(1) : "0.0";
  if (ui.offsetScrubText) ui.offsetScrubText.textContent = `off=${fmtBytes(abs)} / ${fmtBytes(absMax)} (${pct}%)`;

  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  let ms = null;
  if (tidx && ui.timeScrub && !ui.timeScrub.disabled) {
    const tNs = timeAtOffsetNs(tidx, BigInt(abs));
    const lastNs = tidx.tNs.length ? BigInt(tidx.tNs[tidx.tNs.length - 1]) : 0n;
    ms = Number(tNs / 1_000_000n);

    scrubSyncGuard = true;
    try {
      if (Number.isFinite(ms)) ui.timeScrub.value = String(clampInt(ms, 0, Number.MAX_SAFE_INTEGER));
      if (ui.timeScrubText) ui.timeScrubText.textContent = `t=${fmtNs(tNs)} / ${fmtNs(lastNs)}`;
    } finally {
      scrubSyncGuard = false;
    }
  }

  if (isMode1Enabled() && mode1ObserveTarget({ source: "offset", abs, ms })) {
    mode1RequestAdvance(abs);
  }
});

ui.offsetScrub?.addEventListener("change", () => {
  const abs = clampInt(Number(ui.offsetScrub.value), 0, Number.MAX_SAFE_INTEGER);
  void handleScrubRelease({ source: "offset", abs });
});

ui.offsetScrub?.addEventListener("pointerdown", () => {
  scrubUserActive = "offset";
  mode1BeginGesture("offset");
});
ui.offsetScrub?.addEventListener("pointerup", () => {
  scrubUserActive = null;
});
ui.offsetScrub?.addEventListener("pointercancel", () => {
  scrubUserActive = null;
  if (isMode1Enabled()) resetGestureUi();
});

// -----------------------------------------------------------------------------
// Boot sequence
//
// Initializes prefs/UI state, applies initial playback config, and (best-effort) auto-scans if served under /web/.
// -----------------------------------------------------------------------------
loadPrefs();
chunkMonitor = installChunkMonitor();
updateRuntimeInputInfo();
renderInfo();
applyScrollbackSetting(scrollbackLines);
installPanelResizer();
player.configure({
  speedBps: rateToBytesPerSec(),
  chunkBytes: clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024),
  clockMode: playbackClock,
  clockSpeedX: playbackSpeedX,
  clockTidx: null,
  tidxEmitHzCap,
});
updateButtons();
configureScrubbers();

// Best-effort auto-scan if we're being served as /web/ from the repo root.
if (ui.baseUrl && ui.baseUrl.value) void scanHttpServerListing();
