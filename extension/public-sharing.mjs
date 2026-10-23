export function publicPage(value) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use a public website URL.");
  if (
    /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/i.test(
      u.hostname,
    )
  )
    throw Error("Local and private-network pages cannot be shared publicly.");
  const host = u.hostname.replace(/^www\./, ""),
    parts = u.pathname.split("/").filter(Boolean);
  if (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com"
  ) {
    const id =
      host === "youtu.be"
        ? parts[0]
        : u.searchParams.get("v") ||
          (["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null);
    if (/^[\w-]{11}$/.test(id || ""))
      return "https://www.youtube.com/watch?v=" + id;
  }
  if (
    /(^|\.)vimeo\.com$/.test(host) &&
    (u.searchParams.has("h") || (host === "vimeo.com" && parts.length > 1))
  )
    throw Error("Use a public Vimeo link without a private access hash.");
  if (/\.(m3u8|mpd|mp4|ts|m4s|webm)(?:$|\/)/i.test(u.pathname))
    throw Error(
      "Share the public video webpage rather than its media-stream URL.",
    );
  u.search = "";
  u.hash = "";
  return u.href;
}
