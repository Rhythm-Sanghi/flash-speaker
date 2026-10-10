import test from "node:test";
import assert from "node:assert/strict";
import { YouTubePlayer } from "../src/youtube.js";

test("leaving during YouTube initialization cancels the pending player", async () => {
  const oldWindow = globalThis.window,
    oldDocument = globalThis.document,
    oldYT = globalThis.YT,
    oldLocation = globalThis.location;
  let destroyed = false;
  globalThis.YT = {
    Player: class {
      destroy() {
        destroyed = true;
      }
    },
    PlayerState: { ENDED: 0 },
  };
  globalThis.window = { YT: globalThis.YT };
  globalThis.location = { origin: "https://example.org" };
  globalThis.document = {
    createElement() {
      return {};
    },
    getElementById() {
      return { replaceChildren() {} };
    },
  };
  try {
    const player = new YouTubePlayer(),
      loading = player.load("aqz-KE-bpKQ");
    await Promise.resolve();
    player.pause();
    player.volume(0.5, false);
    assert.equal(player.duration(), 0);
    player.destroy();
    await assert.rejects(loading, /cancelled/);
    assert.equal(destroyed, true);
    assert.equal(player.player, null);
  } finally {
    for (const [name, value] of Object.entries({
      window: oldWindow,
      document: oldDocument,
      YT: oldYT,
      location: oldLocation,
    })) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
