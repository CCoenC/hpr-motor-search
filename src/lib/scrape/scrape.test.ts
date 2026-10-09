import assert from "node:assert/strict";
import test from "node:test";
import type { Motor } from "../motors.ts";
import { offersFromPulls, applyStored } from "./apply.ts";
import { buildIndex, matchMotor, qjetDesignation } from "./match.ts";
import { amwOffers, apogeeOffers, balsaOffers, chrisOffer, lokiGroupOffers, lokiOffer, motoOffer, performanceOffers, siriusOffers } from "./pages.ts";
import { csHardwareOffers, csOffers, hawkHardware, hawkOffers, rocketariumCards, sunwardCheckValue, sunwardHardware } from "./extra.ts";
import { aerotechLead, isMotorProduct } from "./shopify.ts";

function motor(patch: Partial<Motor> & Pick<Motor, "id" | "designation" | "common_name" | "manufacturer">): Motor {
  return {
    impulse_class: patch.designation[0] ?? "I",
    diameter_mm: 38,
    total_impulse_ns: null,
    avg_thrust_n: null,
    burn_time_s: null,
    propellant: null,
    sparky: false,
    motor_type: "reload",
    case_info: null,
    hazmat: "1.4C",
    delays: null,
    delay_adjustable: false,
    discontinued: false,
    in_stock: false,
    vendor_count: 0,
    in_stock_vendor_count: 0,
    listings: [],
    cheapest_in_stock: null,
    ...patch,
  };
}

const motors = [
  motor({ id: 1, designation: "I115W", common_name: "I115", manufacturer: "AeroTech", propellant: "White Lightning", diameter_mm: 54 }),
  motor({ id: 2, designation: "I115T", common_name: "I115", manufacturer: "AeroTech", propellant: "Blue Thunder", diameter_mm: 38 }),
  motor({ id: 3, designation: "41F36-11A", common_name: "F36", manufacturer: "Cesaroni Technology", propellant: "Smoky Sam", diameter_mm: 29, motor_type: "reload" }),
  motor({ id: 4, designation: "G66-LR", common_name: "G66", manufacturer: "Loki Research", propellant: "Loki Red", diameter_mm: 38 }),
  motor({ id: 5, designation: "F115SN-12A", common_name: "F115", manufacturer: "AeroTech", propellant: "Slo Nine", diameter_mm: 29, motor_type: "SU" }),
  motor({ id: 6, designation: "HP-I65W", common_name: "I65", manufacturer: "AeroTech", propellant: "White Lightning", diameter_mm: 54, motor_type: "SU" }),
];
const index = buildIndex(motors);

test("designation codes keep the propellant and drop the delay", () => {
  assert.equal(matchMotor("I115W-14A", index)?.designation, "I115W");
  assert.equal(matchMotor("I115T-6", index)?.designation, "I115T");
  assert.equal(matchMotor("41F36-11A", index)?.designation, "41F36-11A");
  assert.equal(matchMotor("G-66-LR Reload", index)?.designation, "G66-LR");
  assert.equal(matchMotor("D10-4W (single pack)", buildIndex([motor({ id: 9, designation: "D10W", common_name: "D10", manufacturer: "AeroTech", propellant: "White Lightning", diameter_mm: 18, motor_type: "SU" })]))?.designation, "D10W");
  assert.equal(matchMotor("F115SN DMS", index)?.designation, "F115SN-12A");
  assert.equal(matchMotor("I65W DMS", index)?.designation, "HP-I65W");
});

test("balsa rows use the thrustcurve link and the available count", () => {
  const html = `<TR><TD>091114</TD><TD><a href="https://www.thrustcurve.org/motors/AeroTech/I115W">I115W-14A <span style="color:green"> 2 available</span></a></TD><TD><A HREF="add">$67.49</A></TD></TR>`;
  const offers = balsaOffers(html);
  assert.equal(offers[0]?.designationHint, "I115W");
  assert.equal(offers[0]?.stockCount, 2);
  assert.equal(offers[0]?.priceCents, 6749);
  assert.equal(offers[0]?.status, "in_stock");
});

test("performance rows treat add-to-cart as in stock", () => {
  const html = `<tr><a name='D13-4W 3-pack'></a><td>$27.40</td><td>Add to Cart</td></tr><tr><a name='I115W-14A'></a><td>$67.49</td><td>Out of stock</td></tr>`;
  const offers = performanceOffers(html, "1");
  assert.equal(offers[0]?.status, "in_stock");
  assert.equal(offers[0]?.packSize, 3);
  assert.equal(offers[0]?.priceCents, 2740);
  assert.equal(offers[1]?.status, "out_of_stock");
});

test("chris and loki product pages", () => {
  const chris = chrisOffer(
    `<h1>AeroTech I115W-14A</h1><div class="product-stock-status">Stock Level: 4</div><script type="application/ld+json">{"@type":"Product","offers":{"price":"71.24","availability":"https://schema.org/InStock"}}</script>`,
    "https://www.csrocketry.com/x.html",
  );
  assert.equal(chris?.stockCount, 4);
  assert.equal(chris?.priceCents, 7124);
  const loki = lokiOffer(`<h1>G-66-LR Reload 2-pack</h1><font>$76.00</font><input type="submit" value="Add to cart">`, "https://lokiresearch.com/secure/storeDetail.asp?id=1");
  assert.equal(loki?.status, "in_stock");
  assert.equal(loki?.packSize, 2);
  const group = lokiGroupOffers(`<tr><td><a href='storeDetail.asp?id=9'><p>J-350 BATES</p></a></td><td><font>J-350-SF</font></td><td><font>SpitFire</font></td><td>$120.00</td><td><input name=Q_9></td></tr><tr><td><a href='storeDetail.asp?id=8'>H-90</a></td><td><font>H-90-LR</font></td><td>$40.00</td><td>TEMPORARILY OUT OF STOCK</td></tr>`);
  assert.equal(group[0]?.status, "in_stock");
  assert.equal(group[0]?.priceCents, 12000);
  assert.equal(group[0]?.designationHint, "J-350-SF");
  assert.equal(group[1]?.status, "out_of_stock");
});

test("relay shops read the shelf from their own markup", () => {
  const sirius = siriusOffers(
    `<tr class="productListing-odd"><td><h3 class="itemTitle"><a href="https://www.siriusrocketry.biz/ishop/d13.html">Aerotech D13-4W Reload Kit (3-pack)</a></h3></td><td><span class="productSalePrice">Sale:&nbsp;$27.40</span><img alt="Sold Out" /></td></tr>`,
  );
  assert.equal(sirius[0]?.status, "out_of_stock");
  assert.equal(sirius[0]?.priceCents, 2740);
  assert.equal(sirius[0]?.packSize, 3);
  const amw = amwOffers(
    `<div class="product floatleft"><h2><a href="/index.php?option=com_virtuemart&view=productdetails&virtuemart_product_id=1">H250G-14A*</a></h2><span class="PricesalesPrice">$47.49</span> 1 In Stock</div>`,
  );
  assert.equal(amw[0]?.title, "H250G-14A");
  assert.equal(amw[0]?.status, "in_stock");
  assert.equal(amw[0]?.stockCount, 1);
  const moto = motoOffer(`<h1>D15-4T</h1><li>Availability: In Stock</li><h2>$42.99</h2>`, "https://www.moto-joe.com/p");
  assert.equal(moto?.status, "in_stock");
  assert.equal(moto?.priceCents, 4299);
  const counted = motoOffer(`<h1>D9-7W</h1><li>Availability: 1</li><h2>$23.00</h2>`, "https://www.moto-joe.com/p");
  assert.equal(counted?.status, "in_stock");
  assert.equal(counted?.stockCount, 1);
});

test("apogee motor chart uses the shelf count and the pack price", () => {
  const html = `
    <td nowrap="nowrap" data-text="E18W-4"><strong><a href="https://www.apogeerockets.com/Rocket-Motors/AeroTech-Motors/E18W">E18W-4</a></strong></td>
    <td data-text="AeroTech 24/40">AeroTech</td><td data-text="4 ">4</td><td data-text="White Lightning">White Lightning</td>
    <td data-text="40.65"><div class="single_price">$40.65</div><br /><i>3 pack</i></td>
    <td data-text='2'><form><input class="button_add_to_cart" value="Add to Cart" /></form></td>
    <td nowrap="nowrap" data-text="D13W-4"><strong><a href="https://www.apogeerockets.com/Rocket-Motors/AeroTech-Motors/D13">D13W-4</a></strong></td>
    <td data-text="AeroTech 18/20">AeroTech</td><td data-text="4 ">4</td><td data-text="White Lightning">White Lightning</td>
    <td data-text="29.95"><div class="single_price">$29.95</div><br /><i>3 pack</i></td>
    <td data-text='0'><form><span class="button_sold_out_sm">Sold Out</span></form></td>
    <td nowrap="nowrap" data-text="H180"><strong><a href="https://www.apogeerockets.com/Rocket_Motors/Cesaroni_Propellant_Kits/Cesaroni_P29-6G_Skidmark_H180">H180</a></strong></td>
    <td data-text="Cesaroni 6-Grain">Cesaroni</td><td data-text="14 ">14</td><td data-text="Skidmark">Skidmark</td>
    <td data-text="88.81"><div class="single_price">$88.81</div>(HAZ)</td>
    <td data-text='1'><form><input class="button_add_to_cart" value="Add to Cart" /></form></td>`;
  const offers = apogeeOffers(html);
  assert.equal(offers.length, 3);
  assert.equal(offers[0]?.status, "in_stock");
  assert.equal(offers[0]?.stockCount, 2);
  assert.equal(offers[0]?.packSize, 3);
  assert.equal(offers[0]?.priceCents, 4065);
  assert.equal(offers[0]?.designationHint, "E18W-4");
  assert.equal(offers[1]?.status, "out_of_stock");
  assert.equal(offers[1]?.stockCount, null);
  assert.equal(offers[2]?.designationHint, null);
  assert.match(offers[2]?.title ?? "", /Skidmark/);
  assert.match(offers[2]?.title ?? "", /H180/);
});

test("aerotech direct motors are special order, hardware is skipped", () => {
  assert.equal(isMotorProduct("AeroTech RMS-54/426 I115W reload", "motor", []), true);
  assert.equal(isMotorProduct("29mm forward closure", "hardware", []), false);
  const lead = aerotechLead("I115W RMS reload", "Orders for 29mm-98mm RMS reloads and 29mm-152mm DMS motors: Up to 40 to 44 weeks or sooner");
  assert.match(lead, /40 to 44 weeks/);
});

test("a trusted vendor replaces its snapshot listings", () => {
  const catalogMotors = motors.map((item) => ({
    ...item,
    listings: [{ vendor: "Old", vendor_slug: "balsa_machining", url: "old", status: "out_of_stock" as const, price_cents: 1, unit_price_cents: 1, currency: "USD", pack_size: 1, stock_count: null, lead_time: null, last_seen: null }],
  }));
  const { vendors, stored } = offersFromPulls(catalogMotors, [
    {
      slug: "balsa_machining",
      name: "Balsa Machining Service",
      ok: true,
      note: null,
      checkedAt: "2026-10-03T00:00:00Z",
      offers: Array.from({ length: 5 }, (_, index) => ({
        title: index === 0 ? "I115W" : `H${200 + index}W`,
        designationHint: index === 0 ? "I115W" : null,
        url: "https://www.balsamachining.com/hpmp.htm",
        status: "in_stock" as const,
        priceCents: 1000 + index,
        packSize: 1,
        stockCount: 2,
        leadTime: null,
      })),
    },
  ]);
  assert.equal(vendors[0]?.ok, false);
  assert.equal(stored.length, 1);
});

test("the same AMW product in two categories is counted once", () => {
  const catalog = [
    motor({ id: 20, designation: "K850DM", common_name: "K850", manufacturer: "AeroTech", propellant: "Dark Matter", diameter_mm: 54 }),
  ];
  const listing = (id: string, category: string, stock: number) => ({
    title: "K850DM DMS",
    url: `https://cart.amwprox.com/index.php?option=com_virtuemart&view=productdetails&virtuemart_product_id=${id}&virtuemart_category_id=${category}&Itemid=533`,
    status: "in_stock" as const,
    priceCents: 33099,
    packSize: 1,
    stockCount: stock,
    leadTime: null,
  });
  const { stored } = offersFromPulls(catalog, [
    {
      slug: "amw",
      name: "Animal Motor Works",
      ok: true,
      note: null,
      checkedAt: "2026-10-08T00:00:00Z",
      offers: [listing("1297", "104", 2), listing("1297", "112", 2), listing("1300", "112", 3)],
    },
  ]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.stockCount, 5);
});

test("quest q-jets become shelf motors without joining the thrustcurve catalog", () => {
  assert.equal(qjetDesignation("Quest Q-Jet C18-4W Rocket Engines (2pk)")?.designation, "C18W-4");
  assert.equal(qjetDesignation("I115W reload")?.designation, undefined);
  const pulls = [
    {
      slug: "amw",
      name: "Animal Motor Works",
      ok: true,
      note: null,
      checkedAt: "2026-10-03T00:00:00Z",
      offers: ["A3-4", "B4-4", "C12-6", "C18-4W", "D20-6W"].map((code) => ({
        title: `${code} Q-Jet`,
        url: `https://cart.amwprox.com/${code}`,
        status: "in_stock" as const,
        priceCents: 999,
        packSize: 1,
        stockCount: 4,
        leadTime: null,
      })),
    },
  ];
  const { stored, vendors } = offersFromPulls(motors, pulls);
  assert.equal(vendors[0]?.ok, true);
  const catalog = applyStored(
    { generatedAt: null, motors, scrape: { ranAt: null, intervalMinutes: null, vendors } },
    stored,
    { ranAt: "2026-10-03T00:00:00Z", intervalMinutes: null, vendors },
  );
  const a3 = catalog.motors.find((item) => item.designation === "A3-4");
  const white = catalog.motors.find((item) => item.designation === "C18W-4");
  assert.equal(a3?.case_info, "Quest Q-Jet");
  assert.equal(a3?.manufacturer, "Quest");
  assert.equal(a3?.in_stock, true);
  assert.equal(a3?.listings[0]?.stock_count, 4);
  assert.equal(white?.propellant, "White Lightning");
  assert.equal(catalog.motors.filter((item) => item.case_info === "Quest Q-Jet").length, 5);
});

test("cs rocketry cards keep the sale price and the shelf count", () => {
  const html = `
    <form class="category-product-card"><div class="product_list_view">
      <h3><a href="https://www.csrocketry.com/f39.html" title="Aerotech F39-6T">Aerotech F39-6T</a></h3>
      <span class="sale_price">$12.00</span>
      <span class="category-product-stock">Stock Level: 3</span>
    </div><div class="product_grid_view">duplicate</div></form>
    <form class="category-product-card"><div class="product_list_view">
      <h3><a href="https://www.csrocketry.com/i115.html" title="Aerotech I115W-14A">Aerotech I115W-14A</a></h3>
      <h3 class="category-product-price">$74.99</h3>
      <strong>Out of stock</strong>
    </div></form>
    <form class="category-product-card"><div class="product_list_view">
      <h3><a href="https://www.csrocketry.com/case.html" title="RMS-54/426 Complete Motor Hardware Set">RMS-54/426 Complete Motor Hardware Set</a></h3>
      <span class="sale_price">$180.99</span>
      <span class="category-product-stock">Stock Level: 1</span>
    </div></form>`;
  const motors = csOffers(html);
  assert.equal(motors.length, 2);
  assert.equal(motors[0]?.status, "in_stock");
  assert.equal(motors[0]?.stockCount, 3);
  assert.equal(motors[0]?.priceCents, 1200);
  assert.equal(motors[1]?.status, "out_of_stock");
  const hardware = csHardwareOffers(html);
  assert.equal(hardware.length, 1);
  assert.equal(hardware[0]?.vendor, "CS Rocketry");
  assert.equal(hardware[0]?.kind, "complete");
});

test("cs rocketry ignores the reward amount in the image title", () => {
  const html = `<form class="category-product-card"><div class="product_list_view">
    <a title="Aerotech F62-10FJ (2-pack) Black Max Rocket Motor - (Earn 37 reward points on this item worth $1.11)"></a>
    <h3><a href="https://www.csrocketry.com/f62.html" title="Aerotech F62-10FJ (2-pack) Black Max Rocket Motor">Aerotech F62-10FJ (2-pack) Black Max Rocket Motor</a></h3>
    <h3 class="category-product-price"> $37.99</h3>
    <span class="category-product-stock">Stock Level: 59</span>
  </div></form>`;
  const motors = csOffers(html);
  assert.equal(motors.length, 1);
  assert.equal(motors[0]?.priceCents, 3799);
  assert.equal(motors[0]?.stockCount, 59);
});

test("rocketarium listings and onebadhawk loki rows parse", () => {
  const cards = rocketariumCards(`
    <div class="productListing-odd"><a href="https://www.rocketarium.com/RMS/24-40/Aft">RMS 24/40 Motor Aft Closure</a>
    <meta itemprop="price" content="24.00"/></div>`);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.priceCents, 2400);
  const reloads = hawkOffers(
    `<div class="paragraph">G 66 Loki Red. Two reloads per package. $78.00</div>`,
    "https://onebadhawk.com/38mm--120ns-reload-kits.html",
  );
  assert.equal(reloads[0]?.designationHint, "G66");
  assert.equal(reloads[0]?.packSize, 2);
  assert.equal(reloads[0]?.priceCents, 7800);
  const hardware = hawkHardware(
    `<div class="paragraph">This is a 38mm 120Ns Motor Complete with a delay forward bulkhead. $155.00</div>`,
    "https://onebadhawk.com/loki---38mm-hardware.html",
  );
  assert.equal(hardware[0]?.maker, "Loki Research");
  assert.equal(hardware[0]?.size, "38/120");
  assert.equal(hardware[0]?.priceCents, 15500);
});

test("sunward casings use the grain variation and simple products use the offer block", () => {
  const json = '[{"attributes":{"attribute_pa_cti-case-size":"2-grain-case"},"display_price":55.5,"is_in_stock":true},{"attributes":{"attribute_pa_cti-case-size":"6gxl-grain-case"},"display_price":90,"is_in_stock":false}]';
  const variable = sunwardHardware(
    `<h1 class="product_title entry-title">CTI Pro38 Hardware Casing</h1><form data-product_variations="${json.replaceAll('"', "&" + "quot;")}"></form>`,
    "https://www.sunward1.com/product/cti-pro38-hardware-casing/",
  );
  assert.equal(variable.length, 2);
  assert.equal(variable[0]?.size, "Pro38-2G");
  assert.equal(variable[0]?.status, "in_stock");
  assert.equal(variable[0]?.priceCents, 5550);
  assert.equal(variable[0]?.vendor, "Sunward");
  assert.equal(variable[1]?.size, "Pro38-6GXL");
  assert.equal(variable[1]?.status, "out_of_stock");
  const simple = sunwardHardware(
    `<h1 class="product_title">Pro24 Rear Closure</h1>
     <script type="application/ld+json">{"@type":"Product","name":"Pro24 Rear Closure","offers":[{"@type":"Offer","price":"16.99","availability":"https://schema.org/OutOfStock"}]}</script>`,
    "https://www.sunward1.com/product/pro24-rear-closure/",
  );
  assert.equal(simple[0]?.kind, "closure");
  assert.equal(simple[0]?.priceCents, 1699);
  assert.equal(simple[0]?.status, "out_of_stock");
  const tool = sunwardHardware(
    `<h1 class="product_title">ProDAT 38 Delay Adjustment Tool</h1>
     <script type="application/ld+json">{"@type":"Product","offers":[{"price":"12.00","availability":"https://schema.org/InStock"}]}</script>`,
    "https://www.sunward1.com/product/prodat-38-delay-adjustment-tool/",
  );
  assert.equal(tool.length, 0);
  const pro150Json = '[{"attributes":{"attribute_pa_cti-case-size":"3-grain-case"},"display_price":420,"is_in_stock":true}]';
  const pro150 = sunwardHardware(
    `<h1 class="product_title">CTI Pro150 Hardware Casing Set</h1><form data-product_variations="${pro150Json.replaceAll('"', "&" + "quot;")}"></form>`,
    "https://www.sunward1.com/product/cti-pro150-hardware-casing-set/",
  );
  assert.equal(pro150[0]?.size, "Pro150-3G");
  assert.equal(pro150[0]?.diameterMm, 150);
  assert.equal(pro150[0]?.kind, "complete");
  const grains = sunwardHardware(
    `<h1 class="product_title">Standard J Fuel Grains Case of 12 by HyperTEK</h1>
     <script type="application/ld+json">{"@type":"Product","offers":[{"price":"89.00","availability":"https://schema.org/InStock"}]}</script>`,
    "https://www.sunward1.com/product/standard-j-fuel-grains-case-of-12-by-hypertek/",
  );
  assert.equal(grains.length, 0);
});

test("sunward splash adds the two digit-strings as numbers", () => {
  const twelve = "((+!+[]+[])+(+!+[]+!![]))";
  const three = "((+!+[]+!![]+!![]))";
  assert.equal(sunwardCheckValue(twelve, three), 15);
  assert.equal(sunwardCheckValue("alert(1)", three), null);
});


