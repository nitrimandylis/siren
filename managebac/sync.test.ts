import { expect, test } from "bun:test";
import {
  dayOf,
  dedupePosts,
  highestId,
  idFrom,
  newPosts,
  noteFor,
  planSync,
  subjectFor,
  type Row,
} from "./sync";
import type { Task } from "../bacpack/src/due.ts";
import type { Discussion } from "../bacpack/src/classes.ts";

function task(url: string, due: Date | null, subject = "IB Computer Science HL"): Task {
  return { title: "t", subject, when: "Sep 20", due, badges: [], action: null, url };
}

// Each case is a way a real ManageBac class name defeats naive matching. The
// group codes, sessions and grade levels are invented: this repo is public, and
// a class list with those intact is a timetable. The subject words have to stay
// because they are what the table matches on, and SUBJECTS above names them
// anyway.
test("subjectFor survives the junk ManageBac hangs off a class name", () => {
  // Screaming case, a colon, and a stream code sitting before the level.
  expect(subjectFor("GREEK A: LANG+LIT ZQ SL (Grade 9)")).toBe("Modern Greek A SL");
  // Subject spelled out only at the very end, after an unexpandable acronym.
  expect(subjectFor("IBDP ZZ IB4 GROUP 7 (Grade 9) BUSINESS MANAGEMENT")).toBe("Business SL");
  // Leading year and a session code, so the subject sits mid-string.
  expect(subjectFor("Year 4 Global Politics 19-20 (Grade 9)")).toBe("Global Politics SL");
  // Plural, and a level abbreviation the database's vocabulary does not use.
  expect(subjectFor("Maths AA HL G7 May 21 (Grade 9)")).toBe("Math AA HL");
  // A parenthetical that is not part of the subject at all.
  expect(subjectFor("TOK 4 (Friday Class) (Grade 9)")).toBe("TOK");
  // Non-latin script, for a class with no option of its own. It has to land in
  // Other rather than be swept into the nearest same-language subject.
  expect(subjectFor("\u03b3\u03bb\u03c9\u03c3\u03c3\u03bf\u03bc\u03ac\u03b8\u03b5\u03b9\u03b1 4 SL (Grade 9)")).toBe("Other");
});

test("idFrom takes the trailing id, not the class id that changes every year", () => {
  expect(idFrom("/student/classes/38928/assignments/1234567")).toBe("1234567");
  expect(idFrom("/student/classes/40011/assignments/1234567?tab=details")).toBe("1234567");
  expect(idFrom("/student/classes/38928/assignments")).toBe("38928"); // no task id to find
  expect(idFrom("/student/ib/cas")).toBe(null);
});

// The bug this pins: toISOString on a midnight deadline read east of UTC
// reports the previous day, quietly moving every such deadline a day earlier.
test("dayOf reads the wall clock, not UTC", () => {
  expect(dayOf(new Date(2026, 8, 20, 0, 0))).toBe("2026-09-20");
  expect(dayOf(new Date(2026, 8, 20, 23, 59))).toBe("2026-09-20");
});

test("planSync creates unknown tasks and refreshes moved ones", () => {
  const rows: Row[] = [{ pageId: "p1", taskId: "111", due: "2026-09-20" }];
  const plan = planSync(
    [
      task("/student/classes/1/assignments/111", new Date(2026, 8, 27)), // moved
      task("/student/classes/1/assignments/222", new Date(2026, 8, 20)), // new
    ],
    rows,
  );
  expect(plan.create.map((t) => idFrom(t.url))).toEqual(["222"]);
  expect(plan.touch).toEqual([{ pageId: "p1", title: "t", due: "2026-09-27" }]);
});

test("planSync leaves an unmoved task alone and skips undated ones", () => {
  const rows: Row[] = [{ pageId: "p1", taskId: "111", due: "2026-09-20" }];
  const plan = planSync(
    [
      task("/student/classes/1/assignments/111", new Date(2026, 8, 20)),
      task("/student/classes/1/assignments/333", null),
    ],
    rows,
  );
  expect(plan).toEqual({ create: [], touch: [] });
});

function post(id: string, category: string | null = "Homework"): Discussion {
  return {
    id,
    title: `post ${id}`,
    author: "A Teacher",
    category,
    postedAt: new Date(2026, 4, 19),
    posted: "Tuesday, May 19, 2026 at 12:21 AM",
    body: "do the exercises",
    url: `/student/classes/1/discussions/${id}`,
  };
}

// The first run must seed rather than import: eight months of backlog arriving
// as untriaged rows is worse than nothing.
test("newPosts files nothing on a first run, then only what is newer", () => {
  const all = [post("300"), post("200"), post("100")];

  expect(newPosts(all, null)).toEqual([]);
  expect(newPosts(all, 200).map((p) => p.id)).toEqual(["300"]);
  expect(newPosts(all, 300)).toEqual([]);
});

// The mark has to move even when nothing was filed, or a first run seeds
// nothing and the next run imports the whole backlog anyway.
test("highestId advances on a seeding run and never goes backwards", () => {
  expect(highestId([post("300"), post("100")], null)).toBe(300);
  expect(highestId([post("100")], 500)).toBe(500);
  expect(highestId([], 500)).toBe(500);
  expect(highestId([], null)).toBe(0);
});

test("noteFor leads with what you triage on, and says when a category is missing", () => {
  expect(noteFor(post("1"))).toBe(
    "Homework · A Teacher · Tuesday, May 19, 2026 at 12:21 AM\n\ndo the exercises",
  );
  expect(noteFor(post("1", null))).toContain("uncategorised ·");
});

test("noteFor stays inside Notion's 2000 character text run limit", () => {
  const long = { ...post("1"), body: "x".repeat(5000) };
  expect(noteFor(long).length).toBeLessThanOrEqual(2000);
});

test("dedupePosts collapses a cross-post but keeps same-titled posts apart", () => {
  const at = (t: string, title: string, id: string) => ({
    post: { ...post(id), title, posted: t },
    className: "c",
  });
  const items = [
    at("Mon, Jun 29, 2026 at 9:06 AM", "Retake exams", "2"), // cross-posted to
    at("Mon, Jun 29, 2026 at 9:06 AM", "Retake exams", "1"), // two CS classes
    at("Tue, May 19, 2026 at 12:21 AM", "Homework", "3"),
    at("Fri, May 1, 2026 at 5:52 PM", "Homework", "4"), // same title, real post
  ];

  expect(dedupePosts(items).map((i) => i.post.id)).toEqual(["2", "3", "4"]);
});
