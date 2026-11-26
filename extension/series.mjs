import { classify, parseHls } from "./media.mjs";
import { scanPlayers, rankSources, sourceKey } from "./detection.mjs";
import { requester } from "./requests.mjs";

// Self-contained so it can run in the connected page without loading site code.
export function findEpisodeLinks() {
  const here = new URL(location.href);
  const route = here.pathname.match(/^(.*\/series\/[^/]+)(?:\/episode-\d+)?\/?$/i);
  const links = new Map();
  for (const a of document.querySelectorAll("a[href]")) {
    let url;
    try { url = new URL(a.getAttribute("href"), here); } catch { continue; }
    if (url.origin !== here.origin || !/^https?:$/.test(url.protocol)) continue;
    const match = url.pathname.match(/^(.*?)\/episode[-/](\d+)\/?$/i);
    if (!match || (route && match[1] !== route[1])) continue;
    // Outside /series/, only accept links from an explicit episode list.
    if (!route && !a.closest('#episodes, .episodes, .eplister, [aria-label*="pisodes"]')) continue;
    url.hash = "";
    url.search = "";
    const number = Number(match[2]);
    if (number > 0 && !links.has(number))
      links.set(number, { number, pageUrl: url.href });
  }
  return [...links.values()].sort((a, b) => a.number - b.number);
}

export async function scanEpisodes(api, tabId) {
  const results = await api.scripting.executeScript({
    target: { tabId, frameIds: [0] }, func: findEpisodeLinks,
  });
  return results[0]?.result || [];
}

// Ask only actual media elements to play. Never click arbitrary page controls.
export function startEpisodePlayer() {
  const videos = [...document.querySelectorAll("video")]
    .filter(v => v.getBoundingClientRect().width > 0)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const v = videos[0];
  if (v) {
    v.muted = true;
    v.play().catch(() => {});
  }
  return { hasPlayer: Boolean(v) };
}

export function episodePlaybackUrl(pageUrl) {
  const url = new URL(pageUrl);
  if (["dramatip.net", "www.dramatip.net"].includes(url.hostname) &&
      /\/series\/[^/]+(?:\/episode-\d+)?\/?$/.test(url.pathname))
    url.searchParams.set("autoplay", "1");
  return url.href;
}

export function chooseEpisodeSource(rows, players) {
  const direct = players.flatMap(p => (p.urls || [])
    .filter(url => classify(url))
    .map(url => ({ url, kind: classify(url), frameId: p.frameId,
      sourceOrigin: p.sourceOrigin, time: Date.now() })));
  const ranked = rankSources([...rows, ...direct], players);
  // An ambiguous MSE capture may be an advert or a separate audio track.
  // Prefer a playlist, otherwise require a single confident video source.
  const matches = ranked.filter(r => r.focused && r.kind !== "Audio");
  const streams = matches.filter(r => ["HLS", "DASH"].includes(r.kind));
  if (streams.length === 1) return streams[0];
  if (!streams.length && matches.length === 1) return matches[0];
  if (matches.length) return null;
  // Loaded media can be downloadable before playback starts (for example while
  // the player is waiting on its key service). Do not require decoded frames.
  const visible = players.filter(p => p.visible);
  if (visible.length !== 1) return null;
  const loading = visible[0];
  const inFrame = ranked.filter(r => (r.frameId || 0) === (loading.frameId || 0) && r.kind !== "Audio");
  const exact = inFrame.filter(r => (loading.urls || []).some(url =>
    sourceKey({url,frameId:loading.frameId}) === sourceKey(r)));
  if (exact.length === 1) return { ...exact[0], confidence: "Loaded player source" };
  const playlists = inFrame.filter(r => ["HLS", "DASH"].includes(r.kind));
  if (playlists.length === 1 && playlists[0].master &&
      playlists[0].variants?.some(v => v.height > 0))
    return { ...playlists[0], confidence: "Loaded video playlist; playback not required" };
  return null;
}

export function pauseEpisodePlayer() {
  for (const video of document.querySelectorAll("video")) video.pause();
}

export async function resolveEpisode(api, episode, control, onStatus = () => {}, options = {}) {
  const timeout = options.timeout ?? 60000;
  const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const tab = await api.tabs.create({ url: episodePlaybackUrl(episode.pageUrl), active: false });
  try {
    let deadline = Date.now() + timeout;
    const inspected = new Map();
    onStatus("Loading the episode stream; playback does not need to progress. If the player does not initialize, open the episode tab and press Play.");
    while (Date.now() < deadline) {
      const beforePause = Date.now();
      await control.checkpoint();
      deadline += Date.now() - beforePause;
      const current = await api.tabs.get(tab.id);
      if (current.status === "complete") {
        if (new URL(current.url).origin !== new URL(episode.pageUrl).origin)
          throw Error("The episode redirected to another site. Open it manually to review.");
        let players = [];
        try {
          await api.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true }, func: startEpisodePlayer,
          });
          players = await scanPlayers(api, tab.id);
        } catch { /* A frame may still be navigating. */ }
        const key = "tab-" + tab.id;
        const saved = (await api.storage.session.get(key))[key] || [];
        // Group a master with its audio/video playlists before choosing a source.
        for (const row of saved.filter(r => r.kind === "HLS").slice(0, 6)) {
          if (!inspected.has(row.url)) {
            inspected.set(row.url, {});
            try {
              const request = requester(api, {
                sourceTabId: tab.id, frameId: row.frameId || 0,
                sourceOrigin: row.sourceOrigin || new URL(current.url).origin,
              }, control);
              const response = await request(row.url);
              const parsed = parseHls(await response.text(), response.url || row.url);
              inspected.set(row.url, { master: Boolean(parsed.variants?.length),
                variants: parsed.variants || [], audioPlaylists: parsed.audio || [] });
            } catch (error) {
              if (error.stopBatch) inspected.set(row.url, { sourceError: error });
            }
          }
          Object.assign(row, inspected.get(row.url));
        }
        const item = chooseEpisodeSource(saved, players);
        if (item) {
          if (item.sourceError) throw item.sourceError;
          await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: pauseEpisodePlayer });
          await control.checkpoint();
          return { ...item, source: {
          sourceTabId: tab.id, sourceOrigin: item.sourceOrigin || new URL(current.url).origin,
          frameId: item.frameId || 0,
          }, tabId: tab.id };
        }
      }
      await sleep(1000);
    }
    throw Object.assign(Error("Episode playback did not expose a supported video. The batch is paused. Open the episode page, press Play if required, then retry or resume the remaining episodes."), { stopBatch: true });
  } catch (error) {
    await api.tabs.remove(tab.id).catch(() => {});
    throw error;
  }
}
