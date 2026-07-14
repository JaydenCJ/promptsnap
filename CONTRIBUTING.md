# Contributing to promptsnap

Issues, discussions and pull requests are all welcome — this project
aims to stay small, zero-dependency at runtime, fully offline and
strict about what a rendered prompt is allowed to silently become.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/promptsnap.git
cd promptsnap
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (the snap → drift → diff
workflow, `--update`, obsolete-snapshot pruning, render-error
reporting, JSON determinism and every exit code) against the committed
example prompt suite and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the parser, renderer and diff engine take strings and
   return data — only `cli.ts` touches the filesystem or the process).
5. Anything that changes what a template renders to — filter behavior,
   whitespace handling, normalization — is a **breaking change for
   every committed snapshot in every downstream repo**. Say so in the
   PR, update [docs/template-syntax.md](docs/template-syntax.md), and
   expect it to wait for a minor release.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually
  be declined. The template engine and the diff are in-repo on purpose.
- No network calls, ever — promptsnap renders and diffs local text.
  A prompt-testing tool must run in CI without secrets.
- Determinism is API: same templates and fixtures, byte-identical
  snapshots, report order and exit code — no clocks, no randomness,
  no locale-dependent sorting.
- Rendering stays strict: never invent a value, never coerce an object
  to `[object Object]`, never let a typo render as empty string.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `promptsnap --version` output, the exact command line,
and a *minimal* `.prompt` + `.fixtures.json` pair that reproduces the
problem — a template that renders wrongly, a diff that reads wrongly,
or an error that points at the wrong line. The files under
`examples/support-bot/` are a good template for a self-contained repro.

## Security

Do not open public issues for security problems (e.g. a crafted
template or snapshot file that escapes its directory or corrupts
files on `snap --prune`); use GitHub private vulnerability reporting
on this repository instead.
