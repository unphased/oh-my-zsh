import {
  lastResizeBeforeOffset,
  normalizeResizeEvents,
  offsetAtTimeNs,
  parseEventsJsonl,
  parseTidx,
  timeAtOffsetNs,
  truncateTidxToRawLength,
} from "../js/tcap/index.js";

const ui = {
  fileOutput: document.getElementById("fileOutput"),
  fileInput: document.getElementById("fileInput"),
  baseUrl: document.getElementById("baseUrl"),
  scan: document.getElementById("scan"),
  outputSelect: document.getElementById("outputSelect"),
  inputSelect: document.getElementById("inputSelect"),
  tailBytes: document.getElementById("tailBytes"),
  chunkBytes: document.getElementById("chunkBytes"),
  rateBps: document.getElementById("rateBps"),
  play: document.getElementById("play"),
  pause: document.getElementById("pause"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  terminalStage: document.getElementById("terminalStage"),
  terminalCanvas: document.getElementById("terminalCanvas"),
  terminal: document.getElementById("terminal"),
  fallback: document.getElementById("fallback"),
  meta: document.getElementById("meta"),
  timeScrub: document.getElementById("timeScrub"),
  timeScrubText: document.getElementById("timeScrubText"),
  boundsOverlay: document.getElementById("boundsOverlay"),
  boundsLabel: document.getElementById("boundsLabel"),
};

let currentTermSize = null; // { cols, rows }
let currentXterm = null;
let lastMeasuredCellPx = null; // { cellW, cellH }

function setTermSize(cols, rows) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  currentTermSize = { cols: c, rows: r };
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

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(1)} GiB`;
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
  const bps = rateToBytesPerSec();
  return `rate=${fmtRate(bps)} cap=${fmtBytes(chunkBytes)}/frame`;
}

function currentTermSizeNote() {
  if (!currentTermSize) return "";
  return `size=${currentTermSize.cols}×${currentTermSize.rows}`;
}

class OutputPlayer {
  constructor({ write, reset, onProgress }) {
    this._write = write;
    this._reset = reset;
    this._onProgress = onProgress;
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
  }

  hasLoaded() {
    return !!this._buf;
  }

  bytesTotal() {
    return this._buf ? this._buf.length : 0;
  }

  bytesOffset() {
    return this._offset;
  }

  load(u8, { baseOffset = 0 } = {}) {
    this.stop();
    this._reset();
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._buf = u8;
    this._offset = 0;
    this._baseOffset = BigInt(baseOffset);
    this._lastTs = 0;
    this._carryBytes = 0;
    this._eventIndex = 0;
    this._applyEventsAtAbsOffset(this._baseOffset);
    this._emitProgress(0);
  }

  configure({ speedBps, chunkBytes }) {
    this._speedBps = speedBps;
    this._chunkBytes = chunkBytes;
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

  async seekToLocalOffset(targetOffset) {
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

    const yieldEveryMs = 12;
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
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
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

  _emitProgress(extraBytesWritten) {
    if (!this._buf) return;
    this._onProgress({
      offset: this._offset,
      total: this._buf.length,
      extraBytesWritten,
      done: this._offset >= this._buf.length,
    });
  }

  _tick(ts) {
    if (!this._playing || !this._buf) return;

    const dtMs = Math.max(0, ts - this._lastTs);
    this._lastTs = ts;

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

    const start = this._offset;
    const end = Math.min(this._buf.length, start + budget);
    this._offset = end;

    this._writeBytesWithResizeEvents(start, end);

    if (this._offset >= this._buf.length) {
      const flush = this._decoder.decode(new Uint8Array(), { stream: false });
      if (flush) this._write(flush);
      this._emitProgress(this._offset - start);
      this.stop();
      return;
    }

    this._emitProgress(this._offset - start);
    this._raf = requestAnimationFrame((nextTs) => this._tick(nextTs));
  }

  _writeBytesWithResizeEvents(start, end) {
    if (!this._buf) return;
    if (!this._events || !this._onEvent) {
      const chunk = this._buf.subarray(start, end);
      const text = this._decoder.decode(chunk, { stream: true });
      if (text) this._write(text);
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
      if (text) this._write(text);
    }
  }
}

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

    return {
      kind: "xterm",
      write: (s) => term.write(s),
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
    reset: () => {
      ui.fallback.textContent = "";
    },
    resize: (cols, rows) => setTermSize(cols, rows),
  };
}

let currentUrl = null;
let sink = createSink();
let currentTcap = null;
let currentLoadedKind = null; // "output" | "input" | null
let currentLoadedBaseOffset = 0;
let currentOutputSource = null; // { type:"url", url } | { type:"file", file } | null
let localLoadSeq = 0;
let player = new OutputPlayer({
  write: (s) => sink.write(s),
  reset: () => sink.reset(),
  onProgress: ({ offset, total, done }) => {
    const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
    const timeNote =
      currentTcap && currentTcap.outputTidx
        ? ` t=${fmtNs(timeAtOffsetNs(currentTcap.outputTidx, BigInt(currentLoadedBaseOffset || 0) + BigInt(offset)))}`
        : "";
    const sizeNote = currentTermSizeNote();
    ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}${timeNote} ${sizeNote} ${currentPlaybackConfigNote()}`.trim();
  },
});

function setStatus(msg, { error = false } = {}) {
  ui.status.textContent = msg;
  ui.status.style.color = error ? "var(--bad)" : "var(--muted)";
}

const PREFS_KEY = "termplex.web.viewer.prefs.v1";

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
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function xtermSourceNote() {
  const src =
    typeof window.__TERM_CAPTURE_XTERM_SOURCE === "string" ? window.__TERM_CAPTURE_XTERM_SOURCE : null;
  if (!src) return "";
  return ` xterm=${src}`;
}

function updateButtons() {
  const hasLoaded = player.hasLoaded();
  ui.play.disabled = !hasLoaded;
  ui.pause.disabled = !hasLoaded;
  ui.reset.disabled = !hasLoaded;
}

function setScrubber({ enabled, text, ms, maxMs } = {}) {
  if (!ui.timeScrub || !ui.timeScrubText) return;
  if (Number.isFinite(maxMs)) ui.timeScrub.max = String(Math.max(0, Math.floor(maxMs)));
  if (Number.isFinite(ms)) ui.timeScrub.value = String(Math.max(0, Math.floor(ms)));
  ui.timeScrub.disabled = !enabled;
  if (typeof text === "string") ui.timeScrubText.textContent = text;
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

function setupPlaybackPipeline() {
  sink = createSink();
  player = new OutputPlayer({
    write: (s) => sink.write(s),
    reset: () => sink.reset(),
    onProgress: ({ offset, total, done }) => {
      const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
      const timeNote =
        currentTcap && currentTcap.outputTidx
          ? ` t=${fmtNs(timeAtOffsetNs(currentTcap.outputTidx, BigInt(currentLoadedBaseOffset || 0) + BigInt(offset)))}`
          : "";
      const sizeNote = currentTermSizeNote();
      ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}${timeNote} ${sizeNote} ${currentPlaybackConfigNote()}`.trim();
    },
  });

  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  const speedBps = rateToBytesPerSec();
  player.configure({ speedBps, chunkBytes });
}

function loadBytes({ name, size, startOffset, u8, tcap, kind }) {
  setupPlaybackPipeline();
  currentTcap = tcap || null;
  currentLoadedKind = kind || null;
  currentLoadedBaseOffset = typeof startOffset === "number" ? startOffset : 0;
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

  configureTimeScrubber();

  const tailNote = typeof startOffset === "number" && startOffset > 0 ? ` (tail ${fmtBytes(u8.length)})` : "";
  setStatus(
    `Loaded ${name}${tailNote}. Renderer: ${sink.kind === "xterm" ? "xterm.js" : "fallback"}.${xtermSourceNote()}`,
  );
  updateButtons();

  if (!Number.isFinite(rateToBytesPerSec())) {
    player.play();
  }
}

async function loadLocalFile(file, { kind, tailBytesOverride = null } = {}) {
  if (!file) return;
  try {
    savePrefs();
    const seq = ++localLoadSeq;
    const tailBytes =
      tailBytesOverride != null ? clampInt(Number(tailBytesOverride), 0, Number.MAX_SAFE_INTEGER) : clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);
    const fileSize = file.size;
    const start = tailBytes > 0 ? Math.max(0, fileSize - tailBytes) : 0;
    const blob = file.slice(start, fileSize);
    const buf = await blob.arrayBuffer();
    if (seq !== localLoadSeq) return; // superseded
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

function pickLocalFile(file, { kind }) {
  currentUrl = null;
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

ui.play.addEventListener("click", () => {
  player.play();
});

ui.pause.addEventListener("click", () => {
  player.pause();
});

ui.reset.addEventListener("click", () => {
  player.reset();
});

ui.rateBps.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({ speedBps: rateToBytesPerSec(), chunkBytes });
  savePrefs();
});

ui.chunkBytes.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({ speedBps: rateToBytesPerSec(), chunkBytes });
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

function setSelectOptions(selectEl, items, placeholder) {
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
    const outputs = [];
    const inputs = [];
    for (const url of links) {
      if (url.pathname.endsWith("/")) continue;
      const name = decodeURIComponent(url.pathname.split("/").pop() || "");
      const info = byName.get(name) || { name, href: url.toString(), lastModifiedText: null, sizeBytes: null };
      if (name.endsWith(".output") || name.endsWith(".output.tcap")) {
        const prefix = name.endsWith(".output") ? name.slice(0, -".output".length) : name.slice(0, -".output.tcap".length);
        const hasTidx = nameSet.has(`${name}.tidx`);
        const eventsName = `${prefix}.events.jsonl`;
        const hasEvents = nameSet.has(eventsName);
        const sidecarNote =
          hasTidx || hasEvents ? `sidecars:${hasTidx ? " tidx" : ""}${hasEvents ? " events" : ""}`.trim() : "";
        const label = fmtListingLabel({ ...info, sidecarNote });
        const titleParts = [
          info.name,
          info.lastModifiedText ? `modified: ${info.lastModifiedText}` : null,
          Number.isFinite(info.sizeBytes) ? `size: ${info.sizeBytes} bytes` : null,
          hasTidx ? `${name}.tidx` : null,
          hasEvents ? eventsName : null,
        ].filter(Boolean);
        outputs.push({ ...info, label, title: titleParts.join("\n") });
      } else if (name.endsWith(".input") || name.endsWith(".input.tcap")) {
        const label = fmtListingLabel({ ...info, sidecarNote: "" });
        const titleParts = [
          info.name,
          info.lastModifiedText ? `modified: ${info.lastModifiedText}` : null,
          Number.isFinite(info.sizeBytes) ? `size: ${info.sizeBytes} bytes` : null,
        ].filter(Boolean);
        inputs.push({ ...info, label, title: titleParts.join("\n") });
      }
    }

    const sortKey = (x) => x.lastModifiedText || "";
    outputs.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.name.localeCompare(b.name));
    inputs.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.name.localeCompare(b.name));

    setSelectOptions(ui.outputSelect, outputs, outputs.length ? "Select…" : "No .output found");
    setSelectOptions(ui.inputSelect, inputs, inputs.length ? "Select…" : "No .input found");

    setStatus(
      `Scanned ${currentUrl}: ${outputs.length} output, ${inputs.length} input. Select one to load.`,
    );
    updateButtons();
  } catch (e) {
    currentUrl = null;
    setSelectOptions(ui.outputSelect, [], "Scan failed");
    setSelectOptions(ui.inputSelect, [], "Scan failed");
    setStatus(
      `Scan failed: ${e instanceof Error ? e.message : String(e)}. Tip: run the server from the repo root and open /web/.`,
      { error: true },
    );
    updateButtons();
  }
}

async function fetchArrayBufferWithOptionalRange(url, startByte) {
  const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : undefined;
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  return await res.arrayBuffer();
}

async function loadFromUrl(url, { kind }) {
  try {
    savePrefs();
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

    const start = size != null && tailBytes > 0 ? Math.max(0, size - tailBytes) : 0;
    const buf = await fetchArrayBufferWithOptionalRange(url, start);
    const u8 = new Uint8Array(buf);

    const tcap = kind === "output" ? await loadTcapSidecarsFromUrl(url, { rawLength: size }) : null;
    if (tcap) tcap.baseOffset = start;

    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || `${kind}`);
    if (kind === "output") currentOutputSource = { type: "url", url };
    loadBytes({ name, size: size != null ? size : u8.length, startOffset: start, u8, tcap, kind });
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
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

async function scrubSeekToMs(ms) {
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (currentLoadedKind !== "output" || !tidx) return;

  const clampedMs = clampInt(Number(ms), 0, Number.MAX_SAFE_INTEGER);
  const targetNs = BigInt(clampedMs) * 1_000_000n;
  const absOffset = offsetAtTimeNs(tidx, targetNs);

  if (currentLoadedBaseOffset > 0) {
    if (ui.tailBytes) ui.tailBytes.value = "0";
    savePrefs();
    setStatus("Reloading full output (Tail=0) for from-0 seek…");
    if (currentOutputSource && currentOutputSource.type === "url") {
      await loadFromUrl(currentOutputSource.url, { kind: "output" });
    } else if (currentOutputSource && currentOutputSource.type === "file") {
      await loadLocalFile(currentOutputSource.file, { kind: "output", tailBytesOverride: 0 });
    } else {
      setStatus("Seek failed: missing output source for reload.", { error: true });
      return;
    }
  }

  if (currentLoadedBaseOffset > 0) {
    setStatus("Seek failed: output is still in tail mode.", { error: true });
    return;
  }

  const localOffsetBig = absOffset - BigInt(currentLoadedBaseOffset);
  const localOffset = Number(localOffsetBig >= 0n ? localOffsetBig : 0n);
  setStatus(`Seeking (replay from 0) to t=${fmtMsAsNs(clampedMs)} (off=${fmtBytes(localOffset)})…`);
  await player.seekToLocalOffset(localOffset);
  setStatus(`Seeked to t=${fmtMsAsNs(clampedMs)} (off=${fmtBytes(localOffset)}).`);
}

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

ui.scan.addEventListener("click", () => {
  void scanHttpServerListing();
});

ui.outputSelect.addEventListener("change", () => {
  updateButtons();
  if (!ui.outputSelect.value) return;
  setStatus(`Loading ${decodeURIComponent(new URL(ui.outputSelect.value).pathname.split("/").pop() || "output")}…`);
  currentOutputSource = { type: "url", url: ui.outputSelect.value };
  void loadFromUrl(ui.outputSelect.value, { kind: "output" });
});

ui.inputSelect.addEventListener("change", () => {
  updateButtons();
  if (!ui.inputSelect.value) return;
  setStatus(`Loading ${decodeURIComponent(new URL(ui.inputSelect.value).pathname.split("/").pop() || "input")}…`);
  void loadFromUrl(ui.inputSelect.value, { kind: "input" });
});

ui.timeScrub?.addEventListener("input", () => {
  const tidx = currentTcap && currentTcap.outputTidx ? currentTcap.outputTidx : null;
  if (currentLoadedKind !== "output" || !tidx) return;
  const lastNs = tidx.tNs.length ? BigInt(tidx.tNs[tidx.tNs.length - 1]) : 0n;
  const ms = clampInt(Number(ui.timeScrub.value), 0, Number.MAX_SAFE_INTEGER);
  ui.timeScrubText.textContent = `t=${fmtMsAsNs(ms)} / ${fmtNs(lastNs)}`;
});

ui.timeScrub?.addEventListener("change", () => {
  const ms = clampInt(Number(ui.timeScrub.value), 0, Number.MAX_SAFE_INTEGER);
  void scrubSeekToMs(ms);
});

loadPrefs();
player.configure({
  speedBps: rateToBytesPerSec(),
  chunkBytes: clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024),
});
updateButtons();
configureTimeScrubber();

// Best-effort auto-scan if we're being served as /web/ from the repo root.
if (ui.baseUrl && ui.baseUrl.value) void scanHttpServerListing();
