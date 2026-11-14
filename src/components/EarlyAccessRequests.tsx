"use client";

import { useState } from "react";
import { LocalTime } from "./LocalTime";

export type RequestRow = {
  id: string;
  email: string;
  status: "pending" | "invited" | "declined" | "joined";
  createdAt: string;
  inviteExpiresAt: string | null;
};

const LABEL: Record<RequestRow["status"], string> = {
  pending: "Waiting",
  invited: "Invite sent",
  declined: "Declined",
  joined: "Joined",
};

// Operator list of early-access requests with approve, decline and resend.
export function EarlyAccessRequests({ initial }: { initial: RequestRow[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const waiting = rows.filter((row) => row.status === "pending").length;

  async function decide(row: RequestRow, action: "approve" | "decline") {
    setBusy(row.id);
    setError("");
    const response = await fetch(`/api/admin/early-access/${encodeURIComponent(row.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; status?: RequestRow["status"] };
    setBusy(null);
    if (!response.ok || !data.status) {
      setError(data.error ?? "That didn’t work. Try again.");
      return;
    }
    const expires = data.status === "invited" ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : null;
    setRows((list) => list.map((item) => (item.id === row.id ? { ...item, status: data.status!, inviteExpiresAt: expires } : item)));
  }

  return (
    <section id="requests" className="card" aria-labelledby="req-h">
      <div className="spread" style={{ alignItems: "baseline" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 id="req-h">Early access requests</h2>
          <p className="help" style={{ margin: 0 }}>
            Approving emails a link to finish creating the account. It works once and expires in 14 days.
          </p>
        </div>
        <span className="help">{waiting} waiting</span>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="help">No requests yet.</p>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.id} className="list-row" style={{ justifyContent: "space-between" }}>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 15 }}>{row.email}</span>
                <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
                  Requested <LocalTime iso={row.createdAt} />
                  {row.status === "invited" && row.inviteExpiresAt ? (
                    <>
                      {" "}
                      · invite expires <LocalTime iso={row.inviteExpiresAt} />
                    </>
                  ) : null}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {row.status === "pending" ? (
                  <>
                    <button type="button" className="btn sm" disabled={busy === row.id} onClick={() => decide(row, "approve")}>
                      Approve
                    </button>
                    <button type="button" className="btn secondary sm" disabled={busy === row.id} onClick={() => decide(row, "decline")}>
                      Decline
                    </button>
                  </>
                ) : (
                  <>
                    <span className={row.status === "declined" ? "pill" : "pill good"}>{LABEL[row.status]}</span>
                    {row.status === "invited" || row.status === "declined" ? (
                      <button type="button" className="btn secondary sm" disabled={busy === row.id} onClick={() => decide(row, "approve")}>
                        {row.status === "invited" ? "Resend" : "Approve"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
