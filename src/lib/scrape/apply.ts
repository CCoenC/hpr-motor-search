import { keyOf, type Catalog, type Cheapest, type Listing, type Motor, type ScrapeMeta, type VendorScrapeStatus } from "../motors.ts";
import { buildIndex, matchMotor, qjetDesignation, type MotorIndex } from "./match.ts";

export type OfferStatus = "in_stock" | "out_of_stock" | "special_order";

export type RawOffer = {
  title: string;
  url: string;
  status: OfferStatus;
  priceCents: number | null;
  packSize: number;
  stockCount: number | null;
  leadTime: string | null;
  designationHint?: string | null;
};

export type VendorPull = {
  slug: string;
  name: string;
  ok: boolean;
  note: string | null;
  offers: RawOffer[];
  checkedAt: string;
};

export type StoredOffer = {
  motorKey: string;
  vendor: string;
  vendorSlug: string;
  url: string;
  status: OfferStatus;
  priceCents: number | null;
  unitPriceCents: number | null;
  packSize: number;
  stockCount: number | null;
  leadTime: string | null;
};

const MIN_MATCH = 5;

export function offersFromPulls(motors: Motor[], pulls: VendorPull[]) {
  const index = buildIndex(motors);
  const stored: StoredOffer[] = [];
  const vendors: VendorScrapeStatus[] = pulls.map((pull) => {
    const matched = pull.ok ? matchPull(pull, index) : [];
    stored.push(...matched);
    const inStock = new Set(matched.filter((offer) => offer.status === "in_stock").map((offer) => offer.motorKey));
    const trusted = pull.ok && matched.length >= MIN_MATCH;
    return {
      slug: pull.slug,
      name: pull.name,
      ok: trusted,
      note: pull.ok && !trusted ? pull.note ?? `Only ${matched.length} matched, so this shop was left off.` : pull.note,
      seen: pull.offers.length,
      matched: matched.length,
      inStock: inStock.size,
      checkedAt: pull.checkedAt,
    };
  });
  return { stored, vendors };
}

export function applyStored(catalog: Catalog, stored: StoredOffer[], meta: ScrapeMeta): Catalog {
  const trusted = new Set(meta.vendors.filter((vendor) => vendor.ok).map((vendor) => vendor.slug));
  const byMotor = new Map<string, StoredOffer[]>();
  for (const offer of stored) {
    if (!trusted.has(offer.vendorSlug)) continue;
    const list = byMotor.get(offer.motorKey) ?? [];
    list.push(offer);
    byMotor.set(offer.motorKey, list);
  }
  const motors = catalog.motors.map((motor) => {
    const hits = byMotor.get(keyOf(motor));
    if (!hits?.length) return motor;
    const replaced = new Set(hits.map((offer) => offer.vendorSlug));
    const listings = motor.listings.filter((listing) => !replaced.has(listing.vendor_slug));
    return recompute({ ...motor, listings: [...listings, ...hits.map(toListing)] });
  });
  const known = new Set(motors.map((motor) => keyOf(motor)));
  const extras = [...byMotor.entries()]
    .filter(([motorKey]) => motorKey.startsWith("Quest|") && !known.has(motorKey))
    .map(([motorKey, hits]) => qjetMotor(motorKey, hits));
  return { ...catalog, motors: [...motors, ...extras], scrape: meta };
}

function matchPull(pull: VendorPull, index: MotorIndex) {
  const grouped = new Map<string, StoredOffer[]>();
  for (const offer of pull.offers) {
    const motor = matchMotor(offer.title, index, offer.designationHint);
    const qjet = motor ? null : qjetDesignation(offer.title);
    if ((!motor && !qjet) || offer.priceCents == null) continue;
    const pack = offer.packSize > 0 ? offer.packSize : 1;
    const stored: StoredOffer = {
      motorKey: motor ? keyOf(motor) : `Quest|${qjet!.designation}`,
      vendor: pull.name,
      vendorSlug: pull.slug,
      url: offer.url,
      status: offer.status,
      priceCents: offer.priceCents,
      unitPriceCents: Math.round(offer.priceCents / pack),
      packSize: pack,
      stockCount: offer.stockCount,
      leadTime: offer.leadTime,
    };
    const list = grouped.get(stored.motorKey) ?? [];
    list.push(stored);
    grouped.set(stored.motorKey, list);
  }
  return [...grouped.values()].map(collapseOne);
}

function productKey(offer: StoredOffer) {
  try {
    const id = new URL(offer.url).searchParams.get("virtuemart_product_id");
    if (id) return `vm:${id}`;
  } catch {
    // A relative or junk URL is keyed by the string below.
  }
  return `url:${offer.url.split("#")[0]}`;
}

function collapseOne(offers: StoredOffer[]): StoredOffer {
  const seen = new Set<string>();
  const unique = offers.filter((offer) => {
    const key = productKey(offer);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const inStock = unique.filter((offer) => offer.status === "in_stock");
  const special = unique.filter((offer) => offer.status === "special_order");
  const pool = inStock.length ? inStock : special.length ? special : unique;
  const best = pool.reduce((left, right) => ((left.unitPriceCents ?? 1e12) <= (right.unitPriceCents ?? 1e12) ? left : right));
  const counted = inStock.filter((offer) => offer.stockCount != null);
  const stock = counted.reduce((sum, offer) => sum + (offer.stockCount ?? 0), 0);
  return {
    ...best,
    status: inStock.length ? "in_stock" : special.length ? "special_order" : "out_of_stock",
    stockCount: inStock.length && counted.length ? stock : null,
  };
}

function qjetMotor(motorKey: string, hits: StoredOffer[]): Motor {
  const designation = motorKey.slice("Quest|".length);
  const head = designation.split("-")[0] ?? designation;
  const motor: Motor = {
    id: qjetId(designation),
    manufacturer: "Quest",
    designation,
    common_name: head,
    impulse_class: designation[0] ?? "A",
    diameter_mm: 18,
    total_impulse_ns: null,
    avg_thrust_n: null,
    burn_time_s: null,
    propellant: head.endsWith("W") ? "White Lightning" : null,
    sparky: false,
    motor_type: "SU",
    case_info: "Quest Q-Jet",
    hazmat: "none",
    delays: designation.split("-")[1] ?? null,
    delay_adjustable: false,
    discontinued: false,
    in_stock: false,
    vendor_count: 0,
    in_stock_vendor_count: 0,
    listings: hits.map(toListing),
    cheapest_in_stock: null,
  };
  return recompute(motor);
}

function qjetId(designation: string) {
  let hash = 0;
  for (const char of designation) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return 8_000_000 + (hash % 100_000);
}

function toListing(offer: StoredOffer): Listing {
  return {
    vendor: offer.vendor,
    vendor_slug: offer.vendorSlug,
    url: offer.url,
    status: offer.status,
    price_cents: offer.priceCents,
    unit_price_cents: offer.unitPriceCents,
    currency: "USD",
    pack_size: offer.packSize,
    stock_count: offer.stockCount,
    lead_time: offer.leadTime,
    last_seen: new Date().toISOString(),
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
