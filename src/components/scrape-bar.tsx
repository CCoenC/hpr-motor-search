import { whenLabel, type ScrapeMeta } from "@/lib/motors";

function everyLabel(minutes: number | null) {
  if (minutes == null) return "not on a timer";
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return `every ${minutes} min`;
}

export type ScrapeShop = {
  slug: string;
  name: string;
  ok: boolean;
  inStock: number;
  counted: number;
  note: string | null;
};

export function ScrapeBar({
  meta,
  running,
  error,
  shops,
}: {
  meta: ScrapeMeta;
  running: boolean;
  error: string | null;
  shops: { noun: string; counted: string; rows: ScrapeShop[]; empty: string };
}) {
  const ok = shops.rows.filter((vendor) => vendor.ok);
  const inStock = ok.reduce((sum, vendor) => sum + vendor.inStock, 0);

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-sm">
        <span className="font-medium">Shop scrape</span>
        <span className="text-muted">
          {" "}
          · {running ? "running…" : meta.ranAt ? whenLabel(meta.ranAt) : "not run yet"}
          {" · "}
          {everyLabel(meta.intervalMinutes)}
          {ok.length ? ` · ${ok.length} shops · ${inStock} ${shops.noun} in stock` : ""}
        </span>
      </p>
      {error ? <p className="mt-2 text-sm text-amber">{error}</p> : null}
      {shops.rows.length ? (
        <details className="mt-2 text-xs text-faint">
          <summary className="cursor-pointer text-muted">Vendor results</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {shops.rows.map((vendor) => (
              <li key={vendor.slug}>
                <span className={vendor.ok ? "text-fg" : "text-muted"}>{vendor.name}</span>
                {vendor.ok ? ` · ${vendor.inStock} in stock · ${vendor.counted} ${shops.counted}` : ` · ${vendor.note ?? "not scraped"}`}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mt-2 text-xs text-faint">{shops.empty}</p>
      )}
    </section>
  );
}