import { join } from "node:path";

export const SCRAPE_UA = "Mozilla/5.0 (compatible; HPRMotorSearch/1.0; +https://github.com/CCoenC/hpr-motor-search)";

const RELAY_HOSTS = new Set(["cart.amwprox.com", "www.siriusrocketry.biz", "siriusrocketry.biz", "www.moto-joe.com", "moto-joe.com"]);

export async function fetchText(url: string, ms = 15000) {
  const direct = await fetchDirect(url, ms);
  if (!needsRelay(url, direct)) return direct;
  const relayed = await fetchViaRelay(url, ms);
  return relayed ?? direct;
}

export function isChallenge(text: string) {
  return text.length < 40000 && /one moment, please|being verified|just a moment|cf-browser-verification|attention required|access denied/i.test(text);
}

async function fetchDirect(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": SCRAPE_UA,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, url: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function needsRelay(url: string, result: { ok: boolean; status: number; text: string }) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!RELAY_HOSTS.has(host)) return false;
  return !result.ok || result.status === 403 || result.status === 429 || isChallenge(result.text) || result.text.length < 20000;
}

async function fetchViaRelay(url: string, ms: number) {
  const relay = await relayConfig();
  if (!relay) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(`${relay.url}/?url=${encodeURIComponent(url)}`, {
      headers: { "X-Relay-Auth": relay.secret, "X-Relay-UA": SCRAPE_UA },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status === 401 || text.trim() === "Hello World!") return null;
    const finalUrl = response.headers.get("x-relay-url") || url;
    const status = Number(response.headers.get("x-relay-status") || response.status);
    return { ok: status >= 200 && status < 300, status, text, url: finalUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function relayConfig() {
  if (process.env.RELAY_URL && process.env.RELAY_SECRET) {
    return { url: process.env.RELAY_URL.replace(/\/$/, ""), secret: process.env.RELAY_SECRET };
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(join(process.cwd(), "data/relay.json"), "utf8")) as { url?: string; secret?: string };
    if (!parsed.url || !parsed.secret) return null;
    return { url: parsed.url.replace(/\/$/, ""), secret: parsed.secret };
  } catch {
    return null;
  }
}

export async function mapPool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await task(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
