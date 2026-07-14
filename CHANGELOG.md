# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- The `.prompt` file format: plain-text chat templates split into
  messages by `--- role` headers, with repeated roles for few-shot
  turns, `#` comments before the first section, `\---` and `\{{`
  escapes, CRLF normalization and per-section blank-line trimming.
- A strict, dependency-free template engine: `{{ path }}` variables
  with dot and `[n]` segments, chained filters (`json`, `upper`,
  `lower`, `trim`, `join:sep`, `default:value`, `indent:n`),
  `{{#if}}/{{else}}/{{/if}}` with negation, `{{#each path as item}}`
  with `@index`/`@first`/`@last`, and mustache-style standalone-line
  stripping so block tags never leave blank lines in rendered prompts.
- Strict rendering semantics: missing variables, objects without
  `| json` and nulls without `| default` fail with the template file,
  line and column plus the names the fixture provides — a prompt is
  never silently empty or `[object Object]`.
- Fixture files (`name.fixtures.json`) pairing named variable sets
  with each template, an implicit zero-variable `default` fixture,
  and filename-safe fixture-name validation.
- Deterministic snapshot files under `__promptsnaps__/` — fixed key
  order, two-space indent, versioned format (`"promptsnap": 1`) that
  is rejected loudly by readers that do not understand it.
- The `snap` command (write/update snapshots, `--prune` for obsolete
  ones), `check` (re-render, LCS line-diff per message with unified
  hunks, `--update`, `--context N`, `--json`), `render` (inspect one
  pair, `--fixture`/`--vars`/`--json`) and `ls`; exit codes 0/1/2
  (clean / drift / usage error) for CI gating.
- A message-array diff that classifies every slot as same, role
  change, content change, added or removed — positional on purpose,
  because message order is part of the prompt.
- Recursive template discovery with deterministic ordering, skipping
  `node_modules`, `dist` and dot-directories; obsolete-snapshot
  detection wired into `check`.
- Public programmatic API (`parsePromptSource`, `renderPrompt`,
  `diffMessages`, `parseSnapshot`, `discover`, …) with type
  declarations, for asserting on rendered messages inside any test
  runner.
- A committed example prompt suite (`examples/support-bot/`) with its
  snapshots, exercising every template feature.
- Test suite: 90 node:test tests (unit + CLI integration in temp
  workspaces) and an end-to-end `scripts/smoke.sh` against the
  bundled examples.

[0.1.0]: https://github.com/JaydenCJ/promptsnap/releases/tag/v0.1.0
