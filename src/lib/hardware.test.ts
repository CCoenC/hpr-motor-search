import assert from "node:assert/strict";
import test from "node:test";
import { classifyHardware, groupHardware, hardwareQueryFromCase, hardwareShopRows, type HardwareOffer } from "./hardware.ts";

test("hardware names keep a casing apart from a complete set", () => {
  const complete = classifyHardware("AeroTech RMS-54/1706 Complete Motor Hardware Set - 5417M");
  const casing = classifyHardware("RMS-54/1706 Casing w/Forward Seal Disk. Case (tube) only.");
  const closure = classifyHardware("AeroTech RMS-29 29mm Standard Forward Closure - 29FCC");
  const seal = classifyHardware("Aerotech 54mm RMS-54/1706-2800 Forward Seal Disc");
  const cti = classifyHardware("Cesaroni 54mm 4G case");
  const loki = classifyHardware("54mm 1200 Ns Complete Motor", "Loki Research");
  const motor = classifyHardware("Aerotech J550ST-14A Super Thunder 54mm - RMS");
  const nozzle = classifyHardware("54mm Single Use Composite Nozzle", "Loki Research");
  assert.equal(complete?.kind, "complete");
  assert.equal(complete?.size, "54/1706");
  assert.equal(casing?.kind, "casing");
  assert.equal(casing?.size, "54/1706");
  assert.equal(closure?.kind, "closure");
  assert.equal(closure?.role, "forward-standard");
  assert.equal(seal?.kind, "seal");
  assert.match(seal?.size ?? "", /54\/1706/);
  assert.equal(cti?.maker, "Cesaroni Technology");
  assert.equal(cti?.size, "Pro54-4G");
  assert.equal(loki?.kind, "complete");
  assert.equal(loki?.size, "54/1200");
  assert.equal(motor, null);
  assert.equal(nozzle, null);
  assert.equal(hardwareQueryFromCase("RMS-54/1706"), "54/1706");
  assert.equal(hardwareQueryFromCase("Pro54-6GXL"), "Pro54-6GXL");
});

test("the same casing from two shops becomes one part", () => {
  const base = classifyHardware("AeroTech RMS-54/1706 casing")!;
  const offers: HardwareOffer[] = [
    { ...base, title: "RMS-54/1706 Casing", vendor: "Apogee Components", vendorSlug: "apogee", url: "https://apogee.example/a", status: "in_stock", priceCents: 10336, stockCount: null, variant: base.variant },
    { ...base, title: "Aerotech RMS 54/1706 case only", vendor: "New Century Rocketry", vendorSlug: "newcenturyrocketry", url: "https://ncr.example/a", status: "out_of_stock", priceCents: 9900, stockCount: null, variant: base.variant },
  ];
  const parts = groupHardware(offers);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "casing");
  const shops = hardwareShopRows(parts);
  assert.equal(shops.length, 2);
  assert.equal(shops.find((shop) => shop.slug === "apogee")?.inStock, 1);
  assert.equal(shops.find((shop) => shop.slug === "newcenturyrocketry")?.inStock, 0);
  assert.equal(shops.every((shop) => shop.listed === 1), true);
  assert.equal(parts[0]?.inStockVendorCount, 1);
  assert.equal(parts[0]?.listings.length, 2);
});

test("a 54/1706 motor is the complete set, and a tube with a seal stays a casing", () => {
  const motor = classifyHardware('RMS-29/100 Motor "USED"');
  const tube = classifyHardware("RMS-29/100 Casing \"USED\"");
  const set = classifyHardware("Aerotech RMS 29/40-120 Model Rocket Reload Motor Hardware Set(Casing & Closures)");
  const moto = classifyHardware("Casing, 54mm, 1706 N-sec, w/ fwd seal disk", "AeroTech");
  const pro = classifyHardware("Casing, Pro54, 6GXL");
  const combo = classifyHardware('54mm 2800 Ns Complete Motor "Combo"', "Loki Research");
  const standard = classifyHardware('54mm 2800 Ns Complete Motor "Standard"', "Loki Research");
  const plain = classifyHardware("AeroTech RMS-54/1706 casing");
  assert.equal(motor?.kind, "complete");
  assert.equal(motor?.size, "29/100");
  assert.equal(motor?.variant, "used");
  assert.equal(tube?.kind, "casing");
  assert.equal(tube?.variant, "used");
  assert.equal(set?.kind, "complete");
  assert.equal(set?.size, "29/40-120");
  assert.equal(moto?.kind, "casing");
  assert.equal(moto?.size, "54/1706");
  assert.equal(moto?.variant, "with-seal");
  assert.equal(pro?.size, "Pro54-6GXL");
  assert.equal(pro?.maker, "Cesaroni Technology");
  const closureForCase = classifyHardware("29mm Forward Closure for 29/40-120 Case", "AeroTech");
  const withClosures = classifyHardware("Motor casing, 54mm, 1706 N-sec, w/ seal disk and closures", "AeroTech");
  const motorSet = classifyHardware("Aerotech RMS-54/1706 Motor (Includes Forward Seal Disc)");
  assert.equal(closureForCase?.kind, "closure");
  assert.equal(closureForCase?.size, "29/40-120");
  assert.equal(withClosures?.kind, "complete");
  assert.equal(withClosures?.size, "54/1706");
  assert.equal(motorSet?.kind, "complete");
  assert.equal(motorSet?.size, "54/1706");
  const parts = groupHardware([
    offer(combo, "https://loki.example/c"),
    offer(standard, "https://loki.example/s"),
    offer(plain, "https://shop.example/p"),
    offer(moto, "https://shop.example/m"),
  ]);
  assert.equal(parts.length, 4);
});

test("a spacer is the same kind as a reload adapter", () => {
  const spacer = classifyHardware("Cesaroni Pro38 XL Spacer");
  const adapter = classifyHardware("29mm Reload Adapter System", "AeroTech");
  assert.equal(spacer?.kind, "adapter");
  assert.equal(adapter?.kind, "adapter");
  const parts = groupHardware([
    { ...spacer!, kind: "spacer", title: "Pro38 XL Spacer", vendor: "Motorman", vendorSlug: "motorman", url: "https://mm.example/s", status: "in_stock", priceCents: 3470, stockCount: 3 },
    { ...adapter!, title: "29mm Reload Adapter System", vendor: "Motorman", vendorSlug: "motorman", url: "https://mm.example/a", status: "in_stock", priceCents: 4999, stockCount: 1 },
  ]);
  assert.equal(parts.length, 2);
  assert.equal(parts.every((part) => part.kind === "adapter"), true);
});

function offer(classified: ReturnType<typeof classifyHardware>, url: string): HardwareOffer {
  if (!classified) throw new Error("expected hardware");
  return { ...classified, title: classified.name, vendor: "Shop", vendorSlug: "shop", url, status: "in_stock", priceCents: 1000, stockCount: null };
}
