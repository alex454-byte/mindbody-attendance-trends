import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config.js";
import { createServer } from "../src/server.js";
import { attendanceRows, PEOPLE, SYNTHETIC_NAMES, tempDir, toCsv, writeCsv, writePeopleCsv, writeXlsx } from "./helpers.js";

async function connect(shareNames: boolean) {
  const dataDir = tempDir();
  const server = createServer({ shareNames, dataDir, openBrowser: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const outputs: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    outputs.push(text);
    return { text, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), isError: result.isError };
  };
  return { client, call, outputs, dataDir };
}

async function fullSession(shareNames: boolean) {
  const s = await connect(shareNames);
  const dir = tempDir();
  const rows = attendanceRows();
  const csv = writeCsv(dir, "attendance-1.csv", rows.slice(0, 200));
  const xlsx = await writeXlsx(dir, "attendance-2.xlsx", rows.slice(150));
  const ambiguous = join(dir, "attendance-3.csv");
  writeFileSync(ambiguous, toCsv([["Client", "Class Date", "Service Date", "Status"],
    ...rows.slice(0, 20).map((r) => [r[1]!, r[2]!, r[2]!, r[6]!])]));
  const holds = writePeopleCsv(dir, "holds.csv", ["Client ID", "Client", "Status"], [["100003", "Placeholder, Riley", "Suspended"]]);
  const members = writePeopleCsv(dir, "members.csv", ["Client ID", "Client", "Status"],
    PEOPLE.map((p) => [p.id, p.name, p.id === "100005" ? "Expired" : "Active"]));
  const load = await s.call("load_exports", { paths: [csv, xlsx, ambiguous], hold_paths: [holds], membership_paths: [members] });
  const mapped = await s.call("map_columns", { visit_date: "Class Date" });
  const slipping = await s.call("slipping_regulars", {});
  const custom = await s.call("slipping_regulars", { data_date: "2026-10-07", drop_ratio: 0.5 });
  const report = await s.call("open_report", { facility_name: "Sample Facility" });
  return { ...s, load, mapped, slipping, custom, report, paths: [csv, xlsx, ambiguous, holds, members] };
}

describe("MCP tools", () => {
  it("lists the four tools", async () => {
    const { client } = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["load_exports", "map_columns", "open_report", "slipping_regulars"]);
  });

  it("returns counts and codes, and never a name, when sharing is off", async () => {
    const s = await fullSession(false);
    expect(s.load.json.files[2]).toMatchObject({ status: "needs_mapping" });
    expect(s.load.json.files[2].ambiguous.visit_date).toEqual(["Class Date", "Service Date"]);
    expect(s.mapped.json.files.every((f: { status: string }) => f.status === "loaded")).toBe(true);
    expect(s.mapped.json.duplicate_rows_removed).toBeGreaterThan(0);
    expect(s.slipping.json.counts.slipping).toBe(2);
    expect(s.slipping.json.members.map((m: { code: string }) => m.code)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^M-\d{4}$/)]));
    expect(s.slipping.json.members[0]).not.toHaveProperty("name");
    expect(s.report.json.slipping).toBe(2);
    const everything = s.outputs.join("\n");
    for (const name of SYNTHETIC_NAMES) expect(everything, `leaked "${name}"`).not.toContain(name);
    expect(everything).not.toContain("1000"); // client IDs are not returned either
  });

  it("includes names only when the user turns sharing on", async () => {
    const s = await fullSession(true);
    const names = s.slipping.json.members.map((m: { name: string }) => m.name).sort();
    expect(names).toEqual(["Example, Avery", "Madeup, Morgan"]);
  });

  it("writes a self-contained report with names that makes no network requests", async () => {
    const s = await fullSession(false);
    const html = readFileSync(s.report.json.report, "utf8");
    expect(s.report.json.report.startsWith(s.dataDir)).toBe(true);
    expect(html).toContain("Example, Avery");
    expect(html).toContain("Sample Facility");
    expect(html).toContain("Nothing was uploaded");
    expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(html).toContain("default-src 'none'");
    // Every URL in the page is the SVG namespace.
    expect([...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0])).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("records loaded paths, and only paths, for the plugin's file guard", async () => {
    const s = await fullSession(false);
    const registry = readFileSync(join(s.dataDir, "loaded-exports.json"), "utf8");
    expect(JSON.parse(registry).paths).toEqual(s.paths);
    for (const name of SYNTHETIC_NAMES) expect(registry).not.toContain(name);
  });

  it("explains errors without data", async () => {
    const s = await connect(false);
    const r = await s.call("slipping_regulars", {});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/load_exports first/);
  });
});

describe("configFromEnv", () => {
  it("is off by default and reads the user setting", () => {
    expect(configFromEnv({}).shareNames).toBe(false);
    expect(configFromEnv({ MAT_SHARE_NAMES: "true" }).shareNames).toBe(true);
    expect(configFromEnv({ MAT_SHARE_NAMES: "false" }).shareNames).toBe(false);
    expect(configFromEnv({ MAT_SHARE_NAMES: "${user_config.share_names_with_claude}" }).shareNames).toBe(false);
    expect(configFromEnv({ CLAUDE_PLUGIN_OPTION_SHARE_NAMES_WITH_CLAUDE: "true" }).shareNames).toBe(true);
    expect(configFromEnv({ CLAUDE_PLUGIN_DATA: "/tmp/x" }).dataDir).toBe("/tmp/x");
    expect(configFromEnv({ MAT_DATA_DIR: "${CLAUDE_PLUGIN_DATA}", CLAUDE_PLUGIN_DATA: "/tmp/y" }).dataDir).toBe("/tmp/y");
  });
});
