# Permission explanations

Single purpose: help users manage supported browser media, from discovery and download to local conversion and optional source bookmarking/sharing in the same workspace.

| Permission | Why it is used |
| --- | --- |
| webRequest | Read media response URLs and headers to detect supported source formats locally. No request bodies, form data or cookie headers are collected. |
| HTTP/HTTPS host access | Sources and their CDN segments can use different domains. Access supports a media-only content script for local player state/dimensions/source URLs, media detection and user-requested retrieval across source websites. No hidden browsing-data upload is performed. |
| activeTab | Connect the page where the user opens the extension; read that page's title/URL and allow an explicit source scan. |
| scripting | Inspect video/audio source elements and execute a scoped fetch in the original source frame, with its real origin and normal CORS behavior. No origin/header forgery. |
| downloads | Show the save prompt, track confirmed completion, cancel a job and reveal the saved file. |
| storage | Keep bounded session detections and player observations, local history/private bookmarks, and the installation signing identity. No storage.sync identity transmission. |
| wasm-unsafe-eval in CSP | Compile the bundled local FFmpeg WebAssembly engine. No remotely supplied JavaScript is evaluated. |
| Firefox optional websiteContent/browsingActivity collection | Explicit publication of the chosen title and original webpage URL. Requested on a user gesture; declining prevents sharing. |

No tabs, cookies, history, debugger, nativeMessaging, management or unlimitedStorage permission is requested. Source detection is described in the listing and privacy policy.
