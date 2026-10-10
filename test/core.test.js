import test from "node:test";
import assert from "node:assert/strict";
import {
  roomCode,
  newRoomCode,
  videoId,
  clockSample,
  estimateClock,
  playbackPlan,
  positionAt,
  Transfer,
  CHUNK_BYTES,
  MAX_FILE_BYTES,
  digest,
} from "../src/core.js";
import { AudioEngine, testTone } from "../src/audio.js";

test("generated room codes, typed codes and full invites agree", () => {
  for (let i = 0; i < 100; i++)
    assert.equal(roomCode(newRoomCode())?.length, 8);
  assert.equal(roomCode(" k7m2-w9rp "), "K7M2W9RP");
  assert.equal(
    roomCode("https://example.org/flash-speaker/?room=K7M2W9RP"),
    "K7M2W9RP",
  );
  for (const value of [
    "ABC123",
    "123456789",
    "<script>",
    "https://example.org/?other=ABC12345",
  ])
    assert.equal(roomCode(value), null);
});
test("video IDs accept supported links without accepting lookalike domains", () => {
  for (const url of [
    "dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=1",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
  ])
    assert.equal(videoId(url), "dQw4w9WgXcQ");
  assert.equal(
    videoId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"),
    null,
  );
});
test("clock estimation removes processing time and resists slow outliers", () => {
  assert.deepEqual(clockSample(1000, 1120, 1125, 1045), {
    rtt: 40,
    offset: 100,
  });
  assert.equal(clockSample(1000, 1120, 1125, 999), null);
  assert.equal(clockSample(0, NaN, 1, 2), null);
  const estimate = estimateClock([
    { rtt: 10, offset: 100 },
    { rtt: 12, offset: 102 },
    { rtt: 11, offset: 101 },
    { rtt: 1800, offset: 800 },
  ]);
  assert.equal(estimate.offset, 101);
  assert.equal(estimate.rtt, 11);
  assert.throws(() => estimateClock([{ rtt: 1, offset: 0 }]), /Not enough/);
});
test("playback scheduling compensates for late commands, offset and adjustment", () => {
  assert.deepEqual(playbackPlan(2000, 3, 1000, 100, 50, 10), {
    delay: 0.95,
    position: 3,
    ended: false,
  });
  assert.deepEqual(playbackPlan(2000, 3, 2500, 100, 0, 10), {
    delay: 0,
    position: 3.6,
    ended: false,
  });
  assert.equal(playbackPlan(2000, 9, 4000, 0, 0, 10).ended, true);
  assert.equal(
    positionAt({ playing: true, position: 2, target: 2000 }, 1000),
    2,
  );
  assert.equal(
    positionAt({ playing: false, position: 2, target: 2000 }, 5000),
    2,
  );
});
test("file transfer verifies size, order, duplicate handling and checksum", async () => {
  const bytes = new Uint8Array(CHUNK_BYTES + 7);
  bytes.fill(31);
  bytes[0] = 3;
  const hash = await digest(bytes),
    meta = { id: "track", bytes: bytes.length, chunks: 2, hash };
  const transfer = new Transfer(meta);
  assert.equal(transfer.add("old-track", 999, new Uint8Array()), false);
  transfer.add("track", 1, bytes.slice(CHUNK_BYTES));
  assert.equal(transfer.add("track", 1, bytes.slice(CHUNK_BYTES)), false);
  assert.throws(() => transfer.finish(), /incomplete/);
  assert.throws(() => transfer.add("track", 0, new Uint8Array(1)), /size/);
  assert.throws(() => transfer.add("track", 2, new Uint8Array(7)), /index/);
  transfer.add("track", 0, bytes.slice(0, CHUNK_BYTES));
  const result = transfer.finish();
  assert.deepEqual(new Uint8Array(result), bytes);
  assert.equal(await digest(result), hash);
  assert.throws(
    () => new Transfer({ ...meta, bytes: MAX_FILE_BYTES + 1 }),
    /metadata/,
  );
  assert.throws(() => new Transfer({ ...meta, chunks: 1000000 }), /metadata/);
});
test("test tone is a valid eight-second PCM WAV", () => {
  const bytes = testTone(),
    view = new DataView(bytes);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 44100 * 8 * 2);
  assert.equal(bytes.byteLength, 44 + 44100 * 8 * 2);
});
test("audio stop cancels scheduled sources; channel routing handles mono files", () => {
  const nodes = [];
  const node = () => {
    const n = {
      connections: [],
      connect(...args) {
        this.connections.push(args);
      },
      disconnect() {
        this.connections = [];
      },
      stop() {
        this.stopped = true;
      },
      start(...args) {
        this.started = args;
      },
      gain: { value: 0, setTargetAtTime() {} },
    };
    nodes.push(n);
    return n;
  };
  const engine = new AudioEngine(() =>
    assert.fail("Cancelled sources must not fire completion"),
  );
  engine.context = {
    state: "running",
    currentTime: 5,
    destination: {},
    createBufferSource: node,
    createGain: node,
    createChannelSplitter: node,
    createChannelMerger: node,
  };
  engine.buffer = { duration: 8, numberOfChannels: 1 };
  engine.setOutput(0.5, "right");
  engine.play(performance.timeOrigin + performance.now() + 2000, 0);
  const source = engine.source;
  assert.ok(source.started[0] >= 6.9);
  assert.equal(source.started[1], 0);
  assert.deepEqual(engine.splitter.connections[0].slice(1), [0, 1]);
  engine.stop();
  assert.equal(source.stopped, true);
  assert.equal(source.onended, null);
  assert.equal(engine.anchor, null);
});
