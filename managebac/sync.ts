// Keeps the Notion "Assignments" database in step with ManageBac's Tasks &
// Deadlines: adds a row for every task that has none, and refreshes Due where
// ManageBac has moved it. Pushes a summary only when something changed.
//
// The scraping lives in bacpack, checked out next to this file (see the
// workflow). This script is the glue bacpack deliberately refuses to be.
//
// Needs MANAGEBAC_SCHOOL, a session cookie at ~/.config/managebac/cookie, and
// NOTION_TOKEN (internal integration with the database shared to it).

import { readFileSync, writeFileSync } from "node:fs";
import { listClasses } from "../bacpack/src/client.ts";
import { listDiscussions, type Discussion } from "../bacpack/src/classes.ts";
import { fetchTasks, type Task } from "../bacpack/src/due.ts";
import { ping } from "../ntfy";
import { notion } from "../notion";
import { classify, type Verdict } from "./classify.ts";

// Discussion ids are a global ascending sequence: 31 posts spanning Oct 2025 to
// Jun 2026 across nine classes sorted by id in exactly date order, with no
// inversions. So "what is new" is one integer rather than a per-class list.
const SEEN_PATH = new URL("seen.txt", import.meta.url).pathname;

// Notes is a rich_text property and a single text run tops out at 2000
// characters. No post has come close, but a truncated note beats a failed run.
const MAX_NOTE = 1900;

const DATABASE_ID = "223cc494-686e-41c4-a564-ae020263974e";
const DATABASE_URL = "https://www.notion.so/223cc494686e41c4a564ae020263974e";

// ManageBac class names against the Assignments database's own vocabulary.
// Substring, lowercased, first match wins. Class names carry year suffixes
// and stream codes that change every September, so exact matching would rot
// annually. Anything unmapped lands in "Other" and gets corrected by hand.
// Checked against all nine real class names on 2026-08-03; sync.test.ts pins
// them. "tok" stays last because it is short enough to hide inside a longer
// word, and every other needle is more specific.
const SUBJECTS: [needle: string, subject: string][] = [
  ["computer science", "CS HL"],
  ["math", "Math AA HL"],
  ["english", "English B HL"],
  ["business", "Business SL"],
  ["greek", "Modern Greek A SL"],
  ["global politics", "Global Politics SL"],
  ["tok", "TOK"],
];

export type Row = {
  pageId: string;
  taskId: string;
  due: string | null; // "YYYY-MM-DD"
};

export type Plan = {
  create: Task[];
  touch: { pageId: string; title: string; due: string }[];
};

export function subjectFor(className: string): string {
  const name = className.toLowerCase();
  for (const [needle, subject] of SUBJECTS) {
    if (name.includes(needle)) return subject;
  }
  return "Other";
}

// The identity key. ManageBac task URLs look like
// /student/classes/38928/assignments/1234567, and the class id in the middle
// is reissued every September. The trailing id is the stable part, so match
// on that rather than on the whole URL or on the title, which Nick rewrites to
// be actionable the moment a row lands.
export function idFrom(url: string): string | null {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(segments[i])) return segments[i];
  }
  return null;
}

// Local components, not toISOString: bacpack builds the Date from ManageBac's
// wall-clock text, so a midnight deadline read in Athens would convert back to
// the previous day in UTC.
export function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Status, Task, Priority and Type belong to Nick once a row exists: he edits
// titles and reprioritises. Only Due is ever refreshed, and nothing is deleted:
// a task dropping off ManageBac's upcoming list means it passed, not that the
// row should go.
export function planSync(tasks: Task[], rows: Row[]): Plan {
  const byTaskId = new Map<string, Row>();
  for (const row of rows) byTaskId.set(row.taskId, row);

  const plan: Plan = { create: [], touch: [] };
  for (const task of tasks) {
    if (task.due === null) continue; // undated tasks have nothing to sort by
    const id = idFrom(task.url);
    if (id === null) continue;

    const row = byTaskId.get(id);
    const due = dayOf(task.due);
    if (row === undefined) {
      plan.create.push(task);
    } else if (row.due !== due) {
      plan.touch.push({ pageId: row.pageId, title: task.title, due });
    }
  }
  return plan;
}

export function summarize(plan: Plan): string {
  const lines: string[] = [];
  for (const task of plan.create) {
    lines.push(`+ ${task.title} (${subjectFor(task.subject)}, ${task.when})`);
  }
  for (const touched of plan.touch) {
    lines.push(`~ ${touched.title} -> ${touched.due}`);
  }
  return lines.join("\n");
}

// The watermark is a file rather than state read back out of Notion, and that
// is the whole point. If "already synced" meant "a row with this link exists",
// then deleting a post you decided was not homework would bring it back the
// next morning. Deleting has to be a decision that sticks.
export function readSeen(): number | null {
  try {
    const value = Number(readFileSync(SEEN_PATH, "utf8").trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // first run
  }
}

// A first run must not import the whole backlog: eight months of posts would
// arrive as a wall of untriaged rows and the first thing you would do is delete
// all of them. Seed the mark, file nothing, start watching from now.
export function newPosts(posts: Discussion[], seen: number | null): Discussion[] {
  if (seen === null) return [];
  return posts.filter((post) => Number(post.id) > seen);
}

// The same announcement cross-posted to two classes is two separate records
// with two ids, so the watermark cannot collapse them. Title plus the exact
// posted timestamp can: a genuine pair of posts is never simultaneous, while
// Global Politics has three distinct posts all titled "Homework", which is why
// the timestamp has to be part of the key.
export function dedupePosts<T extends { post: Discussion }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.post.title}\u0000${item.post.posted}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function highestId(posts: Discussion[], seen: number | null): number {
  return posts.reduce((max, post) => Math.max(max, Number(post.id)), seen ?? 0);
}

// Category and author lead the note because they are what you triage on, and
// the category is often absent, which is itself worth seeing.
export function noteFor(post: Discussion): string {
  const header = [post.category ?? "uncategorised", post.author, post.posted]
    .filter(Boolean)
    .join(" · ");
  return `${header}\n\n${post.body}`.slice(0, MAX_NOTE);
}

async function notionRows(token: string): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined = undefined;
  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor !== undefined) body.start_cursor = cursor;
    const page = (await notion("POST", `/databases/${DATABASE_ID}/query`, token, body)) as any;

    for (const result of page.results) {
      const url = result.properties["ManageBac"]?.url ?? null;
      const taskId = url === null ? null : idFrom(url);
      if (taskId === null) continue; // rows Nick typed himself have no link
      rows.push({
        pageId: result.id,
        taskId,
        due: result.properties["Due"].date?.start ?? null,
      });
    }

    if (!page.has_more) return rows;
    cursor = page.next_cursor;
  }
}

// Type is left empty on purpose: Homework vs Assessment vs IA is a judgement
// call, and an empty cell is a visible prompt to make it. Priority defaults to
// Medium because a row without one reads as unranked rather than as new.
async function createRow(token: string, task: Task, school: string) {
  await notion("POST", "/pages", token, {
    parent: { database_id: DATABASE_ID },
    properties: {
      Task: { title: [{ text: { content: task.title } }] },
      Subject: { select: { name: subjectFor(task.subject) } },
      Priority: { select: { name: "⚡ Medium" } },
      Status: { select: { name: "To Do" } },
      Due: { date: { start: dayOf(task.due!) } },
      ManageBac: { url: `https://${school}.managebac.com${task.url}` },
      Notes: { rich_text: [{ text: { content: task.badges.join(", ") } }] },
    },
  });
}

// Deliberately unlike createRow: no Due and no Priority. A deadline arrives
// already scheduled, a discussion post does not, and the due date is prose
// ("HW for Tuesday May 5", or "May 24" meaning the name of a past paper, or
// nothing at all). Guessing it here is how a row gets filed a week early. The
// empty cells are the triage queue: link but no date means you have not read it.
async function createPostRow(
  token: string,
  post: Discussion,
  className: string,
  school: string,
  verdict: Verdict | undefined,
) {
  // Without a verdict the row is deliberately bare, which is the triage queue.
  // With one, the fields Claude was confident about are filled and the rest
  // stay empty, so a partial answer still lands as a partial row.
  const properties: Record<string, unknown> = {
    Task: { title: [{ text: { content: verdict?.title || post.title || "(untitled post)" } }] },
    Subject: { select: { name: subjectFor(className) } },
    Status: { select: { name: "To Do" } },
    ManageBac: { url: `https://${school}.managebac.com${post.url}` },
    Notes: { rich_text: [{ text: { content: noteFor(post) } }] },
  };
  if (verdict?.due) properties.Due = { date: { start: verdict.due } };
  if (verdict?.type) properties.Type = { select: { name: verdict.type } };
  if (verdict?.priority) properties.Priority = { select: { name: verdict.priority } };

  await notion("POST", "/pages", token, { parent: { database_id: DATABASE_ID }, properties });
}

async function touchRow(token: string, pageId: string, due: string) {
  await notion("PATCH", `/pages/${pageId}`, token, {
    properties: { Due: { date: { start: due } } },
  });
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const school = process.env.MANAGEBAC_SCHOOL;
  if (!token) throw new Error("NOTION_TOKEN is not set");
  if (!school) throw new Error("MANAGEBAC_SCHOOL is not set");

  const [tasks, rows] = await Promise.all([fetchTasks(new Date()), notionRows(token)]);
  const plan = planSync(tasks, rows);

  for (const task of plan.create) {
    await createRow(token, task, school);
    await Bun.sleep(350); // stay under Notion's ~3 requests/second
  }
  for (const touched of plan.touch) {
    await touchRow(token, touched.pageId, touched.due);
    await Bun.sleep(350);
  }

  // Discussions, which is where most homework actually gets set. Sequential
  // rather than Promise.all: ManageBac is a Rails app that answers 422 when
  // pushed, and ten pages once a day is not worth the risk.
  const seen = readSeen();
  const posts: { post: Discussion; className: string }[] = [];
  for (const klass of await listClasses()) {
    for (const post of await listDiscussions(klass.id)) {
      posts.push({ post, className: klass.name });
    }
  }
  const fresh = newPosts(
    posts.map((p) => p.post),
    seen,
  );
  const freshIds = new Set(fresh.map((p) => p.id));
  const candidates = dedupePosts(posts.filter((p) => freshIds.has(p.post.id)));

  // Claude reads the prose and decides what is actually work. An empty map
  // means it did not run or could not be trusted, and then everything files
  // untriaged exactly as it did before Claude was in this at all.
  const verdicts = await classify(candidates);
  const filing = candidates.filter(({ post }) => verdicts.get(post.id)?.task !== false);
  const dropped = candidates.length - filing.length;

  for (const { post, className } of filing) {
    await createPostRow(token, post, className, school, verdicts.get(post.id));
    await Bun.sleep(350);
  }
  writeFileSync(SEEN_PATH, `${highestId(posts.map((p) => p.post), seen)}\n`);

  // This repo is public, so its Actions logs are world-readable: counts only,
  // never assignment titles or class names. The names go to the phone instead.
  console.log(
    `${tasks.length} upcoming, ${plan.create.length} added, ${plan.touch.length} moved, ` +
      `${posts.length} posts seen, ${filing.length} filed, ${dropped} not tasks, ${filing.filter(({ post }) => verdicts.get(post.id)?.due).length} dated${seen === null ? " (first run, seeded)" : ""}`,
  );

  const changed = plan.create.length + plan.touch.length + filing.length;
  if (changed === 0) return;
  await ping({
    title: `ManageBac: ${plan.create.length + filing.length} new, ${plan.touch.length} moved`,
    body: [
      summarize(plan),
      ...filing.map(({ post }) => {
        const v = verdicts.get(post.id);
        return `${v?.due ? "+" : "?"} ${v?.title ?? post.title}${v?.due ? ` -> ${v.due}` : ""}`;
      }),
    ]
      .filter(Boolean)
      .join("\n"),
    tags: "books",
    click: DATABASE_URL,
  });
}

if (import.meta.main) {
  await main();
}
