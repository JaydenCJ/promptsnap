/**
 * Public programmatic API. Everything the CLI does is reachable from
 * here, so a Jest/Vitest/node:test suite can assert on rendered
 * message arrays directly instead of shelling out:
 *
 *   import { parsePromptSource, renderPrompt } from "promptsnap";
 *   const t = parsePromptSource(src, "triage.prompt");
 *   const messages = renderPrompt(t, { question: "hi" });
 */
export { parseTemplate, TemplateError } from "./template.js";
export { normalizeContent, renderNodes, renderPrompt, truthy } from "./render.js";
export { parsePromptSource, WELL_KNOWN_ROLES } from "./promptfile.js";
export {
  FIXTURES_SUFFIX,
  TEMPLATE_SUFFIX,
  fixturesPathFor,
  loadFixtures,
  parseFixtures,
} from "./fixtures.js";
export {
  SNAP_DIR,
  SNAP_SUFFIX,
  makeSnapshot,
  messagesEqual,
  parseSnapshot,
  readSnapshot,
  serializeSnapshot,
  snapshotPathFor,
} from "./snapshot.js";
export { buildHunks, diffLines, diffMessages, formatHunks } from "./diff.js";
export { collectPairs, discover } from "./discover.js";
export type {
  DiffOp,
  EachNode,
  FilterCall,
  Fixture,
  Hunk,
  IfNode,
  Loc,
  Message,
  MessageChange,
  MessageChangeKind,
  MessagesDiff,
  MessageTemplate,
  Node,
  Pair,
  PairResult,
  PairStatus,
  PromptTemplate,
  Snapshot,
  TextNode,
  VarNode,
} from "./types.js";
export { VERSION } from "./version.js";
