// A small markdown -> Notion blocks converter. Notion's REST API takes block
// objects, not markdown, and READMEs use maybe a dozen constructs, so this
// handles those and lets everything else fall through to a paragraph.
//
// ponytail: deliberately not a full markdown parser. Tables become code
// blocks and raw HTML is dropped. Swap in a real parser only if a README
// shows up that this mangles badly enough to matter.

const TEXT_LIMIT = 2000; // Notion rejects any single text value longer than this

// Notion only accepts languages from its own list; anything else is an error.
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  py: "python",
  python: "python",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  console: "shell",
  html: "html",
  css: "css",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  markdown: "markdown",
  md: "markdown",
  mermaid: "mermaid",
};

// [text](url) | `code` | **bold** | *italic* — bold before italic, so the
// two-star form wins at any position where both could match.
const INLINE = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function plain(content: string) {
  return { type: "text", text: { content: content.slice(0, TEXT_LIMIT) } };
}

// Notion only accepts absolute URLs, and one bad link fails the entire append
// with "Invalid URL for link" — so a relative target like [MIT](LICENSE) or an
// anchor like [setup](#setup) would take a whole README down with it. Those
// keep their text and lose the link.
// ponytail: could resolve them against the repo's blob URL instead; plain text
// is enough until a dropped link actually costs something.
function isAbsolute(url: string): boolean {
  return /^(https?|mailto):/i.test(url);
}

export function richText(line: string): object[] {
  const parts: object[] = [];
  let cursor = 0;

  for (const match of line.matchAll(INLINE)) {
    const start = match.index;
    if (start > cursor) parts.push(plain(line.slice(cursor, start)));

    const [, linkText, url, code, bold, italic] = match;
    if (url !== undefined) {
      parts.push(
        isAbsolute(url)
          ? { type: "text", text: { content: linkText, link: { url } } }
          : plain(linkText),
      );
    } else if (code !== undefined) {
      parts.push({ ...plain(code), annotations: { code: true } });
    } else if (bold !== undefined) {
      parts.push({ ...plain(bold), annotations: { bold: true } });
    } else {
      parts.push({ ...plain(italic), annotations: { italic: true } });
    }
    cursor = start + match[0].length;
  }

  if (cursor < line.length) parts.push(plain(line.slice(cursor)));
  return parts.length === 0 ? [plain("")] : parts;
}

function block(type: string, line: string) {
  return { object: "block", type, [type]: { rich_text: richText(line) } };
}

function codeBlock(lines: string[], language: string) {
  const content = lines.join("\n").slice(0, TEXT_LIMIT);
  return {
    object: "block",
    type: "code",
    code: {
      rich_text: [{ type: "text", text: { content } }],
      language: LANGUAGES[language.toLowerCase()] ?? "plain text",
    },
  };
}

// Badge rows and centering divs carry nothing once they're out of GitHub.
function isNoise(line: string): boolean {
  if (line.startsWith("<")) return true;
  if (line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim() === "") return true;
  return false;
}

export function toBlocks(markdown: string): object[] {
  const lines = markdown.split("\n");
  const blocks: object[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      blocks.push(codeBlock(body, language));
      continue;
    }

    // Consecutive pipe rows are a table; keep them intact rather than
    // rebuilding them as Notion table + table_row blocks.
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].trim());
        i++;
      }
      i--;
      blocks.push(codeBlock(rows, ""));
      continue;
    }

    if (line === "" || isNoise(line)) continue;

    if (line === "---" || line === "***") {
      blocks.push({ object: "block", type: "divider", divider: {} });
    } else if (line.startsWith("### ")) {
      blocks.push(block("heading_3", line.slice(4)));
    } else if (line.startsWith("## ")) {
      blocks.push(block("heading_2", line.slice(3)));
    } else if (line.startsWith("# ")) {
      blocks.push(block("heading_1", line.slice(2)));
    } else if (line.startsWith("> ")) {
      blocks.push(block("quote", line.slice(2)));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push(block("bulleted_list_item", line.slice(2)));
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push(block("numbered_list_item", line.replace(/^\d+\.\s/, "")));
    } else {
      blocks.push(block("paragraph", line));
    }
  }

  return blocks;
}
