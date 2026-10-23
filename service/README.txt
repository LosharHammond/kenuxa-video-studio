KENUXA WATCH METADATA SERVICE

Live project: aablfalovjqyxazuahdi / KENUXA WATCH / KENUXA Free organization.
Endpoint: https://aablfalovjqyxazuahdi.supabase.co/functions/v1/watch-feed
UI is in the browser extension. There is no separate hosted website.
No media files are stored or proxied.

index.mjs is a Supabase Edge Function. Gateway JWT verification is disabled
because it implements its own P-256 request signature validation; public GET
reads are anonymous. The public key hashes to the installation owner. Mutations
and own-listing reads require a matching private key, timestamp and unique nonce.
The privileged service credential comes from Supabase server runtime env only;
it never appears in extension files. Table and RPC privileges are revoked from
anon and authenticated clients, RLS is enabled and intentionally has no policies.
Only service_role can execute the internal transactional RPC.

schema.sql records the applied SQL. It is setup source, not an idempotent reset
script. Do not run it again on the existing project.
The API caps source text, sanitizes public URLs and builds embeds from an
allowlist. Global/owner listing caps are checked in a serialized transaction.

MODERATION
Open the project's Supabase Table Editor. Review watch_reports; find the
corresponding row in watch_listings and remove it if appropriate. Reports
cascade when a listing is removed. Clearing extension storage loses that
installation's removal key; an owner can remove its listing in the dashboard.

OPERATIONS
Keep the organization on Free. No paid subscription or video storage bucket
was configured. Usage quotas, inactivity pausing and abuse of free public
endpoints remain operational limits. Before a broad public launch, add stronger
anti-abuse controls and account recovery if those workflows are required.
