#!/usr/bin/env node
/**
 * Create local folders the renderer expects. Idempotent: never overwrites.
 *
 *   node generator/tools/init.js
 *   node generator/tools/init.js 2026-fall
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const EXAMPLE = path.join(ROOT, "generator", "examples", "config.json");

function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
  console.log(`dir  ${path.relative(ROOT, p) || "."}`);
}

function writeIfMissing(dest, src) {
  if (fs.existsSync(dest)) {
    console.log(`keep ${path.relative(ROOT, dest)}`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`file ${path.relative(ROOT, dest)}`);
}

const season = process.argv[2];
if (season && /[\\/]/.test(season)) {
  console.error("season id should be a single folder name, e.g. 2026-fall");
  process.exit(1);
}

mkdir(path.join(ROOT, "shared", "originals"));
mkdir(path.join(ROOT, "shared", "fonts", "vendor"));
mkdir(path.join(ROOT, "challenges"));

if (season) {
  const dir = path.join(ROOT, "challenges", season);
  mkdir(path.join(dir, "source"));
  mkdir(path.join(dir, "covers"));
  mkdir(path.join(dir, "bookmarks"));
  mkdir(path.join(dir, "output"));
  writeIfMissing(path.join(dir, "config.json"), EXAMPLE);
}

console.log("");
console.log("Next:");
if (season) {
  console.log(`  1. Save the Goodreads challenge page as a Web Archive into challenges/${season}/source/`);
  console.log("  2. Drop Goodreads-logo.png (the beige g) into shared/originals/");
  console.log("     then: generator/.venv/bin/python generator/tools/prep_assets.py");
  console.log(`  3. generator/.venv/bin/python generator/tools/ingest.py challenges/${season}`);
  console.log("  4. Edit config.json, drop jackets in covers/");
  console.log(`  5. node generator/render.js challenges/${season}`);
} else {
  console.log("  node generator/tools/init.js <season-id>   # e.g. 2026-fall");
}
