// Run from apps/web. Existing credentials stay local; generated keys never print.
import pg from "pg";
import webpush from "web-push";
import { randomBytes } from "node:crypto";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await client.connect();
try {
  await client.query("begin");
  await client.query(
    "select pg_advisory_xact_lock(hashtext('portrhythm-push-key-setup'))",
  );
  const existing = await client.query(
    "select name from vault.secrets where name in ('portrhythm_push_public','portrhythm_push_private','portrhythm_push_cron')",
  );
  const names = new Set(existing.rows.map((r) => r.name));
  if (
    names.has("portrhythm_push_public") !== names.has("portrhythm_push_private")
  )
    throw new Error("Incomplete VAPID key pair: manual repair required");
  if (!names.has("portrhythm_push_public")) {
    const keys = webpush.generateVAPIDKeys();
    for (const [name, value] of [
      ["portrhythm_push_public", keys.publicKey],
      ["portrhythm_push_private", keys.privateKey],
    ])
      await client.query("select vault.create_secret($1,$2,$3)", [
        value,
        name,
        "PortRhythm web push",
      ]);
  }
  if (!names.has("portrhythm_push_cron"))
    await client.query("select vault.create_secret($1,$2,$3)", [
      randomBytes(32).toString("base64url"),
      "portrhythm_push_cron",
      "PortRhythm push scheduler authentication",
    ]);
  await client.query("commit");
  console.log(
    "PortRhythm push keys are configured in Vault. Existing keys were preserved.",
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
