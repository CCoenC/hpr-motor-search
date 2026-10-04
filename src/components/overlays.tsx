import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { getCurve } from "@/lib/catalog.functions";
import {
  CERTS,
  hasCurve,
  money,
  round,
  shortMaker,
  typeLabel,
  valueScore,
  type CartItem,
  type Motor,
} from "@/lib/motors";
import { ThrustCurve, type Series } from "@/components/thrust-curve";

const COLORS = ["var(--color-flame)", "var(--color-info)", "var(--color-ok)"];

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
      <button className="absolute inset-0 bg-bg/75" aria-label="Close dialog" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 shadow-2xl sm:max-w-3xl sm:rounded-3xl sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
          <button className="grid size-11 place-items-center rounded-full border border-line bg-bg-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FitModal({
  motors,
  onClose,
  onOpen,
}: {
  motors: Motor[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const diameters = useMemo(
    () => [...new Set(motors.map((motor) => motor.diameter_mm))].sort((a, b) => a - b),
    [motors],
  );
  const [diameter, setDiameter] = useState(diameters.includes(54) ? 54 : (diameters[0] ?? 54));
  const [cert, setCert] = useState<(typeof CERTS)[number]["id"]>("L1");
  const [maxPrice, setMaxPrice] = useState("");

  const allowed: readonly string[] = CERTS.find((item) => item.id === cert)?.classes ?? [];
  const hits = motors
    .filter((motor) => {
      if (!motor.in_stock || motor.diameter_mm !== diameter) return false;
      if (!allowed.includes(motor.impulse_class)) return false;
      if (maxPrice && (motor.cheapest_in_stock?.unit_price_cents ?? 1e12) / 100 > Number(maxPrice)) return false;
      return true;
    })
    .sort((a, b) => (valueScore(a) ?? 1e9) - (valueScore(b) ?? 1e9));

  return (
    <Modal title="What fits the rocket" onClose={onClose}>
      <p className="text-sm text-pretty text-muted">
        Diameter has to match the mount. Cert is a hard impulse-class gate. This is a shopping filter, not a sim — run OpenRocket before you send it.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-muted">
          Motor mount
          <select
            className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-bg-2 px-3"
            value={diameter}
            onChange={(event) => setDiameter(Number(event.target.value))}
          >
            {diameters.map((item) => (
              <option key={item} value={item}>
                {item} mm
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          Cert
          <select
            className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-bg-2 px-3"
            value={cert}
            onChange={(event) => setCert(event.target.value as (typeof CERTS)[number]["id"])}
          >
            {CERTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          Max unit price
          <input
            className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-bg-2 px-3"
            inputMode="decimal"
            placeholder="any"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
          />
        </label>
      </div>
      <p className="mt-4 text-sm text-muted">
        {hits.length ? `${hits.length} in stock, cheapest impulse first.` : "Nothing in stock for that mount and cert."}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {hits.slice(0, 30).map((motor) => {
          const score = valueScore(motor);
          return (
            <li key={motor.id}>
              <button
                className="flex w-full min-h-11 items-center justify-between gap-3 py-2 text-left"
                onClick={() => onOpen(String(motor.id))}
              >
                <span>
                  <span className="font-semibold">{motor.designation}</span>
                  <span className="block text-xs text-faint">
                    {shortMaker(motor.manufacturer)} · {motor.propellant} · {typeLabel(motor)}
                  </span>
                </span>
                <span className="text-right font-mono text-sm tabular-nums">
                  {money(motor.cheapest_in_stock?.unit_price_cents)}
                  <span className="block text-xs text-faint">
                    {round(motor.total_impulse_ns)} N·s{score ? ` · $${score.toFixed(3)}/N·s` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

export function CompareModal({ motors, onClose }: { motors: Motor[]; onClose: () => void }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [note, setNote] = useState("Loading curves…");

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const next: Series[] = [];
      for (let index = 0; index < motors.length; index += 1) {
        const motor = motors[index];
        if (!hasCurve(motor)) continue;
        try {
          const result = await getCurve({
            data: {
              manufacturer: motor.manufacturer,
              designation: motor.designation,
              commonName: motor.common_name,
            },
          });
          if (result.samples.length) {
            next.push({ name: motor.designation, color: COLORS[index] ?? COLORS[0], samples: result.samples });
          }
        } catch {
          /* keep going */
        }
      }
      if (cancel) return;
      setSeries(next);
      setNote(
        next.length
          ? next.map((item) => item.name).join(" vs ")
          : motors.every((motor) => !hasCurve(motor))
            ? "No thrust curve on file for these."
            : "Couldn't pull the curves. Specs are still good.",
      );
    })();
    return () => {
      cancel = true;
    };
  }, [motors]);

  const rows: Array<[string, string[]]> = [
    ["Maker", motors.map((motor) => shortMaker(motor.manufacturer))],
    ["Propellant", motors.map((motor) => motor.propellant || "—")],
    ["Impulse", motors.map((motor) => `${round(motor.total_impulse_ns)} N·s`)],
    ["Thrust", motors.map((motor) => `${round(motor.avg_thrust_n)} N`)],
    ["Burn", motors.map((motor) => `${round(motor.burn_time_s, 2)} s`)],
    ["Diameter", motors.map((motor) => `${motor.diameter_mm} mm`)],
    ["Best price", motors.map((motor) => money(motor.cheapest_in_stock?.unit_price_cents))],
    ["$ / N·s", motors.map((motor) => {
      const score = valueScore(motor);
      return score ? `$${score.toFixed(3)}` : "—";
    })],
    ["Vendors in stock", motors.map((motor) => String(motor.in_stock_vendor_count))],
  ];

  return (
    <Modal title="Compare" onClose={onClose}>
      <div className="rounded-card border border-line bg-bg-2 p-3">
        {series.length ? <ThrustCurve series={series} height={240} /> : <div className="grid h-40 place-items-center text-sm text-faint">Curves loading</div>}
        <p className="mt-2 font-mono text-xs text-faint">{note}</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-faint">
              <th className="py-2 pr-3 font-medium" />
              {motors.map((motor) => (
                <th key={motor.id} className="py-2 pr-3 font-semibold text-fg">
                  {motor.designation}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cells]) => (
              <tr key={label} className="border-t border-line">
                <td className="py-2 pr-3 text-muted">{label}</td>
                {cells.map((cell, index) => (
                  <td key={`${label}-${index}`} className="py-2 pr-3 font-mono tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function PileModal({
  cart,
  onClose,
  onChange,
}: {
  cart: CartItem[];
  onClose: () => void;
  onChange: (next: CartItem[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const subtotal = cart.reduce((sum, item) => sum + (item.unitPriceCents ?? 0) * item.qty, 0);
  const hazmat = cart.some((item) => item.hazmat === "required");

  async function copyList() {
    const text = cart
      .map((item) => `${item.designation} ×${item.qty} — ${item.vendor} — ${money(item.unitPriceCents)} — ${item.url}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "Pile is empty.");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal title="Order pile" onClose={onClose}>
      <p className="text-sm text-pretty text-muted">
        Motor subtotal only. Shipping and hazmat are vendor-specific and not in the scrape.
        {hazmat ? " At least one of these is hazmat." : " None of these flagged hazmat."}
      </p>
      {cart.length ? (
        <ul className="mt-3 divide-y divide-line">
          {cart.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <div className="font-semibold">{item.designation}</div>
                <a className="text-sm text-amber" href={item.url} target="_blank" rel="noreferrer">
                  {item.vendor}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm tabular-nums">{money(item.unitPriceCents)}</span>
                <button
                  className="min-h-11 rounded-full border border-line px-3 text-sm"
                  onClick={() => onChange(cart.filter((entry) => entry.id !== item.id))}
                >
                  Drop
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-faint">Pile is empty. Open a motor and add a listing.</p>
      )}
      <p className="mt-3 font-mono text-lg font-semibold tabular-nums">Motors {money(subtotal)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="min-h-11 rounded-full bg-flame px-4 text-sm font-bold text-ink" onClick={() => void copyList()}>
          {copied ? "Copied" : "Copy list"}
        </button>
        <button className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={() => onChange([])}>
          Clear pile
        </button>
      </div>
    </Modal>
  );
}
