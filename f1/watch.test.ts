import { expect, test } from "bun:test";
import {
  freshAnnouncements,
  resolve,
  shouldSend,
  storeSaleDates,
  type Post,
  type SaleDate,
  type Signal,
} from "./watch";

// Slugs and dates taken from ACM's real announcement history.
const posts: Post[] = [
  { date: "2026-07-23T09:00:00", slug: "un-week-end-de-sport", link: "https://acm.mc/1" },
  { date: "2026-07-20T09:00:00", slug: "billetterie-2027-prenez-date", link: "https://acm.mc/2" },
  { date: "2025-08-07T09:00:00", slug: "billetterie-2026-prenez-date", link: "https://acm.mc/3" },
  { date: "2024-07-29T09:00:00", slug: "ouverture-de-la-billetterie-officielle-2", link: "https://acm.mc/4" },
];

const now = new Date("2026-07-26T12:00:00");
const saveTheDate = posts.filter((post) => post.slug === "billetterie-2027-prenez-date");

test("a fresh ticket post is an announcement", () => {
  expect(freshAnnouncements(posts, now).map((post) => post.slug)).toEqual([
    "billetterie-2027-prenez-date",
  ]);
});

test("last year's announcement is too old to alarm", () => {
  // The freshness window is what keeps this stateless: these match the slug
  // pattern and must never fire.
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

  const setUp = storeSaleDates(
    { acf: { race_infos: { billetterie_open_date: "2027-09-20 09:00:00" } } },
    2027,
  );
  expect(setUp).toHaveLength(1);
  expect(setUp[0].label).toBe("general sale");
});

test("store times are read as Monaco local, not as the runner's UTC", () => {
  // Actions runners are UTC. Parsed bare, a 09:00 Monaco sale would be treated
  // as 09:00 UTC and the alarm would fire two hours after the sale opened.
  const [sale] = storeSaleDates(
    { acf: { race_infos: { billetterie_open_date: "2027-09-20 09:00:00" } } },
    2027,
  );
  expect(sale.when.toISOString()).toBe("2027-09-20T07:00:00.000Z");
});

test("a missing or reshaped store payload is empty, not a crash", () => {
  expect(storeSaleDates(null, 2027)).toEqual([]);
  expect(storeSaleDates({}, 2027)).toEqual([]);
  expect(storeSaleDates({ acf: { race_infos: { billetterie_open_date: 20270920 } } }, 2027)).toEqual([]);
  expect(storeSaleDates({ acf: { race_infos: { billetterie_open_date: "2027-13-45 99:00:00" } } }, 2027)).toEqual([]);
});

const dated = (raw: string): SaleDate => ({ label: "presale", raw, when: new Date(raw.replace(" ", "T")) });

test("nothing at all is the quiet case", () => {
  expect(resolve([], [], now).phase).toBe("nothing");
});

test("an announcement with no store date is 'announced'", () => {
  const signal = resolve(saveTheDate, [], now);
  expect(signal.phase).toBe("announced");
  expect(signal.detail).toBe("2026-07-20 billetterie-2027-prenez-date");
});

test("a known future sale date beats a vague announcement", () => {
  const signal = resolve(saveTheDate, [dated("2026-09-08 09:00:00")], now);
  expect(signal.phase).toBe("dated");
  expect(signal.detail).toBe("presale: 2026-09-08 09:00:00");
});

test("a sale date in the past means the sale is live", () => {
  const signal = resolve(saveTheDate, [dated("2026-07-20 09:00:00")], now);
  expect(signal.phase).toBe("live");
  expect(signal.detail).toBe("presale opened 2026-07-20 09:00:00");
});

test("a post saying the sale is open is live even with the store unreachable", () => {
  // This is the case the store's 403 would otherwise hide.
  const open: Post[] = [
    { date: "2026-07-25T09:00:00", slug: "la-billetterie-est-ouverte-2027", link: "https://acm.mc/6" },
  ];
  expect(resolve(open, [], now).phase).toBe("live");
});

const line = (signal: Signal) => `${signal.phase}\n${signal.detail}`;
const DATED: Signal = { phase: "dated", detail: "presale: 2027-09-08 09:00:00" };
const ANNOUNCED: Signal = { phase: "announced", detail: "2026-07-20 billetterie-2027-prenez-date" };

test("news is sent once, then stays quiet", () => {
  expect(shouldSend("", ANNOUNCED)).toBe(true);
  expect(shouldSend(line(ANNOUNCED), ANNOUNCED)).toBe(false);
});

test("the store blinking out does not re-announce the news", () => {
  // The whole reason shouldSend exists. The store 403s intermittently, so this
  // sequence runs every time it does, and sending on any change would push
  // twice per blip for the six weeks before the sale.
  let state = "";
  const sent: string[] = [];
  const cycle = (signal: Signal) => {
    if (!shouldSend(state, signal)) return;
    sent.push(signal.phase);
    state = line(signal);
  };

  cycle(DATED); //     store answers
  cycle(ANNOUNCED); // store 403s, phase falls back
  cycle(DATED); //     store answers again
  cycle(ANNOUNCED); // and blips again

  expect(sent).toEqual(["dated"]);
});

test("a genuine upgrade still gets through", () => {
  expect(shouldSend(line(ANNOUNCED), DATED)).toBe(true);
  expect(shouldSend(line(DATED), { phase: "dated", detail: "presale: 2027-09-15 09:00:00" })).toBe(true);
});

test("live always rings, even having just rung", () => {
  const live: Signal = { phase: "live", detail: "presale opened 2027-09-08 09:00:00" };
  expect(shouldSend(line(live), live)).toBe(true);
});

test("'ouverture' is read as live, not as a save-the-date", () => {
  // "ouverture-de-la-billetterie-officielle" matches both patterns, so order
  // inside resolve() is what decides this.
  const open: Post[] = [
    { date: "2026-07-25T09:00:00", slug: "ouverture-de-la-billetterie-officielle", link: "https://acm.mc/7" },
  ];
  expect(resolve(open, [], now).phase).toBe("live");
});
