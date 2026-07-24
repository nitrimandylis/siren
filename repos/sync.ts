// Keeps the Notion "Coding Projects" database in step with GitHub: adds a row
// for every repo that has no row yet, and refreshes Last Pushed where it has
// drifted. Pushes a summary only when something actually changed.
//
// Needs GH_PAT (classic token, `repo` scope, so private repos are visible) and
// NOTION_TOKEN (internal integration with the database shared to it).

import { ping } from "../ntfy";

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

export function summarize(plan: Plan): string {
  const lines: string[] = [];
  for (const repo of plan.create) {
    lines.push(`+ ${repo.name} (set Category)`);
  }
  for (const touched of plan.touch) {
    lines.push(`~ ${touched.name} -> ${touched.pushedOn}`);
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

async function notion(path: string, token: string, body?: unknown) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Notion ${path} returned HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function notionRows(token: string): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | undefined = undefined;
  while (true) {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor !== undefined) body.start_cursor = cursor;
    const page = (await notion(`/databases/${DATABASE_ID}/query`, token, body)) as any;

    for (const result of page.results) {
      const properties = result.properties;
      rows.push({
        pageId: result.id,
        name: properties["Project"].title[0]?.plain_text ?? "(untitled)",
        repoId: properties["GitHub Repo ID"].number,
        lastPushed: properties["Last Pushed"].date?.start ?? null,
      });
    }

    if (!page.has_more) return rows;
    cursor = page.next_cursor;
  }
}

// Category is deliberately left empty: it is a judgement call, and an empty
// cell is a visible prompt to make it. Everything else comes straight from the
// GitHub API.
async function createRow(token: string, repo: Repo) {
  await notion("/pages", token, {
    parent: { database_id: DATABASE_ID },
    properties: {
      Project: { title: [{ text: { content: repo.name } }] },
      Status: { select: { name: "In Progress" } },
      Stack: { multi_select: stackFor(repo.language).map((name) => ({ name })) },
      Type: { select: { name: repo.private ? "Private" : "Public" } },
      "GitHub Repo ID": { number: repo.id },
      "Repo URL": { url: `https://github.com/nitrimandylis/${repo.name}` },
      Description: { rich_text: [{ text: { content: repo.description ?? "" } }] },
      Started: { date: { start: dayOf(repo.created_at) } },
      "Last Pushed": { date: { start: dayOf(repo.pushed_at) } },
    },
  });
}

async function touchRow(token: string, pageId: string, pushedOn: string) {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { "Last Pushed": { date: { start: pushedOn } } } }),
  });
  if (!response.ok) {
    throw new Error(`Notion page update returned HTTP ${response.status}`);
  }
}

async function main() {
  const ghToken = process.env.GH_PAT;
  const notionToken = process.env.NOTION_TOKEN;
  if (!ghToken) throw new Error("GH_PAT is not set");
  if (!notionToken) throw new Error("NOTION_TOKEN is not set");

  const [repos, rows] = await Promise.all([githubRepos(ghToken), notionRows(notionToken)]);
  const plan = planSync(repos, rows);

  for (const repo of plan.create) {
    await createRow(notionToken, repo);
  }
  for (const touched of plan.touch) {
    await touchRow(notionToken, touched.pageId, touched.pushedOn);
  }

  // This repo is public, so its Actions logs are world-readable: counts only,
  // never repo names. The names go to the phone instead.
  console.log(`${plan.create.length} added, ${plan.touch.length} refreshed`);

  if (plan.create.length + plan.touch.length === 0) return;
  await ping({
    title: `Notion: ${plan.create.length} new, ${plan.touch.length} refreshed`,
    body: summarize(plan),
    tags: "card_index_dividers",
    click: DATABASE_URL,
  });
}

if (import.meta.main) {
  await main();
}
