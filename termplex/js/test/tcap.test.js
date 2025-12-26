import assert from "node:assert/strict";
import test from "node:test";

import {
  lastResizeBeforeOffset,
  normalizeResizeEvents,
  offsetAtTimeNs,
  parseEventsJsonl,
  parseTidx,
  segmentOutputByResizeEvents,
  timeAtOffsetNs,
  truncateTidxToRawLength,
  uleb128Decode,
  uleb128Encode,
  toBigInt,
} from "../tcap/index.js";

function u8(...bytes) {
  return Uint8Array.from(bytes);
}

function concatU8(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

test("uleb128 roundtrips common values", () => {
  const values = [0n, 1n, 2n, 3n, 127n, 128n, 129n, 300n, 16_384n, 4_294_967_295n];
  for (const v of values) {
    const enc = uleb128Encode(v);
    const dec = uleb128Decode(enc, 0);
    assert.equal(dec.value, v);
    assert.equal(dec.next, enc.length);
  }
});

test("uleb128 rejects truncated and overflow", () => {
  assert.throws(() => uleb128Decode(u8(0x80), 0), /truncated/);
  assert.throws(() => uleb128Decode(u8(0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80), 0), /overflow/);
});

test("parseTidx decodes records and tolerates trailing partial record", () => {
  const header = concatU8(
    u8(...Buffer.from("TIDX1", "ascii")),
    u8(0x00),
    u8(1, 0, 0, 0, 0, 0, 0, 0), // startedAtUnixNs=1
  );
  const rec1 = concatU8(uleb128Encode(10n), uleb128Encode(3n)); // t=10,end=3
  const rec2partial = u8(0x80); // truncated varint
  const tidx = concatU8(header, rec1, rec2partial);

  const parsed = parseTidx(tidx, { allowTrailingPartial: true });
  assert.equal(parsed.flags, 0);
  assert.equal(parsed.startedAtUnixNs, 1n);
  assert.deepEqual(parsed.tNs, [10n]);
  assert.deepEqual(parsed.endOffsets, [3n]);
});

test("parseTidx can be strict about trailing partial records", () => {
  const header = concatU8(
    u8(...Buffer.from("TIDX1", "ascii")),
    u8(0x00),
    u8(1, 0, 0, 0, 0, 0, 0, 0), // startedAtUnixNs=1
  );
  const rec1 = concatU8(uleb128Encode(10n), uleb128Encode(3n)); // t=10,end=3
  const rec2partial = u8(0x80); // truncated varint
  const tidx = concatU8(header, rec1, rec2partial);
  assert.throws(() => parseTidx(tidx, { allowTrailingPartial: false }), /truncated/);
});

test("parseTidx rejects non-zero flags by default", () => {
  const tidx = concatU8(
    u8(...Buffer.from("TIDX1", "ascii")),
    u8(0x01),
    u8(0, 0, 0, 0, 0, 0, 0, 0),
  );
  assert.throws(() => parseTidx(tidx), /flags/);
});

test("truncateTidxToRawLength drops records beyond raw length", () => {
  const header = concatU8(
    u8(...Buffer.from("TIDX1", "ascii")),
    u8(0x00),
    u8(0, 0, 0, 0, 0, 0, 0, 0),
  );
  const recs = concatU8(
    uleb128Encode(1n),
    uleb128Encode(5n), // end=5
    uleb128Encode(1n),
    uleb128Encode(5n), // end=10
    uleb128Encode(1n),
    uleb128Encode(10n), // end=20
  );
  const parsed = parseTidx(concatU8(header, recs));
  const truncated = truncateTidxToRawLength(parsed, 12n);
  assert.deepEqual(truncated.endOffsets, [5n, 10n]);
});

test("offsetAtTimeNs and timeAtOffsetNs follow TCAP seek invariants", () => {
  const tidx = {
    tNs: [10n, 20n, 30n],
    endOffsets: [5n, 10n, 15n],
  };
  assert.equal(offsetAtTimeNs(tidx, 0n), 0n);
  assert.equal(offsetAtTimeNs(tidx, 1n), 5n);
  assert.equal(offsetAtTimeNs(tidx, 10n), 5n);
  assert.equal(offsetAtTimeNs(tidx, 11n), 10n);
  assert.equal(offsetAtTimeNs(tidx, 100n), 15n);

  assert.equal(timeAtOffsetNs(tidx, 0n), 0n);
  assert.equal(timeAtOffsetNs(tidx, 1n), 10n);
  assert.equal(timeAtOffsetNs(tidx, 5n), 10n);
  assert.equal(timeAtOffsetNs(tidx, 6n), 20n);
  assert.equal(timeAtOffsetNs(tidx, 999n), 30n);
});

test("parseEventsJsonl + normalizeResizeEvents sorts by stream_offset then time", () => {
  const txt = [
    '{"type":"resize","t_ns":5,"stream":"output","stream_offset":3,"cols":80,"rows":24}',
    '{"type":"resize","t_ns":2,"stream":"output","stream_offset":1,"cols":81,"rows":25}',
    '{"type":"resize","t_ns":3,"stream":"output","stream_offset":1,"cols":82,"rows":26}',
  ].join("\n");
  const events = normalizeResizeEvents(parseEventsJsonl(txt));
  assert.deepEqual(
    events.map((e) => [e.streamOffset, e.tNs, e.cols, e.rows]),
    [
      [1n, 2n, 81, 25],
      [1n, 3n, 82, 26],
      [3n, 5n, 80, 24],
    ],
  );
});

test("parseEventsJsonl ignores invalid JSON lines", () => {
  const txt = [
    "{",
    '{"type":"resize","t_ns":1,"stream":"output","stream_offset":0,"cols":80,"rows":24}',
  ].join("\n");
  const events = parseEventsJsonl(txt);
  assert.equal(events.length, 1);
  assert.equal(events[0].cols, 80);
});

test("lastResizeBeforeOffset returns last event with streamOffset < start", () => {
  const events = normalizeResizeEvents(
    parseEventsJsonl(
      [
        '{"type":"resize","t_ns":1,"stream":"output","stream_offset":0,"cols":80,"rows":24}',
        '{"type":"resize","t_ns":2,"stream":"output","stream_offset":10,"cols":90,"rows":30}',
      ].join("\n"),
    ),
  );
  assert.equal(lastResizeBeforeOffset(events, 0n), null);
  assert.equal(lastResizeBeforeOffset(events, 1n).cols, 80);
  assert.equal(lastResizeBeforeOffset(events, 10n).cols, 80);
  assert.equal(lastResizeBeforeOffset(events, 11n).cols, 90);
});

test("segmentOutputByResizeEvents interleaves events before targeted bytes", () => {
  const bytes = new TextEncoder().encode("abcdef");
  const events = normalizeResizeEvents(
    parseEventsJsonl(
      [
        '{"type":"resize","t_ns":1,"stream":"output","stream_offset":0,"cols":1,"rows":1}',
        '{"type":"resize","t_ns":2,"stream":"output","stream_offset":3,"cols":2,"rows":2}',
        '{"type":"resize","t_ns":3,"stream":"output","stream_offset":3,"cols":3,"rows":3}',
      ].join("\n"),
    ),
  );

  const segs = Array.from(segmentOutputByResizeEvents(bytes, events, { baseOffset: 0n }));
  assert.equal(segs[0].kind, "event");
  assert.equal(segs[1].kind, "bytes");
  assert.equal(new TextDecoder().decode(segs[1].bytes), "abc");
  assert.equal(segs[2].kind, "event");
  assert.equal(segs[3].kind, "event");
  assert.equal(segs[4].kind, "bytes");
  assert.equal(new TextDecoder().decode(segs[4].bytes), "def");
});

test("segmentOutputByResizeEvents yields events at end offset after bytes", () => {
  const bytes = new TextEncoder().encode("a");
  const events = normalizeResizeEvents(
    parseEventsJsonl('{"type":"resize","t_ns":1,"stream":"output","stream_offset":1,"cols":1,"rows":1}'),
  );
  const segs = Array.from(segmentOutputByResizeEvents(bytes, events, { baseOffset: 0n }));
  assert.equal(segs[0].kind, "bytes");
  assert.equal(segs[1].kind, "event");
  assert.equal(segs[1].event.cols, 1);
});

test("toBigInt rejects negative / non-integer inputs", () => {
  assert.throws(() => toBigInt(-1, "x"), /non-negative/);
  assert.throws(() => toBigInt(1.5, "x"), /non-negative/);
  assert.throws(() => toBigInt("1", "x"), /non-negative/);
});
