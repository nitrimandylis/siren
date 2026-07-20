import { expect, test } from "bun:test";
import { matchShowtimes, parseBookingData } from "./watch";

const data = {
  records: [
    { title: "AVENGERS: DOOMSDAY", movieId: "AV1" },
    { title: "DUNE: PART THREE", movieId: "DU1" },
  ],
  screens: [
    { scheduledFilmId: "AV1", cinemaId: "21", showtime: "2026-12-18T21:30:00", screenName: "IMAX 7", isImax: true, isImax3D: false },
    { scheduledFilmId: "AV1", cinemaId: "21", showtime: "2026-12-18T18:00:00", screenName: "Screen 3", isImax: false, isImax3D: false },
    { scheduledFilmId: "AV1", cinemaId: "01", showtime: "2026-12-19T20:00:00", screenName: "Screen 1", isImax: false, isImax3D: false },
    { scheduledFilmId: "DU1", cinemaId: "21", showtime: "2026-12-20T21:30:00", screenName: "IMAX 7", isImax: false, isImax3D: true },
  ],
};

test("title substring match is case-insensitive, all formats by default", () => {
  expect(matchShowtimes(data, { title: "avengers" })).toEqual([
    "2026-12-18 18:00 Screen 3 @ The Mall Athens",
    "2026-12-18 21:30 IMAX 7 @ The Mall Athens",
    "2026-12-19 20:00 Screen 1 @ Rentis",
  ]);
});

test("imax filter keeps only IMAX and IMAX 3D screens", () => {
  expect(matchShowtimes(data, { title: "AVENGERS", imax: true })).toEqual([
    "2026-12-18 21:30 IMAX 7 @ The Mall Athens",
  ]);
  expect(matchShowtimes(data, { title: "DUNE", imax: true })).toEqual([
    "2026-12-20 21:30 IMAX 7 @ The Mall Athens",
  ]);
});

test("cinema and from filters apply", () => {
  expect(matchShowtimes(data, { title: "AVENGERS", cinema: "01" })).toEqual([
    "2026-12-19 20:00 Screen 1 @ Rentis",
  ]);
  expect(matchShowtimes(data, { title: "AVENGERS", from: "2026-12-19" })).toEqual([
    "2026-12-19 20:00 Screen 1 @ Rentis",
  ]);
});

test("unlisted movie means no matches, not an error", () => {
  expect(matchShowtimes(data, { title: "ODYSSEY" })).toEqual([]);
});

test("parseBookingData extracts the blob and throws when missing", () => {
  const html = `<html><script>var bookingData = ${JSON.stringify(data)}</script></html>`;
  expect(parseBookingData(html).records.length).toBe(2);
  expect(() => parseBookingData("<html>nothing</html>")).toThrow("bookingData not found");
});
