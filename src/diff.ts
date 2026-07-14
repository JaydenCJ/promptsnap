/**
 * The diff engine: an LCS line diff with unified hunks, plus a
 * message-array diff that aligns messages by position and classifies
 * each slot as same / role change / content change / added / removed.
 * Positional alignment is deliberate — a chat prompt is an ordered
 * conversation, and "message 2 moved to slot 3" IS a change worth
 * failing on.
 */
import type {
  DiffOp,
  Hunk,
  Message,
  MessageChange,
  MessagesDiff,
} from "./types.js";

/** Line diff via LCS, with common prefix/suffix trimmed first. */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "eq", line: a[i] as string });
  ops.push(...lcsOps(midA, midB));
  for (let i = endA; i < a.length; i++) ops.push({ type: "eq", line: a[i] as string });
  return ops;
}

/** Classic LCS dynamic program over the trimmed middle. */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ type: "ins" as const, line }));
  if (m === 0) return a.map((line) => ({ type: "del" as const, line }));

  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? (lengths[(i + 1) * width + j + 1] as number) + 1
          : Math.max(
              lengths[(i + 1) * width + j] as number,
              lengths[i * width + j + 1] as number,
            );
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", line: a[i] as string });
      i++;
      j++;
    } else if (
      (lengths[(i + 1) * width + j] as number) >= (lengths[i * width + j + 1] as number)
    ) {
      ops.push({ type: "del", line: a[i] as string });
      i++;
    } else {
      ops.push({ type: "ins", line: b[j] as string });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++] as string });
  while (j < m) ops.push({ type: "ins", line: b[j++] as string });
  return ops;
}

/** Group diff ops into unified hunks with `context` lines around changes. */
export function buildHunks(ops: DiffOp[], context = 2): Hunk[] {
  // Mark which op indices are kept (changes ± context).
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if ((ops[i] as DiffOp).type === "eq") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) {
      keep[k] = true;
    }
  }

  const hunks: Hunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let current: Hunk | null = null;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as DiffOp;
    if (keep[i]) {
      if (!current) {
        current = { oldStart: oldLine, oldCount: 0, newStart: newLine, newCount: 0, ops: [] };
        hunks.push(current);
      }
      current.ops.push(op);
      if (op.type !== "ins") current.oldCount++;
      if (op.type !== "del") current.newCount++;
    } else {
      current = null;
    }
    if (op.type !== "ins") oldLine++;
    if (op.type !== "del") newLine++;
  }
  return hunks;
}

/** Render hunks in classic `@@ -l,n +l,n @@` unified format. */
export function formatHunks(hunks: Hunk[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    for (const op of hunk.ops) {
      const sign = op.type === "eq" ? " " : op.type === "del" ? "-" : "+";
      out.push(sign + op.line);
    }
  }
  return out;
}

/** Diff two message arrays (old = snapshot, new = fresh render). */
export function diffMessages(
  oldMessages: Message[],
  newMessages: Message[],
  context = 2,
): MessagesDiff {
  const changes: MessageChange[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  const max = Math.max(oldMessages.length, newMessages.length);

  for (let i = 0; i < max; i++) {
    const oldMsg = oldMessages[i];
    const newMsg = newMessages[i];
    if (oldMsg && !newMsg) {
      removed++;
      changes.push({ index: i, kind: "removed", oldRole: oldMsg.role });
      continue;
    }
    if (!oldMsg && newMsg) {
      added++;
      changes.push({ index: i, kind: "added", newRole: newMsg.role });
      continue;
    }
    if (!oldMsg || !newMsg) continue; // unreachable; satisfies narrowing
    const roleChanged = oldMsg.role !== newMsg.role;
    const contentChanged = oldMsg.content !== newMsg.content;
    if (!roleChanged && !contentChanged) {
      changes.push({ index: i, kind: "same", oldRole: oldMsg.role, newRole: newMsg.role });
      continue;
    }
    changed++;
    const change: MessageChange = {
      index: i,
      kind: roleChanged && contentChanged ? "role+content" : roleChanged ? "role" : "content",
      oldRole: oldMsg.role,
      newRole: newMsg.role,
    };
    if (contentChanged) {
      change.hunks = buildHunks(
        diffLines(oldMsg.content.split("\n"), newMsg.content.split("\n")),
        context,
      );
    }
    changes.push(change);
  }

  return {
    identical: changed === 0 && added === 0 && removed === 0,
    changes,
    changed,
    added,
    removed,
    total: max,
  };
}
