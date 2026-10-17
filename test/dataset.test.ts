import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeWeeks, Dataset, nameKey } from "../src/dataset.js";
import { attendanceRows, DATA_DATE, monthlySplits, PEOPLE, tempDir, toCsv, writeCsv, writePeopleCsv, writeXlsx } from "./helpers.js";

const codesOf = (d: Dataset, names: string[]) => names.map((n) => [...d.people.values()].find((p) => p.name === n)!.code);

async function loaded(extra?: (d: Dataset, dir: string) => Promise<void>) {
  const dir = tempDir();
  const d = new Dataset();
  await d.load([writeCsv(dir, "attendance.csv", attendanceRows())], "attendance");
  if (extra) await extra(d, dir);
  return d;
}

describe("loading exports", () => {
  it("reads a CSV with title rows and reports counts", async () => {
    const d = await loaded();
    const s = d.summary();
    expect(s.files[0]).toMatchObject({ status: "loaded", from: "2026-07-13", to: DATA_DATE });
    expect(s.data_date).toBe(DATA_DATE);
    expect(s.members).toBe(PEOPLE.length + 1);
    expect(s.weeks_complete).toBe(12); // Jul 13 - Oct 4; the week of Oct 5 is not over
    expect(s.duplicate_rows_removed).toBe(0);
    expect(s.status_column_found).toBe(true);
  });

  it("reads XLSX with real Excel dates and gets the same answer as CSV", async () => {
    const dir = tempDir();
    const x = new Dataset();
    await x.load([await writeXlsx(dir, "attendance.xlsx", attendanceRows())], "attendance");
    const c = await loaded();
    expect(x.summary().rows_read).toBe(c.summary().rows_read);
    const names = (d: Dataset) => d.analyze().slipping.map((m) => m.name).sort();
    expect(names(x)).toEqual(names(c));
    expect(names(x)).toEqual(["Example, Avery", "Fictional, Casey", "Madeup, Morgan", "Placeholder, Riley"]);
  });

  it("removes duplicates across overlapping monthly files", async () => {
    const dir = tempDir();
    const all = attendanceRows();
    const parts = monthlySplits(all, 7);
    const d = new Dataset();
    await d.load(parts.map((rows, i) => writeCsv(dir, `month-${i + 1}.csv`, rows)), "attendance");
    const s = d.summary();
    expect(s.rows_read).toBe(parts.flat().length);
    expect(s.duplicate_rows_removed).toBe(parts.flat().length - all.length);
    expect(s.duplicate_rows_removed).toBeGreaterThan(0);
    expect(s.gaps_between_files).toEqual([]);
    const single = await loaded();
    expect(d.analyze().counts).toEqual(single.analyze().counts);
  });

  it("warns about a missing month", async () => {
    const dir = tempDir();
    const parts = monthlySplits(attendanceRows(), 0);
    const d = new Dataset();
    await d.load([parts[0]!, parts[2]!, parts[3]!].map((rows, i) => writeCsv(dir, `m${i}.csv`, rows)), "attendance");
    expect(d.summary().gaps_between_files.length).toBe(1);
  });

  it("does not count no-shows or late cancels", async () => {
    // Three missed bookings in the latest week would lift it to 3 and hide the drop if they counted.
    const dir = tempDir();
    const missed = ["10/5/2026", "10/6/2026", "10/7/2026"].map((day, i) =>
      ["100001", "Example, Avery", day, "7:00 PM", "Ride", "North Location", i ? "Late Cancel" : "No Show"]);
    const d = new Dataset();
    await d.load([writeCsv(dir, "a.csv", [...attendanceRows(), ...missed])], "attendance");
    expect(d.analyze().slipping.map((m) => m.name)).toContain("Example, Avery");
  });

  it("asks for columns when headers are ambiguous, then loads after map_columns", async () => {
    const dir = tempDir();
    const path = join(dir, "odd.csv");
    writeFileSync(path, toCsv([["Client", "Class Date", "Service Date", "Status"], ["Sample, Jordan", "10/5/2026", "10/5/2026", "Signed In"]]));
    const d = new Dataset();
    const [info] = await d.load([path], "attendance");
    expect(info!.status).toBe("needs_mapping");
    expect(info!.headers).toEqual(["Client", "Class Date", "Service Date", "Status"]);
    expect(JSON.stringify(d.summary())).not.toContain("Jordan"); // header names only, never rows
    d.mapColumns({ visit_date: "Class Date" });
    expect(d.summary().files[0]).toMatchObject({ status: "loaded", rows: 1 });
  });

  it("rejects .xls with a clear message", async () => {
    const dir = tempDir();
    const path = join(dir, "old.xls");
    writeFileSync(path, "x");
    const [info] = await new Dataset().load([path], "attendance");
    expect(info!.status).toBe("error");
    expect(info!.error).toMatch(/save it as \.xlsx or \.csv/);
  });
});

describe("who is left out", () => {
  it("leaves out names starting with Test", async () => {
    const d = await loaded();
    const a = d.analyze();
    expect(a.counts.excluded_test_accounts).toBe(1);
    expect(a.slipping.map((m) => m.name)).not.toContain("Test, Quinn");
  });

  it("leaves out members on hold, matched by client ID or by name", async () => {
    const byId = await loaded(async (d, dir) => {
      await d.load([writePeopleCsv(dir, "holds.csv", ["Client ID", "Client Name", "Autopay Status"], [["100003", "Someone Else", "Suspended"]])], "holds");
    });
    expect(byId.analyze().slipping.map((m) => m.name)).not.toContain("Placeholder, Riley");
    expect(byId.analyze().counts.excluded_on_hold).toBe(1);

    // No ID column, and "First Last" instead of "Last, First".
    const byName = await loaded(async (d, dir) => {
      await d.load([writePeopleCsv(dir, "holds.csv", ["Client", "Status"], [["Riley Placeholder", "Suspended"], ["Avery Example", "Active"]])], "holds");
    });
    const names = byName.analyze().slipping.map((m) => m.name);
    expect(names).not.toContain("Placeholder, Riley");
    expect(names).toContain("Example, Avery"); // not suspended in that file
  });

  it("keeps only active members when a membership export is loaded", async () => {
    const d = await loaded(async (ds, dir) => {
      const rows = PEOPLE.filter((p) => p.name !== "Fictional, Casey").map((p) => [p.id, p.name, "Unlimited", "Active"]);
      rows.push(["100005", "Fictional, Casey", "Unlimited", "Terminated"]);
      await ds.load([writePeopleCsv(dir, "members.csv", ["Client ID", "Client", "Membership Name", "Status"], rows)], "memberships");
    });
    const a = d.analyze();
    expect(a.counts.excluded_not_active).toBeGreaterThanOrEqual(1);
    expect(a.slipping.map((m) => m.name)).not.toContain("Fictional, Casey");
  });

  it("rules out everyone when the files do not reach back far enough", async () => {
    const dir = tempDir();
    const late = attendanceRows().filter((r) => Date.parse(r[2]!) >= Date.parse("8/15/2026"));
    const d = new Dataset();
    await d.load([writeCsv(dir, "short.csv", late)], "attendance");
    const a = d.analyze();
    expect(a.counts.slipping).toBe(0);
    expect(a.counts.not_enough_history).toBeGreaterThan(0);
  });

  it("gives the expected list with holds and memberships together", async () => {
    const d = await loaded(async (ds, dir) => {
      await ds.load([writePeopleCsv(dir, "holds.csv", ["Client ID", "Client"], [["100003", "Placeholder, Riley"]])], "holds");
      await ds.load([writePeopleCsv(dir, "members.csv", ["Client ID", "Client"],
        PEOPLE.filter((p) => p.id !== "100005").map((p) => [p.id, p.name]))], "memberships");
    });
    const a = d.analyze();
    expect(a.slipping.map((m) => m.code).sort()).toEqual(codesOf(d, ["Example, Avery", "Madeup, Morgan"]).sort());
    const avery = a.slipping.find((m) => m.name === "Example, Avery")!;
    expect(avery).toMatchObject({ usual_per_week: 3, last3_per_week: 0.7, last3_weeks: [1, 1, 0], weeks_attended_of_8: 8,
      last_visit: "2026-09-28", location: "North Location" });
  });

  it("uses a data date the user gives, and refuses one past the files", async () => {
    const d = await loaded();
    expect(d.analyze({ dataDate: "2026-10-07" }).data_week_counted).toBe(false);
    expect(() => d.analyze({ dataDate: "2026-10-20" })).toThrow(/after the last date/);
  });
});

describe("helpers", () => {
  it("normalizes names for matching", () => {
    expect(nameKey("Example, Avery")).toBe("avery example");
    expect(nameKey("  Avery   EXAMPLE ")).toBe("avery example");
  });
  it("counts complete weeks", () => {
    expect(completeWeeks("2026-07-13", "2026-10-10")).toBe(12);
    expect(completeWeeks("2026-07-15", "2026-10-11")).toBe(12);
  });
});
