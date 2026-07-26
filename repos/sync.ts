// Keeps the Notion "Coding Projects" database in step with GitHub: adds a row
// for every repo that has no row yet, and refreshes Last Pushed where it has
// drifted. Pushes a summary only when something actually changed.
//
// Needs GH_PAT (classic token, `repo` scope, so private repos are visible) and
// NOTION_TOKEN (internal integration with the database shared to it).

import { ping } from "../ntfy";
import { toBlocks } from "./markdown";

const OWNER = "nitrimandylis";
const MAX_BODY_BLOCKS = 300; // ponytail: long READMEs get cut, raise if one ever does
const DATABASE_ID = "cb1788bf-2a1d-4a7e-b3e4-6b5daea238a8";
const DATABASE_URL = "https://www.notion.so/cb1788bf2a1d4a7eb3e46b5daea238a8";
const NOTION_VERSION = "2022-06-28";

// Repos that exist on GitHub but are not projects.
const IGNORED = new Set(["nitrimandylis"]); // the profile README repo

export type Repo = {
  id: number;
  name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  created_at: string; // ISO timestamp
  pushed_at: string; // ISO timestamp
};

export type Row = {
  pageId: string;
  name: string;
  repoId: number | null; // rows for idea-stage projects have no repo yet
  lastPushed: string | null; // "YYYY-MM-DD"
  readmeSynced: string | null; // "YYYY-MM-DD" of the README commit this body came from
};

export type Plan = {
  create: Repo[];
  touch: { pageId: string; name: string; pushedOn: string }[];
};

// GitHub reports one primary language per repo; the Stack property takes the
// database's own vocabulary, so anything unmapped lands in "Other" and gets
// corrected by hand.
export function stackFor(language: string | null): string[] {
  const known: Record<string, string> = {
    Python: "Python",
    JavaScript: "JavaScript",
    TypeScript: "TypeScript",
    Swift: "Swift",
    HTML: "HTML/CSS",
    CSS: "HTML/CSS",
  };
  if (language === null) return [];
  return [known[language] ?? "Other"];
}

export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

// Compares the two sides on GitHub Repo ID, which is stable across renames.
export function planSync(repos: Repo[], rows: Row[]): Plan {
  const byRepoId = new Map<number, Row>();
  for (const row of rows) {
    if (row.repoId !== null) byRepoId.set(row.repoId, row);
  }

  const plan: Plan = { create: [], touch: [] };
  for (const repo of repos) {
    if (IGNORED.has(repo.name)) continue;

    const row = byRepoId.get(repo.id);
    if (row === undefined) {
      plan.create.push(repo);
      continue;
    }

    const pushedOn = dayOf(repo.pushed_at);
    if (row.lastPushed !== pushedOn) {
      plan.touch.push({ pageId: row.pageId, name: row.name, pushedOn });
    }
  }
  return plan;
}

// The page body belongs to the sync, not to you: whenever the README moves, the
// old body is deleted and rebuilt from scratch. Notes typed into one of these
// pages will not survive the next README commit — put them in a property, or in
// the README itself.
export function needsRebuild(row: Row | undefined, readmeChangedOn: string | null): boolean {
  if (readmeChangedOn === null) return false; // no README, nothing to build from
  return row?.readmeSynced !== readmeChangedOn;
}

export function summarize(plan: Plan, filled: string[]): string {
  const lines: string[] = [];
  for (const repo of plan.create) {
    lines.push(`+ ${repo.name} (set Category)`);
  }
  for (const touched of plan.touch) {
    lines.push(`~ ${touched.name} -> ${touched.pushedOn}`);
  }
  if (filled.length > 0) {
    lines.push(`readme -> ${filled.join(", ")}`);
  }
  return lines.join("\n");
}

async function githubRepos(token: string): Promise<Repo[]> {
  const repos: Repo[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "siren" },
    });
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }
    const batch = (await response.json()) as Repo[];
    repos.push(...batch);
    if (batch.length < 100) return repos;
    page++;
  }
}

export async function notion(method: string, path: string, token: string, body?: unknown) {
  // Notion sits behind Cloudflare and occasionally answers 5xx or 429. Those are
  // temporary, so retry a few times before giving up on the whole sync.
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      await Bun.sleep(attempt * 2000);
      continue;
    }
    // ponytail: the body is truncated because Cloudflare error pages are whole
    // HTML documents and they drown the Actions log.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Notion ${path} returned HTTP ${response.status}: ${detail}`);
  }
}

async function notionRows(token: string): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined = undefined;
  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor !== undefined) body.start_cursor = cursor;
    const page = (await notion("POST", `/databases/${DATABASE_ID}/query`, token, body)) as any;

    for (const result of page.results) {
      const properties = result.properties;
      rows.push({
        pageId: result.id,
        name: properties["Project"].title[0]?.plain_text ?? "(untitled)",
        repoId: properties["GitHub Repo ID"].number,
        lastPushed: properties["Last Pushed"].date?.start ?? null,
        readmeSynced: properties["README synced"]?.date?.start ?? null,
      });
    }

    if (!page.has_more) return rows;
    cursor = page.next_cursor;
  }
}

// Category is deliberately left empty: it is a judgement call, and an empty
// cell is a visible prompt to make it. Everything else comes straight from the
// GitHub API.
async function createRow(token: string, repo: Repo): Promise<string> {
  const page = (await notion("POST", "/pages", token, {
    parent: { database_id: DATABASE_ID },
    properties: {
      Project: { title: [{ text: { content: repo.name } }] },
      Status: { select: { name: "In Progress" } },
      Stack: { multi_select: stackFor(repo.language).map((name) => ({ name })) },
      Type: { select: { name: repo.private ? "Private" : "Public" } },
      "GitHub Repo ID": { number: repo.id },
      "Repo URL": { url: `https://github.com/${OWNER}/${repo.name}` },
      Description: { rich_text: [{ text: { content: repo.description ?? "" } }] },
      Started: { date: { start: dayOf(repo.created_at) } },
      "Last Pushed": { date: { start: dayOf(repo.pushed_at) } },
    },
  })) as any;
  return page.id;
}

async function touchRow(token: string, pageId: string, pushedOn: string) {
  await notion("PATCH", `/pages/${pageId}`, token, {
    properties: { "Last Pushed": { date: { start: pushedOn } } },
  });
}

// Notion has no "empty this page" call, so a rebuild means deleting every
// top-level block one at a time. Children go with their parent.
// ponytail: O(blocks) deletes per rebuild, which only happens when a README
// actually moves — batch it only if that stops being rare.
async function clearBody(token: string, pageId: string) {
  while (true) {
    const page = (await notion("GET", `/blocks/${pageId}/children?page_size=100`, token)) as any;
    if (page.results.length === 0) return;
    for (const block of page.results) {
      await notion("DELETE", `/blocks/${block.id}`, token);
      await Bun.sleep(350); // stay under Notion's ~3 requests/second
    }
    if (!page.has_more) return;
  }
}

// The date of the last commit that touched the README, which is the signal for
// "this body is out of date" — a push that never touched it changes nothing.
async function readmeChangedOn(token: string, name: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${OWNER}/${name}/commits?path=README.md&per_page=1`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "siren" },
  });
  if (!response.ok) {
    throw new Error(`GitHub commits returned HTTP ${response.status}`);
  }
  const commits = (await response.json()) as any[];
  if (commits.length === 0) return null;
  return dayOf(commits[0].commit.committer.date);
}

async function markSynced(token: string, pageId: string, changedOn: string) {
  await notion("PATCH", `/pages/${pageId}`, token, {
    properties: { "README synced": { date: { start: changedOn } } },
  });
}

async function readmeFor(token: string, name: string): Promise<string | null> {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${name}/readme`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "siren",
    },
  });
  if (response.status === 404) return null; // plenty of repos have no README
  if (!response.ok) {
    throw new Error(`GitHub readme returned HTTP ${response.status}`);
  }
  return response.text();
}

async function appendBody(token: string, pageId: string, blocks: object[]) {
  // Notion takes at most 100 blocks per append.
  for (let i = 0; i < blocks.length; i += 100) {
    await notion("PATCH", `/blocks/${pageId}/children`, token, {
      children: blocks.slice(i, i + 100),
    });
    await Bun.sleep(350); // stay under Notion's ~3 requests/second
  }
}

async function main() {
  const ghToken = process.env.GH_PAT;
  const notionToken = process.env.NOTION_TOKEN;
  if (!ghToken) throw new Error("GH_PAT is not set");
  if (!notionToken) throw new Error("NOTION_TOKEN is not set");

  const [repos, rows] = await Promise.all([githubRepos(ghToken), notionRows(notionToken)]);
  const plan = planSync(repos, rows);

  const rowFor = new Map<number, Row>();
  const pageFor = new Map<number, string>();
  for (const row of rows) {
    if (row.repoId === null) continue;
    rowFor.set(row.repoId, row);
    pageFor.set(row.repoId, row.pageId);
  }
  for (const repo of plan.create) {
    pageFor.set(repo.id, await createRow(notionToken, repo));
  }
  for (const touched of plan.touch) {
    await touchRow(notionToken, touched.pageId, touched.pushedOn);
  }

  // Rebuild the body of every page whose README has moved since it was last
  // synced. New rows have no README synced date, so they always build.
  const filled: string[] = [];
  for (const repo of repos) {
    const pageId = pageFor.get(repo.id);
    if (pageId === undefined) continue;

    const changedOn = await readmeChangedOn(ghToken, repo.name);
    if (!needsRebuild(rowFor.get(repo.id), changedOn)) continue;

    const readme = await readmeFor(ghToken, repo.name);
    if (readme === null) continue;
    const blocks = toBlocks(readme).slice(0, MAX_BODY_BLOCKS);
    if (blocks.length === 0) continue;

    await clearBody(notionToken, pageId);
    await appendBody(notionToken, pageId, blocks);
    await markSynced(notionToken, pageId, changedOn!);
    filled.push(repo.name);
  }

  // This repo is public, so its Actions logs are world-readable: counts only,
  // never repo names. The names go to the phone instead.
  console.log(
    `${plan.create.length} added, ${plan.touch.length} refreshed, ${filled.length} readmes`,
  );

  if (plan.create.length + plan.touch.length + filled.length === 0) return;
  await ping({
    title: `Notion: ${plan.create.length} new, ${plan.touch.length} refreshed`,
    body: summarize(plan, filled),
    tags: "card_index_dividers",
    click: DATABASE_URL,
  });
}

if (import.meta.main) {
  await main();
}
