import { toBigInt } from "./uleb128.js";

export function* segmentOutputByResizeEvents(u8, resizeEvents, { baseOffset = 0n } = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError("u8 must be a Uint8Array");
  const base = toBigInt(baseOffset, "baseOffset");
  const endAbs = base + BigInt(u8.length);

  let cursorAbs = base;
  let cursorLocal = 0;

  const events = Array.isArray(resizeEvents) ? resizeEvents : [];
  let i = 0;

  while (i < events.length && BigInt(events[i].streamOffset) < base) i++;

  while (cursorAbs < endAbs) {
    const nextEv = i < events.length ? events[i] : null;
    const nextEvAbs = nextEv ? BigInt(nextEv.streamOffset) : null;

    if (nextEvAbs != null && nextEvAbs < endAbs && nextEvAbs <= cursorAbs) {
      yield { kind: "event", event: nextEv };
      i++;
      continue;
    }

    const nextCutAbs = nextEvAbs != null && nextEvAbs < endAbs ? nextEvAbs : endAbs;
    const take = Number(nextCutAbs - cursorAbs);
    if (take <= 0) break;
    const chunk = u8.subarray(cursorLocal, cursorLocal + take);
    yield { kind: "bytes", bytes: chunk };
    cursorLocal += take;
    cursorAbs += BigInt(take);
  }

  while (i < events.length && BigInt(events[i].streamOffset) === endAbs) {
    yield { kind: "event", event: events[i++] };
  }
}

