# promptsnap examples

A small support-bot prompt suite with its snapshots committed, so you
can watch the whole workflow without writing anything first. All
commands below run from the repository root after `npm install && npm
run build`; replace `node dist/cli.js` with `promptsnap` if you
installed the package globally.

## Files

- `support-bot/triage.prompt` — a realistic triage prompt: a system
  message assembled from fixture data (`join`, `upper`, an `#if` VIP
  branch), a hard-coded few-shot user/assistant turn, and a final user
  message with an optional attachments loop.
- `support-bot/triage.fixtures.json` — two fixtures, `vip-outage` and
  `free-question`, chosen to exercise both sides of every conditional.
- `support-bot/release-notes.prompt` — a second template showing
  `default`, `json:2` and a `(BREAKING)` flag inside `#each`.
- `support-bot/__promptsnaps__/` — the committed snapshots: the exact
  message arrays each pair renders to today.

## Try it

Everything matches as committed:

```bash
node dist/cli.js check examples
```

Now break something on purpose — edit the system section of
`support-bot/triage.prompt`, then:

```bash
node dist/cli.js check examples   # exit 1, line-level diff per message
```

Inspect a single pair, update the snapshots, and clean up:

```bash
node dist/cli.js render examples/support-bot/triage.prompt --fixture vip-outage
node dist/cli.js snap examples    # accept the new rendering
git checkout -- examples          # or just restore the originals
```

`ls` shows what promptsnap discovered and which pairs have snapshots:

```bash
node dist/cli.js ls examples
```
