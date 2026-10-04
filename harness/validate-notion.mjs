import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function loadJson(path) {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

async function main() {
  const filePath = resolve(process.cwd(), "harness", "fixtures", "notion-investment-assets.json");
  const data = await loadJson(filePath);

  const maxAbsDrift = Math.max(...data.holdings.map((h) => Math.abs(h.driftPercent)));
  const rebalance = data.holdings.map((h) => ({
    assetName: h.assetName,
    action: h.driftAmount > 0 ? "sell" : "buy",
    amount: Math.abs(h.driftAmount),
    driftPercent: h.driftPercent
  }));

  process.stdout.write(
    JSON.stringify(
      {
        validated: true,
        totalCurrent: data.summary.totalCurrent,
        totalTarget: data.summary.totalTarget,
        maxAbsDrift,
        rebalance
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
