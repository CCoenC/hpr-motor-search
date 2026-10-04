import { useCallback, useEffect, useRef, useState } from "react";
import { getScrapeStatus, startVendorScrape } from "@/lib/scrape.functions";
import type { ScrapeMeta } from "@/lib/motors";

export function useScrape(onReload: () => void) {
  const [meta, setMeta] = useState<ScrapeMeta & { due?: boolean }>({ ranAt: null, intervalMinutes: 60, vendors: [] });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;

  const refresh = useCallback(async () => {
    const status = await getScrapeStatus();
    setMeta(status);
    return status;
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const status = await startVendorScrape();
      setMeta(status);
      reloadRef.current();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed.");
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const status = await refresh();
        if (!cancel && status.due) void run();
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : "Scrape status failed.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [refresh, run]);

  return { meta, running, error };
}
