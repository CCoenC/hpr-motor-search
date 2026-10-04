export const CLASSES = ["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"] as const;

export const CERTS = [
  { id: "mid", label: "Mid D–G", classes: ["D", "E", "F", "G"] },
  { id: "L1", label: "L1 H–I", classes: ["H", "I"] },
  { id: "L2", label: "L2 J–L", classes: ["J", "K", "L"] },
  { id: "L3", label: "L3 M–O", classes: ["M", "N", "O"] },
] as const;

export type Listing = {
  vendor: string;
  vendor_slug: string;
  url: string;
  status: string;
  price_cents: number | null;
  unit_price_cents: number | null;
  currency: string;
  pack_size: number;
  stock_count: number | null;
  lead_time: string | null;
  last_seen: string | null;
};

export type Cheapest = {
  price_cents: number;
  unit_price_cents: number;
  currency: string;
  vendor: string;
  vendor_slug: string;
  url: string;
  pack_size: number;
};

export type Motor = {
  id: number;
  manufacturer: string;
  designation: string;
  common_name: string;
  impulse_class: string;
  diameter_mm: number;
  total_impulse_ns: number | null;
  avg_thrust_n: number | null;
  burn_time_s: number | null;
  propellant: string | null;
  sparky: boolean;
  motor_type: string;
  case_info: string | null;
  hazmat: string;
  delays: string | null;
  delay_adjustable: boolean;
  discontinued: boolean;
  in_stock: boolean;
  vendor_count: number;
  in_stock_vendor_count: number;
  listings: Listing[];
  cheapest_in_stock: Cheapest | null;
};

export type Catalog = {
  generatedAt: string | null;
  motors: Motor[];
  motorman?: MotormanNote | null;
  scrape?: ScrapeMeta | null;
};

export type MotormanNote = {
  ok: boolean;
  checkedAt: string;
  listUpdated: string | null;
  motorsInStock: number;
  shelfCount: number;
};

export type VendorScrapeStatus = {
  slug: string;
  name: string;
  ok: boolean;
  note: string | null;
  seen: number;
  matched: number;
  inStock: number;
  checkedAt: string | null;
};

export type ScrapeMeta = {
  ranAt: string | null;
  intervalMinutes: number | null;
  vendors: VendorScrapeStatus[];
};

export type Sample = { time: number; thrust: number };

export type CartItem = {
  id: string;
  designation: string;
  vendor: string;
  unitPriceCents: number | null;
  url: string;
  hazmat: string;
  qty: number;
};

export function keyOf(motor: Motor) {
  return `${motor.manufacturer}|${motor.designation}`;
}

export function shortMaker(name: string) {
  if (name.startsWith("Cesaroni")) return "Cesaroni";
  if (name.startsWith("Loki")) return "Loki";
  return name;
}

export function money(cents: number | null | undefined) {
  if (cents == null || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function age(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function whenLabel(iso: string | null) {
  if (!iso) return "unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function unitPrice(motor: Motor) {
  return motor.cheapest_in_stock?.unit_price_cents ?? null;
}

export function valueScore(motor: Motor) {
  const price = unitPrice(motor);
  if (!price || !motor.total_impulse_ns) return null;
  return price / 100 / motor.total_impulse_ns;
}

export function countedQty(motor: Motor) {
  return motor.listings
    .filter((listing) => listing.status === "in_stock" && listing.stock_count != null)
    .reduce((sum, listing) => sum + (listing.stock_count ?? 0), 0);
}

export function statusLabel(status: string) {
  if (status === "in_stock") return "In stock";
  if (status === "special_order") return "Special order";
  return "Out";
}

export function hasCurve(motor: Motor) {
  return motor.case_info !== "Quest Q-Jet";
}

export function typeLabel(motor: Motor) {
  return motor.motor_type === "SU" ? "single use" : "reload";
}

export function round(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function sortedListings(motor: Motor) {
  const rank: Record<string, number> = { in_stock: 0, special_order: 1, out_of_stock: 2 };
  return [...motor.listings].sort((a, b) => {
    const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return (a.unit_price_cents ?? 1e12) - (b.unit_price_cents ?? 1e12);
  });
}

export function parseCatalog(data: unknown): Catalog {
  if (!data || typeof data !== "object") throw new Error("Catalog was empty.");
  const record = data as { generated_at?: unknown; generatedAt?: unknown; motors?: unknown };
  if (!Array.isArray(record.motors)) throw new Error("Catalog had no motors.");
  const generated = typeof record.generated_at === "string" ? record.generated_at : record.generatedAt;
  return {
    generatedAt: typeof generated === "string" ? generated : null,
    motors: record.motors as Motor[],
  };
}
