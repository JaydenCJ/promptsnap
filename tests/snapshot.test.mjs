// Snapshot files: path convention, deterministic serialization,
// round-tripping, format validation and message equality.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  makeSnapshot,
  messagesEqual,
  parseSnapshot,
  readSnapshot,
  serializeSnapshot,
  snapshotPathFor,
} from "../dist/snapshot.js";
import { workspace } from "./helpers.mjs";

const MSGS = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Hi\nthere" },
];

test("snapshotPathFor puts snapshots in __promptsnaps__ next to the template", () => {
  assert.equal(
    snapshotPathFor(join("prompts", "triage.prompt"), "vip"),
    join("prompts", "__promptsnaps__", "triage.vip.snap.json"),
  );
});

test("serialization is deterministic: fixed key order, 2-space indent, final newline", () => {
  const snap = makeSnapshot("a/triage.prompt", "vip", MSGS);
  const text = serializeSnapshot(snap);
  assert.ok(text.endsWith("}\n"));
  assert.equal(text, serializeSnapshot(makeSnapshot("a/triage.prompt", "vip", MSGS)));
  const keys = Object.keys(JSON.parse(text));
  assert.deepEqual(keys, ["promptsnap", "template", "fixture", "messages"]);
});

test("the snapshot records the template basename, not its absolute path", () => {
  // Snapshots are committed; absolute paths would differ per machine.
  const snap = makeSnapshot("/somewhere/deep/triage.prompt", "vip", MSGS);
  assert.equal(snap.template, "triage.prompt");
});

test("serialize → parse round-trips messages byte-exactly", () => {
  const snap = makeSnapshot("t.prompt", "f", MSGS);
  const back = parseSnapshot(serializeSnapshot(snap), "s.snap.json");
  assert.deepEqual(back.messages, MSGS);
  assert.equal(back.fixture, "f");
});

test("readSnapshot returns null for a missing file and parses an existing one", () => {
  const dir = workspace({});
  const path = join(dir, "x.snap.json");
  assert.equal(readSnapshot(path), null);
  writeFileSync(path, serializeSnapshot(makeSnapshot("t.prompt", "f", MSGS)), "utf8");
  assert.deepEqual(readSnapshot(path)?.messages, MSGS);
  assert.equal(readFileSync(path, "utf8"), serializeSnapshot(makeSnapshot("t.prompt", "f", MSGS)));
});

test("unsupported format versions are rejected loudly, not misread", () => {
  assert.throws(
    () => parseSnapshot('{"promptsnap":2,"template":"t","fixture":"f","messages":[]}', "s"),
    /unsupported snapshot format version 2/,
  );
  assert.throws(() => parseSnapshot("{}", "s"), /unsupported snapshot format version/);
});

test("malformed snapshot documents fail validation with the path", () => {
  assert.throws(() => parseSnapshot("not json", "bad.snap.json"), /bad\.snap\.json: not valid JSON/);
  assert.throws(() => parseSnapshot("[1]", "s"), /must be a JSON object/);
  assert.throws(
    () => parseSnapshot('{"promptsnap":1,"template":"t","fixture":"f","messages":"no"}', "s"),
    /"messages" must be an array/,
  );
  assert.throws(
    () => parseSnapshot('{"promptsnap":1,"template":"t","fixture":"f","messages":[{"role":"u"}]}', "s"),
    /message 0 must be/,
  );
});

test("extra unknown fields in a snapshot are tolerated and dropped", () => {
  const doc = '{"promptsnap":1,"template":"t","fixture":"f","messages":[],"future":"field"}';
  const snap = parseSnapshot(doc, "s");
  assert.equal("future" in snap, false);
});

test("messagesEqual is exact on role, content, order and length", () => {
  assert.equal(messagesEqual(MSGS, [...MSGS]), true);
  assert.equal(messagesEqual(MSGS, [MSGS[1], MSGS[0]]), false);
  assert.equal(messagesEqual(MSGS, MSGS.slice(0, 1)), false);
  assert.equal(
    messagesEqual(MSGS, [MSGS[0], { role: "user", content: "Hi\nthere " }]),
    false, // one trailing space differs
  );
});
