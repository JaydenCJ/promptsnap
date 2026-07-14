/**
 * Shared types for promptsnap: chat messages, parsed templates,
 * fixtures, snapshots and diffs. Everything here is plain data —
 * no class instances cross module boundaries.
 */

/** One rendered chat message — the unit every snapshot is made of. */
export interface Message {
  role: string;
  content: string;
}

/** Source location inside a `.prompt` file (1-based). */
export interface Loc {
  line: number;
  col: number;
}

/** A filter applied to a variable expression, e.g. `join:", "`. */
export interface FilterCall {
  name: string;
  /** Raw argument as written (unquoted); undefined when none was given. */
  arg?: string;
}

/** Template AST node kinds. */
export type Node = TextNode | VarNode | IfNode | EachNode;

export interface TextNode {
  kind: "text";
  value: string;
}

export interface VarNode {
  kind: "var";
  path: string;
  filters: FilterCall[];
  loc: Loc;
}

export interface IfNode {
  kind: "if";
  path: string;
  negated: boolean;
  then: Node[];
  otherwise: Node[];
  loc: Loc;
}

export interface EachNode {
  kind: "each";
  path: string;
  item: string;
  body: Node[];
  loc: Loc;
}

/** One `--- role` section of a `.prompt` file, parsed but not rendered. */
export interface MessageTemplate {
  role: string;
  nodes: Node[];
  /** Line of the `--- role` header, for error reporting. */
  loc: Loc;
}

/** A parsed `.prompt` file. */
export interface PromptTemplate {
  /** Path as given to the parser (used in errors and reports). */
  path: string;
  messages: MessageTemplate[];
}

/** One named variable set a template is rendered with. */
export interface Fixture {
  name: string;
  vars: Record<string, unknown>;
  /** Path of the fixtures file, or undefined for the implicit `default`. */
  path?: string;
}

/** A (template, fixture) pair — one snapshot per pair. */
export interface Pair {
  templatePath: string;
  fixture: Fixture;
}

/** The on-disk snapshot document (`*.snap.json`). */
export interface Snapshot {
  /** Format version; bump only on breaking snapshot-format changes. */
  promptsnap: 1;
  template: string;
  fixture: string;
  messages: Message[];
}

/** Line-diff operation. */
export interface DiffOp {
  type: "eq" | "del" | "ins";
  line: string;
}

/** A unified-diff hunk over two line arrays. */
export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  ops: DiffOp[];
}

/** How one message position changed between snapshot and re-render. */
export type MessageChangeKind =
  | "same"
  | "role"
  | "content"
  | "role+content"
  | "added"
  | "removed";

export interface MessageChange {
  index: number;
  kind: MessageChangeKind;
  oldRole?: string;
  newRole?: string;
  /** Content hunks, present when kind includes "content". */
  hunks?: Hunk[];
}

/** Full diff between two message arrays. */
export interface MessagesDiff {
  identical: boolean;
  changes: MessageChange[];
  changed: number;
  added: number;
  removed: number;
  total: number;
}

/** Outcome of checking one pair against its snapshot. */
export type PairStatus = "match" | "mismatch" | "missing" | "error";

export interface PairResult {
  templatePath: string;
  fixture: string;
  snapshotPath: string;
  status: PairStatus;
  diff?: MessagesDiff;
  error?: string;
}
