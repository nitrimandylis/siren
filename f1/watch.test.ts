import { expect, test } from "bun:test";
import { freshAnnouncements, storeSaleDates, type Post } from "./watch";

// Slugs and dates taken from ACM's real announcement history.
const posts: Post[] = [
  { date: "2026-07-23T09:00:00", slug: "un-week-end-de-sport", link: "https://acm.mc/1" },
  { date: "2026-07-20T09:00:00", slug: "billetterie-2027-prenez-date", link: "https://acm.mc/2" },
  { date: "2025-08-07T09:00:00", slug: "billetterie-2026-prenez-date", link: "https://acm.mc/3" },
  { date: "2024-07-29T09:00:00", slug: "ouverture-de-la-billetterie-officielle-2", link: "https://acm.mc/4" },
];

const now = new Date("2026-07-26T12:00:00");

test("a fresh ticket post is an announcement", () => {
  expect(freshAnnouncements(posts, now).map((post) => post.slug)).toEqual([
    "billetterie-2027-prenez-date",
  ]);
});

test("last year's announcement is too old to alarm", () => {
  // The whole point of the freshness window: these two match the slug pattern
  // and must never fire, which is what keeps the watcher stateless.
  const stale = posts.filter((post) => post.date.startsWith("2025") || post.date.startsWith("2024"));
  expect(freshAnnouncements(stale, now)).toEqual([]);
});

test("posts that are fresh but not about tickets are ignored", () => {
  const unrelated = posts.filter((post) => post.slug === "un-week-end-de-sport");
  expect(freshAnnouncements(unrelated, now)).toEqual([]);
});

test("the freshness window is inclusive at its edge", () => {
  const edge: Post[] = [{ date: "2026-06-11T12:00:00", slug: "ouverture", link: "https://acm.mc/5" }];
  expect(freshAnnouncements(edge, now, 45)).toHaveLength(1);
  expect(freshAnnouncements(edge, now, 44)).toHaveLength(0);
});

test("store dates only count once the year rolls over to the target", () => {
  const stillLastYear = {
    acf: {
      race_infos: {
        billetterie_presale_open_date: "2025-09-08 09:00:00",
        billetterie_open_date: "2025-09-21 09:00:00",
      },
    },
  };
  expect(storeSaleDates(stillLastYear, 2027)).toEqual([]);

  const setUp = {
    acf: {
      race_infos: {
        billetterie_presale_open_date: "2026-09-07 09:00:00",
        billetterie_open_date: "2027-09-20 09:00:00",
      },
    },
  };
  expect(storeSaleDates(setUp, 2027)).toEqual(["general sale: 2027-09-20 09:00:00"]);
});

test("a missing or reshaped store payload is empty, not a crash", () => {
  expect(storeSaleDates(null, 2027)).toEqual([]);
  expect(storeSaleDates({}, 2027)).toEqual([]);
  expect(storeSaleDates({ acf: { race_infos: { billetterie_open_date: 20270920 } } }, 2027)).toEqual([]);
});
