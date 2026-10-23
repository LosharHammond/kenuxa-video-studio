import "./browser-bridge.mjs";
import { classify } from "./media.mjs";
const $ = (id) => document.getElementById(id);
let active;
async function current() {
  [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const key = "tab-" + active.id;
  const state = await chrome.storage.session.get(key);
  $("count").textContent = (state[key] || []).length;
  $("source").textContent = active.title || "Current tab";
  return state[key] || [];
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: active.id, allFrames: true },
      func: () =>
        [...document.querySelectorAll("video,audio")]
          .flatMap((e) => [
            e.currentSrc,
            e.src,
            ...[...e.querySelectorAll("source")].map((s) => s.src),
          ])
          .filter((u) => /^https?:/.test(u))
          .map((url) => ({ url, sourceOrigin: location.origin })),
    });
    const key = "tab-" + active.id,
      state = await chrome.storage.session.get(key),
      items = state[key] || [];
    for (const frame of results)
      for (const item of frame.result || []) {
        const kind = classify(item.url);
        if (kind && !items.some((x) => x.url === item.url))
          items.push({
            ...item,
            id: crypto.randomUUID(),
            kind,
            frameId: frame.frameId,
            time: Date.now(),
          });
      }
    await chrome.storage.session.set({ [key]: items.slice(0, 100) });
    await current();
    $("message").textContent =
      "Scan complete. If nothing appeared, refresh the page and play the video.";
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
