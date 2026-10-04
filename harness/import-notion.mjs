import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--csv" || token === "-c") {
      result.csv = argv[i + 1];
      i += 1;
    }
    if (token === "--out" || token === "-o") {
      result.out = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function normalizeMoney(value) {
  if (!value) return 0;
  return Number(value.replace(/[₩,\s]/g, "")) || 0;
}

function normalizePercent(value) {
  if (!value) return 0;
  return Number(value.replace(/[%,\s]/g, "")) || 0;
}

function mapHolding(row) {
  return {
    assetName: row["자산 형태"]?.trim() ?? "",
    account: row["계좌"]?.trim() ?? "",
    targetPercent: normalizePercent(row["목표 비중"]),
    targetAmount: normalizeMoney(row["목표금액"]),
    currentPercent: normalizePercent(row["비중"]),
    currentAmount: normalizeMoney(row["현재 금액"])
  };
}

function inferAssetClass(assetName) {
  const name = assetName.toLowerCase();
  if (name.includes("현금") || name.includes("rp")) return "cash";
  if (name.includes("비트코인") || name.includes("crypto")) return "crypto";
  if (name.includes("금") || name.includes("gold")) return "commodity";
  if (name.includes("kospi") || name.includes("s&p") || name.includes("nasdaq")) return "equity-index";
  if (name.includes("우량주") || name.includes("성장주") || name.includes("주")) return "equity-stock";
  return "other";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = args.csv;
  if (!csvPath) throw new Error("Pass the Notion export path with --csv <path>");
  const outPath = args.out ?? resolve(process.cwd(), "harness", "fixtures", "notion-investment-assets.json");

  const raw = await readFile(csvPath, "utf-8");
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV has no data rows");
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] ?? "";
    });
    return obj;
  });

  const holdings = rows
    .filter((row) => row["현재 금액"] && row["자산 형태"] !== "투자 자산")
    .map(mapHolding)
    .map((item) => ({
      ...item,
      assetClass: inferAssetClass(item.assetName),
      driftAmount: item.currentAmount - item.targetAmount,
      driftPercent: Number((item.currentPercent - item.targetPercent).toFixed(2))
    }));

  const totalCurrent = holdings.reduce((sum, h) => sum + h.currentAmount, 0);
  const totalTarget = holdings.reduce((sum, h) => sum + h.targetAmount, 0);

  const payload = {
    source: {
      type: "notion-csv",
      csvPath
    },
    summary: {
      totalCurrent,
      totalTarget,
      holdingCount: holdings.length
    },
    holdings
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

  process.stdout.write(
    JSON.stringify(
      {
        imported: true,
        csvPath,
        outPath,
        summary: payload.summary
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
