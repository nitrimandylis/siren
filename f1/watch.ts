// Watches for the 2027 Monaco Grand Prix ticket sale being announced.
//
// Two sources, deliberately unequal. acm.mc's posts API is the primary: it is
// the only endpoint verified to answer a datacenter IP, and it is where ACM
// publishes the announcement. The store's ACF endpoint is the better signal —
// it carries the exact on-sale datetime weeks ahead — but it 403s datacenter
// IPs, so it is best-effort and never fatal.
//
// What this cannot do: per-grandstand availability. That sits behind a
// session-bound XHR in a JS configurator, and Cloudflare's waiting room goes
// live at the moment it would matter. Catch the announcement, then set a real
// alarm for the on-sale time.

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

// Slugs ACM has actually used to announce a sale: billetterie-2026-prenez-date,
// la-billetterie-est-ouverte-2026, ouverture-de-la-billetterie-officielle-2,
// reservez-vos-places-2.
const TICKET_SLUG = /billetterie|ouverture|prenez-date|reservez/i;

// Staying stateless: an announcement only counts while it is fresh, so last
// year's billetterie post cannot alarm and no high-water mark has to be stored.
// Like cinema, this re-alarms every cycle until the workflow is disabled.
const FRESH_DAYS = 45;

export type Post = { date: string; slug: string; link: string; title?: { rendered: string } };

export function freshAnnouncements(posts: Post[], now: Date, freshDays = FRESH_DAYS): Post[] {
  const cutoff = new Date(now.getTime() - freshDays * 24 * 60 * 60 * 1000);
  return posts.filter((post) => TICKET_SLUG.test(post.slug) && new Date(post.date) >= cutoff);
}

// The store publishes both dates as "YYYY-MM-DD HH:MM:SS". While they still
// read 2025 the 2027 sale has not been set up; the year rolling over is the
// earliest possible signal that it has.
export function storeSaleDates(payload: any, targetYear: number): string[] {
  const infos = payload?.acf?.race_infos ?? {};
  const found: string[] = [];
  for (const field of ["billetterie_presale_open_date", "billetterie_open_date"]) {
    const value = infos[field];
    if (typeof value !== "string") continue;
    if (Number(value.slice(0, 4)) >= targetYear) {
      found.push(`${field.includes("presale") ? "presale" : "general sale"}: ${value}`);
    }
  }
  return found;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const lines: string[] = [];

  // Primary. A failure here has to be loud: a watcher that has been quietly
  // 403ing for a month looks exactly like a watcher with nothing to report.
  const posts = await fetchJson(ACM_POSTS);
  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error("acm.mc returned no posts — the API shape may have changed");
  }
  for (const post of freshAnnouncements(posts as Post[], new Date())) {
    lines.push(`${post.date.slice(0, 10)} ${post.slug}`);
  }

  // Best-effort. Known to 403 from datacenter IPs, so a failure is "unknown",
  // never "nothing to report", and never a reason to fail the run.
  try {
    const dates = storeSaleDates(await fetchJson(STORE_EDITION), TARGET_YEAR);
    if (dates.length > 0) lines.push(...dates);
    console.log(`store: reachable, ${dates.length} ${TARGET_YEAR} dates`);
  } catch (error) {
    console.log(`store: unreachable (${(error as Error).message}), skipped`);
  }

  if (lines.length === 0) {
    console.log(`monaco ${TARGET_YEAR}: nothing yet`);
    return;
  }

  await ping({
    title: `MONACO ${TARGET_YEAR} ticket news`,
    body: lines.join("\n"),
    priority: "urgent",
    tags: "checkered_flag",
    click: STORE_URL,
  });
  console.log(`monaco ${TARGET_YEAR}: ALERT sent (${lines.length} signals)`);
}

if (import.meta.main) {
  await main();
}
