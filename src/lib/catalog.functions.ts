import { createServerFn } from "@tanstack/react-start";
import { applyMotorman, fetchMotormanPages } from "@/lib/motorman";
import type { Catalog, Sample } from "@/lib/motors";

const UA = "Mozilla/5.0 (compatible; HPRMotorSearch/1.0; +https://github.com/CCoenC/hpr-motor-search)";

let catalogCache: { at: number; data: Catalog } | null = null;
const curveCache = new Map<string, { samples: Sample[]; note: string }>();

export function invalidateCatalog() {
  catalogCache = null;
}

const MAKERS: Record<string, string[]> = {
  AeroTech: ["AeroTech"],
  "Cesaroni Technology": ["Cesaroni"],
  "Loki Research": ["Loki Research", "Loki"],
};

type CurveQuery = { manufacturer: string; designation: string; commonName: string };

type TcMotor = {
  motorId?: string;
  designation?: string;
  commonName?: string;
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`ThrustCurve ${response.status}`);
  return response.json() as Promise<{ results?: TcMotor[] | Array<{ samples?: Sample[] }> }>;
}

function pickMotor(results: TcMotor[], designation: string, commonName: string) {
  const wantedDesignation = designation.toLowerCase();
  const wantedName = commonName.toLowerCase();
  return (
    results.find((motor) => motor.designation?.toLowerCase() === wantedDesignation) ??
    results.find((motor) => motor.commonName?.toLowerCase() === wantedName) ??
    results[0] ??
    null
  );
}

export const getCatalog = createServerFn({ method: "GET" }).handler(async (): Promise<Catalog> => {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.data;

  const pagePromise = fetchMotormanPages();

  const { applyVendorScrape, loadMotorCatalog } = await import("@/lib/scrape/run.server");
  const parsed = await loadMotorCatalog();
  const loaded = (await pagePromise).filter((page): page is NonNullable<typeof page> => page != null);
  const checkedAt = new Date().toISOString();
  const withMotorman = loaded.length
    ? applyMotorman(parsed, loaded, checkedAt)
    : {
        ...parsed,
        motorman: { ok: false, checkedAt, listUpdated: null, motorsInStock: 0, shelfCount: 0 },
      };
  const data = await applyVendorScrape(withMotorman);

  catalogCache = { at: Date.now(), data };
  return data;
});

export const getCurve = createServerFn({ method: "POST" })
  .validator((input: unknown): CurveQuery => {
    if (!input || typeof input !== "object") throw new Error("Missing motor.");
    const raw = input as Record<string, unknown>;
    const manufacturer = typeof raw.manufacturer === "string" ? raw.manufacturer : "";
    const designation = typeof raw.designation === "string" ? raw.designation : "";
    const commonName = typeof raw.commonName === "string" ? raw.commonName : "";
    if (!designation && !commonName) throw new Error("Need a designation.");
    return { manufacturer, designation, commonName };
  })
  .handler(async ({ data }) => {
    const cacheKey = `${data.manufacturer}|${data.designation}|${data.commonName}`;
    const cached = curveCache.get(cacheKey);
    if (cached) return cached;

    const makers = MAKERS[data.manufacturer] ?? (data.manufacturer ? [data.manufacturer] : []);
    const queries: Array<Record<string, string>> = [];
    for (const manufacturer of makers) {
      if (data.designation) queries.push({ manufacturer, designation: data.designation });
      if (data.commonName) queries.push({ manufacturer, commonName: data.commonName });
    }
    if (data.designation) queries.push({ designation: data.designation });
    if (data.commonName) queries.push({ commonName: data.commonName });

    let motorId: string | null = null;
    for (const query of queries) {
      const found = await postJson("https://www.thrustcurve.org/api/v1/search.json", query);
      const results = (found.results ?? []) as TcMotor[];
      const match = pickMotor(results, data.designation, data.commonName);
      if (match?.motorId) {
        motorId = match.motorId;
        break;
      }
    }

    if (!motorId) {
      const miss = { samples: [] as Sample[], note: "ThrustCurve has no file for this motor." };
      curveCache.set(cacheKey, miss);
      return miss;
    }

    const downloaded = await postJson("https://www.thrustcurve.org/api/v1/download.json", {
      motorIds: [motorId],
      data: "samples",
    });
    const first = (downloaded.results ?? [])[0] as { samples?: Sample[] } | undefined;
    const samples = (first?.samples ?? []).filter(
      (sample) => Number.isFinite(sample.time) && Number.isFinite(sample.thrust),
    );
    const peak = samples.reduce((max, sample) => Math.max(max, sample.thrust), 0);
    const result = {
      samples,
      note: samples.length
        ? `ThrustCurve.org · ${samples.length} samples · peak ${Math.round(peak)} N`
        : "The curve file came back empty.",
    };
    curveCache.set(cacheKey, result);
    return result;
  });
