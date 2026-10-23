export async function fetchInPage(url, expectedOrigin, options = {}) {
  if (location.origin !== expectedOrigin)
    return { error: "The source page changed. Detect this media again." };
  if (!/^https?:$/.test(new URL(url).protocol))
    return { error: "Unsupported URL scheme." };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 60000);
  try {
    const headers = {};
    if (options.range)
      headers.Range = `bytes=${options.range.start}-${options.range.end}`;
    const r = await fetch(url, {
      method: options.method || "GET",
      headers,
      credentials: "same-origin",
      signal: controller.signal,
    });
    const meta = {
      status: r.status,
      url: r.url,
      type: r.headers.get("content-type") || "",
      length: r.headers.get("content-length"),
      acceptRanges: r.headers.get("accept-ranges"),
      contentRange: r.headers.get("content-range"),
    };
    if (options.method === "HEAD") return { ...meta, base64: "" };
    const max = 32 * 1024 * 1024;
    if (Number(meta.length) > max) {
      await r.body?.cancel();
      return {
        error:
          "This response exceeds 32 MB. Choose an HLS/DASH stream or a server with byte-range support.",
      };
    }
    const reader = r.body?.getReader(),
      chunks = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > max) {
            await reader.cancel();
            throw Error("Response exceeds the 32 MB transfer limit.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return { ...meta, base64: btoa(binary) };
  } catch (e) {
    return {
      error:
        e.name === "AbortError" ? "The video request timed out." : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
export function requester(api, source, control) {
  return async (url, options = {}) => {
    await control.checkpoint();
    let response;
    if (source?.sourceTabId !== undefined && source.sourceOrigin) {
      const result = await api.scripting.executeScript({
        target: { tabId: source.sourceTabId, frameIds: [source.frameId || 0] },
        world: "ISOLATED",
        func: fetchInPage,
        args: [url, source.sourceOrigin, options],
      });
      const data = result[0]?.result;
      if (!data || data.error)
        throw Error(
          data?.error ||
            "The source tab is unavailable. Keep it open, then detect the video again.",
        );
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const headers = new Headers({ "content-type": data.type });
      for (const [key, value] of Object.entries({
        "content-length": data.length,
        "accept-ranges": data.acceptRanges,
        "content-range": data.contentRange,
      }))
        if (value) headers.set(key, value);
      const r = new Response(options.method === "HEAD" ? null : bytes, {
        status: data.status,
        headers,
      });
      response = {
        ok: r.ok,
        status: r.status,
        url: data.url,
        headers: r.headers,
        text: () => r.text(),
        arrayBuffer: () => r.arrayBuffer(),
        blob: () => r.blob(),
      };
    } else
      response = await fetch(url, {
        method: options.method || "GET",
        headers: options.range
          ? { Range: `bytes=${options.range.start}-${options.range.end}` }
          : {},
        credentials: "omit",
      });
    if (!response.ok) {
      const text = (await response.text())
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      let message = `HTTP ${response.status}: ${text || "The media provider refused the request."}`;
      if (/origin not allowed/i.test(text))
        message =
          "The provider rejected this request origin. Refresh the source page and launch Kenuxa from that tab.";
      if (response.status === 451 && !/origin not allowed/i.test(text))
        message =
          "HTTP 451: the provider reports a restriction. Kenuxa cannot override it. " +
          text;
      const e = Error(message);
      e.noRetry = [400, 401, 403, 404, 410, 451].includes(response.status);
      throw e;
    }
    if (options.range) {
      const expected = `bytes ${options.range.start}-${options.range.end}/`;
      if (
        response.status !== 206 ||
        !response.headers.get("content-range")?.startsWith(expected)
      )
        throw Object.assign(
          Error(
            "The server did not honor the requested byte range. Stopped to avoid corrupting the file.",
          ),
          { noRetry: true },
        );
    }
    await control.checkpoint();
    return response;
  };
}
