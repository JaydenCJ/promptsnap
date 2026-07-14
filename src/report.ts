/**
 * Human output formatting for the CLI: colors (honoring NO_COLOR and
 * non-TTY pipes), the per-pair check report with unified hunks, and
 * the rendered-message pretty printer. All functions return strings —
 * only cli.ts writes to stdout/stderr.
 */
import { formatHunks } from "./diff.js";
import type { Message, MessagesDiff, PairResult } from "./types.js";

/** `1 pair`, `2 pairs` — count + noun with plain English pluralization. */
export function countNoun(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export interface Palette {
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

const PLAIN: Palette = {
  red: (s) => s,
  green: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
};

function ansi(code: number, close: number): (s: string) => string {
  return (s) => `\u001b[${code}m${s}\u001b[${close}m`;
}

const COLOR: Palette = {
  red: ansi(31, 39),
  green: ansi(32, 39),
  yellow: ansi(33, 39),
  cyan: ansi(36, 39),
  dim: ansi(2, 22),
  bold: ansi(1, 22),
};

/** Pick a palette: `--no-color`, NO_COLOR, or a piped stdout ⇒ plain. */
export function palette(noColorFlag: boolean): Palette {
  if (noColorFlag) return PLAIN;
  if (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "") return PLAIN;
  if (!process.stdout.isTTY) return PLAIN;
  return COLOR;
}

/** Pretty-print rendered messages for `promptsnap render`. */
export function formatMessages(messages: Message[], p: Palette): string {
  const out: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as Message;
    out.push(p.bold(`[${i}] ${msg.role}`));
    for (const line of msg.content.split("\n")) {
      out.push("  " + line);
    }
    if (i < messages.length - 1) out.push("");
  }
  return out.join("\n");
}

function describeChange(kind: string, oldRole?: string, newRole?: string): string {
  switch (kind) {
    case "role":
      return `role changed ${oldRole} -> ${newRole}`;
    case "content":
      return `${newRole} — content changed`;
    case "role+content":
      return `role changed ${oldRole} -> ${newRole}, content changed`;
    case "added":
      return `${newRole} — message added`;
    case "removed":
      return `${oldRole} — message removed`;
    default:
      return kind;
  }
}

/** Colorize one hunk line. */
function paintHunkLine(line: string, p: Palette): string {
  if (line.startsWith("@@")) return p.cyan(line);
  if (line.startsWith("-")) return p.red(line);
  if (line.startsWith("+")) return p.green(line);
  return p.dim(line);
}

/** The body of a mismatch report: per-message changes with hunks. */
export function formatDiff(diff: MessagesDiff, p: Palette, indent = "  "): string {
  const out: string[] = [];
  for (const change of diff.changes) {
    if (change.kind === "same") continue;
    out.push(
      indent +
        p.yellow(
          `message[${change.index}] ${describeChange(change.kind, change.oldRole, change.newRole)}`,
        ),
    );
    if (change.hunks) {
      for (const line of formatHunks(change.hunks)) {
        out.push(indent + "  " + paintHunkLine(line, p));
      }
    }
  }
  const parts: string[] = [];
  if (diff.changed > 0) parts.push(`${diff.changed} changed`);
  if (diff.added > 0) parts.push(`${diff.added} added`);
  if (diff.removed > 0) parts.push(`${diff.removed} removed`);
  out.push(indent + p.dim(`${parts.join(", ")} of ${countNoun(diff.total, "message")}`));
  return out.join("\n");
}

/** One line per pair in `check` / `snap` output. */
export function pairLabel(result: Pick<PairResult, "templatePath" | "fixture">): string {
  return `${result.templatePath} · ${result.fixture}`;
}

export function statusGlyph(status: string, p: Palette): string {
  switch (status) {
    case "match":
    case "written":
    case "updated":
      return p.green("✓");
    case "unchanged":
      return p.dim("=");
    case "mismatch":
    case "error":
      return p.red("✗");
    case "missing":
      return p.yellow("?");
    case "obsolete":
      return p.yellow("!");
    default:
      return "·";
  }
}
