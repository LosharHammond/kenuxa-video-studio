# Kenuxa Video Studio 2.5 — focused capture and source quality

Play the video on its website, reload the extension, refresh the source webpage, then open Kenuxa Video Studio. Existing tabs need a refresh for the new media-only player observer.

- The running player is prioritized using its actual source URL, frame, playback state, dimensions and visible area. A direct match is labelled Playing video. Blob/MSE correlation is labelled Likely playing video; the user can reveal all sources and choose manually.
- Repeated signed requests keep one card with the latest usable URL. Semantic content IDs and different frames stay distinct. Parsed HLS master playlists own their video and audio renditions. Refresh replaces the detection list instead of appending indefinitely.
- Available HLS/DASH resolutions are read from the provider. Best selects the highest offered source. An explicit resolution that disappears fails clearly; no lower rendition is substituted. A single-rendition URL cannot reveal a higher source that the website did not expose.
- Original is the download default. Direct files keep their exact bytes. Adaptive tracks are copied; separate tracks use MKV, and MP4 copy remuxes without re-encoding. MP4 re-encode is an explicit high-quality option using CRF 18 and 256 kbps AAC. It can still change detail. No automatic upscaling or resolution claims are added.
- Duplicate unfinished jobs are prevented. Empty media, truncated byte ranges, HTML masquerading as media, known file-size mismatches, provider failures and memory-limit failures stop before a successful save.

Validation: automated capture/session, ranking, deduplication, quality-selection, storage, controls, packaging and conversion checks pass. A real moving H.264/AAC fixture was fetched as HLS and remuxed using the bundled WebAssembly engine: 24 decoded frames and the AAC stream match the source exactly. The browser harness produced the exact same MP4 SHA-256 as that verified output. Real HTML video playback correctly prioritized the playing 360p player over the paused 180p player. These are generated fixtures, not universal website or native Edge/Opera/Firefox certification.

Current browser-memory bound remains 256 MB per processed job. DRM/encrypted/live streams, signature deciphering and paywall bypass remain unsupported. Third-party player/provider restrictions still apply. This is a tested release candidate; no all-website or commercial certification is claimed.

Support: losharhammond@gmail.com
