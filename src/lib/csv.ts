// CSV export helpers. Show and episode names come from podcast publishers, so a
// cell that starts like a formula is prefixed with ' to keep spreadsheets from
// running it (CSV injection).
export function csvCell(value: string | null): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(header: string[], rows: (string | null)[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}
