#!/usr/bin/env node
// Claude Code PreToolUse hook: keep Claude's own file tools away from the member data this plugin loaded.
// It denies Read/Grep/Bash access to (1) any export loaded with load_exports, (2) anything in the plugin's data
// folder (reports with names live there), and (3) wildcard reads of CSV/Excel files in a folder that holds a
// loaded export. Everything else is allowed. It is a guard rail, not a sandbox: see the README.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { configFromEnv, REGISTRY } from "./config.js";

export interface HookInput { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string }

const REASON = "This file holds member data loaded by Mindbody Attendance Trends. Claude does not read it directly; " +
  "use the slipping_regulars tool (codes and counts) or open_report (names, in the browser).";

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Both the absolute form and the ~ form of a path, so "~/Downloads/x.csv" is caught too. */
function spellings(path: string): string[] {
  const home = homedir();
  return inside(path, home) && path !== home ? [path, "~" + path.slice(home.length), "$HOME" + path.slice(home.length)] : [path];
}

export function decide(input: HookInput, dataDir: string, loaded: string[]): string | null {
  const tool = input.tool_name ?? "";
  const args = input.tool_input ?? {};
  const cwd = input.cwd || process.cwd();
  const expand = (p: string) => resolve(cwd, p.startsWith("~/") ? homedir() + p.slice(1) : p);
  const isProtected = (p: string) => loaded.includes(p) || inside(p, dataDir);

  if (tool === "Read" || tool === "NotebookRead") {
    const p = typeof args.file_path === "string" ? expand(args.file_path) : null;
    return p && isProtected(p) ? REASON : null;
  }
  if (tool === "Grep") {
    const p = typeof args.path === "string" ? expand(args.path) : cwd;
    // A search rooted at an export, in the data folder, or over a folder that contains an export.
    if (isProtected(p) || inside(dataDir, p) || loaded.some((f) => inside(f, p))) return REASON;
    return null;
  }
  if (tool === "Bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const mentions = [...loaded.flatMap(spellings), ...loaded.map((f) => basename(f)), ...spellings(dataDir)];
    if (mentions.some((m) => m && command.includes(m))) return REASON;
    const wildcard = /\*[^\s/]*\.(csv|xlsx|xls)\b|\*\s*$|\*(\s|;|\||&)/i.test(command);
    if (wildcard) {
      const dirs = [...new Set(loaded.map(dirname))];
      if (dirs.some((d) => inside(cwd, d) && inside(d, cwd)) || dirs.flatMap(spellings).some((d) => command.includes(d))) return REASON;
    }
    return null;
  }
  return null;
}

function loadedPaths(dataDir: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(resolve(dataDir, REGISTRY), "utf8")) as { paths?: unknown };
    return Array.isArray(parsed.paths) ? parsed.paths.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input: HookInput;
  try { input = JSON.parse(raw) as HookInput; } catch { return; }
  const dataDir = resolve(configFromEnv().dataDir);
  const reason = decide(input, dataDir, loadedPaths(dataDir));
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }));
  }
}

if (process.argv[1] && /guard\.(js|ts|mjs)$/.test(process.argv[1])) void main();
