import { afterAll, expect, test } from "bun:test";
import { ping } from "./discord";

// ping() is the last line of every watcher and nothing else exercises it, so a
// missing import here is invisible until the moment an alert fires and the run
// dies instead of reaching the phone. This is that check: it calls ping for
// real against a fake fetch. It is not testing Discord, it is testing that the
// function runs at all and builds a payload Discord will accept.
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.DISCORD_WEBHOOK;
});

const WEBHOOK = "https://discord.com/api/webhooks/1/test";

function capture() {
  let seen: { url: string; init: any } | null = null;
  globalThis.fetch = (async (url: string, init: any) => {
    seen = { url: String(url), init };
    return new Response("", { status: 204 });
  }) as unknown as typeof fetch;
  return () => seen!;
}

test("ping posts an embed to the webhook", async () => {
  process.env.DISCORD_WEBHOOK = WEBHOOK;
  const seen = capture();

  await ping({ title: "MONACO", body: "up", priority: "urgent", tags: "checkered_flag" });

  const { url, init } = seen();
  const payload = JSON.parse(init.body);
  expect(url).toBe(WEBHOOK);
  expect(payload.username).toBe("SIGIL");
  expect(payload.embeds[0].title).toBe("MONACO");
  expect(payload.embeds[0].description).toBe("up");
  expect(payload.embeds[0].footer.text).toBe("checkered_flag");
  // urgent is the only priority that should get through a muted channel.
  expect(payload.content).toBe("@here");
});

test("a normal alert does not mention anyone", async () => {
  process.env.DISCORD_WEBHOOK = WEBHOOK;
  const seen = capture();

  await ping({ title: "Notion", body: "3 new" });

  expect(JSON.parse(seen().init.body).content).toBeUndefined();
});

// Discord rejects an over-long embed with a 400 instead of trimming it, which
// would turn a big cinema alert into a failed run.
test("an over-long body is cut, not rejected", async () => {
  process.env.DISCORD_WEBHOOK = WEBHOOK;
  const seen = capture();

  await ping({ title: "x".repeat(300), body: "y".repeat(5000) });

  const embed = JSON.parse(seen().init.body).embeds[0];
  expect(embed.title.length).toBe(256);
  expect(embed.description.length).toBe(4096);
});

test("a missing webhook is a loud failure, not a silent no-op", async () => {
  delete process.env.DISCORD_WEBHOOK;
  await expect(ping({ title: "t", body: "b" })).rejects.toThrow("DISCORD_WEBHOOK");
});
