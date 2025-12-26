import { toBigInt } from "./uleb128.js";

export function parseEventsJsonl(text) {
  if (typeof text !== "string") throw new TypeError("events text must be a string");
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    if (obj.type !== "resize") continue;
    if (obj.stream !== "output") continue;

    const tNs = typeof obj.t_ns === "bigint" ? obj.t_ns : Number.isFinite(obj.t_ns) ? BigInt(obj.t_ns) : null;
    const streamOffset =
      typeof obj.stream_offset === "bigint"
        ? obj.stream_offset
        : Number.isFinite(obj.stream_offset)
          ? BigInt(obj.stream_offset)
          : null;
    if (tNs == null || streamOffset == null) continue;
    if (!Number.isFinite(obj.cols) || !Number.isFinite(obj.rows)) continue;

    events.push({
      type: "resize",
      stream: "output",
      tNs,
      streamOffset,
      cols: Math.floor(obj.cols),
      rows: Math.floor(obj.rows),
      _i: i,
    });
  }

  return events;
}

export function normalizeResizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return [...events]
    .filter((e) => e && e.type === "resize" && e.stream === "output")
    .sort((a, b) => {
      const ao = BigInt(a.streamOffset);
      const bo = BigInt(b.streamOffset);
      if (ao < bo) return -1;
      if (ao > bo) return 1;
      const at = BigInt(a.tNs);
      const bt = BigInt(b.tNs);
      if (at < bt) return -1;
      if (at > bt) return 1;
      return (a._i ?? 0) - (b._i ?? 0);
    })
    .map(({ _i, ...rest }) => rest);
}

export function lastResizeBeforeOffset(events, offset) {
  const off = toBigInt(offset, "offset");
  let best = null;
  for (const ev of events || []) {
    if (!ev || ev.type !== "resize" || ev.stream !== "output") continue;
    const eo = BigInt(ev.streamOffset);
    if (eo < off) best = ev;
    else break;
  }
  return best;
}

