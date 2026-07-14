/**
 * Snapshot files. One snapshot per (template, fixture) pair, written
 * next to the template under `__promptsnaps__/`:
 *
 *   prompts/triage.prompt
 *   prompts/triage.fixtures.json
 *   prompts/__promptsnaps__/triage.vip-customer.snap.json
 *
 * Serialization is deterministic — fixed key order, two-space indent,
 * trailing newline — so `git diff` on a snapshot shows exactly the
 * prompt change and nothing else.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { TEMPLATE_SUFFIX } from "./fixtures.js";
import { TemplateError } from "./template.js";
import type { Message, Snapshot } from "./types.js";

export const SNAP_DIR = "__promptsnaps__";
export const SNAP_SUFFIX = ".snap.json";

/** `dir/name.prompt` + `vip` → `dir/__promptsnaps__/name.vip.snap.json`. */
export function snapshotPathFor(templatePath: string, fixtureName: string): string {
  const base = basename(templatePath, TEMPLATE_SUFFIX);
  return join(dirname(templatePath), SNAP_DIR, `${base}.${fixtureName}${SNAP_SUFFIX}`);
}

/** Build the snapshot document for a rendered pair. */
export function makeSnapshot(
  templatePath: string,
  fixtureName: string,
  messages: Message[],
): Snapshot {
  return {
    promptsnap: 1,
    template: basename(templatePath),
    fixture: fixtureName,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

/** Deterministic serialization: fixed key order, 2-space indent, final \n. */
export function serializeSnapshot(snap: Snapshot): string {
  const doc = {
    promptsnap: snap.promptsnap,
    template: snap.template,
    fixture: snap.fixture,
    messages: snap.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/** Parse + validate a snapshot document read from disk. */
export function parseSnapshot(src: string, path: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(src);
  } catch (err) {
    throw new TemplateError(`${path}: not valid JSON — ${(err as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new TemplateError(`${path}: snapshot must be a JSON object`);
  }
  const d = doc as Record<string, unknown>;
  if (d["promptsnap"] !== 1) {
    throw new TemplateError(
      `${path}: unsupported snapshot format version ${JSON.stringify(d["promptsnap"])} (this build reads version 1)`,
    );
  }
  if (typeof d["template"] !== "string" || typeof d["fixture"] !== "string") {
    throw new TemplateError(`${path}: snapshot is missing "template"/"fixture" fields`);
  }
  if (!Array.isArray(d["messages"])) {
    throw new TemplateError(`${path}: snapshot "messages" must be an array`);
  }
  const messages: Message[] = d["messages"].map((m, i) => {
    if (
      typeof m !== "object" ||
      m === null ||
      typeof (m as Record<string, unknown>)["role"] !== "string" ||
      typeof (m as Record<string, unknown>)["content"] !== "string"
    ) {
      throw new TemplateError(
        `${path}: message ${i} must be { "role": string, "content": string }`,
      );
    }
    const msg = m as { role: string; content: string };
    return { role: msg.role, content: msg.content };
  });
  return {
    promptsnap: 1,
    template: d["template"],
    fixture: d["fixture"],
    messages,
  };
}

/** Read + parse a snapshot file; returns null when it does not exist. */
export function readSnapshot(path: string): Snapshot | null {
  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return parseSnapshot(src, path);
}

/** Byte-exact equality of two message arrays. */
export function messagesEqual(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Message;
    const y = b[i] as Message;
    if (x.role !== y.role || x.content !== y.content) return false;
  }
  return true;
}
