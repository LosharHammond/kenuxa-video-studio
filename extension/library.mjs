// Local video shelf: finished downloads are kept in the extension's own IndexedDB so Home can play them.
const DB = "kenuxa-library",
  META = "meta",
  BLOBS = "blobs";
let dbp;
function open() {
  return (
    dbp ||
    (dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(META, { keyPath: "id" });
        r.result.createObjectStore(BLOBS);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }))
  );
}
async function tx(stores, mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || Error("Storage was blocked."));
    out = run(t);
  });
}
const done = (req) =>
  new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

export async function probe(blob, isAudio) {
  // Reads duration and grabs a poster frame; both are best-effort.
  const url = URL.createObjectURL(blob),
    v = document.createElement(isAudio ? "audio" : "video");
  v.muted = true;
  v.preload = "metadata";
  v.src = url;
  const wait = (ev, ms) =>
    new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      v.addEventListener(
        ev,
        () => {
          clearTimeout(t);
          res(true);
        },
        { once: true },
      );
      v.addEventListener(
        "error",
        () => {
          clearTimeout(t);
          res(false);
        },
        { once: true },
      );
    });
  try {
    if (!(await wait("loadedmetadata", 8000)))
      return { duration: 0, thumb: null };
    const duration = isFinite(v.duration) ? v.duration : 0;
    if (isAudio) return { duration, thumb: null };
    v.currentTime = Math.min(1, duration / 2 || 0);
    await wait("seeked", 5000);
    const w = 480,
      h = Math.round(w * ((v.videoHeight || 9) / (v.videoWidth || 16))),
      c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    const thumb = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
    return { duration, thumb };
  } catch {
    return { duration: 0, thumb: null };
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}
export async function saveVideo(meta, blob) {
  await tx([META, BLOBS], "readwrite", (t) => {
    t.objectStore(META).put(meta);
    t.objectStore(BLOBS).put(blob, meta.id);
  });
}
export async function listVideos() {
  const rows = await tx([META], "readonly", (t) =>
    done(t.objectStore(META).getAll()),
  );
  return (rows || []).sort((a, b) => b.date.localeCompare(a.date));
}
export async function getBlob(id) {
  return tx([BLOBS], "readonly", (t) => done(t.objectStore(BLOBS).get(id)));
}
export async function removeVideo(id) {
  await tx([META, BLOBS], "readwrite", (t) => {
    t.objectStore(META).delete(id);
    t.objectStore(BLOBS).delete(id);
  });
}
export async function renameVideo(id, title) {
  const m = await tx([META], "readonly", (t) =>
    done(t.objectStore(META).get(id)),
  );
  if (!m) return;
  m.title = title;
  await tx([META], "readwrite", (t) => t.objectStore(META).put(m));
}
