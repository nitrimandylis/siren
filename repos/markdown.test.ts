import { expect, test } from "bun:test";
import { richText, toBlocks } from "./markdown";

function types(markdown: string): string[] {
  return toBlocks(markdown).map((block: any) => block.type);
}

function firstText(markdown: string): string {
  const block = toBlocks(markdown)[0] as any;
  return block[block.type].rich_text.map((part: any) => part.text.content).join("");
}

test("headings, lists, quotes and dividers map to their block types", () => {
  expect(types("# One\n## Two\n### Three")).toEqual(["heading_1", "heading_2", "heading_3"]);
  expect(types("- a\n* b\n1. c")).toEqual([
    "bulleted_list_item",
    "bulleted_list_item",
    "numbered_list_item",
  ]);
  expect(types("> quoted\n\n---")).toEqual(["quote", "divider"]);
});

test("list and heading markers are stripped from the text", () => {
  expect(firstText("## What is this")).toBe("What is this");
  expect(firstText("- a bullet")).toBe("a bullet");
  expect(firstText("3. third")).toBe("third");
});

test("fenced code keeps its body and maps the language to Notion's list", () => {
  const block = toBlocks("```ts\nconst x = 1;\nconst y = 2;\n```")[0] as any;
  expect(block.type).toBe("code");
  expect(block.code.language).toBe("typescript");
  expect(block.code.rich_text[0].text.content).toBe("const x = 1;\nconst y = 2;");
});

test("an unknown code language falls back to plain text, not an API error", () => {
  const block = toBlocks("```rustlang\nfn main() {}\n```")[0] as any;
  expect(block.code.language).toBe("plain text");
});

test("a table becomes one code block, not a paragraph per row", () => {
  const table = "| a | b |\n|---|---|\n| 1 | 2 |";
  const blocks = toBlocks(table) as any[];
  expect(blocks.length).toBe(1);
  expect(blocks[0].type).toBe("code");
  expect(blocks[0].code.rich_text[0].text.content).toContain("| 1 | 2 |");
});

test("badge rows and raw HTML are dropped", () => {
  expect(toBlocks('<div align="center">\n</div>')).toEqual([]);
  expect(toBlocks("![runtime](https://img.shields.io/badge/x) ![ci](https://img.shields.io/y)")).toEqual([]);
  expect(types("![badge](https://x)\n\nreal text")).toEqual(["paragraph"]);
});

test("inline links, code and bold become annotated rich text", () => {
  const parts = richText("see [ntfy](https://ntfy.sh) and `watch.ts` for **details**") as any[];
  expect(parts.map((p) => p.text.content)).toEqual([
    "see ",
    "ntfy",
    " and ",
    "watch.ts",
    " for ",
    "details",
  ]);
  expect(parts[1].text.link.url).toBe("https://ntfy.sh");
  expect(parts[3].annotations.code).toBe(true);
  expect(parts[5].annotations.bold).toBe(true);
});

test("bold wins over italic where both could match", () => {
  const parts = richText("**strong** and *soft*") as any[];
  expect(parts.map((p) => p.text.content)).toEqual(["strong", " and ", "soft"]);
  expect(parts[0].annotations.bold).toBe(true);
  expect(parts[2].annotations.italic).toBe(true);
});

test("relative link targets become plain text, since Notion rejects them", () => {
  // [MIT](LICENSE) in a README 400s the whole append with "Invalid URL for link".
  const parts = richText("licensed [MIT](LICENSE), see [notes](#setup)") as any[];
  expect(parts.map((p) => p.text.content)).toEqual(["licensed ", "MIT", ", see ", "notes"]);
  expect(parts[1].text.link).toBeUndefined();
  expect(parts[3].text.link).toBeUndefined();
});

test("absolute http and mailto links are kept", () => {
  const parts = richText("[site](https://ntfy.sh) [mail](mailto:a@b.com)") as any[];
  expect(parts[0].text.link.url).toBe("https://ntfy.sh");
  expect(parts[2].text.link.url).toBe("mailto:a@b.com");
});

test("a line with no markup is one plain part", () => {
  const parts = richText("just words") as any[];
  expect(parts.length).toBe(1);
  expect(parts[0].text.content).toBe("just words");
  expect(parts[0].annotations).toBeUndefined();
});

test("text is capped at Notion's 2000 character limit", () => {
  const parts = richText("x".repeat(2500)) as any[];
  expect(parts[0].text.content.length).toBe(2000);
});
