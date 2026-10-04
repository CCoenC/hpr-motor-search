export type HardwareKind = "complete" | "casing" | "closure" | "seal" | "adapter" | "spacer";

export type HardwareOffer = {
  maker: string;
  kind: HardwareKind;
  size: string | null;
  diameterMm: number | null;
  role: string | null;
  variant: string | null;
  name: string;
  title: string;
  vendor: string;
  vendorSlug: string;
  url: string;
  status: "in_stock" | "out_of_stock" | "special_order";
  priceCents: number | null;
  stockCount: number | null;
};

export type HardwarePart = {
  id: string;
  maker: string;
  kind: HardwareKind;
  name: string;
  size: string | null;
  diameterMm: number | null;
  note: string;
  inStock: boolean;
  vendorCount: number;
  inStockVendorCount: number;
  cheapest: number | null;
  listings: HardwareOffer[];
};

const SKIP = /nozzle|wrench|drill|grease|igniter|starter|o-?ring|delay tool|delay kit|retaining ring\b|retainer|motor mount|tailcone|liner|clothes|shirt/i;

export function classifyHardware(title: string, makerHint?: string | null): Omit<HardwareOffer, "title" | "vendor" | "vendorSlug" | "url" | "status" | "priceCents" | "stockCount"> | null {
  const text = title.replace(/&/g, "&").replace(/"/g, '"').replace(/\s+/g, " ").trim();
  if (!text || SKIP.test(text)) return null;
  if (/\b(?:HP-)?[A-O]\d{2,4}[A-Z]/i.test(text) && !/casing|closure|seal|spacer|adapter|hardware|bulkhead|case only|\bcase\b/i.test(text)) return null;
  const looks =
    /casing|case only|motor case|motor casing|\bcasing\b|\bcase\b|closure|bulkhead|boat\s*tail|seal disc|seal disk|spacer|adapter|hardware set|hardware system|complete motor hardware|motor hardware|reload adapter|\bhardware\b/i.test(text) ||
    /complete motor/i.test(text) ||
    /\b\d{2,3}\s*\/\s*\d{2,5}\s+motor\b/i.test(text) ||
    (/\b\d\s*grain\b/i.test(text) && /\b(case|casing|motor)\b/i.test(text)) ||
    (/\brms[-\s]*\d/i.test(text) && /\bmotor\b/i.test(text) && !/reload|propellant|single[ -]?use/i.test(text)) ||
    /^\d{2,3}\s*\/\s*all\b/i.test(text) ||
    (/\b\d{2,3}\s*mm\b/i.test(text) && /\b(forward|aft|fwd|plugged)\b/i.test(text));
  if (!looks) return null;

  const maker = makerOf(text, makerHint);
  if (!maker) return null;
  const kind = kindOf(text);
  const size = sizeOf(text, maker);
  const diameterMm = diameterOf(text, size);
  const role = kind === "closure" || kind === "spacer" || kind === "adapter" ? roleOf(text) : null;
  const variant = variantOf(text, kind);
  return { maker, kind, size, diameterMm, role, variant, name: displayName(maker, kind, size, diameterMm, role, text) };
}

export function hardwareQueryFromCase(caseInfo: string | null) {
  if (!caseInfo) return null;
  const pro = caseInfo.match(/Pro\s*(\d{2})\s*-?\s*(\d)G(XL)?/i);
  if (pro) return `Pro${pro[1]}-${pro[2]}G${(pro[3] ?? "").toUpperCase()}`;
  const rms = caseInfo.match(/(\d{2,3})\s*\/\s*(\d{2,5}(?:\s*-\s*\d{2,5})?)/);
  if (rms) return `${rms[1]}/${rms[2].replace(/\s+/g, "")}`;
  return null;
}

export function groupHardware(offers: HardwareOffer[]): HardwarePart[] {
  const groups = new Map<string, HardwareOffer[]>();
  for (const raw of offers) {
    const offer = raw.kind === "spacer" ? { ...raw, kind: "adapter" as const } : raw;
    const key = groupKey(offer);
    const list = groups.get(key) ?? [];
    list.push(offer);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([id, listings]) => {
    const unique: HardwareOffer[] = [];
    const seen = new Set<string>();
    for (const offer of listings) {
      const key = `${offer.vendorSlug}|${offer.title.toLowerCase()}|${offer.priceCents ?? ""}|${offer.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(offer);
    }
    const first = unique[0];
    const inStock = unique.filter((offer) => offer.status === "in_stock");
    const priced = inStock.map((offer) => offer.priceCents).filter((cents): cents is number => cents != null);
    return {
      id,
      maker: first.maker,
      kind: first.kind,
      name: first.name,
      size: first.size,
      diameterMm: first.diameterMm,
      note: noteFor(first.kind),
      inStock: inStock.length > 0,
      vendorCount: new Set(unique.map((offer) => offer.vendorSlug)).size,
      inStockVendorCount: new Set(inStock.map((offer) => offer.vendorSlug)).size,
      cheapest: priced.length ? Math.min(...priced) : null,
      listings: unique.sort((a, b) => rank(a.status) - rank(b.status) || (a.priceCents ?? 1e12) - (b.priceCents ?? 1e12)),
    };
  });
}

export function hardwareShopRows(parts: HardwarePart[]) {
  const by = new Map<string, { slug: string; name: string; listed: number; inStock: number }>();
  for (const part of parts) {
    const seen = new Map<string, { name: string; inStock: boolean }>();
    for (const offer of part.listings) {
      const row = seen.get(offer.vendorSlug) ?? { name: offer.vendor, inStock: false };
      if (offer.status === "in_stock") row.inStock = true;
      seen.set(offer.vendorSlug, row);
    }
    for (const [slug, row] of seen) {
      const acc = by.get(slug) ?? { slug, name: row.name, listed: 0, inStock: 0 };
      acc.listed += 1;
      if (row.inStock) acc.inStock += 1;
      by.set(slug, acc);
    }
  }
  return [...by.values()];
}

export function partMatches(part: HardwarePart, query: string) {
  const needle = query.toLowerCase().replace(/[\s-]/g, "");
  if (!needle) return true;
  const blob = [part.name, part.size, part.kind, part.maker, part.note, ...part.listings.map((offer) => `${offer.title} ${offer.vendor}`)]
    .join(" ")
    .toLowerCase();
  return blob.replace(/[\s-]/g, "").includes(needle) || blob.includes(query.toLowerCase());
}

function groupKey(offer: HardwareOffer) {
  const variant = offer.variant ?? "";
  if (offer.kind === "adapter" || offer.kind === "spacer") {
    return `${offer.maker}|adapter|${norm(offer.title)}|${offer.variant ?? ""}`;
  }
  if (offer.kind === "closure") {
    return `${offer.maker}|${offer.kind}|${offer.size ?? offer.diameterMm ?? "x"}|${offer.role ?? norm(offer.name)}|${variant}`;
  }
  if ((offer.kind === "casing" || offer.kind === "complete" || offer.kind === "seal") && offer.size) {
    return `${offer.maker}|${offer.kind}|${offer.size}|${variant}`;
  }
  return `${offer.maker}|${offer.kind}|${offer.size ?? norm(offer.name)}|${variant}`;
}

function makerOf(title: string, hint?: string | null) {
  if (/cesaroni|\bcti\b|\bpro-?\d{2}\b/i.test(title)) return "Cesaroni Technology";
  if (/\bloki\b/i.test(title)) return "Loki Research";
  if (/aerotech|\brms[-\s]|\brouse-?tech/i.test(title)) return "AeroTech";
  if (hint) return hint;
  if (/\bpro\d{2}\b/i.test(title)) return "Cesaroni Technology";
  return null;
}

function kindOf(title: string): HardwareKind {
  const hardwareSet = /hardware set|hardware system|complete motor hardware|motor hardware/i.test(title);
  const includesClosures = /\bclosures\b/i.test(title) && !/no closures/i.test(title);
  const bundled = /comes with|includes/i.test(title);
  const closureProduct = /closure|bulkhead|boat\s*tail/i.test(title) && !hardwareSet && !bundled;
  const tubeWord = /case only|motor case|motor casing|\bcasing\b/i.test(title) || (/\bcase\b/i.test(title) && !closureProduct);
  const sealProduct = /seal disc|seal disk|\bfsd\b/i.test(title) && !tubeWord && !hardwareSet && !includesClosures && !bundled && !/\bmotor\b/i.test(title);
  if (sealProduct) return "seal";
  if (/spacer|adapter/i.test(title) && !hardwareSet) return "adapter";
  if (includesClosures || hardwareSet || (/\bmotor\b/i.test(title) && !tubeWord && !closureProduct && !/reload/i.test(title))) return "complete";
  if (tubeWord && !closureProduct) return "casing";
  if (closureProduct) return "closure";
  if (/\b(forward|aft|fwd|plugged)\b/i.test(title) && !/seal/i.test(title)) return "closure";
  return "complete";
}

function sizeOf(title: string, maker: string) {
  const range = title.match(/RMS[-\s]*(\d{2,3})\s*\/\s*(\d{2,3})\s*-\s*(\d{2,5})/i);
  if (range && Number(range[2]) <= 200) return `${range[1]}/${range[2]}-${range[3]}`;
  const rms = title.match(/RMS[-\s]*(\d{2,3})\s*[/-]\s*(\d{2,5})(?:\s*[/-]\s*(\d{3,5}))?/i);
  if (rms) return rms[3] && Number(rms[2]) > 200 ? `${rms[1]}/${rms[2]}-${rms[3]}` : `${rms[1]}/${rms[2]}`;
  const anyRange = title.match(/\b(\d{2,3})\s*\/\s*(\d{2,4})\s*-\s*(\d{2,5})\b/);
  if (anyRange && Number(anyRange[2]) <= 2000) return `${anyRange[1]}/${anyRange[2]}-${anyRange[3]}`;
  if (!title.includes("/")) {
    const compact = title.match(/RMS[-\s]*(\d{4,7})(?:\s*-\s*(\d{2,5}))?/i);
    if (compact) {
      const dia = ["98", "75", "54", "38", "29", "24", "18"].find((d) => compact[1].startsWith(d) && compact[1].length > d.length);
      if (dia) {
        const impulse = compact[1].slice(dia.length);
        return compact[2] ? `${dia}/${impulse}-${compact[2]}` : `${dia}/${impulse}`;
      }
    }
  }
  const dashed = title.match(/\b(\d{2,3})\s*-\s*(\d{3,5})\b/);
  if (dashed && maker === "AeroTech" && /casing|hardware|case/i.test(title)) return `${dashed[1]}/${dashed[2]}`;
  const pro = title.match(/Pro\s*(\d{2})\s*[,/-]?\s*(\d)\s*G(XL)?/i) ?? title.match(/\b(\d{2})\s*mm\s+(\d)\s*G(XL)?/i);
  if (pro && (maker === "Cesaroni Technology" || /pro/i.test(title))) return `Pro${pro[1]}-${pro[2]}G${(pro[3] ?? "").toUpperCase()}`;
  const mmNs = title.match(/\b(\d{2,3})\s*mm\b[^\d]{0,16}(\d{2,5})\s*N[-\s]?s(?:ec)?/i);
  if (mmNs) return `${mmNs[1]}/${mmNs[2]}`;
  const slash = title.match(/\b(\d{2,3})\s*\/\s*(\d{2,5})\b/);
  if (slash) return `${slash[1]}/${slash[2]}`;
  return null;
}

function diameterOf(title: string, size: string | null) {
  const fromSize = size?.match(/^(\d{2,3})/) ?? size?.match(/Pro(\d{2})/i);
  if (fromSize) return Number(fromSize[1]);
  const mm = title.match(/\b(\d{2,3})\s*mm\b/i);
  if (mm) return Number(mm[1]);
  const pro = title.match(/\bPro\s*(\d{2})\b/i);
  if (pro) return Number(pro[1]);
  const leading = title.match(/^(\d{2,3})\s*\//);
  return leading ? Number(leading[1]) : null;
}

function roleOf(title: string) {
  const bits: string[] = [];
  if (/boat\s*tail/i.test(title)) bits.push("boattail");
  if (/floating/i.test(title)) bits.push("floating");
  if (/plugged/i.test(title)) bits.push("plugged");
  if (/extended/i.test(title)) bits.push("extended");
  if (/bulkhead/i.test(title)) bits.push("bulkhead");
  if (/aft|rear/i.test(title) && !/forward|\bfwd\b/i.test(title)) bits.push("aft");
  else if (/forward|\bfwd\b/i.test(title)) bits.push("forward");
  if (/\bopen\b/i.test(title)) bits.push("open");
  if (/endburn/i.test(title)) bits.push("endburn");
  if (/standard|\bstd\b/i.test(title)) bits.push("standard");
  if (/delay/i.test(title)) bits.push("delayed");
  if (/short/i.test(title)) bits.push("short");
  return bits.join("-") || "plain";
}

function variantOf(title: string, kind: HardwareKind) {
  const bits: string[] = [];
  if (kind === "complete") {
    if (/\bcombo\b/i.test(title)) bits.push("combo");
    else if (/\bextended\b/i.test(title)) bits.push("extended");
    else if (/\bstandard\b/i.test(title)) bits.push("standard");
  }
  if (kind === "casing" && /seal disc|seal disk/i.test(title)) bits.push("with-seal");
  if (kind !== "complete" && /\bcombo\b/i.test(title)) bits.push("combo");
  if (/stainless/i.test(title)) bits.push("stainless");
  if (/\bused\b/i.test(title)) bits.push("used");
  return bits.join("-") || null;
}

function displayName(maker: string, kind: HardwareKind, size: string | null, diameter: number | null, role: string | null, title: string) {
  const brand = maker === "Cesaroni Technology" ? "Cesaroni" : maker === "Loki Research" ? "Loki" : "AeroTech";
  const used = /\bused\b/i.test(title) ? ", used" : "";
  if (kind === "casing" && size) {
    const seal = /seal disc|seal disk/i.test(title) ? " with forward seal disc" : "";
    return `${brand} ${size} casing${seal}${used}`;
  }
  if (kind === "complete" && size) {
    const style = /\bcombo\b/i.test(title) ? ", combo" : /\bextended\b/i.test(title) ? ", extended" : /\bstandard\b/i.test(title) ? ", standard" : "";
    return `${brand} ${size} complete hardware${style}${used}`;
  }
  if (kind === "complete") return `${brand} ${diameter ?? ""}mm complete hardware${used}`.replace(/\s+/g, " ").trim();
  if (kind === "seal") {
    const steel = /stainless/i.test(title) ? " stainless" : "";
    return `${brand} ${size ?? `${diameter ?? ""}mm`}${steel} seal disc${used}`.replace(/\s+/g, " ").trim();
  }
  if (kind === "closure") return `${brand} ${diameter ?? ""}mm ${role?.replace(/-/g, " ") ?? ""} closure${used}`.replace(/\s+/g, " ").trim();
  if (kind === "spacer") return `${brand} ${diameter ?? ""}mm spacer${used}`.replace(/\s+/g, " ").trim();
  if (kind === "adapter") return title.replace(/\s+/g, " ").slice(0, 90);
  return title.slice(0, 90);
}

function noteFor(kind: HardwareKind) {
  if (kind === "complete") return "Casing and closures together. Not the reload.";
  if (kind === "casing") return "Tube only, unless that shop's title says a seal disc is included.";
  if (kind === "seal") return "Seal disc. Some casings already include one.";
  if (kind === "closure") return "End closure. A complete hardware set already has these.";
  if (kind === "adapter" || kind === "spacer") return "Reload adapter or spacer. Same thing: it lets a shorter reload fit a longer case.";
  return "Spacer.";
}

function rank(status: string) {
  if (status === "in_stock") return 0;
  if (status === "special_order") return 1;
  return 2;
}

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
