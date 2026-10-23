export const WATCH_API =
  "https://aablfalovjqyxazuahdi.supabase.co/functions/v1/watch-feed";
export function community(api) {
  let pending;
  async function identity() {
    if (pending) return pending;
    const create = async () => {
      const saved = (await api.storage.local.get("kenuxaWatchIdentity"))
        .kenuxaWatchIdentity;
      if (saved) return saved;
      const pair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"],
        ),
        value = {
          privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
          publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
        };
      await api.storage.local.set({ kenuxaWatchIdentity: value });
      return value;
    };
    pending =
      typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("kenuxa-watch-identity", create)
        : create();
    try {
      return await pending;
    } catch (e) {
      pending = null;
      throw e;
    }
  }
  async function request(action, data = {}) {
    const options = {};
    if (action) {
      const id = await identity(),
        payload = {
          ...data,
          action,
          time: Date.now(),
          nonce: crypto.randomUUID(),
        },
        key = await crypto.subtle.importKey(
          "jwk",
          id.privateKey,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        ),
        signature = btoa(
          String.fromCharCode(
            ...new Uint8Array(
              await crypto.subtle.sign(
                { name: "ECDSA", hash: "SHA-256" },
                key,
                new TextEncoder().encode(JSON.stringify(payload)),
              ),
            ),
          ),
        );
      options.method = "POST";
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify({
        payload,
        signature,
        publicKey: id.publicKey,
      });
    }
    const response = await fetch(WATCH_API, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("Watch is unavailable. Please try again later.");
    }
    if (!response.ok) throw Error(result.error || "Watch request failed");
    return result;
  }
  return {
    list: () => request(),
    mine: () => request("mine"),
    publish: (data) => request("publish", data),
    remove: (id) => request("remove", { id }),
    report: (id, reason) => request("report", { id, reason }),
  };
}
