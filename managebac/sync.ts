// Keeps the Notion "Assignments" database in step with ManageBac's Tasks &
// Deadlines: adds a row for every task that has none, and refreshes Due where
// ManageBac has moved it. Pushes a summary only when something changed.
//
// The scraping lives in bacpack, checked out next to this file (see the
// workflow). This script is the glue bacpack deliberately refuses to be.
//
// Needs MANAGEBAC_SCHOOL, a session cookie at ~/.config/managebac/cookie, and
// NOTION_TOKEN (internal integration with the database shared to it).

import { fetchTasks, type Task } from "../bacpack/src/due.ts";
import { ping } from "../ntfy";
import { notion } from "../notion";

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
      plan.touch.push({ pageId: row.pageId, title: row.taskId, due });
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
    lines.push(`~ moved -> ${touched.due}`);
  }
  return lines.join("\n");
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

  // This repo is public, so its Actions logs are world-readable: counts only,
  // never assignment titles or class names. The names go to the phone instead.
  console.log(`${tasks.length} upcoming, ${plan.create.length} added, ${plan.touch.length} moved`);

  if (plan.create.length + plan.touch.length === 0) return;
  await ping({
    title: `ManageBac: ${plan.create.length} new, ${plan.touch.length} moved`,
    body: summarize(plan),
    tags: "books",
    click: DATABASE_URL,
  });
}

if (import.meta.main) {
  await main();
}
