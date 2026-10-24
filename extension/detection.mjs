import { classify } from "./media.mjs";

// Identity only: keep the latest full signed URL for requests. Never discard content IDs.
export function sourceKey(row) {
  const u = new URL(row.url);
  u.hash = "";
  for (const name of [...u.searchParams.keys()])
    if (
      /^(_t|cachebuster|cb)$/i.test(name) ||
      (/\.(m3u8|mpd|mp4|webm|m4a|mp3)$/i.test(u.pathname) &&
        /^(token|expires?|signature|sig|policy|key-pair-id|hdnts|hdnea|x-amz-.+|x-goog-.+)$/i.test(
          name,
        ))
    )
      u.searchParams.delete(name);
  u.searchParams.sort();
  return `${row.frameId || 0}:${u.href}`;
}
export function mergeCaptures(rows) {
  const unique = new Map();
  for (const row of [...rows].sort((a, b) => (a.time || 0) - (b.time || 0))) {
    if (
      !/^https?:/.test(row.url || "") ||
      (!classify(row.url, row.mime) && !row.manual)
    )
      continue;
    const key = sourceKey(row),
      old = unique.get(key);
    unique.set(key, {
      ...old,
      ...row,
      id: old?.id || row.id,
      key,
      firstSeen: Math.min(
        old?.firstSeen || old?.time || Infinity,
        row.firstSeen || row.time || Infinity,
      ),
    });
  }
  return [...unique.values()];
}

// Serializable: this function is also injected into every accessible player frame.
export function inspectPlayers() {
  const now = Date.now();
  return [...document.querySelectorAll("video,audio")]
    .slice(0, 30)
    .map((v, index) => {
      const r = v.getBoundingClientRect(),
        style = getComputedStyle(v);
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < innerHeight &&
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
        area: visible
          ? Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight)
          : 0,
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        currentTime: v.currentTime || 0,
        muted: v.muted,
        volume: v.volume,
        focused:
          document.activeElement === v || v.contains(document.activeElement),
        sourceOrigin: location.origin,
        observedAt: now,
      };
    });
}
export async function scanPlayers(api, tabId) {
  if (!Number.isInteger(tabId)) return [];
  const frames = await api.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: inspectPlayers,
  });
  return frames.flatMap((f) =>
    (f.result || []).map((p) => ({ ...p, frameId: f.frameId })),
  );
}
export function rankSources(rows, players = [], previous = []) {
  const old = new Map(previous.map((r) => [r.key || sourceKey(r), r]));
  const active = [...players]
    .filter((p) => p.playing || p.focused)
    .sort(
      (a, b) =>
        Number(b.playing) - Number(a.playing) ||
        Number(b.focused) - Number(a.focused) ||
        Number(b.visible) - Number(a.visible) ||
        (b.area || 0) - (a.area || 0),
    );
  const primary = active[0];
  const captures = mergeCaptures(rows);
  const playerKeys = new Set(
    (primary?.urls || []).map((url) =>
      sourceKey({ url, frameId: primary.frameId }),
    ),
  );
  const matchesPlayer = (row) =>
    playerKeys.has(row.key) ||
    [
      ...(row.variants || old.get(row.key)?.variants || []),
      ...(row.audioPlaylists || old.get(row.key)?.audioPlaylists || []),
    ].some((v) => playerKeys.has(sourceKey({ ...row, url: v.url })));
  const hasExactMatch = captures.some(matchesPlayer);
  const grouped = captures.map((row) => {
    const prior = old.get(row.key);
    const exact = primary && matchesPlayer(row);
    const sameFrame = primary && (row.frameId || 0) === (primary.frameId || 0);
    // Blob/MSE streams cannot be identified conclusively from a video URL.
    const recent =
      sameFrame &&
      primary.playing &&
      !hasExactMatch &&
      row.time >= (primary.playedAt || primary.observedAt) - 15000;
    const confidence = exact
      ? "Playing video"
      : recent
        ? "Likely playing video"
        : "Other detected source";
    const score =
      (exact ? 1000 : recent ? 200 : sameFrame ? 40 : 0) +
      (row.master ? 30 : 0) +
      (row.kind === "HLS" || row.kind === "DASH" ? 10 : 0);
    return {
      ...prior,
      ...row,
      id: prior?.id || row.id,
      quality: prior?.quality || row.quality || "best",
      format: prior?.format || row.format || "original",
      qualities: row.qualities || prior?.qualities,
      variants: row.variants || prior?.variants,
      audioPlaylists: row.audioPlaylists || prior?.audioPlaylists,
      master: row.master || prior?.master,
      qualityLabel: row.qualityLabel || prior?.qualityLabel,
      focused: Boolean(exact || recent),
      confidence,
      score,
      height: exact ? primary.height : row.height,
      width: exact ? primary.width : row.width,
    };
  });
  // A parsed master owns its exact child playlists, rather than showing one card per rendition.
  const childKeys = new Set(
    grouped.flatMap((r) =>
      [...(r.variants || []), ...(r.audioPlaylists || [])].map((v) =>
        sourceKey({ ...r, url: v.url }),
      ),
    ),
  );
  for (const parent of grouped)
    if (parent.master) {
      const keys = new Set(
        [...(parent.variants || []), ...(parent.audioPlaylists || [])].map(
          (v) => sourceKey({ ...parent, url: v.url }),
        ),
      );
      const playingChild = grouped.find((r) => keys.has(r.key) && r.focused);
      if (playingChild) {
        parent.focused = true;
        parent.confidence = playingChild.confidence;
        parent.score = Math.max(parent.score, playingChild.score + 30);
      }
    }
  return grouped
    .filter((r) => !childKeys.has(r.key) || r.master)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.master) - Number(a.master) ||
        (b.time || 0) - (a.time || 0),
    );
}
