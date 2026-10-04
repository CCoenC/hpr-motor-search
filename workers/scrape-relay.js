const ALLOWED = new Set([
  "cart.amwprox.com",
  "www.siriusrocketry.biz",
  "siriusrocketry.biz",
  "www.moto-joe.com",
  "moto-joe.com",
]);

export default {
  async fetch(request, env) {
    if (!env.RELAY_SECRET || request.headers.get("X-Relay-Auth") !== env.RELAY_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("missing url", { status: 400 });
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (parsed.protocol !== "https:" || !ALLOWED.has(parsed.hostname)) {
      return new Response("host not allowed", { status: 403 });
    }
    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": request.headers.get("X-Relay-UA") || "Mozilla/5.0 (compatible; HPRMotorSearch/1.0)",
      },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/html; charset=utf-8",
        "X-Relay-Status": String(upstream.status),
        "X-Relay-Url": upstream.url,
      },
    });
  },
};
