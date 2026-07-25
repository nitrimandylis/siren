import { expect, test } from "bun:test";
import { describeCron, describeWatch, nextKeepalive, status } from "./keepalive";

test("describeCron names the schedules this repo actually uses", () => {
  expect(describeCron("3-59/5 * * * *")).toBe("every 5 min");
  expect(describeCron("17 6 * * *")).toBe("daily");
  expect(describeCron("41 7 1 * *")).toBe("monthly");
});

test("describeCron returns the raw cron rather than guessing", () => {
  expect(describeCron("0 * * * *")).toBe("0 * * * *");
});

test("describeWatch lists only the filters that are set", () => {
  expect(describeWatch({ title: "AVENGERS" })).toBe("AVENGERS");
  expect(describeWatch({ title: "AVENGERS", imax: true })).toBe("AVENGERS (imax)");
  expect(describeWatch({ title: "DUNE", imax: true, cinema: "21", from: "2026-12-01" })).toBe(
    "DUNE (imax, cinema 21, from 2026-12-01)",
  );
});

test("nextKeepalive is the 1st of the next month, and rolls the year over", () => {
  expect(nextKeepalive(new Date(2026, 6, 25))).toBe("01/08");
  expect(nextKeepalive(new Date(2026, 11, 3))).toBe("01/01");
});

test("status reports every scheduled workflow except keepalive itself", () => {
  const lines = status(new Date(2026, 6, 25));
  expect(lines.some((line) => line.startsWith("keepalive:"))).toBe(false);
  expect(lines).toContain("repos: daily");
  expect(lines.at(-1)).toBe("next keepalive: 01/08");

  const cinema = lines.find((line) => line.startsWith("cinema:"));
  expect(cinema).toStartWith("cinema: every 5 min — ");
});
