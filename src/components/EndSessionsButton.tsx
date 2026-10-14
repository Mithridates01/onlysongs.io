"use client";

import { useState } from "react";

export function EndSessionsButton({ userId }: { userId: string }) {
  const [label, setLabel] = useState("End sessions");
  const [pending, setPending] = useState(false);

  async function endSessions() {
    if (!window.confirm("Sign this user out everywhere?")) return;
    setPending(true);
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/sessions`, { method: "POST" });
    const data = (await response.json()) as { ended?: number };
    setPending(false);
    setLabel(response.ok ? `Ended ${data.ended ?? 0}` : "Failed");
  }

  return (
    <button type="button" className="linkish" onClick={endSessions} disabled={pending}>
      {label}
    </button>
  );
}
