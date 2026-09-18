"use client";

import { useEffect, useState } from "react";

const availabilityCache = new Map<string, Promise<boolean>>();

export function checkModel(path: string): Promise<boolean> {
  const cached = availabilityCache.get(path);
  if (cached) return cached;
  const promise = fetch(path, { method: "GET", headers: { Range: "bytes=0-0" } })
    .then((r) => r.ok || r.status === 206)
    .catch(() => false);
  availabilityCache.set(path, promise);
  return promise;
}

export function useModelAvailable(path: string) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    checkModel(path).then((available) => {
      if (!cancelled) setOk(available);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return ok;
}
