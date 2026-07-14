/**
 * Parser for the `.prompt` file format: a plain-text file split into
 * chat messages by `--- role` header lines.
 *
 *   # comment lines are allowed before the first section only
 *   --- system
 *   You are a support agent for {{ product }}.
 *   --- user
 *   {{ question }}
 *
 * Rules:
 *   - roles are lowercase tokens (`system`, `user`, `assistant`,
 *     `tool`, …); a role may repeat, which is how few-shot turns and
 *     multi-turn transcripts are written;
 *   - inside a section every line is content — `#` is NOT a comment
 *     there (prompts legitimately contain Markdown headings);
 *   - a content line that must literally start with `---` is written
 *     as `\---`;
 *   - leading and trailing blank lines of each section are trimmed,
 *     interior blank lines are preserved byte-for-byte;
 *   - CRLF input is normalized to LF before parsing.
 */
import { TemplateError, parseTemplate } from "./template.js";
import type { MessageTemplate, PromptTemplate } from "./types.js";

const HEADER_RE = /^---\s+(\S+)\s*$/;
const ROLE_RE = /^[a-z][a-z0-9_-]*$/;

/** Roles listed in docs; anything matching ROLE_RE is still accepted. */
export const WELL_KNOWN_ROLES = ["system", "developer", "user", "assistant", "tool"];

interface RawSection {
  role: string;
  headerLine: number;
  lines: string[];
  firstContentLine: number;
}

/** Parse `.prompt` source text. `path` is used only for error messages. */
export function parsePromptSource(src: string, path: string): PromptTemplate {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const header = HEADER_RE.exec(line);
    if (header) {
      const role = header[1] as string;
      if (!ROLE_RE.test(role)) {
        throw new TemplateError(
          `${path}: invalid role "${role}" on line ${i + 1} — roles are lowercase tokens like ${WELL_KNOWN_ROLES.join(", ")}`,
        );
      }
      current = { role, headerLine: i + 1, lines: [], firstContentLine: i + 2 };
      sections.push(current);
      continue;
    }
    if (current === null) {
      // Before the first section: blank lines and # comments only.
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      throw new TemplateError(
        `${path}: content before the first "--- role" header (line ${i + 1})`,
      );
    }
    // `\---` escapes a literal leading `---` in content.
    current.lines.push(line.startsWith("\\---") ? line.slice(1) : line);
  }

  if (sections.length === 0) {
    throw new TemplateError(
      `${path}: no message sections — a .prompt file needs at least one "--- role" header`,
    );
  }

  const messages: MessageTemplate[] = sections.map((section) => {
    // Trim leading/trailing blank lines but keep the interior intact,
    // tracking how many leading lines were dropped so template errors
    // still point at the right line of the file.
    let start = 0;
    let end = section.lines.length;
    while (start < end && (section.lines[start] as string).trim() === "") start++;
    while (end > start && (section.lines[end - 1] as string).trim() === "") end--;
    const body = section.lines.slice(start, end).join("\n");
    const lineOffset = section.firstContentLine + start - 1;
    let nodes;
    try {
      nodes = parseTemplate(body, lineOffset);
    } catch (err) {
      if (err instanceof TemplateError) {
        throw new TemplateError(`${path}: ${err.message}`);
      }
      throw err;
    }
    return {
      role: section.role,
      nodes,
      loc: { line: section.headerLine, col: 1 },
    };
  });

  return { path, messages };
}
