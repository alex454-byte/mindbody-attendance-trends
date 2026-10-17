// The MCP server. Tools return counts and member codes; names only when the user turned sharing on.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { ROLES, type Mapping } from "./columns.js";
import { REGISTRY, type Config } from "./config.js";
import { Dataset, type FileKind } from "./dataset.js";
import { renderReport } from "./report.js";

function openInBrowser(path: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [path]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", path]] : ["xdg-open", [path]];
  execFile(cmd as string, args as string[], () => { /* the path is in the tool result either way */ });
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const thresholdShape = {
  data_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe("YYYY-MM-DD. Defaults to the latest visit date in the files."),
  min_weeks_attended: z.number().int().min(1).max(8).optional().describe("Default 6 (of the 8 usual weeks)."),
  min_usual_per_week: z.number().min(0).max(14).optional().describe("Default 2 days a week."),
  drop_ratio: z.number().gt(0).lt(1).optional().describe("Default 0.6 (60% of usual or less)."),
};

type ThresholdArgs = { data_date?: string; min_weeks_attended?: number; min_usual_per_week?: number; drop_ratio?: number };

function analyzeArgs(a: ThresholdArgs) {
  return {
    ...(a.data_date ? { dataDate: a.data_date } : {}),
    thresholds: {
      ...(a.min_weeks_attended !== undefined ? { minWeeksAttended: a.min_weeks_attended } : {}),
      ...(a.min_usual_per_week !== undefined ? { minUsualPerWeek: a.min_usual_per_week } : {}),
      ...(a.drop_ratio !== undefined ? { dropRatio: a.drop_ratio } : {}),
    },
  };
}

export function createServer(config: Config, dataset = new Dataset()) {
  const server = new McpServer({ name: "mindbody-attendance-trends", version: "0.1.0" });

  async function saveRegistry() {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    await writeFile(join(config.dataDir, REGISTRY), JSON.stringify({ paths: dataset.loadedPaths() }, null, 2), { mode: 0o600 });
  }

  const loadedSummary = () => {
    const s = dataset.summary();
    return {
      ...s,
      names_shared_with_claude: config.shareNames,
      next: s.files.some((f) => f.status === "needs_mapping")
        ? "Some files need column choices. Show the user the header names and call map_columns."
        : "Call slipping_regulars for codes and counts, or open_report to show names in the browser.",
    };
  };

  server.registerTool("load_exports", {
    title: "Load Mindbody exports",
    description: "Read Mindbody report exports (CSV or XLSX) on this computer. `paths` are Attendance without Revenue " +
      "exports (one or several overlapping monthly files; duplicates are removed). Optional `hold_paths` are Autopay " +
      "Detail exports filtered to Suspended (members on hold are left out). Optional `membership_paths` are " +
      "Membership (New Version) exports (only active members are kept). Returns counts only: rows, members, date range, " +
      "weeks covered. If columns are unclear it returns header names (never row values) for map_columns.",
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(24),
      hold_paths: z.array(z.string().min(1)).max(12).optional(),
      membership_paths: z.array(z.string().min(1)).max(12).optional(),
    },
  }, async ({ paths, hold_paths, membership_paths }) => {
    const groups: [string[] | undefined, FileKind][] = [[paths, "attendance"], [hold_paths, "holds"], [membership_paths, "memberships"]];
    for (const [list, kind] of groups) if (list?.length) await dataset.load(list, kind);
    await saveRegistry();
    return text(loadedSummary());
  });

  server.registerTool("map_columns", {
    title: "Choose columns",
    description: "Tell the tool which header name holds each field, when load_exports could not decide. Use header " +
      "names exactly as load_exports listed them. Applies to every file still waiting for a choice.",
    inputSchema: Object.fromEntries(ROLES.map((role) => [role, z.string().min(1).optional()])) as Record<string, z.ZodOptional<z.ZodString>>,
  }, async (args) => {
    dataset.mapColumns(args as Mapping);
    return text(loadedSummary());
  });

  server.registerTool("slipping_regulars", {
    title: "Find slipping regulars",
    description: "Regulars (came in at least 6 of 8 usual weeks, about 2+ days a week) whose last 3 weeks fell to 60% " +
      "of usual or less. Returns member codes like M-0147 with numbers. Names are included only if the user turned on " +
      "share_names_with_claude. To see names, call open_report: it opens a page in the user's browser.",
    inputSchema: thresholdShape,
  }, async (args) => {
    try {
      const a = dataset.analyze(analyzeArgs(args));
      return text({
        data_date: a.data_date, date_range: a.date_range, usual_weeks: a.usual_weeks, last3_weeks: a.last3_weeks,
        data_week_counted: a.data_week_counted, thresholds: a.thresholds, counts: a.counts,
        hold_export_loaded: a.hold_export_loaded, membership_export_loaded: a.membership_export_loaded,
        gaps_between_files: a.gaps_between_files, names_shared_with_claude: config.shareNames,
        members: a.slipping.map((m) => ({
          code: m.code, ...(config.shareNames ? { name: m.name } : {}),
          usual_per_week: m.usual_per_week, last3_per_week: m.last3_per_week, last3_weeks: m.last3_weeks,
          last_visit: m.last_visit, weeks_attended_of_8: m.weeks_attended_of_8,
        })),
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool("open_report", {
    title: "Open the report with names",
    description: "Write a self-contained HTML report, with member names, to a folder on this computer and open it in " +
      "the default browser. The names go to the page, not to Claude. Returns the file path and counts.",
    inputSchema: { ...thresholdShape, facility_name: z.string().max(80).optional().describe("Shown in the page header.") },
  }, async (args) => {
    try {
      const a = dataset.analyze(analyzeArgs(args));
      const dir = join(config.dataDir, "reports");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `slipping-regulars-${a.data_date}.html`);
      await writeFile(file, renderReport(a, { facility: args.facility_name, generatedAt: new Date().toISOString() }), { mode: 0o600 });
      if (config.openBrowser) openInBrowser(file);
      return text({ report: file, opened: config.openBrowser, slipping: a.counts.slipping, data_date: a.data_date });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}
