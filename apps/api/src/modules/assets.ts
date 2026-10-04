type CsvImportResult =
  | {
      imported: false;
      reason: string;
    }
  | {
      imported: true;
      source: "csv";
      holdingCount: number;
      holdings: Array<{
        name: string;
        account: string;
        marketValue: number;
        targetPercent: number;
      }>;
    };

function splitCsvLine(line: string) {
  const cells = [];
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
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells;
}

function normalizeMoney(raw: string) {
  if (!raw) return 0;
  return Number(raw.replace(/[^0-9.-]/g, "")) || 0;
}

export function importAssetsFromCsvText(csvText: string): CsvImportResult {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return {
      imported: false,
      reason: "No data rows in CSV"
    };
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] ?? "";
    });
    return obj;
  });

  const holdings = rows
    .filter((row) => row["자산 형태"] && row["자산 형태"] !== "투자 자산")
    .map((row) => ({
      name: row["자산 형태"],
      account: row["계좌"] ?? "",
      marketValue: normalizeMoney(row["현재 금액"]),
      targetPercent: Number(String(row["목표 비중"] ?? "").replace(/[^0-9.-]/g, "")) || 0
    }));

  return {
    imported: true,
    source: "csv",
    holdingCount: holdings.length,
    holdings
  };
}

export function queueImageRecognition(fileName) {
  const jobId = `ocr-${Date.now()}`;
  return {
    queued: true,
    jobId,
    fileName,
    status: "pending",
    note: "OCR engine integration placeholder. Connect Vision API or Tesseract in next step."
  };
}
