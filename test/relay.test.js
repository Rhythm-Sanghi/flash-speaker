import test from "node:test";
import assert from "node:assert/strict";
import { RoomRouter } from "../relay/router.js";
const socket = () => ({
  readyState: 1,
  messages: [],
  send(value) {
    this.messages.push(JSON.parse(value));
  },
  close(code) {
    this.readyState = 3;
    this.code = code;
  },
});
const join = (router, ws, role, id = "guest", room = "ABCDEFGH") =>
  router.receive(ws, {
    type: "join",
    protocol: 1,
    room,
    role,
    id,
    key: "a".repeat(40),
  });
test("relay binds sender identity and prevents guest-to-guest commands", () => {
  const router = new RoomRouter(),
    host = socket(),
    a = socket(),
    b = socket();
  join(router, host, "host");
  join(router, a, "guest", "a");
  join(router, b, "guest", "b");
  const before = b.messages.length;
  router.receive(a, {
    type: "message",
    from: "host",
    to: "b",
    payload: { type: "state" },
  });
  assert.equal(b.messages.length, before);
  assert.deepEqual(host.messages.at(-1), {
    type: "message",
    from: "a",
    payload: { type: "state" },
  });
  router.receive(host, {
    type: "message",
    to: "b",
    from: "a",
    payload: { type: "welcome" },
  });
  assert.equal(b.messages.at(-1).from, "host");
});
test("relay rejects replacement hosts and missing rooms", () => {
  const router = new RoomRouter(),
    host = socket(),
    imposter = socket(),
    guest = socket();
  join(router, host, "host");
  join(router, imposter, "host");
  join(router, guest, "guest", "g", "ZZZZZZZZ");
  assert.equal(imposter.code, 1008);
  assert.equal(guest.code, 1008);
  assert.equal(router.rooms.get("ABCDEFGH").host, host);
});
test("relay cleans up disconnected guests and all room state when the host leaves", () => {
  const router = new RoomRouter(),
    host = socket(),
    a = socket(),
    b = socket();
  join(router, host, "host");
  join(router, a, "guest", "a");
  join(router, b, "guest", "b");
  router.leave(a);
  assert.equal(router.clients.has(a), false);
  assert.equal(host.messages.at(-1).type, "peer-left");
  router.leave(host);
  assert.equal(b.code, 1001);
  assert.equal(router.rooms.size, 0);
  assert.equal(router.clients.size, 0);
});
test("relay enforces the receiver limit", () => {
  const router = new RoomRouter(),
    host = socket();
  join(router, host, "host");
  for (let i = 0; i < 12; i++) join(router, socket(), "guest", String(i));
  const extra = socket();
  join(router, extra, "guest", "extra");
  assert.equal(extra.code, 1008);
});
test("guest identity cannot use the reserved host name", () => {
  const router = new RoomRouter(),
    host = socket(),
    guest = socket();
  join(router, host, "host");
  join(router, guest, "guest", "host");
  assert.equal(guest.code, 1008);
});
