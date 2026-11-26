import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { parseHls, planHls, collectTracks, makeControl } from "../extension/media.mjs";
import { hlsKeyRequestUrl } from "../extension/requests.mjs";

const base = "https://media.example/season/episode.m3u8";
const keyA = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const keyB = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");
test("DramaTip keys use the same-origin route used by its player, scoped to the exact provider and valid parameters", () => {
  const value='https://api.idrama.video/shorts/open/drm/kds/api/v1/keys?source=IDrama&ak=00112233445566778899aabbccddeeff';
  assert.equal(hlsKeyRequestUrl(value,'https://dramatip.net'),'https://dramatip.net/api/idrama-key?source=IDrama&ak=00112233445566778899aabbccddeeff');
  assert.equal(hlsKeyRequestUrl(value,'https://example.test'),value);
  assert.equal(hlsKeyRequestUrl(value.replace('api.idrama.video','api.idrama.video.evil.test'),'https://dramatip.net'),value.replace('api.idrama.video','api.idrama.video.evil.test'));
  assert.equal(hlsKeyRequestUrl(value.replace('source=IDrama','source=bad%2Fpath'),'https://dramatip.net'),value.replace('source=IDrama','source=bad%2Fpath'));
});
function encrypted(data, key, iv) {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.from(iv, "hex"));
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
test("AES-128 HLS resolves relative keys, media-sequence IVs, explicit IVs, rotation and METHOD=NONE", async () => {
  const playlist = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:257
#EXT-X-KEY:METHOD=AES-128,URI="key-a"
#EXTINF:1,
one.ts
#EXTINF:1,
two.ts
#EXT-X-KEY:METHOD=AES-128,URI="key-b",IV=0x2a
#EXTINF:1,
three.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:1,
four.ts
#EXT-X-ENDLIST`;
  const parsed = parseHls(playlist, base);
  assert.equal(parsed.segments[0].encryption.url, "https://media.example/season/key-a");
  assert.equal(parsed.segments[0].encryption.iv, "00000000000000000000000000000101");
  assert.equal(parsed.segments[1].encryption.iv, "00000000000000000000000000000102");
  assert.equal(parsed.segments[2].encryption.iv, "0000000000000000000000000000002a");
  assert.equal(parsed.segments[3].encryption, undefined);
  const plain = [Buffer.from("first media segment"), Buffer.from("second media segment"), Buffer.from("third media segment"), Buffer.from("clear media segment")];
  const counts = new Map();
  const request = async url => {
    counts.set(url, (counts.get(url) || 0) + 1);
    if (url === base) return new Response(playlist);
    if (url.endsWith("key-a")) return new Response(keyA);
    if (url.endsWith("key-b")) return new Response(keyB);
    const index = ["one.ts", "two.ts", "three.ts", "four.ts"].findIndex(p=>url.endsWith(p));
    return new Response(index === 3 ? plain[index] : encrypted(plain[index], index < 2 ? keyA : keyB, parsed.segments[index].encryption.iv));
  };
  const result = await collectTracks(await planHls(base, request), request, makeControl());
  assert.deepEqual(Buffer.from(await result.tracks[0].blob.arrayBuffer()), Buffer.concat(plain));
  assert.equal(counts.get("https://media.example/season/key-a"), 1, "parallel parts share the key fetch");
  assert.equal(counts.get("https://media.example/season/key-b"), 1);
});

test("encrypted fMP4 initialization map uses its own explicit IV", async () => {
  const parsed = parseHls(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key-a",IV=0x1
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key-b",IV=0x2
#EXTINF:1,
part.m4s
#EXT-X-ENDLIST`, base);
  const plain = [Buffer.from("initialization"), Buffer.from("video data")];
  const request = async url => {
    if (url.endsWith("key-a")) return new Response(keyA);
    if (url.endsWith("key-b")) return new Response(keyB);
    const index = url.endsWith("init.mp4") ? 0 : 1;
    return new Response(encrypted(plain[index], index ? keyB : keyA, parsed.segments[index].encryption.iv));
  };
  const result = await collectTracks({tracks:[{...parsed,kind:"video"}]},request,makeControl());
  assert.deepEqual(Buffer.from(await result.tracks[0].blob.arrayBuffer()),Buffer.concat(plain));
});

test("DRM, malformed IVs and unsupported encrypted ranges fail before saving", () => {
  for (const key of [
    'METHOD=SAMPLE-AES,URI="license"',
    'METHOD=AES-128,URI="license",KEYFORMAT="com.apple.streamingkeydelivery"',
    'METHOD=AES-128,URI="license",KEYFORMATVERSIONS="2"',
    'METHOD=AES-128,URI="key",IV=0xzz',
    'METHOD=AES-128,URI="key",IV=0x100000000000000000000000000000000',
    'METHOD=AES-128',
  ]) assert.throws(()=>parseHls(`#EXTM3U\n#EXT-X-KEY:${key}\n#EXTINF:1,\nx.ts\n#EXT-X-ENDLIST`,base),e=>e.stopBatch===true);
  assert.throws(()=>parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nx.m4s\n#EXT-X-ENDLIST',base),/explicit IV/);
  assert.throws(()=>parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-BYTERANGE:16@0\n#EXTINF:1,\nx.ts\n#EXT-X-ENDLIST',base),/byte ranges/);
});

test("refused and malformed keys pause the batch and never return a partial file", async () => {
  const parsed = parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\nx.ts\n#EXT-X-ENDLIST',base);
  for (const denied of [true,false]) {
    let keyCalls=0;
    const request = async url => {
      if (url.endsWith("/key")) {
        keyCalls++;
        if(denied) throw Object.assign(Error("HTTP 403"),{noRetry:true});
        return new Response("not-a-16-byte-key-response");
      }
      return new Response(new Uint8Array(16));
    };
    await assert.rejects(collectTracks({tracks:[parsed]},request,makeControl()),e=>e.stopBatch===true);
    assert.equal(keyCalls,1);
  }
});
