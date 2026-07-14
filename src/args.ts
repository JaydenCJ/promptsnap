/**
 * A tiny, strict flag parser. Unknown flags are errors (exit 2 in the
 * CLI) — a snapshot tool that silently ignores `--updaet` would defeat
 * its own purpose. Supports `--flag`, `--flag value` and `--flag=value`.
 */
import { TemplateError } from "./template.js";

export interface FlagSpec {
  /** Flag name without dashes, e.g. "update". */
  name: string;
  /** Does the flag take a value? */
  takesValue: boolean;
  /** Optional short alias, e.g. "u". */
  short?: string;
}

export interface ParsedArgs {
  flags: Map<string, string | true>;
  positionals: string[];
}

export class UsageError extends TemplateError {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: string[], specs: FlagSpec[]): ParsedArgs {
  const byName = new Map<string, FlagSpec>();
  for (const spec of specs) {
    byName.set("--" + spec.name, spec);
    if (spec.short) byName.set("-" + spec.short, spec);
  }
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const spec = byName.get(key);
    if (!spec) {
      throw new UsageError(`unknown flag ${key} (see --help)`);
    }
    if (!spec.takesValue) {
      if (eq !== -1) throw new UsageError(`flag --${spec.name} takes no value`);
      flags.set(spec.name, true);
      continue;
    }
    let value: string;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new UsageError(`flag --${spec.name} needs a value`);
      }
      value = next;
      i++;
    }
    flags.set(spec.name, value);
  }
  return { flags, positionals };
}
