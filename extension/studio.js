import "./browser-bridge.mjs";
import {
  classify,
  urlOf,
  cleanName,
  parseHls,
  parseDash,
  planHls,
  makeControl,
  collectTracks,
  MAX_BYTES,
} from "./media.mjs";
import { initWatch, allowSharing } from "./watch.mjs";
import { requester } from "./requests.mjs";
import { convert, stopConversion } from "./converter.mjs";
import {
  scanPlayers,
  rankSources,
  sourceKey,
  mergeCaptures,
} from "./detection.mjs";
import {
  probe,
  saveVideo,
  listVideos,
  getBlob,
  removeVideo,
  renameVideo,
} from "./library.mjs";
const $ = (id) => document.getElementById(id),
  api = chrome;
const state = {
  source: {},
  items: [],
  selected: new Set(),
  queue: [],
  history: [],
  filter: "all",
  view: "home",
  videos: [],
  running: false,
  preview: null,
  showAllSources: false,
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const bytes = (n) =>
  n >= 1048576
    ? (n / 1048576).toFixed(1) + " MB"
    : n >= 1024
      ? Math.round(n / 1024) + " KB"
      : n + " B";
function notify(text, error = false) {
  $("notice").hidden = !text;
  $("notice").textContent = text;
  $("notice").className = "notice" + (error ? " error" : "");
}
function sourceFor(item) {
  return {
    sourceTabId: state.source.sourceTabId,
    sourceOrigin: item.sourceOrigin || state.source.sourceOrigin,
    frameId: item.frameId || 0,
  };
}
function visible() {
  const q = $("search").value.toLowerCase();
  return state.items.filter(
    (i) =>
      (state.showAllSources ||
        !state.items.some((r) => r.focused) ||
        i.focused ||
        i.manual) &&
      (state.filter === "all" || i.kind === state.filter) &&
      (i.title + " " + i.url).toLowerCase().includes(q),
  );
}
function empty(target, title, text, symbol = "◎") {
  const n = el("div", "empty");
  n.append(
    el("span", "empty-symbol", symbol),
    el("h3", "", title),
    el("p", "", text),
  );
  target.append(n);
}
function select(options, value, onchange) {
  const s = el("select");
  for (const [v, label] of options) {
    const o = el("option", "", label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.onchange = () => onchange(s.value);
  return s;
}
function button(label, cls, action) {
  const b = el("button", cls, label);
  b.onclick = () =>
    Promise.resolve()
      .then(action)
      .catch((e) => notify(e.message, true));
  return b;
}
const formats = [
  ["original", "Original · no quality loss"],
  ["mp4", "MP4 · copy original quality"],
  ["compatible", "MP4 · re-encode (HQ)"],
  ["mp3", "MP3 · audio"],
];
function metrics() {
  $("navHome").textContent = state.videos.length;
  $("homeTotal").textContent = state.videos.length;
  const pending = state.queue.filter(
    (j) => !["complete", "failed", "cancelled"].includes(j.status),
  ).length;
  $("navLibrary").textContent = state.items.length;
  $("sourceCount").textContent = state.items.length;
  $("libraryTotal").textContent = state.items.length;
  $("queueCount").textContent = pending;
  $("navQueue").textContent = pending;
  $("completeCount").textContent = state.history.length;
}
function renderLibrary() {
  const grid = $("mediaGrid");
  grid.replaceChildren();
  const items = visible();
  const focused = state.items.filter((r) => r.focused);
  $("focusSummary").textContent = focused.length
    ? `${focused.length} playing-video ${focused.length === 1 ? "match" : "candidates"} · ${state.items.length - focused.length} other sources tucked away. Check the match before downloading.`
    : "No confident playing-video match. Play the video, then Find playing video. All grouped detections remain available.";
  $("showAllSources").textContent = state.showAllSources
    ? "Show playing video first"
    : `Show all sources (${state.items.length})`;
  $("selectAll").checked =
    items.length > 0 && items.every((i) => state.selected.has(i.id));
  if (!items.length)
    empty(
      grid,
      state.items.length
        ? "No matching media"
        : "Your library is ready for its first video",
      state.items.length
        ? "Try another search or filter."
        : "Play a video in its source tab, then refresh sources here. You can also add a direct media URL.",
    );
  for (const item of items) {
    const card = el(
      "article",
      "media-card" + (state.selected.has(item.id) ? " selected" : ""),
    );
    card.dataset.kind = item.kind;
    const art = el("div", "card-art"),
      check = el("input", "card-check");
    check.type = "checkbox";
    check.checked = state.selected.has(item.id);
    check.setAttribute("aria-label", "Select " + item.title);
    check.onchange = () => {
      check.checked
        ? state.selected.add(item.id)
        : state.selected.delete(item.id);
      card.classList.toggle("selected", check.checked);
    };
    const symbol = el("span", "art-symbol"),
      play = el("span", "art-play", item.kind === "Audio" ? "♫" : "▶");
    symbol.append(play);
    art.append(
      check,
      el("span", "type-badge", item.kind),
      symbol,
      el("span", "art-label", "KENUXA / MEDIA SOURCE"),
    );
    const body = el("div", "card-body"),
      title = el("h3", "card-title", item.title),
      host = el(
        "div",
        "card-host",
        new URL(item.url).hostname +
          " · " +
          new URL(item.url).pathname.split("/").slice(-2).join("/"),
      );
    host.title = new URL(item.url).hostname + new URL(item.url).pathname;
    const tags = el("div", "card-tags");
    tags.append(
      el(
        "span",
        item.focused ? "tag green" : "tag",
        item.confidence || "Added source",
      ),
      el(
        "span",
        "tag",
        item.qualityLabel ||
          (["HLS", "DASH"].includes(item.kind)
            ? "ADAPTIVE STREAM"
            : "DIRECT FILE"),
      ),
      el(
        "span",
        "tag green",
        item.size ? bytes(item.size) : "SOURCE CONNECTED",
      ),
    );
    const options = el("div", "card-options");
    const qs = [
      [
        "best",
        item.qualities?.[0]
          ? `Best source · ${item.qualities[0]}p`
          : "Best source available",
      ],
      ...(item.qualities || []).map((h) => [String(h), h + "p"]),
    ];
    const quality = select(
      qs,
      item.quality || "best",
      (v) => (item.quality = v),
    );
    quality.setAttribute("aria-label", "Quality for " + item.title);
    quality.disabled = !["HLS", "DASH"].includes(item.kind);
    if (quality.disabled)
      quality.options[0].textContent = item.height
        ? `Original source · ${item.height}p`
        : "Original source quality";
    const format = select(formats, item.format || "original", (v) => {
      item.format = v;
      renderLibrary();
    });
    format.setAttribute("aria-label", "Format for " + item.title);
    options.append(quality, format);
    const bottom = el("div", "card-bottom"),
      add = button("⇣  Add to queue", "primary", () => addJob(item));
    const inspect = button("Find qualities", "secondary small", async () => {
      inspect.disabled = true;
      try {
        await inspectItem(item);
        state.items = rankSources(
          state.items,
          state.players || [],
          state.items,
        );
        notify(
          "Source inspected. Available quality options have been updated.",
        );
        renderLibrary();
      } finally {
        inspect.disabled = false;
      }
    });
    inspect.title = "Inspect quality & source";
    inspect.setAttribute("aria-label", "Inspect " + item.title);
    bottom.append(add, inspect);
    const qualityNote = el(
      "p",
      "quality-note",
      item.probeError ||
        (item.format === "compatible"
          ? "Re-encoding can change detail. Use Original to preserve source quality."
          : item.inspected && !item.qualities?.length
            ? "This source exposes one quality. Kenuxa does not invent higher resolutions."
            : "Original copies source video and audio without re-encoding. Find qualities to inspect source renditions."),
    );
    body.append(title, host, tags, options, qualityNote, bottom);
    card.append(art, body);
    grid.append(card);
  }
  metrics();
}
async function inspectItem(item) {
  const request = requester(api, sourceFor(item), makeControl());
  if (item.kind === "HLS") {
    const r = await request(item.url),
      p = parseHls(await r.text(), r.url || item.url);
    item.qualities = [
      ...new Set((p.variants || []).map((v) => v.height).filter(Boolean)),
    ].sort((a, b) => b - a);
    item.variants = p.variants || [];
    item.audioPlaylists = p.audio || [];
    item.master = Boolean(p.variants?.length);
    item.height = p.variants?.[0]?.height || item.height;
    item.qualityLabel = p.duration
      ? Math.round(p.duration) + " SEC · HLS"
      : "QUALITY OPTIONS";
  } else if (item.kind === "DASH") {
    const r = await request(item.url),
      xml = await r.text();
    parseDash(xml, r.url || item.url);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    item.qualities = [
      ...new Set(
        [...doc.getElementsByTagNameNS("*", "Representation")]
          .map((n) =>
            Number(
              n.getAttribute("height") ||
                n.parentElement?.getAttribute("height"),
            ),
          )
          .filter(Boolean),
      ),
    ].sort((a, b) => b - a);
  } else {
    const r = await request(item.url, { method: "HEAD" });
    item.size = Number(r.headers.get("content-length")) || item.size;
  }
  item.inspected = true;
  item.probeError = "";
}
const watch = initWatch(api, notify);
const VIEWS = [
  "watch",
  "home",
  "library",
  "queue",
  "history",
  "convert",
  "help",
];
function showView(view) {
  if (!VIEWS.includes(view)) view = "home";
  state.view = view;
  for (const name of VIEWS) $(name + "View").hidden = name !== view;
  document
    .querySelectorAll("[data-view]")
    .forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  const labels = {
      watch: "Kenuxa Watch",
      home: "On this device",
      library: "Media library",
      queue: "Download queue",
      history: "History",
      convert: "File converter",
      help: "Help & coverage",
    },
    headings = {
      watch: "Kenuxa Watch",
      home: "Previously saved, still yours.",
      library: "Capture. Collect. Create.",
      queue: "Your downloads, in motion.",
      history: "A record of what’s yours.",
      convert: "Make every file work for you.",
      help: "Know your workspace.",
    };
  $("crumb").textContent = labels[view];
  $("heading").textContent = headings[view];
  $("subtitle").textContent = {
    watch: "Your community of discoveries, inside Kenuxa.",
    home: "Your existing personal shelf. New public listings use original-source embeds.",
    library:
      "Discover your media, choose its quality, and make it yours to work with.",
    queue: "Stay in control from the first media part to the final saved file.",
    history: "Your completed downloads, kept locally and ready to find.",
    convert: "A capable media engine. Right inside your browser.",
    help: "Clear capabilities, useful guidance, and no hidden promises.",
  }[view];
  $("privacyLabel").textContent =
    view === "watch" ? "Public community" : "Files stay local";
  history.replaceState(null, "", "#" + view);
  if (view === "watch") watch.refresh();
  if (view === "home") renderHome();
  if (view === "queue") renderQueue();
  if (view === "history") renderHistory();
}
function renderQueue() {
  const list = $("queueList");
  list.replaceChildren();
  if (!state.queue.length)
    empty(
      list,
      "A little room for your next download",
      "Add a source from your library. Kenuxa will take care of the queue.",
      "⇣",
    );
  for (const j of state.queue) {
    const card = el("article", "job-card");
    card.dataset.job = j.id;
    const head = el("div", "job-head"),
      meta = el("div", "job-meta");
    meta.append(
      el("strong", "", j.title),
      el(
        "small",
        "",
        j.kind +
          " · " +
          (formats.find((f) => f[0] === j.format)?.[1] || j.format) +
          (j.quality && j.quality !== "best"
            ? " · " + j.quality + "p source"
            : ""),
      ),
    );
    head.append(
      el("div", "job-icon", j.status === "complete" ? "✓" : "⇣"),
      meta,
      el(
        "span",
        "status-label " + j.status,
        j.control.paused
          ? "Paused"
          : j.status[0].toUpperCase() + j.status.slice(1),
      ),
    );
    const progress = el("progress", "job-progress");
    progress.max = 1;
    progress.value = j.progress || 0;
    card.append(
      head,
      progress,
      el("div", "job-status", j.message || "Waiting in queue."),
    );
    const controls = el("div", "job-controls");
    if (j.status === "downloading")
      controls.append(
        button(j.control.paused ? "Resume" : "Pause", "secondary small", () => {
          j.control.paused ? j.control.resume() : j.control.pause();
          renderQueue();
        }),
      );
    if (["queued", "downloading", "processing", "saving"].includes(j.status))
      controls.append(
        button("Cancel", "ghost", () => {
          j.control.cancel();
          if (j.status === "processing") stopConversion();
          if (j.downloadId !== undefined)
            api.downloads.cancel(j.downloadId).catch(() => {});
          if (j.status === "queued") {
            j.status = "cancelled";
            j.message = "Cancelled before starting.";
          } else j.message = "Cancelling after the current operation…";
          renderQueue();
        }),
      );
    if (["failed", "cancelled"].includes(j.status))
      controls.append(
        button("↻ Retry", "secondary small", () => {
          j.status = "queued";
          j.progress = 0;
          j.message = "Waiting to retry.";
          j.control = makeControl();
          renderQueue();
          runQueue();
        }),
      );
    if (j.status === "complete")
      controls.append(
        button("Show saved file", "secondary small", () =>
          api.downloads.show(j.downloadId),
        ),
      );
    card.append(controls);
    list.append(card);
  }
  metrics();
}
let consentResolver;
function chooseSharing(count = 1) {
  return new Promise((resolve) => {
    consentResolver = resolve;
    $("shareCount").textContent =
      count === 1 ? "this download" : count + " selected downloads";
    $("shareRights").checked = false;
    $("sharePublic").disabled = true;
    $("sharingDialog").showModal();
  });
}
function enqueue(item, share) {
  if (
    state.queue.some(
      (j) =>
        j.url &&
        sourceKey(j) === sourceKey(item) &&
        !["failed", "cancelled", "complete"].includes(j.status),
    )
  )
    return;
  const j = {
    ...item,
    id: crypto.randomUUID(),
    source: sourceFor(item),
    quality: item.quality || "best",
    format: item.format || "original",
    sharePublic: share,
    watchSourceUrl: state.source.sourceUrl,
    status: "queued",
    progress: 0,
    control: makeControl(),
  };
  state.queue.push(j);
  notify(
    share
      ? "Queued. After saving, the title and source page will be shared with everyone on Watch. No video file is uploaded."
      : "Queued privately. Nothing is sent to Kenuxa Watch.",
  );
  metrics();
  runQueue();
}
async function addJob(item) {
  if (
    state.queue.some(
      (j) =>
        j.url &&
        sourceKey(j) === sourceKey(item) &&
        !["failed", "cancelled", "complete"].includes(j.status),
    )
  ) {
    notify(
      "This video is already in the queue. Change or finish that job before adding another copy.",
    );
    return;
  }
  if (["HLS", "DASH"].includes(item.kind) && !item.inspected) {
    await inspectItem(item);
    renderLibrary();
    if (item.qualities?.length > 1) {
      notify(
        "Source qualities are ready. Choose a resolution, then Add to queue.",
      );
      return;
    }
  }
  const share = await chooseSharing();
  if (share !== null) enqueue(item, share);
}
async function directPlan(j, request) {
  let meta;
  try {
    meta = await request(j.url, { method: "HEAD" });
  } catch (e) {
    if (e.noRetry) throw e;
    meta = await request(j.url);
  }
  const mime = meta?.headers.get("content-type") || "",
    detected = classify(j.url, mime);
  if (detected === "HLS")
    return planHls(j.url, request, j.quality, j.format === "mp3");
  if (detected === "DASH") {
    const r = await request(j.url);
    return parseDash(await r.text(), r.url || j.url, j.quality);
  }
  if (/text\/html|application\/(json|xhtml)/i.test(mime))
    throw Error(
      "This is a webpage or API response, not a direct media file. Play the video and choose a detected media source.",
    );
  const size = Number(meta?.headers.get("content-length")) || 0;
  if (size > MAX_BYTES) throw Error("This file exceeds the 256 MB limit.");
  const ext =
    /\.(mp4|webm|mov|m4v|mkv|avi|mp3|m4a|aac|ogg|opus|wav|flac)(?:[?#]|$)/i.exec(
      j.url,
    )?.[1] ||
    (/webm/i.test(j.mime || "") ? "webm" : j.kind === "Audio" ? "m4a" : "mp4");
  const segments = [];
  if (size && /bytes/i.test(meta?.headers.get("accept-ranges") || "")) {
    const step = 8 * 1024 * 1024;
    for (let start = 0; start < size; start += step)
      segments.push({
        url: j.url,
        range: { start, end: Math.min(size - 1, start + step - 1) },
      });
  } else segments.push({ url: j.url });
  return {
    tracks: [
      {
        kind: j.kind === "Audio" ? "audio" : "video",
        segments,
        expectedSize: size,
        extension: ext,
        mime:
          meta?.headers.get("content-type") ||
          j.mime ||
          "application/octet-stream",
      },
    ],
  };
}
async function downloadJob(j) {
  const request = requester(api, j.source, j.control);
  let collected;
  if (j.localFile) {
    collected = {
      tracks: [
        {
          kind:
            /^audio\//.test(j.localFile.type) ||
            /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(j.localFile.name)
              ? "audio"
              : "video",
          blob: j.localFile,
          extension:
            j.localFile.name
              .split(".")
              .pop()
              .replace(/[^a-z0-9]/gi, "") || "bin",
        },
      ],
      size: j.localFile.size,
    };
  } else {
    j.status = "downloading";
    j.message = "Reading the media source…";
    renderQueue();
    let plan;
    if (j.kind === "HLS")
      plan = await planHls(j.url, request, j.quality, j.format === "mp3");
    else if (j.kind === "DASH") {
      const r = await request(j.url);
      plan = parseDash(await r.text(), r.url || j.url, j.quality);
      if (j.format === "mp3" && plan.tracks.some((t) => t.kind === "audio"))
        plan.tracks = plan.tracks.filter((t) => t.kind === "audio");
    } else plan = await directPlan(j, request);
    j.actualHeight =
      plan.quality?.height ||
      plan.tracks.find((t) => t.kind === "video")?.height ||
      j.height;
    j.message = j.actualHeight
      ? `Downloading ${j.actualHeight}p source · original quality`
      : "Downloading original source bytes";
    collected = await collectTracks(
      plan,
      request,
      j.control,
      (done, total, size) => {
        j.progress = (done / total) * 0.78;
        j.message = `${done} of ${total} parts · ${bytes(size)} received`;
        updateJob(j);
      },
    );
  }
  await j.control.checkpoint();
  j.status = "processing";
  j.progress = 0.8;
  j.message = "Preparing your file…";
  renderQueue();
  const result = await convert(collected.tracks, j.format, (message) => {
    j.message = message;
    updateJob(j);
    if (state.view === "convert") $("convertStatus").textContent = message;
  });
  await j.control.checkpoint();
  j.status = "saving";
  j.progress = 0.95;
  j.message = "Choose a save location. Waiting for the browser to finish…";
  renderQueue();
  const filename =
    cleanName(
      j.title.replace(/\.(mp4|webm|ts|mkv|mov|mp3|m4a|wav|aac|flac)$/i, ""),
    ) +
    "." +
    result.extension;
  j.downloadId = await saveBlob(result.blob, filename, j);
  await j.control.checkpoint();
  j.status = "complete";
  j.progress = 1;
  j.message =
    bytes(result.blob.size) +
    " saved · " +
    result.extension.toUpperCase() +
    (j.actualHeight ? ` · ${j.actualHeight}p` : "") +
    (j.format === "compatible"
      ? " · HQ re-encode"
      : j.format === "mp3"
        ? ""
        : " · source quality preserved");
  const entry = {
    id: j.downloadId,
    filename,
    bytes: result.blob.size,
    date: new Date().toISOString(),
    format: result.extension,
    host: j.url ? new URL(j.url).hostname : "Local file",
    height: j.actualHeight || null,
    qualityMode:
      j.format === "compatible"
        ? "HQ re-encode"
        : j.format === "mp3"
          ? "Audio export"
          : "Original bytes / stream copy",
  };
  // Downloaded bytes are saved to disk, not uploaded or duplicated in Home.
  state.history.unshift(entry);
  state.history = state.history.slice(0, 100);
  await api.storage.local.set({ kenuxaHistory: state.history });
  if (j.localFile)
    $("convertStatus").textContent =
      "Saved " + filename + " · " + bytes(result.blob.size);
  if (j.sharePublic) {
    try {
      await watch.add({ title: j.title, source: j.watchSourceUrl });
      j.message += " · Source shared on Kenuxa Watch";
    } catch (e) {
      j.message += " · Sharing unavailable: " + e.message;
    }
  }
}
const fmtTime = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  return (
    (h ? h + ":" + String(m).padStart(2, "0") : m) +
    ":" +
    String(r).padStart(2, "0")
  );
};
const ago = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  for (const [n, u] of [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ])
    if (d >= n) {
      const k = Math.floor(d / n);
      return k + " " + u + (k > 1 ? "s" : "") + " ago";
    }
  return "Just now";
};
async function keepInHome(j, result, filename) {
  // Best-effort: a storage failure must never turn a finished download into a failed job.
  try {
    const audio =
        result.extension === "mp3" || /^audio\//.test(result.blob.type),
      info = await probe(result.blob, audio);
    await saveVideo(
      {
        id: crypto.randomUUID(),
        title: filename.replace(/\.[^.]+$/, ""),
        host: j.url ? new URL(j.url).hostname : "Local file",
        date: new Date().toISOString(),
        format: result.extension,
        bytes: result.blob.size,
        duration: info.duration,
        audio,
        thumb: info.thumb,
      },
      result.blob,
    );
    state.videos = await listVideos();
    renderHome();
    metrics();
  } catch (e) {
    notify(
      "Your file was saved, but it could not be added to Home: " +
        (e.message || e),
      true,
    );
  }
}
const thumbUrls = [];
function renderHome() {
  const grid = $("homeGrid");
  grid.replaceChildren();
  thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const q = $("homeSearch").value.toLowerCase(),
    items = state.videos.filter((v) =>
      (v.title + " " + v.host).toLowerCase().includes(q),
    );
  if (!items.length)
    empty(
      grid,
      state.videos.length
        ? "No matching videos"
        : "Your Home is waiting for its first video",
      "Existing personal copies appear here. New downloads save to disk without duplicate browser storage.",
      "▶",
    );
  for (const v of items) {
    const card = el("article", "video-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", "Play " + v.title);
    const thumb = el("div", "video-thumb");
    if (v.thumb) {
      const u = URL.createObjectURL(v.thumb);
      thumbUrls.push(u);
      const img = el("img");
      img.src = u;
      img.alt = "";
      thumb.append(img);
    } else thumb.append(el("span", "thumb-fallback", v.audio ? "♫" : "▶"));
    thumb.append(
      el(
        "span",
        "duration",
        v.duration ? fmtTime(v.duration) : v.format.toUpperCase(),
      ),
    );
    const info = el("div", "video-info"),
      text = el("div");
    text.append(
      el("h3", "video-title", v.title),
      el(
        "p",
        "video-sub",
        v.host + " · " + bytes(v.bytes) + " · " + ago(v.date),
      ),
    );
    info.append(
      el("span", "channel-dot", (v.host[0] || "K").toUpperCase()),
      text,
    );
    card.append(thumb, info);
    const open = () => openPlayer(v);
    card.onclick = open;
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };
    grid.append(card);
  }
  metrics();
}
let playing = null,
  playingUrl = null;
async function openPlayer(v) {
  const blob = await getBlob(v.id);
  if (!blob) {
    notify("That video is no longer in storage.", true);
    state.videos = await listVideos();
    renderHome();
    return;
  }
  playing = v;
  playingUrl = URL.createObjectURL(blob);
  const m = el(v.audio ? "audio" : "video");
  m.controls = true;
  m.autoplay = true;
  m.src = playingUrl;
  $("playerHost").replaceChildren(m);
  $("playerTitle").textContent = v.title;
  $("playerInfo").textContent =
    v.host +
    " · " +
    bytes(v.bytes) +
    " · " +
    v.format.toUpperCase() +
    " · " +
    ago(v.date);
  $("playerDialog").showModal();
}
function closePlayer() {
  const m = $("playerHost").firstChild;
  if (m) {
    m.pause();
    m.removeAttribute("src");
    m.load();
  }
  $("playerHost").replaceChildren();
  if (playingUrl) URL.revokeObjectURL(playingUrl);
  playing = playingUrl = null;
  if ($("playerDialog").open) $("playerDialog").close();
}
$("closePlayer").onclick = closePlayer;
$("playerDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closePlayer();
});
$("playerSave").onclick = async () => {
  const v = playing;
  if (!v) return;
  const url = URL.createObjectURL(await getBlob(v.id));
  try {
    await api.downloads.download({
      url,
      filename: cleanName(v.title) + "." + v.format,
      saveAs: true,
    });
  } catch (e) {
    notify(e.message, true);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
$("playerRename").onclick = async () => {
  const v = playing;
  if (!v) return;
  const t = prompt("Rename video", v.title);
  if (t && t.trim()) {
    await renameVideo(v.id, t.trim());
    v.title = t.trim();
    $("playerTitle").textContent = v.title;
    renderHome();
  }
};
$("playerDelete").onclick = async () => {
  const v = playing;
  if (
    !v ||
    !confirm(
      "Remove “" +
        v.title +
        "” from Kenuxa Home? A copy you saved to disk is not touched.",
    )
  )
    return;
  await removeVideo(v.id);
  closePlayer();
  state.videos = await listVideos();
  renderHome();
};
$("homeSearch").oninput = renderHome;

async function saveBlob(blob, filename, j) {
  const blobUrl = URL.createObjectURL(blob);
  let id;
  try {
    id = await api.downloads.download({ url: blobUrl, filename, saveAs: true });
    j.downloadId = id;
    if (j.control.cancelled) {
      await api.downloads.cancel(id);
      throw new DOMException("Cancelled", "AbortError");
    }
    await new Promise((resolve, reject) => {
      const changed = (d) => {
        if (d.id !== id) return;
        if (d.state?.current === "complete") {
          cleanup();
          resolve();
        } else if (d.state?.current === "interrupted") {
          cleanup();
          reject(
            Error(d.error?.current || "The browser interrupted this download."),
          );
        }
      };
      function cleanup() {
        api.downloads.onChanged.removeListener(changed);
        clearInterval(poll);
      }
      const poll = setInterval(() => {
        if (j.control.cancelled) {
          api.downloads.cancel(id).catch(() => {});
          cleanup();
          reject(new DOMException("Cancelled", "AbortError"));
        }
      }, 500);
      api.downloads.onChanged.addListener(changed);
      api.downloads.search({ id }).then(
        ([item]) => {
          if (item?.state === "complete") {
            cleanup();
            resolve();
          } else if (item?.state === "interrupted") {
            cleanup();
            reject(Error(item.error || "Download interrupted."));
          }
        },
        (e) => {
          cleanup();
          reject(e);
        },
      );
    });
    return id;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
function updateJob(j) {
  if (state.view !== "queue") return;
  const card = $("queueList").querySelector(`[data-job="${j.id}"]`);
  if (card) {
    card.querySelector("progress").value = j.progress;
    card.querySelector(".job-status").textContent = j.message;
  }
}
async function runQueue() {
  if (state.running) return;
  state.running = true;
  try {
    for (;;) {
      const j = state.queue.find((j) => j.status === "queued");
      if (!j) break;
      try {
        await downloadJob(j);
      } catch (e) {
        j.status =
          j.control.cancelled || e.name === "AbortError"
            ? "cancelled"
            : "failed";
        j.message =
          j.status === "cancelled"
            ? "Download cancelled."
            : e.message || String(e);
        if (j.localFile) $("convertStatus").textContent = j.message;
      }
      renderQueue();
      renderHistory();
    }
  } finally {
    state.running = false;
    metrics();
  }
}
function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();
  if (!state.history.length)
    empty(
      list,
      "Your completed downloads will live here",
      "A file appears here only after the browser confirms that it was saved.",
      "◷",
    );
  for (const h of state.history) {
    const row = el("article", "history-row"),
      meta = el("div");
    meta.append(
      el("strong", "", h.filename),
      el(
        "small",
        "",
        new Date(h.date).toLocaleString() +
          " · " +
          h.host +
          " · " +
          bytes(h.bytes) +
          (h.height ? " · " + h.height + "p" : "") +
          (h.qualityMode ? " · " + h.qualityMode : ""),
      ),
    );
    row.append(
      el("span", "stat-icon green", "✓"),
      meta,
      button("Show file", "secondary small", () => api.downloads.show(h.id)),
    );
    list.append(row);
  }
}
async function refreshSources() {
  if (state.refreshing) return;
  state.refreshing = true;
  $("refresh").disabled = true;
  try {
    await discoverSources();
  } finally {
    state.refreshing = false;
    $("refresh").disabled = false;
  }
}
async function discoverSources() {
  if (state.source.sourceTabId === undefined) {
    notify("Open Kenuxa from the page that is playing your video.");
    return;
  }
  const tabId = state.source.sourceTabId,
    key = "tab-" + tabId;
  const saved = await api.storage.session.get(key),
    stored =
      (await api.storage.session.get("players-" + tabId))["players-" + tabId] ||
      [];
  let players = [];
  try {
    players = await scanPlayers(api, tabId);
  } catch (e) {
    notify("Player inspection unavailable: " + e.message, true);
  }
  state.players = players.map((p) => ({
    ...p,
    playedAt:
      stored.find((s) => s.frameId === p.frameId && s.index === p.index)
        ?.playedAt || p.observedAt,
  }));
  const direct = players.flatMap((p) =>
    (p.urls || [])
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
  const incoming = mergeCaptures([...(saved[key] || []), ...direct]);
  const manual = state.items.filter((i) => i.manual);
  state.items = rankSources(
    [...incoming, ...manual],
    state.players,
    state.items,
  ).map((i) => ({
    ...i,
    title: i.title || state.source.title || "Detected media",
  }));
  renderLibrary();
  notify("Matching the playing video and reading source qualities…");
  // Inspect a bounded set, starting with the playing-video candidates. Never flood the provider.
  for (const item of state.items.slice(0, 6))
    if (["HLS", "DASH"].includes(item.kind) && !item.inspected) {
      try {
        await inspectItem(item);
      } catch (e) {
        item.probeError = e.message;
      }
    }
  state.items = rankSources(state.items, state.players, state.items);
  state.selected = new Set(
    [...state.selected].filter((id) => state.items.some((i) => i.id === id)),
  );
  renderLibrary();
  notify(
    state.items.length +
      " grouped sources ready. Playing-video matches come first; Original preserves source quality.",
  );
}
function setFile(file) {
  if (!file) return;
  if (file.size > MAX_BYTES) {
    notify("Choose a file smaller than 256 MB.", true);
    return;
  }
  $("fileLabel").textContent = file.name;
  $("localFile").kenuxaFile = file;
  $("convertStatus").textContent = bytes(file.size) + " · Ready to convert";
}
document
  .querySelectorAll("[data-view]")
  .forEach((n) => (n.onclick = () => showView(n.dataset.view)));
document.querySelectorAll("[data-filter]").forEach(
  (n) =>
    (n.onclick = () => {
      state.filter = n.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.classList.toggle("active", b === n));
      renderLibrary();
    }),
);
$("search").oninput = renderLibrary;
$("showAllSources").onclick = () => {
  state.showAllSources = !state.showAllSources;
  renderLibrary();
};
$("selectAll").onchange = () => {
  for (const item of visible())
    $("selectAll").checked
      ? state.selected.add(item.id)
      : state.selected.delete(item.id);
  renderLibrary();
};
$("queueSelected").onclick = async () => {
  const items = state.items.filter((i) => state.selected.has(i.id));
  if (!items.length) {
    notify("Select at least one media source first.");
    return;
  }
  const share = await chooseSharing(items.length);
  if (share === null) return;
  for (const item of items) enqueue(item, share);
  state.selected.clear();
  renderLibrary();
  showView("queue");
};
$("refresh").onclick = () =>
  refreshSources().catch((e) => notify(e.message, true));
$("clearFinished").onclick = () => {
  state.queue = state.queue.filter(
    (j) => !["complete", "failed", "cancelled"].includes(j.status),
  );
  renderQueue();
};
$("clearHistory").onclick = async () => {
  state.history = [];
  await api.storage.local.set({ kenuxaHistory: [] });
  renderHistory();
  metrics();
};
$("pasteTop").onclick = () => $("addDialog").showModal();
$("closeDialog").onclick = () => $("addDialog").close();
$("shareRights").onchange = () =>
  ($("sharePublic").disabled = !$("shareRights").checked);
for (const [id, choice] of [
  ["sharePrivate", false],
  ["sharePublic", true],
])
  $(id).onclick = async () => {
    try {
      if (choice) await allowSharing();
      $("sharingDialog").close();
      consentResolver?.(choice);
      consentResolver = undefined;
    } catch (e) {
      notify(e.message, true);
    }
  };
$("sharingDialog").addEventListener("cancel", () => {
  consentResolver?.(null);
  consentResolver = undefined;
});
window.addEventListener("hashchange", () =>
  showView(location.hash.slice(1) || "library"),
);
$("addForm").onsubmit = (e) => {
  e.preventDefault();
  try {
    const url = urlOf($("manualUrl").value.trim());
    if (state.items.some((i) => i.url === url)) {
      notify("That source is already in your library.");
      return;
    }
    const kind = classify(url) || "Video";
    state.items.unshift({
      id: crypto.randomUUID(),
      url,
      kind,
      title: $("manualName").value.trim() || "Added media",
      frameId: 0,
      manual: true,
    });
    $("addDialog").close();
    $("addForm").reset();
    showView("library");
    renderLibrary();
  } catch (error) {
    notify(error.message, true);
  }
};
$("localFile").onchange = () => setFile($("localFile").files[0]);
for (const name of ["dragenter", "dragover"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.add("dragover");
  });
for (const name of ["dragleave", "drop"])
  $("dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("dropzone").classList.remove("dragover");
    if (name === "drop") setFile(e.dataTransfer.files[0]);
  });
$("convertButton").onclick = () => {
  const file = $("localFile").kenuxaFile;
  if (!file) {
    notify("Choose a local video or audio file first.");
    return;
  }
  const j = {
    id: crypto.randomUUID(),
    title: file.name,
    kind: "Local file",
    localFile: file,
    format: $("convertFormat").value,
    status: "queued",
    progress: 0,
    control: makeControl(),
  };
  state.queue.push(j);
  $("convertStatus").textContent =
    "Added to queue. You can track progress in Download queue.";
  metrics();
  runQueue();
};
window.addEventListener("beforeunload", (e) => {
  if (
    state.queue.some((j) =>
      ["downloading", "processing", "saving", "queued"].includes(j.status),
    )
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function init() {
  const key = new URL(location.href).searchParams.get("job");
  if (key) {
    const saved = await api.storage.session.get(key);
    state.source = saved[key] || {};
  }
  state.items = mergeCaptures(state.source.items || []).map((i) => ({
    ...i,
    title: i.title || state.source.title || "Detected media",
  }));
  state.history =
    (await api.storage.local.get("kenuxaHistory")).kenuxaHistory || [];
  state.videos = await listVideos().catch(() => []);
  renderHome();
  $("sourceTitle").textContent =
    state.source.title ||
    "No source page connected · use Add media URL or open Kenuxa from a video page";
  renderLibrary();
  renderQueue();
  renderHistory();
  showView(location.hash.slice(1) || "watch");
  if (state.source.sourceTabId !== undefined) await refreshSources();
}
init().catch((e) => notify(e.message, true));
