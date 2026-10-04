import type { Catalog, Cheapest, Listing, Motor, MotormanNote } from "@/lib/motors";
import { classifyHardware, type HardwareOffer } from "./hardware.ts";

export const MOTORMAN_VENDOR = "Motorman";
export const MOTORMAN_SLUG = "motorman";

export const MOTORMAN_PAGES = [
  { maker: "aerotech" as const, url: "https://www.the-motorman.net/aerotech.html" },
  { maker: "cesaroni" as const, url: "https://www.the-motorman.net/cti--cesaroni.html" },
];

type Maker = "aerotech" | "cesaroni";

type Offer = {
  maker: Maker;
  url: string;
  priceCents: number;
  stock: number | null;
  packSize: number;
  diameterMm: number | null;
  motorType: "SU" | "reload" | null;
  propellant: string | null;
  delay: string | null;
  exact: string | null;
  code: string;
};

const CTI_PROPS: Array<[string, string]> = [
  ["white thunder", "White Thunder"],
  ["red lightning", "Red Lightning"],
  ["blue streak", "Blue Streak"],
  ["smoky sam", "Smoky Sam"],
  ["green 3", "Green3"],
  ["green3", "Green3"],
  ["c-star", "C-Star"],
  ["cstar", "C-Star"],
  ["skidmark", "Skidmark"],
  ["classic", "Classic"],
  ["white", "White"],
  ["pink", "Pink"],
  ["imax", "Imax"],
  ["mellow", "Mellow"],
  ["vmax", "Vmax"],
];

export function htmlToLines(html: string) {
  const region = html.match(/id="wsite-content"([\s\S]*?)(?:id="footer"|class="wsite-footer")/i);
  let chunk = region?.[1] ?? html;
  chunk = chunk.replace(/^[^<]*>/, "");
  chunk = chunk.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  chunk = chunk.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h1|h2|h3|li|tr)>/gi, "\n");
  chunk = chunk.replace(/<[^>]+>/g, "");
  chunk = decode(chunk).replace(/\u00a0/g, " ");
  return chunk
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !line.startsWith("<") && !line.includes('class="'));
}

export function listUpdatedLabel(lines: string[]) {
  for (const line of lines.slice(0, 12)) {
    const match = line.match(/Updated\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (!match) continue;
    const date = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return null;
}

export function applyMotorman(
  catalog: Catalog,
  pages: Array<{ maker: Maker; url: string; html: string }>,
  checkedAt: string,
): Catalog {
  const offers: Offer[] = [];
  const updated: string[] = [];
  for (const page of pages) {
    const lines = htmlToLines(page.html);
    const label = listUpdatedLabel(lines);
    if (label) updated.push(label);
    offers.push(...(page.maker === "aerotech" ? aerotechOffers(lines, page.url) : cesaroniOffers(lines, page.url)));
  }

  const atIndex = indexAerotech(catalog.motors);
  const ctiIndex = indexCesaroni(catalog.motors);
  const grouped = new Map<number, Offer[]>();

  for (const offer of offers) {
    const motor = offer.maker === "aerotech" ? matchAerotech(offer, atIndex) : matchCesaroni(offer, ctiIndex);
    if (!motor) continue;
    const list = grouped.get(motor.id) ?? [];
    list.push(offer);
    grouped.set(motor.id, list);
  }

  const motors = catalog.motors.map((motor) => {
    const hits = grouped.get(motor.id);
    const listings = motor.listings.filter((listing) => listing.vendor_slug !== MOTORMAN_SLUG);
    if (!hits?.length) return listings.length === motor.listings.length ? motor : recompute({ ...motor, listings });
    return recompute({ ...motor, listings: [...listings, toListing(hits, checkedAt)] });
  });

  const motorman: MotormanNote = {
    ok: true,
    checkedAt,
    listUpdated: [...new Set(updated)].join(" · ") || null,
    motorsInStock: [...grouped.values()].filter((hits) => hits.some((hit) => (hit.stock ?? 0) > 0)).length,
    shelfCount: [...grouped.values()]
      .flat()
      .reduce((sum, hit) => sum + (hit.stock ?? 0), 0),
  };

  return { ...catalog, motors, motorman };
}

function toListing(hits: Offer[], checkedAt: string): Listing {
  const inStock = hits.filter((hit) => (hit.stock ?? 0) > 0);
  const priced = (inStock.length ? inStock : hits).reduce((best, hit) => {
    const unit = hit.priceCents / hit.packSize;
    const bestUnit = best.priceCents / best.packSize;
    return unit < bestUnit ? hit : best;
  });
  const delays = [...new Set(inStock.map((hit) => hit.delay).filter((delay): delay is string => Boolean(delay)))];
  let lead = "Launch only — no mail order";
  if (priced.maker === "aerotech" && delays.length) lead += ` · delay ${delays.join(", ")}`;
  const stock = inStock.reduce((sum, hit) => sum + (hit.stock ?? 0), 0);
  return {
    vendor: MOTORMAN_VENDOR,
    vendor_slug: MOTORMAN_SLUG,
    url: priced.url,
    status: stock > 0 ? "in_stock" : "out_of_stock",
    price_cents: priced.priceCents,
    unit_price_cents: Math.round(priced.priceCents / priced.packSize),
    currency: "USD",
    pack_size: priced.packSize,
    stock_count: stock > 0 ? stock : null,
    lead_time: lead,
    last_seen: checkedAt,
  };
}

function recompute(motor: Motor): Motor {
  const inStock = motor.listings.filter((listing) => listing.status === "in_stock");
  let cheapest: Cheapest | null = null;
  for (const listing of inStock) {
    if (listing.unit_price_cents == null || listing.price_cents == null) continue;
    if (!cheapest || listing.unit_price_cents < cheapest.unit_price_cents) {
      cheapest = {
        price_cents: listing.price_cents,
        unit_price_cents: listing.unit_price_cents,
        currency: listing.currency,
        vendor: listing.vendor,
        vendor_slug: listing.vendor_slug,
        url: listing.url,
        pack_size: listing.pack_size,
      };
    }
  }
  return {
    ...motor,
    in_stock: inStock.length > 0,
    vendor_count: new Set(motor.listings.map((listing) => listing.vendor)).size,
    in_stock_vendor_count: new Set(inStock.map((listing) => listing.vendor)).size,
    cheapest_in_stock: cheapest,
  };
}

function aerotechOffers(lines: string[], url: string) {
  const offers: Offer[] = [];
  let packSize = 1;
  let motorType: "SU" | "reload" | null = null;
  let hardware = false;
  for (const line of lines) {
    if (!line.includes("$")) {
      const heading = line.toLowerCase();
      if (/hardware|initiator|firstfire|closure|seal disk|spacer|adapter|retaining|o-ring|liner/.test(heading)) {
        hardware = true;
        continue;
      }
      hardware = false;
      packSize = /2\s*pack/.test(heading) ? 2 : 1;
      if (/rms|hobby case|reloads?/.test(heading)) motorType = "reload";
      else if (/q-jet|econojet|single use|dms|enerjet/.test(heading)) motorType = "SU";
      continue;
    }
    if (hardware) continue;
    if (/casing|closure|seal disk|spacer|adapter|initiator|firstfire|retaining|nozzle|forward |aft /.test(line)) continue;
    const price = priceAndStock(line);
    const parsed = atCode(line.split(/\s+/)[0] ?? "");
    if (!price || !parsed) continue;
    offers.push({
      maker: "aerotech",
      url,
      priceCents: price.priceCents,
      stock: price.stock,
      packSize,
      diameterMm: diameterOf(line),
      motorType,
      propellant: null,
      delay: parsed.delay,
      exact: null,
      code: parsed.code,
    });
  }
  return offers;
}

function cesaroniOffers(lines: string[], url: string) {
  const offers: Offer[] = [];
  let propellant: string | null = null;
  let diameterMm: number | null = null;
  for (const line of lines) {
    if (!line.includes("$")) {
      const prop = ctiProp(line);
      if (prop) propellant = prop;
      const diameter = line.match(/pro\s*(\d{2})/i);
      if (diameter) diameterMm = Number(diameter[1]);
      continue;
    }
    if (/casing|closure|spacer|starter|dat ring|dat centering|complete motor|\bcase\b|forward|nozzle|retaining/i.test(line)) {
      continue;
    }
    const price = priceAndStock(line);
    const parsed = ctiCode(line);
    if (!price || !parsed) continue;
    offers.push({
      maker: "cesaroni",
      url,
      priceCents: price.priceCents,
      stock: price.stock,
      packSize: 1,
      diameterMm,
      motorType: "reload",
      propellant,
      delay: null,
      exact: parsed.exact,
      code: parsed.tail,
    });
  }
  return offers;
}

function atCode(token: string) {
  const cleaned = token.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const split = cleaned.match(/^([A-O]\d+(?:\.\d+)?)([A-Z]*)-(PS|P|\d+A|\d+)([A-Z]*)$/);
  if (split) {
    const prop = split[2] || split[4];
    if (!prop) return null;
    return { code: split[1] + prop, delay: humanDelay(split[3]) };
  }
  const bare = cleaned.match(/^([A-O]\d+(?:\.\d+)?)([A-Z]{1,4})$/);
  if (!bare) return null;
  return { code: bare[1] + bare[2], delay: null };
}

function humanDelay(delay: string) {
  if (delay === "P" || delay === "PS") return delay === "PS" ? "plugged sustain" : "plugged";
  if (/^\d+A$/.test(delay)) return delay.slice(0, -1);
  return delay;
}

function ctiCode(line: string) {
  const withImpulse = line.match(/(?:HP\s*)?(\d{2,5})\s*-?\s*([A-O])\s*(\d{1,4})\s*-\s*(PS|P|\d+A|\d+)(?![0-9A-Z])/i);
  if (withImpulse) {
    const cls = withImpulse[2].toUpperCase();
    const delay = withImpulse[4].toUpperCase();
    return {
      exact: `${withImpulse[1]}${cls}${withImpulse[3]}-${delay}`,
      tail: `${cls}${withImpulse[3]}-${delay}`,
    };
  }
  const bare = line.match(/\b([A-O])(\d{2,4})-(PS|P|\d+A|\d+)\b/i);
  if (!bare) return null;
  const cls = bare[1].toUpperCase();
  const delay = bare[3].toUpperCase();
  return { exact: null, tail: `${cls}${bare[2]}-${delay}` };
}

function ctiProp(line: string) {
  const cleaned = line
    .toLowerCase()
    .replace(/:.*/, "")
    .replace(/\s*-\s*longburn.*/, "")
    .trim();
  for (const [key, name] of CTI_PROPS) {
    if (cleaned === key || cleaned.startsWith(`${key} `)) return name;
  }
  return null;
}

function priceAndStock(line: string) {
  const price = line.match(/\$\s*(\d+)\s*\.\s*(\d{2})/);
  if (!price) return null;
  const stock = line.match(/\(\s*(\d+)\s*\)\s*$/);
  return {
    priceCents: Number(price[1]) * 100 + Number(price[2]),
    stock: stock ? Number(stock[1]) : null,
  };
}

function diameterOf(line: string) {
  const match = line.match(/\b(\d{2})\s*mm\b/i);
  return match ? Number(match[1]) : null;
}

let pageCache: { at: number; pages: Array<{ maker: Maker; url: string; html: string }> } | null = null;

export async function fetchMotormanPages() {
  if (pageCache && Date.now() - pageCache.at < 10 * 60 * 1000) return pageCache.pages;
  const pages = (
    await Promise.all(
      MOTORMAN_PAGES.map(async (page) => {
        try {
          const response = await fetch(page.url, {
            headers: {
              Accept: "text/html",
              "User-Agent": "Mozilla/5.0 (compatible; HPRMotorSearch/1.0; +https://github.com/CCoenC/hpr-motor-search)",
            },
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) return null;
          const html = await response.text();
          if (html.length < 500) return null;
          return { maker: page.maker, url: page.url, html };
        } catch {
          return null;
        }
      }),
    )
  ).filter((page): page is { maker: Maker; url: string; html: string } => page != null);
  pageCache = { at: Date.now(), pages };
  return pages;
}

export function motormanHardware(lines: string[], maker: Maker, url: string): HardwareOffer[] {
  const hint = maker === "cesaroni" ? "Cesaroni Technology" : "AeroTech";
  const offers: HardwareOffer[] = [];
  let proMm: number | null = null;
  for (const line of lines) {
    if (!line.includes("$")) {
      const heading = line.match(/\bpro\s*(\d{2})\b/i);
      if (heading) proMm = Number(heading[1]);
      continue;
    }
    if (/reload/i.test(line) && !/adapter|spacer/i.test(line)) continue;
    if (/starter|prodat|\bdat\b|nozzle|initiator|firstfire|o-ring|liner|retaining/i.test(line)) continue;
    if (/^[A-O]\d/i.test(line.trim())) continue;
    const price = priceAndStock(line);
    if (!price) continue;
    const plain = bareHardware(line);
    const classified = classifyHardware(hardwareTitle(plain, maker, proMm), hint);
    if (!classified) continue;
    offers.push({
      ...classified,
      title: plain,
      vendor: MOTORMAN_VENDOR,
      vendorSlug: MOTORMAN_SLUG,
      url,
      status: price.stock != null && price.stock > 0 ? "in_stock" : "out_of_stock",
      priceCents: price.priceCents,
      stockCount: price.stock != null && price.stock > 0 ? price.stock : null,
    });
  }
  return offers;
}

function bareHardware(line: string) {
  return line.replace(/\$\s*\d+\s*\.\s*\d{2}/, "").replace(/\(\s*\d+\s*\)\s*$/, "").replace(/\s+/g, " ").trim();
}

function hardwareTitle(title: string, maker: Maker, proMm: number | null) {
  let text = title.replace(/\bSS\b/g, "stainless");
  text = text.replace(/\bP(\d{2})-(\d)G(XL)?\b/gi, (_, mm: string, grain: string, xl?: string) => `Pro${mm}-${grain}G${xl ?? ""}`);
  const spaced = text.match(/\bpro\s*(\d{2})\b/i);
  const grain = text.match(/(\d)\s*grain/i);
  if (spaced && grain && !/Pro\d{2}-\dG/i.test(text)) {
    text = text.replace(/\bpro\s*\d{2}/i, `Pro${spaced[1]}-${grain[1]}G`);
  } else if (proMm && grain && /casing|case|motor/i.test(text) && !/Pro\d{2}-\dG/i.test(text)) {
    text = `Pro${proMm}-${grain[1]}G ${text}`;
  } else if (proMm && /closure|spacer|adapter/i.test(text) && !/\bpro\s*\d|\bpro\d/i.test(text)) {
    text = `Pro${proMm} ${text}`;
  }
  const fit = text.match(/(\d{2,3})\s*mm\b[\s\S]{0,40}\b(\d{3,4})\s+case\b/i);
  if (fit) text = text.replace(/\b(\d{3,4})\s+case\b/i, `${fit[1]}/${fit[2]} case`);
  if (maker === "aerotech" && !/aerotech/i.test(text)) text = `AeroTech ${text}`;
  if (maker === "cesaroni" && !/cesaroni|\bpro\s*\d|\bpro\d/i.test(text)) text = `Cesaroni ${text}`;
  return text.replace(/\s+/g, " ").trim();
}

function indexAerotech(motors: Motor[]) {
  const map = new Map<string, Motor[]>();
  for (const motor of motors) {
    if (!motor.manufacturer.startsWith("Aero")) continue;
    for (const key of atIndexKeys(motor.designation)) push(map, key, motor);
  }
  return map;
}

function atIndexKeys(designation: string) {
  const raw = designation.toUpperCase().replace(/^HP-/, "");
  const keys = new Set<string>([raw]);
  let base = raw.replace(/\/.*$/, "").replace(/_DMS$/, "");
  base = base.replace(/-(?:\d+A|\d+|PS|P)$/, "");
  keys.add(base);
  keys.add(base.replace(/[^A-Z0-9.]/g, ""));
  return [...keys].filter(Boolean);
}

function indexCesaroni(motors: Motor[]) {
  const exact = new Map<string, Motor[]>();
  const tail = new Map<string, Motor[]>();
  for (const motor of motors) {
    if (!motor.manufacturer.includes("Cesaroni")) continue;
    const designation = motor.designation.toUpperCase();
    push(exact, designation, motor);
    push(exact, designation.replace(/-/g, ""), motor);
    const match = designation.match(/([A-O]\d+)-(P|\d+A|\d+)$/);
    if (!match) continue;
    push(tail, `${match[1]}-${match[2]}`, motor);
    if (/^\d+A$/.test(match[2])) push(tail, `${match[1]}-${match[2].slice(0, -1)}`, motor);
    if (/^\d+$/.test(match[2])) push(tail, `${match[1]}-${match[2]}A`, motor);
  }
  return { exact, tail };
}

function matchAerotech(offer: Offer, index: Map<string, Motor[]>) {
  return narrow(index.get(offer.code) ?? [], offer.diameterMm, offer.motorType, null);
}

function matchCesaroni(offer: Offer, index: ReturnType<typeof indexCesaroni>) {
  const exactKeys = offer.exact ? [offer.exact, offer.exact.replace(/-/g, "")] : [];
  if (offer.exact && /^\d+$/.test(offer.exact.split("-").at(-1) ?? "")) {
    exactKeys.push(`${offer.exact}A`);
  }
  for (const key of exactKeys) {
    const hit = narrow(index.exact.get(key) ?? [], offer.diameterMm, null, offer.propellant);
    if (hit) return hit;
  }
  const tails = [offer.code];
  if (/-\d+$/.test(offer.code)) tails.push(`${offer.code}A`);
  const candidates = tails.flatMap((tail) => index.tail.get(tail) ?? []);
  return narrow(candidates, offer.diameterMm, null, offer.propellant);
}

function narrow(candidates: Motor[], diameter: number | null, motorType: "SU" | "reload" | null, propellant: string | null) {
  let list = uniqueMotors(candidates);
  if (diameter) {
    const filtered = list.filter((motor) => motor.diameter_mm === diameter);
    if (filtered.length) list = filtered;
  }
  if (motorType) {
    const filtered = list.filter((motor) => motor.motor_type === motorType);
    if (filtered.length) list = filtered;
  }
  if (propellant) {
    const wanted = propellant.toLowerCase();
    const filtered = list.filter((motor) => (motor.propellant ?? "").toLowerCase() === wanted);
    if (filtered.length) list = filtered;
  }
  const live = list.filter((motor) => !motor.discontinued);
  if (live.length) list = live;
  return list.length === 1 ? list[0] : null;
}

function uniqueMotors(motors: Motor[]) {
  const seen = new Set<number>();
  const unique: Motor[] = [];
  for (const motor of motors) {
    if (seen.has(motor.id)) continue;
    seen.add(motor.id);
    unique.push(motor);
  }
  return unique;
}

function push(map: Map<string, Motor[]>, key: string, motor: Motor) {
  const list = map.get(key);
  if (list) list.push(motor);
  else map.set(key, [motor]);
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#39;|'/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">");
}
