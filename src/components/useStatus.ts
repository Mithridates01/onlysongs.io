"use client";

import { useCallback, useEffect, useState } from "react";
import type { StatusResponse } from "@/lib/types";

const POLL_MS = 15_000;

// Dashboard status, refreshed every 15 seconds and on demand.
export function useStatus(initial: StatusResponse) {
  const [status, setStatus] = useState(initial);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/status");
    if (!response.ok) return;
    setStatus((await response.json()) as StatusResponse);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { status, setStatus, refresh };
}
