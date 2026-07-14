#!/usr/bin/env node
/**
 * The promptsnap CLI: `snap` (write snapshots), `check` (compare and
 * fail on drift), `render` (inspect one pair) and `ls` (list what was
 * discovered). Exit codes are script-friendly: 0 ok, 1 drift or render
 * failure, 2 usage or input error.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { UsageError, parseArgs, type FlagSpec } from "./args.js";
import { diffMessages } from "./diff.js";
import { collectPairs, discover } from "./discover.js";
import { loadFixtures } from "./fixtures.js";
import { parsePromptSource } from "./promptfile.js";
import { renderPrompt } from "./render.js";
import {
  countNoun,
  formatDiff,
  formatMessages,
  pairLabel,
  palette,
  statusGlyph,
  type Palette,
} from "./report.js";
import {
  makeSnapshot,
  messagesEqual,
  readSnapshot,
  serializeSnapshot,
  snapshotPathFor,
} from "./snapshot.js";
import { TemplateError } from "./template.js";
import type { Message, Pair, PairResult } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `promptsnap ${VERSION} — snapshot testing for prompt templates

Usage:
  promptsnap snap  [paths…]          render every (template × fixture) pair and
                                     write __promptsnaps__/*.snap.json
  promptsnap check [paths…]          re-render and diff against the committed
                                     snapshots; fail on any drift
  promptsnap render <t.prompt>       print the rendered message array
  promptsnap ls    [paths…]          list discovered templates and fixtures

Flags:
  check   --update, -u        rewrite drifted/missing snapshots instead of failing
          --context N         diff context lines (default 2)
          --json              machine-readable report
  snap    --prune             delete obsolete snapshots (no matching pair)
  render  --fixture NAME, -f  pick a fixture by name
          --vars FILE         render with a raw JSON variables file instead
          --json              print the message array as JSON
  global  --no-color          disable ANSI colors (NO_COLOR is honored too)
          --help, --version

Exit codes:
  0  everything matches (or snapshots written)
  1  drift: mismatched, missing or obsolete snapshots, or a render error
  2  usage or input error
`;

interface Ctx {
  p: Palette;
  out: (line: string) => void;
  err: (line: string) => void;
}

function loadTemplate(path: string) {
  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${(err as Error).message}`);
  }
  return parsePromptSource(src, path);
}

function renderPair(pair: Pair): Message[] {
  const template = loadTemplate(pair.templatePath);
  return renderPrompt(template, pair.fixture.vars);
}

function rootsOf(positionals: string[]): string[] {
  return positionals.length > 0 ? positionals : ["."];
}

/** Compute check results for every pair; shared by check and check --json. */
function checkPairs(pairs: Pair[], context: number): PairResult[] {
  const results: PairResult[] = [];
  for (const pair of pairs) {
    const snapshotPath = snapshotPathFor(pair.templatePath, pair.fixture.name);
    const base = {
      templatePath: pair.templatePath,
      fixture: pair.fixture.name,
      snapshotPath,
    };
    let rendered: Message[];
    try {
      rendered = renderPair(pair);
    } catch (err) {
      if (err instanceof UsageError) throw err;
      results.push({ ...base, status: "error", error: (err as Error).message });
      continue;
    }
    const snapshot = readSnapshot(snapshotPath);
    if (snapshot === null) {
      results.push({ ...base, status: "missing" });
      continue;
    }
    if (messagesEqual(snapshot.messages, rendered)) {
      results.push({ ...base, status: "match" });
    } else {
      results.push({
        ...base,
        status: "mismatch",
        diff: diffMessages(snapshot.messages, rendered, context),
      });
    }
  }
  return results;
}

function expectedSnapshotPaths(pairs: Pair[]): Set<string> {
  return new Set(pairs.map((p) => snapshotPathFor(p.templatePath, p.fixture.name)));
}

function cmdCheck(argv: string[], ctx: Ctx): number {
  const specs: FlagSpec[] = [
    { name: "update", takesValue: false, short: "u" },
    { name: "context", takesValue: true },
    { name: "json", takesValue: false },
    { name: "no-color", takesValue: false },
  ];
  const { flags, positionals } = parseArgs(argv, specs);
  const context = parseContext(flags.get("context"));
  const { templates, snapshots } = discover(rootsOf(positionals));
  const pairs = collectPairs(templates);
  if (flags.has("update")) {
    return writeSnapshots(pairs, ctx, false);
  }
  const results = checkPairs(pairs, context);
  const expected = expectedSnapshotPaths(pairs);
  const obsolete = snapshots.filter((s) => !expected.has(s));

  if (flags.has("json")) {
    ctx.out(JSON.stringify(checkJson(results, obsolete), null, 2));
  } else {
    printCheckReport(results, obsolete, ctx);
  }
  const failed =
    results.some((r) => r.status !== "match") || obsolete.length > 0;
  return failed ? 1 : 0;
}

function checkJson(results: PairResult[], obsolete: string[]): unknown {
  const summary = { match: 0, mismatch: 0, missing: 0, error: 0, obsolete: obsolete.length };
  for (const r of results) summary[r.status]++;
  return {
    tool: "promptsnap",
    version: VERSION,
    pairs: results.map((r) => ({
      template: r.templatePath,
      fixture: r.fixture,
      snapshot: r.snapshotPath,
      status: r.status,
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(r.diff !== undefined
        ? {
            diff: {
              changed: r.diff.changed,
              added: r.diff.added,
              removed: r.diff.removed,
              changes: r.diff.changes.filter((c) => c.kind !== "same"),
            },
          }
        : {}),
    })),
    obsolete,
    summary,
    ok: summary.mismatch + summary.missing + summary.error + summary.obsolete === 0,
  };
}

function printCheckReport(results: PairResult[], obsolete: string[], ctx: Ctx): void {
  const { p } = ctx;
  for (const r of results) {
    ctx.out(`${statusGlyph(r.status, p)} ${pairLabel(r)}`);
    if (r.status === "mismatch" && r.diff) {
      ctx.out(formatDiff(r.diff, p));
    } else if (r.status === "missing") {
      ctx.out(p.dim(`  no snapshot yet — run \`promptsnap snap\` to write ${r.snapshotPath}`));
    } else if (r.status === "error") {
      ctx.out(p.red(`  render error: ${r.error}`));
    }
  }
  for (const path of obsolete) {
    ctx.out(`${statusGlyph("obsolete", p)} ${path}`);
    ctx.out(p.dim("  obsolete snapshot — no matching template × fixture; `promptsnap snap --prune` removes it"));
  }
  const counts = { match: 0, mismatch: 0, missing: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  const bits = [`${counts.match} matched`];
  if (counts.mismatch > 0) bits.push(`${counts.mismatch} mismatched`);
  if (counts.missing > 0) bits.push(`${counts.missing} missing`);
  if (counts.error > 0) bits.push(`${counts.error} failed to render`);
  if (obsolete.length > 0) bits.push(`${obsolete.length} obsolete`);
  const line = `${bits.join(", ")} · ${countNoun(results.length, "pair")}`;
  ctx.out(counts.mismatch + counts.missing + counts.error + obsolete.length > 0
    ? p.red(line)
    : p.green(line));
}

function cmdSnap(argv: string[], ctx: Ctx): number {
  const specs: FlagSpec[] = [
    { name: "prune", takesValue: false },
    { name: "no-color", takesValue: false },
  ];
  const { flags, positionals } = parseArgs(argv, specs);
  const { templates, snapshots } = discover(rootsOf(positionals));
  const pairs = collectPairs(templates);
  const code = writeSnapshots(pairs, ctx, true);
  if (flags.has("prune")) {
    const expected = expectedSnapshotPaths(pairs);
    for (const path of snapshots) {
      if (!expected.has(path)) {
        unlinkSync(path);
        ctx.out(`${statusGlyph("obsolete", ctx.p)} pruned ${path}`);
      }
    }
  }
  return code;
}

function writeSnapshots(pairs: Pair[], ctx: Ctx, announceUnchanged: boolean): number {
  const { p } = ctx;
  let written = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  for (const pair of pairs) {
    const snapshotPath = snapshotPathFor(pair.templatePath, pair.fixture.name);
    const label = pairLabel({ templatePath: pair.templatePath, fixture: pair.fixture.name });
    let rendered: Message[];
    try {
      rendered = renderPair(pair);
    } catch (err) {
      if (err instanceof UsageError) throw err;
      errors++;
      ctx.out(`${statusGlyph("error", p)} ${label}`);
      ctx.out(p.red(`  render error: ${(err as Error).message}`));
      continue;
    }
    const existing = readSnapshot(snapshotPath);
    if (existing !== null && messagesEqual(existing.messages, rendered)) {
      unchanged++;
      if (announceUnchanged) ctx.out(`${statusGlyph("unchanged", p)} ${label}`);
      continue;
    }
    const snap = makeSnapshot(pair.templatePath, pair.fixture.name, rendered);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, serializeSnapshot(snap), "utf8");
    if (existing === null) {
      written++;
      ctx.out(`${statusGlyph("written", p)} ${label} ${p.dim(`→ ${snapshotPath}`)}`);
    } else {
      updated++;
      ctx.out(`${statusGlyph("updated", p)} ${label} ${p.dim("(updated)")}`);
    }
  }
  const bits: string[] = [];
  if (written > 0) bits.push(`${written} written`);
  if (updated > 0) bits.push(`${updated} updated`);
  bits.push(`${unchanged} unchanged`);
  if (errors > 0) bits.push(`${errors} failed to render`);
  const line = `${bits.join(", ")} · ${countNoun(pairs.length, "pair")}`;
  ctx.out(errors > 0 ? p.red(line) : p.green(line));
  return errors > 0 ? 1 : 0;
}

function cmdRender(argv: string[], ctx: Ctx): number {
  const specs: FlagSpec[] = [
    { name: "fixture", takesValue: true, short: "f" },
    { name: "vars", takesValue: true },
    { name: "json", takesValue: false },
    { name: "no-color", takesValue: false },
  ];
  const { flags, positionals } = parseArgs(argv, specs);
  if (positionals.length !== 1) {
    throw new UsageError("render needs exactly one <template.prompt> argument");
  }
  const templatePath = positionals[0] as string;
  if (flags.has("fixture") && flags.has("vars")) {
    throw new UsageError("--fixture and --vars are mutually exclusive");
  }

  let vars: Record<string, unknown>;
  if (flags.has("vars")) {
    const varsPath = flags.get("vars") as string;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(varsPath, "utf8"));
    } catch (err) {
      throw new UsageError(`cannot read variables from ${varsPath}: ${(err as Error).message}`);
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      throw new UsageError(`${varsPath} must contain a JSON object of variables`);
    }
    vars = doc as Record<string, unknown>;
  } else {
    const fixtures = loadFixtures(templatePath);
    const wanted = flags.get("fixture");
    if (wanted !== undefined) {
      const found = fixtures.find((f) => f.name === wanted);
      if (!found) {
        throw new UsageError(
          `no fixture "${wanted as string}" — available: ${fixtures.map((f) => f.name).join(", ")}`,
        );
      }
      vars = found.vars;
    } else if (fixtures.length === 1) {
      vars = (fixtures[0] as { vars: Record<string, unknown> }).vars;
    } else {
      throw new UsageError(
        `template has ${fixtures.length} fixtures — pick one with --fixture (${fixtures.map((f) => f.name).join(", ")})`,
      );
    }
  }

  const template = loadTemplate(templatePath);
  const messages = renderPrompt(template, vars);
  if (flags.has("json")) {
    ctx.out(JSON.stringify(messages, null, 2));
  } else {
    ctx.out(formatMessages(messages, ctx.p));
  }
  return 0;
}

function cmdLs(argv: string[], ctx: Ctx): number {
  const specs: FlagSpec[] = [{ name: "no-color", takesValue: false }];
  const { positionals } = parseArgs(argv, specs);
  const { templates } = discover(rootsOf(positionals));
  const pairs = collectPairs(templates);
  let current = "";
  for (const pair of pairs) {
    if (pair.templatePath !== current) {
      current = pair.templatePath;
      ctx.out(ctx.p.bold(current));
    }
    const snapshotPath = snapshotPathFor(pair.templatePath, pair.fixture.name);
    const hasSnap = readSnapshot(snapshotPath) !== null;
    const tag = hasSnap ? ctx.p.green("snapshotted") : ctx.p.yellow("no snapshot");
    ctx.out(`  ${pair.fixture.name} ${ctx.p.dim("·")} ${tag}`);
  }
  ctx.out(ctx.p.dim(`${countNoun(templates.length, "template")}, ${countNoun(pairs.length, "pair")}`));
  return 0;
}

function parseContext(raw: string | true | undefined): number {
  if (raw === undefined) return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new UsageError(`--context must be an integer 0–100, got "${String(raw)}"`);
  }
  return n;
}

/** Entry point; returns the process exit code. */
export function main(argv: string[]): number {
  const noColor = argv.includes("--no-color");
  const p = palette(noColor);
  const ctx: Ctx = {
    p,
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  };

  if (argv.includes("--version") || argv[0] === "version") {
    ctx.out(VERSION);
    return 0;
  }
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") {
    ctx.out(HELP.trimEnd());
    return argv.length === 0 ? 2 : 0;
  }

  const command = argv[0] as string;
  const rest = argv.slice(1);
  try {
    switch (command) {
      case "check":
        return cmdCheck(rest, ctx);
      case "snap":
        return cmdSnap(rest, ctx);
      case "render":
        return cmdRender(rest, ctx);
      case "ls":
        return cmdLs(rest, ctx);
      default:
        throw new UsageError(`unknown command "${command}" (see --help)`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      ctx.err(`promptsnap: ${err.message}`);
      return 2;
    }
    if (err instanceof TemplateError) {
      ctx.err(`promptsnap: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

process.exitCode = main(process.argv.slice(2));
