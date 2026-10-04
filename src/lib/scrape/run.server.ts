import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keyOf, parseCatalog, type Catalog, type Motor, type ScrapeMeta } from "../motors.ts";
import { applyStored, offersFromPulls, type StoredOffer, type VendorPull } from "./apply.ts";
import { SCRAPE_UA } from "./http.ts";
import { scrapeAmw, scrapeApogee, scrapeBalsa, scrapeChris, scrapeErockets, scrapeLoki, scrapeMotoJoe, scrapePerformance, scrapeSirius } from "./pages.ts";
import { aerotechLead, scrapeShopify, wildmanQuantities } from "./shopify.ts";
import { scrapeHardwareShops } from "./hardware.ts";
import type { HardwareOffer } from "../hardware.ts";

import { SCRAPE_INTERVAL_MINUTES } from "./schedule.ts";
import seedScrape from "../../../data/vendor-scrape.json";
import seedHardware from "../../../data/hardware.json";

const SPEC_MAX_AGE = 24 * 60 * 60 * 1000;
const TC_SEARCH = "https://www.thrustcurve.org/api/v1/search.json";
const TC_MAKERS = ["AeroTech", "Cesaroni", "Loki Research"] as const;

type Settings = { intervalMinutes: number | null };
type CacheFile = { ranAt: string; intervalMinutes: number | null; offers: StoredOffer[]; vendors: ScrapeMeta["vendors"] };

let runLock: Promise<ScrapeMeta> | null = null;
let memorySpecs: string | null = null;
let memoryScrape: string | null = null;
let memoryHardware: string | null = null;

function storeDir() {
  // The published function is read-only except for /tmp. /var/task/data cannot be created.
  return process.env.VERCEL ? "/tmp/hpr-data" : join(process.cwd(), "data");
}

function storePaths() {
  const dir = storeDir();
  return {
    dir,
    cache: join(dir, "vendor-scrape.json"),
    specs: join(dir, "motor-catalog.json"),
    hardware: join(dir, "hardware.json"),
  };
}

async function saveFile(file: string, body: string) {
  try {
    await mkdir(storeDir(), { recursive: true });
    await writeFile(file, body);
  } catch {
    // Keep the in-memory copy when the host disk is locked.
  }
}

async function writeDbBody(key: string, body: string) {
  if (!process.env.DATABASE_URL?.trim()) return;
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    await sql`
      insert into scrape_cache (key, body, updated_at)
      values (${key}, ${body}, now())
      on conflict (key) do update set body = excluded.body, updated_at = now()
    `;
  } catch {
    // The bundled scrape still serves stock if the database is not ready.
  }
}

async function readDbBody(key: string): Promise<string | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  try {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{ body: string }>`select body from scrape_cache where key = ${key}`;
    return typeof rows[0]?.body === "string" ? rows[0].body : null;
  } catch {
    return null;
  }
}

function asCache(value: unknown): CacheFile | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as CacheFile;
  if (typeof parsed.ranAt !== "string" || !Array.isArray(parsed.offers) || !parsed.offers.length) return null;
  return parsed;
}

function asHardware(value: unknown): { ranAt: string | null; offers: HardwareOffer[] } | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as { ranAt?: string; offers?: HardwareOffer[] };
  if (!Array.isArray(parsed.offers) || !parsed.offers.length) return null;
  return { ranAt: parsed.ranAt ?? null, offers: parsed.offers };
}

function newerCache(current: CacheFile | null, next: CacheFile | null) {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next.ranAt) > Date.parse(current.ranAt) ? next : current;
}

async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function getScrapeMeta(): Promise<ScrapeMeta & { due: boolean }> {
  const settings = await readSettings();
  const cache = await readCache();
  const meta: ScrapeMeta = {
    ranAt: cache?.ranAt ?? null,
    intervalMinutes: settings.intervalMinutes,
    vendors: cache?.vendors ?? [],
  };
  return { ...meta, due: isDue(meta) };
}

export function runVendorScrape() {
  if (!runLock) {
    runLock = scrapeAll().finally(() => {
      runLock = null;
    });
  }
  return runLock;
}

export async function applyVendorScrape(catalog: Catalog) {
  const cache = await readCache();
  const settings = await readSettings();
  if (!cache) return { ...catalog, scrape: { ranAt: null, intervalMinutes: settings.intervalMinutes, vendors: [] } };
  return applyStored(catalog, cache.offers, {
    ranAt: cache.ranAt,
    intervalMinutes: settings.intervalMinutes,
    vendors: cache.vendors,
  });
}

export async function loadMotorCatalog(): Promise<Catalog> {
  const fresh = await readSpecCache(false);
  if (fresh) return fresh;
  try {
    const picked = new Map<string, { motor: Motor; files: number }>();
    for (const manufacturer of TC_MAKERS) {
      const response = await fetch(TC_SEARCH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": SCRAPE_UA,
        },
        body: JSON.stringify({ manufacturer, maxResults: 1000 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`ThrustCurve ${response.status}`);
      const body = (await response.json()) as { results?: TcRow[] };
      for (const row of body.results ?? []) {
        const motor = tcMotor(row);
        if (!motor) continue;
        const key = keyOf(motor);
        const files = row.dataFiles ?? 0;
        const previous = picked.get(key);
        if (!previous || files > previous.files) picked.set(key, { motor, files });
      }
    }
    const motors = [...picked.values()].map((item) => item.motor);
    if (!motors.length) throw new Error("ThrustCurve returned no motors.");
    const catalog: Catalog = { generatedAt: new Date().toISOString(), motors };
    const body = JSON.stringify(catalog);
    memorySpecs = body;
    await saveFile(storePaths().specs, body);
    return catalog;
  } catch (error) {
    const stale = await readSpecCache(true);
    if (stale) return stale;
    throw error;
  }
}

async function scrapeAll(): Promise<ScrapeMeta> {
  const checkedAt = new Date().toISOString();
  const settings = readSettings();
  const base = await loadMotorCatalog();
  const quantitiesPromise = wildmanQuantities().catch(() => new Map<string, number>());
  const shopifyPromise = Promise.all([
    scrapeShopify({ slug: "aerotechdirect", name: "AeroTech (direct)", origin: "https://aerotech-rocketry.com", checkedAt, specialOrder: aerotechLead }),
    scrapeShopify({ slug: "buyrocketmotors", name: "BuyRocketMotors.com", origin: "https://www.buyrocketmotors.com", checkedAt }),
    quantitiesPromise.then((quantities) =>
      scrapeShopify({ slug: "wildman", name: "Wildman Rocketry", origin: "https://wildmanrocketry.com", checkedAt, quantities }),
    ),
    scrapeShopify({ slug: "newcenturyrocketry", name: "New Century Rocketry", origin: "https://newcenturyrocketry.shop", checkedAt }),
  ]);
  const [shopify, hardwareShops, balsa, performance, chris, loki, erockets, amw, sirius, moto, apogee] = await Promise.all([
    shopifyPromise,
    scrapeHardwareShops().catch(() => [] as HardwareOffer[]),
    scrapeBalsa(checkedAt),
    scrapePerformance(checkedAt),
    scrapeChris(checkedAt),
    scrapeLoki(checkedAt),
    scrapeErockets(checkedAt),
    scrapeAmw(checkedAt),
    scrapeSirius(checkedAt),
    scrapeMotoJoe(checkedAt),
    scrapeApogee(checkedAt),
  ]);
  const pulls = [...shopify.map((shop) => shop.pull), balsa, performance, chris, loki, erockets, amw, sirius, moto, apogee];
  const hardware = [...shopify.flatMap((shop) => shop.hardware), ...hardwareShops];
  const { stored, vendors } = offersFromPulls(base.motors, pulls satisfies VendorPull[]);
  const previous = await readCache();
  if (!stored.length && previous) {
    return { ranAt: previous.ranAt, intervalMinutes: settings.intervalMinutes, vendors: previous.vendors };
  }
  const cache: CacheFile = { ranAt: checkedAt, intervalMinutes: settings.intervalMinutes, offers: stored, vendors };
  const paths = storePaths();
  const scrapeBody = JSON.stringify(cache);
  memoryScrape = scrapeBody;
  await saveFile(paths.cache, scrapeBody);
  await writeDbBody("vendor-scrape", scrapeBody);
  if (hardware.length) {
    const hardwareBody = JSON.stringify({ ranAt: checkedAt, offers: hardware });
    memoryHardware = hardwareBody;
    await saveFile(paths.hardware, hardwareBody);
    await writeDbBody("hardware", hardwareBody);
  }
  return { ranAt: checkedAt, intervalMinutes: settings.intervalMinutes, vendors };
}

export async function loadHardware(): Promise<{ ranAt: string | null; offers: HardwareOffer[] }> {
  const memory = asHardware(memoryHardware ? safeParse(memoryHardware) : null);
  const disk = asHardware(await readJsonFile(storePaths().hardware));
  const db = asHardware(safeParse(await readDbBody("hardware")));
  const seed = asHardware(seedHardware);
  const picked = [memory, disk, db, seed].reduce((best, item) => {
    if (!item) return best;
    if (!best) return item;
    return Date.parse(item.ranAt ?? "") > Date.parse(best.ranAt ?? "") ? item : best;
  }, null as { ranAt: string | null; offers: HardwareOffer[] } | null);
  return picked ?? { ranAt: null, offers: [] };
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isDue(meta: ScrapeMeta) {
  if (meta.intervalMinutes == null) return false;
  if (!meta.ranAt) return true;
  return Date.now() - Date.parse(meta.ranAt) >= meta.intervalMinutes * 60 * 1000;
}

function readSettings(): Settings {
  const minutes = SCRAPE_INTERVAL_MINUTES;
  if (minutes == null || minutes === 0) return { intervalMinutes: null };
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 7 * 24 * 60) return { intervalMinutes: 60 };
  return { intervalMinutes: minutes };
}

async function readCache(): Promise<CacheFile | null> {
  const memory = asCache(memoryScrape ? safeParse(memoryScrape) : null);
  const disk = asCache(await readJsonFile(storePaths().cache));
  const db = asCache(safeParse(await readDbBody("vendor-scrape")));
  const seed = asCache(seedScrape);
  return [memory, disk, db, seed].reduce(newerCache, null);
}

type TcRow = {
  motorId?: string;
  manufacturer?: string;
  designation?: string;
  commonName?: string;
  impulseClass?: string;
  diameter?: number;
  type?: string;
  avgThrustN?: number | null;
  totImpulseNs?: number | null;
  burnTimeS?: number | null;
  delays?: string | null;
  delayAdjustable?: boolean;
  caseInfo?: string | null;
  propInfo?: string | null;
  sparky?: boolean;
  availability?: string;
  dataFiles?: number;
};

async function readSpecCache(allowStale: boolean): Promise<Catalog | null> {
  try {
    let raw = memorySpecs;
    if (!raw) {
      const specs = storePaths().specs;
      if (!allowStale) {
        const info = await stat(specs);
        if (Date.now() - info.mtimeMs > SPEC_MAX_AGE) return null;
      }
      raw = await readFile(specs, "utf8");
    }
    const catalog = parseCatalog(JSON.parse(raw));
    return {
      ...catalog,
      motors: catalog.motors.map((motor) => ({
        ...motor,
        listings: [],
        in_stock: false,
        vendor_count: 0,
        in_stock_vendor_count: 0,
        cheapest_in_stock: null,
      })),
    };
  } catch {
    return null;
  }
}

function tcMotor(row: TcRow): Motor | null {
  const designation = row.designation?.trim();
  const manufacturer = makerName(row.manufacturer ?? "");
  if (!designation || !manufacturer || !row.diameter) return null;
  return {
    id: stableId(row.motorId || `${manufacturer}|${designation}`),
    manufacturer,
    designation,
    common_name: row.commonName?.trim() || designation,
    impulse_class: row.impulseClass || designation[0] || "",
    diameter_mm: row.diameter,
    total_impulse_ns: numberOrNull(row.totImpulseNs),
    avg_thrust_n: numberOrNull(row.avgThrustN),
    burn_time_s: numberOrNull(row.burnTimeS),
    propellant: row.propInfo?.trim() || null,
    sparky: Boolean(row.sparky),
    motor_type: /single|^su$/i.test(row.type ?? "") ? "SU" : "reload",
    case_info: row.caseInfo?.trim() || null,
    hazmat: "unknown",
    delays: row.delays?.trim() || null,
    delay_adjustable: Boolean(row.delayAdjustable),
    discontinued: row.availability === "unavailable",
    in_stock: false,
    vendor_count: 0,
    in_stock_vendor_count: 0,
    listings: [],
    cheapest_in_stock: null,
  };
}

function makerName(name: string) {
  if (/cesaroni/i.test(name)) return "Cesaroni Technology";
  if (/loki/i.test(name)) return "Loki Research";
  if (/aerotech/i.test(name)) return "AeroTech";
  return name.trim();
}

function numberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stableId(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return (hash % 1_000_000) + 1;
}
