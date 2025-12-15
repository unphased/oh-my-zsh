const ui = {
  file: document.getElementById("file"),
  baseUrl: document.getElementById("baseUrl"),
  scan: document.getElementById("scan"),
  outputSelect: document.getElementById("outputSelect"),
  inputSelect: document.getElementById("inputSelect"),
  loadOutput: document.getElementById("loadOutput"),
  loadInput: document.getElementById("loadInput"),
  tailBytes: document.getElementById("tailBytes"),
  chunkBytes: document.getElementById("chunkBytes"),
  speed: document.getElementById("speed"),
  load: document.getElementById("load"),
  play: document.getElementById("play"),
  pause: document.getElementById("pause"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  drop: document.getElementById("drop"),
  terminal: document.getElementById("terminal"),
  fallback: document.getElementById("fallback"),
  meta: document.getElementById("meta"),
};

const DEFAULT_SPEED_ID = "snail";

// [id, bytesPerSec]
const SPEED_PRESETS = [
  ["glacier", 1],
  ["snail", 10],
  ["turtle", 400],
  ["slow", 1_200],
  ["fast", 50_000],
  ["turbo", 400_000],
  ["instant", Number.POSITIVE_INFINITY],
];

const SPEED_LABEL_OVERRIDES = new Map([
  // e.g. ["realtime", "realtime-ish"],
]);

const SPEED_BYTES_PER_SEC_BY_ID = new Map(SPEED_PRESETS);

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

function speedToBytesPerSec(speed) {
  const bps = SPEED_BYTES_PER_SEC_BY_ID.get(speed);
  if (bps != null) return bps;
  const def = SPEED_BYTES_PER_SEC_BY_ID.get(DEFAULT_SPEED_ID);
  return def != null ? def : 50_000;
}

function initSpeedSelect() {
  const existing = ui.speed.value;
  ui.speed.innerHTML = "";

  for (const [id] of SPEED_PRESETS) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = SPEED_LABEL_OVERRIDES.get(id) || id;
    ui.speed.appendChild(opt);
  }

  if (existing && SPEED_BYTES_PER_SEC_BY_ID.has(existing)) {
    ui.speed.value = existing;
    return;
  }

  ui.speed.value = SPEED_BYTES_PER_SEC_BY_ID.has(DEFAULT_SPEED_ID) ? DEFAULT_SPEED_ID : SPEED_PRESETS[0][0];
}

class OutputPlayer {
  constructor({ write, reset, onProgress }) {
    this._write = write;
    this._reset = reset;
    this._onProgress = onProgress;
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._buf = null;
    this._offset = 0;
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

  load(u8) {
    this.stop();
    this._reset();
    this._decoder = new TextDecoder("utf-8", { fatal: false });
    this._buf = u8;
    this._offset = 0;
    this._lastTs = 0;
    this._carryBytes = 0;
    this._eventIndex = 0;
    this._applyEventsUpTo(0);
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
    this._applyEventsUpTo(0);
    this._emitProgress(0);
  }

  setEvents(events, { onEvent } = {}) {
    this._events = Array.isArray(events) ? events : null;
    this._onEvent = typeof onEvent === "function" ? onEvent : null;
    this._eventIndex = 0;
    this._applyEventsUpTo(this._offset);
  }

  _applyEventsUpTo(offset) {
    if (!this._events || !this._onEvent) return;
    while (this._eventIndex < this._events.length) {
      const ev = this._events[this._eventIndex];
      if (!ev || typeof ev.offset !== "number") {
        this._eventIndex++;
        continue;
      }
      if (ev.offset > offset) break;
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
    this._applyEventsUpTo(start);
    const chunk = this._buf.subarray(start, end);
    this._offset = end;

    const text = this._decoder.decode(chunk, { stream: true });
    if (text) this._write(text);

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
}

function createSink() {
  if (isXtermAvailable()) {
    const term = new window.Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      scrollback: 10000,
    });

    ui.fallback.hidden = true;
    ui.terminal.hidden = false;
    ui.terminal.innerHTML = "";
    term.open(ui.terminal);
    term.focus();

    // For debugging in devtools.
    window.__TERM_CAPTURE_XTERM_TERM = term;

    return {
      kind: "xterm",
      write: (s) => term.write(s),
      reset: () => term.reset(),
      resize: (cols, rows) => term.resize(cols, rows),
    };
  }

  ui.terminal.hidden = true;
  ui.terminal.innerHTML = "";
  ui.fallback.hidden = false;
  ui.fallback.textContent = "";

  return {
    kind: "pre",
    write: (s) => {
      ui.fallback.textContent += s;
      ui.fallback.scrollTop = ui.fallback.scrollHeight;
    },
    reset: () => {
      ui.fallback.textContent = "";
    },
    resize: () => {},
  };
}

let currentFile = null;
let currentUrl = null;
let sink = createSink();
let currentTcap = null;
let player = new OutputPlayer({
  write: (s) => sink.write(s),
  reset: () => sink.reset(),
  onProgress: ({ offset, total, done }) => {
    const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
    const timeNote =
      currentTcap && currentTcap.outputTidx
        ? ` t=${fmtNs(timeAtOffsetNs(currentTcap.outputTidx, offset))}`
        : "";
    ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}${timeNote}`;
  },
});

function setStatus(msg, { error = false } = {}) {
  ui.status.textContent = msg;
  ui.status.style.color = error ? "var(--bad)" : "var(--muted)";
}

function xtermSourceNote() {
  const src =
    typeof window.__TERM_CAPTURE_XTERM_SOURCE === "string" ? window.__TERM_CAPTURE_XTERM_SOURCE : null;
  if (!src) return "";
  return ` xterm=${src}`;
}

function updateButtons() {
  const hasFile = !!currentFile;
  const hasUrl = !!currentUrl;
  const hasLoaded = player.hasLoaded();
  ui.load.disabled = !hasFile;
  ui.play.disabled = !hasLoaded;
  ui.pause.disabled = !hasLoaded;
  ui.reset.disabled = !hasLoaded;
  ui.loadOutput.disabled = !hasUrl || !ui.outputSelect.value;
  ui.loadInput.disabled = !hasUrl || !ui.inputSelect.value;
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
          ? ` t=${fmtNs(timeAtOffsetNs(currentTcap.outputTidx, offset))}`
          : "";
      ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}${timeNote}`;
    },
  });

  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  const speedBps = speedToBytesPerSec(ui.speed.value);
  player.configure({ speedBps, chunkBytes });
}

function loadBytes({ name, size, startOffset, u8, tcap }) {
  setupPlaybackPipeline();
  currentTcap = tcap || null;

  player.load(u8);
  if (currentTcap && currentTcap.outputEvents) {
    player.setEvents(currentTcap.outputEvents, {
      onEvent: (ev) => {
        if (ev.type === "resize") sink.resize(ev.cols, ev.rows);
      },
    });
  }

  const tailNote =
    typeof startOffset === "number" && startOffset > 0
      ? ` (tail ${fmtBytes(size - startOffset)} of ${fmtBytes(size)})`
      : "";
  setStatus(
    `Loaded ${name}${tailNote}. Renderer: ${sink.kind === "xterm" ? "xterm.js" : "fallback"}.${xtermSourceNote()}`,
  );
  updateButtons();

  if (ui.speed.value === "instant") {
    player.play();
  }
}

async function loadSelectedFile() {
  if (!currentFile) return;
  try {
    const tailBytes = clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);
    const fileSize = currentFile.size;
    const start = tailBytes > 0 ? Math.max(0, fileSize - tailBytes) : 0;
    const blob = currentFile.slice(start, fileSize);
    const buf = await blob.arrayBuffer();
    loadBytes({ name: currentFile.name, size: fileSize, startOffset: start, u8: new Uint8Array(buf), tcap: null });
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
  }
}

function pickFile(file) {
  currentFile = file;
  currentUrl = null;
  if (!file) {
    setStatus("No file loaded.");
    ui.meta.textContent = "";
    updateButtons();
    return;
  }

  setStatus(`Selected ${file.name} (${fmtBytes(file.size)}). Click Load.`);
  updateButtons();
}

ui.file.addEventListener("change", () => {
  pickFile(ui.file.files && ui.file.files[0] ? ui.file.files[0] : null);
});

ui.load.addEventListener("click", () => {
  void loadSelectedFile();
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

ui.speed.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({ speedBps: speedToBytesPerSec(ui.speed.value), chunkBytes });
});

ui.chunkBytes.addEventListener("change", () => {
  const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
  player.configure({ speedBps: speedToBytesPerSec(ui.speed.value), chunkBytes });
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
    opt.textContent = item.name;
    selectEl.appendChild(opt);
  }
  selectEl.value = "";
}

async function scanHttpServerListing() {
  try {
    currentFile = null;
    currentUrl = resolvedBaseUrl();

    const res = await fetch(currentUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${currentUrl} failed: HTTP ${res.status}`);
    const html = await res.text();

    // Python SimpleHTTPServer emits a directory listing HTML page; parse anchor tags.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    const links = anchors
      .map((a) => a.getAttribute("href"))
      .filter((href) => href && href !== "../")
      .map((href) => new URL(href, currentUrl));

    const outputs = [];
    const inputs = [];
    for (const url of links) {
      if (url.pathname.endsWith("/")) continue;
      const name = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (name.endsWith(".output") || name.endsWith(".output.tcap")) {
        outputs.push({ name, href: url.toString() });
      } else if (name.endsWith(".input") || name.endsWith(".input.tcap")) {
        inputs.push({ name, href: url.toString() });
      }
    }

    outputs.sort((a, b) => a.name.localeCompare(b.name));
    inputs.sort((a, b) => a.name.localeCompare(b.name));

    setSelectOptions(ui.outputSelect, outputs, outputs.length ? "Select…" : "No .output found");
    setSelectOptions(ui.inputSelect, inputs, inputs.length ? "Select…" : "No .input found");

    setStatus(
      `Scanned ${currentUrl}: ${outputs.length} output, ${inputs.length} input. Select one and click Load.`,
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

    const tcap = kind === "output" && start === 0 ? await loadTcapSidecarsFromUrl(url) : null;

    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || `${kind}`);
    loadBytes({ name, size: size != null ? size : u8.length, startOffset: start, u8, tcap });
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
  }
}

function fmtNs(ns) {
  if (!Number.isFinite(ns)) return "?";
  const s = ns / 1e9;
  if (s < 60) return `${s.toFixed(3)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m${rem.toFixed(1)}s`;
}

function readU64LE(u8, off) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(u8[off + i]) << BigInt(i * 8);
  return v;
}

function readUleb128(u8, off) {
  let result = 0;
  let shift = 0;
  let i = off;
  for (; i < u8.length; i++) {
    const byte = u8[i];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(result)) throw new Error("uleb128 too large");
      return { value: result, next: i + 1 };
    }
    shift += 7;
    if (shift >= 63) throw new Error("uleb128 too large");
  }
  throw new Error("uleb128 truncated");
}

function parseTidx(u8) {
  const magic = new TextDecoder().decode(u8.subarray(0, 5));
  if (magic !== "TIDX1") throw new Error("bad tidx magic");
  const startedUnixNs = readU64LE(u8, 6);
  let off = 14;
  let t = 0;
  let end = 0;
  const tNs = [];
  const endOffsets = [];
  while (off < u8.length) {
    const a = readUleb128(u8, off);
    off = a.next;
    const b = readUleb128(u8, off);
    off = b.next;
    t += a.value;
    end += b.value;
    tNs.push(t);
    endOffsets.push(end);
  }
  return { startedUnixNs, tNs, endOffsets };
}

function parseOutputEvents(u8) {
  const magic = new TextDecoder().decode(u8.subarray(0, 4));
  if (magic !== "EVT1") throw new Error("bad events magic");
  const startedUnixNs = readU64LE(u8, 5);
  let off = 13;
  let t = 0;
  let o = 0;
  const events = [];
  while (off < u8.length) {
    const type = u8[off++];
    if (type === 1) {
      const a = readUleb128(u8, off);
      off = a.next;
      const b = readUleb128(u8, off);
      off = b.next;
      const c = readUleb128(u8, off);
      off = c.next;
      const d = readUleb128(u8, off);
      off = d.next;
      t += a.value;
      o += b.value;
      events.push({ type: "resize", tNs: t, offset: o, cols: c.value, rows: d.value });
    } else {
      throw new Error(`unknown event type ${type}`);
    }
  }
  return { startedUnixNs, events };
}

function timeAtOffsetNs(tidx, offset) {
  const arr = tidx.endOffsets;
  if (!arr.length) return 0;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] >= offset) hi = mid;
    else lo = mid + 1;
  }
  return tidx.tNs[lo] || 0;
}

async function loadTcapSidecarsFromUrl(outputUrl) {
  const tidxUrl = `${outputUrl}.tidx`;
  const eventsUrl = `${outputUrl}.events`;
  const out = {};
  try {
    const buf = await fetchArrayBufferWithOptionalRange(tidxUrl, 0);
    out.outputTidx = parseTidx(new Uint8Array(buf));
  } catch {
    out.outputTidx = null;
  }
  try {
    const buf = await fetchArrayBufferWithOptionalRange(eventsUrl, 0);
    const parsed = parseOutputEvents(new Uint8Array(buf));
    out.outputEvents = parsed.events;
  } catch {
    out.outputEvents = null;
  }
  return out.outputTidx || out.outputEvents ? out : null;
}

ui.scan.addEventListener("click", () => {
  void scanHttpServerListing();
});

ui.outputSelect.addEventListener("change", () => {
  updateButtons();
});

ui.inputSelect.addEventListener("change", () => {
  updateButtons();
});

ui.loadOutput.addEventListener("click", () => {
  if (!ui.outputSelect.value) return;
  void loadFromUrl(ui.outputSelect.value, { kind: "output" });
});

ui.loadInput.addEventListener("click", () => {
  if (!ui.inputSelect.value) return;
  void loadFromUrl(ui.inputSelect.value, { kind: "input" });
});

ui.drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  ui.drop.classList.add("dragover");
});

ui.drop.addEventListener("dragleave", () => {
  ui.drop.classList.remove("dragover");
});

ui.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.drop.classList.remove("dragover");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
  if (file) pickFile(file);
});

updateButtons();
initSpeedSelect();

// Best-effort auto-scan if we're being served as /web/ from the repo root.
if (ui.baseUrl && ui.baseUrl.value) {
  void scanHttpServerListing();
}
