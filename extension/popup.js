import "./browser-bridge.mjs";
import { classify } from "./media.mjs";
import { scanPlayers, rankSources, mergeCaptures } from "./detection.mjs";
const $ = (id) => document.getElementById(id);
let active;
async function current() {
  [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = "tab-" + active.id;
  const state = await chrome.storage.session.get(key);
  let players = [];
  try {
    players = await scanPlayers(chrome, active.id);
  } catch {}
  const stored =
    (await chrome.storage.session.get("players-" + active.id))[
      "players-" + active.id
    ] || [];
  players = players.map((p) => ({
    ...p,
    playedAt:
      stored.find((s) => s.frameId === p.frameId && s.index === p.index)
        ?.playedAt || p.observedAt,
  }));
  const direct = players.flatMap((p) =>
    p.urls
      .filter((url) => classify(url))
      .map((url) => ({
        id: crypto.randomUUID(),
        url,
        kind: classify(url),
        frameId: p.frameId,
        sourceOrigin: p.sourceOrigin,
        time: Date.now(),
        height: p.height,
        width: p.width,
      })),
  );
  const captures = mergeCaptures([...(state[key] || []), ...direct]).slice(
    -100,
  );
  await chrome.storage.session.set({ [key]: captures });
  const rows = rankSources(captures, players);
  $("count").textContent = rows.length;
  $("source").textContent = active.title || "Current tab";
  $("message").textContent = rows.some((r) => r.focused)
    ? "Playing video prioritized. Open Studio to choose source quality."
    : "No confident player match. Studio keeps other detections available for review.";
  return rows;
}
async function open(view = "library") {
  const items = await current();
  const key = "studio-" + crypto.randomUUID();
  const origin = /^https?:/.test(active.url || "")
    ? new URL(active.url).origin
    : null;
  await chrome.storage.session.set({
    [key]: {
      items,
      sourceTabId: active.id,
      sourceOrigin: origin,
      title: active.title || "Media library",
      sourceUrl: active.url || "",
    },
  });
  await chrome.tabs.create({
    url:
      chrome.runtime.getURL("studio.html") +
      "?job=" +
      encodeURIComponent(key) +
      "#" +
      view,
  });
  window.close();
}
$("home").onclick = () => open("home").catch(error);
$("open").onclick = () => open().catch(error);
$("converter").onclick = () => open("convert").catch(error);
$("scan").onclick = async () => {
  try {
    await current();
  } catch (e) {
    error(e);
  }
};
function error(e) {
  $("message").textContent = e.message;
  $("message").className = "error";
}
current().catch(error);

$("watch").onclick = async () => {
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("studio.html") + "#watch",
    });
    window.close();
  } catch (e) {
    error(e);
  }
};
