import test from "node:test";
import assert from "node:assert/strict";
import {
  planHls,
  chooseQuality,
  collectTracks,
  makeControl,
} from "../extension/media.mjs";
import { convert, stopConversion } from "../extension/converter.mjs";
test("best HLS selects highest resolution even when listed last and keeps matching audio", async () => {
  const master =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="hi",DEFAULT=YES,URI="sound.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800,RESOLUTION=3840x2160,AUDIO="hi"\nhigh.m3u8';
  const media = "#EXTM3U\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST";
  const seen = [],
    request = async (url) => {
      seen.push(url);
      return {
        url,
        text: async () => (url.endsWith("master.m3u8") ? master : media),
      };
    };
  const plan = await planHls("https://media.test/master.m3u8", request);
  assert.equal(plan.quality.height, 2160);
  assert.equal(plan.tracks.length, 2);
  assert(seen.includes("https://media.test/high.m3u8"));
  assert(!seen.includes("https://media.test/low.m3u8"));
  assert(seen.includes("https://media.test/sound.m3u8"));
  const low = await planHls("https://media.test/master.m3u8", request, "360");
  assert.equal(low.quality.height, 360);
  await assert.rejects(
    planHls("https://media.test/master.m3u8", request, "1080"),
    /no lower quality was substituted/,
  );
});
test("original and compatible MP4-copy downloads keep identical source bytes", async () => {
  const blob = new Blob([new Uint8Array([0, 12, 98, 234, 255])], {
    type: "video/mp4",
  });
  for (const mode of ["original", "mp4"]) {
    const out = await convert(
      [{ kind: "video", extension: "mp4", blob }],
      mode,
    );
    assert.equal(out.blob, blob);
    assert.equal(out.extension, "mp4");
    assert.deepEqual(
      new Uint8Array(await out.blob.arrayBuffer()),
      new Uint8Array(await blob.arrayBuffer()),
    );
  }
});
test("stream packaging copies codecs; explicit re-encode uses HQ settings without scaling", async () => {
  const calls = [];
  globalThis.FFmpegWASM = {
    FFmpeg: class {
      async load() {}
      async writeFile() {}
      on() {}
      off() {}
      async exec(args) {
        calls.push(args);
        return 0;
      }
      async readFile() {
        return new Uint8Array([1]);
      }
      async deleteFile() {}
      terminate() {}
    },
  };
  const tracks = [
    { kind: "video", extension: "ts", blob: new Blob(["v"]) },
    { kind: "audio", extension: "m4a", blob: new Blob(["a"]) },
  ];
  try {
    await convert(tracks, "mp4");
    await convert(tracks, "original");
    await convert(tracks, "compatible");
    for (const args of calls.slice(0, 2)) {
      assert.equal(args[args.indexOf("-c") + 1], "copy");
      assert(!args.includes("libx264"));
      assert(!args.includes("-vf"));
      assert(!args.includes("-s"));
      assert(args.includes("0:v:0"));
      assert(args.includes("1:a:0?"));
    }
    const hq = calls[2];
    assert.equal(hq[hq.indexOf("-crf") + 1], "18");
    assert.equal(hq[hq.indexOf("-b:a") + 1], "256k");
    assert(!hq.includes("-vf"));
  } finally {
    stopConversion();
    delete globalThis.FFmpegWASM;
  }
});
test("quality selection never upgrades a lower rendition into a fabricated resolution", () => {
  assert.equal(chooseQuality([{ height: 720, bandwidth: 1 }]).height, 720);
  assert.throws(
    () => chooseQuality([{ height: 720 }], 1080),
    /no longer available/,
  );
});
test("empty, truncated range and HTML media responses never become saved files", async () => {
  const single = {
    tracks: [{ kind: "video", segments: [{ url: "https://a/video" }] }],
  };
  await assert.rejects(
    collectTracks(
      single,
      async () => new Response(new Uint8Array()),
      makeControl(),
    ),
    /empty media part/,
  );
  await assert.rejects(
    collectTracks(
      {
        tracks: [
          {
            segments: [{ url: "https://a/video", range: { start: 0, end: 9 } }],
          },
        ],
      },
      async () => new Response(new Uint8Array(5)),
      makeControl(),
    ),
    /truncated/,
  );
  await assert.rejects(
    collectTracks(
      single,
      async () =>
        new Response("<html>Sign in</html>", {
          headers: { "content-type": "text/html" },
        }),
      makeControl(),
    ),
    /page instead of media/,
  );
  await assert.rejects(
    collectTracks(
      {
        tracks: [{ expectedSize: 10, segments: [{ url: "https://a/video" }] }],
      },
      async () => new Response(new Uint8Array(5)),
      makeControl(),
    ),
    /size does not match/,
  );
});
