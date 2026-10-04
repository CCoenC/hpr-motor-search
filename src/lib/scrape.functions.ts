import { createServerFn } from "@tanstack/react-start";
import { getScrapeMeta, runVendorScrape } from "@/lib/scrape/run.server";

export const getScrapeStatus = createServerFn({ method: "GET" }).handler(async () => getScrapeMeta());

export const startVendorScrape = createServerFn({ method: "POST" }).handler(async () => {
  const meta = await runVendorScrape();
  const { invalidateCatalog } = await import("@/lib/catalog.functions");
  invalidateCatalog();
  return meta;
});
