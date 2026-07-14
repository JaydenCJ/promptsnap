// CLI integration: the snap → edit → check workflow end to end via the
// built binary, plus exit codes, JSON output and error handling.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROOT,
  TRIAGE_FIXTURES,
  TRIAGE_PROMPT,
  runCli,
  workspace,
} from "./helpers.mjs";

function triageWorkspace() {
  return workspace({
    "prompts/triage.prompt": TRIAGE_PROMPT,
    "prompts/triage.fixtures.json": TRIAGE_FIXTURES,
  });
}

test("--version prints the package.json version", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const { status, stdout } = runCli(["--version"]);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test("--help documents every command and exit code; bare invocation exits 2", () => {
  const { status, stdout } = runCli(["--help"]);
  assert.equal(status, 0);
  for (const word of ["snap", "check", "render", "ls", "--update", "--prune", "Exit codes"]) {
    assert.ok(stdout.includes(word), `--help missing ${word}`);
  }
  assert.equal(runCli([]).status, 2);
});

test("unknown commands and unknown flags exit 2 with a message on stderr", () => {
  const bad = runCli(["frobnicate"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command "frobnicate"/);
  const dir = triageWorkspace();
  const flag = runCli(["check", ".", "--updaet"], dir);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /unknown flag --updaet/);
});

test("snap writes one snapshot per template × fixture and is idempotent", () => {
  const dir = triageWorkspace();
  const first = runCli(["snap", "."], dir);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /2 written, 0 unchanged · 2 pairs/);
  const vip = join(dir, "prompts", "__promptsnaps__", "triage.vip-outage.snap.json");
  assert.ok(existsSync(vip));
  const doc = JSON.parse(readFileSync(vip, "utf8"));
  assert.equal(doc.promptsnap, 1);
  assert.equal(doc.messages[0].role, "system");
  assert.match(doc.messages[0].content, /ENTERPRISE plan/);

  const second = runCli(["snap", "."], dir);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /0 unchanged|2 unchanged/);
  assert.match(second.stdout, /2 unchanged · 2 pairs/);
});

test("check passes after snap, then fails with a line diff after a template edit", () => {
  const dir = triageWorkspace();
  runCli(["snap", "."], dir);
  const ok = runCli(["check", "."], dir);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /2 matched · 2 pairs/);

  const tpl = join(dir, "prompts", "triage.prompt");
  writeFileSync(tpl, readFileSync(tpl, "utf8").replace("support triage agent", "triage bot"), "utf8");
  const drift = runCli(["check", "."], dir);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /message\[0\] system — content changed/);
  assert.match(drift.stdout, /-You are a support triage agent for Acme Cloud\./);
  assert.match(drift.stdout, /\+You are a triage bot for Acme Cloud\./);
  assert.match(drift.stdout, /2 mismatched/);
});

test("a fixture edit drifts only the pairs it feeds", () => {
  const dir = triageWorkspace();
  runCli(["snap", "."], dir);
  const fx = join(dir, "prompts", "triage.fixtures.json");
  const doc = JSON.parse(readFileSync(fx, "utf8"));
  doc["vip-outage"].ticket.subject = "Dashboard STILL down";
  writeFileSync(fx, JSON.stringify(doc, null, 2), "utf8");
  const drift = runCli(["check", "."], dir);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /✓ .*triage\.prompt · free-question/);
  assert.match(drift.stdout, /✗ .*triage\.prompt · vip-outage/);
  assert.match(drift.stdout, /1 matched, 1 mismatched/);
});

test("check reports missing snapshots (exit 1) and --update writes them (exit 0)", () => {
  const dir = triageWorkspace();
  const missing = runCli(["check", "."], dir);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /2 missing/);
  assert.match(missing.stdout, /run `promptsnap snap`/);
  const update = runCli(["check", ".", "--update"], dir);
  assert.equal(update.status, 0);
  assert.equal(runCli(["check", "."], dir).status, 0);
});

test("obsolete snapshots fail check and are removed by snap --prune", () => {
  const dir = triageWorkspace();
  runCli(["snap", "."], dir);
  const stale = join(dir, "prompts", "__promptsnaps__", "triage.deleted-fixture.snap.json");
  writeFileSync(
    stale,
    JSON.stringify({ promptsnap: 1, template: "triage.prompt", fixture: "deleted-fixture", messages: [] }),
    "utf8",
  );
  const drift = runCli(["check", "."], dir);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /1 obsolete/);
  const prune = runCli(["snap", ".", "--prune"], dir);
  assert.equal(prune.status, 0);
  assert.match(prune.stdout, /pruned .*triage\.deleted-fixture\.snap\.json/);
  assert.ok(!existsSync(stale));
  assert.equal(runCli(["check", "."], dir).status, 0);
});

test("a render failure (fixture stops providing a variable) is a check error, exit 1", () => {
  const dir = triageWorkspace();
  runCli(["snap", "."], dir);
  const fx = join(dir, "prompts", "triage.fixtures.json");
  const doc = JSON.parse(readFileSync(fx, "utf8"));
  delete doc["free-question"].ticket;
  writeFileSync(fx, JSON.stringify(doc), "utf8");
  const res = runCli(["check", "."], dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /render error: .*unknown variable "ticket\.subject"/);
  assert.match(res.stdout, /1 failed to render/);
});

test("check --json is machine-readable, deterministic, and carries the diff", () => {
  const dir = triageWorkspace();
  runCli(["snap", "."], dir);
  const tpl = join(dir, "prompts", "triage.prompt");
  writeFileSync(tpl, readFileSync(tpl, "utf8").replace("Route each ticket", "Route every ticket"), "utf8");
  const a = runCli(["check", ".", "--json"], dir);
  const b = runCli(["check", ".", "--json"], dir);
  assert.equal(a.status, 1);
  assert.equal(a.stdout, b.stdout, "check --json must be deterministic");
  const doc = JSON.parse(a.stdout);
  assert.equal(doc.tool, "promptsnap");
  assert.equal(doc.ok, false);
  assert.equal(doc.summary.mismatch, 2);
  const pair = doc.pairs.find((p) => p.fixture === "vip-outage");
  assert.equal(pair.status, "mismatch");
  assert.equal(pair.diff.changed, 1);
  assert.equal(pair.diff.changes[0].kind, "content");
});

test("render prints one fixture's exact messages; --json emits the raw array", () => {
  const dir = triageWorkspace();
  const tpl = join(dir, "prompts", "triage.prompt");
  const text = runCli(["render", tpl, "--fixture", "vip-outage"], dir);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /\[0\] system/);
  assert.match(text.stdout, /ENTERPRISE plan/);
  const json = runCli(["render", tpl, "--fixture", "free-question", "--json"], dir);
  const msgs = JSON.parse(json.stdout);
  assert.deepEqual(msgs.map((m) => m.role), ["system", "user"]);
  assert.ok(!msgs[0].content.includes("plan"), "the #if branch must be absent");
  // Ambiguous fixture choice and unknown fixture names are usage errors.
  assert.equal(runCli(["render", tpl], dir).status, 2);
  const unknown = runCli(["render", tpl, "--fixture", "nope"], dir);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /available: free-question, vip-outage/);
});

test("render --vars uses a raw variables file; ls lists pairs and snapshot state", () => {
  const dir = triageWorkspace();
  writeFileSync(
    join(dir, "vars.json"),
    JSON.stringify({
      product: { name: "Other Corp" },
      queues: ["a"],
      customer: { vip: false },
      ticket: { subject: "s", body: "b" },
    }),
    "utf8",
  );
  const res = runCli(["render", "prompts/triage.prompt", "--vars", "vars.json"], dir);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Other Corp/);

  const ls = runCli(["ls", "."], dir);
  assert.equal(ls.status, 0);
  assert.match(ls.stdout, /vip-outage · no snapshot/);
  runCli(["snap", "."], dir);
  assert.match(runCli(["ls", "."], dir).stdout, /vip-outage · snapshotted/);
  assert.match(runCli(["ls", "."], dir).stdout, /1 template, 2 pairs/);
});
