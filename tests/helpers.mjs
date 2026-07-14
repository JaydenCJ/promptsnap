// Shared test helpers: a temp-workspace factory for filesystem-facing
// tests and a runner for the built CLI. Every workspace lives under a
// mkdtemp directory and is removed when the process exits, so tests
// are deterministic and leave no state behind.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "cli.js");

const created = [];
process.on("exit", () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Create a throwaway workspace populated with the given files
 * (relative path → content). Returns its absolute path.
 */
export function workspace(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "promptsnap-test-"));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return dir;
}

/** Run the built CLI; returns { status, stdout, stderr }. */
export function runCli(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A small realistic template used by several suites. */
export const TRIAGE_PROMPT = `# Support triage template.
--- system
You are a support triage agent for {{ product.name }}.
Route each ticket to one of: {{ queues | join:", " }}.
{{#if customer.vip}}
This customer is on the {{ customer.plan | upper }} plan.
{{/if}}
--- user
{{ ticket.subject }}

{{ ticket.body }}
`;

export const TRIAGE_FIXTURES = JSON.stringify(
  {
    "vip-outage": {
      product: { name: "Acme Cloud" },
      queues: ["billing", "outage", "how-to"],
      customer: { vip: true, plan: "enterprise" },
      ticket: { subject: "Dashboard down", body: "Nothing loads since 09:00 UTC." },
    },
    "free-question": {
      product: { name: "Acme Cloud" },
      queues: ["billing", "outage", "how-to"],
      customer: { vip: false },
      ticket: { subject: "Export to CSV?", body: "Can I export my data?" },
    },
  },
  null,
  2,
);
