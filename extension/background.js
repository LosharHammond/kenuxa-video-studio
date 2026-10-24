import "./browser-bridge.mjs";
import { classify } from "./media.mjs";
import { mergeCaptures } from "./detection.mjs";
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
          firstSeen: existing?.firstSeen || existing?.time || Date.now(),
        };
        const rows = mergeCaptures([...old, row])
          .sort((a, b) => b.time - a.time)
          .slice(0, 100);
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
        await chrome.storage.session.remove([
          "tab-" + d.tabId,
          "players-" + d.tabId,
        ]);
        await chrome.action.setBadgeText({ tabId: d.tabId, text: "" });
      });
  },
  { urls: ["http://*/*", "https://*/*"] },
);
chrome.tabs.onRemoved.addListener((id) => {
  queue = queue
    .catch(() => {})
    .then(() => chrome.storage.session.remove(["tab-" + id, "players-" + id]));
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message?.type !== "kenuxa-playback" ||
    !Number.isInteger(sender.tab?.id) ||
    !Array.isArray(message.players)
  )
    return;
  const key = "players-" + sender.tab.id;
  queue = queue
    .catch(() => {})
    .then(async () => {
      const saved = (await chrome.storage.session.get(key))[key] || [];
      const players = message.players.slice(0, 30).map((p) => ({
        frameId: sender.frameId || 0,
        index: Number(p.index) || 0,
        urls: (p.urls || [])
          .filter((u) => typeof u === "string" && /^https?:/.test(u))
          .slice(0, 8),
        playing: p.playing === true,
        focused: p.focused === true,
        visible: p.visible === true,
        width: Number(p.width) || 0,
        height: Number(p.height) || 0,
        area: Number(p.area) || 0,
        duration: Number(p.duration) || 0,
        playedAt: Math.min(Number(p.playedAt) || 0, Date.now()),
        observedAt: Date.now(),
        sourceOrigin: sender.origin || new URL(sender.url).origin,
      }));
      await chrome.storage.session.set({
        [key]: [
          ...saved.filter((p) => p.frameId !== (sender.frameId || 0)),
          ...players,
        ].slice(-120),
      });
    });
});
