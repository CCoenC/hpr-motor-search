import type { Sample } from "@/lib/motors";

const API = "https://www.thrustcurve.org/api/v1";

const MAKERS: Record<string, string[]> = {
  AeroTech: ["AeroTech"],
  "Cesaroni Technology": ["Cesaroni"],
  "Loki Research": ["Loki Research", "Loki"],
  "Animal Motor Works": ["Animal Motor Works", "AMW"],
};

type TcMotor = {
  motorId?: string;
  designation?: string;
  commonName?: string;
};

const cache = new Map<string, { samples: Sample[]; note: string }>();

export async function loadCurve(motor: { manufacturer: string; designation: string; commonName: string }) {
  const cacheKey = `${motor.manufacturer}|${motor.designation}|${motor.commonName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const makers = MAKERS[motor.manufacturer] ?? (motor.manufacturer ? [motor.manufacturer] : []);
  const queries: Array<Record<string, string>> = [];
  for (const manufacturer of makers) {
    if (motor.designation) queries.push({ manufacturer, designation: motor.designation });
    if (motor.commonName) queries.push({ manufacturer, commonName: motor.commonName });
  }
  if (motor.designation) queries.push({ designation: motor.designation });
  if (motor.commonName) queries.push({ commonName: motor.commonName });

  let motorId: string | null = null;
  for (const query of queries) {
    const found = await getJson("search.json", query);
    const results = Array.isArray(found.results) ? (found.results as TcMotor[]) : [];
    const match = pickMotor(results, motor.designation, motor.commonName);
    if (match?.motorId) {
      motorId = match.motorId;
      break;
    }
  }

  if (!motorId) {
    const miss = { samples: [] as Sample[], note: "ThrustCurve has no file for this motor." };
    cache.set(cacheKey, miss);
    return miss;
  }

  const downloaded = await getJson("download.json", { motorId, data: "samples" });
  const first = (Array.isArray(downloaded.results) ? downloaded.results : [])[0] as { samples?: Sample[] } | undefined;
  const samples = (first?.samples ?? []).filter(
    (sample) => sample && Number.isFinite(sample.time) && Number.isFinite(sample.thrust),
  );
  const peak = samples.reduce((max, sample) => Math.max(max, sample.thrust), 0);
  const result = {
    samples,
    note: samples.length
      ? `ThrustCurve.org · ${samples.length} samples · peak ${Math.round(peak)} N`
      : "The curve file came back empty.",
  };
  cache.set(cacheKey, result);
  return result;
}

async function getJson(path: string, query: Record<string, string>) {
  const response = await fetch(`${API}/${path}?${new URLSearchParams(query)}`, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok || !text.trim().startsWith("{")) {
    throw new Error(text.includes("Just a moment") ? "Cloudflare blocked this browser too." : `ThrustCurve ${response.status}`);
  }
  return JSON.parse(text) as { results?: unknown };
}

function pickMotor(results: TcMotor[], designation: string, commonName: string) {
  const wantedDesignation = designation.toLowerCase();
  const wantedName = commonName.toLowerCase();
  return (
    results.find((item) => item.designation?.toLowerCase() === wantedDesignation) ??
    results.find((item) => item.commonName?.toLowerCase() === wantedName) ??
    results[0] ??
    null
  );
}
