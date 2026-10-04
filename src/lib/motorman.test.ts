import assert from "node:assert/strict";
import test from "node:test";
import { applyMotorman, htmlToLines, motormanHardware } from "./motorman.ts";
import type { Motor } from "./motors.ts";

function motor(partial: Pick<Motor, "id" | "manufacturer" | "designation" | "motor_type" | "diameter_mm" | "propellant">): Motor {
  return {
    common_name: partial.designation,
    impulse_class: partial.designation[0] ?? "H",
    total_impulse_ns: 100,
    avg_thrust_n: 50,
    burn_time_s: 2,
    sparky: false,
    case_info: null,
    hazmat: "none",
    delays: null,
    delay_adjustable: false,
    discontinued: false,
    in_stock: false,
    vendor_count: 0,
    in_stock_vendor_count: 0,
    listings: [],
    cheapest_in_stock: null,
    ...partial,
  };
}

const motors = [
  motor({ id: 1, manufacturer: "AeroTech", designation: "E20W", motor_type: "SU", diameter_mm: 24, propellant: "White Lightning" }),
  motor({ id: 2, manufacturer: "AeroTech", designation: "H268R", motor_type: "reload", diameter_mm: 29, propellant: "Redline" }),
  motor({ id: 3, manufacturer: "AeroTech", designation: "H550ST", motor_type: "reload", diameter_mm: 38, propellant: "Super Thunder" }),
  motor({ id: 4, manufacturer: "AeroTech", designation: "HP-H550ST", motor_type: "SU", diameter_mm: 38, propellant: "Super Thunder" }),
  motor({ id: 5, manufacturer: "Cesaroni Technology", designation: "75F51-12A", motor_type: "reload", diameter_mm: 24, propellant: "Classic" }),
  motor({ id: 6, manufacturer: "Cesaroni Technology", designation: "131G84-10A", motor_type: "reload", diameter_mm: 24, propellant: "Green3" }),
  motor({ id: 7, manufacturer: "Cesaroni Technology", designation: "1526K160-6", motor_type: "reload", diameter_mm: 54, propellant: "Classic" }),
  motor({ id: 8, manufacturer: "Cesaroni Technology", designation: "3660L1720-P", motor_type: "reload", diameter_mm: 75, propellant: "White Thunder" }),
];

const aerotech = `
<div id="wsite-content">
Updated&nbsp; 09/28/2026<br>
<strong>Econojet Single Use : (2 Pack)</strong><br>
E20-4W 24mm $33.99 (2)<br>
E20-7W 24mm $34.99 (1)<br>
F44-8W 24mm $38.99<br>
<strong>29/360 RMS Reloads</strong><br>
H268R-14A $51.99 (1)<br>
<strong>38mm Hardware</strong><br>
38/360 motor $141.99 (1)<br>
<strong>38mm/360 RMS Reloads</strong><br>
H550ST-14A $80.00 (2)<br>
<strong>DMS</strong><br>
H550ST-P 38mm DMS $90.00 (4)<br>
</div>
<div class="wsite-footer"></div>`;

const cesaroni = `
<div id="wsite-content">
Updated 09/28/2026<br>
Pro24 Reload Kits:<br>
Classic<br>
3G Reload 75F51-12A $21.99 (2)<br>
Green3<br>
6G Reload 31G84-10A $34.30 (2)<br>
Pro54<br>
Classic - Longburn<br>
4 Grain Reload Kit 1526-K160-6 $143.99 (1)<br>
1 Grain Casing $23.65 (2)<br>
Pro75<br>
White Thunder<br>
3 Grain Reload Kit L1720-P $301.70 (1)<br>
</div>
<div id="footer"></div>`;

test("html lines keep stock counts and drop tags", () => {
  const lines = htmlToLines(aerotech);
  assert.equal(lines[0], "Updated 09/28/2026");
  assert.ok(lines.some((line) => line === "E20-4W 24mm $33.99 (2)"));
});

test("parenthetical count is shelf stock, everything else is out", () => {
  const catalog = applyMotorman(
    { generatedAt: "2026-10-03T00:00:00Z", motors },
    [
      { maker: "aerotech", url: "https://www.the-motorman.net/aerotech.html", html: aerotech },
      { maker: "cesaroni", url: "https://www.the-motorman.net/cti--cesaroni.html", html: cesaroni },
    ],
    "2026-10-03T21:00:00Z",
  );

  const e20 = catalog.motors.find((item) => item.id === 1);
  assert.ok(e20);
  assert.equal(e20.in_stock, true);
  assert.equal(e20.listings.length, 1);
  assert.equal(e20.listings[0]?.vendor, "Motorman");
  assert.equal(e20.listings[0]?.status, "in_stock");
  assert.equal(e20.listings[0]?.stock_count, 3);
  assert.equal(e20.listings[0]?.pack_size, 2);
  assert.equal(e20.listings[0]?.unit_price_cents, Math.round(3399 / 2));
  assert.match(e20.listings[0]?.lead_time ?? "", /no mail order/);
  assert.match(e20.listings[0]?.lead_time ?? "", /4, 7/);

  const f44 = catalog.motors.find((item) => item.designation === "E20W");
  assert.ok(f44);

  const h268 = catalog.motors.find((item) => item.id === 2);
  assert.equal(h268?.listings[0]?.stock_count, 1);
  assert.equal(h268?.listings[0]?.pack_size, 1);
  assert.equal(h268?.cheapest_in_stock?.vendor, "Motorman");

  const reload = catalog.motors.find((item) => item.id === 3);
  const single = catalog.motors.find((item) => item.id === 4);
  assert.equal(reload?.listings[0]?.stock_count, 2);
  assert.equal(single?.listings[0]?.stock_count, 4);
  assert.equal(reload?.listings[0]?.status, "in_stock");

  const classic = catalog.motors.find((item) => item.id === 5);
  assert.equal(classic?.listings[0]?.stock_count, 2);
  assert.equal(classic?.listings[0]?.price_cents, 2199);

  const green = catalog.motors.find((item) => item.id === 6);
  assert.equal(green?.listings[0]?.stock_count, 2);

  const longburn = catalog.motors.find((item) => item.id === 7);
  assert.equal(longburn?.listings[0]?.stock_count, 1);
  assert.equal(longburn?.listings[0]?.price_cents, 14399);

  const plugged = catalog.motors.find((item) => item.id === 8);
  assert.equal(plugged?.listings[0]?.stock_count, 1);

  assert.equal(catalog.motorman?.ok, true);
  assert.equal(catalog.motorman?.listUpdated, "Sep 28");
  assert.equal(catalog.motorman?.motorsInStock, 8);
});

const hardwarePages = {
  aerotech: `
<div id="wsite-content">
<strong>29mm Hardware</strong><br>
29/120 motor $104.99 (1)<br>
38/120 case $35.00<br>
54/1706 motor $257.99<br>
54/1706 case $180.99<br>
54mm seal disk $20.99 (1)<br>
29mm Reload Adapter System $49.99 (1)<br>
H220T-14A (Requires 29mm Forward Seal Disc during assembly) $41.99<br>
</div>
<div class="wsite-footer"></div>`,
  cesaroni: `
<div id="wsite-content">
Pro24 Hardware<br>
1 Grain Casing $23.65 (2)<br>
1 Grain Reload 56-F31-12A $27.50 (1)<br>
Pro38<br>
XL Spacer $34.70 (3)<br>
Pro 75<br>
Pro 75 4 Grain Complete Motor $436.60<br>
Pro 75 4 Grain Case $286.35<br>
</div>
<div id="footer"></div>`,
};

test("motorman hardware is casings and closures, not reloads, and only (n) is in stock", () => {
  const at = motormanHardware(htmlToLines(hardwarePages.aerotech), "aerotech", "https://www.the-motorman.net/aerotech.html");
  const cti = motormanHardware(htmlToLines(hardwarePages.cesaroni), "cesaroni", "https://www.the-motorman.net/cti--cesaroni.html");
  const all = [...at, ...cti];
  const by = (title: string) => all.find((offer) => offer.title === title);

  const complete = by("29/120 motor");
  assert.equal(complete?.kind, "complete");
  assert.equal(complete?.size, "29/120");
  assert.equal(complete?.status, "in_stock");
  assert.equal(complete?.stockCount, 1);
  assert.equal(complete?.priceCents, 10499);

  const tube = by("54/1706 case");
  assert.equal(tube?.kind, "casing");
  assert.equal(tube?.status, "out_of_stock");
  assert.equal(tube?.stockCount, null);
  assert.equal(by("54/1706 motor")?.kind, "complete");
  assert.equal(by("54/1706 motor")?.status, "out_of_stock");

  const grain = by("1 Grain Casing");
  assert.equal(grain?.kind, "casing");
  assert.equal(grain?.size, "Pro24-1G");
  assert.equal(grain?.status, "in_stock");
  assert.equal(grain?.stockCount, 2);
  assert.equal(all.some((offer) => /grain reload|reload kit/i.test(offer.title)), false);
  assert.equal(all.some((offer) => /H220T/i.test(offer.title)), false);

  assert.equal(by("29mm Reload Adapter System")?.kind, "adapter");
  assert.equal(by("29mm Reload Adapter System")?.status, "in_stock");
  assert.equal(by("XL Spacer")?.kind, "adapter");
  assert.equal(by("Pro 75 4 Grain Complete Motor")?.kind, "complete");
  assert.equal(by("Pro 75 4 Grain Case")?.kind, "casing");
  assert.equal(by("Pro 75 4 Grain Case")?.size, "Pro75-4G");
});
