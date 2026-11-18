import crypto from "crypto";

export interface ParsedCsvRow {
  date: string;
  amount: number; // positive = credit/income, negative = debit/expense
  merchant: string;
  cleanDescription: string;
  rawDescription: string;
  deduplicationHash: string;
  suggestedCategoryId?: string;
  categoryName?: string;
}

export type SupportedBankFormat = "auto" | "commbank" | "macquarie" | "anz" | "nab" | "generic_csv";

/**
 * Normalizes an Australian or ISO date string (DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY) to YYYY-MM-DD
 */
export function normalizeDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const parts = trimmed.split(/[/.-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY/MM/DD
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    } else {
      // DD/MM/YYYY
      const day = parts[0].padStart(2, "0");
      const month = parts[1].padStart(2, "0");
      let year = parts[2];
      if (year.length === 2) {
        year = `20${year}`;
      }
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return new Date().toISOString().split("T")[0];
}

/**
 * Cleans bank description to extract merchant name
 */
export function cleanMerchantName(description: string): { merchant: string; clean: string } {
  let text = description.trim();

  // Strip common Australian POS prefix codes:
  // e.g. "VISA PURCHASE 1234 COLES UNLEY SA AUS", "EFTPOS 892 WOOLWORTHS", "DIRECT DEBIT 9988 NETFLIX"
  text = text.replace(/^(VISA PURCHASE|EFTPOS|DIRECT DEBIT|PAYMENT TO|TRANSFER TO|DEBIT CARD PURCHASE|PENDING -)\s*/i, "");

  // Strip trailing Australian state/country and card numbers
  text = text.replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+(AUS|AUSTRALIA).*$/i, "");
  text = text.replace(/\s+CARD\s+\d{4}.*$/i, "");
  text = text.replace(/\s+VALUE DATE:.*$/i, "");

  // Detect merchant
  const words = text.split(/\s+/).slice(0, 4);
  const merchant = words.join(" ");

  return {
    merchant: merchant || text,
    clean: text,
  };
}

/**
 * Computes deterministic SHA-256 deduplication hash for an ingested bank row
 */
export function computeDeduplicationHash(
  accountId: string,
  date: string,
  amount: number,
  rawDescription: string
): string {
  const hashInput = `${accountId}|${date}|${amount.toFixed(2)}|${rawDescription.trim().toLowerCase()}`;
  return crypto.createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Computes SHA-256 hash for an entire uploaded statement file
 */
export function computeFileHash(fileBuffer: Buffer | string): string {
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

/**
 * Parses raw CSV text into rows, handling quotes and commas properly
 */
export function parseCsvTextToRows(csvText: string): string[][] {
  const rows: string[][] = [];
  const lines = csvText.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    const row: string[] = [];
    let insideQuotes = false;
    let currentField = "";

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        row.push(currentField.trim());
        currentField = "";
      } else {
        currentField += char;
      }
    }
    row.push(currentField.trim());
    rows.push(row);
  }

  return rows;
}

function parseNumericCell(cell?: string): number {
  if (!cell) return NaN;
  const cleaned = cell.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return parseFloat(cleaned);
}

/**
 * High-performance parser supporting standard Australian bank statement formats
 */
export function parseBankStatementCsv(
  csvText: string,
  accountId: string,
  format: SupportedBankFormat = "auto"
): ParsedCsvRow[] {
  const rawRows = parseCsvTextToRows(csvText);
  if (rawRows.length === 0) return [];

  let detectedFormat = format;

  // Auto-detect format by scanning headers
  if (detectedFormat === "auto") {
    const firstLine = rawRows[0].map((c) => c.toLowerCase()).join(",");
    if (firstLine.includes("balance") && firstLine.includes("debit") && firstLine.includes("credit")) {
      detectedFormat = "macquarie";
    } else if (firstLine.includes("date") && firstLine.includes("amount") && firstLine.includes("description")) {
      detectedFormat = "commbank";
    } else {
      // Check if row 0 contains words or looks like data
      const looksLikeHeader = /[a-zA-Z]/.test(rawRows[0][0]) && !/^\d/.test(rawRows[0][0]);
      detectedFormat = looksLikeHeader ? "generic_csv" : "commbank";
    }
  }

  // Check if first row is a header
  const isHeader = /[a-zA-Z]/.test(rawRows[0][0]) && !/^\d{2}[/-]\d{2}/.test(rawRows[0][0]);
  const headerCols = isHeader ? rawRows[0].map((c) => c.trim().toLowerCase()) : [];
  const dataRows = isHeader ? rawRows.slice(1) : rawRows;

  const dateColIdx = headerCols.findIndex((h) => h.includes("date"));
  const descColIdx = headerCols.findIndex(
    (h) => h.includes("description") || h.includes("merchant") || h.includes("narrative") || h.includes("memo")
  );
  const amountColIdx = headerCols.findIndex((h) => h === "amount" || h.includes("amount"));
  const debitColIdx = headerCols.findIndex((h) => h === "debit" || h.includes("debit"));
  const creditColIdx = headerCols.findIndex((h) => h === "credit" || h.includes("credit"));

  const parsedTransactions: ParsedCsvRow[] = [];

  for (const row of dataRows) {
    if (row.length < 2) continue;

    let date = "";
    let amount = 0;
    let description = "";

    try {
      if (detectedFormat === "macquarie") {
        // Macquarie CSV format: Date, Description, Debit, Credit, Balance, Category
        date = normalizeDate(row[dateColIdx >= 0 ? dateColIdx : 0]);
        description = row[descColIdx >= 0 ? descColIdx : 1] || "";
        const debit = parseNumericCell(row[debitColIdx >= 0 ? debitColIdx : 2]);
        const credit = parseNumericCell(row[creditColIdx >= 0 ? creditColIdx : 3]);
        amount =
          !isNaN(credit) && credit > 0
            ? credit
            : !isNaN(debit) && debit !== 0
            ? -Math.abs(debit)
            : 0;
      } else if (detectedFormat === "anz" || detectedFormat === "nab") {
        // ANZ/NAB CSV: Date, Amount, Description
        date = normalizeDate(row[dateColIdx >= 0 ? dateColIdx : 0]);
        const parsedAmt = parseNumericCell(row[amountColIdx >= 0 ? amountColIdx : 1]);
        amount = isNaN(parsedAmt) ? 0 : parsedAmt;
        description = row[descColIdx >= 0 ? descColIdx : 2] || "";
      } else if (isHeader && dateColIdx >= 0 && descColIdx >= 0 && amountColIdx >= 0) {
        date = normalizeDate(row[dateColIdx]);
        const parsedAmt = parseNumericCell(row[amountColIdx]);
        amount = isNaN(parsedAmt) ? 0 : parsedAmt;
        description = row[descColIdx] || "";
      } else {
        // Standard CommBank format: Date, Amount, Description, Balance
        // OR Generic: Date, Amount, Description / Date, Description, Amount
        date = normalizeDate(row[0]);
        const col1Num = parseNumericCell(row[1]);
        const col2Num = parseNumericCell(row[2]);
        if (!isNaN(col1Num)) {
          amount = col1Num;
          description = row[2] || row[1] || "";
        } else if (!isNaN(col2Num)) {
          amount = col2Num;
          description = row[1] || "";
        }
      }

      if (isNaN(amount) || amount === 0) continue;

      const { merchant, clean } = cleanMerchantName(description);
      const deduplicationHash = computeDeduplicationHash(accountId, date, amount, description);

      parsedTransactions.push({
        date,
        amount,
        merchant,
        cleanDescription: clean,
        rawDescription: description,
        deduplicationHash,
      });
    } catch {
      // skip unparseable row
      continue;
    }
  }

  return parsedTransactions;
}
