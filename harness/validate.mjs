import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function loadJson(path) {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

function computeAllocationPercentages(holdings) {
  const total = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const map = new Map();

  for (const item of holdings) {
    const current = map.get(item.assetClass) ?? 0;
    map.set(item.assetClass, current + item.marketValue);
  }

  const result = {};
  for (const [assetClass, value] of map.entries()) {
    result[assetClass] = Number(((value / total) * 100).toFixed(2));
  }
  return result;
}

async function main() {
  const root = resolve(process.cwd(), "harness");
  const scenario = await loadJson(resolve(root, "scenarios", "allocation-baseline.json"));
  const fixture = await loadJson(resolve(root, "fixtures", scenario.inputFixture));

  const actual = computeAllocationPercentages(fixture.holdings);
  const target = Object.fromEntries(
    scenario.target.map((item) => [item.assetClass, item.targetPercent])
  );

  const drifts = Object.entries(target).map(([assetClass, targetPercent]) => {
    const actualPercent = actual[assetClass] ?? 0;
    return {
      assetClass,
      targetPercent,
      actualPercent,
      drift: Number((actualPercent - targetPercent).toFixed(2))
    };
  });

  const maxDrift = Math.max(...drifts.map((d) => Math.abs(d.drift)));
  const passed = maxDrift <= scenario.expectations.maxDriftPercent;

  process.stdout.write(JSON.stringify({ scenario: scenario.name, passed, drifts }, null, 2) + "\n");

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
