import type { RawOffer, VendorPull } from "./apply.ts";
import { fetchText, isChallenge, mapPool } from "./http.ts";
import { centsFromDollars, packSizeOf } from "./match.ts";

const NAV_GROUPS = new Set(["21402114301241", "312201212580820", "21402114305831", "21402114255540", "21402114310527"]);

export async function scrapeBalsa(checkedAt: string): Promise<VendorPull> {
  const slug = "balsa_machining";
  const name = "Balsa Machining Service";
  try {
    const response = await fetchText("https://www.balsamachining.com/hpmp.htm", 20000);
    if (!response.ok || isChallenge(response.text)) return failed(slug, name, checkedAt, "Balsa page did not load.");
    const offers = balsaOffers(response.text);
    return { slug, name, ok: offers.length > 0, note: offers.length ? null : "No motor rows on the Balsa page.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Balsa fetch failed.");
  }
}

export function balsaOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const row of html.split(/<tr/i)) {
    const curve = row.match(/thrustcurve\.org\/motors\/[^/"']+\/([^"'\s>]+)/i);
    if (!curve) continue;
    const price = row.match(/\$(\d+\.\d{2})/);
    if (!price) continue;
    const stock = row.match(/(\d+)\s+available/i);
    const count = stock ? Number(stock[1]) : 0;
    const designation = decode(curve[1]);
    offers.push({
      title: designation,
      designationHint: designation.replace(/-(\d{1,2})A$/i, ""),
      url: "https://www.balsamachining.com/hpmp.htm",
      status: count > 0 ? "in_stock" : "out_of_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: packSizeOf(row),
      stockCount: count > 0 ? count : null,
      leadTime: null,
    });
  }
  return offers;
}

export async function scrapePerformance(checkedAt: string): Promise<VendorPull> {
  const slug = "performancehobbies";
  const name = "Performance Hobbies";
  try {
    const offers = await walkPerformance();
    return { slug, name, ok: offers.length > 0, note: offers.length ? null : "No motor rows in the Performance Hobbies tree.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Performance Hobbies fetch failed.");
  }
}

export function performanceOffers(html: string, groupId: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const row of html.split(/<tr/i)) {
    const name = row.match(/<a name='([^']+)'/i)?.[1]?.trim();
    if (!name || !/[A-O]\d{1,4}/i.test(name)) continue;
    if (/starter|igniter|hardware|closure|seal|nozzle|bulkhead|o-?ring|casing/i.test(name)) continue;
    const price = row.match(/\$(\d+\.\d{2})/);
    if (!price) continue;
    offers.push({
      title: name,
      url: `https://performancehobbies.com/secure/store.aspx?groupid=${groupId}#${encodeURIComponent(name)}`,
      status: /out of stock/i.test(row) ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: packSizeOf(name),
      stockCount: null,
      leadTime: null,
    });
  }
  return offers;
}

async function walkPerformance() {
  const queue = ["21402114301241"];
  const seen = new Set<string>();
  const offers: RawOffer[] = [];
  while (queue.length && seen.size < 50) {
    const groupId = queue.shift();
    if (!groupId || seen.has(groupId)) continue;
    seen.add(groupId);
    const response = await fetchText(`https://performancehobbies.com/secure/store.aspx?groupid=${groupId}`, 15000);
    if (!response.ok || isChallenge(response.text)) continue;
    offers.push(...performanceOffers(response.text, groupId));
    for (const link of response.text.matchAll(/<a[^>]+href="([^"]*groupid=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (/addtocart/i.test(link[1])) continue;
      const id = link[2];
      if (NAV_GROUPS.has(id) || seen.has(id)) continue;
      const label = link[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/estes|hybrid|micromaxx|ellis|gift|contrail|rattworks|starter|electric match|magazine/i.test(label)) continue;
      if (/hardware/i.test(label) && !/motor/i.test(label)) continue;
      queue.push(id);
    }
  }
  return offers;
}

export async function scrapeChris(checkedAt: string): Promise<VendorPull> {
  const slug = "csrocketry";
  const name = "Chris' Rocket Supplies";
  try {
    const offers = await crawlChris();
    return { slug, name, ok: offers.length > 0, note: offers.length ? null : "Chris' product pages did not parse.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Chris' fetch failed.");
  }
}

export function chrisOffer(html: string, url: string): RawOffer | null {
  if (!/product-stock-status|"@type"\s*:\s*"Product"/i.test(html)) return null;
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      try {
        return JSON.parse(match[1]) as { "@type"?: string; name?: string; offers?: { price?: string | number; availability?: string } };
      } catch {
        return null;
      }
    })
    .find((item) => item?.["@type"] === "Product");
  const name = title || ld?.name || "";
  if (!name || !/[A-O]\d{1,4}/i.test(name)) return null;
  const price = centsFromDollars(ld?.offers?.price ?? "");
  const stock = html.match(/Stock Level:\s*(\d+)/i);
  const count = stock ? Number(stock[1]) : null;
  const availability = ld?.offers?.availability ?? "";
  const inStock = count != null ? count > 0 : /InStock/i.test(availability);
  return {
    title: name,
    url,
    status: inStock ? "in_stock" : "out_of_stock",
    priceCents: price,
    packSize: packSizeOf(name),
    stockCount: count != null && count > 0 ? count : null,
    leadTime: null,
  };
}

async function crawlChris() {
  const seeds = [
    "https://www.csrocketry.com/rocket-motors/aerotech-rocketry/motors.html",
    "https://www.csrocketry.com/rocket-motors/cesaroni.html",
    "https://www.csrocketry.com/rocket-motors/quest.html",
  ];
  const queue = [...seeds];
  const seen = new Set<string>();
  const offers: RawOffer[] = [];
  const deadline = Date.now() + 40000;
  while (queue.length && seen.size < 80 && Date.now() < deadline) {
    const batch = queue.splice(0, 6).filter((url) => !seen.has(url));
    for (const url of batch) seen.add(url);
    const pages = await mapPool(batch, 6, async (url) => {
      try {
        const response = await fetchText(url, 12000);
        return response.ok ? response : null;
      } catch {
        return null;
      }
    });
    for (const response of pages) {
      if (!response) continue;
      if (/category-product-price/i.test(response.text)) offers.push(...chrisCategoryOffers(response.text));
      for (const match of response.text.matchAll(/href="([^"]+)"/gi)) {
        const absolute = absUrl(match[1], response.url);
        if (!absolute || seen.has(absolute) || queue.includes(absolute)) continue;
        if (!absolute.includes("/rocket-motors/")) continue;
        if (/igniter|grease|brush|hardware|estes|cleaning|building/i.test(absolute)) continue;
        if (!absolute.endsWith(".html")) continue;
        queue.push(absolute);
      }
    }
  }
  return offers;
}

export function chrisCategoryOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const chunk of html.split(/category-product-info/i).slice(1)) {
    const title = chunk.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const href = chunk.match(/href="(https:\/\/www\.csrocketry\.com\/[^"]+\.html)"/i)?.[1];
    const price = chunk.match(/category-product-price">\s*\$(\d+\.\d{2})/i);
    if (!title || !href || !price || !/[A-O]\d{1,4}/i.test(title)) continue;
    const stock = chunk.match(/Stock Level:\s*(\d+)/i);
    const count = stock ? Number(stock[1]) : null;
    const sold = /out of stock/i.test(chunk) || count === 0;
    const pack = chunk.match(/(\d+)\s+rocket motor reloads/i);
    offers.push({
      title,
      url: href,
      status: sold ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: pack ? Number(pack[1]) : packSizeOf(title),
      stockCount: count != null && count > 0 ? count : null,
      leadTime: null,
    });
  }
  return offers;
}

const LOKI_RELOADS = "https://lokiresearch.com/secure/store.asp?groupid=831200410431019";

export async function scrapeLoki(checkedAt: string): Promise<VendorPull> {
  const slug = "loki";
  const name = "Loki Research";
  try {
    const response = await fetchText(LOKI_RELOADS, 20000);
    if (!response.ok || isChallenge(response.text)) return failed(slug, name, checkedAt, "Loki reload page did not load.");
    const offers = lokiGroupOffers(response.text);
    return {
      slug,
      name,
      ok: offers.length > 0,
      note: offers.length ? "Manufacturer direct. In-stock orders may still take 4–8 weeks." : "No reload rows on the Loki page.",
      offers,
      checkedAt,
    };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Loki fetch failed.");
  }
}

export function lokiGroupOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const row of html.split(/<tr/i).slice(1)) {
    const id = row.match(/storeDetail\.asp\?id=(\d+)/i)?.[1];
    if (!id) continue;
    const rawName = row.match(/storeDetail\.asp\?id=\d+[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    const linkTitle = rawName.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const fonts = [...row.matchAll(/<font>([^<]+)<\/font>/gi)].map((match) => match[1].replace(/\s+/g, " ").trim());
    const code = fonts.find((text) => /^(?:HP-)?[A-O]-?\d/i.test(text)) ?? "";
    const propellant = fonts.find((text) => /spit|loki|white|blue|red|cocktail|ice|black/i.test(text)) ?? "";
    const title = `${code} ${propellant} ${linkTitle}`.replace(/\s+/g, " ").trim();
    const price = row.match(/\$(\d+\.\d{2})/);
    if (!title || !price) continue;
    const out = /out of stock/i.test(row);
    const madeToOrder = /made to order|6-8 weeks/i.test(title);
    offers.push({
      title,
      url: `https://lokiresearch.com/secure/storeDetail.asp?id=${id}`,
      status: out ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: packSizeOf(title),
      stockCount: null,
      leadTime: out ? null : madeToOrder ? "Made to order, 6–8 weeks" : "May ship in 4–8 weeks",
      designationHint: code || null,
    });
  }
  return offers;
}

export function lokiOffer(html: string, url: string): RawOffer | null {
  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const price = html.match(/<font>\$(\d+\.\d{2})<\/font>/i);
  if (!title || !price) return null;
  const inStock = /value="Add to cart"/i.test(html) && !/out of stock/i.test(html);
  return {
    title,
    url,
    status: inStock ? "in_stock" : "out_of_stock",
    priceCents: centsFromDollars(price[1]),
    packSize: packSizeOf(title),
    stockCount: null,
    leadTime: inStock ? "May ship in 4–8 weeks" : null,
  };
}

export async function scrapeErockets(checkedAt: string): Promise<VendorPull> {
  const slug = "erockets";
  const name = "eRockets";
  const pages = [
    "https://www.erockets.biz/aerotech-single-use-motors/",
    "https://www.erockets.biz/aerotech-reloadable-motors/",
    "https://www.erockets.biz/quest-model-rocket-motors/",
  ];
  try {
    const chunks = await mapPool(pages, 3, async (url) => {
      const offers: RawOffer[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= 6; page += 1) {
        const response = await fetchText(page === 1 ? url : `${url}?page=${page}`, 15000);
        if (!response.ok || isChallenge(response.text)) break;
        const batch = erocketsOffers(response.text).filter((offer) => !seen.has(offer.url));
        if (!batch.length) break;
        for (const offer of batch) seen.add(offer.url);
        offers.push(...batch);
      }
      return offers;
    });
    const offers = chunks.flat();
    return { slug, name, ok: offers.length > 0, note: offers.length ? "Mostly mid-power. Counts are not published." : "eRockets category pages did not parse.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "eRockets fetch failed.");
  }
}

export function erocketsOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<article[\s\S]*?<\/article>/gi)) {
    const block = match[0];
    const link = block.match(/href="(https:\/\/www\.erockets\.biz\/[^"]+)"/i);
    const title = block.match(/<h[34][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const price = block.match(/\$(\d+\.\d{2})/);
    if (!link || !title || !price || !/[A-O]\d{1,4}/i.test(title)) continue;
    if (seen.has(link[1])) continue;
    seen.add(link[1]);
    const sold = /sold out|out of stock|unavailable/i.test(block);
    offers.push({
      title,
      url: link[1],
      status: sold ? "out_of_stock" : "in_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: packSizeOf(title),
      stockCount: null,
      leadTime: null,
    });
  }
  return offers;
}

const SIRIUS_ROOTS = [
  "https://www.siriusrocketry.biz/ishop/hobby-rocket-motors-engines-hdw-36/",
  "https://www.siriusrocketry.biz/ishop/high-power-rocket-motors-hdw-57/",
];
const AMW_ROOTS = [
  "https://cart.amwprox.com/index.php?option=com_virtuemart&view=category&virtuemart_category_id=102&Itemid=533&limit=150",
  "https://cart.amwprox.com/index.php?option=com_virtuemart&view=category&virtuemart_category_id=2&Itemid=536&limit=150",
];
const MOTO_ROOTS = [
  "https://www.moto-joe.com/index.php?route=product/category&path=59_66&limit=100",
  "https://www.moto-joe.com/index.php?route=product/category&path=59_67&limit=100",
];

export async function scrapeSirius(checkedAt: string): Promise<VendorPull> {
  const slug = "sirius";
  const name = "Sirius Rocketry";
  try {
    const offers = await walkSirius();
    return { slug, name, ok: offers.length > 0, note: offers.length ? null : "Sirius pages came back without motor rows.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Sirius fetch failed.");
  }
}

export function siriusOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const row of html.split(/productListing-(?:odd|even)/i).slice(1)) {
    const title = row.match(/class="itemTitle"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!title) continue;
    const name = title[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/[A-O]\d{1,4}/i.test(name)) continue;
    const sale =
      row.match(/productSalePrice">\s*Sale:&nbsp;\$([0-9,.]+)/i) ||
      row.match(/productSpecialPrice">\s*\$([0-9,.]+)/i) ||
      row.match(/productBasePrice">\s*\$([0-9,.]+)/i);
    if (!sale) continue;
    const special = /special order/i.test(name);
    const sold = /sold out|button_sold_out/i.test(row);
    offers.push({
      title: name,
      url: title[1],
      status: sold ? "out_of_stock" : special ? "special_order" : "in_stock",
      priceCents: centsFromDollars(sale[1]),
      packSize: packSizeOf(name),
      stockCount: null,
      leadTime: special ? "Special order" : null,
    });
  }
  return offers;
}

export function siriusProduct(html: string, pageUrl: string): RawOffer | null {
  if (/productListing-(?:odd|even)/i.test(html)) return null;
  const name = html.match(/id="productName"[^>]*>\s*([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (!name || !/[A-O]\d{1,4}/i.test(name)) return null;
  const sale =
    html.match(/productSalePrice">\s*Sale:&nbsp;\$([0-9,.]+)/i) ||
    html.match(/productSpecialPrice">\s*\$([0-9,.]+)/i) ||
    html.match(/class="normalprice">\s*\$([0-9,.]+)/i);
  if (!sale) return null;
  const special = /special order/i.test(name);
  const sold = /button_sold_out|alt="Sold Out"/i.test(html);
  const canonical = html.match(/href="(https:\/\/www\.siriusrocketry\.biz\/ishop\/[^"]+-\d+\.html)"/i)?.[1] ?? pageUrl;
  return {
    title: name,
    url: canonical,
    status: sold ? "out_of_stock" : special ? "special_order" : "in_stock",
    priceCents: centsFromDollars(sale[1]),
    packSize: packSizeOf(name),
    stockCount: null,
    leadTime: special ? "Special order" : null,
  };
}

async function walkSirius() {
  const queue = [...SIRIUS_ROOTS];
  const seen = new Set<string>();
  const offers: RawOffer[] = [];
  const deadline = Date.now() + 70000;
  while (queue.length && seen.size < 90 && Date.now() < deadline) {
    const batch = queue.splice(0, 4).filter((url) => !seen.has(url));
    for (const url of batch) seen.add(url);
    const pages = await mapPool(batch, 4, async (url) => {
      try {
        const response = await fetchText(url, 15000);
        return { url, html: response.ok && !isChallenge(response.text) ? response.text : "" };
      } catch {
        return { url, html: "" };
      }
    });
    for (const page of pages) {
      if (!page.html) continue;
      const rows = siriusOffers(page.html);
      if (rows.length) offers.push(...rows);
      else {
        const one = siriusProduct(page.html, page.url);
        if (one) offers.push(one);
      }
      for (const link of page.html.matchAll(/<div class="categoryListBoxContents"[\s\S]*?<a href="([^"]+)"[\s\S]*?<br\s*\/?>\s*([^<]+)<\/a>/gi)) {
        const label = link[2].replace(/\s+/g, " ").trim();
        const href = link[1];
        if (seen.has(href) || queue.includes(href)) continue;
        if (/hardware|initiat|adapter|retainer|estes|delay kit|closure|seal|igniter/i.test(label)) continue;
        queue.push(href);
      }
    }
  }
  return offers;
}

export async function scrapeAmw(checkedAt: string): Promise<VendorPull> {
  const slug = "amw";
  const name = "Animal Motor Works";
  try {
    const offers = await walkAmw();
    return { slug, name, ok: offers.length > 0, note: offers.length ? "A count is shown only when the shelf quantity is posted." : "AMW pages came back without motor rows.", offers, checkedAt };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "AMW fetch failed.");
  }
}

export function amwOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const part of html.split('class="product floatleft').slice(1)) {
    const title = part.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/i);
    if (!title || /view=category/i.test(title[1])) continue;
    const name = title[2].replace(/\*/g, "").replace(/\s+/g, " ").trim();
    if (!/[A-O]\d{1,4}/i.test(name)) continue;
    const price = part.match(/PricesalesPrice"[^>]*>[\s\S]{0,160}?\$([0-9,.]+)/i);
    if (!price) continue;
    const count = Number(part.match(/(\d+)\s+In Stock/i)?.[1] ?? 0);
    offers.push({
      title: name,
      url: htmlUrl(title[1], "https://cart.amwprox.com").href,
      status: count > 0 ? "in_stock" : "out_of_stock",
      priceCents: centsFromDollars(price[1]),
      packSize: packSizeOf(name),
      stockCount: count > 0 ? count : null,
      leadTime: null,
    });
  }
  return offers;
}

async function walkAmw() {
  const queue = [...AMW_ROOTS];
  const seen = new Set<string>();
  const offers: RawOffer[] = [];
  const deadline = Date.now() + 80000;
  while (queue.length && seen.size < 100 && Date.now() < deadline) {
    const batch = queue.splice(0, 3).filter((url) => !seen.has(url));
    for (const url of batch) seen.add(url);
    const pages = await mapPool(batch, 3, async (url) => {
      try {
        const response = await fetchText(url, 15000);
        return response.ok && !isChallenge(response.text) ? response.text : "";
      } catch {
        return "";
      }
    });
    for (const html of pages) {
      if (!html) continue;
      offers.push(...amwOffers(html));
      for (const link of html.matchAll(/<h2>\s*<a[^>]*href="([^"]*view=category[^"]*)"[^>]*>\s*([^<]+)/gi)) {
        const label = link[2].trim();
        if (/retainer|electronic|recovery|\bkits?\b|research|yard|hardware|closure|igniter/i.test(label)) continue;
        const href = htmlUrl(link[1], "https://cart.amwprox.com");
        href.searchParams.set("limit", "150");
        const next = href.href;
        if (!seen.has(next) && !queue.includes(next)) queue.push(next);
      }
    }
  }
  return offers;
}

export async function scrapeMotoJoe(checkedAt: string): Promise<VendorPull> {
  const slug = "moto_joe";
  const name = "Moto-Joe Rocketry";
  try {
    const offers = await walkMotoJoe();
    const counted = offers.some((offer) => offer.stockCount != null);
    return {
      slug,
      name,
      ok: offers.length > 0,
      note: offers.length ? (counted ? "The availability line is the shelf count." : null) : "Moto-Joe pages came back without motors.",
      offers,
      checkedAt,
    };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Moto-Joe fetch failed.");
  }
}

export function motoCards(html: string) {
  const cards: Array<{ url: string; title: string }> = [];
  for (const block of html.split('class="product-thumb"').slice(1)) {
    const link = block.match(/href="([^"]*product_id=\d+[^"]*)"/i);
    const title = block.match(/<h4>\s*<a[^>]*>([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim();
    if (!link || !title) continue;
    const url = htmlUrl(link[1], "https://www.moto-joe.com");
    const id = url.searchParams.get("product_id");
    if (!id) continue;
    const clean = new URL("https://www.moto-joe.com/index.php?route=product/product");
    clean.searchParams.set("product_id", id);
    cards.push({ url: clean.href, title });
  }
  return cards;
}

export function motoOffer(html: string, url: string, fallbackTitle = ""): RawOffer | null {
  const heading = html.match(/<h1[^>]*>\s*([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim() || fallbackTitle;
  const blurb = html.match(/<div class="tab-content"[\s\S]{0,400}?<p>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "";
  const price = html.match(/<h2>\s*\$([0-9,.]+)/i);
  if (!heading || !price) return null;
  const availability = html.match(/Availability:\s*([^<]+)/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const count = /^(\d+)$/.exec(availability);
  const special = /pre-?order|special order|back-?order/i.test(availability);
  const inStock = count ? Number(count[1]) > 0 : /in stock/i.test(availability);
  return {
    title: `${heading} ${blurb}`.replace(/\s+/g, " ").trim(),
    url,
    status: inStock ? "in_stock" : special ? "special_order" : "out_of_stock",
    priceCents: centsFromDollars(price[1]),
    packSize: packSizeOf(`${heading} ${blurb}`),
    stockCount: count && Number(count[1]) > 0 ? Number(count[1]) : null,
    leadTime: special ? availability : null,
  };
}

async function walkMotoJoe() {
  const queue = [...MOTO_ROOTS];
  const seenPages = new Set<string>();
  const products = new Map<string, string>();
  const deadline = Date.now() + 110000;
  while (queue.length && seenPages.size < 12 && Date.now() < deadline) {
    const url = queue.shift();
    if (!url || seenPages.has(url)) continue;
    seenPages.add(url);
    let html = "";
    try {
      const response = await fetchText(url, 15000);
      if (response.ok && !isChallenge(response.text)) html = response.text;
    } catch {
      html = "";
    }
    if (!html) continue;
    const before = products.size;
    for (const card of motoCards(html)) products.set(card.url, card.title);
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    if (products.size > before && page < 20) {
      const next = new URL(url);
      next.searchParams.set("page", String(page + 1));
      queue.push(next.href);
    }
  }
  const rows = await mapPool([...products.entries()].slice(0, 600), 6, async ([url, title]) => {
    if (Date.now() > deadline) return null;
    try {
      const response = await fetchText(url, 12000);
      if (!response.ok || isChallenge(response.text)) return null;
      return motoOffer(response.text, url, title);
    } catch {
      return null;
    }
  });
  return rows.filter((row): row is RawOffer => row != null);
}

export async function scrapeBlocked(slug: string, name: string, url: string, checkedAt: string): Promise<VendorPull> {
  try {
    const response = await fetchText(url, 12000);
    if (!response.ok || isChallenge(response.text) || response.text.length < 20000) {
      return failed(slug, name, checkedAt, "Bot check blocked this shop.");
    }
    return failed(slug, name, checkedAt, "Page loaded, but this shop has no stable product feed yet.");
  } catch {
    return failed(slug, name, checkedAt, "Bot check blocked this shop.");
  }
}

const APOGEE_CHARTS = [
  "https://www.apogeerockets.com/Rocket_Motors/AeroTech_Motors",
  "https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Propellant_Kits",
  "https://www.apogeerockets.com/Rocket_Motors/Quest_Motors",
];

export async function scrapeApogee(checkedAt: string): Promise<VendorPull> {
  const slug = "apogee";
  const name = "Apogee Components";
  try {
    const pages = await mapPool(APOGEE_CHARTS, 2, async (url) => {
      try {
        const response = await fetchText(url, 25000);
        if (!response.ok || isChallenge(response.text)) return [];
        return apogeeOffers(response.text);
      } catch {
        return [];
      }
    });
    const offers = pages.flat();
    return {
      slug,
      name,
      ok: offers.length > 0,
      note: offers.length ? null : "No motor rows on the Apogee charts.",
      offers,
      checkedAt,
    };
  } catch (error) {
    return failed(slug, name, checkedAt, error instanceof Error ? error.message : "Apogee fetch failed.");
  }
}

export function apogeeOffers(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const chunk of html.split('<td nowrap="nowrap" data-text="').slice(1)) {
    const cut = chunk.indexOf('"');
    if (cut <= 0 || cut > 24) continue;
    const designation = chunk.slice(0, cut).trim();
    const href = chunk.match(/href="(https:\/\/www\.apogeerockets\.com\/[^"]+)"/i)?.[1];
    if (!href) continue;
    let url: URL;
    try {
      url = htmlUrl(href, "https://www.apogeerockets.com/");
    } catch {
      continue;
    }
    const price = chunk.match(/class="single_price">\$([0-9,.]+)/)?.[1];
    const slug = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const packNote = chunk.match(/<i>\s*(\d+)\s*pack/i)?.[1] ?? slug.match(/(\d+)\s*-?\s*(?:pk|pack)\b/i)?.[1];
    const packSize = Number(packNote ?? 1);
    const stockRaw = [...chunk.matchAll(/<td data-text='(\d+)'>/g)].at(-1)?.[1];
    const stockCount = stockRaw == null ? null : Number(stockRaw);
    const sold = /button_sold_out/i.test(chunk);
    const inStock = !sold && stockCount != null && stockCount > 0;
    const fields = [...chunk.matchAll(/<td[^>]*data-text="([^"]+)"/g)].map((match) => match[1].trim());
    const color = fields[2] && !/^\d+$/.test(fields[2]) ? fields[2] : "";
    const codeToken = [...slug.matchAll(/[A-O]\d{1,4}(?:\.\d)?(?:-\d{1,2}[A-Z]*)?/gi)].at(-1)?.[0] ?? "";
    const qjet = /q-?jet/i.test(slug) ? "Q-Jet" : "";
    const lead = /[A-Z]\d+[A-Z]/i.test(designation) ? designation : codeToken || designation;
    offers.push({
      title: `${lead} ${qjet} ${color} ${codeToken}`.replace(/\s+/g, " ").trim(),
      url: url.href,
      status: inStock ? "in_stock" : "out_of_stock",
      priceCents: price ? centsFromDollars(price) : null,
      packSize: packSize > 0 && packSize < 100 ? packSize : 1,
      stockCount: inStock ? stockCount : null,
      leadTime: null,
      designationHint: /[A-Z]\d+[A-Z]/i.test(designation) ? designation : null,
    });
  }
  return offers;
}

function htmlUrl(raw: string, base: string) {
  const encodedAmp = "&" + "amp;";
  const numericAmp = new RegExp("&#0*38;", "g");
  return new URL(raw.replaceAll(encodedAmp, "&").replace(numericAmp, "&").replace(/^http:/i, "https:"), base);
}

function failed(slug: string, name: string, checkedAt: string, note: string): VendorPull {
  return { slug, name, ok: false, note, offers: [], checkedAt };
}

function absUrl(href: string, base: string) {
  try {
    const url = new URL(href, base);
    if (url.hostname !== "www.csrocketry.com") return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function decode(value: string) {
  return value.replace(/&/g, "&").replace(/&nbsp;/g, " ").trim();
}
