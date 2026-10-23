import { publicPage } from "./public-sharing.mjs";
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
