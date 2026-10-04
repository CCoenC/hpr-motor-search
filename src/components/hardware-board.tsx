import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { partMatches, type HardwarePart } from "@/lib/hardware";
import { money, shortMaker } from "@/lib/motors";

const KINDS = ["complete", "casing", "closure", "seal", "adapter"] as const;

const KIND_LABEL: Record<string, string> = {
  complete: "Complete set",
  casing: "Casing",
  closure: "Closure",
  seal: "Seal disc",
  adapter: "Adapter / spacer",
  spacer: "Adapter / spacer",
};

export function HardwareBoard({
  parts,
  loading,
  error,
  query,
  onQuery,
  onReload,
  jump = 0,
  layout = "tiles",
}: {
  parts: HardwarePart[];
  loading: boolean;
  error: string | null;
  query: string;
  onQuery: (query: string) => void;
  onReload: () => void;
  jump?: number;
  layout?: "tiles" | "list";
}) {
  const [kind, setKind] = useState("");
  const [maker, setMaker] = useState("");
  const [stockOnly, setStockOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [visible, setVisible] = useState(48);
  useEffect(() => {
    setKind("");
    setMaker("");
    setOpenId(null);
  }, [jump]);
  useEffect(() => {
    setVisible(48);
  }, [query, kind, maker, stockOnly]);
  const makers = useMemo(() => [...new Set(parts.map((part) => part.maker))].sort(), [parts]);
  const filtered = useMemo(() => {
    return parts
      .filter((part) => {
        if (kind && part.kind !== kind) return false;
        if (maker && part.maker !== maker) return false;
        if (stockOnly && !query && !part.inStock) return false;
        return partMatches(part, query);
      })
      .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name));
  }, [kind, maker, parts, query, stockOnly]);
  const open = parts.find((part) => part.id === openId) ?? null;

  return (
    <div className="mt-4">
      <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4">
        <Search className="size-5 text-faint" aria-hidden />
        <input
          aria-label="Look up hardware"
          className="w-full bg-transparent text-lg tracking-tight outline-none placeholder:text-faint"
          placeholder="54/1706, Pro54-6G, forward closure, seal disc…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <select className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" value={maker} onChange={(event) => setMaker(event.target.value)} aria-label="Hardware maker">
          <option value="">All makers</option>
          {makers.map((item) => (
            <option key={item} value={item}>{shortMaker(item)}</option>
          ))}
        </select>
        <select className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Hardware kind">
          <option value="">All kinds</option>
          {KINDS.map((item) => (
            <option key={item} value={item}>{KIND_LABEL[item]}</option>
          ))}
        </select>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm">
          <input type="checkbox" checked={stockOnly} onChange={(event) => setStockOnly(event.target.checked)} />
          In stock
        </label>
      </div>
      <p className="mt-3 text-xs text-pretty text-faint">
        A complete set is the casing plus the closures. A casing is the tube. Adapters and spacers are the same thing. A shop that says “54/1706 motor” usually means the complete set, not the reload. Confirm the price on the vendor page.
      </p>
      {error ? (
        <div className="mt-4 rounded-card border border-line bg-surface p-6">
          <p className="font-semibold">Hardware didn't load.</p>
          <button className="mt-3 min-h-11 rounded-full bg-flame px-4 font-bold text-ink" onClick={onReload}>Try again</button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{loading ? "Loading hardware…" : `${filtered.length} showing`}</p>
      )}
      {filtered.length && layout === "list" ? (
        <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
          {filtered.slice(0, visible).map((part) => (
            <button key={part.id} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-left last:border-b-0 motion-safe:hover:bg-bg-2" onClick={() => setOpenId(part.id)}>
              <span className="min-w-48 flex-1 font-extrabold tracking-tight">{part.name}</span>
              <span className="text-sm text-muted">{shortMaker(part.maker)} · {KIND_LABEL[part.kind] ?? part.kind}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{part.cheapest != null ? money(part.cheapest) : "—"}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${part.inStock ? "bg-ok/15 text-ok" : "bg-surface-2 text-faint"}`}>
                {part.inStock ? `${part.inStockVendorCount} vendor${part.inStockVendorCount === 1 ? "" : "s"}` : "out"}
              </span>
            </button>
          ))}
        </div>
      ) : (
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.slice(0, visible).map((part) => (
          <button key={part.id} className="rounded-card border border-line bg-surface p-3 text-left motion-safe:hover:border-flame/60" onClick={() => setOpenId(part.id)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-extrabold tracking-tight">{part.name}</div>
                <div className="text-sm text-muted">{shortMaker(part.maker)} · {KIND_LABEL[part.kind] ?? part.kind}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${part.inStock ? "bg-ok/15 text-ok" : "bg-surface-2 text-faint"}`}>
                {part.inStock ? `${part.inStockVendorCount} vendor${part.inStockVendorCount === 1 ? "" : "s"}` : "out"}
              </span>
            </div>
            <p className="mt-2 text-xs text-faint">{part.note}</p>
            <p className="mt-3 font-mono text-lg font-semibold tabular-nums">
              {part.cheapest != null ? money(part.cheapest) : "no live price"}
            </p>
          </button>
        ))}
      </div>
      )}
      {filtered.length > visible ? (
        <button className="mt-3 min-h-11 w-full rounded-2xl border border-line bg-surface text-sm" onClick={() => setVisible((count) => count + 48)}>
          Show more ({filtered.length - visible} left)
        </button>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button className="absolute inset-0 bg-bg/70" aria-label="Close hardware" onClick={() => setOpenId(null)} />
          <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface px-4 py-4 sm:px-5">
            <p className="font-mono text-xs tracking-wide text-faint uppercase">{shortMaker(open.maker)} · {KIND_LABEL[open.kind]}</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{open.name}</h2>
            <p className="mt-2 text-sm text-muted">{open.note}</p>
            <ul className="mt-4 flex flex-col gap-2">
              {open.listings.map((listing) => (
                <li key={`${listing.vendorSlug}-${listing.url}-${listing.title}`} className="rounded-2xl border border-line bg-bg-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{listing.vendor}</div>
                      <p className="mt-1 text-sm text-muted">{listing.title}</p>
                      <p className={`mt-1 text-sm ${listing.status === "in_stock" ? "text-ok" : "text-faint"}`}>
                        {listing.status === "in_stock" ? "In stock" : listing.status === "special_order" ? "Special order" : "Out"}
                        {listing.stockCount != null ? ` · ${listing.stockCount} on shelf` : ""}
                      </p>
                    </div>
                    <div className="font-mono text-lg font-semibold tabular-nums">{money(listing.priceCents)}</div>
                  </div>
                  <a className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-amber" href={listing.url} target="_blank" rel="noreferrer">
                    Vendor page <ExternalLink className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
