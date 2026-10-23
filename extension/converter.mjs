let ffmpeg;
const root = () =>
  typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("")
    : new URL("./", import.meta.url).href;
export function stopConversion() {
  ffmpeg?.terminate();
  ffmpeg = undefined;
}
export async function convert(tracks, format, onStatus = () => {}) {
  const primary = tracks.find((t) => t.kind === "video") || tracks[0];
  if (format === "original" && tracks.length === 1)
    return { blob: primary.blob, extension: primary.extension };
  onStatus("Loading the local media engine…");
  if (!ffmpeg) {
    ffmpeg = new FFmpegWASM.FFmpeg();
    try {
      await ffmpeg.load({
        coreURL: root() + "vendor/core/ffmpeg-core.js",
        wasmURL: root() + "vendor/core/ffmpeg-core.wasm",
      });
    } catch (e) {
      stopConversion();
      throw e;
    }
  }
  const inputs = [];
  const session = crypto.randomUUID().replaceAll("-", "");
  const args = ["-hide_banner", "-fflags", "+genpts"];
  for (let i = 0; i < tracks.length; i++) {
    const name = session + "-" + i + "." + tracks[i].extension;
    inputs.push(name);
    await ffmpeg.writeFile(
      name,
      new Uint8Array(await tracks[i].blob.arrayBuffer()),
    );
    args.push("-i", name);
  }
  const video = tracks.findIndex((t) => t.kind === "video"),
    audio = tracks.findIndex((t) => t.kind === "audio");
  if (format === "mp3") {
    args.push(
      "-map",
      audio >= 0 ? audio + ":a:0" : "0:a:0",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
    );
  } else {
    if (video >= 0) args.push("-map", video + ":v:0?");
    args.push("-map", audio >= 0 ? audio + ":a:0?" : "0:a:0?");
    if (format === "compatible")
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
      );
    else args.push("-c", "copy");
    if (format !== "original") args.push("-movflags", "+faststart");
  }
  const extension =
    format === "mp3"
      ? "mp3"
      : format === "original"
        ? "mkv"
        : video < 0
          ? "m4a"
          : "mp4";
  const output = session + "-output." + extension;
  args.push(output);
  let lastLog = "";
  const log = ({ message }) => {
    lastLog = message;
  };
  ffmpeg.on("log", log);
  const progress = ({ progress }) =>
    onStatus(
      "Processing locally" +
        (progress > 0 && progress <= 1
          ? " · " + Math.round(progress * 100) + "%"
          : "") +
        "…",
    );
  ffmpeg.on("progress", progress);
  try {
    onStatus(
      format === "mp3"
        ? "Exporting audio…"
        : format === "compatible"
          ? "Encoding compatible MP4. This can take a while…"
          : "Packaging video as " + extension.toUpperCase() + "…",
    );
    const code = await ffmpeg.exec(args);
    if (code !== 0)
      throw Error(
        "The media engine could not process this codec. Try Original or Compatible MP4. " +
          lastLog.slice(0, 180),
      );
    const bytes = await ffmpeg.readFile(output);
    return {
      blob: new Blob([bytes], {
        type: {
          mp4: "video/mp4",
          m4a: "audio/mp4",
          mp3: "audio/mpeg",
          mkv: "video/x-matroska",
        }[extension],
      }),
      extension,
    };
  } finally {
    if (ffmpeg) {
      ffmpeg.off("log", log);
      ffmpeg.off("progress", progress);
      for (const path of [...inputs, output])
        try {
          await ffmpeg.deleteFile(path);
        } catch {}
    }
  }
}
