import test from "node:test";
import assert from "node:assert/strict";
test("capture session coalesces signed requests, keeps frame identity and clears on navigation", async () => {
  const data = {},
    hooks = {},
    badges = [];
  globalThis.chrome = {
    action: {
      setBadgeBackgroundColor() {},
      async setBadgeText(v) {
        badges.push(v);
      },
    },
    webRequest: {
      onHeadersReceived: {
        addListener(fn) {
          hooks.headers = fn;
        },
      },
      onBeforeRequest: {
        addListener(fn) {
          hooks.navigation = fn;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener(fn) {
          hooks.close = fn;
        },
      },
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          hooks.message = fn;
        },
      },
    },
    storage: {
      session: {
        async get(key) {
          return { [key]: data[key] };
        },
        async set(obj) {
          Object.assign(data, obj);
        },
        async remove(keys) {
          for (const key of [].concat(keys)) delete data[key];
        },
      },
    },
  };
  await import("../extension/background.js");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15));
  for (const token of ["a", "b", "c"])
    hooks.headers({
      tabId: 12,
      frameId: 2,
      statusCode: 200,
      url: "https://cdn.test/episode/master.m3u8?token=" + token,
      initiator: "https://player.test",
      responseHeaders: [
        { name: "content-type", value: "application/vnd.apple.mpegurl" },
      ],
    });
  hooks.headers({
    tabId: 12,
    frameId: 2,
    statusCode: 200,
    url: "https://cdn.test/init.mp4",
    responseHeaders: [{ name: "content-type", value: "video/mp4" }],
  });
  await settle();
  assert.equal(data["tab-12"].length, 1);
  assert.equal(data["tab-12"][0].frameId, 2);
  assert.match(data["tab-12"][0].url, /token=c/);
  hooks.message(
    {
      type: "kenuxa-playback",
      players: [
        {
          index: 0,
          urls: ["https://cdn.test/video.mp4"],
          playing: true,
          height: 1080,
        },
      ],
    },
    { tab: { id: 12 }, frameId: 2, origin: "https://player.test" },
  );
  await settle();
  assert.equal(data["players-12"][0].height, 1080);
  assert.equal(data["players-12"][0].frameId, 2);
  hooks.navigation({ tabId: 12, type: "main_frame" });
  await settle();
  assert.equal(data["tab-12"], undefined);
  assert.equal(data["players-12"], undefined);
  assert.equal(badges.at(-1).text, "");
  delete globalThis.chrome;
});
