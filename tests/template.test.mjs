// The template engine end to end: parsing + rendering of variables,
// filters, conditionals, loops, escapes, and — just as important —
// the exact errors a broken template or an incomplete fixture raises.
import test from "node:test";
import assert from "node:assert/strict";

import { parseTemplate, TemplateError } from "../dist/template.js";
import { renderNodes } from "../dist/render.js";

function render(src, vars = {}) {
  return renderNodes(parseTemplate(src), [vars]);
}

// ---------- variables ----------

test("plain text passes through byte-identically", () => {
  const src = "No tags here.\nJust two lines.";
  assert.equal(render(src), src);
});

test("variables resolve dot paths, [n] and .n indexes, and scalar types", () => {
  assert.equal(render("Hello {{ name }}!", { name: "Ada" }), "Hello Ada!");
  assert.equal(
    render("{{ user.address.city }}", { user: { address: { city: "Osaka" } } }),
    "Osaka",
  );
  const vars = { items: ["a", "b", "c"] };
  assert.equal(render("{{ items[1] }}/{{ items.2 }}", vars), "b/c");
  assert.equal(render("{{ n }}/{{ b }}/{{ s }}", { n: 42, b: false, s: "x" }), "42/false/x");
});

test("\\{{ escapes a literal {{", () => {
  assert.equal(render("use \\{{ name }} syntax", { name: "ignored" }), "use {{ name }} syntax");
});

// ---------- filters ----------

test("upper / lower / trim filters transform strings", () => {
  assert.equal(render("{{ s | upper }}", { s: "abc" }), "ABC");
  assert.equal(render("{{ s | lower }}", { s: "ABC" }), "abc");
  assert.equal(render("{{ s | trim }}", { s: "  x  " }), "x");
});

test("json filter renders compact by default, pretty with an indent arg", () => {
  assert.equal(render("{{ v | json }}", { v: { a: 1 } }), '{"a":1}');
  assert.equal(render("{{ v | json:2 }}", { v: { a: 1 } }), '{\n  "a": 1\n}');
});

test("join filter concatenates scalars; quoted separators may contain |", () => {
  assert.equal(render('{{ xs | join:" / " }}', { xs: ["a", "b"] }), "a / b");
  assert.equal(render("{{ xs | join }}", { xs: [1, 2] }), "1, 2"); // default ", "
  assert.equal(render('{{ xs | join:" | " }}', { xs: ["a", "b"] }), "a | b");
  assert.equal(render('{{ xs | join:"\\"" }}', { xs: ["a", "b"] }), 'a"b');
});

test("default filter fills in for missing, null and empty values", () => {
  assert.equal(render('{{ x | default:"n/a" }}', {}), "n/a");
  assert.equal(render('{{ x | default:"n/a" }}', { x: null }), "n/a");
  assert.equal(render('{{ x | default:"n/a" }}', { x: "" }), "n/a");
  assert.equal(render('{{ x | default:"n/a" }}', { x: "set" }), "set");
});

test("indent filter indents every non-empty line", () => {
  assert.equal(render("{{ s | indent:2 }}", { s: "a\n\nb" }), "  a\n\n  b");
});

test("filters chain left to right", () => {
  assert.equal(render('{{ xs | join:"," | upper }}', { xs: ["a", "b"] }), "A,B");
});

// ---------- conditionals ----------

test("#if, #if/else and #if ! pick the correct branch", () => {
  const src = "{{#if vip}}gold{{else}}standard{{/if}}";
  assert.equal(render(src, { vip: true }), "gold");
  assert.equal(render(src, { vip: false }), "standard");
  assert.equal(render("{{#if vip}}VIP{{/if}}", { vip: false }), "");
  assert.equal(render("{{#if !vip}}basic{{/if}}", { vip: false }), "basic");
});

test("empty string, empty array and 0 are falsy; a missing #if path is false, not an error", () => {
  assert.equal(render("{{#if s}}y{{else}}n{{/if}}", { s: "" }), "n");
  assert.equal(render("{{#if xs}}y{{else}}n{{/if}}", { xs: [] }), "n");
  assert.equal(render("{{#if n}}y{{else}}n{{/if}}", { n: 0 }), "n");
  assert.equal(render("{{#if nothing.here}}y{{else}}n{{/if}}", {}), "n");
});

// ---------- loops ----------

test("#each iterates with the item name bound", () => {
  assert.equal(
    render("{{#each tools as t}}<{{ t.name }}>{{/each}}", {
      tools: [{ name: "search" }, { name: "fetch" }],
    }),
    "<search><fetch>",
  );
});

test("@index, @first and @last are available inside #each", () => {
  const src = "{{#each xs as x}}{{#if !@first}},{{/if}}{{ @index }}:{{ x }}{{#if @last}}!{{/if}}{{/each}}";
  assert.equal(render(src, { xs: ["a", "b", "c"] }), "0:a,1:b,2:c!");
});

test("nested #each scopes shadow correctly", () => {
  const src = "{{#each rows as row}}{{#each row as cell}}{{ cell }}{{/each}};{{/each}}";
  assert.equal(render(src, { rows: [["a", "b"], ["c"]] }), "ab;c;");
});

test("standalone block-tag lines vanish; inline block tags keep text intact", () => {
  const src = "start\n{{#if flag}}\nshown\n{{/if}}\nend";
  assert.equal(render(src, { flag: true }), "start\nshown\nend");
  assert.equal(render(src, { flag: false }), "start\nend");
  assert.equal(render("a {{#if f}}b{{/if}} c", { f: true }), "a b c");
});

// ---------- errors ----------

function renderError(src, vars = {}) {
  try {
    render(src, vars);
  } catch (err) {
    assert.ok(err instanceof TemplateError, `expected TemplateError, got ${err}`);
    return err.message;
  }
  assert.fail("expected an error");
}

test("a missing variable error names the path, its location and what the fixture provides", () => {
  const msg = renderError("line one\nsee {{ user }}", { name: "x", plan: "y" });
  assert.match(msg, /unknown variable "user"/);
  assert.match(msg, /fixture provides: name, plan/);
  assert.match(msg, /line 2, col 5/);
});

test("objects need | json and nulls point at | default — never [object Object]", () => {
  const objMsg = renderError("{{ cfg }}", { cfg: { a: 1 } });
  assert.match(objMsg, /is an object/);
  assert.match(objMsg, /\| json/);
  assert.match(renderError("{{ x }}", { x: null }), /\| default/);
});

test("#each over a missing or non-array value is an error", () => {
  assert.match(renderError("{{#each xs as x}}{{/each}}", {}), /unknown list "xs"/);
  assert.match(renderError("{{#each xs as x}}{{/each}}", { xs: "no" }), /needs an array/);
});

test("unknown filters are rejected with the known-filter list", () => {
  assert.match(renderError("{{ x | frobnicate }}", { x: 1 }), /unknown filter "frobnicate".*json/);
});

test("unclosed tags and blocks are parse errors with locations", () => {
  assert.throws(() => parseTemplate("oops {{ name"), /unclosed \{\{ tag \(line 1, col 6\)/);
  assert.throws(() => parseTemplate("{{#if a}}never closed"), /unclosed \{\{#if\}\} opened at line 1/);
  assert.throws(() => parseTemplate("{{#each xs as x}}"), /unclosed \{\{#each\}\}/);
});

test("stray or mismatched closers are parse errors", () => {
  assert.throws(() => parseTemplate("{{/if}}"), /without a matching/);
  assert.throws(() => parseTemplate("{{else}}"), /outside of an open/);
  assert.throws(() => parseTemplate("{{#if a}}{{/each}}"), /without a matching \{\{#each\}\}/);
});

test("malformed each and invalid paths are parse errors", () => {
  assert.throws(() => parseTemplate("{{#each xs}}{{/each}}"), /expected \{\{#each path as item\}\}/);
  assert.throws(() => parseTemplate("{{ 1bad }}"), /invalid variable path/);
  assert.throws(() => parseTemplate("{{ a..b }}"), /invalid variable path/);
});
