// Only media state is observed. No page text, cookies or playback bytes are collected.
(() => {
  const api = globalThis.browser || globalThis.chrome;
  let timer,
    playedAt = 0;
  function report(event) {
    if (event?.type === "play" || event?.type === "playing")
      playedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const players = [...document.querySelectorAll("video,audio")]
        .slice(0, 30)
        .map((v, index) => {
          const r = v.getBoundingClientRect(),
            s = getComputedStyle(v);
          const visible =
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.top < innerHeight &&
            r.right > 0 &&
            r.left < innerWidth;
          return {
            index,
            url: v.currentSrc || v.src || "",
            urls: [
              v.currentSrc,
              v.src,
              ...[...v.querySelectorAll("source")].map((s) => s.src),
            ].filter((u) => /^https?:/.test(u)),
            playing: !v.paused && !v.ended && v.readyState >= 2,
            visible,
            area: visible ? r.width * r.height : 0,
            width: v.videoWidth || 0,
            height: v.videoHeight || 0,
            duration: Number.isFinite(v.duration) ? v.duration : 0,
            focused: document.activeElement === v,
            playedAt,
            observedAt: Date.now(),
            sourceOrigin: location.origin,
          };
        });
      api.runtime
        .sendMessage({ type: "kenuxa-playback", players })
        .catch(() => {});
    }, 200);
  }
  for (const event of [
    "play",
    "playing",
    "pause",
    "ended",
    "loadedmetadata",
    "emptied",
    "focusin",
  ])
    document.addEventListener(event, report, true);
  report();
})();
