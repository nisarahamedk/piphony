import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useLiveValue<T>(options: {
  initial: T;
  load: () => Promise<T>;
  intervalMs?: number;
}) {
  const [value, setValue] = useState(options.initial);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const loadRef = useRef(options.load);

  useEffect(() => {
    loadRef.current = options.load;
  }, [options.load]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const next = await loadRef.current();
      setValue(next);
      setError(undefined);
      return next;
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, options.intervalMs ?? 3_000);
    return () => window.clearInterval(id);
  }, [options.intervalMs, refresh]);

  return useMemo(
    () => ({ value, setValue, refresh, isRefreshing, error }),
    [error, isRefreshing, refresh, value],
  );
}
