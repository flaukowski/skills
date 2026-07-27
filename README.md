# skills

Every Claude Code skill published to [ClawHub](https://clawhub.ai/nickflach) under
`nickflach`, in one place, with a gate in front of the registry.

## Why this repo exists

The skills used to live across thirteen repositories in three different layouts
(`workspace/skills/`, `skills/`, `plugins/*/skills/`), and two were published
directly to the registry with no repository at all. Nothing checked them. That
produced, all of it live and public:

- two skills with **no YAML frontmatter**, so Claude Code could not discover them
- **operator home paths** (`C:\Users\<user>\...`) baked into a public repo
- two skills documenting a **shared NATS bus as the default**, so anyone who
  installed them pointed their agent at infrastructure they did not control
- a public skill documenting a **private pipeline** — script names, credential
  file locations, host deploy steps
- `kannaka-memory` published twice under different slugs, drifting to **v3.1.0
  and v2.6.0** with dozens of installs stuck on the stale copy

Every one of those is now a rule in `scripts/audit.mjs`, and the audit runs on
every pull request.

## Layout

```
skills/<slug>/SKILL.md   one directory per published slug
manifest.json            slug -> published version, where it was imported from
scripts/audit.mjs        the gate
scripts/publish.mjs      audited publish, verified against the registry
```

The directory name is the registry slug. `manifest.json` records the version the
registry currently serves, so drift between "what is here" and "what is
published" is visible rather than assumed.

## Working on a skill

```bash
node scripts/audit.mjs                 # everything
node scripts/audit.mjs --json          # machine-readable

node scripts/publish.mjs <slug> --version 1.2.0 --changelog "..." --dry-run
node scripts/publish.mjs <slug> --version 1.2.0 --changelog "..."
```

`publish.mjs` refuses to publish if the audit fails, and afterwards polls the
registry until it actually serves the new version.

**Publishing is eventually consistent.** `clawhub publish` returns as soon as the
upload is accepted; the version appears in the registry a few minutes later. A
single immediate check reads as "the CLI lied" when the write simply has not
landed yet — so `publish.mjs` polls for up to eight minutes and only then updates
`manifest.json`. If it times out, re-check before republishing rather than
burning another version number.

## What the audit enforces

| Rule | Level | Why |
|---|---|---|
| frontmatter with `name` and `description` | error | without it the skill cannot be discovered at all |
| no `C:\Users\<user>` or `/home/<user>` paths | error | wrong on every machine but one, and a disclosure |
| no infrastructure IPs | error | same |
| no credential file locations | error | tells a reader where to look |
| no live secrets (tokens, `nsec1…`, `sk-…`) | error | obvious |
| no `ssh -i` / `scp -i` with a key path | error | operator wiring |
| no remote `nats://`, `wss://`, `postgres://`… endpoints | error | a reader's process would connect to and publish on someone else's infrastructure |
| `name:` should match the directory slug | warn | usually a rename that was only half done |

`https://` URLs are deliberately allowed. Naming a public read-only service — a
stream, a dashboard, a docs site — is fine and often the point. What is not fine
is pre-wiring someone's agent to a bus we control.

## Adding a skill

1. `skills/<slug>/SKILL.md`, with `name` and `description` frontmatter.
2. Add the slug to `manifest.json`.
3. `node scripts/audit.mjs`.
4. Open a PR. CI runs the audit and checks the manifest against `skills/`.
5. After merge, `node scripts/publish.mjs <slug> --version <semver>`.

## Known follow-ups

- `skill-kannaka-memory` (2.6.0) and `skill-kannaka-radio` (2.0.1) are superseded
  by `kannaka-memory` (3.1.0) and `kannaka-radio` (3.0.0). They still have live
  installs, so they need either a content refresh or a deprecation pointer —
  not silent abandonment.
- Two ClawHub publishers now exist: `nickflach`, which owns all 14 skills and
  their download history, and a new empty `flaukowski`. Publishing new work under
  the second one splits the namespace, so decide deliberately which owns what.
