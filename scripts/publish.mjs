#!/usr/bin/env node
/**
 * publish — push a skill to ClawHub, but never past a failing audit.
 *
 *   node scripts/publish.mjs <slug> --version 1.2.0 --changelog "..."
 *   node scripts/publish.mjs <slug> --version 1.2.0 --changelog "..." --dry-run
 *
 * The audit runs first and a failure aborts the publish — the whole point of
 * this repo is that nothing reaches the registry unaudited.
 *
 * After publishing it VERIFIES by asking the registry what it now serves.
 * `clawhub publish` has been observed reporting success while the registry kept
 * serving the previous version, so the success message alone is not evidence.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith("--"));
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const dry = argv.includes("--dry-run");

if (!slug) {
  console.error("usage: publish.mjs <slug> --version <semver> [--changelog <text>] [--dry-run]");
  process.exit(2);
}

const dir = join(ROOT, "skills", slug);
if (!existsSync(join(dir, "SKILL.md"))) {
  console.error(`no such skill: skills/${slug}/SKILL.md`);
  process.exit(2);
}

const manifestPath = join(ROOT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = manifest.skills[slug];
if (!entry) {
  console.error(`${slug} is not in manifest.json — add it first`);
  process.exit(2);
}

const version = flag("version");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`--version must be semver (current published: ${entry.publishedVersion})`);
  process.exit(2);
}

// 1. Gate.
console.log("running audit...");
try {
  execFileSync("node", [join(ROOT, "scripts", "audit.mjs")], { stdio: "inherit" });
} catch {
  console.error("\naudit failed — not publishing");
  process.exit(1);
}

if (dry) {
  console.log(`\n[dry run] would publish ${slug}@${version} from ${dir}`);
  process.exit(0);
}

// 2. Publish. clawhub wants an absolute path with forward slashes on Windows.
const args = ["publish", dir.replace(/\\/g, "/"), "--slug", slug, "--version", version, "--tags", "latest"];
const changelog = flag("changelog");
if (changelog) args.push("--changelog", changelog);

console.log(`\npublishing ${slug}@${version}...`);
// On Windows `clawhub` is a .cmd shim, which execFile cannot resolve on its
// own — hence shell:true. Args are ours, not user input.
execFileSync("clawhub", args, { stdio: "inherit", shell: process.platform === "win32" });

// 3. Verify — the registry is the authority, not the CLI's exit message.
//
// Publishing is EVENTUALLY consistent: the CLI returns as soon as the upload is
// accepted, and the version shows up in the registry a few minutes later. So
// poll rather than checking once. A single immediate check reads as "the CLI
// lied" when in fact the write simply had not landed yet.
const DEADLINE_MS = 8 * 60 * 1000;
const EVERY_MS = 20 * 1000;
const started = Date.now();
let live = [];

console.log("\nwaiting for the registry to serve it (publishes are async)...");
while (Date.now() - started < DEADLINE_MS) {
  const res = await fetch(`${manifest.registry}/api/v1/skills/${slug}/versions?cb=${Date.now()}`);
  live = (await res.json()).items?.map((i) => i.version) ?? [];
  if (live.includes(version)) break;
  process.stdout.write(`  not yet (${Math.round((Date.now() - started) / 1000)}s), retrying\n`);
  await new Promise((r) => setTimeout(r, EVERY_MS));
}

if (live.includes(version)) {
  console.log(`confirmed: registry serves ${version}`);
  entry.publishedVersion = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("manifest updated");
} else {
  console.error(`still not live after ${DEADLINE_MS / 60000} min; registry lists [${live.join(", ")}]`);
  console.error("It may yet appear — re-check before republishing, so you do not burn a version number.");
  console.error("Manifest left unchanged.");
  process.exit(1);
}
