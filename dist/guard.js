#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/guard.ts
import { readFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

// src/config.ts
import { homedir } from "node:os";
import { join } from "node:path";
var REGISTRY = "loaded-exports.json";
var truthy = (v) => /^(1|true|yes|on)$/i.test((v ?? "").trim());
var set = (v) => Boolean(v?.trim()) && !v.includes("${");
function configFromEnv(env = process.env) {
  const dataDir = set(env.MAT_DATA_DIR) ? env.MAT_DATA_DIR : set(env.CLAUDE_PLUGIN_DATA) ? env.CLAUDE_PLUGIN_DATA : join(homedir(), ".mindbody-attendance-trends");
  const share = set(env.MAT_SHARE_NAMES) ? env.MAT_SHARE_NAMES : env.CLAUDE_PLUGIN_OPTION_SHARE_NAMES_WITH_CLAUDE;
  return { shareNames: truthy(share), dataDir, openBrowser: env.MAT_NO_OPEN === void 0 };
}

// src/guard.ts
var REASON = "This file holds member data loaded by Mindbody Attendance Trends. Claude does not read it directly; use the slipping_regulars tool (codes and counts) or open_report (names, in the browser).";
function inside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function spellings(path) {
  const home = homedir2();
  return inside(path, home) && path !== home ? [path, "~" + path.slice(home.length), "$HOME" + path.slice(home.length)] : [path];
}
function decide(input, dataDir, loaded) {
  const tool = input.tool_name ?? "";
  const args = input.tool_input ?? {};
  const cwd = input.cwd || process.cwd();
  const expand = (p) => resolve(cwd, p.startsWith("~/") ? homedir2() + p.slice(1) : p);
  const isProtected = (p) => loaded.includes(p) || inside(p, dataDir);
  if (tool === "Read" || tool === "NotebookRead") {
    const p = typeof args.file_path === "string" ? expand(args.file_path) : null;
    return p && isProtected(p) ? REASON : null;
  }
  if (tool === "Grep") {
    const p = typeof args.path === "string" ? expand(args.path) : cwd;
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
function loadedPaths(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(resolve(dataDir, REGISTRY), "utf8"));
    return Array.isArray(parsed.paths) ? parsed.paths.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const dataDir = resolve(configFromEnv().dataDir);
  const reason = decide(input, dataDir, loadedPaths(dataDir));
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }
    }));
  }
}
if (process.argv[1] && /guard\.(js|ts|mjs)$/.test(process.argv[1])) void main();
export {
  decide
};
