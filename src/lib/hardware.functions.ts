import { createServerFn } from "@tanstack/react-start";
import { groupHardware } from "@/lib/hardware";
import { fetchMotormanPages, htmlToLines, motormanHardware } from "@/lib/motorman";

export const getHardware = createServerFn({ method: "GET" }).handler(async () => {
  const { loadHardware } = await import("@/lib/scrape/run.server");
  const [loaded, pages] = await Promise.all([loadHardware(), fetchMotormanPages()]);
  const live = pages.flatMap((page) => motormanHardware(htmlToLines(page.html), page.maker, page.url));
  const offers = [...loaded.offers.filter((offer) => offer.vendorSlug !== "motorman"), ...live];
  const ranAt = live.length ? new Date().toISOString() : loaded.ranAt;
  return { ranAt, parts: groupHardware(offers) };
});