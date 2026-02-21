import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

const repoRoot = process.cwd();
const entry = path.join(repoRoot, "src", "main.ts");
const outdir = path.join(repoRoot, "deploy");
const outfile = path.join(outdir, "code.js");

fs.mkdirSync(outdir, { recursive: true });
fs.copyFileSync(path.join(repoRoot, "appsscript.json"), path.join(outdir, "appsscript.json"));

/**
 * Bundle for Google Apps Script:
 * - single file output (deploy/code.js)
 * - then unwrap the outer IIFE so functions are top-level (Apps Script can list/execute them)
 */
const buildOptions = {
  entryPoints: [entry],
  bundle: true,
  platform: "neutral",
  format: "iife",
  target: ["es2019"],
  outfile,
  sourcemap: false,
  minify: false,
  treeShaking: false,
  logLevel: "info",
  banner: {
    js: "/* Bundled with esbuild for Google Apps Script */\n",
  },
};

function unwrapIife(file) {
  const s = fs.readFileSync(file, "utf8");
  // Best-effort unwrap for esbuild's standard wrapper: (() => { ... })();
  const m = s.match(/^([\s\S]*?)\(\(\)\s*=>\s*\{\n([\s\S]*?)\n\}\)\(\);\s*$/);
  if (!m) return;
  const prefix = m[1];
  const body = m[2];
  fs.writeFileSync(file, `${prefix}${body}\n`, "utf8");
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  // Unwrap once initially (subsequent rebuilds will re-wrap; keeping watch simple)
  unwrapIife(outfile);
  console.log(`Watching… output -> ${path.relative(repoRoot, outfile)}`);
} else {
  await esbuild.build(buildOptions);
  unwrapIife(outfile);
}
