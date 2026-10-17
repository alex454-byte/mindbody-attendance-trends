import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { decide } from "../src/guard.js";
import { tempDir } from "./helpers.js";

const home = homedir();
const dataDir = join(home, ".mindbody-attendance-trends-test");
const exportFile = join(home, "Downloads", "attendance-oct.csv");
const loaded = [exportFile];
const d = (tool_name: string, tool_input: Record<string, unknown>, cwd = "/work/project") =>
  decide({ tool_name, tool_input, cwd }, dataDir, loaded);

describe("file guard", () => {
  it("blocks Read of a loaded export and of anything in the data folder", () => {
    expect(d("Read", { file_path: exportFile })).not.toBeNull();
    expect(d("Read", { file_path: "~/Downloads/attendance-oct.csv" })).not.toBeNull();
    expect(d("Read", { file_path: join(dataDir, "reports", "slipping-regulars-2026-10-10.html") })).not.toBeNull();
    expect(d("Read", { file_path: "attendance-oct.csv" }, join(home, "Downloads"))).not.toBeNull();
  });

  it("allows Read of other files", () => {
    expect(d("Read", { file_path: "/work/project/README.md" })).toBeNull();
    expect(d("Read", { file_path: join(home, "Downloads", "other.csv") })).toBeNull();
  });

  it("blocks Grep over an export or a folder holding one", () => {
    expect(d("Grep", { pattern: "x", path: exportFile })).not.toBeNull();
    expect(d("Grep", { pattern: "x", path: join(home, "Downloads") })).not.toBeNull();
    expect(d("Grep", { pattern: "x", path: home })).not.toBeNull();
    expect(d("Grep", { pattern: "x", path: dataDir })).not.toBeNull();
    expect(d("Grep", { pattern: "x", path: "/work/project/src" })).toBeNull();
  });

  it("blocks shell commands that name an export, the data folder, or glob CSVs next to an export", () => {
    expect(d("Bash", { command: `cat ${exportFile}` })).not.toBeNull();
    expect(d("Bash", { command: "head -5 ~/Downloads/attendance-oct.csv" })).not.toBeNull();
    expect(d("Bash", { command: "python3 -c 'print(open(\"attendance-oct.csv\").read())'" })).not.toBeNull();
    expect(d("Bash", { command: `ls ${dataDir}/reports` })).not.toBeNull();
    expect(d("Bash", { command: "cat ~/Downloads/*.csv" })).not.toBeNull();
    expect(d("Bash", { command: "cat *.csv" }, join(home, "Downloads"))).not.toBeNull();
  });

  it("allows unrelated shell commands", () => {
    expect(d("Bash", { command: "npm test" })).toBeNull();
    expect(d("Bash", { command: "cat *.csv" }, "/work/project")).toBeNull();
    expect(d("Glob", { pattern: "**/*.csv" })).toBeNull();
  });

  it("runs as a hook: denies with JSON on stdout, silent otherwise", async () => {
    const dir = tempDir();
    const script = join(dir, "guard.js");
    await build({ entryPoints: ["src/guard.ts"], outfile: script, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
    writeFileSync(join(dir, "loaded-exports.json"), JSON.stringify({ paths: [exportFile] }));
    const run = (input: object) => spawnSync(process.execPath, [script], {
      input: JSON.stringify(input), env: { ...process.env, MAT_DATA_DIR: dir }, encoding: "utf8",
    });
    const denied = run({ tool_name: "Read", tool_input: { file_path: exportFile }, cwd: "/" });
    expect(denied.status).toBe(0);
    expect(JSON.parse(denied.stdout).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(run({ tool_name: "Read", tool_input: { file_path: "/etc/hosts" }, cwd: "/" }).stdout).toBe("");
    expect(run({ tool_name: "Read", tool_input: { file_path: join(dir, "reports", "r.html") }, cwd: "/" }).stdout).toContain("deny");
    expect(spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" }).stdout).toBe("");
  });
});
