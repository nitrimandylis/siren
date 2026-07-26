import { afterAll, expect, test } from "bun:test";
import { fetchRetry } from "./retry";

// fetchRetry sleeps between attempts, so the fake replaces Bun.sleep as well as
// fetch. Without that the give-up case would take twelve seconds.
const realFetch = globalThis.fetch;
const realSleep = Bun.sleep;
afterAll(() => {
  globalThis.fetch = realFetch;
  Bun.sleep = realSleep;
});

// Answers `failures` responses with `status`, then a 200.
function failThen(failures: number, status: number) {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls <= failures) return new Response("<html>gateway time-out</html>", { status });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  Bun.sleep = (async () => {}) as typeof Bun.sleep;
  return () => calls;
}

test("a 504 is retried until it succeeds", async () => {
  const calls = failThen(2, 504);
  const response = await fetchRetry("https://example.test");
  expect(response.status).toBe(200);
  expect(calls()).toBe(3);
});

test("a rate limit is retried too", async () => {
  const calls = failThen(1, 429);
  expect((await fetchRetry("https://example.test")).status).toBe(200);
  expect(calls()).toBe(2);
});

test("it gives up after four attempts and returns the last response", async () => {
  const calls = failThen(99, 504);
  const response = await fetchRetry("https://example.test");
  expect(response.status).toBe(504); // the caller writes the error message
  expect(calls()).toBe(4);
});

test("a bad token is not retried", async () => {
  const calls = failThen(99, 401);
  expect((await fetchRetry("https://example.test")).status).toBe(401);
  expect(calls()).toBe(1);
});

test("a 404 is returned as-is, since some callers expect one", async () => {
  const calls = failThen(99, 404);
  expect((await fetchRetry("https://example.test")).status).toBe(404);
  expect(calls()).toBe(1);
});

test("a dropped connection is retried, and rethrown if it never recovers", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls <= 2) throw new Error("ECONNRESET");
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  Bun.sleep = (async () => {}) as typeof Bun.sleep;
  expect((await fetchRetry("https://example.test")).status).toBe(200);
  expect(calls).toBe(3);

  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  await expect(fetchRetry("https://example.test")).rejects.toThrow("ECONNRESET");
  expect(calls).toBe(4);
});
