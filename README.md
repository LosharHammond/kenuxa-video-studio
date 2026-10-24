# Kenuxa Video Studio

A browser workspace for supported media downloads, local file conversion and optional source-link sharing through Kenuxa Watch.

**Status:** 2.5 release candidate. This upgrade improves focus, deduplication and preservation of source quality. The earlier 2.4 packages were submitted to Opera and Firefox; this 2.5 build is a new review candidate. This repository is not proof of an approved store listing.

See [the focused capture and quality upgrade](docs/quality-upgrade-2.5.md) for the new download flow and its verification.

## What it does

- Detects direct media, complete unencrypted HLS and common static DASH sources while you browse.
- Offers quality selection, a download queue, pause/retry and completion tracking.
- Bundles FFmpeg WebAssembly for local MP4 remux, H.264/AAC conversion and MP3 export.
- Shows Kenuxa Watch inside the extension. Everyone is a shared feed; Saved privately stays in your browser.
- Requires explicit consent before sharing a title and original public webpage link. Downloaded files and captured streaming tokens are not uploaded.

Supported player embeds: YouTube, public Vimeo and Dailymotion. Other sources open at their original websites. Providers control whether an embed plays. DRM, encrypted/live manifests, paywall bypass and universal website extraction are not supported. Input jobs are capped at 256 MB; page-origin transfers are capped at 32 MB each.

## Build

Use Node.js 24 and npm. From the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

The build copies the readable extension sources and the exact pinned upstream FFmpeg distributions. It does not minify first-party code. No binaries are downloaded at extension runtime. Generated packages appear in dist/chromium, dist/edge, dist/opera and dist/firefox. ZIP each folder's contents with manifest.json at the ZIP root to submit. Do not upload this source repository ZIP as an installable extension.

For local Chromium testing, load the built folder on the browser's extensions developer page. Firefox development installation uses about:debugging; permanent installation requires Mozilla signing. Firefox and Opera runtime validation must be completed before claiming support verified on those browsers.

## Privacy and operation

[Privacy policy](https://losharhammond.github.io/kenuxa-video-studio/privacy.html) · [Permission explanations](docs/permissions.md) · [Reviewer notes](docs/reviewer-notes.md)

Watch's source is in service/. The deployed Supabase project uses a metadata database and an Edge Function, with no video storage bucket. The server runtime provides its own credential; no server credential belongs in this repository or an extension package. Publishing ownership uses an installation signing key. Clearing extension data loses management access to previous shares; this release has no cross-device account recovery.

## Support

Use [GitHub Issues](https://github.com/LosharHammond/kenuxa-video-studio/issues) or losharhammond@gmail.com. Do not post private media URLs, access tokens or personal files in an issue.

## Third-party software

FFmpeg wrapper 0.12.15 (MIT) and core 0.12.10 (GPL-2.0-or-later) are unmodified official npm distributions. See extension/THIRD-PARTY.txt and extension/vendor/ for notices. The extension source is published for inspection; third-party licenses apply to their respective components. No additional license for Kenuxa branding is granted.
