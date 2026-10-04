import { useCallback, useEffect, useState } from "react";
import { getCatalog } from "@/lib/catalog.functions";
import type { Catalog } from "@/lib/motors";

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>({ generatedAt: null, motors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the motor list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { catalog, loading, error, reload: load };
}