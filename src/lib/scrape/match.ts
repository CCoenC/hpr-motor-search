import type { Motor } from "../motors.ts";

export type MotorIndex = {
  byDesignation: Map<string, Motor[]>;
  byCommon: Map<string, Motor[]>;
};

export function normCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

export function buildIndex(motors: Motor[]): MotorIndex {
  const byDesignation = new Map<string, Motor[]>();
  const byCommon = new Map<string, Motor[]>();
  for (const motor of motors) {
    for (const key of designationKeys(motor.designation)) push(byDesignation, key, motor);
    push(byCommon, normCode(motor.common_name), motor);
  }
  return { byDesignation, byCommon };
}

export function matchMotor(title: string, index: MotorIndex, designationHint?: string | null): Motor | null {
  if (designationHint) {
    const hinted = index.byDesignation.get(normCode(designationHint)) ?? [];
    const picked = choose(hinted, title);
    if (picked) return picked;
  }

  const exact: Motor[] = [];
  const common: Motor[] = [];
  for (const code of codesFrom(title)) {
    const designation = index.byDesignation.get(normCode(code));
    if (designation?.length) exact.push(...designation);
    else {
      const loose = index.byCommon.get(normCode(code));
      if (loose?.length) common.push(...loose);
    }
  }
  const maker = makerHint(title);
  const primary = dedupe(exact.length ? exact : common);
  const scoped = maker ? primary.filter((motor) => motor.manufacturer === maker) : primary;
  return choose(scoped.length ? scoped : primary, title);
}

export function packSizeOf(title: string) {
  const numeric = title.match(/(\d+)\s*-?\s*(?:pack|pk)\b/i);
  if (numeric) {
    const size = Number(numeric[1]);
    return size > 0 && size < 50 ? size : 1;
  }
  const word = title.match(/\b(two|three|four|six)\s*-?\s*pack\b/i)?.[1]?.toLowerCase();
  if (word === "two") return 2;
  if (word === "three") return 3;
  if (word === "four") return 4;
  if (word === "six") return 6;
  return 1;
}

export function centsFromDollars(value: string | number) {
  const amount = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function qjetDesignation(title: string) {
  if (!/q-?jet/i.test(title)) return null;
  const match = title.toUpperCase().match(/\b([A-D])(\d{1,2})-(\d{1,2})([A-Z])?\b/);
  if (!match) return null;
  const head = `${match[1]}${match[2]}${match[4] ?? ""}`;
  return {
    designation: `${head}-${match[3]}`,
    commonName: head,
    delay: match[3],
    propellant: match[4] === "W" ? "White Lightning" : null,
  };
}

function choose(motors: Motor[], title: string) {
  const unique = dedupe(motors);
  if (unique.length === 1) return unique[0];
  if (unique.length === 0) return null;
  let list = unique;
  const propellant = propellantHint(title);
  if (propellant) {
    const next = list.filter((motor) => propellant.test(motor.propellant ?? ""));
    if (next.length) list = next;
  }
  const diameter = title.match(/\b(18|24|29|38|54|75|98|150)\s*mm\b/i);
  if (diameter) {
    const mm = Number(diameter[1]);
    const next = list.filter((motor) => motor.diameter_mm === mm);
    if (next.length) list = next;
  }
  if (/single[ -]?use|\bq-?jet\b/i.test(title)) {
    const next = list.filter((motor) => motor.motor_type === "SU");
    if (next.length) list = next;
  } else if (/\breload\b|\brms\b|\bdms\b|\bpro\d{2}\b/i.test(title)) {
    const next = list.filter((motor) => motor.motor_type !== "SU");
    if (next.length) list = next;
  }
  return list.length === 1 ? list[0] : null;
}

function codesFrom(title: string) {
  const text = title.toUpperCase().replace(/[–—]/g, "-");
  const codes = new Set<string>();
  for (const match of text.matchAll(/\b(?:HP-)?([A-O])-?(\d{2,4})\s*-?\s*([A-Z]{2,4})\b/g)) {
    if (Number(match[2]) < 2) continue;
    codes.add(`${match[1]}${match[2]}-${match[3]}`);
    codes.add(`HP-${match[1]}${match[2]}-${match[3]}`);
  }
  for (const match of text.matchAll(/\b(\d{2,3})([A-O]\d{2,4})-(\d{1,2})A\b/g)) {
    codes.add(`${match[1]}${match[2]}-${match[3]}A`);
    codes.add(match[2]);
  }
  for (const match of text.matchAll(/\b([A-O]\d{1,4}(?:\.\d)?)([A-Z]{1,4})-(\d{1,2})A\b/g)) {
    codes.add(`${match[1]}${match[2]}`);
  }
  for (const match of text.matchAll(/\b([A-O])(\d{1,4}(?:\.\d)?)-(\d{1,2})([A-Z]{1,4})\b/g)) {
    if (Number(match[2]) < 2) continue;
    codes.add(`${match[1]}${match[2]}${match[4]}`);
  }
  for (const match of text.matchAll(/\b([A-O]\d{1,4}(?:\.\d)?)([A-Z]{1,4})\b/g)) {
    const thrust = Number(match[1].slice(1));
    if (thrust < 2) continue;
    codes.add(`${match[1]}${match[2]}`);
  }
  for (const match of text.matchAll(/\b([A-O])\s*(\d{1,4}(?:\.\d)?)\b/g)) {
    if (Number(match[2]) < 2) continue;
    codes.add(`${match[1]}${match[2]}`);
  }
  return [...codes];
}

function makerHint(title: string) {
  if (/cesaroni|\bcti\b|skidmark|blue streak|smoky sam/i.test(title)) return "Cesaroni Technology";
  if (/\bloki\b/i.test(title)) return "Loki Research";
  if (/aerotech|q-?jet|enerjet|\brms\b|\bdms\b/i.test(title)) return "AeroTech";
  return null;
}

function propellantHint(title: string) {
  const words: Array<[RegExp, RegExp]> = [
    [/white lightning/i, /white lightning/i],
    [/blue thunder/i, /blue thunder/i],
    [/redline|red line/i, /redline/i],
    [/black ?jack/i, /black ?jack/i],
    [/mojave/i, /mojave/i],
    [/warp-?9/i, /warp/i],
    [/metalstorm|dark matter/i, /metalstorm|dark matter/i],
    [/smoky sam/i, /smoky/i],
    [/skid ?mark/i, /skid/i],
    [/blue streak/i, /blue streak/i],
    [/white thunder/i, /white thunder/i],
    [/spitfire/i, /spitfire/i],
    [/ice blue/i, /ice blue/i],
    [/loki red/i, /loki red/i],
    [/loki white/i, /loki white/i],
    [/cocktail/i, /cocktail/i],
    [/classic/i, /classic/i],
  ];
  return words.find(([needle]) => needle.test(title))?.[1] ?? null;
}

function designationKeys(designation: string) {
  const upper = designation.toUpperCase();
  const keys = new Set<string>([normCode(upper)]);
  keys.add(normCode(upper.replace(/^HP-/, "").replace(/-\d{1,2}A$/, "")));
  return keys;
}

function push(map: Map<string, Motor[]>, key: string, motor: Motor) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(motor);
  else map.set(key, [motor]);
}

function dedupe(motors: Motor[]) {
  const seen = new Set<number>();
  const out: Motor[] = [];
  for (const motor of motors) {
    if (seen.has(motor.id)) continue;
    seen.add(motor.id);
    out.push(motor);
  }
  return out;
}
