import { afterAll, expect, test } from "bun:test";
import { notion } from "../notion";
import { dayOf, needsRebuild, planSync, stackFor, summarize, type Repo, type Row } from "./sync";

function row(overrides: Partial<Row> = {}): Row {
  return { pageId: "p1", name: "cine", repoId: 1, lastPushed: null, readmeSynced: null, ...overrides };
}

function repo(overrides: Partial<Repo> & { id: number; name: string }): Repo {
  return {
    private: false,
    description: null,
    language: "TypeScript",
    created_at: "2026-07-01T10:00:00Z",
    pushed_at: "2026-07-20T10:00:00Z",
    ...overrides,
  };
}

test("repos with no row are queued for creation", () => {
  const plan = planSync([repo({ id: 1, name: "cine" })], []);
  expect(plan.create.map((r) => r.name)).toEqual(["cine"]);
  expect(plan.touch).toEqual([]);
});

test("matching is by repo id, so a renamed repo is not duplicated", () => {
  const rows: Row[] = [row({ name: "old-name", lastPushed: "2026-07-20" })];
  const plan = planSync([repo({ id: 1, name: "new-name" })], rows);
  expect(plan.create).toEqual([]);
  expect(plan.touch).toEqual([]);
});

test("a stale Last Pushed is queued for a refresh", () => {
  const rows: Row[] = [row({ lastPushed: "2026-07-18" })];
  const plan = planSync([repo({ id: 1, name: "cine" })], rows);
  expect(plan.touch).toEqual([{ pageId: "p1", name: "cine", pushedOn: "2026-07-20" }]);
});

test("idea-stage rows without a repo id are left alone", () => {
  const rows: Row[] = [row({ name: "notion-tui", repoId: null })];
  const plan = planSync([repo({ id: 1, name: "cine" })], rows);
  expect(plan.create.map((r) => r.name)).toEqual(["cine"]);
  expect(plan.touch).toEqual([]);
});

test("the profile README repo is ignored", () => {
  const plan = planSync([repo({ id: 9, name: "nitrimandylis" })], []);
  expect(plan.create).toEqual([]);
});

test("languages map to the database vocabulary, unknown ones to Other", () => {
  expect(stackFor("Python")).toEqual(["Python"]);
  expect(stackFor("HTML")).toEqual(["HTML/CSS"]);
  expect(stackFor("Rust")).toEqual(["Other"]);
  expect(stackFor(null)).toEqual([]);
});

test("dayOf trims an ISO timestamp to a date", () => {
  expect(dayOf("2026-07-20T18:12:41Z")).toBe("2026-07-20");
});

test("the summary marks additions, refreshes and filled bodies differently", () => {
  const plan = {
    create: [repo({ id: 1, name: "pitch" })],
    touch: [{ pageId: "p1", name: "cine", pushedOn: "2026-07-21" }],
  };
  expect(summarize(plan, [])).toBe("+ pitch (set Category)\n~ cine -> 2026-07-21");
  expect(summarize(plan, ["pitch", "jazz"])).toBe(
    "+ pitch (set Category)\n~ cine -> 2026-07-21\nreadme -> pitch, jazz",
  );
});

test("a body rebuilds when the README commit differs from the synced date", () => {
  expect(needsRebuild(row({ readmeSynced: "2026-06-16" }), "2026-07-13")).toBe(true);
  expect(needsRebuild(row({ readmeSynced: "2026-07-13" }), "2026-07-13")).toBe(false);
});

test("a page that has never been synced always rebuilds", () => {
  expect(needsRebuild(row({ readmeSynced: null }), "2026-07-13")).toBe(true);
  expect(needsRebuild(undefined, "2026-07-13")).toBe(true); // a row created this run
});

test("a repo with no README is never rebuilt", () => {
  expect(needsRebuild(row({ readmeSynced: null }), null)).toBe(false);
});

// The retrying itself is covered in retry.test.ts. This only checks that a
// Cloudflare error page does not end up in the log in full.
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("a Notion error page is truncated before it reaches the log", async () => {
  globalThis.fetch = (async () =>
    new Response("<html>" + "x".repeat(5000) + "</html>", { status: 400 })) as typeof fetch;
  const failure = notion("GET", "/x", "token").catch((error: Error) => error.message);
  expect((await failure).length).toBeLessThan(400);
  expect(await failure).toContain("HTTP 400");
});
