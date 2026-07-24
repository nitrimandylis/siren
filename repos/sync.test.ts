import { expect, test } from "bun:test";
import { dayOf, planSync, stackFor, summarize, type Repo, type Row } from "./sync";

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
  const rows: Row[] = [{ pageId: "p1", name: "old-name", repoId: 1, lastPushed: "2026-07-20" }];
  const plan = planSync([repo({ id: 1, name: "new-name" })], rows);
  expect(plan.create).toEqual([]);
  expect(plan.touch).toEqual([]);
});

test("a stale Last Pushed is queued for a refresh", () => {
  const rows: Row[] = [{ pageId: "p1", name: "cine", repoId: 1, lastPushed: "2026-07-18" }];
  const plan = planSync([repo({ id: 1, name: "cine" })], rows);
  expect(plan.touch).toEqual([{ pageId: "p1", name: "cine", pushedOn: "2026-07-20" }]);
});

test("idea-stage rows without a repo id are left alone", () => {
  const rows: Row[] = [{ pageId: "p1", name: "notion-tui", repoId: null, lastPushed: null }];
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

test("the summary marks additions and refreshes differently", () => {
  const plan = {
    create: [repo({ id: 1, name: "pitch" })],
    touch: [{ pageId: "p1", name: "cine", pushedOn: "2026-07-21" }],
  };
  expect(summarize(plan)).toBe("+ pitch (set Category)\n~ cine -> 2026-07-21");
});
