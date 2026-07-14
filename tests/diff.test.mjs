// The diff engine: LCS line diffs, unified hunk construction and the
// positional message-array diff that check's output is built from.
import test from "node:test";
import assert from "node:assert/strict";

import { buildHunks, diffLines, diffMessages, formatHunks } from "../dist/diff.js";

function ops(a, b) {
  return diffLines(a.split("\n"), b.split("\n")).map((o) =>
    o.type === "eq" ? ` ${o.line}` : o.type === "del" ? `-${o.line}` : `+${o.line}`,
  );
}

// ---------- line diff ----------

test("equal, inserted, deleted and changed lines produce the classic ops", () => {
  assert.deepEqual(ops("a\nb", "a\nb"), [" a", " b"]);
  assert.deepEqual(ops("a\nc", "a\nb\nc"), [" a", "+b", " c"]);
  assert.deepEqual(ops("a\nb\nc", "a\nc"), [" a", "-b", " c"]);
  assert.deepEqual(ops("a\nold\nc", "a\nnew\nc"), [" a", "-old", "+new", " c"]);
});

test("common prefix and suffix are preserved around a middle edit", () => {
  const result = ops("p1\np2\nx\ns1\ns2", "p1\np2\ny\ns1\ns2");
  assert.deepEqual(result, [" p1", " p2", "-x", "+y", " s1", " s2"]);
});

test("the LCS keeps the longest common subsequence, not a greedy match", () => {
  // a: A B C A B B A   b: C B A B A C — classic sequence pair.
  const a = ["A", "B", "C", "A", "B", "B", "A"];
  const b = ["C", "B", "A", "B", "A", "C"];
  const result = diffLines(a, b);
  const kept = result.filter((o) => o.type === "eq").length;
  assert.equal(kept, 4); // LCS length of the classic pair is 4
  // And the ops replay a into b exactly:
  const replayed = [];
  for (const op of result) {
    if (op.type !== "del") replayed.push(op.line);
  }
  assert.deepEqual(replayed, b);
});

test("empty-to-something and something-to-empty diffs", () => {
  assert.deepEqual(ops("", "a"), ["-", "+a"]);
  assert.deepEqual(
    diffLines([], ["a", "b"]).map((o) => o.type),
    ["ins", "ins"],
  );
  assert.deepEqual(
    diffLines(["a", "b"], []).map((o) => o.type),
    ["del", "del"],
  );
});

// ---------- hunks ----------

test("buildHunks trims unchanged regions to the context width", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const b = ["1", "2", "3", "4", "X", "6", "7", "8", "9"];
  const hunks = buildHunks(diffLines(a, b), 2);
  assert.equal(hunks.length, 1);
  assert.deepEqual(formatHunks(hunks), [
    "@@ -3,5 +3,5 @@",
    " 3",
    " 4",
    "-5",
    "+X",
    " 6",
    " 7",
  ]);
});

test("distant edits produce separate hunks; near ones merge", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const changedFar = [...a];
  changedFar[0] = "X";
  changedFar[11] = "Y";
  assert.equal(buildHunks(diffLines(a, changedFar), 2).length, 2);
  const changedNear = [...a];
  changedNear[4] = "X";
  changedNear[6] = "Y";
  assert.equal(buildHunks(diffLines(a, changedNear), 2).length, 1);
});

test("context 0 emits only the changed lines, with 1-based hunk headers", () => {
  const hunks = buildHunks(diffLines(["a", "b", "c"], ["a", "X", "c"]), 0);
  assert.deepEqual(formatHunks(hunks), ["@@ -2,1 +2,1 @@", "-b", "+X"]);
  const mixed = buildHunks(diffLines(["same", "gone"], ["same", "added", "kept"]), 0);
  assert.match(formatHunks(mixed)[0], /^@@ -2,\d+ \+2,\d+ @@$/);
});

// ---------- message diff ----------

const SNAP = [
  { role: "system", content: "Be brief.\nBe kind." },
  { role: "user", content: "hello" },
];

test("identical message arrays are identical", () => {
  const diff = diffMessages(SNAP, [...SNAP]);
  assert.equal(diff.identical, true);
  assert.deepEqual(diff.changes.map((c) => c.kind), ["same", "same"]);
});

test("a content edit yields hunks on the right message", () => {
  const now = [SNAP[0], { role: "user", content: "goodbye" }];
  const diff = diffMessages(SNAP, now);
  assert.equal(diff.identical, false);
  assert.equal(diff.changed, 1);
  const change = diff.changes[1];
  assert.equal(change.kind, "content");
  assert.deepEqual(formatHunks(change.hunks), ["@@ -1,1 +1,1 @@", "-hello", "+goodbye"]);
});

test("role and content changes are classified role / content / role+content", () => {
  const roleOnly = diffMessages(SNAP, [SNAP[0], { role: "assistant", content: "hello" }]).changes[1];
  assert.equal(roleOnly.kind, "role");
  assert.equal(roleOnly.oldRole, "user");
  assert.equal(roleOnly.newRole, "assistant");
  assert.equal(roleOnly.hunks, undefined);
  const both = diffMessages(SNAP, [SNAP[0], { role: "assistant", content: "changed" }]).changes[1];
  assert.equal(both.kind, "role+content");
});

test("appended and dropped messages are added/removed with counts", () => {
  const grew = diffMessages(SNAP, [...SNAP, { role: "assistant", content: "!" }]);
  assert.equal(grew.added, 1);
  assert.equal(grew.changes[2].kind, "added");
  assert.equal(grew.total, 3);

  const shrank = diffMessages(SNAP, SNAP.slice(0, 1));
  assert.equal(shrank.removed, 1);
  assert.equal(shrank.changes[1].kind, "removed");
  assert.equal(shrank.changes[1].oldRole, "user");
});

test("a message shifted by an insertion diffs positionally — order is part of the prompt", () => {
  const now = [{ role: "system", content: "NEW FIRST" }, ...SNAP];
  const diff = diffMessages(SNAP, now);
  // slot 0 changed content, slot 1 changed role+content, slot 2 added
  assert.equal(diff.identical, false);
  assert.equal(diff.changed + diff.added, 3);
});
