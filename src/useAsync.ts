import { DependencyList, useEffect, useState } from "react";
import { errorText, useUi } from "./store/ui";

/** Загружает данные и следит за отменой при смене зависимостей. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const { toast } = useUi();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        setError(errorText(e));
        toast(errorText(e));
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, setData };
}
