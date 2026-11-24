// Reads a shop's price list from a spreadsheet (.xlsx) or a CSV file: one product per row,
// a name and a price. Header rows and empty rows are skipped. exceljs: well-known xlsx reader.
import ExcelJS from "exceljs";

export interface SheetRow {
  name: string;
  cents: number;
}

function toCents(v: unknown): number | null {
  const s = String(v ?? "").replace(/[$,\s]|usd/gi, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

/** Each row: the first text cell is the product, the first number cell after it is the price. */
function rowToItem(cells: unknown[]): SheetRow | null {
  let name = "";
  for (const c of cells) {
    const v = typeof c === "object" && c !== null && "result" in c ? (c as { result: unknown }).result : c;
    if (!name) {
      const t = String(v ?? "").trim();
      if (t && toCents(t) === null) name = t;
      continue;
    }
    const cents = toCents(v);
    if (cents !== null) return { name: name.slice(0, 120), cents };
  }
  return null;
}

export async function readPriceSheet(bytes: Buffer, filename: string, mime: string): Promise<SheetRow[]> {
  const isCsv = /\.csv$/i.test(filename) || /csv|text\/plain/.test(mime);
  const rows: unknown[][] = [];
  if (isCsv) {
    for (const line of bytes.toString("utf8").split(/\r?\n/)) rows.push(line.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, "").trim()));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  }
  return rows.map(rowToItem).filter((r): r is SheetRow => r !== null).slice(0, 500);
}
