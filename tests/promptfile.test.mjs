// The `.prompt` file format: section headers, comments, escapes,
// blank-line trimming, CRLF normalization and every parse error.
import test from "node:test";
import assert from "node:assert/strict";

import { parsePromptSource } from "../dist/promptfile.js";
import { renderPrompt } from "../dist/render.js";

function roles(src) {
  return parsePromptSource(src, "t.prompt").messages.map((m) => m.role);
}

function messages(src, vars = {}) {
  return renderPrompt(parsePromptSource(src, "t.prompt"), vars);
}

test("a system + user file parses into two messages in order", () => {
  const msgs = messages("--- system\nBe brief.\n--- user\nHi.\n");
  assert.deepEqual(msgs, [
    { role: "system", content: "Be brief." },
    { role: "user", content: "Hi." },
  ]);
});

test("repeated and custom roles express few-shot turns and tool results", () => {
  const src = [
    "--- system",
    "Classify sentiment.",
    "--- user",
    "I love it",
    "--- assistant",
    "positive",
    "--- tool",
    "score: 0.93",
    "--- user",
    "{{ text }}",
  ].join("\n");
  assert.deepEqual(roles(src), ["system", "user", "assistant", "tool", "user"]);
  const msgs = messages(src, { text: "meh" });
  assert.equal(msgs[4].content, "meh");
});

test("# comment lines before the first section are ignored", () => {
  const msgs = messages("# owned by the support team\n\n--- user\nhello\n");
  assert.deepEqual(msgs, [{ role: "user", content: "hello" }]);
});

test("# inside a section is content, because prompts contain Markdown", () => {
  const msgs = messages("--- system\n# Rules\n- be kind\n");
  assert.equal(msgs[0].content, "# Rules\n- be kind");
});

test("non-comment content before the first header is an error", () => {
  assert.throws(
    () => parsePromptSource("hello\n--- user\nhi\n", "t.prompt"),
    /t\.prompt: content before the first "--- role" header \(line 1\)/,
  );
});

test("\\--- escapes a literal --- content line", () => {
  const msgs = messages("--- user\nabove\n\\--- system\nbelow\n");
  assert.deepEqual(roles("--- user\nabove\n\\--- system\nbelow\n"), ["user"]);
  assert.equal(msgs[0].content, "above\n--- system\nbelow");
});

test("leading/trailing blank lines of a section are trimmed, interior kept", () => {
  const msgs = messages("--- user\n\n\nfirst\n\nsecond\n\n\n");
  assert.equal(msgs[0].content, "first\n\nsecond");
});

test("CRLF input renders identically to LF input", () => {
  const lf = messages("--- user\na\nb\n");
  const crlf = messages("--- user\r\na\r\nb\r\n");
  assert.deepEqual(crlf, lf);
});

test("uppercase or malformed roles are rejected with the line number", () => {
  assert.throws(() => parsePromptSource("--- SYSTEM\nx\n", "t.prompt"), /invalid role "SYSTEM" on line 1/);
  assert.throws(() => parsePromptSource("--- user\nx\n--- 2nd\ny\n", "t.prompt"), /invalid role "2nd" on line 3/);
});

test("an empty file (or one with only comments) is an error", () => {
  assert.throws(() => parsePromptSource("", "t.prompt"), /no message sections/);
  assert.throws(() => parsePromptSource("# just a comment\n", "t.prompt"), /no message sections/);
});

test("template errors point at real file lines, even after blank-line trimming", () => {
  // The bad tag sits on file line 5 of the whole .prompt file.
  const src = "--- system\nfine here\n--- user\nline one\nbad {{ 1x }}\n";
  assert.throws(() => parsePromptSource(src, "t.prompt"), /t\.prompt: .*line 5, col 5/);
  // Two leading blank lines are trimmed from the section body; the
  // reported line must still be the real file line (6).
  const trimmed = "--- user\n\n\nok\nstill ok\nbad {{ a..b }}\n";
  assert.throws(() => parsePromptSource(trimmed, "t.prompt"), /line 6/);
});

test("an empty section renders as an empty message (assistant prefill)", () => {
  const msgs = messages("--- user\nhi\n--- assistant\n");
  assert.deepEqual(msgs[1], { role: "assistant", content: "" });
});
