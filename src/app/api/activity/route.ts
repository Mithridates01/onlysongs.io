import { prisma } from "@/lib/db";
import { json, requireUser } from "@/lib/http";

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  const url = new URL(request.url);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const cutoff = new Date(Date.now() - WINDOW_MS);
  const where = {
    userId: user.id,
    at: { gte: cutoff, ...(before ? { lt: before } : {}) },
  };

  if (url.searchParams.get("format") === "csv") {
    const rows = await prisma.activityLog.findMany({
      where,
      orderBy: { at: "desc" },
      take: 5000,
    });
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="podcast-blocker-activity.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: 50,
  });
  return json({
    rows: rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      showName: row.showName,
      episodeName: row.episodeName,
      deviceName: row.deviceName,
      action: row.action,
      result: row.result,
      httpStatus: row.httpStatus,
    })),
    nextBefore: rows.length === 50 ? rows[rows.length - 1]?.at.toISOString() ?? null : null,
  });
}

function toCsv(
  rows: {
    at: Date;
    showName: string | null;
    episodeName: string | null;
    deviceName: string | null;
    action: string;
    result: string;
    httpStatus: number | null;
  }[],
): string {
  const header = ["at", "show_name", "episode_name", "device_name", "action", "result", "http_status"];
  const lines = rows.map((row) =>
    [
      row.at.toISOString(),
      row.showName,
      row.episodeName,
      row.deviceName,
      row.action,
      row.result,
      row.httpStatus?.toString() ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
