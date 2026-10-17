// Everything loaded so far, kept in memory only. Nothing here is written to disk except by the report.
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { detectColumns, detectPersonColumns, statusKind, type Detection, type Mapping, type Role } from "./columns.js";
import { findHeaderRow, parseDay, parseTime, readTable, uniqueHeaders, type Table } from "./parse.js";
import { DEFAULT_THRESHOLDS, monday, regular, slippingRegular, slipWindow, twelveMondays, validDay, weeklyVisits12w,
  type Thresholds } from "./rule.js";

export type FileKind = "attendance" | "holds" | "memberships";

export interface Person { key: string; code: string; name: string; id: string; nameKey: string }

interface Visit { personKey: string; day: string; attended: boolean; location: string }

export interface FileInfo {
  index: number;
  path: string;
  kind: FileKind;
  status: "loaded" | "needs_mapping" | "error";
  rows: number;
  from?: string;
  to?: string;
  /** Present when status is needs_mapping: header names only. */
  headers?: string[];
  ambiguous?: Partial<Record<Role, string[]>>;
  missing?: string[];
  error?: string;
}

/** "Example, Avery" and "Avery  Example" both become "avery example". */
export function nameKey(name: string): string {
  const swapped = name.includes(",") ? name.split(",").slice(1).join(" ") + " " + name.split(",")[0] : name;
  return swapped.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function cell(row: string[], headers: string[], header: string | undefined): string {
  if (!header) return "";
  const i = headers.indexOf(header);
  return i === -1 ? "" : (row[i] ?? "").trim();
}

function personFrom(row: string[], headers: string[], m: Mapping): { name: string; id: string } {
  const first = cell(row, headers, m.first_name);
  const last = cell(row, headers, m.last_name);
  const name = cell(row, headers, m.client_name) || [first, last].filter(Boolean).join(" ");
  return { name, id: cell(row, headers, m.client_id) };
}

export class Dataset {
  files: FileInfo[] = [];
  people = new Map<string, Person>();
  private visits = new Map<string, Visit>();
  private pendingTables = new Map<number, { table: Table; headerRow: number }>();
  private holdIds = new Set<string>();
  private holdNames = new Set<string>();
  private activeIds: Set<string> | null = null;
  private activeNames: Set<string> | null = null;
  private salt = randomBytes(16).toString("hex");
  private nextCode = 1;
  rowsRead = 0;
  duplicateRows = 0;
  skippedRows = 0;
  unrecognizedStatusRows = 0;
  statusColumnSeen = false;
  private overrides: Mapping = {};

  /** Absolute paths of every file loaded, for the plugin's file guard. */
  loadedPaths(): string[] { return this.files.map((f) => f.path); }

  async load(paths: string[], kind: FileKind): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    for (const raw of paths) {
      const path = resolve(raw);
      const info: FileInfo = { index: this.files.length, path, kind, status: "error", rows: 0 };
      this.files.push(info);
      try {
        const table = await readTable(path);
        const headerRow = findHeaderRow(table);
        if (headerRow === -1) {
          info.error = "No header row recognized. Tell map_columns which header names to use.";
          info.status = "needs_mapping";
          info.headers = [];
          this.pendingTables.set(info.index, { table, headerRow: -1 });
        } else {
          this.pendingTables.set(info.index, { table, headerRow });
          this.ingest(info);
        }
      } catch (error) {
        // Parser messages can quote file content; keep the message, drop anything quoted.
        info.error = (error instanceof Error ? error.message : String(error)).replace(/(["'`]).*?\1/g, "\"...\"").slice(0, 300);
      }
      out.push(info);
    }
    return out;
  }

  /** Set header names for roles, then retry every file that needed mapping. */
  mapColumns(mapping: Mapping): FileInfo[] {
    this.overrides = { ...this.overrides, ...mapping };
    const retried: FileInfo[] = [];
    for (const info of this.files) {
      const pending = this.pendingTables.get(info.index);
      if (info.status !== "needs_mapping" || !pending) continue;
      if (pending.headerRow === -1) {
        const wanted = Object.values(this.overrides).filter(Boolean) as string[];
        pending.headerRow = pending.table.slice(0, 25).findIndex((row) => wanted.every((h) => row.map((c) => c.trim()).includes(h)));
        if (pending.headerRow === -1) { retried.push(info); continue; }
      }
      this.ingest(info);
      retried.push(info);
    }
    return retried;
  }

  private ingest(info: FileInfo) {
    const pending = this.pendingTables.get(info.index)!;
    const headers = uniqueHeaders(pending.table[pending.headerRow]!);
    const detection: Detection = info.kind === "attendance"
      ? detectColumns(headers, this.overrides) : detectPersonColumns(headers, this.overrides);
    const missing = info.kind === "attendance"
      ? [...(detection.mapping.client_name || detection.mapping.client_id || (detection.mapping.first_name && detection.mapping.last_name) ? [] : ["client_name"]),
        ...(detection.mapping.visit_date ? [] : ["visit_date"])]
      : detection.usable ? [] : ["client_name"];
    const blocking = Object.keys(detection.ambiguous).filter((role) =>
      !(detection.mapping as Record<string, string>)[role] && (info.kind === "attendance" || ["client_name", "client_id", "status"].includes(role)));
    if (!detection.usable || blocking.length) {
      info.status = "needs_mapping";
      info.headers = headers;
      info.ambiguous = detection.ambiguous;
      info.missing = missing;
      return;
    }
    delete info.headers; delete info.ambiguous; delete info.missing; delete info.error;
    const rows = pending.table.slice(pending.headerRow + 1);
    if (info.kind === "attendance") this.ingestAttendance(info, headers, detection.mapping, rows);
    else this.ingestPeople(info, headers, detection.mapping, rows);
    info.status = "loaded";
    this.pendingTables.delete(info.index);
  }

  private person(name: string, id: string): Person | null {
    const nk = nameKey(name);
    if (!nk && !id) return null;
    const key = id ? `id:${id}` : `name:${nk}`;
    let p = this.people.get(key);
    if (!p) {
      p = { key, code: "", name, id, nameKey: nk };
      this.people.set(key, p);
    } else if (!p.name && name) { p.name = name; p.nameKey = nk; }
    return p;
  }

  /** New people get codes in a salted-hash order, so a code says nothing about name order in the file. */
  private assignCodes() {
    const fresh = [...this.people.values()].filter((p) => !p.code);
    const hash = (p: Person) => createHash("sha256").update(this.salt + p.key).digest("hex");
    fresh.sort((a, b) => hash(a).localeCompare(hash(b)));
    for (const p of fresh) p.code = `M-${String(this.nextCode++).padStart(4, "0")}`;
  }

  private ingestAttendance(info: FileInfo, headers: string[], m: Mapping, rows: Table) {
    if (m.status) this.statusColumnSeen = true;
    for (const row of rows) {
      if (row.every((c) => !c)) continue;
      const dateCell = cell(row, headers, m.visit_date);
      const day = parseDay(dateCell);
      const who = personFrom(row, headers, m);
      if (!day || (!who.name && !who.id)) { this.skippedRows++; continue; }
      this.rowsRead++;
      info.rows++;
      if (!info.from || day < info.from) info.from = day;
      if (!info.to || day > info.to) info.to = day;
      const p = this.person(who.name, who.id)!;
      const time = parseTime(cell(row, headers, m.visit_time)) || parseTime(dateCell.slice(10));
      const cls = cell(row, headers, m.class_name).toLowerCase();
      let attended = true;
      if (m.status) {
        const kind = statusKind(cell(row, headers, m.status));
        if (kind === "unknown") this.unrecognizedStatusRows++;
        attended = kind === "attended";
      }
      const key = [p.key, day, time, cls].join("\u0000");
      const existing = this.visits.get(key);
      if (existing) {
        this.duplicateRows++;
        existing.attended ||= attended;
        continue;
      }
      this.visits.set(key, { personKey: p.key, day, attended, location: cell(row, headers, m.location) });
    }
    this.assignCodes();
  }

  private ingestPeople(info: FileInfo, headers: string[], m: Mapping, rows: Table) {
    const isHold = info.kind === "holds";
    if (!isHold && !this.activeIds) { this.activeIds = new Set(); this.activeNames = new Set(); }
    for (const row of rows) {
      if (row.every((c) => !c)) continue;
      const who = personFrom(row, headers, m);
      if (!who.name && !who.id) { this.skippedRows++; continue; }
      info.rows++;
      const status = cell(row, headers, m.status).toLowerCase();
      const counts = isHold
        ? !m.status || /suspend|hold|pause|frozen|freeze/.test(status)
        : !m.status || (/\bactive\b/.test(status) && !/inactive/.test(status));
      if (!counts) continue;
      const ids = isHold ? this.holdIds : this.activeIds!;
      const names = isHold ? this.holdNames : this.activeNames!;
      if (who.id) ids.add(who.id);
      if (who.name) names.add(nameKey(who.name));
    }
  }

  coverage(): { from: string; to: string } | null {
    const loaded = this.files.filter((f) => f.kind === "attendance" && f.status === "loaded" && f.from && f.to);
    if (!loaded.length) return null;
    return { from: loaded.map((f) => f.from!).sort()[0]!, to: loaded.map((f) => f.to!).sort().at(-1)! };
  }

  /** Gaps of more than 7 days between attendance files' date ranges (a missing monthly export). */
  gaps(): { from: string; to: string }[] {
    const ranges = this.files.filter((f) => f.kind === "attendance" && f.from && f.to)
      .map((f) => ({ from: f.from!, to: f.to! })).sort((a, b) => a.from.localeCompare(b.from));
    const out: { from: string; to: string }[] = [];
    let reach = ranges[0]?.to;
    for (const r of ranges.slice(1)) {
      if (reach && Date.parse(r.from) - Date.parse(reach) > 8 * 86_400_000) out.push({ from: reach, to: r.from });
      if (!reach || r.to > reach) reach = r.to;
    }
    return out;
  }

  onHold(p: Person): boolean {
    return (p.id !== "" && this.holdIds.has(p.id)) || (p.nameKey !== "" && this.holdNames.has(p.nameKey));
  }

  /** null when no membership export was loaded. */
  active(p: Person): boolean | null {
    if (!this.activeIds || !this.activeNames) return null;
    return (p.id !== "" && this.activeIds.has(p.id)) || (p.nameKey !== "" && this.activeNames.has(p.nameKey));
  }

  hasHolds() { return this.files.some((f) => f.kind === "holds" && f.status === "loaded"); }
  hasMemberships() { return this.activeIds !== null; }

  summary() {
    const cov = this.coverage();
    const attendedKeys = new Set([...this.visits.values()].filter((v) => v.attended).map((v) => v.personKey));
    return {
      files: this.files.map((f) => ({
        file: f.index + 1, kind: f.kind, status: f.status, rows: f.rows, from: f.from, to: f.to,
        ...(f.status === "needs_mapping" ? { headers: f.headers, ambiguous: f.ambiguous, missing: f.missing } : {}),
        ...(f.error ? { error: f.error } : {}),
      })),
      rows_read: this.rowsRead,
      duplicate_rows_removed: this.duplicateRows,
      rows_skipped: this.skippedRows,
      members: attendedKeys.size,
      date_range: cov,
      data_date: cov?.to ?? null,
      weeks_complete: cov ? completeWeeks(cov.from, cov.to) : 0,
      status_column_found: this.statusColumnSeen,
      unrecognized_status_rows: this.unrecognizedStatusRows,
      gaps_between_files: this.gaps(),
      hold_export_loaded: this.hasHolds(),
      membership_export_loaded: this.hasMemberships(),
    };
  }

  analyze(options: { dataDate?: string; thresholds?: Partial<Thresholds>; excludeNamePrefix?: string } = {}): Analysis {
    const cov = this.coverage();
    if (!cov) throw new Error("No attendance export is loaded yet. Call load_exports first.");
    const dataDate = options.dataDate ?? cov.to;
    if (!validDay(dataDate)) throw new Error("data_date must be YYYY-MM-DD.");
    if (dataDate > cov.to) throw new Error(`data_date is after the last date in the files (${cov.to}).`);
    if (dataDate < cov.from) throw new Error(`data_date is before the first date in the files (${cov.from}).`);
    const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    const prefix = (options.excludeNamePrefix ?? "Test").toLowerCase();
    const days = new Map<string, Set<string>>();
    const locations = new Map<string, Map<string, number>>();
    for (const v of this.visits.values()) {
      if (!v.attended) continue;
      let set = days.get(v.personKey);
      if (!set) days.set(v.personKey, (set = new Set()));
      set.add(v.day);
      if (v.location && v.day <= dataDate) {
        const counts = locations.get(v.personKey) ?? new Map<string, number>();
        counts.set(v.location, (counts.get(v.location) ?? 0) + 1);
        locations.set(v.personKey, counts);
      }
    }
    const counts = { members: 0, excluded_test_accounts: 0, excluded_on_hold: 0, excluded_not_active: 0,
      not_enough_history: 0, regulars: 0, slipping: 0 };
    const slipping: MemberResult[] = [];
    const mondays = twelveMondays(dataDate);
    for (const [key, set] of days) {
      const p = this.people.get(key)!;
      counts.members++;
      const nameParts = [p.name, ...(p.name.includes(",") ? [p.name.split(",").slice(1).join(",").trim()] : [])];
      if (prefix && nameParts.some((n) => n.toLowerCase().startsWith(prefix))) { counts.excluded_test_accounts++; continue; }
      if (this.onHold(p)) { counts.excluded_on_hold++; continue; }
      if (this.active(p) === false) { counts.excluded_not_active++; continue; }
      const weeks = weeklyVisits12w(set, dataDate, cov.from)!;
      const win = slipWindow(weeks, dataDate);
      if ([...win.recent, ...win.usual].some((w) => w === null)) { counts.not_enough_history++; continue; }
      if (!regular(win.usual as number[], t)) continue;
      counts.regulars++;
      if (!slippingRegular(weeks, dataDate, t)) continue;
      counts.slipping++;
      const usual = win.usual as number[];
      const recent = win.recent as number[];
      const before = [...set].filter((d) => d <= dataDate).sort();
      const loc = [...(locations.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      slipping.push({
        code: p.code, name: p.name, client_id: p.id, location: loc, weeks,
        usual_per_week: round1(usual.reduce((a, b) => a + b, 0) / 8),
        last3_per_week: round1(recent.reduce((a, b) => a + b, 0) / 3),
        last3_weeks: recent,
        last_visit: before.at(-1) ?? null,
        weeks_attended_of_8: usual.filter((w) => w > 0).length,
      });
    }
    slipping.sort((a, b) => (b.usual_per_week - b.last3_per_week) - (a.usual_per_week - a.last3_per_week) || a.code.localeCompare(b.code));
    const { end } = slipWindow(Array(12).fill(0), dataDate);
    return {
      data_date: dataDate, date_range: cov, week_mondays: mondays,
      usual_weeks: { from: mondays[end - 10]!, to: sunday(mondays[end - 3]!) },
      last3_weeks: { from: mondays[end - 2]!, to: sunday(mondays[end]!) },
      data_week_counted: end === 11,
      thresholds: t, counts, slipping,
      hold_export_loaded: this.hasHolds(), membership_export_loaded: this.hasMemberships(),
      gaps_between_files: this.gaps(),
    };
  }
}

export interface MemberResult {
  code: string; name: string; client_id: string; location: string;
  weeks: (number | null)[];
  usual_per_week: number; last3_per_week: number; last3_weeks: number[];
  last_visit: string | null; weeks_attended_of_8: number;
}

export interface Analysis {
  data_date: string;
  date_range: { from: string; to: string };
  week_mondays: string[];
  usual_weeks: { from: string; to: string };
  last3_weeks: { from: string; to: string };
  data_week_counted: boolean;
  thresholds: Thresholds;
  counts: Record<string, number>;
  slipping: MemberResult[];
  hold_export_loaded: boolean;
  membership_export_loaded: boolean;
  gaps_between_files: { from: string; to: string }[];
}

const sunday = (mon: string) => new Date(Date.parse(`${mon}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function completeWeeks(from: string, to: string): number {
  let start = monday(from);
  if (start < from) start = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  return Math.max(0, Math.floor(days / 7));
}
