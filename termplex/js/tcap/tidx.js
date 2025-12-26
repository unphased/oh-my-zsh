import { readU64LE, toBigInt, uleb128Decode } from "./uleb128.js";

export function parseTidx(u8, { allowUnknownFlags = false, allowTrailingPartial = true } = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError("tidx must be a Uint8Array");
  if (u8.length < 14) throw new Error("tidx too short");

  const magic = new TextDecoder().decode(u8.subarray(0, 5));
  if (magic !== "TIDX1") throw new Error("bad tidx magic");

  const flags = u8[5];
  if (!allowUnknownFlags && flags !== 0) throw new Error(`unsupported tidx flags: ${flags}`);

  const startedAtUnixNs = readU64LE(u8, 6);

  let off = 14;
  let t = 0n;
  let end = 0n;
  const tNs = [];
  const endOffsets = [];

  while (off < u8.length) {
    let dt;
    let dend;

    try {
      const a = uleb128Decode(u8, off);
      off = a.next;
      const b = uleb128Decode(u8, off);
      off = b.next;
      dt = a.value;
      dend = b.value;
    } catch (err) {
      if (allowTrailingPartial && err instanceof RangeError && String(err.message).includes("truncated")) break;
      throw err;
    }

    t += dt;
    end += dend;
    tNs.push(t);
    endOffsets.push(end);
  }

  return { magic: "TIDX1", flags, startedAtUnixNs, tNs, endOffsets };
}

export function truncateTidxToRawLength(tidx, rawLength) {
  if (!tidx || typeof tidx !== "object") throw new TypeError("tidx must be an object");
  const len = toBigInt(rawLength, "rawLength");
  const tNs = [];
  const endOffsets = [];
  for (let i = 0; i < tidx.endOffsets.length; i++) {
    const end = BigInt(tidx.endOffsets[i]);
    if (end > len) break;
    tNs.push(BigInt(tidx.tNs[i]));
    endOffsets.push(end);
  }
  return { ...tidx, tNs, endOffsets };
}

export function offsetAtTimeNs(tidx, tNs) {
  const T = toBigInt(tNs, "tNs");
  const tArr = tidx.tNs;
  if (!tArr.length) return 0n;
  if (T <= 0n) return 0n;

  let lo = 0;
  let hi = tArr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (BigInt(tArr[mid]) >= T) hi = mid;
    else lo = mid + 1;
  }
  return BigInt(tidx.endOffsets[lo] ?? 0n);
}

export function timeAtOffsetNs(tidx, offset) {
  const off = toBigInt(offset, "offset");
  const arr = tidx.endOffsets;
  if (!arr.length) return 0n;
  if (off <= 0n) return 0n;

  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (BigInt(arr[mid]) >= off) hi = mid;
    else lo = mid + 1;
  }
  return BigInt(tidx.tNs[lo] ?? 0n);
}

