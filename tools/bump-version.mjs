/**
 * Increment patch in ../oh-version.js and `git add` it (for .githooks/pre-commit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const file = path.join(root, "oh-version.js");

let s = fs.readFileSync(file, "utf8");
const re = /window\.OH_CREDITS_VERSION\s*=\s*"(\d+)\.(\d+)\.(\d+)"/;
const m = s.match(re);
if (!m) {
  console.error("bump-version: could not find window.OH_CREDITS_VERSION = \"x.y.z\" in oh-version.js");
  process.exit(1);
}
const major = parseInt(m[1], 10);
const minor = parseInt(m[2], 10);
const patch = parseInt(m[3], 10) + 1;
const next = `${major}.${minor}.${patch}`;
s = s.replace(re, `window.OH_CREDITS_VERSION = "${next}"`);
fs.writeFileSync(file, s, "utf8");
console.log(`oh-version.js → ${next}`);

try {
  execSync("git add oh-version.js", { cwd: root, stdio: "inherit" });
} catch {
  console.warn("bump-version: git add oh-version.js failed (not a git repo or git missing); file still updated.");
}
