// Fixture files: pairing convention, parsing, validation and the
// implicit `default` fixture for templates that take no variables.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  fixturesPathFor,
  loadFixtures,
  parseFixtures,
} from "../dist/fixtures.js";
import { workspace } from "./helpers.mjs";

test("fixturesPathFor maps name.prompt to name.fixtures.json alongside", () => {
  assert.equal(fixturesPathFor("prompts/triage.prompt"), "prompts/triage.fixtures.json");
});

test("parseFixtures returns fixtures sorted by name", () => {
  const fixtures = parseFixtures('{"zeta":{"a":1},"alpha":{"b":2}}', "f.json");
  assert.deepEqual(fixtures.map((f) => f.name), ["alpha", "zeta"]);
  assert.deepEqual(fixtures[0].vars, { b: 2 });
});

test("loadFixtures reads the sibling fixtures file", () => {
  const dir = workspace({
    "t.prompt": "--- user\n{{ q }}\n",
    "t.fixtures.json": '{"basic":{"q":"hi"}}',
  });
  const fixtures = loadFixtures(join(dir, "t.prompt"));
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].name, "basic");
  assert.equal(fixtures[0].path, join(dir, "t.fixtures.json"));
});

test("a template without a fixtures file gets the implicit default fixture", () => {
  const dir = workspace({ "static.prompt": "--- system\nfixed\n" });
  const fixtures = loadFixtures(join(dir, "static.prompt"));
  assert.deepEqual(fixtures, [{ name: "default", vars: {} }]);
});

test("invalid JSON is an error naming the file", () => {
  assert.throws(() => parseFixtures("{oops", "bad.fixtures.json"), /bad\.fixtures\.json: not valid JSON/);
});

test("a top-level array or scalar is rejected", () => {
  assert.throws(() => parseFixtures("[]", "f.json"), /must be a JSON object/);
  assert.throws(() => parseFixtures('"str"', "f.json"), /must be a JSON object/);
});

test("an empty fixtures object is rejected — it would silently test nothing", () => {
  assert.throws(() => parseFixtures("{}", "f.json"), /defines no fixtures/);
});

test("fixture names must be filename-safe (they become snapshot filenames)", () => {
  assert.throws(() => parseFixtures('{"has space":{}}', "f.json"), /not filename-safe/);
  assert.throws(() => parseFixtures('{"a/b":{}}', "f.json"), /not filename-safe/);
  assert.throws(() => parseFixtures('{".hidden":{}}', "f.json"), /not filename-safe/);
  // Dots, dashes and underscores are fine.
  assert.equal(parseFixtures('{"v2.1_final-really":{}}', "f.json")[0].name, "v2.1_final-really");
});

test("fixture values must be objects of variables", () => {
  assert.throws(() => parseFixtures('{"a": [1,2]}', "f.json"), /fixture "a" must be a JSON object/);
  assert.throws(() => parseFixtures('{"a": "vars"}', "f.json"), /fixture "a" must be a JSON object/);
});
