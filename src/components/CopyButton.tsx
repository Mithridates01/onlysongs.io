"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        window.setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
