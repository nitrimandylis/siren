// Shared fetch for every watcher. These all run unattended on a schedule, and
// the APIs they talk to blink: Notion sits behind Cloudflare and answers 504,
// GitHub answers 429 when the token is busy, and a runner's connection drops.
// A single blip should not fail a whole run, so retry the failures that are
// worth retrying and leave the rest alone.

const ATTEMPTS = 4;

// Anything other than 429 is our fault when it is a 4xx: a bad token, a wrong
// path, a repo that does not exist. Retrying those only delays the error.
function worthRetrying(status: number): boolean {
  return status === 429 || status >= 500;
}

// Returns the Response rather than throwing, so each caller keeps its own error
// message and its own handling of expected codes like a 404.
export async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const last = attempt === ATTEMPTS;
    try {
      const response = await fetch(url, init);
      if (response.ok || last || !worthRetrying(response.status)) return response;
    } catch (error) {
      // fetch throws instead of answering when the connection itself fails.
      if (last) throw error;
    }
    await Bun.sleep(attempt * 2000); // 2s, then 4s, then 6s
  }
}
