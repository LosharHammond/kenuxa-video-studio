import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
for (const browser of ["chromium", "edge", "opera", "firefox"]) {
  const dest = "dist/" + browser;
  await rm(dest, { recursive: true, force: true });
  await cp("extension", dest, { recursive: true });
  for (const asset of ["icon256.png", "icon512.png", "kenuxa.svg"]) await rm(dest + "/icons/" + asset, { force: true });
  await mkdir(dest + "/vendor/ffmpeg", { recursive: true });
  await mkdir(dest + "/vendor/core", { recursive: true });
  for (const name of ["ffmpeg.js", "814.ffmpeg.js"])
    await cp(
      "node_modules/@ffmpeg/ffmpeg/dist/umd/" + name,
      dest + "/vendor/ffmpeg/" + name,
    );
  for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
    await cp(
      "node_modules/@ffmpeg/core/dist/umd/" + name,
      dest + "/vendor/core/" + name,
    );
  const manifest = JSON.parse(await readFile(dest + "/manifest.json", "utf8"));
  if (browser === "firefox") {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ["background.js"], type: "module" };
    manifest.browser_specific_settings = {
      gecko: {
        id: "kenuxa-video-studio@kenuxa.local",
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
          optional: ["websiteContent", "browsingActivity"],
        },
      },
    };
  }
  await writeFile(
    dest + "/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log("Built " + dest);
}


