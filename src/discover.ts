/**
 * Discovery: walk the given roots for `*.prompt` templates, pair each
 * with its fixtures, and enumerate existing snapshot files so `check`
 * can flag obsolete ones. Walk order is sorted at every level, so all
 * output is deterministic regardless of filesystem order.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_SUFFIX, loadFixtures } from "./fixtures.js";
import { SNAP_DIR, SNAP_SUFFIX } from "./snapshot.js";
import { TemplateError } from "./template.js";
import type { Pair } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || (name.startsWith(".") && name !== ".");
}

function walk(dir: string, templates: string[], snapshots: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new TemplateError(`cannot read directory ${dir}: ${(err as Error).message}`);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === SNAP_DIR) {
        collectSnapshots(path, snapshots);
      } else if (!shouldSkipDir(entry.name)) {
        walk(path, templates, snapshots);
      }
    } else if (entry.isFile() && entry.name.endsWith(TEMPLATE_SUFFIX)) {
      templates.push(path);
    }
  }
}

function collectSnapshots(snapDir: string, snapshots: string[]): void {
  let entries;
  try {
    entries = readdirSync(snapDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(SNAP_SUFFIX)) {
      snapshots.push(join(snapDir, entry.name));
    }
  }
}

export interface Discovered {
  /** All `*.prompt` files, sorted. */
  templates: string[];
  /** All existing `__promptsnaps__/*.snap.json` files, sorted. */
  snapshots: string[];
}

/**
 * Discover templates and snapshots under the given paths. A path may
 * be a directory (walked recursively) or a single `.prompt` file.
 */
export function discover(paths: string[]): Discovered {
  const templates: string[] = [];
  const snapshots: string[] = [];
  for (const path of paths) {
    let st;
    try {
      st = statSync(path);
    } catch {
      throw new TemplateError(`no such file or directory: ${path}`);
    }
    if (st.isDirectory()) {
      walk(path, templates, snapshots);
    } else if (path.endsWith(TEMPLATE_SUFFIX)) {
      templates.push(path);
    } else {
      throw new TemplateError(`not a ${TEMPLATE_SUFFIX} file: ${path}`);
    }
  }
  templates.sort();
  snapshots.sort();
  return { templates: dedupe(templates), snapshots: dedupe(snapshots) };
}

function dedupe(sorted: string[]): string[] {
  return sorted.filter((v, i) => i === 0 || v !== sorted[i - 1]);
}

/** Expand discovered templates into (template, fixture) pairs. */
export function collectPairs(templates: string[]): Pair[] {
  const pairs: Pair[] = [];
  for (const templatePath of templates) {
    for (const fixture of loadFixtures(templatePath)) {
      pairs.push({ templatePath, fixture });
    }
  }
  return pairs;
}
