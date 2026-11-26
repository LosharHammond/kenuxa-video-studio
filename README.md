# Kenuxa Video Studio

A browser workspace for supported media downloads, local file conversion and optional source-link sharing through Kenuxa Watch.

**Status:** 2.6 release candidate. Adds series episode selection and sequential batch downloads on top of the 2.5 capture and quality improvements. This repository is not proof of an approved store listing.

See [the focused capture and quality upgrade](docs/quality-upgrade-2.5.md) for the new download flow and its verification.

## What it does

- Detects direct media, complete unencrypted HLS and common static DASH sources while you browse.
- Offers quality selection, a download queue, pause/retry and completion tracking.
- Finds episode links on series pages and queues selected episodes in numerical order, resolving a fresh media source for each episode.
- Bundles FFmpeg WebAssembly for local MP4 remux, H.264/AAC conversion and MP3 export.
- Shows Kenuxa Watch inside the extension. Everyone is a shared feed; Saved privately stays in your browser.
- Requires explicit consent before sharing a title and original public webpage link. Downloaded files and captured streaming tokens are not uploaded.

Supported player embeds: YouTube, public Vimeo and Dailymotion. Other sources open at their original websites. Providers control whether an embed plays. DRM, encrypted/live manifests, paywall bypass and universal website extraction are not supported. Input jobs are capped at 256 MB; page-origin transfers are capped at 32 MB each.

## Download a series

1. Open the series or an episode page, then open Video Studio from the extension.
2. In Media library, choose **Find episodes**. Expand the website's episode list first if needed.
3. Keep all episodes selected or select the ones you want. Choose Original quality or MP4, then **Queue selected episodes**.
4. Choose private downloads or opt into public source-link sharing once for the selection. Keep Studio open until the batch finishes.

Each episode opens in a temporary background tab. Kenuxa starts the player muted, detects its supported media and pauses playback to avoid automatic episode navigation during the download. That tab stays open until saving finishes, then closes before the next episode starts. Failed episodes remain in the queue for retry; the rest continue. Retrying resolves a fresh media URL.

Files use numbered names such as `Series title/Series title - Episode 001.mp4` in the browser's Downloads location. Batch jobs do not request a Save As dialog for each file, but browser download settings and permission prompts still apply. Original streams may save in a different container; choose MP4 for MP4 stream-copy packaging.

Discovery supports same-site `/series/name/episode-1` links, including DramaTip, and `/episode/1` or `/episode-1` links inside explicit episode-list containers. It does not infer hidden or locked episodes. If a site blocks background playback, open the temporary episode tab and press Play. A missing or ambiguous player becomes a failed job after the discovery window. The usual DRM, encryption, size and transfer limits still apply. The queue is held in the open Studio session; closing Studio ends it.

Validation includes a 30-episode link fixture captured from the supplied DramaTip page, selection and source-matching tests, cancellation/timeout cleanup, and a Studio integration test using mocked browser APIs that verifies sequential saving and continuation after a failure. Full-series downloading in an installed browser extension remains a manual check.

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
