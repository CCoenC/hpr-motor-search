import { classifyHardware, type HardwareOffer } from "../hardware.ts";
import { centsFromDollars } from "./match.ts";
import { fetchText, mapPool } from "./http.ts";

const APOGEE = [
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/24mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Casings/29mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/29mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Casings/38mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/38mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Casings/54mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/54mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Casings/75mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/75mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Casings/98mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Rouse-Tech_Casings/98mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/24mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/29mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/29mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/38mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/54mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/54mm_Closures",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/75mm_Casings",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Casings/75mm_Closures",
];

const LOKI = [
  ["38mm", "https://lokiresearch.com/secure/store.asp?groupid=5520031443530"],
  ["54mm", "https://lokiresearch.com/secure/store.asp?groupid=521200312291168"],
  ["76mm", "https://lokiresearch.com/secure/store.asp?groupid=52120032164128"],
  ["98mm", "https://lokiresearch.com/secure/store.asp?groupid=52120032311666"],
  ["152mm", "https://lokiresearch.com/secure/store.asp?groupid=52120034052913"],
] as const;

export async function scrapeHardwareShops(): Promise<HardwareOffer[]> {
  const [apogee, loki, sirius, moto, performance, erockets] = await Promise.all([
    scrapeApogeeHardware().catch(() => []),
    scrapeLokiHardware().catch(() => []),
    scrapeSiriusHardware().catch(() => []),
    scrapeMotoHardware().catch(() => []),
    scrapePerformanceHardware().catch(() => []),
    scrapeErocketsHardware().catch(() => []),
  ]);
  return dedupe([...apogee, ...loki, ...sirius, ...moto, ...performance, ...erockets]);
}

export async function scrapeApogeeHardware(): Promise<HardwareOffer[]> {
  const pages = await mapPool(APOGEE, 2, async (url) => {
    const offers: HardwareOffer[] = [];
    for (let page = 1; page <= 4; page += 1) {
      try {
        const response = await fetchText(page === 1 ? url : `${url}?page=${page}`, 20000);
        if (!response.ok) break;
        const batch = apogeeHardwareOffers(response.text, /cesaroni/i.test(url) ? "Cesaroni Technology" : "AeroTech");
        if (!batch.length) break;
        offers.push(...batch);
        if (batch.length < 8) break;
      } catch {
        break;
      }
    }
    return offers;
  });
  return dedupe(pages.flat());
}

export async function scrapeLokiHardware(): Promise<HardwareOffer[]> {
  const pages = await mapPool([...LOKI], 2, async ([, url]) => {
    try {
      const response = await fetchText(url, 20000);
      if (!response.ok) return [];
      return lokiHardwareOffers(response.text);
    } catch {
      return [];
    }
  });
  return dedupe(pages.flat());
}

export function apogeeHardwareOffers(html: string, hint?: string | null): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const row of html.split(/<tr/i).slice(1)) {
    const title = clean(row.match(/class="product_name"><a[^>]*>([^<]+)<\/a>/i)?.[1] ?? "");
    const href = row.match(/class="product_name"><a[^>]*href="(https:\/\/www\.apogeerockets\.com\/[^"]+)"/i)?.[1];
    const price = row.match(/class="single_price">\$([0-9,.]+)/)?.[1];
    if (!title || !href || !price) continue;
    const classified = classifyHardware(title, hint);
    if (!classified) continue;
    const stocked = /Add:\s*<input/i.test(row);
    offers.push({
      ...classified,
      title,
      vendor: "Apogee Components",
      vendorSlug: "apogee",
      url: decodeUrl(href),
      status: stocked ? "in_stock" : "out_of_stock",
      priceCents: centsFromDollars(price),
      stockCount: null,
    });
  }
  return offers;
}

export function lokiHardwareOffers(html: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const row of html.split(/<tr/i).slice(1)) {
    const id = row.match(/storeDetail\.asp\?id=(\d+)/i)?.[1];
    if (!id) continue;
    const raw = row.match(/storeDetail\.asp\?id=\d+[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    const title = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const price = row.match(/\$(\d+\.\d{2})/);
    if (!title || !price) continue;
    const classified = classifyHardware(title, "Loki Research");
    if (!classified) continue;
    const out = /out of stock/i.test(row);
    offers.push({
      ...classified,
      title,
      vendor: "Loki Research",
      vendorSlug: "loki",
      url: `https://lokiresearch.com/secure/storeDetail.asp?id=${id}`,
      status: out ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      stockCount: null,
    });
  }
  return offers;
}

function dedupe(offers: HardwareOffer[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.vendorSlug}|${offer.url.split("?")[0]}|${offer.variant ?? ""}|${offer.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SIRIUS_ROOTS = [
  "https://www.siriusrocketry.biz/ishop/index.php?main_page=index&cPath=57_55",
  "https://www.siriusrocketry.biz/ishop/index.php?main_page=index&cPath=36_37",
];

export async function scrapeSiriusHardware(): Promise<HardwareOffer[]> {
  const queue = [...SIRIUS_ROOTS];
  const seen = new Set<string>();
  const offers: HardwareOffer[] = [];
  while (queue.length && seen.size < 40) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let html = "";
    try {
      const response = await fetchText(url, 20000);
      if (response.ok) html = response.text;
    } catch {
      html = "";
    }
    if (!html) continue;
    offers.push(...siriusHardwareOffers(html));
    for (const link of html.matchAll(/<div class="categoryListBoxContents"[\s\S]*?<a href="([^"]+)"[\s\S]*?<br\s*\/?>\s*([^<]+)<\/a>/gi)) {
      const label = link[2].replace(/\s+/g, " ").trim();
      const href = abs(link[1], "https://www.siriusrocketry.biz/ishop/");
      if (!href || seen.has(href) || queue.includes(href)) continue;
      if (/delay|igniter|retainer|estes/i.test(label)) continue;
      queue.push(href);
    }
    const next = html.match(/<a[^>]+href="([^"]+)"[^>]*title="Next Page"/i)?.[1];
    if (next) {
      const href = abs(next, url);
      if (href && !seen.has(href) && !queue.includes(href)) queue.push(href);
    }
  }
  return dedupe(offers);
}

export function siriusHardwareOffers(html: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const row of html.split(/productListing-(?:odd|even)/i).slice(1)) {
    const link = row.match(/class="itemTitle"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = clean(link[2]);
    const classified = classifyHardware(title, "AeroTech");
    if (!classified) continue;
    const price = row.match(/productSalePrice">\s*Sale:&nbsp;\$([0-9,.]+)/i)?.[1] ?? row.match(/productSpecialPrice">\s*\$([0-9,.]+)/i)?.[1] ?? row.match(/normalprice">\s*\$([0-9,.]+)/i)?.[1] ?? row.match(/productBasePrice">\s*\$([0-9,.]+)/i)?.[1];
    if (!price) continue;
    const href = abs(link[1], "https://www.siriusrocketry.biz/ishop/");
    if (!href) continue;
    offers.push({
      ...classified,
      title,
      vendor: "Sirius Rocketry",
      vendorSlug: "sirius",
      url: href,
      status: /sold out|button_sold_out/i.test(row) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price),
      stockCount: null,
    });
  }
  return offers;
}

const MOTO = [
  ["https://www.moto-joe.com/index.php?route=product/category&path=60_83&limit=100", "AeroTech"],
  ["https://www.moto-joe.com/index.php?route=product/category&path=60_82&limit=100", "Cesaroni Technology"],
] as const;

export async function scrapeMotoHardware(): Promise<HardwareOffer[]> {
  const cards: Array<{ url: string; title: string; price: string; hint: string }> = [];
  for (const [root, hint] of MOTO) {
    for (let page = 1; page <= 6; page += 1) {
      const url = page === 1 ? root : `${root}&page=${page}`;
      let html = "";
      try {
        const response = await fetchText(url, 20000);
        if (response.ok) html = response.text;
      } catch {
        break;
      }
      const batch = motoHardwareCards(html, hint);
      if (!batch.length) break;
      cards.push(...batch);
      if (batch.length < 40) break;
    }
  }
  const unique = dedupeCards(cards);
  const rows = await mapPool(unique, 4, async (card) => {
    try {
      const response = await fetchText(card.url, 15000);
      if (!response.ok) return null;
      return motoHardwareOffer(response.text, card);
    } catch {
      return null;
    }
  });
  return rows.filter((row): row is HardwareOffer => row != null);
}

export function motoHardwareCards(html: string, hint: string) {
  const cards: Array<{ url: string; title: string; price: string; hint: string }> = [];
  for (const block of html.split('class="product-thumb"').slice(1)) {
    const title = clean(block.match(/<h4>\s*<a[^>]*>([^<]+)/i)?.[1] ?? "");
    const href = block.match(/href="([^"]*product_id=\d+[^"]*)"/i)?.[1];
    const price = block.match(/class="price">\s*\$([0-9,.]+)/i)?.[1];
    if (!title || !href || !price || !classifyHardware(title, hint)) continue;
    const id = href.match(/product_id=(\d+)/i)?.[1];
    if (!id) continue;
    cards.push({ url: `https://www.moto-joe.com/index.php?route=product/product&product_id=${id}`, title, price, hint });
  }
  return cards;
}

export function motoHardwareOffer(html: string, card: { url: string; title: string; price: string; hint: string }): HardwareOffer | null {
  const heading = clean(html.match(/<h1[^>]*>\s*([^<]+)/i)?.[1] ?? card.title);
  const classified = classifyHardware(heading, card.hint);
  if (!classified) return null;
  const price = html.match(/<h2>\s*\$([0-9,.]+)/i)?.[1] ?? card.price;
  const availability = html.match(/Availability:\s*([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  if (!availability) return null;
  const count = /^(\d+)$/.exec(availability);
  const special = /pre-?order|special order|back-?order/i.test(availability);
  const inStock = count ? Number(count[1]) > 0 : /in stock/i.test(availability);
  return {
    ...classified,
    title: heading,
    vendor: "Moto-Joe Rocketry",
    vendorSlug: "moto_joe",
    url: card.url,
    status: inStock ? "in_stock" : special ? "special_order" : "out_of_stock",
    priceCents: centsFromDollars(price),
    stockCount: count && Number(count[1]) > 0 ? Number(count[1]) : null,
  };
}

const PERFORMANCE = [
  ["52", "AeroTech"],
  ["32902113543318", "Cesaroni Technology"],
  ["105200411244039", "Loki Research"],
] as const;

export async function scrapePerformanceHardware(): Promise<HardwareOffer[]> {
  const offers: HardwareOffer[] = [];
  const seen = new Set<string>();
  const queue: Array<{ id: string; hint: string }> = PERFORMANCE.map(([id, hint]) => ({ id, hint }));
  while (queue.length && seen.size < 24) {
    const next = queue.shift();
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    let html = "";
    try {
      const response = await fetchText(`https://performancehobbies.com/secure/store.aspx?groupid=${next.id}`, 20000);
      if (response.ok) html = response.text;
    } catch {
      html = "";
    }
    if (!html) continue;
    offers.push(...performanceHardwareOffers(html, next.id, next.hint));
    if (next.id === "52") continue;
    for (const link of html.matchAll(/<a[^>]+href="([^"]*groupid=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/addtocart/i.test(link[1])) continue;
      const label = clean(link[3]);
      if (!/hardware|casing|closure|case\b|seal|spacer|bulkhead|boat/i.test(label)) continue;
      if (/igniter|estes|delay|o-?ring|nozzle/i.test(label)) continue;
      if (!seen.has(link[2])) queue.push({ id: link[2], hint: next.hint });
    }
  }
  return dedupe(offers);
}

export function performanceHardwareOffers(html: string, groupId: string, hint: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  for (const row of html.split(/<tr/i).slice(1)) {
    const title = clean(row.match(/<b>([\s\S]*?)<\/b>/i)?.[1] ?? "");
    const price = row.match(/\$(\d+\.\d{2})/)?.[1];
    if (!title || !price) continue;
    const classified = classifyHardware(title, hint);
    if (!classified) continue;
    offers.push({
      ...classified,
      title,
      vendor: "Performance Hobbies",
      vendorSlug: "performancehobbies",
      url: `https://performancehobbies.com/secure/store.aspx?groupid=${groupId}#${encodeURIComponent(title)}`,
      status: /out of stock/i.test(row) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price),
      stockCount: null,
    });
  }
  return offers;
}

const EROCKETS = ["https://www.erockets.biz/hardware-casings/", "https://www.erockets.biz/aerotech-parts/"];

export async function scrapeErocketsHardware(): Promise<HardwareOffer[]> {
  const offers: HardwareOffer[] = [];
  for (const root of EROCKETS) {
    for (let page = 1; page <= 6; page += 1) {
      const url = page === 1 ? root : `${root}?page=${page}`;
      let html = "";
      try {
        const response = await fetchText(url, 20000);
        if (!response.ok) break;
        html = response.text;
      } catch {
        break;
      }
      const articles = html.match(/<article/gi)?.length ?? 0;
      if (!articles) break;
      offers.push(...erocketsHardwareOffers(html));
      if (articles < 8) break;
    }
  }
  return dedupe(offers);
}

export function erocketsHardwareOffers(html: string): HardwareOffer[] {
  const offers: HardwareOffer[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<article[\s\S]*?<\/article>/gi)) {
    const block = match[0];
    const link = block.match(/href="(https:\/\/www\.erockets\.biz\/[^"]+)"/i)?.[1];
    const title = clean(block.match(/<h[34][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    const price = block.match(/\$(\d+\.\d{2})/)?.[1];
    if (!link || !title || !price || seen.has(link)) continue;
    const classified = classifyHardware(title);
    if (!classified) continue;
    seen.add(link);
    offers.push({
      ...classified,
      title,
      vendor: "eRockets",
      vendorSlug: "erockets",
      url: link,
      status: /sold out|out of stock|unavailable/i.test(block) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price),
      stockCount: null,
    });
  }
  return offers;
}

function dedupeCards<T extends { url: string }>(cards: T[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.url)) return false;
    seen.add(card.url);
    return true;
  });
}

function clean(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUrl(url: string) {
  return url.replace(/&/g, "&");
}

function abs(href: string, base: string) {
  try {
    return new URL(href.replace(/&/g, "&"), base).href;
  } catch {
    return null;
  }
}
