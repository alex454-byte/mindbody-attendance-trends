// Read CSV and XLSX files into rows of strings. Excel dates become "YYYY-MM-DD" or "YYYY-MM-DD HH:MM".
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { headerScore } from "./columns.js";

export type Table = string[][];

const pad = (n: number) => String(n).padStart(2, "0");

function excelDate(d: Date): string {
  // exceljs gives the sheet's wall-clock time as a UTC instant.
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = d.getUTCHours() || d.getUTCMinutes() ? ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : "";
  return day + time;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return excelDate(value);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value).trim();
}

export async function readTable(path: string): Promise<Table> {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv" || ext === ".txt") {
    let text = await readFile(path, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCsv(text, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
    return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
  }
  if (ext === ".xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path);
    // Use the sheet that looks most like a report (most recognized headers in its first rows).
    let best: Table = [];
    let bestScore = -1;
    book.eachSheet((sheet) => {
      const rows: Table = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values as ExcelJS.CellValue[];
        rows.push(values.slice(1).map(cellText));
      });
      const score = Math.max(0, ...rows.slice(0, 25).map(headerScore));
      if (score > bestScore) { best = rows; bestScore = score; }
    });
    return best;
  }
  if (ext === ".xls") {
    throw new Error("Old .xls files are not supported. Open the file and save it as .xlsx or .csv, then load that.");
  }
  throw new Error(`Unsupported file type ${ext || "(none)"}. Use .csv or .xlsx.`);
}

/** The header row: the row among the first 25 with the most recognized header names (at least 2). */
export function findHeaderRow(table: Table): number {
  let best = -1;
  let bestScore = 1;
  table.slice(0, 25).forEach((row, index) => {
    const score = headerScore(row);
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}

/** Header names made unique ("Date", "Date (2)") so a mapping by name is never ambiguous. */
export function uniqueHeaders(row: string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((raw, i) => {
    const h = raw.trim() || `Column ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
}

const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** A date from a cell: "2025-10-06", "10/6/2025", "10/6/25 6:00 AM", "Oct 6, 2025", "6-Oct-2025". US order. */
export function parseDay(text: string): string | null {
  const s = text.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(?:[a-z]{3,9},?\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i);
  if (m) return ymd(+m[3]!, +m[1]!, +m[2]!);
  m = s.match(/^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && monthIndex(m[1]!) > 0) return ymd(+m[3]!, monthIndex(m[1]!), +m[2]!);
  m = s.match(/^(\d{1,2})[-\s]([a-z]{3,9})[-\s](\d{2,4})/i);
  if (m && monthIndex(m[2]!) > 0) return ymd(+m[3]!, monthIndex(m[2]!), +m[1]!);
  return null;
}

/** A time from a cell, as "HH:MM" (24h), or "" when there is none. */
export function parseTime(text: string): string {
  const m = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return "";
  let h = +m[1]!;
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return `${pad(h)}:${m[2]}`;
}
