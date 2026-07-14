/**
 * Fixture loading. Each template `name.prompt` pairs with an optional
 * `name.fixtures.json` in the same directory:
 *
 *   { "vip-customer": { "user": { "vip": true }, … },
 *     "free-tier":    { … } }
 *
 * Every top-level key is one named variable set, and every
 * (template, fixture) pair produces exactly one snapshot. When no
 * fixtures file exists the template gets a single implicit fixture
 * named `default` with no variables — a template that needs none just
 * works, and one that does fails loudly at render time.
 */
import { readFileSync } from "node:fs";
import { TemplateError } from "./template.js";
import type { Fixture } from "./types.js";

/** Fixture names become part of the snapshot filename, so keep them tame. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const FIXTURES_SUFFIX = ".fixtures.json";
export const TEMPLATE_SUFFIX = ".prompt";

/** `dir/name.prompt` → `dir/name.fixtures.json`. */
export function fixturesPathFor(templatePath: string): string {
  return templatePath.slice(0, -TEMPLATE_SUFFIX.length) + FIXTURES_SUFFIX;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse fixture-file text (exported separately for unit tests). */
export function parseFixtures(src: string, path: string): Fixture[] {
  let doc: unknown;
  try {
    doc = JSON.parse(src);
  } catch (err) {
    throw new TemplateError(`${path}: not valid JSON — ${(err as Error).message}`);
  }
  if (!isPlainObject(doc)) {
    throw new TemplateError(
      `${path}: fixtures file must be a JSON object of { "name": { …vars } }`,
    );
  }
  const names = Object.keys(doc);
  if (names.length === 0) {
    throw new TemplateError(`${path}: fixtures file defines no fixtures`);
  }
  const fixtures: Fixture[] = [];
  for (const name of names.sort()) {
    if (!NAME_RE.test(name)) {
      throw new TemplateError(
        `${path}: fixture name "${name}" is not filename-safe (allowed: letters, digits, ".", "_", "-")`,
      );
    }
    const vars = doc[name];
    if (!isPlainObject(vars)) {
      throw new TemplateError(
        `${path}: fixture "${name}" must be a JSON object of variables`,
      );
    }
    fixtures.push({ name, vars, path });
  }
  return fixtures;
}

/**
 * Load the fixtures for a template, sorted by name. Missing fixtures
 * file ⇒ the implicit `default` fixture (empty vars, no `path`).
 */
export function loadFixtures(templatePath: string): Fixture[] {
  const path = fixturesPathFor(templatePath);
  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return [{ name: "default", vars: {} }];
  }
  return parseFixtures(src, path);
}
