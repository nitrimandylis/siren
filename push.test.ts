import { afterAll, expect, test } from "bun:test";
import { ping } from "./push";

// The transport is picked from the environment here and nowhere else, so this
// is the one check that the right sender fires, and that no sender is loud.
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.DISCORD_WEBHOOK;
  delete process.env.NTFY_TOPIC;
});

function capture() {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response("", { status: 204 });
  }) as unknown as typeof fetch;
  return urls;
}

test("only the transport that is set gets the push", async () => {
  process.env.DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1/test";
  delete process.env.NTFY_TOPIC;
  const urls = capture();
  await ping({ title: "t", body: "b" });
  expect(urls).toEqual(["https://discord.com/api/webhooks/1/test"]);

  delete process.env.DISCORD_WEBHOOK;
  process.env.NTFY_TOPIC = "test-topic";
  urls.length = 0;
  await ping({ title: "t", body: "b" });
  expect(urls).toEqual(["https://ntfy.sh/test-topic"]);
});

test("both set means both get it", async () => {
  process.env.DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1/test";
  process.env.NTFY_TOPIC = "test-topic";
  const urls = capture();
  await ping({ title: "t", body: "b" });
  expect(urls.sort()).toEqual(["https://discord.com/api/webhooks/1/test", "https://ntfy.sh/test-topic"]);
});

test("neither set is a loud failure, not a silent no-op", async () => {
  delete process.env.DISCORD_WEBHOOK;
  delete process.env.NTFY_TOPIC;
  await expect(ping({ title: "t", body: "b" })).rejects.toThrow("DISCORD_WEBHOOK");
});
