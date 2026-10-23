import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { DOMParser } = require("linkedom");
globalThis.DOMParser = DOMParser;
const {
  classify,
  parseHls,
  planHls,
  parseDash,
  makeControl,
  collectTracks,
  chooseQuality,
  cleanName,
} = await import("../extension/media.mjs");
let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log("PASS " + name);
};
await test("detection handles manifests, audio, and segments without false video files", () => {
  assert.equal(classify("https://a/v.mpd"), "DASH");
  assert.equal(classify("https://a/play", "application/x-mpegurl"), "HLS");
  assert.equal(classify("https://a/a.mp3"), "Audio");
  assert.equal(classify("https://a/a.m4s", "video/mp4"), null);
  assert.equal(classify("https://a/logo.png"), null);
});
await test("HLS quality, alternate audio, and relative query URLs", () => {
  const p = parseHls(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",DEFAULT=YES,URI="audio.m3u8?a=x,y"\n#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=640x360,AUDIO="aud"\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=20,RESOLUTION=1920x1080,AUDIO="aud"\n1080.m3u8',
    "https://a/base/master.m3u8",
  );
  assert.equal(chooseQuality(p.variants, "720").height, 360);
  assert.equal(chooseQuality(p.variants).height, 1080);
  assert.equal(p.audio[0].url, "https://a/base/audio.m3u8?a=x,y");
});
await test("HLS byte ranges preserve offsets and init map", () => {
  const p = parseHls(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="10@0"\n#EXTINF:1,\n#EXT-X-BYTERANGE:5@10\na.mp4\n#EXTINF:1,\n#EXT-X-BYTERANGE:5\na.mp4\n#EXT-X-ENDLIST',
    "https://a/b.m3u8",
  );
  assert.deepEqual(
    p.segments.map((s) => s.range),
    [
      { start: 0, end: 9 },
      { start: 10, end: 14 },
      { start: 15, end: 19 },
    ],
  );
});
await test("encrypted, ambiguous, and live HLS stop safely", () => {
  assert.throws(
    () =>
      parseHls(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-ENDLIST',
        "https://a/b",
      ),
    /Encrypted/,
  );
  assert.throws(
    () =>
      parseHls(
        "#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:5\na.ts\n#EXT-X-ENDLIST",
        "https://a/b",
      ),
    /ambiguous/,
  );
  assert.throws(
    () => parseHls("#EXTM3U\n#EXTINF:1,\na.ts", "https://a/b"),
    /Live/,
  );
});
await test("DASH real fixture discovers audio and video with finite segments", async () => {
  const p = parseDash(
    await readFile(new URL("./sample.mpd", import.meta.url), "utf8"),
    "https://a/sample.mpd",
  );
  assert.deepEqual(
    p.tracks.map((t) => t.kind),
    ["video", "audio"],
  );
  assert(p.tracks.every((t) => t.segments.length > 1));
  assert(p.tracks[0].segments[1].url.includes("chunk-stream0-00001.m4s"));
});
await test("DASH DRM and dynamic playlists are rejected", () => {
  assert.throws(
    () => parseDash('<MPD type="dynamic"><Period/></MPD>', "https://a/a.mpd"),
    /Live/,
  );
  assert.throws(
    () =>
      parseDash(
        "<MPD><Period><AdaptationSet><ContentProtection/></AdaptationSet></Period></MPD>",
        "https://a/a.mpd",
      ),
    /Protected/,
  );
});
await test("concurrent part fetches preserve byte order and retry a transient failure", async () => {
  let retries = 0;
  const plan = {
    tracks: [
      {
        kind: "video",
        extension: "ts",
        mime: "video/mp2t",
        segments: [{ url: "a" }, { url: "b" }, { url: "c" }],
      },
    ],
  };
  const result = await collectTracks(
    plan,
    async (url) => {
      if (url === "b" && retries++ === 0)
        throw Error("temporary network failure");
      await new Promise((r) => setTimeout(r, url === "a" ? 30 : 1));
      return new Response(new Uint8Array([{ a: 1, b: 2, c: 3 }[url]]));
    },
    makeControl(),
  );
  assert.deepEqual(
    [...new Uint8Array(await result.tracks[0].blob.arrayBuffer())],
    [1, 2, 3],
  );
  assert.equal(retries, 2);
});
await test("pause and resume releases every parallel worker", async () => {
  const c = makeControl();
  c.pause();
  let n = 0;
  const workers = Array.from({ length: 3 }, async () => {
    await c.checkpoint();
    n++;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(n, 0);
  c.resume();
  await Promise.all(workers);
  assert.equal(n, 3);
});
await test("cancelling paused work rejects every waiting worker", async () => {
  const c = makeControl();
  c.pause();
  const workers = Array.from({ length: 3 }, () => c.checkpoint());
  c.cancel();
  const r = await Promise.allSettled(workers);
  assert(
    r.every((s) => s.status === "rejected" && s.reason.name === "AbortError"),
  );
});
await test("permanent failures never produce a partial success", async () => {
  let tries = 0;
  await assert.rejects(
    collectTracks(
      { tracks: [{ segments: [{ url: "a" }] }] },
      async () => {
        tries++;
        throw Object.assign(Error("Forbidden"), { noRetry: true });
      },
      makeControl(),
    ),
    /Forbidden/,
  );
  assert.equal(tries, 1);
});
await test("Windows reserved names and unsafe characters", () => {
  assert.equal(cleanName("CON"), "Kenuxa-CON");
  assert.equal(cleanName("episode:9/a?"), "episode-9-a-");
});
console.log(count + " substantive media engine checks passed.");
