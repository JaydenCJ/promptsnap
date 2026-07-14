// renderPrompt: the template → message-array pipeline, including the
// normalization rules that keep snapshots free of invisible churn.
import test from "node:test";
import assert from "node:assert/strict";

import { parsePromptSource } from "../dist/promptfile.js";
import { normalizeContent, renderPrompt, truthy } from "../dist/render.js";
import { TemplateError } from "../dist/template.js";

function render(src, vars) {
  return renderPrompt(parsePromptSource(src, "pipeline.prompt"), vars);
}

test("a realistic template renders the exact final message array", () => {
  const src = [
    "--- system",
    "You are the release-notes writer for {{ repo }}.",
    "Tone: {{ tone | default:\"neutral\" }}.",
    "--- user",
    "Summarize these merged PRs:",
    "{{#each prs as pr}}",
    "- #{{ pr.number }} {{ pr.title }}",
    "{{/each}}",
  ].join("\n");
  const msgs = render(src, {
    repo: "acme/api",
    prs: [
      { number: 101, title: "Add rate limits" },
      { number: 102, title: "Fix pagination" },
    ],
  });
  assert.deepEqual(msgs, [
    {
      role: "system",
      content: "You are the release-notes writer for acme/api.\nTone: neutral.",
    },
    {
      role: "user",
      content: "Summarize these merged PRs:\n- #101 Add rate limits\n- #102 Fix pagination",
    },
  ]);
});

test("rendering is deterministic — same input, byte-identical output", () => {
  const src = "--- user\n{{#each xs as x}}{{ x }};{{/each}}";
  const vars = { xs: ["a", "b"] };
  assert.deepEqual(render(src, vars), render(src, vars));
});

test("render errors are prefixed with the template path", () => {
  try {
    render("--- user\n{{ missing }}", {});
    assert.fail("expected an error");
  } catch (err) {
    assert.ok(err instanceof TemplateError);
    assert.match(err.message, /^pipeline\.prompt: unknown variable "missing"/);
  }
});

test("an error in a later section still points at the right line", () => {
  assert.throws(() => render("--- system\nok\n--- user\n{{ nope }}", {}), /line 4/);
});

test("normalizeContent strips leading blank lines and all trailing whitespace", () => {
  assert.equal(normalizeContent("\n  \nbody\n  "), "body");
  assert.equal(normalizeContent("a\n\nb\n"), "a\n\nb");
  assert.equal(normalizeContent("  indented first line"), "  indented first line");
});

test("an #if that renders empty leaves no whitespace residue in the message", () => {
  const src = "--- system\nBase rules.\n{{#if vip}}\nVIP rules.\n{{/if}}";
  assert.equal(render(src, { vip: false })[0].content, "Base rules.");
  assert.equal(render(src, { vip: true })[0].content, "Base rules.\nVIP rules.");
});

test("truthy matches the documented table", () => {
  for (const falsy of [undefined, null, false, "", 0, []]) {
    assert.equal(truthy(falsy), false, `expected falsy: ${JSON.stringify(falsy)}`);
  }
  for (const t of [true, 1, -1, "x", [0], {}]) {
    assert.equal(truthy(t), true, `expected truthy: ${JSON.stringify(t)}`);
  }
});

test("variables may hold multi-line strings and keep interior newlines", () => {
  const msgs = render("--- user\n{{ log }}", { log: "line1\nline2\nline3" });
  assert.equal(msgs[0].content, "line1\nline2\nline3");
});
