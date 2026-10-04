import { useCallback, useEffect, useState } from "react";
import { getHardware } from "@/lib/hardware.functions";
import type { HardwarePart } from "@/lib/hardware";

export function useHardware() {
  const [parts, setParts] = useState<HardwarePart[]>([]);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getHardware();
      setParts(data.parts);
      setRanAt(data.ranAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load hardware.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { parts, ranAt, loading, error, reload: load };
}
