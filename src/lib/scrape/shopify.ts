import type { RawOffer, VendorPull } from "./apply.ts";
import { fetchText, mapPool } from "./http.ts";
import { centsFromDollars, packSizeOf } from "./match.ts";
import { classifyHardware, type HardwareOffer } from "../hardware.ts";

type ShopifyVariant = { available?: boolean; price?: string; title?: string; inventory_quantity?: number; inventory_management?: string | null };
type ShopifyProduct = {
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[];
  variants?: ShopifyVariant[];
};

const HARDWARE = /hardware|casing|case only|closure|seal disc|seal disk|retainer|igniter|starter|firstfire|clothing|shirt|delay tool|spacer|liner|o-?ring|nozzle|bulkhead|grease|brush|forward closure|aft closure/;

export async function scrapeShopify(input: {
  slug: string;
  name: string;
  origin: string;
  checkedAt: string;
  specialOrder?: (title: string, banner: string) => string | null;
  quantities?: Map<string, number>;
}): Promise<{ pull: VendorPull; hardware: HardwareOffer[] }> {
  try {
    const products = await allProducts(input.origin);
    const banner = input.specialOrder ? await bannerText(input.origin) : "";
    const offers: RawOffer[] = [];
    const hardware: HardwareOffer[] = [];
    for (const product of products) {
      const title = product.title?.trim() ?? "";
      const handle = product.handle?.trim();
      if (!title || !handle) continue;
      const variants = product.variants ?? [];
      const available = variants.some((variant) => variant.available);
      const priced = (available ? variants.filter((variant) => variant.available) : variants)
        .map((variant) => centsFromDollars(variant.price ?? ""))
        .filter((cents): cents is number => cents != null);
      if (!priced.length) continue;
      const qty = input.quantities?.get(handle);
      const url = `${input.origin}/products/${handle}`;
      const classified = classifyHardware(title);
      if (classified) {
        let status: HardwareOffer["status"] = available ? "in_stock" : "out_of_stock";
        if (qty === 0) status = "out_of_stock";
        hardware.push({
          ...classified,
          title,
          vendor: input.name,
          vendorSlug: input.slug,
          url,
          status,
          priceCents: Math.min(...priced),
          stockCount: qty != null && qty > 0 ? qty : null,
        });
        continue;
      }
      if (!isMotorProduct(title, product.product_type ?? "", product.tags ?? [])) continue;
      const lead = input.specialOrder?.(title, banner) ?? null;
      let status: RawOffer["status"] = available ? "in_stock" : "out_of_stock";
      if (lead) status = available ? "special_order" : "out_of_stock";
      if (qty === 0) status = "out_of_stock";
      offers.push({
        title,
        url,
        status,
        priceCents: Math.min(...priced),
        packSize: packSizeOf(title),
        stockCount: qty != null && qty > 0 ? qty : null,
        leadTime: lead,
      });
    }
    return {
      pull: { slug: input.slug, name: input.name, ok: offers.length > 0, note: offers.length ? null : "No motor products in the Shopify feed.", offers, checkedAt: input.checkedAt },
      hardware,
    };
  } catch (error) {
    return {
      pull: { slug: input.slug, name: input.name, ok: false, note: error instanceof Error ? error.message : "Shopify fetch failed.", offers: [], checkedAt: input.checkedAt },
      hardware: [],
    };
  }
}

export async function wildmanQuantities() {
  const quantities = new Map<string, number>();
  const collections = await motorCollections("https://wildmanrocketry.com");
  await mapPool(collections.slice(0, 24), 4, async (handle) => {
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetchText(`https://wildmanrocketry.com/collections/${handle}?page=${page}`, 15000);
      if (!response.ok || isTiny(response.text)) break;
      const products = collectionProducts(response.text);
      if (!products.length) break;
      for (const product of products) addQuantity(quantities, product);
      if (products.length < 12) break;
    }
  });
  return quantities;
}

export function aerotechLead(title: string, banner: string) {
  const single = /single-use rocket motors:\s*up to ([^.]+)/i.exec(banner)?.[1];
  const reload = /rms reloads and .{0,40}dms motors:\s*up to ([^.]+)/i.exec(banner)?.[1];
  const singleLead = single ? `Up to ${single.trim()}` : "Up to 16 to 20 weeks";
  const reloadLead = reload ? `Up to ${reload.trim()}` : "Up to 40 to 44 weeks";
  const classMatch = title.toUpperCase().match(/\b([A-O])\d/);
  const letter = classMatch?.[1] ?? "H";
  const singleUse = /single[ -]?use|q-?jet|enerjet/i.test(title) && !/reload|\brms\b|\bdms\b/i.test(title);
  if (singleUse && letter <= "G") return singleLead;
  return reloadLead;
}

export function isMotorProduct(title: string, productType: string, tags: string[]) {
  const blob = `${title} ${productType} ${tags.join(" ")}`;
  if (!/[A-O]\d{1,4}/i.test(title)) return false;
  if (HARDWARE.test(blob) && !/reload|single[ -]?use|q-?jet/i.test(title)) return false;
  return true;
}

async function allProducts(origin: string) {
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetchText(`${origin}/products.json?limit=250&page=${page}`, 20000);
    if (!response.ok || !response.text.trim().startsWith("{")) throw new Error(`Shopify ${response.status || "blocked"}`);
    const parsed = JSON.parse(response.text) as { products?: ShopifyProduct[] };
    const batch = parsed.products ?? [];
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

async function bannerText(origin: string) {
  const response = await fetchText(`${origin}/`, 15000);
  return response.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

async function motorCollections(origin: string) {
  const handles: string[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const response = await fetchText(`${origin}/collections.json?limit=250&page=${page}`, 15000);
    if (!response.ok || !response.text.trim().startsWith("{")) break;
    const parsed = JSON.parse(response.text) as { collections?: Array<{ handle: string; title: string; products_count: number }> };
    const batch = parsed.collections ?? [];
    for (const collection of batch) {
      const blob = `${collection.handle} ${collection.title}`.toLowerCase();
      if (collection.products_count < 1) continue;
      if (!/motor|aerotech|cesaroni|loki|q-jet|reload|grain/.test(blob)) continue;
      if (/closure|spacer|delay|lighter|ignit|clothing|retainer|electronic|kit/.test(blob) && !/motor/.test(blob)) continue;
      handles.push(collection.handle);
    }
    if (batch.length < 250) break;
  }
  return [...new Set(handles)];
}

function collectionProducts(html: string): ShopifyProduct[] {
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1].trim();
    if (!body.startsWith("{") || !body.includes("inventory_quantity")) continue;
    try {
      const parsed = JSON.parse(body) as { collection?: ShopifyProduct[] };
      if (Array.isArray(parsed.collection)) return parsed.collection;
    } catch {
      continue;
    }
  }
  return [];
}

function addQuantity(quantities: Map<string, number>, product: ShopifyProduct) {
  const handle = product.handle;
  if (!handle) return;
  const variants = product.variants ?? [];
  const tracked = variants.filter((variant) => variant.inventory_management && typeof variant.inventory_quantity === "number");
  if (!tracked.length) return;
  const qty = tracked.reduce((sum, variant) => sum + Math.max(0, variant.inventory_quantity ?? 0), 0);
  if (!quantities.has(handle)) quantities.set(handle, qty);
}

function isTiny(text: string) {
  return text.length < 1000;
}
