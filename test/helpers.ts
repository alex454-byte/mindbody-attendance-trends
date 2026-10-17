// Synthetic data only. Every name here is made up.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { twelveMondays } from "../src/rule.js";

export const DATA_DATE = "2026-10-10"; // a Saturday
export const COVERAGE_START = "2026-07-13"; // a Monday, a week before the 12 weeks begin

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const OFFSETS = [0, 2, 4, 1, 3, 5, 6]; // Mon, Wed, Fri, Tue, Thu, Sat, Sun

/** Visit days for 12 weekly counts (oldest first) ending with the week of `dataDate`. */
export function visitDays(weeks: number[], dataDate = DATA_DATE): string[] {
  const mondays = twelveMondays(dataDate);
  return weeks.flatMap((count, i) => OFFSETS.slice(0, count).map((o) => addDays(mondays[i]!, o)))
    .filter((d) => d <= dataDate);
}

const us = (iso: string) => { const [y, m, d] = iso.split("-"); return `${+m!}/${+d!}/${y}`; };

export interface Person { name: string; id: string; weeks: number[]; location?: string }

export const PEOPLE: Person[] = [
  // Slipping: steady 3 a week, then 1, 1, 0.
  { name: "Example, Avery", id: "100001", weeks: [3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 0], location: "North Location" },
  // Steady: never slips.
  { name: "Sample, Jordan", id: "100002", weeks: [2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3], location: "North Location" },
  // Slipping too, but on hold in the hold export.
  { name: "Placeholder, Riley", id: "100003", weeks: [4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0], location: "South Location" },
  // Slipping, but a test account.
  { name: "Test, Quinn", id: "100004", weeks: [3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0], location: "South Location" },
  // Slipping, not in the membership export (no longer a member).
  { name: "Fictional, Casey", id: "100005", weeks: [3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 0, 0], location: "South Location" },
  // Slipping, at the second location.
  { name: "Madeup, Morgan", id: "100006", weeks: [2, 2, 3, 2, 2, 3, 2, 2, 2, 1, 0, 1], location: "South Location" },
  // Occasional visitor: not a regular.
  { name: "Imaginary, Taylor", id: "100007", weeks: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0], location: "North Location" },
];

export const SYNTHETIC_NAMES = PEOPLE.flatMap((p) => {
  const [last, first] = p.name.split(", ");
  return [p.name, `${first} ${last}`, last!, first!];
}).concat(["Other, Drew", "Drew"]).filter((n) => n !== "Test");

export const ATTENDANCE_HEADERS = ["Client ID", "Client", "Visit Date", "Time", "Class Name", "Location", "Status"];

/** Attendance rows for everyone, a no-show per person, and one other client whose visits mark the first and last
 * dates the export covers. */
export function attendanceRows(people = PEOPLE): string[][] {
  const rows: string[][] = [];
  for (const p of people) {
    for (const day of visitDays(p.weeks)) rows.push([p.id, p.name, us(day), "6:00 AM", "Strength 45", p.location ?? "", "Signed In"]);
    rows.push([p.id, p.name, us("2026-10-08"), "5:30 PM", "Conditioning", p.location ?? "", "No Show"]);
  }
  rows.push(["100099", "Other, Drew", us(COVERAGE_START), "7:00 AM", "Strength 45", "North Location", "Signed In"]);
  rows.push(["100099", "Other, Drew", us(DATA_DATE), "8:00 AM", "Strength 45", "North Location", "Signed In"]);
  return rows.sort((a, b) => Date.parse(a[2]!) - Date.parse(b[2]!) || a[1]!.localeCompare(b[1]!));
}

const quote = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mat-test-"));
}

export function writeCsv(dir: string, name: string, rows: string[][], title = true): string {
  const path = join(dir, name);
  // Mindbody exports often start with a title line or two before the header row.
  const pre = title ? [["Attendance without Revenue"], ["Example report"], []] : [];
  writeFileSync(path, "﻿" + toCsv([...pre.filter((r) => r.length), ATTENDANCE_HEADERS, ...rows]));
  return path;
}

/** Same columns as the CSV, but dates are real Excel dates and times are separate cells. */
export async function writeXlsx(dir: string, name: string, rows: string[][]): Promise<string> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Notes").addRow(["Generated for tests"]);
  const sheet = book.addWorksheet("Report");
  sheet.addRow(["Attendance without Revenue"]);
  sheet.addRow(ATTENDANCE_HEADERS);
  for (const r of rows) {
    const [m, d, y] = r[2]!.split("/").map(Number);
    sheet.addRow([Number(r[0]), r[1], new Date(Date.UTC(y!, m! - 1, d!)), r[3], r[4], r[5], r[6]]);
  }
  const path = join(dir, name);
  await book.xlsx.writeFile(path);
  return path;
}

export function writePeopleCsv(dir: string, name: string, headers: string[], rows: string[][]): string {
  const path = join(dir, name);
  writeFileSync(path, toCsv([headers, ...rows]));
  return path;
}

/** Split rows into calendar months, each file overlapping the next by `overlapDays`. */
export function monthlySplits(rows: string[][], overlapDays = 7): string[][][] {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  return months.map((month) => {
    const start = `${month}-01`;
    const nextMonth = months[months.indexOf(month) + 1];
    const end = nextMonth ? addDays(`${nextMonth}-01`, overlapDays - 1) : "9999-12-31";
    return rows.filter((r) => {
      const [m, d, y] = r[2]!.split("/");
      const iso = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
      return iso >= start && iso <= end;
    });
  });
}
