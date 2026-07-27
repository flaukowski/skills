#!/usr/bin/env node
/**
 * audit — the publish gate.
 *
 * Every rule here exists because it caught a real defect in a skill that was
 * already public. This runs on every PR; nothing gets published past it.
 *
 *   node scripts/audit.mjs [--json]
 *
 * Exit 0 clean, 1 if any ERROR. Warnings never fail the build.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKILLS = join(ROOT, "skills");
const asJson = process.argv.includes("--json");

/**
 * Leakage patterns. A skill is read by strangers on their own machines, so
 * anything naming our hosts, our home directories, or our credential files is
 * both a disclosure and simply wrong for the reader.
 */
const LEAKS = [
  { re: /C:\\+Users\\+(?!<)[A-Za-z0-9_.-]+/g, msg: "operator home path — use an env var or ~/ form", level: "error" },
  { re: /\/home\/(?!<)(opc|ubuntu|ec2-user)\b/g, msg: "server home path", level: "error" },
  { re: /\b(?:170\.9|163\.192|10\.0\.0|192\.168)\.\d+\.\d+/g, msg: "infrastructure IP", level: "error" },
  { re: /~\/\.[a-z0-9-]*(?:credentials|secret|token)[a-z0-9-]*\.json/gi, msg: "credential file location", level: "error" },
  { re: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|\bnsec1[02-9ac-hj-np-z]{20,}/g, msg: "LIVE SECRET", level: "error" },
  { re: /\bssh\s+-i\s+\S|\bscp\s+-i\s+\S/g, msg: "ssh/scp with an explicit key path", level: "error" },
  { re: /\bid_(?:rsa|ed25519)\b|\.pem\b/g, msg: "key material reference", level: "warn" },
];

/**
 * A skill must not ship someone else's infrastructure as a connect target.
 *
 * Matching "default" next to a URL is too narrow — the case that motivated this
 * rule was a markdown table row, where the variable name and its value sit in
 * separate cells. So instead: any transport-protocol URL pointing at a remote
 * host is an error, wherever it appears. These schemes are always something the
 * reader's process connects to and publishes on.
 *
 * https:// is deliberately NOT included. Naming a public read-only service (a
 * stream, a dashboard, a docs site) is fine and often the point.
 */
const SHARED_DEFAULT = {
  re: /\b(?:nats|amqp|amqps|redis|rediss|postgres|postgresql|mysql|mongodb|mqtt|ws|wss):\/\/[^\s`'"|)]+/gi,
  msg: "remote transport endpoint — readers would connect to infrastructure they do not control",
};

function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  return text.slice(3, end);
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const findings = [];
const add = (skill, level, line, msg, sample) =>
  findings.push({ skill, level, line, msg, sample: (sample || "").slice(0, 60) });

if (!existsSync(SKILLS)) {
  console.error(`no skills/ directory at ${SKILLS}`);
  process.exit(1);
}

const slugs = readdirSync(SKILLS).filter((d) => statSync(join(SKILLS, d)).isDirectory());

for (const slug of slugs) {
  const file = join(SKILLS, slug, "SKILL.md");
  if (!existsSync(file)) {
    add(slug, "error", 0, "no SKILL.md");
    continue;
  }
  const text = readFileSync(file, "utf8");

  // 1. Frontmatter. Without name+description the skill cannot be discovered at
  //    all — this is exactly how two kannaka skills shipped dead.
  const fm = frontmatter(text);
  if (fm === null) {
    add(slug, "error", 1, "no YAML frontmatter — the skill cannot be discovered");
  } else {
    if (!/^name:\s*\S/m.test(fm)) add(slug, "error", 1, "frontmatter has no name:");
    if (!/^description:\s*[\S>|]/m.test(fm)) add(slug, "error", 1, "frontmatter has no description:");
    const nameMatch = fm.match(/^name:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/m);
    if (nameMatch && nameMatch[1] !== slug) {
      add(slug, "warn", 1, `frontmatter name "${nameMatch[1]}" differs from directory slug`);
    }
  }

  // 2. Leakage.
  for (const { re, msg, level } of LEAKS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      add(slug, level, lineOf(text, m.index), msg, m[0]);
      break; // one report per pattern per skill is enough to act on
    }
  }

  // 3. Shared infrastructure as a default.
  SHARED_DEFAULT.re.lastIndex = 0;
  let s;
  while ((s = SHARED_DEFAULT.re.exec(text)) !== null) {
    if (/localhost|127\.0\.0\.1|example\.(com|org)|<[a-z-]+>/i.test(s[0])) continue;
    add(slug, "error", lineOf(text, s.index), SHARED_DEFAULT.msg, s[0]);
    break;
  }
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (asJson) {
  console.log(JSON.stringify({ skills: slugs.length, errors, warns }, null, 2));
} else {
  console.log(`\naudited ${slugs.length} skills\n`);
  for (const f of [...errors, ...warns]) {
    const tag = f.level === "error" ? "ERROR" : "warn ";
    console.log(`  ${tag}  ${f.skill}:${f.line}  ${f.msg}${f.sample ? `  [${f.sample}]` : ""}`);
  }
  if (!findings.length) console.log("  clean");
  console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
}

process.exit(errors.length ? 1 : 0);
