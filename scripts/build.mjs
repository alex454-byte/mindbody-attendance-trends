// Bundle the server and the hook into single files, so neither the .mcpb nor the plugin needs node_modules.
import { build } from "esbuild";

const shared = {
  bundle: true, platform: "node", target: "node20", format: "esm", legalComments: "linked", logLevel: "info",
  // Some dependencies are CommonJS and call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/server.js" });
await build({ ...shared, entryPoints: ["src/guard.ts"], outfile: "dist/guard.js" });
