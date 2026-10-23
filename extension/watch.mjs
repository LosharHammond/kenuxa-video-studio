import { publicPage } from "./public-sharing.mjs";
import { community } from "./watch-community.mjs";
export function watchSource(value) {
  const source = publicPage(value),
    u = new URL(source),
    host = u.hostname.replace(/^www\./, ""),
    parts = u.pathname.split("/").filter(Boolean);
  if (
    host === "youtube.com" &&
    /^[\w-]{11}$/.test(u.searchParams.get("v") || "")
  )
    return {
      source,
      provider: "YouTube",
      embed:
        "https://www.youtube-nocookie.com/embed/" + u.searchParams.get("v"),
    };
  if (
    host === "vimeo.com" &&
    /^\d{1,15}$/.test(parts[0] || "") &&
    parts.length === 1
  )
    return {
      source,
      provider: "Vimeo",
      embed: "https://player.vimeo.com/video/" + parts[0],
    };
  if (["dai.ly", "dailymotion.com"].includes(host)) {
    const id = (
      host === "dai.ly" ? parts[0] : parts[0] === "video" ? parts[1] : ""
    )?.split("_")[0];
    if (/^[a-zA-Z0-9]{5,20}$/.test(id || ""))
      return {
        source,
        provider: "Dailymotion",
        embed: "https://www.dailymotion.com/embed/video/" + id,
      };
  }
  return { source, provider: "Source link", embed: null };
}
export function watchStore(api) {
  const key = "kenuxaWatchSources";
  let pending = Promise.resolve();
  const serial = (action) => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  async function list() {
    const data = (await api.storage.local.get(key))[key];
    return (Array.isArray(data) ? data : []).flatMap((row) => {
      try {
        return [
          {
            id: String(row.id),
            title: String(row.title).slice(0, 120),
            date: row.date,
            ...watchSource(row.source),
          },
        ];
      } catch {
        return [];
      }
    });
  }
  return {
    list,
    add: ({ title, source }) =>
      serial(async () => {
        const details = watchSource(source),
          rows = await list(),
          old = rows.find((r) => r.source === details.source);
        if (old) return old;
        if (rows.length >= 500)
          throw Error(
            "Watch holds up to 500 source links. Remove an older link first.",
          );
        const item = {
          id: crypto.randomUUID(),
          title: String(title || new URL(details.source).hostname)
            .trim()
            .slice(0, 120),
          date: new Date().toISOString(),
          ...details,
        };
        await api.storage.local.set({ [key]: [item, ...rows] });
        return item;
      }),
    remove: (id) =>
      serial(async () => {
        await api.storage.local.set({
          [key]: (await list()).filter((r) => r.id !== id),
        });
      }),
  };
}
export function initWatch(api, notify) {
  const $ = (id) => document.getElementById(id),
    store = watchStore(api),
    shared = community(api);
  let rows = [],
    mode = "community",
    own = new Set();
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls || "";
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function close() {
    $("watchPlayerHost").replaceChildren();
    $("watchPlayerDialog").close();
  }
  function play(item) {
    $("watchPlayerHost").replaceChildren();
    $("watchPlayerTitle").textContent = item.title;
    $("watchOriginal").href = item.source;
    if (item.embed) {
      const frame = node("iframe");
      frame.src = item.embed;
      frame.title = item.title;
      frame.allow = "fullscreen; picture-in-picture";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      $("watchPlayerHost").append(frame);
    } else {
      const panel = node("div", "empty");
      panel.append(
        node("span", "empty-symbol", "↗"),
        node("h3", "", "Watch this video on its source website"),
        node(
          "p",
          "",
          "This website does not have a supported embedded player. Use Open original below.",
        ),
      );
      $("watchPlayerHost").append(panel);
    }
    $("watchPlayerDialog").showModal();
  }
  function render() {
    const grid = $("watchGrid"),
      q = $("watchSearch").value.toLowerCase();
    grid.replaceChildren();
    $("watchTotal").textContent = rows.length;
    const visible = rows.filter((r) =>
      (r.title + " " + r.provider + " " + r.source).toLowerCase().includes(q),
    );
    if (!visible.length) {
      const panel = node("div", "empty");
      panel.append(
        node("span", "empty-symbol", "▶"),
        node(
          "h3",
          "",
          rows.length
            ? "No matching discoveries"
            : "Your next discovery belongs here.",
        ),
        node(
          "p",
          "",
          mode === "community"
            ? "Sources shared by everyone appear here. Be the first to share a discovery."
            : "Save a video webpage or choose Share with everyone. No video files are uploaded.",
        ),
      );
      grid.append(panel);
    }
    for (const item of visible) {
      const card = node("article", "watch-card"),
        preview = node("button", "watch-preview");
      preview.setAttribute("aria-label", "Watch " + item.title);
      preview.append(
        node("span", "watch-play", "▶"),
        node("span", "watch-provider", item.provider),
      );
      preview.onclick = () => play(item);
      const body = node("div", "watch-body"),
        title = node("button", "watch-title", item.title);
      title.onclick = () => play(item);
      const bottom = node("div", "watch-bottom");
      bottom.append(node("small", "", new URL(item.source).hostname));
      if (mode === "saved" || mode === "mine" || own.has(item.id)) {
        const remove = node("button", "ghost", "Remove");
        remove.onclick = async () => {
          try {
            if (mode === "saved") await store.remove(item.id);
            else {
              if (!confirm("Remove this listing from everyone’s Watch feed?"))
                return;
              await shared.remove(item.id);
            }
            await refresh();
          } catch (e) {
            notify(e.message, true);
          }
        };
        bottom.append(remove);
      }
      if (mode === "community") {
        const report = node("button", "ghost", "Report");
        report.onclick = async () => {
          const reason = prompt("Why should this source be reviewed?");
          if (!reason?.trim()) return;
          try {
            await shared.report(item.id, reason);
            notify("Report sent for review.");
          } catch (e) {
            notify(e.message, true);
          }
        };
        bottom.append(report);
      }
      body.append(title, bottom);
      card.append(preview, body);
      grid.append(card);
    }
  }
  async function refresh() {
    try {
      $("watchStatus").textContent = "Loading…";
      const data =
        mode === "saved"
          ? { items: await store.list() }
          : mode === "mine"
            ? await shared.mine()
            : await shared.list();
      rows = data.items.map((r) => ({ ...r, ...watchSource(r.source) }));
      if (mode === "mine") own = new Set(rows.map((r) => r.id));
      render();
      $("watchStatus").textContent =
        mode === "community"
          ? "Public feed · Original sources · No video uploads"
          : mode === "mine"
            ? "Shared by this browser · Remove a listing to withdraw it"
            : "Private source links · Saved in this browser";
    } catch (e) {
      rows = [];
      render();
      $("watchStatus").textContent = "Could not load Watch: " + e.message;
    }
  }
  document.querySelectorAll("[data-watch-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        mode = b.dataset.watchMode;
        document
          .querySelectorAll("[data-watch-mode]")
          .forEach((n) => n.classList.toggle("active", n === b));
        refresh();
      }),
  );
  $("watchRefresh").onclick = refresh;
  $("watchSearch").oninput = render;
  $("watchAdd").onclick = () => {
    $("watchConsent").checked = false;
    $("watchAddError").textContent = "";
    $("watchAddDialog").showModal();
  };
  $("watchCloseAdd").onclick = () => $("watchAddDialog").close();
  $("watchClosePlayer").onclick = close;
  $("watchPlayerDialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  $("watchForm").onsubmit = async (e) => {
    e.preventDefault();
    const publish = e.submitter?.id === "watchPublish";
    try {
      const input = {
        title: $("watchName").value,
        source: $("watchUrl").value.trim(),
      };
      if (publish) {
        if (!$("watchConsent").checked)
          throw Error("Confirm public sharing before publishing.");
        await allowSharing();
        await shared.publish({ ...input, consent: true });
      } else await store.add(input);
      await refresh();
      $("watchAddDialog").close();
      $("watchForm").reset();
      notify(
        publish
          ? "Your source listing is now visible to everyone on Kenuxa Watch."
          : "Saved privately in this browser.",
      );
    } catch (e) {
      $("watchAddError").textContent = e.message;
    }
  };
  api.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.kenuxaWatchSources)
      refresh().catch((e) => notify(e.message, true));
  });
  return {
    refresh,
    add: async (input) => {
      await shared.publish({ ...input, consent: true });
      await refresh();
    },
  };
}
export async function allowSharing() {
  if (typeof browser !== "undefined" && browser.permissions?.request) {
    const allowed = await browser.permissions.request({
      data_collection: ["websiteContent", "browsingActivity"],
    });
    if (!allowed)
      throw Error("Sharing permission was not granted. Nothing was published.");
  }
}
