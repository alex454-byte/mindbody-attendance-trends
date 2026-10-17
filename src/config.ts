// Settings shared by the MCP server and the Claude Code hook. Both must agree on the data folder.
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** When true, slipping_regulars includes names. Off by default. */
  shareNames: boolean;
  /** Where reports and the list of loaded paths go. */
  dataDir: string;
  openBrowser: boolean;
}

/** Paths only, so the Claude Code plugin's hook can refuse to read loaded exports. */
export const REGISTRY = "loaded-exports.json";

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());
// A host that could not fill a placeholder may pass "${...}" through literally; treat that as unset.
const set = (v: string | undefined): v is string => Boolean(v?.trim()) && !v!.includes("${");

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = set(env.MAT_DATA_DIR) ? env.MAT_DATA_DIR
    : set(env.CLAUDE_PLUGIN_DATA) ? env.CLAUDE_PLUGIN_DATA : join(homedir(), ".mindbody-attendance-trends");
  const share = set(env.MAT_SHARE_NAMES) ? env.MAT_SHARE_NAMES : env.CLAUDE_PLUGIN_OPTION_SHARE_NAMES_WITH_CLAUDE;
  return { shareNames: truthy(share), dataDir, openBrowser: env.MAT_NO_OPEN === undefined };
}
