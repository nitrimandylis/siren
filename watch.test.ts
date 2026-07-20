import { expect, test } from "bun:test";
import { findImaxDrops } from "./watch";

function page(records: object[], screens: object[]): string {
  const data = JSON.stringify({ records, screens });
  return `<html><script>var bookingData = ${data}</script></html>`;
}

const odyssey = { title: "THE ODYSSEY", movieId: "HO00106520" };

test("finds IMAX showtime on/after cutoff at The Mall", () => {
  const html = page(
    [odyssey],
    [
      // qualifies
      { scheduledFilmId: "HO00106520", cinemaId: "21", showtime: "2026-07-30T21:30:00", screenName: "IMAX 7", isImax: true, isImax3D: false, soldoutStatus: false },
      // wrong: before cutoff
      { scheduledFilmId: "HO00106520", cinemaId: "21", showtime: "2026-07-29T21:30:00", screenName: "IMAX 7", isImax: true, isImax3D: false, soldoutStatus: false },
      // wrong: not IMAX
      { scheduledFilmId: "HO00106520", cinemaId: "21", showtime: "2026-07-31T21:30:00", screenName: "Screen 3", isImax: false, isImax3D: false, soldoutStatus: false },
      // wrong: other cinema
      { scheduledFilmId: "HO00106520", cinemaId: "01", showtime: "2026-07-31T21:30:00", screenName: "IMAX 7", isImax: true, isImax3D: false, soldoutStatus: false },
      // wrong: other movie
      { scheduledFilmId: "HO00999999", cinemaId: "21", showtime: "2026-07-31T21:30:00", screenName: "IMAX 7", isImax: true, isImax3D: false, soldoutStatus: false },
    ],
  );
  expect(findImaxDrops(html)).toEqual(["2026-07-30 21:30 IMAX 7"]);
});

test("returns empty when nothing qualifies", () => {
  const html = page([odyssey], []);
  expect(findImaxDrops(html)).toEqual([]);
});

test("throws when Odyssey is missing from listings", () => {
  const html = page([{ title: "OTHER FILM", movieId: "X" }], []);
  expect(() => findImaxDrops(html)).toThrow("THE ODYSSEY not in listings");
});

test("throws when bookingData is missing", () => {
  expect(() => findImaxDrops("<html>nothing here</html>")).toThrow("bookingData not found");
});
