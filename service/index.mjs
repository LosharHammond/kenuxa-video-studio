import { watchSource } from "./watch-source.mjs";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,apikey",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const hex = async (text) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function safeItem(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.created_at,
    ...watchSource(row.source),
  };
}
export async function handle(req, env) {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  async function db(path, options = {}) {
    const r = await fetch(env.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: env.key,
        Authorization: "Bearer " + env.key,
        "content-type": "application/json",
        ...options.headers,
      },
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.message || "Database request failed");
    return value;
  }
  try {
    if (req.method === "GET") {
      const items = await db(
        "watch_listings?select=id,title,source,created_at&order=created_at.desc&limit=100",
      );
      return json({ items: items.map(safeItem) });
    }
    if (req.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (Number(req.headers.get("content-length")) > 6000)
      return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 6000) return json({ error: "Request too large" }, 413);
    const { payload, signature, publicKey } = JSON.parse(raw);
    if (
      !payload ||
      Math.abs(Date.now() - payload.time) > 300000 ||
      !Number.isFinite(payload.time) ||
      !/^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(
        payload.nonce || "",
      )
    )
      return json({ error: "Request expired. Try again." }, 401);
    if (
      publicKey?.kty !== "EC" ||
      publicKey.crv !== "P-256" ||
      !/^[\w-]{43}$/.test(publicKey.x || "") ||
      !/^[\w-]{43}$/.test(publicKey.y || "")
    )
      return json({ error: "Invalid browser identity" }, 401);
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: publicKey.x, y: publicKey.y },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(signature || ""), (c) => c.charCodeAt(0));
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        sig,
        new TextEncoder().encode(JSON.stringify(payload)),
      ))
    )
      return json({ error: "Browser signature did not match" }, 401);
    const owner = await hex(publicKey.x + "." + publicKey.y),
      action = payload.action;
    if (!["mine", "publish", "remove", "report"].includes(action))
      return json({ error: "Unknown action" }, 400);
    const args = { p_owner: owner, p_nonce: payload.nonce, p_action: action };
    if (action === "publish") {
      if (payload.consent !== true)
        return json(
          {
            error:
              "Confirm that this source listing will be visible to everyone.",
          },
          400,
        );
      args.p_title = String(payload.title || "")
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 120);
      if (!args.p_title) return json({ error: "Add a title" }, 400);
      args.p_source = watchSource(payload.source).source;
    }
    if (action === "remove" || action === "report") {
      if (!/^[\da-f-]{36}$/i.test(payload.id || ""))
        return json({ error: "Invalid listing" }, 400);
      args.p_id = payload.id;
    }
    if (action === "report") {
      args.p_reason = String(payload.reason || "")
        .trim()
        .slice(0, 280);
      if (!args.p_reason) return json({ error: "Add a report reason" }, 400);
    }
    const result = await db("rpc/watch_action", {
      method: "POST",
      body: JSON.stringify(args),
    });
    if (action === "mine") result.items = result.items.map(safeItem);
    return json(result);
  } catch (e) {
    return json({ error: e.message || "Request failed" }, 400);
  }
}
if (typeof Deno !== "undefined")
  Deno.serve((req) =>
    handle(req, {
      url: Deno.env.get("SUPABASE_URL"),
      key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    }),
  );
