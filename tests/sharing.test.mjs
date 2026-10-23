import assert from "node:assert/strict";
import { publicPage } from "../extension/public-sharing.mjs";
import { watchSource, watchStore } from "../extension/watch.mjs";
assert.equal(
  publicPage("https://youtu.be/M7lc1UVf-VE?tracking=1"),
  "https://www.youtube.com/watch?v=M7lc1UVf-VE",
);
assert.equal(
  publicPage("https://dramatip.net/series/a/episode-9?token=secret#private"),
  "https://dramatip.net/series/a/episode-9",
);
assert.throws(() => publicPage("https://cdn.example/main.m3u8?token=secret"));
assert.throws(() => publicPage("http://localhost/private"));
assert.throws(() => publicPage("https://vimeo.com/12345/privatehash"));
assert.equal(watchSource("https://example.org/video").embed, null);
const values = {},
  api = {
    storage: {
      local: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (data) => Object.assign(values, data),
      },
    },
  },
  store = watchStore(api);
await Promise.all([
  store.add({ title: "One", source: "https://example.org/one" }),
  store.add({ title: "Two", source: "https://example.org/two" }),
]);
assert.equal((await store.list()).length, 2);
await store.add({ title: "Duplicate", source: "https://example.org/one" });
assert.equal((await store.list()).length, 2);
await store.remove((await store.list())[0].id);
assert.equal((await store.list()).length, 1);
assert(!JSON.stringify(values).includes("Blob"));
console.log(
  "PASS sanitized metadata-only Watch storage, source fallback, deduplication, concurrent saves and removal.",
);
