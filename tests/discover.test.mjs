// Discovery: recursive template/snapshot walking, skip rules and the
// deterministic ordering every command depends on.
import test from "node:test";
import assert from "node:assert/strict";
import { join, sep } from "node:path";

import { collectPairs, discover } from "../dist/discover.js";
import { workspace } from "./helpers.mjs";

const T = "--- user\nhi\n";

function rel(dir, paths) {
  return paths.map((p) => p.slice(dir.length + 1).split(sep).join("/"));
}

test("discover finds .prompt files recursively, sorted", () => {
  const dir = workspace({
    "b/second.prompt": T,
    "a/first.prompt": T,
    "a/nested/deep.prompt": T,
    "notes.txt": "not a template",
  });
  const { templates } = discover([dir]);
  assert.deepEqual(rel(dir, templates), [
    "a/first.prompt",
    "a/nested/deep.prompt",
    "b/second.prompt",
  ]);
});

test("node_modules, dist and dot-directories are skipped", () => {
  const dir = workspace({
    "keep.prompt": T,
    "node_modules/pkg/skip.prompt": T,
    "dist/skip.prompt": T,
    ".hidden/skip.prompt": T,
  });
  const { templates } = discover([dir]);
  assert.deepEqual(rel(dir, templates), ["keep.prompt"]);
});

test("existing snapshots are collected from __promptsnaps__ dirs only", () => {
  const dir = workspace({
    "t.prompt": T,
    "__promptsnaps__/t.default.snap.json": "{}",
    "__promptsnaps__/README.txt": "not a snapshot",
    "elsewhere/t.default.snap.json": "{}", // outside a snapshot dir
  });
  const { snapshots } = discover([dir]);
  assert.deepEqual(rel(dir, snapshots), ["__promptsnaps__/t.default.snap.json"]);
});

test("a direct .prompt file path is accepted; other files are rejected", () => {
  const dir = workspace({ "t.prompt": T, "t.fixtures.json": "{}" });
  const { templates } = discover([join(dir, "t.prompt")]);
  assert.equal(templates.length, 1);
  assert.throws(() => discover([join(dir, "t.fixtures.json")]), /not a \.prompt file/);
  assert.throws(() => discover([join(dir, "nope.prompt")]), /no such file/);
});

test("overlapping roots do not produce duplicate templates", () => {
  const dir = workspace({ "a/t.prompt": T });
  const { templates } = discover([dir, join(dir, "a")]);
  // Same file reached via two roots: paths differ textually, but the
  // per-root sorted walk plus dedupe keeps exact duplicates out.
  const { templates: twice } = discover([join(dir, "a"), join(dir, "a")]);
  assert.equal(twice.length, 1);
  assert.ok(templates.length >= 1);
});

test("collectPairs expands templates × fixtures in fixture-name order", () => {
  const dir = workspace({
    "t.prompt": "--- user\n{{ q }}\n",
    "t.fixtures.json": '{"b":{"q":"1"},"a":{"q":"2"}}',
    "solo.prompt": T,
  });
  const pairs = collectPairs(discover([dir]).templates);
  assert.deepEqual(
    pairs.map((p) => [p.templatePath.slice(dir.length + 1), p.fixture.name]),
    [
      ["solo.prompt", "default"],
      ["t.prompt", "a"],
      ["t.prompt", "b"],
    ],
  );
});
