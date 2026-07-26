import { afterAll, expect, test } from "bun:test";
import { ping } from "./ntfy";

// ping() is the last line of every watcher and nothing else exercises it, so a
// missing import here is invisible until the moment an alert fires and the run
// dies instead of reaching the phone. This is that check: it calls ping for
// real against a fake fetch. It is not testing ntfy.sh, it is testing that the
// function runs at all.
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.NTFY_TOPIC;
});

test("ping reaches the network with the topic and headers set", async () => {
  process.env.NTFY_TOPIC = "test-topic";
  let seen: { url: string; init: any } | null = null;
  globalThis.fetch = (async (url: string, init: any) => {
    seen = { url: String(url), init };
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;

  await ping({ title: "MONACO", body: "up", priority: "urgent", tags: "checkered_flag" });

  expect(seen!.url).toBe("https://ntfy.sh/test-topic");
  expect(seen!.init.headers.Title).toBe("MONACO");
  expect(seen!.init.headers.Priority).toBe("urgent");
  expect(seen!.init.body).toBe("up");
});

test("a missing topic is a loud failure, not a silent no-op", async () => {
  delete process.env.NTFY_TOPIC;
  await expect(ping({ title: "t", body: "b" })).rejects.toThrow("NTFY_TOPIC");
});
