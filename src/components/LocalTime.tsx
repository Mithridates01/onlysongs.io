"use client";

import { useEffect, useState } from "react";

// Formats an ISO timestamp in the viewer's own time zone. The server renders a
// UTC fallback, and the browser replaces it after hydration.
export function LocalTime({ iso, fallback = "—" }: { iso: string | null | undefined; fallback?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (iso) setText(new Date(iso).toLocaleString());
  }, [iso]);
  if (!iso) return <>{fallback}</>;
  return <time dateTime={iso}>{text ?? `${iso.slice(0, 16).replace("T", " ")} UTC`}</time>;
}
