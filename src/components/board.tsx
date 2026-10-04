import { useEffect, useMemo, useState } from "react";
import { GitCompare, Rocket, Search, Star } from "lucide-react";
import { CompareModal, FitModal, PileModal } from "@/components/overlays";
import { MotorDrawer } from "@/components/motor-drawer";
import { HardwareBoard } from "@/components/hardware-board";
import { ScrapeBar, type ScrapeShop } from "@/components/scrape-bar";
import { useHardware } from "@/lib/use-hardware";
import { hardwareShopRows } from "@/lib/hardware";
import {
  CERTS,
  CLASSES,
  countedQty,
  keyOf,
  money,
  round,
  shortMaker,
  typeLabel,
  unitPrice,
  valueScore,
  whenLabel,
  type CartItem,
  type Motor,
} from "@/lib/motors";
import { useStored } from "@/lib/use-stored";
import { useScrape } from "@/lib/use-scrape";

type SortKey = "price" | "value" | "impulse" | "thrust" | "burn" | "name";

export function Board({
  motors,
  loading,
  error,
  onReload,
  query,
  motorId,
  onQuery,
  onMotor,
}: {
  motors: Motor[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  query: string;
  motorId: string;
  onQuery: (query: string) => void;
  onMotor: (id: string) => void;
}) {
  const [classes, setClasses] = useState<string[]>([]);
  const [maker, setMaker] = useState("");
  const [diameter, setDiameter] = useState("");
  const [propellant, setPropellant] = useState("");
  const [vendor, setVendor] = useState("");
  const [stockOnly, setStockOnly] = useState(true);
  const [sparky, setSparky] = useState(false);
  const [reloadOnly, setReloadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [includeOld, setIncludeOld] = useState(false);
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<SortKey>("price");
  const [visible, setVisible] = useState(48);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const scrape = useScrape(onReload);
  const hardware = useHardware();
  const hardwareShops = useMemo(() => {
    const order = new Map(scrape.meta.vendors.map((vendor, index) => [vendor.slug, index]));
    return hardwareShopRows(hardware.parts).sort(
      (a, b) => (order.get(a.slug) ?? 1000) - (order.get(b.slug) ?? 1000) || a.name.localeCompare(b.name),
    );
  }, [hardware.parts, scrape.meta.vendors]);
  const [tab, setTab] = useState<"motors" | "hardware">("motors");
  const [hardwareQuery, setHardwareQuery] = useState("");
  const [hardwareJump, setHardwareJump] = useState(0);
  const [layout, setLayout] = useStored<"tiles" | "list">("pb-layout", "tiles");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [themeReady, setThemeReady] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [pileOpen, setPileOpen] = useState(false);
  const [stars, setStars] = useStored<string[]>("pb-stars", []);
  const [compare, setCompare] = useStored<string[]>("pb-compare", []);
  const [cart, setCart] = useStored<CartItem[]>("pb-cart", []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pb-appearance");
      if (raw === '"dark"') setTheme("dark");
    } catch {
      /* keep light */
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pb-appearance", JSON.stringify(theme));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#ffffff" : "#090b10");
  }, [theme, themeReady]);

  useEffect(() => {
    setVisible(48);
  }, [query, classes, maker, diameter, propellant, vendor, stockOnly, sparky, reloadOnly, starredOnly, includeOld, maxPrice, sort]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onMotor("");
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        document.getElementById("motor-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMotor]);

  const makers = useMemo(() => [...new Set(motors.map((motor) => motor.manufacturer))].sort(), [motors]);
  const diameters = useMemo(
    () => [...new Set(motors.map((motor) => motor.diameter_mm))].sort((a, b) => a - b),
    [motors],
  );
  const propellants = useMemo(
    () => [...new Set(motors.map((motor) => motor.propellant).filter((item): item is string => Boolean(item)))].sort(),
    [motors],
  );
  const vendors = useMemo(
    () => [...new Set(motors.flatMap((motor) => motor.listings.map((listing) => listing.vendor)))].sort(),
    [motors],
  );

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().replace(/[\s-]/g, "");
    const list = motors.filter((motor) => {
      if (classes.length && !classes.includes(motor.impulse_class)) return false;
      if (maker && motor.manufacturer !== maker) return false;
      if (diameter && String(motor.diameter_mm) !== diameter) return false;
      if (propellant && motor.propellant !== propellant) return false;
      if (vendor) {
        const hit = motor.listings.some((listing) => listing.vendor === vendor && (!stockOnly || listing.status === "in_stock"));
        if (!hit) return false;
      } else if (stockOnly && !query && !motor.in_stock) {
        return false;
      }
      if (sparky && !motor.sparky) return false;
      if (reloadOnly && motor.motor_type === "SU") return false;
      if (starredOnly && !stars.includes(keyOf(motor))) return false;
      if (!includeOld && motor.discontinued) return false;
      if (maxPrice) {
        const price = unitPrice(motor);
        if (price == null || price / 100 > Number(maxPrice)) return false;
      }
      if (!needle) return true;
      const blob = [motor.designation, motor.common_name, motor.manufacturer, motor.propellant, motor.case_info, motor.impulse_class]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.replace(/[\s-]/g, "").includes(needle) || blob.includes(query.toLowerCase());
    });
    list.sort((a, b) => {
      if (sort === "name") return a.designation.localeCompare(b.designation);
      if (sort === "price") return (unitPrice(a) ?? 1e12) - (unitPrice(b) ?? 1e12);
      if (sort === "value") return (valueScore(a) ?? 1e9) - (valueScore(b) ?? 1e9);
      if (sort === "impulse") return (b.total_impulse_ns || 0) - (a.total_impulse_ns || 0);
      if (sort === "thrust") return (b.avg_thrust_n || 0) - (a.avg_thrust_n || 0);
      return (b.burn_time_s || 0) - (a.burn_time_s || 0);
    });
    return list;
  }, [classes, diameter, includeOld, maker, maxPrice, motors, propellant, query, reloadOnly, sort, sparky, stars, starredOnly, stockOnly, vendor]);

  const open = motors.find((motor) => String(motor.id) === motorId) ?? null;
  const compareMotors = compare
    .map((key) => motors.find((motor) => keyOf(motor) === key))
    .filter((motor): motor is Motor => Boolean(motor));
  const inStockCount = motors.filter((motor) => motor.in_stock).length;

  function toggleClass(letter: string) {
    setClasses((current) => (current.includes(letter) ? current.filter((item) => item !== letter) : [...current, letter]));
  }

  function applyCert(id: (typeof CERTS)[number]["id"]) {
    const group: readonly string[] = CERTS.find((item) => item.id === id)?.classes ?? [];
    const allOn = group.every((letter) => classes.includes(letter));
    setClasses((current) => {
      const without = current.filter((letter) => !group.includes(letter));
      return allOn ? without : [...without, ...group];
    });
  }

  function toggleStar(motor: Motor) {
    const key = keyOf(motor);
    setStars((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function toggleCompare(motor: Motor) {
    const key = keyOf(motor);
    setCompare((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      if (current.length >= 3) return current;
      return [...current, key];
    });
  }

  function reset() {
    setClasses([]);
    setMaker("");
    setDiameter("");
    setPropellant("");
    setVendor("");
    setStockOnly(true);
    setSparky(false);
    setReloadOnly(false);
    setStarredOnly(false);
    setIncludeOld(false);
    setMaxPrice("");
    onQuery("");
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-5 pb-36 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-flame text-sm font-extrabold tracking-tight text-ink shadow-[0_10px_30px_color-mix(in_oklab,var(--color-flame)_40%,transparent)]">
            HPR
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">HPR Motor Search</h1>
            <p className="text-sm text-muted">AeroTech, Cesaroni, Loki, and Quest Q-Jets — who has it, what it costs, how many are on the shelf.</p>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Theme">
              <button
                className={`min-h-10 rounded-full px-3 text-sm ${theme === "dark" ? "bg-flame font-bold text-ink" : "text-muted"}`}
                aria-pressed={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
              <button
                className={`min-h-10 rounded-full px-3 text-sm ${theme === "light" ? "bg-flame font-bold text-ink" : "text-muted"}`}
                aria-pressed={theme === "light"}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
            </div>
            <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Layout">
              <button
                className={`min-h-10 rounded-full px-3 text-sm ${layout === "tiles" ? "bg-flame font-bold text-ink" : "text-muted"}`}
                aria-pressed={layout === "tiles"}
                onClick={() => setLayout("tiles")}
              >
                Tiles
              </button>
              <button
                className={`min-h-10 rounded-full px-3 text-sm ${layout === "list" ? "bg-flame font-bold text-ink" : "text-muted"}`}
                aria-pressed={layout === "list"}
                onClick={() => setLayout("list")}
              >
                List
              </button>
            </div>
            <div className="flex rounded-full border border-line bg-surface p-1">
            <button
              className={`min-h-10 rounded-full px-3 text-sm ${tab === "motors" ? "bg-flame font-bold text-ink" : "text-muted"}`}
              onClick={() => setTab("motors")}
            >
              Motors / Reloads
            </button>
            <button
              className={`min-h-10 rounded-full px-3 text-sm ${tab === "hardware" ? "bg-flame font-bold text-ink" : "text-muted"}`}
              onClick={() => setTab("hardware")}
            >
              Motor Hardware
            </button>
          </div>
          </div>
          <p className="font-mono text-xs text-faint sm:text-right">
            {tab === "motors" ? (
              <>
                <span className="text-fg">{motors.length || "—"}</span> motors
                <br />
                {scrape.meta.ranAt ? `scraped ${whenLabel(scrape.meta.ranAt)}` : "not scraped yet"}
              </>
            ) : (
              <>
                <span className="text-fg">{hardware.parts.length || "—"}</span> hardware parts
                <br />
                {hardware.ranAt ? `scraped ${whenLabel(hardware.ranAt)}` : "not scraped yet"}
              </>
            )}
          </p>
        </div>
      </header>

      <ScrapeBar
        meta={scrape.meta}
        running={scrape.running}
        error={tab === "hardware" ? hardware.error ?? scrape.error : scrape.error}
        shops={
          tab === "hardware"
            ? {
                noun: "parts",
                counted: "listed",
                empty: hardware.loading ? "Reading hardware shops…" : "No hardware shops in this scrape yet.",
                rows: hardwareShops.map((row) => ({
                  slug: row.slug,
                  name: row.name,
                  ok: true,
                  inStock: row.inStock,
                  counted: row.listed,
                  note: null,
                })),
              }
            : {
                noun: "motors",
                counted: "matched",
                empty: "Reads the shops directly, including Apogee. A shop that fails is left off until the next run.",
                rows: scrape.meta.vendors.map(
                  (vendor): ScrapeShop => ({
                    slug: vendor.slug,
                    name: vendor.name,
                    ok: vendor.ok,
                    inStock: vendor.inStock,
                    counted: vendor.matched,
                    note: vendor.note,
                  }),
                ),
              }
        }
      />

      {tab === "hardware" ? (
        <HardwareBoard
          parts={hardware.parts}
          loading={hardware.loading}
          error={hardware.error}
          query={hardwareQuery}
          onQuery={setHardwareQuery}
          onReload={() => void hardware.reload()}
          jump={hardwareJump}
          layout={layout}
        />
      ) : (
        <>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4">
          <Search className="size-5 text-faint" aria-hidden />
          <input
            id="motor-search"
            aria-label="Look up a motor"
            className="w-full bg-transparent text-lg tracking-tight outline-none placeholder:text-faint"
            placeholder="Look up a motor — I115, J350, White Lightning, 54mm…"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filtered[0]) onMotor(String(filtered[0].id));
            }}
          />
          <span className="hidden font-mono text-[11px] text-faint sm:inline" aria-hidden>
            /
          </span>
        </label>
        <button className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-flame px-4 font-bold text-ink" onClick={() => setFitOpen(true)}>
          <Rocket className="size-4" /> Rocket fit
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[270px_1fr]">
        <aside className={`rounded-card border border-line bg-surface/95 p-3.5 ${filtersOpen ? "block" : "hidden lg:block"}`}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-faint uppercase">Narrow it</h2>
            <button className="text-xs text-amber lg:hidden" onClick={() => setFiltersOpen(false)}>
              Done
            </button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CERTS.map((cert) => {
              const on = cert.classes.every((letter) => classes.includes(letter));
              return (
                <button
                  key={cert.id}
                  className={`min-h-10 rounded-full border px-3 text-xs ${on ? "border-transparent bg-flame font-bold text-ink" : "border-line bg-bg-2"}`}
                  onClick={() => applyCert(cert.id)}
                >
                  {cert.label}
                </button>
              );
            })}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {CLASSES.map((letter) => (
              <button
                key={letter}
                className={`grid size-10 place-items-center rounded-full border text-sm ${classes.includes(letter) ? "border-transparent bg-flame font-bold text-ink" : "border-line bg-bg-2"}`}
                onClick={() => toggleClass(letter)}
              >
                {letter}
              </button>
            ))}
          </div>
          <Field label="Manufacturer">
            <select value={maker} onChange={(event) => setMaker(event.target.value)}>
              <option value="">All</option>
              {makers.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Diameter">
            <select value={diameter} onChange={(event) => setDiameter(event.target.value)}>
              <option value="">All</option>
              {diameters.map((item) => (
                <option key={item} value={item}>
                  {item} mm
                </option>
              ))}
            </select>
          </Field>
          <Field label="Propellant">
            <select value={propellant} onChange={(event) => setPropellant(event.target.value)}>
              <option value="">All</option>
              {propellants.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Vendor">
            <select value={vendor} onChange={(event) => setVendor(event.target.value)}>
              <option value="">All</option>
              {vendors.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <div className="my-2 flex flex-col gap-1 text-sm">
            <Check label="In stock somewhere" checked={stockOnly} onChange={setStockOnly} />
            <Check label="Sparky only" checked={sparky} onChange={setSparky} />
            <Check label="Reloads only" checked={reloadOnly} onChange={setReloadOnly} />
            <Check label="Starred only" checked={starredOnly} onChange={setStarredOnly} />
            <Check label="Include discontinued" checked={includeOld} onChange={setIncludeOld} />
          </div>
          <Field label="Max unit price">
            <input
              inputMode="decimal"
              placeholder="no cap"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
            />
          </Field>
          <button className="mt-1 min-h-11 rounded-full border border-line px-3 text-sm" onClick={reset}>
            Reset filters
          </button>
          <p className="mt-4 text-xs text-pretty leading-relaxed text-faint">
            Prices and shelf status come from this site's shop scrape. If a shop doesn't load, that shop is missing until the next run.
            Motorman is read off his own list: every motor he can stock is posted, and only a trailing count like (3) is actually at the table.
            He sells at launches, not by mail. Curves load live from ThrustCurve when you open a motor. Quest Q-Jets are shelf listings only, so that drawer skips the curve. A typed lookup ignores the in-stock filter so a sold-out motor still appears.
            Confirm on the vendor page before you pay.
          </p>
          <p className="mt-2 text-xs">
            <a className="text-amber" href="https://github.com/CCoenC/hpr-motor-search" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </p>
        </aside>

        <main>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <div className="flex items-center gap-2">
              <button className="min-h-11 rounded-full border border-line px-3 lg:hidden" onClick={() => setFiltersOpen(true)}>
                Filters
              </button>
              <span>
                {loading ? "Loading motors…" : `${filtered.length} showing · ${inStockCount} in stock`}
              </span>
            </div>
            <label className="flex items-center gap-2">
              Sort
              <select
                className="min-h-11 rounded-xl border border-line bg-surface px-2"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="price">Cheapest in stock</option>
                <option value="value">Best $ / N·s</option>
                <option value="impulse">Total impulse</option>
                <option value="thrust">Average thrust</option>
                <option value="burn">Burn time</option>
                <option value="name">Designation</option>
              </select>
            </label>
          </div>

          {error ? (
            <div className="rounded-card border border-line bg-surface p-6">
              <p className="font-semibold">The motor list didn't load.</p>
              <p className="mt-1 text-sm text-muted">{error}</p>
              <button className="mt-3 min-h-11 rounded-full bg-flame px-4 font-bold text-ink" onClick={onReload}>
                Try again
              </button>
            </div>
          ) : null}

          {!loading && !error && !filtered.length ? (
            <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted">
              Nothing matches. Loosen a filter, or clear the search.
            </div>
          ) : null}

          <div className={layout === "list" ? (filtered.length ? "overflow-hidden rounded-card border border-line bg-surface" : "") : "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"}>
            {filtered.slice(0, visible).map((motor) => {
              const price = unitPrice(motor);
              const score = valueScore(motor);
              const qty = countedQty(motor);
              const starred = stars.includes(keyOf(motor));
              const compared = compare.includes(keyOf(motor));
              const stock = (
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${motor.in_stock ? "bg-ok/15 text-ok" : "bg-surface-2 text-faint"}`}>
                  {motor.in_stock ? `${motor.in_stock_vendor_count} vendor${motor.in_stock_vendor_count === 1 ? "" : "s"}` : "out"}
                </span>
              );
              const actions = (
                <>
                  <button className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm" onClick={() => toggleStar(motor)}>
                    <Star className={`size-3.5 ${starred ? "fill-amber text-amber" : ""}`} />
                    {starred ? "Starred" : "Star"}
                  </button>
                  <button className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm" onClick={() => toggleCompare(motor)}>
                    <GitCompare className="size-3.5" />
                    {compared ? "In compare" : "Compare"}
                  </button>
                </>
              );
              if (layout === "list") {
                return (
                  <article key={motor.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                    <button
                      className="min-w-0 flex-1 text-left"
                      aria-label={`${motor.designation}, ${shortMaker(motor.manufacturer)}, ${price ? money(price) : "no live price"}`}
                      onClick={() => onMotor(String(motor.id))}
                    >
                      <span className="font-extrabold tracking-tight">{motor.designation}</span>
                      <span className="ml-2 text-sm text-muted">
                        {shortMaker(motor.manufacturer)} · {motor.propellant || "—"} · {typeLabel(motor)} · {motor.diameter_mm} mm · {round(motor.total_impulse_ns)} N·s
                      </span>
                    </button>
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {price ? money(price) : "—"}
                      {qty ? <span className="ml-2 font-normal text-faint">{qty} counted</span> : null}
                    </span>
                    {stock}
                    {actions}
                  </article>
                );
              }
              return (
                <article key={motor.id} className="rounded-card border border-line bg-surface p-3 motion-safe:transition motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-flame/60">
                  <button
                    className="w-full text-left"
                    aria-label={`${motor.designation}, ${shortMaker(motor.manufacturer)}, ${price ? money(price) : "no live price"}`}
                    onClick={() => onMotor(String(motor.id))}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xl font-extrabold tracking-tight">{motor.designation}</div>
                        <div className="text-sm text-muted">
                          {shortMaker(motor.manufacturer)} · {motor.propellant || "—"} · {typeLabel(motor)}
                        </div>
                      </div>
                      {stock}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted">
                      <Pill>{motor.impulse_class} · {motor.diameter_mm} mm</Pill>
                      <Pill>{round(motor.total_impulse_ns)} N·s</Pill>
                      <Pill>{round(motor.avg_thrust_n)} N</Pill>
                      <Pill>{round(motor.burn_time_s, 1)} s</Pill>
                      {motor.sparky ? <Pill>sparky</Pill> : null}
                    </div>
                    <p className="mt-3 font-mono text-lg font-semibold tabular-nums">
                      {price ? money(price) : "no live price"}
                      <span className="ml-2 text-xs font-normal text-faint">
                        {motor.cheapest_in_stock ? motor.cheapest_in_stock.vendor : ""}
                        {qty ? ` · ${qty} counted` : ""}
                        {score ? ` · $${score.toFixed(3)}/N·s` : ""}
                      </span>
                    </p>
                  </button>
                  <div className="mt-2 flex gap-2">{actions}</div>
                </article>
              );
            })}
          </div>
          {filtered.length > visible ? (
            <button className="mt-3 min-h-11 w-full rounded-2xl border border-line bg-surface text-sm" onClick={() => setVisible((count) => count + 48)}>
              Show more ({filtered.length - visible} left)
            </button>
          ) : null}
        </main>
      </div>

      <div className="fixed inset-x-3 bottom-3 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:left-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
          {compareMotors.map((motor) => (
            <span key={motor.id} className="inline-flex items-center gap-1 rounded-full bg-bg-2 px-2 py-1">
              {motor.designation}
              <button aria-label={`Remove ${motor.designation} from compare`} onClick={() => toggleCompare(motor)}>
                ×
              </button>
            </span>
          ))}
          {!compareMotors.length && !cart.length ? <span className="text-faint">Star a motor, or drop two into compare.</span> : null}
          {cart.slice(-3).map((item) => (
            <span key={item.id} className="rounded-full bg-bg-2 px-2 py-1 font-mono text-xs">
              {item.designation} {money(item.unitPriceCents)}
            </span>
          ))}
        </div>
        <button
          className="min-h-11 rounded-full border border-line px-3 text-sm disabled:opacity-40"
          disabled={compareMotors.length < 2}
          onClick={() => setCompareOpen(true)}
        >
          Compare
        </button>
        <button className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => setPileOpen(true)}>
          Order pile{cart.length ? ` (${cart.length})` : ""}
        </button>
      </div>

      {open ? (
        <MotorDrawer
          motor={open}
          motors={motors}
          onClose={() => onMotor("")}
          onOpen={onMotor}
          onHardware={(next) => {
            setHardwareQuery(next);
            setHardwareJump((n) => n + 1);
            setTab("hardware");
            onMotor("");
          }}
          onPile={(item) => setCart((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]))}
        />
      ) : null}
      {fitOpen ? <FitModal motors={motors} onClose={() => setFitOpen(false)} onOpen={(id) => { setFitOpen(false); onMotor(id); }} /> : null}
      {compareOpen ? <CompareModal motors={compareMotors} onClose={() => setCompareOpen(false)} /> : null}
      {pileOpen ? <PileModal cart={cart} onClose={() => setPileOpen(false)} onChange={setCart} /> : null}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return (
    <label className="mb-2 block text-sm text-muted">
      {label}
      <span className="mt-1.5 block [&_input]:min-h-11 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-line [&_input]:bg-bg-2 [&_input]:px-3 [&_select]:min-h-11 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-line [&_select]:bg-bg-2 [&_select]:px-3">
        {children}
      </span>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-fg">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-bg-2 px-2 py-1">{children}</span>;
}
