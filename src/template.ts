/**
 * The template expression engine: tokenizer + parser for the
 * `{{ … }}` syntax used inside `.prompt` message bodies.
 *
 * Supported forms:
 *   {{ path }}                       variable (dot / [n] segments)
 *   {{ path | filter | f:arg }}     filters: json, upper, lower, trim,
 *                                    join:sep, default:value, indent:n
 *   {{#if path}} … {{else}} … {{/if}}        (also {{#if !path}})
 *   {{#each path as item}} … {{/each}}       with @index/@first/@last
 *   \{{                              escapes a literal `{{`
 *
 * The parser is strict: unknown tag shapes, unclosed tags and
 * mismatched blocks are errors with a 1-based line:col location.
 */
import type { EachNode, FilterCall, IfNode, Loc, Node } from "./types.js";

/** Error raised for any template parse or render problem. */
export class TemplateError extends Error {
  readonly loc?: Loc;
  constructor(message: string, loc?: Loc) {
    super(loc ? `${message} (line ${loc.line}, col ${loc.col})` : message);
    this.name = "TemplateError";
    this.loc = loc;
  }
}

const PATH_RE = /^@?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[\d+\])*$/;
const FILTER_NAMES = new Set([
  "json",
  "upper",
  "lower",
  "trim",
  "join",
  "default",
  "indent",
]);

interface RawTag {
  kind: "text" | "tag";
  value: string;
  loc: Loc;
}

/** Precompute offsets of line starts so offsets map to line:col fast. */
function lineIndex(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function locAt(starts: number[], offset: number, lineOffset: number): Loc {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1 + lineOffset, col: offset - (starts[lo] as number) + 1 };
}

/** Split source into literal text and `{{ … }}` tag tokens. */
function tokenize(src: string, lineOffset: number): RawTag[] {
  const starts = lineIndex(src);
  const out: RawTag[] = [];
  let text = "";
  let textStart = 0;
  let i = 0;
  const flush = () => {
    if (text.length > 0) {
      out.push({ kind: "text", value: text, loc: locAt(starts, textStart, lineOffset) });
      text = "";
    }
  };
  while (i < src.length) {
    if (src[i] === "\\" && src.startsWith("{{", i + 1)) {
      if (text.length === 0) textStart = i;
      text += "{{";
      i += 3;
      continue;
    }
    if (src.startsWith("{{", i)) {
      const close = src.indexOf("}}", i + 2);
      if (close === -1) {
        throw new TemplateError("unclosed {{ tag", locAt(starts, i, lineOffset));
      }
      flush();
      out.push({
        kind: "tag",
        value: src.slice(i + 2, close).trim(),
        loc: locAt(starts, i, lineOffset),
      });
      i = close + 2;
      textStart = i;
      continue;
    }
    if (text.length === 0) textStart = i;
    text += src[i];
    i++;
  }
  flush();
  return out;
}

const BLOCK_TAG_RE = /^(#if\b|#each\b|else$|\/if$|\/each$)/;

/**
 * Standalone-line stripping (mustache-style): a block tag that sits
 * alone on its source line — only whitespace around it — must not
 * leave a blank line behind in the rendered prompt. Standalone-ness
 * is computed against the ORIGINAL neighbor text first, then strips
 * are applied, so chains like `{{#if}}\n{{else}}\n{{/if}}` all strip.
 */
function stripStandaloneBlockLines(tokens: RawTag[]): void {
  const standalone: boolean[] = tokens.map((tok, i) => {
    if (tok.kind !== "tag" || !BLOCK_TAG_RE.test(tok.value)) return false;
    const prev = i > 0 ? (tokens[i - 1] as RawTag) : null;
    const next = i < tokens.length - 1 ? (tokens[i + 1] as RawTag) : null;
    const prevOk =
      prev === null
        ? true
        : prev.kind === "text" &&
          (/\n[ \t]*$/.test(prev.value) || (i === 1 && /^[ \t]*$/.test(prev.value)));
    const nextOk =
      next === null
        ? true
        : next.kind === "text" &&
          (/^[ \t]*\n/.test(next.value) ||
            (i === tokens.length - 2 && /^[ \t]*$/.test(next.value)));
    return prevOk && nextOk;
  });
  for (let i = 0; i < tokens.length; i++) {
    if (!standalone[i]) continue;
    const prev = i > 0 ? (tokens[i - 1] as RawTag) : null;
    const next = i < tokens.length - 1 ? (tokens[i + 1] as RawTag) : null;
    if (prev && prev.kind === "text") prev.value = prev.value.replace(/[ \t]*$/, "");
    if (next && next.kind === "text") next.value = next.value.replace(/^[ \t]*\n?/, "");
  }
}

/** Parse `path | f | f:arg | …` — the inside of a variable tag. */
function parseExpression(raw: string, loc: Loc): { path: string; filters: FilterCall[] } {
  const parts = splitFilters(raw);
  const path = (parts[0] ?? "").trim();
  if (!PATH_RE.test(path)) {
    throw new TemplateError(`invalid variable path "${path}"`, loc);
  }
  const filters: FilterCall[] = [];
  for (const part of parts.slice(1)) {
    const seg = part.trim();
    const colon = seg.indexOf(":");
    const name = (colon === -1 ? seg : seg.slice(0, colon)).trim();
    if (!FILTER_NAMES.has(name)) {
      throw new TemplateError(
        `unknown filter "${name}" (known: ${[...FILTER_NAMES].join(", ")})`,
        loc,
      );
    }
    if (colon === -1) {
      filters.push({ name });
    } else {
      filters.push({ name, arg: unquote(seg.slice(colon + 1).trim(), loc) });
    }
  }
  return { path, filters };
}

/** Split on `|` at top level, respecting quoted filter arguments. */
function splitFilters(raw: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (quote !== null) {
      cur += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        cur += raw[i + 1];
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Strip surrounding quotes from a filter argument, handling `\"`. */
function unquote(raw: string, loc: Loc): string {
  if (raw.length >= 2) {
    const first = raw[0];
    if ((first === '"' || first === "'") && raw.endsWith(first)) {
      const body = raw.slice(1, -1);
      let out = "";
      for (let i = 0; i < body.length; i++) {
        if (body[i] === "\\" && i + 1 < body.length) {
          const next = body[i + 1] as string;
          out += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i++;
        } else {
          out += body[i];
        }
      }
      return out;
    }
    if (first === '"' || first === "'") {
      throw new TemplateError(`unterminated quoted filter argument ${raw}`, loc);
    }
  }
  return raw;
}

/**
 * Parse template source into an AST.
 *
 * `lineOffset` shifts every reported line so errors point into the
 * enclosing `.prompt` file rather than the section body.
 */
export function parseTemplate(src: string, lineOffset = 0): Node[] {
  const tokens = tokenize(src, lineOffset);
  stripStandaloneBlockLines(tokens);
  const root: Node[] = [];
  interface Frame {
    node: IfNode | EachNode;
    /** For if-frames: currently filling the else branch? */
    inElse: boolean;
  }
  const stack: Frame[] = [];
  const sink = (): Node[] => {
    const top = stack[stack.length - 1];
    if (!top) return root;
    if (top.node.kind === "if") return top.inElse ? top.node.otherwise : top.node.then;
    return top.node.body;
  };

  for (const tok of tokens) {
    if (tok.kind === "text") {
      sink().push({ kind: "text", value: tok.value });
      continue;
    }
    const tag = tok.value;
    if (tag.startsWith("#if")) {
      const rest = tag.slice(3).trim();
      const negated = rest.startsWith("!");
      const path = (negated ? rest.slice(1) : rest).trim();
      if (!PATH_RE.test(path)) {
        throw new TemplateError(`invalid #if condition "${rest}"`, tok.loc);
      }
      const node: IfNode = { kind: "if", path, negated, then: [], otherwise: [], loc: tok.loc };
      sink().push(node);
      stack.push({ node, inElse: false });
    } else if (tag === "else") {
      const top = stack[stack.length - 1];
      if (!top || top.node.kind !== "if" || top.inElse) {
        throw new TemplateError("{{else}} outside of an open {{#if}}", tok.loc);
      }
      top.inElse = true;
    } else if (tag === "/if") {
      const top = stack.pop();
      if (!top || top.node.kind !== "if") {
        throw new TemplateError("{{/if}} without a matching {{#if}}", tok.loc);
      }
    } else if (tag.startsWith("#each")) {
      const m = /^#each\s+(\S+)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(tag);
      if (!m) {
        throw new TemplateError(
          `malformed each tag "{{${tag}}}" — expected {{#each path as item}}`,
          tok.loc,
        );
      }
      const path = m[1] as string;
      if (!PATH_RE.test(path)) {
        throw new TemplateError(`invalid #each path "${path}"`, tok.loc);
      }
      const node: EachNode = {
        kind: "each",
        path,
        item: m[2] as string,
        body: [],
        loc: tok.loc,
      };
      sink().push(node);
      stack.push({ node, inElse: false });
    } else if (tag === "/each") {
      const top = stack.pop();
      if (!top || top.node.kind !== "each") {
        throw new TemplateError("{{/each}} without a matching {{#each}}", tok.loc);
      }
    } else if (tag.startsWith("#") || tag.startsWith("/")) {
      throw new TemplateError(`unknown block tag "{{${tag}}}"`, tok.loc);
    } else {
      const { path, filters } = parseExpression(tag, tok.loc);
      sink().push({ kind: "var", path, filters, loc: tok.loc });
    }
  }

  const open = stack[stack.length - 1];
  if (open) {
    const what = open.node.kind === "if" ? "{{#if}}" : "{{#each}}";
    throw new TemplateError(
      `unclosed ${what} opened at line ${open.node.loc.line}, col ${open.node.loc.col}`,
    );
  }
  return root;
}
