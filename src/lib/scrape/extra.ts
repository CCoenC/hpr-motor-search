import https from "node:https";
import tls from "node:tls";
import vm from "node:vm";
import { classifyHardware, type HardwareOffer } from "../hardware.ts";
import type { RawOffer, VendorPull } from "./apply.ts";
import { fetchText, isChallenge, mapPool, SCRAPE_UA } from "./http.ts";
import { centsFromDollars, packSizeOf } from "./match.ts";

// onebadhawk.com serves a RapidSSL leaf and omits the intermediate. Browsers fetch it. Node does not.
const RAPIDSSL_G1 = `-----BEGIN CERTIFICATE-----
MIIEszCCA5ugAwIBAgIQCyWUIs7ZgSoVoE6ZUooO+jANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjI0MzNaFw0yNzExMDIxMjI0MzNaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFlJhcGlkU1NMIFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC/uVklRBI1FuJdUEkFCuDL/I3aJQiaZ6aibRHj
ap/ap9zy1aYNrphe7YcaNwMoPsZvXDR+hNJOo9gbgOYVTPq8gXc84I75YKOHiVA4
NrJJQZ6p2sJQyqx60HkEIjzIN+1LQLfXTlpuznToOa1hyTD0yyitFyOYwURM+/CI
8FNFMpBhw22hpeAQkOOLmsqT5QZJYeik7qlvn8gfD+XdDnk3kkuuu0eG+vuyrSGr
5uX5LRhFWlv1zFQDch/EKmd163m6z/ycx/qLa9zyvILc7cQpb+k7TLra9WE17YPS
n9ANjG+ECo9PDW3N9lwhKQCNvw1gGoguyCQu7HE7BnW8eSSFAgMBAAGjggFmMIIB
YjAdBgNVHQ4EFgQUDNtsgkkPSmcKuBTuesRIUojrVjgwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwYwYDVR0gBFwwWjA3BglghkgBhv1sAQEwKjAoBggrBgEF
BQcCARYcaHR0cHM6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzALBglghkgBhv1sAQIw
CAYGZ4EMAQIBMAgGBmeBDAECAjANBgkqhkiG9w0BAQsFAAOCAQEAGUSlOb4K3Wtm
SlbmE50UYBHXM0SKXPqHMzk6XQUpCheF/4qU8aOhajsyRQFDV1ih/uPIg7YHRtFi
CTq4G+zb43X1T77nJgSOI9pq/TqCwtukZ7u9VLL3JAq3Wdy2moKLvvC8tVmRzkAe
0xQCkRKIjbBG80MSyDX/R4uYgj6ZiNT/Zg6GI6RofgqgpDdssLc0XIRQEotxIZcK
zP3pGJ9FCbMHmMLLyuBd+uCWvVcF2ogYAawufChS/PT61D9rqzPRS5I2uqa3tmIT
44JhJgWhBnFMb7AGQkvNq9KNS9dd3GWc17H/dXa1enoxzWjE0hBdFjxPhUb0W3wi
8o34/m8Fxw==
-----END CERTIFICATE-----`;

function hawkGet(url: string, redirects = 0): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": SCRAPE_UA,
        },
        ca: [...tls.rootCertificates, RAPIDSSL_G1],
      },
      (res) => {
        const location = res.headers.location;
        if (location && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirects < 3) {
          res.resume();
          resolve(hawkGet(new URL(location, url).toString(), redirects + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.setTimeout(20000, () => req.destroy(new Error("Onebadhawk timed out")));
    req.on("error", reject);
  });
}

const CS_ROOTS = [
  "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors.html",
  "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/hardware.html",
  "https://www.csrocketry.com/rocket-motors/cesaroni/motors.html",
  "https://www.csrocketry.com/rocket-motors/cesaroni/hardware.html",
];

const HAWK_PAGES = [
  "https://onebadhawk.com/38mm--120ns-reload-kits.html",
  "https://onebadhawk.com/38mm--240ns-reload-kits.html",
  "https://onebadhawk.com/38mm--480ns-reload-kits.html",
  "https://onebadhawk.com/38mm--740ns-reload-kits.html",
  "https://onebadhawk.com/loki---38mm-hardware.html",
  "https://onebadhawk.com/loki---54mm-hardware.html",
  "https://onebadhawk.com/loki---76mm-hardware.html",
];

export async function scrapeCsRocketry(checkedAt: string): Promise<{ pull: VendorPull; hardware: HardwareOffer[] }> {
  const slug = "cs_rocketry";
  const name = "CS Rocketry";
  try {
    const { offers, hardware } = await crawlCs();
    return {
      pull: { slug, name, ok: offers.length > 0, note: offers.length ? null : "No motor rows in the CS Rocketry tree.", offers, checkedAt },
      hardware,
    };
  } catch (error) {
    return { pull: failed(slug, name, checkedAt, error instanceof Error ? error.message : "CS Rocketry fetch failed."), hardware: [] };
  }
}

function csPrice(list: string) {
  const sale = list.match(/sale_price">\s*\$([0-9,.]+)/i)?.[1];
  if (sale) return sale;
  const tagged = list.match(/category-product-price">\s*\$([0-9,.]+)/i)?.[1];
  if (tagged) return tagged;
  const stripped = list.replace(/worth\s*\$[0-9,.]+/gi, "");
  return stripped.match(/\$([0-9,.]+)/)?.[1];
}

export function csOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const card of html.split("category-product-card").slice(1)) {
    const list = card.split("product_grid_view")[0] ?? card;
    const link = list.match(/<h3><a href="([^"]+)" title="([^"]+)"/i);
    if (!link) continue;
    const title = decode(link[2]).replace(/\s+-\s+\(Earn[\s\S]*$/i, "").trim();
    const price = csPrice(list);
    if (!title || !price || classifyHardware(title)) continue;
    if (!/\b[A-O]\d{2,4}/i.test(title)) continue;
    const stock = list.match(/Stock Level:\s*(\d+)/i);
    const count = stock ? Number(stock[1]) : null;
    const out = /out of stock/i.test(list) || count === 0;
    offers.push({
      title,
      url: link[1],
      status: out ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price),
      packSize: packSizeOf(`${title} ${list}`),
      stockCount: count && count > 0 ? count : null,
      leadTime: null,
    });
  }
  return offers;
}

export function csHardwareOffers(html: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const card of html.split("category-product-card").slice(1)) {
    const list = card.split("product_grid_view")[0] ?? card;
    const link = list.match(/<h3><a href="([^"]+)" title="([^"]+)"/i);
    if (!link) continue;
    const title = decode(link[2]).replace(/\s+-\s+\(Earn[\s\S]*$/i, "").trim();
    const price = csPrice(list);
    const classified = classifyHardware(title);
    if (!title || !price || !classified) continue;
    const stock = list.match(/Stock Level:\s*(\d+)/i);
    const count = stock ? Number(stock[1]) : null;
    const out = /out of stock/i.test(list) || count === 0;
    offers.push({
      ...classified,
      title,
      vendor: "CS Rocketry",
      vendorSlug: "cs_rocketry",
      url: link[1],
      status: out ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price),
      stockCount: count && count > 0 ? count : null,
    });
  }
  return offers;
}

async function crawlCs() {
  const queue = [...CS_ROOTS];
  const seen = new Set<string>();
  const offers: RawOffer[] = [];
  const hardware: HardwareOffer[] = [];
  while (queue.length && seen.size < 90) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let html = "";
    try {
      const response = await fetchText(url, 20000);
      if (response.ok && !isChallenge(response.text)) html = response.text;
    } catch {
      html = "";
    }
    if (!html) continue;
    offers.push(...csOffers(html));
    hardware.push(...csHardwareOffers(html));
    const nav = html.replace(/<form[^>]*category-product-card[\s\S]*?<\/form>/gi, "");
    for (const href of nav.matchAll(/href="(https:\/\/www\.csrocketry\.com\/rocket-motors\/[^"]+)"/gi)) {
      const next = href[1].split("#")[0];
      if (!csAllowed(next) || seen.has(next) || queue.includes(next)) continue;
      queue.push(next);
    }
  }
  return { offers: dedupeOffers(offers), hardware: dedupeHardware(hardware) };
}

function csAllowed(url: string) {
  if (/estes|quest|igniter|grease|brush|delay-kit|hobby-delay|\brdk\b/i.test(url)) return false;
  return /\/aerotech-rocketry\/(?:motors|hardware)|\/cesaroni\/(?:motors|hardware)/i.test(url);
}

export async function scrapeRocketarium(): Promise<HardwareOffer[]> {
  try {
    const response = await fetchText("https://www.rocketarium.com/RMS", 20000);
    if (!response.ok || isChallenge(response.text)) return [];
    const cards = rocketariumCards(response.text);
    const pages = await mapPool(cards, 4, async (card) => {
      let status: HardwareOffer["status"] = "out_of_stock";
      try {
        const page = await fetchText(card.url, 15000);
        if (page.ok && !isChallenge(page.text) && !/sorry,\s*out of stock/i.test(page.text)) status = "in_stock";
      } catch {
        status = "out_of_stock";
      }
      const classified = classifyHardware(card.title.replace(/reloadable rocket motor/i, "Complete Motor Hardware"), "AeroTech");
      if (!classified) return null;
      const offer: HardwareOffer = {
        ...classified,
        title: card.title,
        vendor: "Rocketarium",
        vendorSlug: "rocketarium",
        url: card.url,
        status,
        priceCents: card.priceCents,
        stockCount: null,
      };
      return offer;
    });
    return dedupeHardware(pages.flat().filter((offer) => offer != null));
  } catch {
    return [];
  }
}

export function rocketariumCards(html: string) {
  const cards: Array<{ title: string; url: string; priceCents: number | null }> = [];
  for (const row of html.split(/productListing-(?:odd|even)/i).slice(1)) {
    const link = row.match(/<a[^>]*href="(https:\/\/www\.rocketarium\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const price = row.match(/itemprop="price" content="([0-9.]+)"/i)?.[1] ?? row.match(/\$([0-9,.]+)/)?.[1];
    if (!link || !price) continue;
    const title = decode(link[2]);
    if (!title || /wrench|drill|grease/i.test(title)) continue;
    cards.push({ title, url: link[1], priceCents: centsFromDollars(price) });
  }
  return cards;
}

export async function scrapeOnebadhawk(checkedAt: string): Promise<{ pull: VendorPull; hardware: HardwareOffer[] }> {
  const slug = "onebadhawk";
  const name = "Onebadhawk";
  try {
    const pages = await mapPool(HAWK_PAGES, 3, async (url) => {
      try {
        const response = await hawkGet(url);
        if (!response.ok || isChallenge(response.text)) return { offers: [] as RawOffer[], hardware: [] as HardwareOffer[] };
        return { offers: hawkOffers(response.text, url), hardware: hawkHardware(response.text, url) };
      } catch {
        return { offers: [] as RawOffer[], hardware: [] as HardwareOffer[] };
      }
    });
    const offers = dedupeOffers(pages.flatMap((page) => page.offers));
    const hardware = dedupeHardware(pages.flatMap((page) => page.hardware));
    return {
      pull: { slug, name, ok: offers.length > 0, note: offers.length ? null : "No Loki reloads on the Onebadhawk pages.", offers, checkedAt },
      hardware,
    };
  } catch (error) {
    return { pull: failed(slug, name, checkedAt, error instanceof Error ? error.message : "Onebadhawk fetch failed."), hardware: [] };
  }
}

export function hawkOffers(html: string, url: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const block of paragraphs(html)) {
    if (/motor complete|hardware set|no propellent|no propellant/i.test(block)) continue;
    const price = block.match(/\$(\d+\.\d{2})/);
    const code = block.match(/\b([A-O])\s*(\d{2,4})\b/i);
    if (!price || !code) continue;
    const head = block.split("$")[0]?.replace(/\s+/g, " ").trim().slice(0, 90) ?? "";
    const title = head || `${code[1].toUpperCase()}${code[2]} Loki`;
    const two = /two reloads/i.test(block);
    offers.push({
      title,
      designationHint: `${code[1].toUpperCase()}${code[2]}`,
      url,
      status: /sold out|out of stock/i.test(block) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: two ? 2 : packSizeOf(block),
      stockCount: null,
      leadTime: null,
    });
  }
  return offers;
}

export function hawkHardware(html: string, url: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const block of paragraphs(html)) {
    const price = block.match(/\$(\d+\.\d{2})/);
    const size = block.match(/\b(\d{2,3})\s*mm\s*(\d{2,5})\s*Ns\b/i);
    if (!price || !size || !/complete|casing|closure|hardware/i.test(block)) continue;
    const title = `Loki ${size[1]}mm ${size[2]}Ns Complete Motor Hardware`;
    const classified = classifyHardware(title, "Loki Research");
    if (!classified) continue;
    offers.push({
      ...classified,
      title,
      vendor: "Onebadhawk",
      vendorSlug: "onebadhawk",
      url,
      status: /sold out|out of stock/i.test(block) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      stockCount: null,
    });
  }
  return offers;
}

function paragraphs(html: string) {
  return [...html.matchAll(/<div class="paragraph">([\s\S]*?)<\/div>/gi)].map((match) => decode(match[1].replace(/<[^>]+>/g, " ")));
}

function failed(slug: string, name: string, checkedAt: string, note: string): VendorPull {
  return { slug, name, ok: false, note, offers: [], checkedAt };
}

function decode(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#8203;/g, "")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeOffers(offers: RawOffer[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.url}|${offer.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeHardware(offers: HardwareOffer[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.url}|${offer.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SUNWARD_CATS = [
  "https://www.sunward1.com/shop/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-24-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-29-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-38-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-54-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-75-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-98-hardware/",
  "https://www.sunward1.com/product-category/cesaroni-technology/cti-pro-150-hardware/",
  "https://www.sunward1.com/product-category/hypertek-hybrid-systems/fuels-grains/",
];

export async function scrapeSunward(): Promise<HardwareOffer[]> {
  try {
    const session = new SunwardSession();
    const urls = new Set<string>();
    for (const root of SUNWARD_CATS) {
      let next: string | null = root;
      for (let page = 0; page < 6 && next; page += 1) {
        const html = await session.text(next);
        if (!html) break;
        for (const link of html.matchAll(/href="(https:\/\/www\.sunward1\.com\/product\/[^"#?]+)"/gi)) urls.add(link[1]);
        const more = html.match(/class="next page-numbers"[^>]*href="([^"]+)"/i)?.[1] ?? html.match(/href="([^"]+)"[^>]*class="next page-numbers"/i)?.[1];
        next = more ? more.replace(/&/g, "&") : null;
      }
    }
    const pages = await mapPool([...urls], 4, async (url) => {
      try {
        const html = await session.text(url);
        return html ? sunwardHardware(html, url) : [];
      } catch {
        return [];
      }
    });
    return dedupeHardware(pages.flat());
  } catch {
    return [];
  }
}

export function sunwardHardware(html: string, url: string): HardwareOffer[] {
  const title = decode(html.match(/<h1[^>]*product_title[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  if (!title) return [];
  const raw = html.match(/data-product_variations="([^"]+)"/i)?.[1];
  if (raw) {
    let variations: Array<{ attributes?: Record<string, string>; display_price?: number; is_in_stock?: boolean }> = [];
    try {
      variations = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as typeof variations;
    } catch {
      variations = [];
    }
    return variations.flatMap((variation) => {
      const grain = Object.values(variation.attributes ?? {}).find((value) => /grain/i.test(value)) ?? null;
      const label = grain ? grain.replace(/-/g, " ") : null;
      const name = label ? `${title} ${label}` : title;
      return sunwardOffer(name, url, variation.display_price ?? null, variation.is_in_stock === true, grain);
    });
  }
  const product = ldProduct(html);
  const offer = product?.offers && !Array.isArray(product.offers) ? product.offers : Array.isArray(product?.offers) ? product.offers[0] : null;
  const price = typeof offer?.price === "string" || typeof offer?.price === "number" ? offer.price : null;
  const inStock = typeof offer?.availability === "string" && !/outofstock/i.test(offer.availability);
  return sunwardOffer(title, url, price, inStock, null);
}

function sunwardOffer(title: string, url: string, price: string | number | null, inStock: boolean, grain: string | null): HardwareOffer[] {
  const grainCode = grain?.match(/(\d+)\s*-?\s*gxl/i)?.[1]
    ? `${grain.match(/(\d+)/)?.[1]}GXL`
    : grain?.match(/(\d+)/)?.[1]
      ? `${grain.match(/(\d+)/)?.[1]}G`
      : null;
  const classifyAs = title
    .replace(/\bpro\s*(\d{2,3})\b/i, (_, dia: string) => `Pro${dia}${grainCode ? ` ${grainCode}` : ""}`)
    .replace(/starter (?:kit|set)/i, "Complete Motor Hardware")
    .replace(/casing with closure set/i, "Complete Motor Hardware")
    .replace(/hardware casing set/i, "Complete Motor Hardware")
    .replace(/nozzle holder/i, "Aft Closure");
  const classified = classifyHardware(classifyAs, "Cesaroni Technology");
  const cents = price == null ? null : centsFromDollars(price);
  if (!classified || cents == null) return [];
  return [{
    ...classified,
    title,
    vendor: "Sunward",
    vendorSlug: "sunward",
    url,
    status: inStock ? "in_stock" : "out_of_stock",
    priceCents: cents,
    stockCount: null,
  }];
}

function ldProduct(html: string) {
  const found: Array<{ name?: string; offers?: { price?: string | number; availability?: string } | Array<{ price?: string | number; availability?: string }> }> = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      collectProducts(JSON.parse(match[1]) as unknown, found);
    } catch {
      // A broken block is not this product.
    }
  }
  return found[0] ?? null;
}

function collectProducts(value: unknown, found: Array<{ name?: string; offers?: { price?: string | number; availability?: string } | Array<{ price?: string | number; availability?: string }> }>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, found);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record["@type"] === "Product") found.push(record as (typeof found)[number]);
  for (const child of Object.values(record)) collectProducts(child, found);
}

class SunwardSession {
  private cookie = "";

  async text(url: string) {
    let html = await this.get(url);
    if (!html.includes("One moment, please")) return html;
    if (!(await this.solve(html))) return "";
    html = await this.get(url);
    return html.includes("One moment, please") ? "" : html;
  }

  private async solve(html: string) {
    const token = sunwardToken(html);
    if (!token) return false;
    const query = new URLSearchParams({ wsidchk: token.wsidchk, pdata: token.pdata, id: token.id, ts: token.ts, cttl: "0" });
    await this.get(`https://www.sunward1.com${token.path}?${query.toString()}`);
    return this.cookie.includes("wssplashchk=");
  }

  private async get(url: string) {
    let current = url;
    let body = "";
    for (let hop = 0; hop < 4; hop += 1) {
      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      };
      if (this.cookie) headers.Cookie = this.cookie;
      const response = await fetch(current, { headers, redirect: "manual" });
      for (const item of response.headers.getSetCookie?.() ?? []) {
        const pair = item.split(";")[0];
        if (!pair) continue;
        const name = pair.split("=")[0];
        const kept = this.cookie.split("; ").filter((part) => part && !part.startsWith(`${name}=`));
        kept.push(pair);
        this.cookie = kept.join("; ");
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location") ?? "", current).toString();
        continue;
      }
      body = await response.text();
      break;
    }
    return body;
  }
}

function sunwardToken(html: string) {
  const script = html.match(/<script>\s*(var a0M=[\s\S]*?)<\/script>/)?.[1];
  const cut = script?.indexOf("a0b(function") ?? -1;
  const dExpr = html.match(/d=\+(\(\([^;]+?\)\))/)?.[1];
  const nExpr = html.match(/N=\+(\(\([^;]+?\)\))/)?.[1];
  const ts = html.match(/b\['value'\]='(\d+)'/)?.[1];
  const path = html.match(/X='(\/z0f[0-9a-f]+)'/)?.[1];
  const pdata = html.match(/C='(https%3A[^']+)'/)?.[1];
  const tail = html.match(/A\[S\(0x167\)\]=S\(0x168\)\+S\([^)]+\)\+'([0-9a-f]+)'\+'([0-9a-f]+)'/);
  if (!script || cut < 0 || !dExpr || !nExpr || !ts || !path || !pdata || !tail) return null;
  if (!/^[+!()[\]]+$/.test(dExpr) || !/^[+!()[\]]+$/.test(nExpr)) return null;
  const sandbox: { window?: object; __S?: (index: number) => string } = { window: {} };
  vm.createContext(sandbox);
  try {
    vm.runInContext(`${script.slice(0, cut)}\nthis.__S = a0r;`, sandbox, { timeout: 1000 });
  } catch {
    return null;
  }
  const read = sandbox.__S;
  if (!read) return null;
  const wsidchk = sunwardCheckValue(dExpr, nExpr);
  if (wsidchk == null) return null;
  return { wsidchk: String(wsidchk), id: `${read(0x168)}${read(0x16a)}${tail[1]}${tail[2]}`, ts, path, pdata: decodeURIComponent(pdata) };
}

// Splash halves are digit strings. Plus them as numbers; concatenating is the wrong token.
export function sunwardCheckValue(dExpr: string, nExpr: string) {
  if (!/^[+!()[\]]+$/.test(dExpr) || !/^[+!()[\]]+$/.test(nExpr)) return null;
  let left: unknown;
  let right: unknown;
  try {
    left = Function(`"use strict"; return +(${dExpr});`)();
    right = Function(`"use strict"; return +(${nExpr});`)();
  } catch {
    return null;
  }
  if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  return left + right;
}
