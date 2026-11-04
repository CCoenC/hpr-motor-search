import { createServerFn } from "@tanstack/react-start";
import { applyMotorman, fetchMotormanPages } from "@/lib/motorman";
import type { Catalog } from "@/lib/motors";

let catalogCache: { at: number; data: Catalog } | null = null;

export function invalidateCatalog() {
  catalogCache = null;
}

export const getCatalog = createServerFn({ method: "GET" }).handler(async (): Promise<Catalog> => {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60 * 1000) return catalogCache.data;

  const pagePromise = fetchMotormanPages();

  const { applyVendorScrape, loadMotorCatalog } = await import("@/lib/scrape/run.server");
  const parsed = await loadMotorCatalog();
  const loaded = (await pagePromise).filter((page): page is NonNullable<typeof page> => page != null);
  const checkedAt = new Date().toISOString();
  const withMotorman = loaded.length
    ? applyMotorman(parsed, loaded, checkedAt)
    : {
        ...parsed,
        motorman: { ok: false, checkedAt, listUpdated: null, motorsInStock: 0, shelfCount: 0 },
      };
  const data = await applyVendorScrape(withMotorman);

  catalogCache = { at: Date.now(), data };
  return data;
});
