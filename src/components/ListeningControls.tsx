"use client";

import { useState } from "react";

async function post(url: string, body: unknown): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
  return { ok: response.ok, ...data };
}

// An on/off switch for collection: platform-wide, or for one account.
export function CollectSwitch({ userId, initial, label }: { userId?: string; initial: boolean; label?: string }) {
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const url = userId ? `/api/admin/users/${encodeURIComponent(userId)}/listening` : "/api/admin/listening";

  async function toggle() {
    setPending(true);
    const result = await post(url, { action: "collect", on: !on });
    setPending(false);
    if (result.ok) setOn(!on);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label ?? (on ? "Collecting" : "Not collecting")}
      onClick={toggle}
      disabled={pending}
      className={userId ? "linkish" : "btn secondary"}
      style={userId ? { display: "inline-flex", alignItems: "center", gap: 8 } : { minHeight: 52, padding: "6px 22px 6px 6px", gap: 14 }}
    >
      <span className={on ? "switch on" : "switch"} aria-hidden="true" style={userId ? { transform: "scale(0.7)", margin: "-6px -8px" } : undefined}>
        <span className="knob" />
      </span>
      {userId ? (on ? "On" : "Off") : on ? "Collecting listening history" : "Collection is off"}
    </button>
  );
}

// Two steps so one stray click can't delete history. Purging everyone also
// needs the phrase typed.
export function PurgeButton({ userId, onDone }: { userId?: string; onDone?: () => void }) {
  const [stage, setStage] = useState<"idle" | "confirm" | "done">("idle");
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState("");
  const all = !userId;

  async function purge() {
    const url = all ? "/api/admin/listening" : `/api/admin/users/${encodeURIComponent(userId)}/listening`;
    const result = await post(url, all ? { action: "purge", confirm: phrase } : { action: "purge" });
    setStage("done");
    setMessage(result.ok ? `Deleted ${result.deleted ?? 0} rows` : (result.error ?? "Failed"));
    if (result.ok) onDone?.();
  }

  if (stage === "done") return <span className="help">{message}</span>;
  if (stage === "idle") {
    return (
      <button type="button" className={all ? "btn secondary" : "linkish"} onClick={() => setStage("confirm")}>
        {all ? "Purge all history" : "Purge"}
      </button>
    );
  }
  return (
    <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {all ? (
        <input
          aria-label="Type PURGE ALL to confirm"
          placeholder="Type PURGE ALL"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          style={{ minHeight: 40, padding: "0 12px", borderRadius: 12, border: "1px solid var(--line-strong)", background: "var(--ground)", color: "var(--text)" }}
        />
      ) : null}
      <button type="button" className={all ? "btn sm" : "linkish"} disabled={all && phrase !== "PURGE ALL"} onClick={purge}>
        {all ? "Delete everything" : "Confirm purge"}
      </button>
      <button type="button" className="linkish" onClick={() => setStage("idle")}>
        Cancel
      </button>
    </span>
  );
}
