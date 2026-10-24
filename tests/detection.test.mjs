import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceKey,
  mergeCaptures,
  rankSources,
  inspectPlayers,
} from "../extension/detection.mjs";
const row = (id, url, more = {}) => ({
  id,
  url,
  kind: "HLS",
  frameId: 0,
  time: 100000,
  ...more,
});
test("signed re-requests coalesce but preserve latest usable URL and stable ID", () => {
  const rows = mergeCaptures([
    row("a", "https://cdn.test/episode-1/master.m3u8?token=old&expires=1"),
    row("b", "https://cdn.test/episode-1/master.m3u8?expires=2&token=new", {
      time: 100001,
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a");
  assert.match(rows[0].url, /token=new/);
});
test("episodes, semantic query IDs, endpoint tokens and frames stay separate", () => {
  assert.notEqual(
    sourceKey(row("a", "https://cdn.test/watch.m3u8?id=1")),
    sourceKey(row("b", "https://cdn.test/watch.m3u8?id=2")),
  );
  assert.notEqual(
    sourceKey(row("a", "https://cdn.test/watch?token=a")),
    sourceKey(row("b", "https://cdn.test/watch?token=b")),
  );
  assert.notEqual(
    sourceKey(row("a", "https://cdn.test/one/master.m3u8")),
    sourceKey(row("b", "https://cdn.test/two/master.m3u8")),
  );
  assert.notEqual(
    sourceKey(row("a", "https://cdn.test/a.m3u8")),
    sourceKey(row("b", "https://cdn.test/a.m3u8", { frameId: 2 })),
  );
});
test("playing direct URL outranks unrelated network captures and retains dimensions", () => {
  const p = {
    playing: true,
    visible: true,
    frameId: 0,
    urls: ["https://cdn.test/main.mp4"],
    height: 1080,
    width: 1920,
    observedAt: 100000,
  };
  const rows = rankSources(
    [
      row("ad", "https://ads.test/ad.mp4", { kind: "Video", frameId: 3 }),
      row("main", "https://cdn.test/main.mp4", { kind: "Video" }),
    ],
    [p],
  );
  assert.equal(rows[0].id, "main");
  assert.equal(rows[0].confidence, "Playing video");
  assert.equal(rows[0].height, 1080);
  assert.equal(rows[1].focused, false);
});
test("an exact playing video does not promote a paused player in the same frame", () => {
  const rows = rankSources(
    [
      row("main", "https://cdn.test/main.mp4", { kind: "Video" }),
      row("paused", "https://cdn.test/paused.mp4", { kind: "Video" }),
    ],
    [
      {
        frameId: 0,
        playing: true,
        urls: ["https://cdn.test/main.mp4"],
        observedAt: 100000,
      },
    ],
  );
  assert.equal(rows.filter((r) => r.focused).length, 1);
  assert.equal(rows[1].confidence, "Other detected source");
});
test("master remains an exact match after refresh has already hidden its child rows", () => {
  const child = "https://cdn.test/1080.m3u8",
    players = [
      { playing: true, frameId: 0, urls: [child], observedAt: 100000 },
    ];
  const parent = row("m", "https://cdn.test/master.m3u8", {
    master: true,
    variants: [{ url: child }],
    qualities: [1080, 720],
  });
  const first = rankSources([parent, row("c", child)], players);
  const again = rankSources(first, players, first);
  assert.equal(again.length, 1);
  assert.equal(again[0].confidence, "Playing video");
  assert.deepEqual(again[0].qualities, [1080, 720]);
});
test("MSE correlation stays explicitly uncertain and unrelated old captures are not focused", () => {
  const rows = rankSources(
    [
      row("old", "https://cdn.test/old.m3u8", { time: 1000 }),
      row("new", "https://cdn.test/new.m3u8"),
    ],
    [
      {
        playing: true,
        frameId: 0,
        urls: [],
        observedAt: 100000,
        playedAt: 90000,
      },
    ],
  );
  assert.equal(rows[0].confidence, "Likely playing video");
  assert.equal(rows.find((r) => r.id === "old").focused, false);
});
test("parsed master groups exact renditions and inherits the playing child match", () => {
  const child = "https://cdn.test/episode/1080.m3u8";
  const rows = rankSources(
    [
      row("master", "https://cdn.test/episode/master.m3u8", {
        master: true,
        variants: [{ url: child }],
        time: 100,
      }),
      row("1080", child),
      row("other", "https://cdn.test/other/master.m3u8", { frameId: 3 }),
    ],
    [{ playing: true, frameId: 0, urls: [child], observedAt: 100000 }],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "master");
  assert.equal(rows[0].focused, true);
});
test("refresh carries quality choices by stable identity without multiplying records", () => {
  const a = row("a", "https://cdn.test/main.m3u8?token=a");
  const first = rankSources([a]);
  first[0].quality = "1080";
  first[0].format = "mp4";
  const next = rankSources(
    [row("a", "https://cdn.test/main.m3u8?token=b")],
    [],
    first,
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].quality, "1080");
  assert.equal(next[0].format, "mp4");
});
test("player scan reads actual playback state and visible area rather than every URL as active", () => {
  const old = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    location: globalThis.location,
  };
  const make = (paused, src) => ({
    paused,
    ended: false,
    readyState: 4,
    currentSrc: src,
    videoHeight: 1080,
    videoWidth: 1920,
    duration: 20,
    currentTime: 2,
    volume: 1,
    contains: () => false,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      width: 640,
      height: 360,
      top: 0,
      bottom: 360,
      left: 0,
      right: 640,
    }),
  });
  const main = make(false, "https://cdn.test/main.mp4"),
    ad = make(true, "https://ads.test/ad.mp4");
  Object.assign(globalThis, {
    document: { querySelectorAll: () => [ad, main], activeElement: main },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    innerWidth: 1280,
    innerHeight: 800,
    location: { origin: "https://source.test" },
  });
  try {
    const scan = inspectPlayers();
    assert.equal(scan[1].playing, true);
    assert.equal(scan[0].playing, false);
    assert.equal(scan[1].focused, true);
    assert.equal(scan[1].height, 1080);
  } finally {
    Object.assign(globalThis, old);
  }
});
