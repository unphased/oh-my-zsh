const ui = {
  file: document.getElementById("file"),
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
  switch (speed) {
    case "realtime":
      return 40_000;
    case "fast":
      return 500_000;
    case "turbo":
      return 4_000_000;
    case "instant":
      return Number.POSITIVE_INFINITY;
    default:
      return 500_000;
  }
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
    this._emitProgress(0);
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
      budget = Math.max(this._chunkBytes, Math.floor((this._speedBps * dtMs) / 1000));
      budget = clampInt(budget, 1024, 8 * 1024 * 1024);
    } else {
      budget = 8 * 1024 * 1024;
    }

    const start = this._offset;
    const end = Math.min(this._buf.length, start + budget);
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
    ui.terminal.innerHTML = "";
    term.open(ui.terminal);
    term.focus();

    return {
      kind: "xterm",
      write: (s) => term.write(s),
      reset: () => term.reset(),
    };
  }

  ui.fallback.hidden = false;
  ui.fallback.textContent = "";
  ui.terminal.innerHTML = "";

  return {
    kind: "pre",
    write: (s) => {
      ui.fallback.textContent += s;
      ui.fallback.scrollTop = ui.fallback.scrollHeight;
    },
    reset: () => {
      ui.fallback.textContent = "";
    },
  };
}

let currentFile = null;
let sink = createSink();
let player = new OutputPlayer({
  write: (s) => sink.write(s),
  reset: () => sink.reset(),
  onProgress: ({ offset, total, done }) => {
    const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
    ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}`;
  },
});

function setStatus(msg, { error = false } = {}) {
  ui.status.textContent = msg;
  ui.status.style.color = error ? "var(--bad)" : "var(--muted)";
}

function updateButtons() {
  const hasFile = !!currentFile;
  const hasLoaded = player.hasLoaded();
  ui.load.disabled = !hasFile;
  ui.play.disabled = !hasLoaded;
  ui.pause.disabled = !hasLoaded;
  ui.reset.disabled = !hasLoaded;
}

async function loadSelectedFile() {
  if (!currentFile) return;

  try {
    sink = createSink();
    player = new OutputPlayer({
      write: (s) => sink.write(s),
      reset: () => sink.reset(),
      onProgress: ({ offset, total, done, extraBytesWritten }) => {
        const pct = total ? ((offset / total) * 100).toFixed(1) : "0.0";
        ui.meta.textContent = `${fmtBytes(offset)} / ${fmtBytes(total)} (${pct}%)${done ? " done" : ""}`;
        if (extraBytesWritten > 0) {
          // no-op hook point for future throughput stats
        }
      },
    });

    const tailBytes = clampInt(Number(ui.tailBytes.value), 0, Number.MAX_SAFE_INTEGER);
    const chunkBytes = clampInt(Number(ui.chunkBytes.value), 1024, 8 * 1024 * 1024);
    const speedBps = speedToBytesPerSec(ui.speed.value);

    player.configure({ speedBps, chunkBytes });

    const fileSize = currentFile.size;
    const start = tailBytes > 0 ? Math.max(0, fileSize - tailBytes) : 0;
    const blob = currentFile.slice(start, fileSize);
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);

    player.load(u8);

    const tailNote = start > 0 ? ` (tail ${fmtBytes(fileSize - start)} of ${fmtBytes(fileSize)})` : "";
    setStatus(
      `Loaded ${currentFile.name}${tailNote}. Renderer: ${sink.kind === "xterm" ? "xterm.js" : "fallback"}.`,
    );
    updateButtons();

    if (ui.speed.value === "instant") {
      player.play();
    }
  } catch (e) {
    setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`, { error: true });
    updateButtons();
  }
}

function pickFile(file) {
  currentFile = file;
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
