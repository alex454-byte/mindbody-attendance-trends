import { describe, expect, it } from "vitest";
import { detectColumns, statusKind } from "../src/columns.js";
import { findHeaderRow, parseDay, parseTime, uniqueHeaders } from "../src/parse.js";

describe("detectColumns", () => {
  it("reads the common header layout", () => {
    const d = detectColumns(["Client ID", "Client", "Visit Date", "Time", "Class Name", "Location", "Status"]);
    expect(d.usable).toBe(true);
    expect(d.mapping).toEqual({ client_id: "Client ID", client_name: "Client", visit_date: "Visit Date",
      visit_time: "Time", class_name: "Class Name", location: "Location", status: "Status" });
  });

  it("handles other spellings", () => {
    const d = detectColumns(["Client Name", "Class Date", "Class Time", "Visit Status", "Service Category", "Site"]);
    expect(d.mapping).toMatchObject({ client_name: "Client Name", visit_date: "Class Date", visit_time: "Class Time",
      status: "Visit Status", location: "Site" });
    expect(d.mapping.class_name).toBeUndefined(); // "Service Category" is not a class
  });

  it("joins first and last name columns", () => {
    const d = detectColumns(["First Name", "Last Name", "Member ID", "Date", "Attendance"]);
    expect(d.usable).toBe(true);
    expect(d.mapping).toMatchObject({ first_name: "First Name", last_name: "Last Name", client_id: "Member ID",
      visit_date: "Date", status: "Attendance" });
  });

  it("prefers a specific header over a generic one", () => {
    const d = detectColumns(["Name", "Client", "Date", "Visit Date"]);
    expect(d.mapping).toMatchObject({ client_name: "Client", visit_date: "Visit Date" });
    expect(d.ambiguous).toEqual({});
  });

  it("asks when two headers fit equally well", () => {
    const d = detectColumns(["Client", "Class Date", "Service Date"]);
    expect(d.ambiguous.visit_date).toEqual(["Class Date", "Service Date"]);
    expect(d.usable).toBe(false);
    // The user picks one.
    expect(detectColumns(["Client", "Class Date", "Service Date"], { visit_date: "Service Date" }).usable).toBe(true);
  });

  it("is not usable without a date or someone to count", () => {
    expect(detectColumns(["Client", "Status"]).usable).toBe(false);
    expect(detectColumns(["Visit Date", "Status"]).usable).toBe(false);
  });
});

describe("statusKind", () => {
  it.each([["Signed In", "attended"], ["signed in", "attended"], ["Checked In", "attended"], ["Yes", "attended"],
    ["No Show", "missed"], ["No-Show", "missed"], ["Late Cancel", "missed"], ["Late Cancelled", "missed"],
    ["Cancelled", "missed"], ["Booked", "unknown"]])("%s is %s", (value, kind) => {
    expect(statusKind(value)).toBe(kind);
  });
});

describe("parsing cells", () => {
  it("reads US dates in several formats", () => {
    expect(parseDay("10/6/2026")).toBe("2026-10-06");
    expect(parseDay("10/6/26 6:00 AM")).toBe("2026-10-06");
    expect(parseDay("2026-10-06 06:00")).toBe("2026-10-06");
    expect(parseDay("Oct 6, 2026")).toBe("2026-10-06");
    expect(parseDay("Tue, Oct 6, 2026")).toBe("2026-10-06");
    expect(parseDay("6-Oct-2026")).toBe("2026-10-06");
    expect(parseDay("13/40/2026")).toBeNull();
    expect(parseDay("Total")).toBeNull();
  });

  it("reads times", () => {
    expect(parseTime("6:00 AM")).toBe("06:00");
    expect(parseTime("12:15 pm")).toBe("12:15");
    expect(parseTime("5:30 PM")).toBe("17:30");
    expect(parseTime("")).toBe("");
  });

  it("finds the header row below report titles and makes headers unique", () => {
    expect(findHeaderRow([["Attendance without Revenue"], ["Some report"], ["Client", "Visit Date", "Status"], ["a", "b", "c"]])).toBe(2);
    expect(findHeaderRow([["just"], ["data"]])).toBe(-1);
    expect(uniqueHeaders(["Date", "Date", ""])).toEqual(["Date", "Date (2)", "Column 3"]);
  });
});
