// Pure. RFC 4180 CSV for report exports. Cells that a spreadsheet would
// run as a formula (=, +, -, @, tab, CR at the start) are prefixed with a
// quote so a value like "=HYPERLINK(...)" in a customer name is shown as
// text, not executed. A UTF-8 BOM makes Excel read accents correctly.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(","))];
  return "\uFEFF" + lines.join("\r\n");
}
