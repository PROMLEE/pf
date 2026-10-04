import { Pool } from "pg";

declare global {
  var portfolioPool: Pool | undefined;
}

export function db(): Pool {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
  if (!globalThis.portfolioPool) {
    globalThis.portfolioPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
  }
  return globalThis.portfolioPool;
}
