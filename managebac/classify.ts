// Turns a discussion post into a scheduled row, which is the one part of this
// that a regex cannot do. See PRODUCT.md: the category field is filled in about
// half the time, and the due date is prose ("HW for Tuesday May 5", or "May 24"
// meaning the name of a past paper, or nothing at all).
//
// Claude runs here on a CLAUDE_CODE_OAUTH_TOKEN, which is precedence #5 and
// authenticates against the subscription rather than a billed API key. Two
// consequences shape this file:
//
//   - That token "can only make model requests", so claude.ai connectors are
//     unavailable. Claude cannot write to Notion itself even if we wanted it
//     to. It returns JSON and sync.ts does the writing.
//   - The runner has the ManageBac session cookie on disk and its logs are
//     world-readable, so the classifier is given no tools whatsoever.
//
// Everything it returns is treated as untrusted. A post whose verdict fails
// validation falls back to being filed untriaged, exactly as if Claude had
// never run, so the deterministic path stays the floor rather than the plan B.

import type { Discussion } from "../bacpack/src/classes.ts";

const TYPES = ["Homework", "IA", "Assessment", "Exam Prep", "Project", "Revision"];
const PRIORITIES = ["🔥 High", "⚡ Medium", "🧊 Low"];
const MAX_TITLE = 200;
const HORIZON_DAYS = 365;

// No tools. The classification needs none, and the alternative is a model with
// shell access sitting next to a session cookie in a public repo's runner.
const NO_TOOLS =
  "Bash Read Write Edit NotebookEdit Glob Grep WebFetch WebSearch Task TodoWrite";

export type Verdict = {
  id: string;
  task: boolean;
  title: string;
  due: string | null;
  type: string | null;
  priority: string | null;
};

export function promptFor(posts: { post: Discussion; className: string }[]): string {
  const items = posts.map(({ post, className }) => ({
    id: post.id,
    class: className,
    category: post.category ?? "(none)",
    posted: post.postedAt ? post.postedAt.toISOString().slice(0, 10) : null,
    title: post.title,
    body: post.body,
  }));

  return `You are triaging posts from a student's IB class discussion boards into
their homework planner. Return ONLY a JSON array, no prose and no code fences.

For each post return an object:
  id        the id exactly as given
  task      true if this is work the student has to do, false otherwise
  title     a short actionable task name, imperative, no more than 120 characters
  due       "YYYY-MM-DD" if a deadline is genuinely stated, otherwise null
  type      one of ${TYPES.join(", ")}, or null if unclear
  priority  one of ${PRIORITIES.join(", ")}, or null if unclear

Rules that matter:
- task=false for announcements, timetable changes, exam-result notices, and
  anything the teacher marks optional ("if you have the time", "if you want").
- A date only counts as "due" if it is when the work is owed. Past paper names
  contain dates ("Solve from May 24, question 2" means the May 24 paper, not a
  deadline) and so do file names. Those are not due dates.
- Resolve relative dates such as "Tuesday" or "next week" against that post's
  own "posted" date, not against today.
- If the deadline is vague ("by the end of June"), use the last plausible day.
- When you are unsure, use null. A missing date is triaged by hand in seconds;
  a wrong one hides real work until it is late.

Posts:
${JSON.stringify(items, null, 2)}`;
}

// Models wrap JSON in fences even when told not to, and sometimes add a
// sentence before it. Take the outermost array rather than trusting the shape.
export function extractJson(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// The verdict is untrusted input. Anything that fails here is dropped, and a
// dropped post is filed untriaged rather than filed wrong.
export function validate(
  raw: unknown,
  posts: { post: Discussion; className: string }[],
): Map<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  if (!Array.isArray(raw)) return verdicts;

  const byId = new Map(posts.map((p) => [p.post.id, p.post]));

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const post = typeof item.id === "string" ? byId.get(item.id) : undefined;
    if (post === undefined) continue; // an id we never sent
    if (typeof item.task !== "boolean") continue;

    // A due date is only believable near the post that mentions it. Anything
    // before the post was written, or more than a year after, is the model
    // having read a past paper's name as a deadline.
    let due: string | null = null;
    if (isDay(item.due) && post.postedAt !== null) {
      const posted = post.postedAt.getTime();
      const parsed = new Date(`${item.due}T12:00:00`).getTime();
      const days = (parsed - posted) / 86_400_000;
      if (days >= -1 && days <= HORIZON_DAYS) due = item.due;
    }

    const title =
      typeof item.title === "string" && item.title.trim().length > 0
        ? item.title.trim().slice(0, MAX_TITLE)
        : post.title;

    verdicts.set(post.id, {
      id: post.id,
      task: item.task,
      title,
      due,
      type: typeof item.type === "string" && TYPES.includes(item.type) ? item.type : null,
      priority:
        typeof item.priority === "string" && PRIORITIES.includes(item.priority)
          ? item.priority
          : null,
    });
  }
  return verdicts;
}

// Returns an empty map on any failure: no token, a non-zero exit, unparseable
// output. sync.ts reads that as "file everything untriaged", which is what this
// watcher did before Claude was in it at all.
export async function classify(
  posts: { post: Discussion; className: string }[],
): Promise<Map<string, Verdict>> {
  if (posts.length === 0) return new Map();

  // No check for CLAUDE_CODE_OAUTH_TOKEN. On the runner that variable is the
  // credential, but on your machine the credential is the login you already
  // have, and requiring the token would make a manual run behave differently
  // from the real one. Just call it and let failure be the signal.
  let out = "";
  try {
    const child = Bun.spawn(
      ["claude", "-p", "--output-format", "text", "--disallowed-tools", NO_TOOLS],
      { stdin: new TextEncoder().encode(promptFor(posts)), stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      // Quota exhaustion lands here, and it must not fail the run: the posts
      // are still worth filing, just without dates on them.
      console.log(`claude exited ${code}, filing untriaged: ${stderr.trim().slice(0, 200)}`);
      return new Map();
    }
    out = stdout;
  } catch (error) {
    // claude not installed, or not on PATH.
    console.log(`could not run claude, filing untriaged: ${(error as Error).message}`);
    return new Map();
  }
  return validate(extractJson(out), posts);
}
