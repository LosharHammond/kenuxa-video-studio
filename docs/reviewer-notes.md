# Reviewer notes — 2.4.0

All first-party JavaScript, CSS and HTML are readable source in extension/. No runtime remote code, eval-based remote logic or downloaded WASM exists. The only remote Kenuxa endpoint returns JSON source-listing metadata. It is not an executable-code service.

## Reproduce

Node 24; npm ci --ignore-scripts; npm test; npm run build. Build outputs are dist/chromium, edge, opera and firefox. The lockfile pins dependencies and their registry integrity. First-party files are copied without transpilation/minification. Browser manifests differ only in the browser-specific background/minimum-version/data-collection settings.

Third-party libraries are copied unchanged from official published npm releases:
- @ffmpeg/ffmpeg 0.12.15, MIT: https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15
- @ffmpeg/core 0.12.10, GPL-2.0-or-later: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Published core archive: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- Upstream source/build system: https://github.com/ffmpegwasm/ffmpeg.wasm

No changes are made to upstream library bytes. See dependency provenance and checksum records for the matching released source commit, plus extension/THIRD-PARTY.txt. The upstream engine uses FFmpeg 5.1.4 and its included codec libraries; core build instructions are maintained upstream. Our extension build consumes that official release; it does not compile its own altered FFmpeg.

## Test without a login

Open the converter and select a small video you own. MP4 fast preserves compatible codecs; compatible MP4 encodes H.264/AAC; MP3 requires an audio track. Keep the tab open until the save prompt completes. To test web downloads, open a public media sample you own, play it, open the extension, and inspect its detected source. Custom providers may impose CORS or access limits.

Watch Everyone is readable without an account. Public sources require explicit user consent. Each installation generates a signing key; public writes are signed and replay-checked. The backend's privileged credential is not shipped. Owner removal is installation-bound; the user-facing privacy text explains storage clearing and removal support.

The Watch service stores only source metadata and reports. It never stores/proxies downloaded files. Private downloads do not submit listings. Raw CDN manifests and signed media URLs are rejected as public source entries. Supported player hosts are allowlisted; other links have a source-only fallback.

No advertising, affiliates, external payment system or subscription.

See [dependency provenance](dependency-provenance.md) for release source commits, binary hashes and the one unmodified-upstream validator warning.
