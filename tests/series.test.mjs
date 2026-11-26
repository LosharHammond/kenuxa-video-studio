import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { findEpisodeLinks, chooseEpisodeSource, resolveEpisode } from "../extension/series.mjs";
import { makeControl } from "../extension/media.mjs";

test("DramaTip episode links are deduplicated, scoped to the series and numerically ordered", async () => {
  globalThis.document = parseHTML(await readFile(new URL("fixtures/dramatip-episodes.html", import.meta.url), "utf8")).document;
  globalThis.location = { href: "https://dramatip.net/series/my-twin-was-their-masterpiece-i-was-the-control/" };
  const links = findEpisodeLinks();
  assert.deepEqual(links.map(e => e.number), Array.from({length:30}, (_,i)=>i+1));
  assert.equal(links[29].pageUrl, location.href + "episode-30");
  location.href += "episode-20";
  assert.equal(findEpisodeLinks().length, 30);
});

test("episode discovery rejects unrelated pages, external links and non-http schemes", () => {
  globalThis.document = parseHTML(`<div id="episodes">
    <a href="/show/episode/10">10</a><a href="/show/episode/2">2</a>
    <a href="https://other.test/show/episode/3">3</a><a href="javascript:alert(1)">4</a>
  </div><a href="/unrelated/episode/1">1</a>`).document;
  globalThis.location = { href: "https://example.test/show/" };
  assert.deepEqual(findEpisodeLinks().map(e=>e.number), [2, 10]);
});

const player = () => ({ frameId: 0, urls: [], playing: true, observedAt: Date.now(), sourceOrigin: "https://example.test", height: 720 });
const capture = (url, kind = "HLS") => ({ url, kind, frameId: 0, time: Date.now(), sourceOrigin: "https://example.test" });
test("batch selection groups master renditions and avoids ambiguous captures", () => {
  const master = capture("https://cdn.test/master.m3u8");
  master.master = true;
  master.variants = [{url:"https://cdn.test/video.m3u8"}];
  master.audioPlaylists = [{url:"https://cdn.test/audio.m3u8"}];
  assert.equal(chooseEpisodeSource([master, capture(master.variants[0].url), capture(master.audioPlaylists[0].url)], [player()]).url, master.url);
  assert.equal(chooseEpisodeSource([capture("https://cdn.test/a.m3u8"), capture("https://cdn.test/b.m3u8")], [player()]), null);
  assert.equal(chooseEpisodeSource([capture("https://cdn.test/a.mp3", "Audio")], [player()]), null);
  assert.equal(chooseEpisodeSource([capture("https://cdn.test/a.mp4", "Video")], []), null);
});

function browserMock() {
  const removed = [], functions = [];
  return { removed, functions, api: {
    tabs: {
      create: async () => ({id:99}),
      get: async () => ({status:"complete",url:"https://example.test/show/episode-1"}),
      remove: async id => removed.push(id),
    },
    storage: { session: { get: async key => ({[key]:[capture("https://cdn.test/movie.mp4", "Video")]}) } },
    scripting: { executeScript: async ({func}) => {
      functions.push(func.name);
      return [{frameId:0,result:func.name === "inspectPlayers" ? [{...player(),urls:["https://cdn.test/movie.mp4"]}] : undefined}];
    } },
  } };
}
test("episode resolution retains its tab until saving and pauses playback before automatic next episode", async () => {
  const mock = browserMock();
  const item = await resolveEpisode(mock.api, {pageUrl:"https://example.test/show/episode-1"}, makeControl());
  assert.equal(item.url, "https://cdn.test/movie.mp4");
  assert.deepEqual(item.source, {sourceTabId:99,sourceOrigin:"https://example.test",frameId:0});
  assert.equal(item.tabId, 99);
  assert(mock.functions.includes("pauseEpisodePlayer"));
  assert.deepEqual(mock.removed, []);
});
test("timeouts, cancellation and closed tabs clean up the worker tab", async () => {
  for (const mode of ["timeout", "cancel", "closed", "redirect"]) {
    const mock = browserMock(), control = makeControl();
    if (mode === "cancel") control.cancel();
    if (mode === "closed") mock.api.tabs.get = async () => { throw Error("Tab closed"); };
    if (mode === "redirect") mock.api.tabs.get = async () => ({status:"complete",url:"https://other.test/"});
    await assert.rejects(resolveEpisode(mock.api, {pageUrl:"https://example.test/show/episode-1"}, control, ()=>{}, {timeout:mode === "timeout" ? 0 : 1000}));
    assert.deepEqual(mock.removed, [99], mode);
  }
});
