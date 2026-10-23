import "./browser-bridge.mjs";
import { classify } from "./media.mjs";
let queue = Promise.resolve();
chrome.action.setBadgeBackgroundColor({ color: "#8861e8" });
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || d.statusCode >= 400) return;
    const headers = Object.fromEntries(
      (d.responseHeaders || []).map((h) => [
        h.name.toLowerCase(),
        h.value || "",
      ]),
    );
    const kind = classify(d.url, headers["content-type"]);
    if (!kind) return;
    // Avoid advertising a playback fragment as a complete direct video file.
    if (
      !["HLS", "DASH"].includes(kind) &&
      (/[?&](range|bytestart|byteend)=/i.test(d.url) ||
        /bytes [1-9]\d*-/i.test(headers["content-range"] || ""))
    )
      return;
    const key = "tab-" + d.tabId;
    queue = queue
      .catch(() => {})
      .then(async () => {
        const state = await chrome.storage.session.get(key),
          old = state[key] || [];
        const existing = old.find((r) => r.url === d.url);
        const row = {
          id: existing?.id || crypto.randomUUID(),
          url: d.url,
          kind,
          mime: headers["content-type"] || "",
          size: Number(headers["content-length"]) || 0,
          frameId: d.frameId,
          sourceOrigin: /^https?:/.test(
            d.initiator || d.originUrl || d.documentUrl || "",
          )
            ? new URL(d.initiator || d.originUrl || d.documentUrl).origin
            : undefined,
          time: Date.now(),
        };
        const rows = [row, ...old.filter((r) => r.url !== d.url)].slice(0, 100);
        await chrome.storage.session.set({ [key]: rows });
        await chrome.action.setBadgeText({
          tabId: d.tabId,
          text: String(rows.length),
        });
      });
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0 || d.type !== "main_frame") return;
    queue = queue
      .catch(() => {})
      .then(async () => {
        await chrome.storage.session.remove("tab-" + d.tabId);
        await chrome.action.setBadgeText({ tabId: d.tabId, text: "" });
      });
  },
  { urls: ["http://*/*", "https://*/*"] },
);
chrome.tabs.onRemoved.addListener((id) => {
  queue = queue
    .catch(() => {})
    .then(() => chrome.storage.session.remove("tab-" + id));
});
