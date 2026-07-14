# The `.prompt` template format

A `.prompt` file is a plain-text chat transcript template: `--- role`
header lines split it into messages, and message bodies use a small,
strict `{{ … }}` expression language. This document is the complete
reference; the parser accepts nothing that is not written here.

## File structure

```text
# comment lines are allowed before the first section only
--- system
You are a support agent for {{ product.name }}.
--- user
{{ question }}
```

- A header line is `--- <role>` — three dashes, whitespace, a lowercase
  role token matching `[a-z][a-z0-9_-]*`. The conventional roles are
  `system`, `developer`, `user`, `assistant` and `tool`, but any token
  matching the pattern is accepted.
- Roles may repeat. That is how few-shot examples and multi-turn
  transcripts are written — each section becomes one message, in order.
- Before the first header, only blank lines and `#` comments are legal.
  Inside a section, **every** line is content: `#` is not a comment
  there, because prompts legitimately contain Markdown headings.
- A content line that must literally start with `---` is escaped as
  `\---`. A literal `{{` is escaped as `\{{`.
- CRLF input is normalized to LF. Leading and trailing blank lines of
  each section are trimmed; interior blank lines are preserved exactly.

## Variables

| Form | Meaning |
|---|---|
| `{{ name }}` | top-level variable |
| `{{ user.address.city }}` | dot path into nested objects |
| `{{ items[0] }}` / `{{ items.0 }}` | array index (both spellings) |
| `{{ @index }}` `{{ @first }}` `{{ @last }}` | loop metadata inside `{{#each}}` |

Strings render verbatim; numbers and booleans stringify. Everything
else is an error, deliberately:

- a **missing** variable fails with the template line/column and the
  list of names the fixture provides;
- an **object or array** fails with a hint to use `| json` or `| join`;
- **null** fails with a hint to use `| default:"…"`.

A silently-empty or `[object Object]` prompt is exactly the bug this
tool exists to catch, so rendering never guesses.

## Filters

Filters chain left to right: `{{ tags | join:", " | upper }}`.
Arguments follow a `:` and may be quoted (`"…"` or `'…'`, with `\"`,
`\n`, `\t` escapes) when they contain spaces or `|`.

| Filter | Argument | Effect |
|---|---|---|
| `json` | indent (optional) | `JSON.stringify`; compact by default, pretty with `json:2` |
| `upper` / `lower` | — | case conversion (string/number/boolean input) |
| `trim` | — | strip surrounding whitespace |
| `join` | separator (default `", "`) | join an array of scalars |
| `default` | replacement | used when the value is missing, `null` or `""` |
| `indent` | spaces (default 2) | indent every non-empty line |

`default` is the only filter that may receive a missing value; every
other filter on a missing variable still raises the missing-variable
error.

## Conditionals and loops

```text
{{#if customer.vip}}
Escalate ambiguous tickets.
{{else}}
Follow the standard queue rules.
{{/if}}

{{#each tools as tool}}
- {{ tool.name }}: {{ tool.description }}
{{/each}}
```

- Truthiness: `false`, `null`, missing, `""`, `0` and `[]` are false;
  everything else is true. `{{#if !path}}` negates.
- A missing `{{#if}}` path is **false, not an error** — optional flags
  stay optional. A missing or non-array `{{#each}}` path **is** an
  error — pass `[]` explicitly for an empty list.
- Block tags that sit alone on a line are stripped with their line
  (mustache-style standalone-line handling), so conditionals never
  leave blank lines behind in the rendered prompt.

## Rendering normalization

Rendered message content is normalized before snapshotting: leading
blank lines and all trailing whitespace are removed from every
message. Interior whitespace is preserved byte-for-byte. This keeps
snapshots free of invisible churn from empty conditional branches
while still failing on every visible change.

## Fixtures and snapshots

`name.prompt` pairs with `name.fixtures.json` in the same directory —
a JSON object whose keys are fixture names (filename-safe:
`[A-Za-z0-9][A-Za-z0-9._-]*`) and whose values are variable objects.
Without a fixtures file the template gets one implicit fixture,
`default`, with no variables.

Each (template, fixture) pair snapshots to
`__promptsnaps__/<template>.<fixture>.snap.json` next to the template:

```json
{
  "promptsnap": 1,
  "template": "triage.prompt",
  "fixture": "vip-outage",
  "messages": [
    { "role": "system", "content": "…" },
    { "role": "user", "content": "…" }
  ]
}
```

Serialization is deterministic (fixed key order, two-space indent,
trailing newline), so a snapshot's git diff shows exactly the prompt
change and nothing else. `promptsnap` is the format version; readers
reject versions they do not understand rather than misread them.
