import { useEffect, useRef, useState } from "react";
export function useDrawingSync<T>(
  symbol: string,
  period: string,
  drawings: T[],
  setDrawings: (v: T[]) => void,
) {
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const revision = useRef(0),
    saved = useRef(""),
    latest = useRef(drawings),
    running = useRef(false),
    mounted = useRef(true);
  latest.current = drawings;
  const url = "/api/drawings/" + symbol + "?period=" + period;
  async function load() {
    setReady(false);
    setError("");
    try {
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw Error(d.error);
      if (!mounted.current) return;
      revision.current = d.revision;
      saved.current = JSON.stringify(d.drawings);
      // Migrate browser drawings only if the account has never saved this chart.
      if (d.revision > 0) {
        latest.current = d.drawings;
        setDrawings(d.drawings);
      }
      setReady(true);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  async function save() {
    if (running.current || !ready) return;
    running.current = true;
    setSaving(true);
    setError("");
    try {
      while (JSON.stringify(latest.current) !== saved.current) {
        const payload = JSON.stringify(latest.current);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Study-Client": "web",
          },
          body: JSON.stringify({
            revision: revision.current,
            drawings: JSON.parse(payload),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw Error(d.error);
        revision.current = d.revision;
        saved.current = payload;
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [symbol, period]);
  useEffect(() => {
    if (ready) void save();
  }, [drawings, ready]);
  const dirty = ready && JSON.stringify(drawings) !== saved.current;
  return {
    ready,
    saving,
    error,
    dirty,
    retry: save,
    reload: load,
    status:
      error ||
      (!ready
        ? "서버 그림 불러오는 중…"
        : saving || dirty
          ? "서버에 저장 중…"
          : "계정에 저장됨 · 다른 기기에서도 불러옵니다"),
  };
}
