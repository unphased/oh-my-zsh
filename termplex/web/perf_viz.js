function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

// Shared hover/cursor bus: hovering any graph broadcasts a key, and all graphs
// can highlight the closest matching key they have (even if their x-axis is condensed).
export class PerfVizHub {
  constructor() {
    this._graphs = new Map(); // id -> graph
    this._hover = null; // { key:number, sourceId:string } | null
  }

  register(graph) {
    if (!graph || typeof graph !== "object") return;
    const id = String(graph.id || "");
    if (!id) return;
    this._graphs.set(id, graph);
  }

  unregister(graphOrId) {
    const id = typeof graphOrId === "string" ? graphOrId : graphOrId && graphOrId.id ? String(graphOrId.id) : "";
    if (!id) return;
    this._graphs.delete(id);
  }

  publishHover({ key, sourceId } = {}) {
    const k = Number(key);
    if (!Number.isFinite(k)) return;
    const src = String(sourceId || "");
    this._hover = { key: k, sourceId: src };
    for (const [id, g] of this._graphs) {
      if (!g || typeof g.setExternalHoverKey !== "function") continue;
      g.setExternalHoverKey(k, { sourceId: src });
      if (id !== src && typeof g.requestRender === "function") g.requestRender();
    }
  }

  clearHover({ sourceId } = {}) {
    const src = String(sourceId || "");
    if (this._hover && this._hover.sourceId && this._hover.sourceId !== src) return;
    this._hover = null;
    for (const g of this._graphs.values()) {
      if (!g || typeof g.clearExternalHover !== "function") continue;
      g.clearExternalHover({ sourceId: src });
      if (typeof g.requestRender === "function") g.requestRender();
    }
  }
}

const DEFAULT_SCALE = "sqrt"; // "sqrt" | "linear"

function phaseIdFromKey(phaseKey, phaseKeys) {
  if (!phaseKey) return 0;
  const idx = phaseKeys.indexOf(String(phaseKey));
  return idx >= 0 ? idx + 1 : 0;
}

export class PerfBarGraph {
  constructor({
    id,
    canvas,
    summaryEl,
    hub,
    phaseKeys,
    phaseColors,
    markerKeys,
    markerColors,
    scale = DEFAULT_SCALE,
    fmt = null, // { bytes(n), rate(n), key(n) }
    valueLabel = "bytes",
    countLabel = "writes",
    rateIncludesCounts = true,
    onRuntime = null,
  } = {}) {
    this.id = String(id || `graph_${Math.random().toString(16).slice(2)}`);
    this.canvas = canvas || null;
    this.summaryEl = summaryEl || null;
    this.hub = hub || null;

    this.phaseKeys = Array.isArray(phaseKeys) ? phaseKeys.map(String) : [];
    this.phaseColors = phaseColors && typeof phaseColors === "object" ? phaseColors : {};
    this.markerKeys = Array.isArray(markerKeys) ? markerKeys.map(String) : [];
    this.markerColors = markerColors && typeof markerColors === "object" ? markerColors : {};

    this.scale = scale === "linear" ? "linear" : DEFAULT_SCALE;
    this.fmt = fmt && typeof fmt === "object" ? fmt : null;
    this.valueLabel = String(valueLabel || "bytes");
    this.countLabel = String(countLabel || "writes");
    this.rateIncludesCounts = !!rateIncludesCounts;
    this.onRuntime = typeof onRuntime === "function" ? onRuntime : null;

    this._bins = 0;
    this._head = 0;
    this._count = 0;
    this._dpr = 1;

    this._keys = null; // Float64Array
    this._ts = null; // Float64Array
    this._total = null; // Float64Array
    this._counts = null; // Uint32Array

    // Stacks by phase: Float64Array(bins * (phaseCount+1)), index 0 unused.
    this._phaseBytes = null;
    this._phaseCounts = null;
    this._dominantPhase = null; // Uint8Array

    // Markers are packed into a bitset per bar (Uint32Array).
    this._markerBits = null;

    this._absMin = null; // Float64Array
    this._absMax = null; // Float64Array
    this._tNsMin = null; // Float64Array (tidx time, ns)
    this._tNsMax = null; // Float64Array (tidx time, ns)

    this._scaleMax = 1;

    this._hover = null; // { x, idx } | null
    this._externalHoverKey = null; // number|null
    this._externalHoverIdx = null; // number|null
    this._raf = null;

    this._frameDtEmaMs = null;

    this._renderLastMs = null;
    this._renderEmaMs = null;
    this._renderMaxMs = null;

    this._bg = "#0e1217";
    this._defaultPhaseColors = {
      playback: cssVar("--good", "#3ddc97"),
      mode1: cssVar("--accent", "#4aa3ff"),
      seek: "#a17cff",
      bulk_seek: cssVar("--bad", "#ff6b6b"),
      none: cssVar("--muted", "#9aa7b4"),
    };

    if (this.canvas) {
      this.canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
      this.canvas.addEventListener("pointerleave", () => this._onPointerLeave());
      this.canvas.addEventListener("pointerdown", (e) => {
        try {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
        } catch {
          // ignore
        }
      });
    }

    this.resize();
    this.clear();
    if (this.hub) this.hub.register(this);
  }

  destroy() {
    if (this.hub) this.hub.unregister(this);
  }

  get bins() {
    return this._bins;
  }

  requestRender() {
    this._scheduleRender();
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
      this._head = 0;
      this._count = 0;

      this._keys = new Float64Array(this._bins);
      this._ts = new Float64Array(this._bins);
      this._total = new Float64Array(this._bins);
      this._counts = new Uint32Array(this._bins);
      this._dominantPhase = new Uint8Array(this._bins);

      const phaseSlots = this.phaseKeys.length + 1;
      this._phaseBytes = new Float64Array(this._bins * phaseSlots);
      this._phaseCounts = new Uint32Array(this._bins * phaseSlots);

      this._markerBits = new Uint32Array(this._bins);
      this._absMin = new Float64Array(this._bins);
      this._absMax = new Float64Array(this._bins);
      this._absMin.fill(Number.NaN);
      this._absMax.fill(Number.NaN);
      this._tNsMin = new Float64Array(this._bins);
      this._tNsMax = new Float64Array(this._bins);
      this._tNsMin.fill(Number.NaN);
      this._tNsMax.fill(Number.NaN);

      this._scaleMax = 1;
      this._frameDtEmaMs = null;
      this._hover = null;
      this._externalHoverIdx = null;
    }

    this._scheduleRender();
  }

  clear() {
    if (this._keys) this._keys.fill(Number.NaN);
    if (this._ts) this._ts.fill(0);
    if (this._total) this._total.fill(0);
    if (this._counts) this._counts.fill(0);
    if (this._dominantPhase) this._dominantPhase.fill(0);
    if (this._phaseBytes) this._phaseBytes.fill(0);
    if (this._phaseCounts) this._phaseCounts.fill(0);
    if (this._markerBits) this._markerBits.fill(0);
    if (this._absMin) this._absMin.fill(Number.NaN);
    if (this._absMax) this._absMax.fill(Number.NaN);
    if (this._tNsMin) this._tNsMin.fill(Number.NaN);
    if (this._tNsMax) this._tNsMax.fill(Number.NaN);
    this._head = 0;
    this._count = 0;
    this._scaleMax = 1;
    this._frameDtEmaMs = null;
    this._hover = null;
    this._externalHoverIdx = null;
    if (this.summaryEl) this.summaryEl.textContent = "No samples yet.";
    if (this.canvas) this.canvas.title = "";
    this._scheduleRender();
  }

  // Starts a new bar (typically one per rAF frame).
  // key is a monotonic id (frameId/time index/etc). Can be NaN to indicate “unkeyed”.
  advance({ key, tsMs } = {}) {
    if (!this._bins || !this._keys || !this._ts || !this._total || !this._counts) return;

    const now = Number.isFinite(tsMs) ? tsMs : performance.now();
    const k = Number(key);

    if (this._count > 0) {
      const prevTs = this._ts[this._head];
      const dt = Number.isFinite(prevTs) && prevTs > 0 ? now - prevTs : null;
      if (dt != null && Number.isFinite(dt) && dt > 0 && dt < 1000) {
        this._frameDtEmaMs = this._frameDtEmaMs == null ? dt : this._frameDtEmaMs * 0.9 + dt * 0.1;
      }
      this._head = (this._head + 1) % this._bins;
      this._count = Math.min(this._bins, this._count + 1);
    } else {
      this._head = 0;
      this._count = 1;
    }

    this._keys[this._head] = Number.isFinite(k) ? k : Number.NaN;
    this._ts[this._head] = now;
    this._total[this._head] = 0;
    this._counts[this._head] = 0;
    this._dominantPhase[this._head] = 0;
    this._markerBits[this._head] = 0;
    this._absMin[this._head] = Number.NaN;
    this._absMax[this._head] = Number.NaN;
    if (this._tNsMin) this._tNsMin[this._head] = Number.NaN;
    if (this._tNsMax) this._tNsMax[this._head] = Number.NaN;

    const phaseSlots = this.phaseKeys.length + 1;
    const base = this._head * phaseSlots;
    for (let i = 0; i < phaseSlots; i++) {
      this._phaseBytes[base + i] = 0;
      this._phaseCounts[base + i] = 0;
    }

    this._scheduleRender();
  }

  // Accumulate into the current bar.
  add({ phase, value = 0, count = 0, absStart = null, absEnd = null, tNs = null } = {}) {
    if (!this._count) {
      this.advance({ key: Number.NaN, tsMs: performance.now() });
    }
    const v = Number(value);
    const c = clampInt(Number(count), 0, 1_000_000_000);
    if (!Number.isFinite(v) || v < 0) return;

    const id = phaseIdFromKey(phase, this.phaseKeys);
    const phaseSlots = this.phaseKeys.length + 1;
    const base = this._head * phaseSlots;

    this._total[this._head] += v;
    this._counts[this._head] += c;
    this._phaseBytes[base + id] += v;
    this._phaseCounts[base + id] += c;

    if (id > 0) {
      const domId = this._dominantPhase[this._head] || 0;
      const domBytes = this._phaseBytes[base + domId] || 0;
      const curBytes = this._phaseBytes[base + id] || 0;
      if (curBytes > domBytes) this._dominantPhase[this._head] = id;
    }

    if (this._absMin && this._absMax) {
      const a = typeof absStart === "bigint" ? Number(absStart) : Number(absStart);
      const z = typeof absEnd === "bigint" ? Number(absEnd) : Number(absEnd);
      if (Number.isFinite(a) && Number.isFinite(z) && a >= 0 && z >= 0) {
        const lo = Math.min(a, z);
        const hi = Math.max(a, z);
        const prevLo = this._absMin[this._head];
        const prevHi = this._absMax[this._head];
        this._absMin[this._head] = Number.isNaN(prevLo) ? lo : Math.min(prevLo, lo);
        this._absMax[this._head] = Number.isNaN(prevHi) ? hi : Math.max(prevHi, hi);
      }
    }

    if (this._tNsMin && this._tNsMax) {
      const tn = typeof tNs === "bigint" ? Number(tNs) : Number(tNs);
      if (Number.isFinite(tn) && tn >= 0) {
        const prevLo = this._tNsMin[this._head];
        const prevHi = this._tNsMax[this._head];
        this._tNsMin[this._head] = Number.isNaN(prevLo) ? tn : Math.min(prevLo, tn);
        this._tNsMax[this._head] = Number.isNaN(prevHi) ? tn : Math.max(prevHi, tn);
      }
    }

    this._scheduleRender();
  }

  mark(markerKey) {
    if (!this._count) {
      this.advance({ key: Number.NaN, tsMs: performance.now() });
    }
    const idx = this.markerKeys.indexOf(String(markerKey));
    if (idx < 0 || idx >= 31) return;
    this._markerBits[this._head] |= 1 << idx;
    this._scheduleRender();
  }

  setExternalHoverKey(key, { sourceId } = {}) {
    const k = Number(key);
    if (!Number.isFinite(k)) {
      this._externalHoverKey = null;
      this._externalHoverIdx = null;
      return;
    }
    if (String(sourceId || "") === this.id) return;
    this._externalHoverKey = k;
    this._externalHoverIdx = this._findClosestIdxByKey(k);
  }

  clearExternalHover({ sourceId } = {}) {
    if (String(sourceId || "") && String(sourceId || "") !== this.id) {
      this._externalHoverKey = null;
      this._externalHoverIdx = null;
    }
  }

  _findClosestIdxByKey(key) {
    if (!this._keys || this._count <= 0) return null;
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let x = 0; x < this._count; x++) {
      const idx = (this._head - (this._count - 1) + x + this._bins) % this._bins; // oldest -> newest
      const k = this._keys[idx];
      if (!Number.isFinite(k)) continue;
      const d = Math.abs(k - key);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
        if (d === 0) break;
      }
    }
    return best;
  }

  _pickHoverFromEvent(e) {
    const c = this.canvas;
    if (!c || !this._bins || !this._count) return null;
    const rect = c.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) return null;
    const xCss = clampInt(Math.floor(e.clientX - rect.left), 0, this._bins - 1);
    const idx = (this._head + 1 + xCss) % this._bins;
    return { x: xCss, idx };
  }

  _onPointerMove(e) {
    const picked = this._pickHoverFromEvent(e);
    if (!picked) return;
    if (this._hover && this._hover.x === picked.x && this._hover.idx === picked.idx) return;
    this._hover = picked;

    if (this.hub && this._keys) {
      const k = this._keys[picked.idx];
      if (Number.isFinite(k)) this.hub.publishHover({ key: k, sourceId: this.id });
    }

    this._scheduleRender();
  }

  _onPointerLeave() {
    this._hover = null;
    if (this.canvas) this.canvas.title = "";
    if (this.hub) this.hub.clearHover({ sourceId: this.id });
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._raf != null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.render();
    });
  }

  _phaseColorById(id) {
    if (id <= 0) return this._defaultPhaseColors.none;
    const key = this.phaseKeys[id - 1] || "";
    return this.phaseColors[key] || this._defaultPhaseColors[key] || this._defaultPhaseColors.none;
  }

  _markerColorById(id) {
    const key = this.markerKeys[id - 1] || "";
    return this.markerColors[key] || "rgba(255,255,255,0.55)";
  }

  render() {
    const t0 = performance.now();
    const c = this.canvas;
    if (!c || !this._total || !this._counts || !this._dominantPhase) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const w = c.width;
    const h = c.height;
    const barW = Math.max(1, Math.floor(this._dpr));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, w, h);

    let maxVal = 1;
    for (let i = 0; i < this._bins; i++) {
      const v = this._total[i] || 0;
      if (v > maxVal) maxVal = v;
    }
    this._scaleMax = Math.max(maxVal, Math.floor(this._scaleMax * 0.95));
    const denom = Math.max(1, this._scaleMax);
    const denomScaled = this.scale === "sqrt" ? Math.sqrt(denom) : denom;

    const hoverX = this._hover ? this._hover.x : null;
    for (let x = 0; x < this._bins; x++) {
      const idx = (this._head + 1 + x) % this._bins;
      const total = this._total[idx] || 0;
      const markers = this._markerBits ? this._markerBits[idx] : 0;
      if (total <= 0 && !markers) continue;

      const scaled = this.scale === "sqrt" ? Math.sqrt(total) : total;
      const yTotal = Math.max(1, Math.round((scaled / Math.max(1, denomScaled)) * h));
      const x0 = x * barW;

      // Stacked phases.
      const phaseSlots = this.phaseKeys.length + 1;
      const base = idx * phaseSlots;
      let remaining = yTotal;
      let yCursor = h;
      for (let pid = phaseSlots - 1; pid >= 1; pid--) {
        const pv = this._phaseBytes ? this._phaseBytes[base + pid] || 0 : 0;
        if (pv <= 0) continue;
        const left = pid - 1;
        let segH = pid === 1 ? remaining : Math.max(1, Math.floor((yTotal * pv) / Math.max(1, total)));
        segH = Math.min(segH, Math.max(1, remaining - left));
        ctx.fillStyle = this._phaseColorById(pid);
        ctx.fillRect(x0, yCursor - segH, barW, segH);
        yCursor -= segH;
        remaining -= segH;
        if (remaining <= 0) break;
      }

      // Marker ticks (top edge).
      if (markers) {
        const tickH = Math.max(1, Math.floor(6 * this._dpr));
        for (let mi = 0; mi < this.markerKeys.length && mi < 31; mi++) {
          if (!(markers & (1 << mi))) continue;
          ctx.fillStyle = this._markerColorById(mi + 1);
          ctx.fillRect(x0, 0, barW, tickH);
        }
      }
    }

    // Hover highlight (even on “empty” bars).
    if (hoverX != null) {
      const x0 = hoverX * barW;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x0, 0, Math.max(1, barW), h);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(1, Math.floor(this._dpr));
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, barW) - 1, h - 1);
    }

    // External hover highlight.
    if (this._externalHoverKey != null && this._keys) {
      const extKey = this._externalHoverKey;
      let matches = 0;
      for (let x = 0; x < this._bins; x++) {
        const at = (this._head + 1 + x) % this._bins;
        const k = this._keys[at];
        if (!Number.isFinite(k)) continue;
        if (Math.abs(k - extKey) > 0.5) continue;
        const x0 = x * barW;
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(x0, 0, Math.max(1, barW), h);
        matches++;
      }
      if (!matches && this._externalHoverIdx != null) {
        const idx = this._externalHoverIdx;
        // Find the x position for this idx (scan visible x; bins are small).
        let xFound = null;
        for (let x = 0; x < this._bins; x++) {
          const at = (this._head + 1 + x) % this._bins;
          if (at === idx) {
            xFound = x;
            break;
          }
        }
        if (xFound != null) {
          const x0 = xFound * barW;
          ctx.fillStyle = "rgba(255,255,255,0.14)";
          ctx.fillRect(x0, 0, Math.max(1, barW), h);
          ctx.strokeStyle = "rgba(255,255,255,0.30)";
          ctx.lineWidth = Math.max(1, Math.floor(this._dpr));
          ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, barW) - 1, h - 1);
        }
      }
    } else if (this._externalHoverIdx != null) {
      const idx = this._externalHoverIdx;
      // Find the x position for this idx (scan visible x; bins are small).
      let xFound = null;
      for (let x = 0; x < this._bins; x++) {
        const at = (this._head + 1 + x) % this._bins;
        if (at === idx) {
          xFound = x;
          break;
        }
      }
      if (xFound != null) {
        const x0 = xFound * barW;
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(x0, 0, Math.max(1, barW), h);
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
        ctx.lineWidth = Math.max(1, Math.floor(this._dpr));
        ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, barW) - 1, h - 1);
      }
    }

    // Summary + runtime export.
    const nowTs = this._count ? this._ts[this._head] : performance.now();
    let bytes1s = 0;
    let writes1s = 0;
    if (this._count && this._ts) {
      for (let i = 0; i < this._count; i++) {
        const idx = (this._head - i + this._bins) % this._bins;
        const ts = this._ts[idx] || 0;
        if (!ts) break;
        if (nowTs - ts > 1000) break;
        bytes1s += this._total[idx] || 0;
        writes1s += this._counts[idx] || 0;
      }
    }

    let windowBytes = 0;
    let windowWrites = 0;
    for (let i = 0; i < this._bins; i++) {
      windowBytes += this._total[i] || 0;
      windowWrites += this._counts[i] || 0;
    }

    const frameMs = this._frameDtEmaMs;
    const hz = frameMs && frameMs > 0 ? 1000 / frameMs : null;

    const hover = this._hover && this._count ? this._hover : null;
    let hoverRuntime = null;
    let hoverNote = "";
    if (hover && this._ts && this._keys) {
      const idx = hover.idx;
      const ts = this._ts[idx] || 0;
      const ageMs = ts ? Math.max(0, nowTs - ts) : null;
      const b = this._total[idx] || 0;
      const writes = this._counts[idx] || 0;
      const k = this._keys[idx];
      const dom = this._dominantPhase[idx] || 0;
      const domKey = dom > 0 ? this.phaseKeys[dom - 1] : "none";
      const dtPrev = (() => {
        // idx=(head+1+x); prev is (head+x)
        const x = hover.x;
        if (!this._ts || x <= 0) return null;
        const prevIdx = (this._head + x) % this._bins;
        const prevTs = this._ts[prevIdx] || 0;
        if (prevTs && ts && ts >= prevTs) return ts - prevTs;
        return null;
      })();

      const absMin = this._absMin ? this._absMin[idx] : Number.NaN;
      const absMax = this._absMax ? this._absMax[idx] : Number.NaN;
      const absNote =
        Number.isFinite(absMin) && Number.isFinite(absMax) && this.fmt && this.fmt.bytes
          ? ` abs=[${this.fmt.bytes(absMin)}..${this.fmt.bytes(absMax)}]`
          : "";

      const tNsMin = this._tNsMin ? this._tNsMin[idx] : Number.NaN;
      const tNsMax = this._tNsMax ? this._tNsMax[idx] : Number.NaN;
      const timeFmt = this.fmt && typeof this.fmt.timeNs === "function" ? this.fmt.timeNs : null;
      const timeNote = (() => {
        if (!Number.isFinite(tNsMin) || !Number.isFinite(tNsMax)) return "";
        if (!timeFmt) return ` tNs=[${tNsMin.toFixed(0)}..${tNsMax.toFixed(0)}]`;
        const a = timeFmt(BigInt(Math.floor(tNsMin)));
        const b = timeFmt(BigInt(Math.floor(tNsMax)));
        const dt = tNsMax >= tNsMin ? timeFmt(BigInt(Math.floor(tNsMax - tNsMin))) : null;
        if (tNsMin === tNsMax) return ` t=${a}`;
        return ` t=[${a}..${b}] dt=${dt ?? "?"}`;
      })();

      let mixNote = "";
      if (this._phaseBytes && this._phaseCounts) {
        const phaseSlots = this.phaseKeys.length + 1;
        const base = idx * phaseSlots;
        const parts = [];
        for (let pid = 1; pid < phaseSlots; pid++) {
          const pb = this._phaseBytes[base + pid] || 0;
          const pc = this._phaseCounts[base + pid] || 0;
          if (pb <= 0 && pc <= 0) continue;
          const label = this.phaseKeys[pid - 1] || "?";
          parts.push(
            `${label}:${this.fmt && this.fmt.bytes ? this.fmt.bytes(pb) : pb.toFixed(0)}(${pc})`,
          );
        }
        if (parts.length > 1) mixNote = ` mix=${parts.join(" ")}`;
      }

      let markersNote = "";
      let markerKeys = null;
      if (this._markerBits && this.markerKeys && this.markerKeys.length) {
        const bits = this._markerBits[idx] || 0;
        if (bits) {
          const keys = [];
          for (let mi = 0; mi < this.markerKeys.length && mi < 31; mi++) {
            if (bits & (1 << mi)) keys.push(this.markerKeys[mi]);
          }
          if (keys.length) {
            markerKeys = keys;
            markersNote = ` markers=${keys.join(",")}`;
          }
        }
      }

      hoverNote =
        `hover key=${Number.isFinite(k) ? k : "?"}` +
        ` t-${ageMs != null ? ageMs.toFixed(0) : "?"}ms` +
        ` ${this.valueLabel}=${this.fmt && this.fmt.bytes ? this.fmt.bytes(b) : b.toFixed(0)}` +
        ` ${this.countLabel}=${writes}` +
        ` phase=${domKey}` +
        `${dtPrev != null ? ` dt=${dtPrev.toFixed(1)}ms` : ""}` +
        `${absNote ? ` ${absNote}` : ""}` +
        `${timeNote ? ` ${timeNote.trim()}` : ""}` +
        `${mixNote}` +
        `${markersNote}`;
      hoverRuntime = {
        key: Number.isFinite(k) ? k : null,
        ageMsAgo: ageMs != null ? Math.max(0, ageMs) : null,
        dtPrevMs: dtPrev != null ? Math.max(0, dtPrev) : null,
        bytes: b,
        writes,
        phase: domKey,
        markers: markerKeys,
        absMin: Number.isFinite(absMin) ? absMin : null,
        absMax: Number.isFinite(absMax) ? absMax : null,
        tNsMin: Number.isFinite(tNsMin) ? tNsMin : null,
        tNsMax: Number.isFinite(tNsMax) ? tNsMax : null,
      };

      if (this.canvas) this.canvas.title = hoverNote;
    } else if (this.canvas && this.canvas.title) {
      this.canvas.title = "";
    }

    const lastIdx = this._count ? this._head : null;
    const last = lastIdx != null ? { key: this._keys[lastIdx], tsMs: this._ts[lastIdx] } : null;
    const lastNote = last && Number.isFinite(last.key) ? `lastKey=${last.key}` : "lastKey=?";
    const rateBase =
      this.fmt && this.fmt.rate
        ? this.fmt.rate(bytes1s, {
            counts1s: writes1s,
            frameDtEmaMs: this._frameDtEmaMs,
            frameHzEma: hz,
          })
        : `1s=${bytes1s}`;
    const rateNote = this.rateIncludesCounts ? `${rateBase} (${writes1s}/s)` : rateBase;
    const binNote = `frame≈${frameMs != null ? frameMs.toFixed(1) : "?"}ms${hz ? ` (${hz.toFixed(1)}Hz)` : ""} bars=${this._count}/${this._bins}`;

    const summary = hoverNote
      ? `${hoverNote} • ${rateNote} • window=${this.fmt && this.fmt.bytes ? this.fmt.bytes(windowBytes) : windowBytes} (${windowWrites} writes) • ${binNote}`
      : `${lastNote} • ${rateNote} • window=${this.fmt && this.fmt.bytes ? this.fmt.bytes(windowBytes) : windowBytes} (${windowWrites} writes) • ${binNote}`;
    if (this.summaryEl) this.summaryEl.textContent = summary;

    const renderMs = performance.now() - t0;
    this._renderLastMs = renderMs;
    this._renderEmaMs = this._renderEmaMs == null ? renderMs : this._renderEmaMs * 0.9 + renderMs * 0.1;
    this._renderMaxMs = this._renderMaxMs == null ? renderMs : Math.max(this._renderMaxMs, renderMs);

    const runtime = {
      mode: "bars",
      bars: { count: this._count, capacity: this._bins },
      frameDtEmaMs: this._frameDtEmaMs,
      frameHzEma: hz,
      scaleMax: this._scaleMax,
      render: { lastMs: this._renderLastMs, emaMs: this._renderEmaMs, maxMs: this._renderMaxMs },
      hover: hoverRuntime,
    };
    if (this.onRuntime) this.onRuntime(runtime);
  }
}
