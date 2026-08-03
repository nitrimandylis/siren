// The classifier's output is untrusted input from a model, so what is worth
// testing is the validator that stands between it and a real school planner.

import { expect, test } from "bun:test";
import { extractJson, promptFor, validate } from "./classify";
import type { Discussion } from "../bacpack/src/classes.ts";

const POSTED = new Date(2026, 4, 1, 17, 52); // Fri 1 May 2026

function item(id: string, body = "do the exercises") {
  const post: Discussion = {
    id,
    title: `post ${id}`,
    author: "A Teacher",
    category: "Homework",
    postedAt: POSTED,
    posted: "Friday, May 1, 2026 at 5:52 PM",
    body,
    url: `/student/classes/1/discussions/${id}`,
  };
  return { post, className: "Maths AA HL" };
}

const ok = { id: "1", task: true, title: "Do Diff1 exercise 1", due: "2026-05-05", type: "Homework", priority: "⚡ Medium" };

test("extractJson survives fences and a chatty preamble", () => {
  expect(extractJson('Here you go:\n```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  expect(extractJson("[]")).toEqual([]);
  expect(extractJson("no json here")).toBe(null);
  expect(extractJson("[{broken")).toBe(null);
});

test("a well-formed verdict passes through intact", () => {
  const v = validate([ok], [item("1")]).get("1")!;
  expect(v).toEqual({
    id: "1",
    task: true,
    title: "Do Diff1 exercise 1",
    due: "2026-05-05",
    type: "Homework",
    priority: "⚡ Medium",
  });
});

// The failure this whole design is guarding against: "Solve from May 24,
// question 2" names a past paper, and reading it as a deadline files real work
// on a date nobody set.
test("a due date outside the post's own window is dropped, not filed", () => {
  const before = validate([{ ...ok, due: "2026-04-01" }], [item("1")]).get("1")!;
  expect(before.due).toBe(null);

  const tooFar = validate([{ ...ok, due: "2028-01-01" }], [item("1")]).get("1")!;
  expect(tooFar.due).toBe(null);

  // Same day as the post is legitimate: teachers post morning-of.
  expect(validate([{ ...ok, due: "2026-05-01" }], [item("1")]).get("1")!.due).toBe("2026-05-01");
});

test("select values outside the database's vocabulary become null", () => {
  const v = validate([{ ...ok, type: "Coursework", priority: "High" }], [item("1")]).get("1")!;
  expect(v.type).toBe(null);
  expect(v.priority).toBe(null);
});

test("entries that are malformed or invented are dropped entirely", () => {
  const posts = [item("1")];
  expect(validate([{ ...ok, id: "999" }], posts).size).toBe(0); // never sent
  expect(validate([{ ...ok, task: "yes" }], posts).size).toBe(0); // wrong type
  expect(validate(["nope", null, 7], posts).size).toBe(0);
  expect(validate(null, posts).size).toBe(0);
  expect(validate({ id: "1" }, posts).size).toBe(0); // not an array
});

test("an empty or missing title falls back to the post's own", () => {
  expect(validate([{ ...ok, title: "   " }], [item("1")]).get("1")!.title).toBe("post 1");
  expect(validate([{ ...ok, title: 42 }], [item("1")]).get("1")!.title).toBe("post 1");
  expect(validate([{ ...ok, title: "x".repeat(500) }], [item("1")]).get("1")!.title).toHaveLength(200);
});

test("the prompt carries each post's own date, since relative dates hang off it", () => {
  const prompt = promptFor([item("1")]);
  expect(prompt).toContain('"posted": "2026-05-01"');
  expect(prompt).toContain('"id": "1"');
  // The body is what the due date has to be read out of.
  expect(prompt).toContain("do the exercises");
});
