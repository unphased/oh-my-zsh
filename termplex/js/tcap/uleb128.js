export function toBigInt(value, label = "value") {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`${label} must be a non-negative integer (number or bigint)`);
}

export function assertU64(value, label = "value") {
  const v = toBigInt(value, label);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new RangeError(`${label} out of u64 range`);
  return v;
}

export function uleb128Encode(value) {
  let v = assertU64(value, "uleb128 value");
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return Uint8Array.from(out);
}

export function uleb128Decode(u8, offset = 0) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError("u8 must be a Uint8Array");
  if (!Number.isInteger(offset) || offset < 0 || offset > u8.length) throw new RangeError("bad offset");

  let result = 0n;
  let shift = 0n;
  let i = offset;

  while (i < u8.length) {
    const byte = u8[i++];
    const payload = BigInt(byte & 0x7f);
    result |= payload << shift;

    if ((byte & 0x80) === 0) {
      if (result > 0xffff_ffff_ffff_ffffn) throw new RangeError("uleb128 overflow (u64)");
      return { value: result, next: i };
    }

    shift += 7n;
    if (shift >= 64n) throw new RangeError("uleb128 overflow (shift>=64)");
  }

  throw new RangeError("uleb128 truncated");
}

export function readU64LE(u8, offset = 0) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError("u8 must be a Uint8Array");
  if (!Number.isInteger(offset) || offset < 0 || offset + 8 > u8.length) throw new RangeError("bad offset");
  let v = 0n;
  for (let i = 0; i < 8; i++) v |= BigInt(u8[offset + i]) << BigInt(i * 8);
  return v;
}

