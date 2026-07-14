#!/usr/bin/env bash
# Smoke test for promptsnap: exercises the real CLI end to end against
# the committed example prompt suite. No network, idempotent, runs from
# a clean checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every command.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in snap check render ls --update --prune --fixture "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. The committed example snapshots match a fresh render — exit 0.
$CLI check examples >/dev/null || fail "committed example snapshots should match"
echo "[smoke] committed examples ok"

# 4. Error handling: bad commands, flags and inputs exit 2.
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI check examples --updaet >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI check does-not-exist >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing path should exit 2"; }
$CLI render examples/support-bot/triage.prompt >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "ambiguous fixture should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 5. The flagship workflow in a scratch copy: snap → check → drift → diff.
cp -R examples/support-bot "$WORKDIR/bot"
rm -rf "$WORKDIR/bot/__promptsnaps__"
$CLI snap "$WORKDIR/bot" | grep -q "3 written" || fail "snap should write 3 snapshots"
$CLI check "$WORKDIR/bot" >/dev/null || fail "check should pass right after snap"
sed -i.bak 's/ticket-triage agent/triage robot/' "$WORKDIR/bot/triage.prompt" && rm "$WORKDIR/bot/triage.prompt.bak"
set +e
DRIFT="$($CLI check "$WORKDIR/bot")"; DRIFT_EXIT=$?
set -e
[ "$DRIFT_EXIT" -eq 1 ] || fail "check should exit 1 on drift, got $DRIFT_EXIT"
for want in "message[0] system — content changed" \
            "-You are the ticket-triage agent for Acme Cloud." \
            "+You are the triage robot for Acme Cloud." \
            "2 mismatched"; do
  echo "$DRIFT" | grep -qF -- "$want" || fail "drift report missing: $want"
done
echo "$DRIFT" | grep -qF "release-notes.prompt · minor-release" || fail "unrelated pair missing from report"
echo "[smoke] snap → drift → diff ok (exit 1)"

# 6. --json is valid, deterministic and structurally intact.
set +e
A="$($CLI check "$WORKDIR/bot" --json)"
B="$($CLI check "$WORKDIR/bot" --json)"
set -e
[ "$A" = "$B" ] || fail "check --json is not deterministic"
echo "$A" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (d.tool !== 'promptsnap') throw new Error('tool');
  if (d.ok !== false) throw new Error('ok');
  if (d.summary.mismatch !== 2 || d.summary.match !== 1) throw new Error('summary');
  const pair = d.pairs.find(p => p.fixture === 'vip-outage');
  if (pair.status !== 'mismatch') throw new Error('status');
  if (pair.diff.changes[0].kind !== 'content') throw new Error('diff kind');
" || fail "check --json is not structurally intact"
echo "[smoke] --json + determinism ok"

# 7. check --update accepts the drift; the suite is green again.
$CLI check "$WORKDIR/bot" --update >/dev/null || fail "check --update should exit 0"
$CLI check "$WORKDIR/bot" >/dev/null || fail "check should pass after --update"
echo "[smoke] check --update ok"

# 8. Obsolete snapshots fail check; snap --prune removes them.
STALE="$WORKDIR/bot/__promptsnaps__/triage.gone.snap.json"
printf '{"promptsnap":1,"template":"triage.prompt","fixture":"gone","messages":[]}\n' > "$STALE"
set +e
$CLI check "$WORKDIR/bot" >/dev/null; [ $? -eq 1 ] || { set -e; fail "obsolete snapshot should fail check"; }
set -e
$CLI snap "$WORKDIR/bot" --prune | grep -q "pruned" || fail "snap --prune should report the pruned file"
[ ! -f "$STALE" ] || fail "stale snapshot should be deleted"
$CLI check "$WORKDIR/bot" >/dev/null || fail "check should pass after prune"
echo "[smoke] obsolete + prune ok"

# 9. A fixture that stops providing a variable is a render error, exit 1.
node -e "
  const fs = require('fs');
  const p = '$WORKDIR/bot/triage.fixtures.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete d['free-question'].ticket;
  fs.writeFileSync(p, JSON.stringify(d));
"
set +e
ERR="$($CLI check "$WORKDIR/bot")"; ERR_EXIT=$?
set -e
[ "$ERR_EXIT" -eq 1 ] || fail "render error should exit 1, got $ERR_EXIT"
echo "$ERR" | grep -qF 'unknown variable "ticket.subject"' || fail "render error should name the missing variable"
echo "[smoke] render-error reporting ok"

# 10. render prints the exact final messages, text and JSON.
RENDER="$($CLI render examples/support-bot/triage.prompt --fixture vip-outage)"
echo "$RENDER" | grep -qF "ENTERPRISE plan" || fail "render missing the VIP branch"
echo "$RENDER" | grep -qF "[2] assistant" || fail "render missing the few-shot turn"
$CLI render examples/support-bot/triage.prompt --fixture free-question --json | node -e "
  const msgs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  if (msgs.length !== 4) throw new Error('expected 4 messages, got ' + msgs.length);
  if (msgs[0].content.includes('plan')) throw new Error('VIP branch leaked into free tier');
  if (msgs[3].content.includes('Attachments')) throw new Error('empty attachments loop leaked');
" || fail "render --json is not structurally intact"
echo "[smoke] render ok"

echo "SMOKE OK"
