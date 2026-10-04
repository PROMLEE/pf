import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type SyncConnection = {
  provider: string;
  connectedAt: string;
  config: Record<string, unknown>;
};

const connections = new Map<string, SyncConnection>();

export function connectProvider(
  userId: string,
  provider: string,
  config: Record<string, unknown> = {}
) {
  const key = `${userId}:${provider}`;
  connections.set(key, {
    provider,
    connectedAt: new Date().toISOString(),
    config
  });
  return connections.get(key);
}

export function getConnection(userId: string, provider: string) {
  return connections.get(`${userId}:${provider}`) ?? null;
}

export async function syncHoldingsFromNotion() {
  const fixturePath = resolve(process.cwd(), "harness", "fixtures", "notion-investment-assets.json");
  const content = await readFile(fixturePath, "utf-8");
  const parsed = JSON.parse(content);

  return {
    syncedAt: new Date().toISOString(),
    source: "notion",
    summary: parsed.summary,
    holdings: parsed.holdings
  };
}
