# Dependency provenance

Official, unmodified npm releases, pinned in package-lock.json.

- Wrapper 0.12.15 source release commit: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/f78aed147c4185484da8eba1d97c51354a5e3352/packages/ffmpeg
- Core 0.12.10 release source and build system: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1
- Core build scripts and dependency source versions: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build
- Core GPL notice: extension/vendor/GPL-2.0.txt. Its complete upstream source can be obtained at https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz and the third-party source URLs/version selectors in its build scripts.

## SHA-256 of bundled distributions

- vendor/ffmpeg/ffmpeg.js: ad4cfe957589995dea03fc8de1fd5e9f5cb4558a7282913172203082a65bbfaa
- vendor/ffmpeg/814.ffmpeg.js: 976f4174ae7da80c0d4f9523ee6dde3ecbce7dc2ee392b2a5322049abb9b8627
- vendor/core/ffmpeg-core.js: b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21
- vendor/core/ffmpeg-core.wasm: 9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7

## Validator warning

web-ext 10.8.0 reports no errors and one DANGEROUS_EVAL warning in the unmodified upstream UMD wrapper vendor/ffmpeg/ffmpeg.js. Its universal-module bootstrap includes a Function constructor fallback for obtaining the global object. Modern extension environments provide globalThis, so that fallback is not needed. The extension CSP does not permit unsafe-eval. The library bytes were retained exactly as the published upstream distribution for reviewer checksum comparison. This warning is disclosed, not suppressed. Store reviewers may request a different wrapper build.
