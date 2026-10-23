export const MAX_BYTES = 256 * 1024 * 1024;
export const urlOf = (value, base) => {
  const u = new URL(value, base);
  if (!["http:", "https:"].includes(u.protocol))
    throw Error("Use an HTTP or HTTPS media URL.");
  return u.href;
};
export const cleanName = (value) => {
  let name =
    String(value || "Kenuxa video")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/[. ]+$/g, "")
      .slice(0, 140) || "Kenuxa video";
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
    ? "Kenuxa-" + name
    : name;
};
export function classify(url, mime = "") {
  if (/\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(mime)) return "HLS";
  if (/\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(mime)) return "DASH";
  if (/\.(m4s|cmfv|cmfa|ts)(?:[?#]|$)/i.test(url)) return null;
  if (
    /\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:[?#]|$)/i.test(url) ||
    /^audio\//i.test(mime)
  )
    return "Audio";
  if (
    /\.(mp4|webm|mov|m4v|mkv|avi)(?:[?#]|$)/i.test(url) ||
    /^video\/(mp4|webm|quicktime|x-matroska)/i.test(mime)
  )
    return "Video";
  return null;
}
export function attrs(line) {
  return Object.fromEntries(
    [...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map((m) => [
      m[1],
      m[2].replace(/^"|"$/g, ""),
    ]),
  );
}
export function parseHls(text, base) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .map((x) => x.trim());
  if (lines[0] !== "#EXTM3U")
    throw Error(
      "This URL did not return an HLS playlist. Detect a fresh media URL.",
    );
  let pending,
    range,
    map,
    lastRange,
    duration = 0;
  const variants = [],
    segments = [],
    audio = [];
  for (const line of lines.slice(1)) {
    if (/^#EXT-X-(SESSION-)?KEY:/.test(line) && attrs(line).METHOD !== "NONE")
      throw Error("Encrypted or protected stream. Kenuxa does not decrypt it.");
    if (line.startsWith("#EXT-X-STREAM-INF:")) pending = attrs(line);
    else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = attrs(line);
      if (a.TYPE === "AUDIO" && a.URI)
        audio.push({ ...a, url: urlOf(a.URI, base) });
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const a = attrs(line),
        next = { url: urlOf(a.URI, base) };
      if (a.BYTERANGE)
        next.range = parseRange(a.BYTERANGE, undefined, next.url);
      if (map && JSON.stringify(map) !== JSON.stringify(next))
        throw Error("Changing HLS initialization maps are not supported.");
      map = next;
    } else if (line.startsWith("#EXT-X-BYTERANGE:")) range = line.slice(17);
    else if (line.startsWith("#EXTINF:"))
      duration += Number(line.slice(8).split(",")[0]) || 0;
    else if (line && !line.startsWith("#")) {
      const url = urlOf(line, base);
      if (pending) {
        const a = pending;
        variants.push({
          url,
          bandwidth: Number(a.BANDWIDTH) || 0,
          height: Number((a.RESOLUTION || "").split("x")[1]) || 0,
          audioGroup: a.AUDIO,
          codecs: a.CODECS || "",
          label:
            a.RESOLUTION ||
            Math.round(Number(a.BANDWIDTH || 0) / 1000) + " kbps",
        });
        pending = undefined;
      } else {
        const seg = { url };
        if (range) {
          seg.range = parseRange(range, lastRange, url);
          lastRange = { ...seg.range, url };
          range = undefined;
        } else lastRange = undefined;
        segments.push(seg);
      }
    }
  }
  if (variants.length)
    return {
      variants: variants.sort(
        (a, b) => b.height - a.height || b.bandwidth - a.bandwidth,
      ),
      audio,
    };
  if (!lines.includes("#EXT-X-ENDLIST"))
    throw Error("Live or unfinished HLS playlists are not supported.");
  if (!segments.length) throw Error("No video segments found.");
  return {
    segments: map ? [map, ...segments] : segments,
    extension: map ? "mp4" : "ts",
    mime: map ? "video/mp4" : "video/mp2t",
    duration,
  };
}
function parseRange(value, previous, url) {
  const [length, offset] = value.split("@").map(Number);
  const start = offset ?? (previous?.url === url ? previous.end + 1 : NaN);
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    !Number.isSafeInteger(start) ||
    start < 0
  )
    throw Error("Invalid or ambiguous media byte range.");
  return { start, end: start + length - 1 };
}
export function chooseQuality(variants, height = "best") {
  const sorted = [...variants].sort(
    (a, b) => b.height - a.height || b.bandwidth - a.bandwidth,
  );
  return height === "best"
    ? sorted[0]
    : sorted.find((v) => v.height <= Number(height)) || sorted.at(-1);
}
export async function planHls(
  url,
  request,
  quality = "best",
  audioOnly = false,
) {
  let chosenAudio;
  for (let depth = 0; depth < 6; depth++) {
    const r = await request(url),
      p = parseHls(await r.text(), r.url || url);
    if (!p.variants) {
      const tracks = [{ ...p, kind: audioOnly ? "audio" : "video" }];
      if (chosenAudio && !audioOnly) {
        const ap = await planHls(chosenAudio, request, "best", true);
        tracks.push({ ...ap.tracks[0], kind: "audio" });
      }
      return { tracks, duration: p.duration };
    }
    const variant = chooseQuality(p.variants, quality);
    const alternatives = p.audio.filter(
      (a) => a["GROUP-ID"] === variant.audioGroup,
    );
    const a = alternatives.find((a) => a.DEFAULT === "YES") || alternatives[0];
    chosenAudio = a?.url;
    if (audioOnly && a) {
      url = a.url;
      chosenAudio = undefined;
    } else url = variant.url;
  }
  throw Error("Too many nested playlists.");
}
const children = (node, name) =>
  [...node.children].filter((c) => c.localName === name);
const child = (node, name) => children(node, name)[0];
function durationSeconds(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?([\d.]+)?S?)?$/.exec(
    s || "",
  );
  return m
    ? Number(m[1] || 0) * 86400 +
        Number(m[2] || 0) * 3600 +
        Number(m[3] || 0) * 60 +
        Number(m[4] || 0)
    : 0;
}
function template(text, representation, number, time) {
  return text
    .replace(/\$\$/g, "\u0000")
    .replace(
      /\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,
      (_, key, width) => {
        let v = {
          RepresentationID: representation.id,
          Bandwidth: representation.bandwidth,
          Number: number,
          Time: time,
        }[key];
        return width ? String(v).padStart(Number(width), "0") : v;
      },
    )
    .replace(/\u0000/g, "$");
}
export function parseDash(xml, base, quality = "best") {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "MPD"
  )
    throw Error("Invalid DASH manifest.");
  const mpd = doc.documentElement;
  if (doc.getElementsByTagNameNS("*", "ContentProtection").length)
    throw Error("Protected DASH stream. Kenuxa does not decrypt it.");
  if (mpd.getAttribute("type") === "dynamic")
    throw Error("Live DASH streams are not supported.");
  const periods = children(mpd, "Period");
  if (periods.length !== 1)
    throw Error("DASH with multiple periods is not supported yet.");
  const period = periods[0];
  const duration =
    durationSeconds(period.getAttribute("duration")) ||
    durationSeconds(mpd.getAttribute("mediaPresentationDuration"));
  const tracks = [];
  for (const set of children(period, "AdaptationSet")) {
    const reps = children(set, "Representation");
    if (!reps.length) continue;
    const kind = (
      set.getAttribute("contentType") ||
      set.getAttribute("mimeType") ||
      reps[0].getAttribute("mimeType") ||
      ""
    ).split("/")[0];
    if (!["video", "audio"].includes(kind)) continue;
    const representations = reps.map((node) => ({
      node,
      id: node.getAttribute("id"),
      height: Number(node.getAttribute("height")) || 0,
      bandwidth: Number(node.getAttribute("bandwidth")) || 0,
    }));
    const selected = chooseQuality(
      representations,
      kind === "audio" ? "best" : quality,
    );
    let current = base;
    const ancestry = [mpd, period, set, selected.node];
    for (const n of ancestry) {
      const b = child(n, "BaseURL");
      if (b) current = urlOf(b.textContent.trim(), current);
    }
    let st, sl;
    for (const n of ancestry) {
      st = child(n, "SegmentTemplate") || st;
      sl = child(n, "SegmentList") || sl;
    }
    const segments = [];
    if (sl) {
      const init = child(sl, "Initialization");
      if (init) {
        const s = {
          url: urlOf(init.getAttribute("sourceURL") || current, current),
        };
        if (init.hasAttribute("range")) {
          const [start, end] = init
            .getAttribute("range")
            .split("-")
            .map(Number);
          s.range = { start, end };
        }
        segments.push(s);
      }
      for (const n of children(sl, "SegmentURL")) {
        const s = { url: urlOf(n.getAttribute("media"), current) };
        if (n.hasAttribute("mediaRange")) {
          const [start, end] = n
            .getAttribute("mediaRange")
            .split("-")
            .map(Number);
          s.range = { start, end };
        }
        segments.push(s);
      }
    } else if (st) {
      const effective = {};
      let timeline;
      for (const n of ancestry) {
        const t = child(n, "SegmentTemplate");
        if (t) {
          for (const a of t.attributes) effective[a.name] = a.value;
          timeline = child(t, "SegmentTimeline") || timeline;
        }
      }
      const timescale = Number(effective.timescale) || 1,
        start = Number(effective.startNumber) || 1,
        offset = Number(effective.presentationTimeOffset) || 0;
      if (!effective.media) throw Error("DASH media template is missing.");
      if (effective.initialization)
        segments.push({
          url: urlOf(
            template(effective.initialization, selected, start, 0),
            current,
          ),
        });
      if (timeline) {
        let time = 0,
          number = start;
        const ss = children(timeline, "S");
        for (let i = 0; i < ss.length; i++) {
          const s = ss[i],
            d = Number(s.getAttribute("d"));
          if (!d || d < 0) throw Error("Invalid DASH segment duration.");
          if (s.hasAttribute("t")) time = Number(s.getAttribute("t"));
          let repeats = Number(s.getAttribute("r")) || 0;
          if (repeats < 0) {
            const next = ss[i + 1]?.getAttribute("t");
            const end =
              next !== null && next !== undefined
                ? Number(next)
                : duration * timescale + offset;
            if (!end) throw Error("Unbounded DASH segment timeline.");
            repeats = Math.ceil((end - time) / d) - 1;
          }
          for (let j = 0; j <= repeats; j++) {
            if (segments.length >= 20000)
              throw Error("Too many DASH segments.");
            segments.push({
              url: urlOf(
                template(effective.media, selected, number++, time),
                current,
              ),
            });
            time += d;
          }
        }
      } else {
        const d = Number(effective.duration);
        if (!duration || !d)
          throw Error("DASH needs a finite duration or segment timeline.");
        const count = Math.ceil((duration * timescale) / d);
        if (count > 20000) throw Error("Too many DASH segments.");
        for (let i = 0; i < count; i++)
          segments.push({
            url: urlOf(
              template(effective.media, selected, start + i, i * d),
              current,
            ),
          });
      }
    } else segments.push({ url: current });
    if (!segments.length) throw Error("No DASH media segments found.");
    // Prefer one default adaptation per type. Alternate languages can be detected separately.
    if (!tracks.some((t) => t.kind === kind))
      tracks.push({
        kind,
        segments,
        extension: kind === "audio" ? "m4a" : "mp4",
        mime: kind === "audio" ? "audio/mp4" : "video/mp4",
        duration,
        height: selected.height,
      });
  }
  if (!tracks.length)
    throw Error("No supported audio or video tracks in DASH manifest.");
  return { tracks, duration };
}
export function makeControl() {
  const waiters = new Set();
  return {
    paused: false,
    cancelled: false,
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
      for (const wake of waiters) wake();
      waiters.clear();
    },
    cancel() {
      this.cancelled = true;
      this.resume();
    },
    async checkpoint() {
      if (this.cancelled) throw new DOMException("Cancelled", "AbortError");
      while (this.paused) await new Promise((r) => waiters.add(r));
      if (this.cancelled) throw new DOMException("Cancelled", "AbortError");
    },
  };
}
export async function collectTracks(
  plan,
  request,
  control,
  onProgress = () => {},
  concurrency = 3,
) {
  let done = 0,
    size = 0;
  const total = plan.tracks.reduce((n, t) => n + t.segments.length, 0),
    output = [];
  for (const track of plan.tracks) {
    const parts = new Array(track.segments.length);
    let next = 0,
      failure;
    async function worker() {
      while (!failure) {
        await control.checkpoint();
        const i = next++;
        if (i >= parts.length) return;
        try {
          const segment = track.segments[i];
          let response;
          for (let attempt = 0; attempt < 3; attempt++) {
            await control.checkpoint();
            try {
              response = await request(segment.url, { range: segment.range });
              break;
            } catch (e) {
              if (e.noRetry || e.name === "AbortError" || attempt === 2)
                throw e;
              await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            }
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          size += bytes.byteLength;
          if (size > MAX_BYTES)
            throw Error(
              "This job exceeds the 256 MB browser memory limit. Choose a lower quality.",
            );
          parts[i] = bytes;
          onProgress(++done, total, size);
        } catch (e) {
          failure = e;
          throw e;
        }
      }
    }
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, parts.length) }, worker),
    );
    const rejected = results.find((r) => r.status === "rejected");
    if (rejected) throw rejected.reason;
    await control.checkpoint();
    output.push({ ...track, blob: new Blob(parts, { type: track.mime }) });
  }
  return { tracks: output, size };
}
