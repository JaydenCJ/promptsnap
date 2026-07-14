/**
 * The renderer: walks a template AST with a variable scope stack and
 * produces the final string (and, one level up, the final message
 * array). Rendering is strict — a variable the fixture does not
 * provide is an error with the exact template location, because a
 * silently-empty prompt is precisely the bug promptsnap exists to
 * catch. `{{#if}}` on a missing path is the one deliberate exception:
 * it evaluates to false so optional flags stay optional.
 */
import { TemplateError } from "./template.js";
import type {
  EachNode,
  FilterCall,
  Loc,
  Message,
  Node,
  PromptTemplate,
  VarNode,
} from "./types.js";

type Scope = Record<string, unknown>;

interface Resolved {
  found: boolean;
  value: unknown;
}

/** Split `a.b[0].c` into segments: ["a", "b", "0", "c"]. */
function segmentsOf(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);
}

/** Walk the scope stack (innermost first) and resolve a path. */
function resolve(path: string, scopes: Scope[]): Resolved {
  const segments = segmentsOf(path);
  const head = segments[0] as string;
  for (let s = scopes.length - 1; s >= 0; s--) {
    const scope = scopes[s] as Scope;
    if (!Object.prototype.hasOwnProperty.call(scope, head)) continue;
    let value: unknown = scope[head];
    for (const seg of segments.slice(1)) {
      if (value === null || value === undefined) return { found: false, value: undefined };
      if (Array.isArray(value)) {
        if (!/^\d+$/.test(seg)) return { found: false, value: undefined };
        const idx = Number(seg);
        if (idx >= value.length) return { found: false, value: undefined };
        value = value[idx];
      } else if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(obj, seg)) {
          return { found: false, value: undefined };
        }
        value = obj[seg];
      } else {
        return { found: false, value: undefined };
      }
    }
    return { found: true, value };
  }
  return { found: false, value: undefined };
}

/** Truthiness for {{#if}}: empty string / empty array / 0 are false. */
export function truthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value === "" || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  if (value === null) return "null";
  const t = typeof value;
  return t === "object" || t === "undefined" ? `an ${t}` : `a ${t}`;
}

function availableNames(scopes: Scope[]): string {
  const names = new Set<string>();
  for (const scope of scopes) {
    for (const key of Object.keys(scope)) names.add(key);
  }
  const sorted = [...names].sort();
  return sorted.length === 0 ? "none" : sorted.join(", ");
}

function applyFilter(value: unknown, filter: FilterCall, loc: Loc): unknown {
  const { name, arg } = filter;
  switch (name) {
    case "json": {
      if (arg !== undefined) {
        const indent = Number(arg);
        if (!Number.isInteger(indent) || indent < 0 || indent > 10) {
          throw new TemplateError(`json filter indent must be 0–10, got "${arg}"`, loc);
        }
        return JSON.stringify(value, null, indent);
      }
      return JSON.stringify(value);
    }
    case "upper":
      return asString(value, "upper", loc).toUpperCase();
    case "lower":
      return asString(value, "lower", loc).toLowerCase();
    case "trim":
      return asString(value, "trim", loc).trim();
    case "join": {
      if (!Array.isArray(value)) {
        throw new TemplateError(`join filter needs an array, got ${describe(value)}`, loc);
      }
      const sep = arg ?? ", ";
      return value
        .map((item, i) => {
          const t = typeof item;
          if (t === "string" || t === "number" || t === "boolean") return String(item);
          throw new TemplateError(
            `join filter needs scalar items, item ${i} is ${describe(item)}`,
            loc,
          );
        })
        .join(sep);
    }
    case "indent": {
      const n = Number(arg ?? "2");
      if (!Number.isInteger(n) || n < 0 || n > 40) {
        throw new TemplateError(`indent filter needs 0–40 spaces, got "${arg}"`, loc);
      }
      const pad = " ".repeat(n);
      return asString(value, "indent", loc)
        .split("\n")
        .map((line) => (line.length > 0 ? pad + line : line))
        .join("\n");
    }
    default:
      // `default` is handled in evaluate() because it changes found-ness.
      throw new TemplateError(`unknown filter "${name}"`, loc);
  }
}

function asString(value: unknown, filter: string, loc: Loc): string {
  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number" || t === "boolean") return String(value);
  throw new TemplateError(`${filter} filter needs a string, got ${describe(value)}`, loc);
}

/** Evaluate a variable node to its final string. */
function evaluate(node: VarNode, scopes: Scope[]): string {
  let { found, value } = resolve(node.path, scopes);
  for (const filter of node.filters) {
    if (filter.name === "default") {
      if (!found || value === undefined || value === null || value === "") {
        value = filter.arg ?? "";
        found = true;
      }
      continue;
    }
    if (!found) break; // fall through to the missing-variable error below
    value = applyFilter(value, filter, node.loc);
  }
  if (!found) {
    throw new TemplateError(
      `unknown variable "${node.path}" — fixture provides: ${availableNames(scopes)}`,
      node.loc,
    );
  }
  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number" || t === "boolean" || t === "bigint") return String(value);
  if (value === null || value === undefined) {
    throw new TemplateError(
      `variable "${node.path}" is ${describe(value)} — use | default:"…" for optional values`,
      node.loc,
    );
  }
  throw new TemplateError(
    `variable "${node.path}" is ${describe(value)} — render it with | json or | join`,
    node.loc,
  );
}

function renderEach(node: EachNode, scopes: Scope[]): string {
  const { found, value } = resolve(node.path, scopes);
  if (!found) {
    throw new TemplateError(
      `unknown list "${node.path}" in {{#each}} — fixture provides: ${availableNames(scopes)}`,
      node.loc,
    );
  }
  if (!Array.isArray(value)) {
    throw new TemplateError(
      `{{#each ${node.path}}} needs an array, got ${describe(value)}`,
      node.loc,
    );
  }
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const loop: Scope = {
      [node.item]: value[i],
      "@index": i,
      "@first": i === 0,
      "@last": i === value.length - 1,
    };
    out += renderNodes(node.body, [...scopes, loop]);
  }
  return out;
}

/** Render an AST to a string with the given scope stack. */
export function renderNodes(nodes: Node[], scopes: Scope[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += node.value;
        break;
      case "var":
        out += evaluate(node, scopes);
        break;
      case "if": {
        const { value } = resolve(node.path, scopes); // missing ⇒ false
        const pass = node.negated ? !truthy(value) : truthy(value);
        out += renderNodes(pass ? node.then : node.otherwise, scopes);
        break;
      }
      case "each":
        out += renderEach(node, scopes);
        break;
    }
  }
  return out;
}

/**
 * Rendered-content normalization: leading blank lines and ALL trailing
 * whitespace are stripped from every message. Conditional blocks and
 * loops that render empty would otherwise leave invisible whitespace
 * that flips snapshots without any visible prompt change.
 */
export function normalizeContent(content: string): string {
  return content.replace(/^(?:[ \t]*\n)+/, "").replace(/[ \t\n]+$/, "");
}

/**
 * Render a parsed `.prompt` template with one fixture's variables into
 * the final message array. Errors are re-thrown with the template path
 * prefixed so CLI output always says which file failed.
 */
export function renderPrompt(
  template: PromptTemplate,
  vars: Record<string, unknown>,
): Message[] {
  const messages: Message[] = [];
  for (const section of template.messages) {
    try {
      messages.push({
        role: section.role,
        content: normalizeContent(renderNodes(section.nodes, [vars])),
      });
    } catch (err) {
      if (err instanceof TemplateError) {
        throw new TemplateError(`${template.path}: ${err.message}`);
      }
      throw err;
    }
  }
  return messages;
}
