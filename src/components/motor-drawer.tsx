import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { getCurve } from "@/lib/catalog.functions";
import {
  age,
  hasCurve,
  money,
  round,
  shortMaker,
  sortedListings,
  statusLabel,
  typeLabel,
  type CartItem,
  type Motor,
  type Sample,
} from "@/lib/motors";
import { ThrustCurve } from "@/components/thrust-curve";
import { hardwareQueryFromCase } from "@/lib/hardware";

export function MotorDrawer({
  motor,
  motors,
  onClose,
  onOpen,
  onHardware,
  onPile,
}: {
  motor: Motor;
  motors: Motor[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onHardware: (query: string) => void;
  onPile: (item: CartItem) => void;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [note, setNote] = useState("Pulling the thrust curve…");
  const [addedId, setAddedId] = useState<string | null>(null);
  const addedTimer = useRef<number | null>(null);

  useEffect(() => {
    setAddedId(null);
    return () => {
      if (addedTimer.current != null) window.clearTimeout(addedTimer.current);
    };
  }, [motor.id]);

  useEffect(() => {
    let cancel = false;
    if (!hasCurve(motor)) {
      setSamples([]);
      setNote("No thrust curve for Quest Q-Jets. Stock and price are from the shop pages.");
      return;
    }
    setSamples([]);
    setNote("Pulling the thrust curve…");
    void getCurve({
      data: {
        manufacturer: motor.manufacturer,
        designation: motor.designation,
        commonName: motor.common_name,
      },
    })
      .then((result) => {
        if (cancel) return;
        setSamples(result.samples);
        setNote(result.note);
      })
      .catch(() => {
        if (!cancel) setNote("ThrustCurve didn't answer. Specs below are still from the catalog match.");
      });
    return () => {
      cancel = true;
    };
  }, [motor]);

  const listings = sortedListings(motor);
  const best = motor.cheapest_in_stock?.url;
  const similar = motors
    .filter((other) => {
      if (other.id === motor.id || !other.in_stock) return false;
      if (other.diameter_mm !== motor.diameter_mm || other.impulse_class !== motor.impulse_class) return false;
      if (!other.total_impulse_ns || !motor.total_impulse_ns) return false;
      return Math.abs(other.total_impulse_ns - motor.total_impulse_ns) / motor.total_impulse_ns <= 0.18;
    })
    .sort((a, b) => (a.cheapest_in_stock?.unit_price_cents ?? 1e12) - (b.cheapest_in_stock?.unit_price_cents ?? 1e12))
    .slice(0, 5);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-bg/70" aria-label="Close motor" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface px-4 pt-4 pb-28 shadow-2xl sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-wide text-faint uppercase">
              {shortMaker(motor.manufacturer)} · {motor.impulse_class}-class · {motor.diameter_mm} mm
            </p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-balance">{motor.designation}</h2>
            <p className="mt-1 text-sm text-muted">
              {motor.common_name} · {motor.propellant || "propellant not listed"} · {typeLabel(motor)}
            </p>
          </div>
          <button
            className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-bg-2"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-pretty text-muted">
          {motor.in_stock
            ? `In stock at ${motor.in_stock_vendor_count} of ${motor.vendor_count} vendors, from ${money(motor.cheapest_in_stock?.unit_price_cents)}.`
            : "Nobody we scraped has it on the shelf."}{" "}
          {motor.hazmat === "required" ? "Hazmat ship — budget a fee." : null}{" "}
          {motor.sparky ? "Sparky. Check the waiver." : null}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Spec label="Impulse" value={`${round(motor.total_impulse_ns)} N·s`} />
          <Spec label="Avg thrust" value={`${round(motor.avg_thrust_n)} N`} />
          <Spec label="Burn" value={`${round(motor.burn_time_s, 2)} s`} />
          <Spec label="Diameter" value={`${motor.diameter_mm} mm`} />
          <Spec
            label="Delays"
            value={`${motor.delays || "—"}${motor.delay_adjustable ? " adj" : ""}`}
          />
          {hardwareQueryFromCase(motor.case_info) ? (
            <button
              className="rounded-xl border border-line bg-bg-2 px-3 py-2 text-left"
              onClick={() => onHardware(hardwareQueryFromCase(motor.case_info) ?? "")}
            >
              <span className="block text-xs text-faint">Case</span>
              <span className="font-mono text-sm font-semibold text-amber">{motor.case_info}</span>
              <span className="mt-1 block text-xs text-muted">Find this hardware</span>
            </button>
          ) : (
            <Spec label="Case" value={motor.case_info || (motor.motor_type === "SU" ? "single use" : "—")} />
          )}
        </dl>

        <div className="mt-4 rounded-card border border-line bg-bg-2 p-3">
          {samples.length ? (
            <ThrustCurve series={[{ name: motor.designation, color: "var(--color-flame)", samples }]} />
          ) : (
            <div className="grid h-40 place-items-center px-6 text-center text-sm text-faint">
              {hasCurve(motor) ? "Curve loading" : "No curve on file"}
            </div>
          )}
          <p className="mt-2 font-mono text-xs text-faint">{note}</p>
        </div>

        <h3 className="mt-5 text-xs font-semibold tracking-[0.14em] text-faint uppercase">Where it sits</h3>
        <p className="mt-1 text-xs text-pretty text-faint">
          Quantity is whatever the vendor page published. Last checked is the scrape time — this feed does not
          include a separate restock date.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {listings.map((listing) => {
            const isBest = listing.status === "in_stock" && listing.url === best;
            return (
              <li key={`${listing.vendor}-${listing.url}`} className="rounded-2xl border border-line bg-bg-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{listing.vendor}</span>
                      {isBest ? (
                        <span className="rounded-full bg-flame px-2 py-0.5 text-xs font-bold text-ink">best</span>
                      ) : null}
                    </div>
                    <p className={`mt-1 text-sm ${listing.status === "in_stock" ? "text-ok" : listing.status === "special_order" ? "text-amber" : "text-faint"}`}>
                      {statusLabel(listing.status)}
                      {listing.lead_time ? ` · ${listing.lead_time}` : ""}
                      {listing.pack_size > 1 ? ` · ${listing.pack_size}-pack` : ""}
                    </p>
                    <p className="mt-1 font-mono text-xs text-faint">checked {age(listing.last_seen)}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-semibold tabular-nums">{money(listing.unit_price_cents)}</div>
                    <div className="text-xs text-muted">
                      {listing.stock_count == null
                        ? listing.status === "in_stock"
                          ? "qty not listed"
                          : "—"
                        : `${listing.stock_count} on shelf`}
                    </div>
                    {listing.pack_size > 1 ? (
                      <div className="text-xs text-faint">{money(listing.price_cents)} pack</div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-amber"
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Vendor page <ExternalLink className="size-3.5" />
                  </a>
                  <button
                    className="min-h-11 rounded-full bg-flame px-3 text-sm font-bold text-ink"
                    onClick={() => {
                      const id = `${motor.id}-${listing.vendor_slug}-${listing.url}`;
                      onPile({
                        id,
                        designation: motor.designation,
                        vendor: listing.vendor,
                        unitPriceCents: listing.unit_price_cents,
                        url: listing.url,
                        hazmat: motor.hazmat,
                        qty: listing.pack_size > 1 ? listing.pack_size : 1,
                      });
                      setAddedId(id);
                      if (addedTimer.current != null) window.clearTimeout(addedTimer.current);
                      addedTimer.current = window.setTimeout(() => setAddedId(null), 1000);
                    }}
                  >
                    {addedId === `${motor.id}-${listing.vendor_slug}-${listing.url}` ? "Added" : "Add to pile"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <h3 className="mt-5 text-xs font-semibold tracking-[0.14em] text-faint uppercase">Similar in stock</h3>
        <div className="mt-2 flex flex-wrap gap-2 pb-8">
          {similar.length ? (
            similar.map((item) => (
              <button
                key={item.id}
                className="min-h-11 rounded-full border border-line bg-bg-2 px-3 text-left text-sm"
                onClick={() => onOpen(String(item.id))}
              >
                {item.designation}
                <span className="text-muted"> · {money(item.cheapest_in_stock?.unit_price_cents)}</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-faint">No close in-stock cousin in this class and diameter.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-2 px-3 py-2">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
