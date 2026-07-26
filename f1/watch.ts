// Watches for the 2027 Monaco Grand Prix ticket sale.
//
// Two sources, deliberately unequal. acm.mc's posts API is the primary: it is
// the only endpoint verified to answer a datacenter IP, and it is where ACM
// publishes the announcement. The store's ACF endpoint is the better signal —
// it carries the exact on-sale datetime weeks ahead — but the host 403s some
// datacenter ranges, so it is best-effort and never fatal.
//
// Unlike cinema, the announcement and the sale are weeks apart, so this cannot
// be a single alarm that rings until you act: you would silence the
// announcement in August and hear nothing in September. Phases separate them.
// See resolve() for the rule.
//
// What this cannot do: per-grandstand availability. That sits behind a
// session-bound XHR in a JS configurator, and Cloudflare's waiting room goes
// live at the moment it would matter. Actions crons also slip 5-20 min, so this
// catches the announcement (weeks of warning), not the on-sale instant. Set a
// real alarm from the date it reports.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ping } from "../ntfy";

const TARGET_YEAR = 2027;

const ACM_POSTS =
  "https://acm.mc/wp-json/wp/v2/posts?per_page=20&_fields=date,slug,link,title";
// Edition post ids are reused and re-slugged each year, so this id survives the
// 2026 -> 2027 rename.
const STORE_EDITION = "https://monaco-grandprix.com/wp-json/acf/v3/editions/2469";
const STORE_URL = "https://monaco-grandprix.com/en/";

// Polite and identifiable: robots.txt allows this, so the least we do is say
// who is knocking.
const USER_AGENT = "siren/1.0 (+https://github.com/nitrimandylis/siren)";

// Every ticket post ACM has published, and the subset where the sale is already
// open. LIVE is checked first because "ouverture-de-la-billetterie-officielle"
// matches both patterns.
const TICKET_SLUG = /billetterie|ouvert|prenez-date|reservez/i;
const LIVE_SLUG = /ouvert|reservez/i;

// An announcement only counts while it is fresh, so last year's
// billetterie-2026-prenez-date can never fire.
const FRESH_DAYS = 45;

// One line: the phase and what produced it. Compared against the last run to
// keep news from repeating; see main().
const STATE_FILE = join(import.meta.dir, "state.txt");

export type Post = { date: string; slug: string; link: string };
export type SaleDate = { label: string; raw: string; when: Date };
export type Phase = "live" | "dated" | "announced" | "nothing";
export type Signal = { phase: Phase; detail: string };

export function freshAnnouncements(posts: Post[], now: Date, freshDays = FRESH_DAYS): Post[] {
  const cutoff = new Date(now.getTime() - freshDays * 24 * 60 * 60 * 1000);
  return posts.filter((post) => TICKET_SLUG.test(post.slug) && new Date(post.date) >= cutoff);
}

// The store publishes both dates as "YYYY-MM-DD HH:MM:SS". While they still
// read 2025 the 2027 sale has not been set up; the year rolling over is the
// earliest possible signal that it has.
export function storeSaleDates(payload: any, targetYear: number): SaleDate[] {
  const infos = payload?.acf?.race_infos ?? {};
  const dates: SaleDate[] = [];
  for (const field of ["billetterie_presale_open_date", "billetterie_open_date"]) {
    const raw = infos[field];
    if (typeof raw !== "string") continue;
    if (Number(raw.slice(0, 4)) < targetYear) continue;
    const when = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(when.getTime())) continue;
    dates.push({ label: field.includes("presale") ? "presale" : "general sale", raw, when });
  }
  return dates;
}

function describe(post: Post): string {
  return `${post.date.slice(0, 10)} ${post.slug}`;
}

// The whole point of the watcher. A sale date that has passed beats everything;
// a post saying the sale is open beats a date that has not; a known future date
// beats a vague announcement; an announcement beats nothing.
export function resolve(announcements: Post[], sales: SaleDate[], now: Date): Signal {
  const open = sales.filter((sale) => sale.when <= now);
  if (open.length > 0) {
    return { phase: "live", detail: open.map((s) => `${s.label} opened ${s.raw}`).join("\n") };
  }

  const live = announcements.filter((post) => LIVE_SLUG.test(post.slug));
  if (live.length > 0) {
    return { phase: "live", detail: live.map(describe).join("\n") };
  }

  if (sales.length > 0) {
    return { phase: "dated", detail: sales.map((s) => `${s.label}: ${s.raw}`).join("\n") };
  }

  if (announcements.length > 0) {
    return { phase: "announced", detail: announcements.map(describe).join("\n") };
  }

  return { phase: "nothing", detail: "" };
}

const HEADLINE: Record<Exclude<Phase, "nothing">, { title: string; priority: "high" | "urgent" }> = {
  live: { title: `MONACO ${TARGET_YEAR} TICKETS ARE UP`, priority: "urgent" },
  dated: { title: `MONACO ${TARGET_YEAR} sale date is set`, priority: "high" },
  announced: { title: `MONACO ${TARGET_YEAR} ticket news`, priority: "high" },
};

function lastSignal(): string {
  try {
    return readFileSync(STATE_FILE, "utf8").trim();
  } catch {
    return ""; // no file yet, so nothing has been sent
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  // Primary. A failure here has to be loud: a watcher that has been quietly
  // 403ing for a month looks exactly like one with nothing to report.
  const posts = await fetchJson(ACM_POSTS);
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error("acm.mc returned no posts — the API shape may have changed");
  }
  const announcements = freshAnnouncements(posts as Post[], new Date());

  // Best-effort. A failure is "unknown", never "nothing to report", and never a
  // reason to fail the run.
  let sales: SaleDate[] = [];
  try {
    sales = storeSaleDates(await fetchJson(STORE_EDITION), TARGET_YEAR);
    console.log(`store: reachable, ${sales.length} ${TARGET_YEAR} dates`);
  } catch (error) {
    console.log(`store: unreachable (${(error as Error).message}), skipped`);
  }

  const signal = resolve(announcements, sales, new Date());
  if (signal.phase === "nothing") {
    console.log(`monaco ${TARGET_YEAR}: nothing yet`);
    return;
  }

  // "live" is the cinema contract: an alarm that keeps ringing until you go and
  // buy. Everything before it is news, and news is only news once — repeating it
  // every 20 minutes for six weeks is how you train yourself to ignore the one
  // push that matters.
  const fingerprint = `${signal.phase}\n${signal.detail}`;
  if (signal.phase !== "live" && lastSignal() === fingerprint) {
    console.log(`monaco ${TARGET_YEAR}: ${signal.phase}, already sent`);
    return;
  }
  writeFileSync(STATE_FILE, `${fingerprint}\n`);

  const headline = HEADLINE[signal.phase];
  await ping({
    title: headline.title,
    body: signal.detail,
    priority: headline.priority,
    tags: "checkered_flag",
    click: STORE_URL,
  });
  console.log(`monaco ${TARGET_YEAR}: ${signal.phase} ALERT sent`);
}

if (import.meta.main) {
  await main();
}
